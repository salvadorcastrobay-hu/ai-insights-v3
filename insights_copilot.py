"""
Natural-language insights copilot:
- Parses business questions into a constrained analytics plan.
- Builds safe SQL against v_insights_dashboard.
- Reads data from Supabase REST (read-only).
- Returns narrative + SQL + table rows + chart metadata.
"""

from __future__ import annotations

import json
import os
import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError, field_validator
from dotenv import load_dotenv

try:
    from openai import OpenAI
except Exception:  # pragma: no cover - optional runtime dependency
    OpenAI = None  # type: ignore

try:
    from supabase import create_client
except Exception:  # pragma: no cover - optional runtime dependency
    create_client = None  # type: ignore

_PROJECT_ENV_PATH = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=_PROJECT_ENV_PATH)
load_dotenv()

Intent = Literal[
    "pain_points",
    "product_gaps",
    "deal_friction",
    "faq_topics",
    "competitors",
    "insight_volume",
]
Metric = Literal["mentions", "unique_deals", "revenue"]

INTENT_META: dict[str, dict[str, str]] = {
    "pain_points": {
        "fixed_where": "insight_type = 'pain'",
        "label_expr": "COALESCE(insight_subtype_display, insight_subtype)",
        "label_alias": "pain_point",
        "title": "pain points",
    },
    "product_gaps": {
        "fixed_where": "insight_type = 'product_gap'",
        "label_expr": "COALESCE(feature_display, feature_name, insight_subtype_display, insight_subtype)",
        "label_alias": "feature_gap",
        "title": "product gaps",
    },
    "deal_friction": {
        "fixed_where": "insight_type = 'deal_friction'",
        "label_expr": "COALESCE(insight_subtype_display, insight_subtype)",
        "label_alias": "friction_type",
        "title": "deal frictions",
    },
    "faq_topics": {
        "fixed_where": "insight_type = 'faq'",
        "label_expr": "COALESCE(insight_subtype_display, insight_subtype)",
        "label_alias": "faq_topic",
        "title": "faq topics",
    },
    "competitors": {
        "fixed_where": "insight_type = 'competitive_signal'",
        "label_expr": "COALESCE(competitor_name, 'Unknown')",
        "label_alias": "competitor",
        "title": "competitors",
    },
    "insight_volume": {
        "fixed_where": "1=1",
        "label_expr": "COALESCE(insight_type_display, insight_type)",
        "label_alias": "insight_type",
        "title": "insight categories",
    },
}

METRIC_TO_ORDER_EXPR = {
    "mentions": "COUNT(*)",
    "unique_deals": "COUNT(DISTINCT deal_id)",
    "revenue": "COALESCE(SUM(amount), 0)",
}

REGION_HINTS: list[tuple[str, str]] = [
    (r"\bemea\b", "EMEA"),
    (r"\bapac\b", "APAC"),
    (r"\blatam\b", "LATAM"),
    (r"\bnorth america\b|\bna region\b|\bnamer\b", "NORTH AMERICA"),
]

INTENT_TO_INSIGHT_TYPE: dict[Intent, str | None] = {
    "pain_points": "pain",
    "product_gaps": "product_gap",
    "deal_friction": "deal_friction",
    "faq_topics": "faq",
    "competitors": "competitive_signal",
    "insight_volume": None,
}

BASE_SELECT_COLUMNS = [
    "insight_type",
    "insight_type_display",
    "insight_subtype",
    "insight_subtype_display",
    "feature_display",
    "feature_name",
    "competitor_name",
    "deal_id",
    "transcript_id",
    "amount",
    "region",
    "country",
    "segment",
    "deal_stage",
    "module",
    "call_date",
]


class QueryFilters(BaseModel):
    region: list[str] = Field(default_factory=list)
    country: list[str] = Field(default_factory=list)
    segment: list[str] = Field(default_factory=list)
    deal_stage: list[str] = Field(default_factory=list)
    module: list[str] = Field(default_factory=list)
    start_date: str | None = None
    end_date: str | None = None


class QueryPlan(BaseModel):
    intent: Intent
    metric: Metric = "mentions"
    top_n: int = 5
    filters: QueryFilters = Field(default_factory=QueryFilters)

    @field_validator("top_n")
    @classmethod
    def _validate_top_n(cls, value: int) -> int:
        return max(1, min(50, value))


@dataclass
class QueryExecutionResult:
    question: str
    plan: QueryPlan
    sql: str
    rows: list[dict[str, Any]]
    narrative: str

    def to_dict(self) -> dict[str, Any]:
        chart = _build_chart_spec(self.plan, self.rows)
        columns = list(self.rows[0].keys()) if self.rows else []
        return {
            "question": self.question,
            "plan": self.plan.model_dump(),
            "narrative": self.narrative,
            "sql": self.sql.strip(),
            "columns": columns,
            "rows": self.rows,
            "row_count": len(self.rows),
            "chart": chart,
            "generated_at": datetime.utcnow().isoformat() + "Z",
        }


def list_supported_capabilities() -> dict[str, Any]:
    return {
        "mode": "read_only",
        "supported_intents": list(INTENT_META.keys()),
        "supported_metrics": list(METRIC_TO_ORDER_EXPR.keys()),
        "supported_outputs": [
            "narrative",
            "sql",
            "table_rows",
            "single_chart",
            "dashboard_package",
        ],
        "supported_filters": [
            "region",
            "country",
            "segment",
            "deal_stage",
            "module",
            "start_date",
            "end_date",
        ],
        "examples": [
            "Top 5 pain points in EMEA region",
            "Top product gaps by revenue in LATAM",
            "Most common deal frictions in enterprise segment",
            "Top competitors in APAC this quarter",
        ],
    }


def ask_insights(question: str, top_n: int | None = None) -> dict[str, Any]:
    if not question or not question.strip():
        raise ValueError("Question cannot be empty.")

    plan = _build_plan(question=question, top_n_override=top_n)
    sql, params = _build_sql(plan)
    filtered_rows = _load_rows_for_plan(plan=plan, include_intent=True)
    rows = _aggregate_top_rows(plan=plan, filtered_rows=filtered_rows)
    narrative = _build_narrative(question=question, plan=plan, rows=rows)

    result = QueryExecutionResult(
        question=question.strip(),
        plan=plan,
        sql=_render_sql_preview(sql, params),
        rows=rows,
        narrative=narrative,
    )
    return result.to_dict()


def ask_insights_dashboard_package(
    question: str,
    top_n: int | None = None,
    trend_months: int = 6,
) -> dict[str, Any]:
    if not question or not question.strip():
        raise ValueError("Question cannot be empty.")

    trend_months = max(3, min(36, int(trend_months)))
    plan = _build_plan(question=question, top_n_override=top_n)

    primary_sql, primary_params = _build_sql(plan)
    all_rows = _load_rows_for_plan(plan=plan, include_intent=False)
    intent_rows = _filter_rows_by_intent(rows=all_rows, plan=plan)
    primary_rows = _aggregate_top_rows(plan=plan, filtered_rows=intent_rows)
    narrative = _build_narrative(question=question, plan=plan, rows=primary_rows)

    summary_sql, summary_row = _build_executive_summary(plan=plan, filtered_rows=intent_rows)
    charts = _build_dashboard_charts(
        plan=plan,
        primary_rows=primary_rows,
        trend_months=trend_months,
        all_rows=all_rows,
        intent_rows=intent_rows,
    )

    label_col = INTENT_META[plan.intent]["label_alias"]
    top_item = primary_rows[0] if primary_rows else {}
    total_mentions = int(summary_row.get("total_mentions", 0) or 0)
    top_mentions = int(top_item.get("mentions", 0) or 0)
    top_item_share_pct = round((top_mentions / total_mentions) * 100, 2) if total_mentions else 0.0

    return {
        "question": question.strip(),
        "plan": plan.model_dump(),
        "narrative": narrative,
        "executive_summary": {
            **summary_row,
            "top_item_label": top_item.get(label_col),
            "top_item_mentions": top_mentions,
            "top_item_share_pct": top_item_share_pct,
        },
        "sql_blocks": {
            "primary": _render_sql_preview(primary_sql, primary_params),
            "summary": summary_sql.strip(),
            "charts": {item["id"]: item["sql"] for item in charts},
        },
        "primary_table": {
            "columns": list(primary_rows[0].keys()) if primary_rows else [],
            "rows": primary_rows,
            "row_count": len(primary_rows),
        },
        "dashboard": {
            "charts": charts,
            "layout": {
                "row1": ["top_items", "insight_type_mix"],
                "row2": ["regional_breakdown", "monthly_trend"],
            },
        },
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }


def _build_plan(question: str, top_n_override: int | None = None) -> QueryPlan:
    heuristic_plan = _build_heuristic_plan(question=question, top_n_override=top_n_override)

    if OpenAI is None or not os.getenv("OPENAI_API_KEY"):
        return heuristic_plan

    model_name = os.getenv("INSIGHTS_COPILOT_MODEL", os.getenv("OPENAI_MODEL", "gpt-4o-mini"))
    system_prompt = (
        "You are an analytics planner. Convert the user question into a strict JSON object with keys: "
        "intent, metric, top_n, filters. "
        "Allowed intents: pain_points, product_gaps, deal_friction, faq_topics, competitors, insight_volume. "
        "Allowed metric: mentions, unique_deals, revenue. "
        "filters must be an object with lists for region/country/segment/deal_stage/module and optional "
        "start_date/end_date in YYYY-MM-DD. "
        "Do not include SQL. Output JSON only."
    )

    user_prompt = (
        "Question:\n"
        f"{question}\n\n"
        "Return only JSON. If uncertain, keep filters empty and use intent=insight_volume."
    )

    try:
        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        response = client.chat.completions.create(
            model=model_name,
            temperature=0,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        raw = response.choices[0].message.content or "{}"
        payload = json.loads(raw)
        if top_n_override is not None:
            payload["top_n"] = top_n_override
        return QueryPlan.model_validate(payload)
    except (ValidationError, ValueError, KeyError, json.JSONDecodeError, Exception):
        return heuristic_plan


def _build_heuristic_plan(question: str, top_n_override: int | None = None) -> QueryPlan:
    text = question.lower()

    if "pain" in text:
        intent: Intent = "pain_points"
    elif "gap" in text or "feature" in text:
        intent = "product_gaps"
    elif "friction" in text or "blocker" in text:
        intent = "deal_friction"
    elif "faq" in text or "question" in text:
        intent = "faq_topics"
    elif "competitor" in text or "competition" in text:
        intent = "competitors"
    else:
        intent = "insight_volume"

    if any(token in text for token in ("revenue", "arr", "amount", "money", "$")):
        metric: Metric = "revenue"
    elif any(token in text for token in ("deal", "deals", "opportunities")):
        metric = "unique_deals"
    else:
        metric = "mentions"

    top_n_match = re.search(r"\btop\s+(\d{1,2})\b", text)
    top_n = int(top_n_match.group(1)) if top_n_match else 5
    if top_n_override is not None:
        top_n = top_n_override

    region_filters: list[str] = []
    for pattern, canonical in REGION_HINTS:
        if re.search(pattern, text):
            region_filters.append(canonical)

    segment_filters: list[str] = []
    if "enterprise" in text:
        segment_filters.append("enterprise")
    if "smb" in text:
        segment_filters.append("smb")
    if "mid market" in text or "mid-market" in text:
        segment_filters.append("mid_market")

    return QueryPlan(
        intent=intent,
        metric=metric,
        top_n=top_n,
        filters=QueryFilters(
            region=region_filters,
            segment=segment_filters,
        ),
    )


def _build_where_filters(plan: QueryPlan, include_intent: bool = True) -> tuple[str, list[Any]]:
    where_clauses: list[str] = []
    params: list[Any] = []

    if include_intent:
        where_clauses.append(INTENT_META[plan.intent]["fixed_where"])

    def add_case_insensitive_filter(column: str, values: list[str]) -> None:
        if not values:
            return
        normalized = [v.strip().upper() for v in values if v and v.strip()]
        if not normalized:
            return
        where_clauses.append(f"UPPER(COALESCE({column}, '')) = ANY(%s)")
        params.append(normalized)

    add_case_insensitive_filter("region", plan.filters.region)
    add_case_insensitive_filter("country", plan.filters.country)
    add_case_insensitive_filter("segment", plan.filters.segment)
    add_case_insensitive_filter("deal_stage", plan.filters.deal_stage)
    add_case_insensitive_filter("module", plan.filters.module)

    if plan.filters.start_date:
        where_clauses.append("call_date >= %s")
        params.append(plan.filters.start_date)
    if plan.filters.end_date:
        where_clauses.append("call_date <= %s")
        params.append(plan.filters.end_date)

    if not where_clauses:
        where_clauses.append("1=1")

    return " AND ".join(where_clauses), params


def _build_sql(plan: QueryPlan) -> tuple[str, list[Any]]:
    meta = INTENT_META[plan.intent]
    label_expr = meta["label_expr"]
    label_alias = meta["label_alias"]
    where_sql, params = _build_where_filters(plan=plan, include_intent=True)

    order_expr = METRIC_TO_ORDER_EXPR[plan.metric]

    sql = f"""
SELECT
    {label_expr} AS {label_alias},
    COUNT(*) AS mentions,
    COUNT(DISTINCT deal_id) AS unique_deals,
    COALESCE(SUM(amount), 0)::numeric(14,2) AS revenue_at_stake
FROM v_insights_dashboard
WHERE {where_sql}
GROUP BY {label_expr}
ORDER BY {order_expr} DESC, mentions DESC
LIMIT %s
"""
    params.append(plan.top_n)
    return sql, params


def _build_executive_summary(
    plan: QueryPlan,
    filtered_rows: list[dict[str, Any]],
) -> tuple[str, dict[str, Any]]:
    where_sql, params = _build_where_filters(plan=plan, include_intent=True)
    sql = f"""
SELECT
    COUNT(*)::int AS total_mentions,
    COUNT(DISTINCT deal_id)::int AS unique_deals,
    COUNT(DISTINCT transcript_id)::int AS unique_transcripts,
    COALESCE(SUM(amount), 0)::numeric(14,2) AS revenue_at_stake
FROM v_insights_dashboard
WHERE {where_sql}
"""

    total_mentions = len(filtered_rows)
    unique_deals = len({row.get("deal_id") for row in filtered_rows if row.get("deal_id")})
    unique_transcripts = len({row.get("transcript_id") for row in filtered_rows if row.get("transcript_id")})
    revenue_at_stake = round(sum(_to_float(row.get("amount")) for row in filtered_rows), 2)

    return _render_sql_preview(sql, params), {
        "total_mentions": total_mentions,
        "unique_deals": unique_deals,
        "unique_transcripts": unique_transcripts,
        "revenue_at_stake": revenue_at_stake,
    }


def _build_dashboard_charts(
    plan: QueryPlan,
    primary_rows: list[dict[str, Any]],
    trend_months: int,
    all_rows: list[dict[str, Any]],
    intent_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    label_alias = INTENT_META[plan.intent]["label_alias"]
    top_sql, top_params = _build_sql(plan)
    top_columns = list(primary_rows[0].keys()) if primary_rows else [
        label_alias,
        "mentions",
        "unique_deals",
        "revenue_at_stake",
    ]
    charts: list[dict[str, Any]] = [
        {
            "id": "top_items",
            "title": f"Top {plan.top_n} {INTENT_META[plan.intent]['title']}",
            "type": "bar_horizontal",
            "x": label_alias,
            "y": "mentions",
            "columns": top_columns,
            "rows": primary_rows,
            "sql": _render_sql_preview(top_sql, top_params),
        }
    ]

    where_global_sql, where_global_params = _build_where_filters(plan=plan, include_intent=False)
    type_mix_sql = f"""
SELECT
    COALESCE(insight_type_display, insight_type) AS insight_type,
    COUNT(*) AS mentions
FROM v_insights_dashboard
WHERE {where_global_sql}
GROUP BY COALESCE(insight_type_display, insight_type)
ORDER BY mentions DESC
LIMIT 10
"""
    type_mix_agg: dict[str, int] = defaultdict(int)
    for row in all_rows:
        label = row.get("insight_type_display") or row.get("insight_type") or "Unknown"
        type_mix_agg[str(label)] += 1
    type_mix_rows = [
        {"insight_type": key, "mentions": value}
        for key, value in sorted(type_mix_agg.items(), key=lambda item: item[1], reverse=True)[:10]
    ]
    charts.append(
        {
            "id": "insight_type_mix",
            "title": "Insight Type Mix",
            "type": "bar_vertical",
            "x": "insight_type",
            "y": "mentions",
            "columns": ["insight_type", "mentions"],
            "rows": type_mix_rows,
            "sql": _render_sql_preview(type_mix_sql, where_global_params),
        }
    )

    where_intent_sql, where_intent_params = _build_where_filters(plan=plan, include_intent=True)
    region_sql = f"""
SELECT
    COALESCE(region, 'Unknown') AS region,
    COUNT(*) AS mentions
FROM v_insights_dashboard
WHERE {where_intent_sql}
GROUP BY COALESCE(region, 'Unknown')
ORDER BY mentions DESC
LIMIT 10
"""
    region_agg: dict[str, int] = defaultdict(int)
    for row in intent_rows:
        region = row.get("region") or "Unknown"
        region_agg[str(region)] += 1
    region_rows = [
        {"region": key, "mentions": value}
        for key, value in sorted(region_agg.items(), key=lambda item: item[1], reverse=True)[:10]
    ]
    charts.append(
        {
            "id": "regional_breakdown",
            "title": "Regional Breakdown",
            "type": "bar_horizontal",
            "x": "region",
            "y": "mentions",
            "columns": ["region", "mentions"],
            "rows": region_rows,
            "sql": _render_sql_preview(region_sql, where_intent_params),
        }
    )

    trend_start = _first_day_months_ago(trend_months)
    trend_sql = f"""
SELECT
    DATE_TRUNC('month', call_date)::date AS month,
    COUNT(*) AS mentions,
    COUNT(DISTINCT deal_id) AS unique_deals
FROM v_insights_dashboard
WHERE {where_intent_sql}
  AND call_date IS NOT NULL
  AND call_date >= %s
GROUP BY DATE_TRUNC('month', call_date)::date
ORDER BY month ASC
"""
    trend_params = [*where_intent_params, trend_start.isoformat()]
    trend_agg: dict[str, dict[str, Any]] = {}
    for row in intent_rows:
        call_date = _parse_date(row.get("call_date"))
        if not call_date or call_date < trend_start:
            continue
        month_key = call_date.replace(day=1).isoformat()
        bucket = trend_agg.setdefault(month_key, {"month": month_key, "mentions": 0, "deal_ids": set()})
        bucket["mentions"] += 1
        if row.get("deal_id"):
            bucket["deal_ids"].add(row.get("deal_id"))
    trend_rows = [
        {"month": key, "mentions": value["mentions"], "unique_deals": len(value["deal_ids"])}
        for key, value in sorted(trend_agg.items(), key=lambda item: item[0])
    ]
    charts.append(
        {
            "id": "monthly_trend",
            "title": f"Monthly Trend ({trend_months} months)",
            "type": "line",
            "x": "month",
            "y": "mentions",
            "columns": ["month", "mentions", "unique_deals"],
            "rows": trend_rows,
            "sql": _render_sql_preview(trend_sql, trend_params),
        }
    )

    return charts


def _first_day_months_ago(months: int) -> date:
    months = max(1, int(months))
    today = date.today()
    current_month_index = (today.year * 12) + today.month - 1
    target_index = current_month_index - (months - 1)
    target_year = target_index // 12
    target_month = (target_index % 12) + 1
    return date(target_year, target_month, 1)


def _aggregate_top_rows(plan: QueryPlan, filtered_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    label_alias = INTENT_META[plan.intent]["label_alias"]
    buckets: dict[str, dict[str, Any]] = {}

    for row in filtered_rows:
        label = _get_label_for_intent(row=row, intent=plan.intent) or "Unknown"
        bucket = buckets.setdefault(
            str(label),
            {"mentions": 0, "deal_ids": set(), "revenue_at_stake": 0.0},
        )
        bucket["mentions"] += 1
        if row.get("deal_id"):
            bucket["deal_ids"].add(row.get("deal_id"))
        bucket["revenue_at_stake"] += _to_float(row.get("amount"))

    def sort_score(item: tuple[str, dict[str, Any]]) -> tuple[float, int]:
        _, agg = item
        metric_value = {
            "mentions": float(agg["mentions"]),
            "unique_deals": float(len(agg["deal_ids"])),
            "revenue": float(agg["revenue_at_stake"]),
        }[plan.metric]
        return metric_value, agg["mentions"]

    sorted_items = sorted(buckets.items(), key=sort_score, reverse=True)
    rows: list[dict[str, Any]] = []
    for label, agg in sorted_items[: plan.top_n]:
        rows.append(
            {
                label_alias: label,
                "mentions": int(agg["mentions"]),
                "unique_deals": int(len(agg["deal_ids"])),
                "revenue_at_stake": round(float(agg["revenue_at_stake"]), 2),
            }
        )
    return rows


def _load_rows_for_plan(plan: QueryPlan, include_intent: bool) -> list[dict[str, Any]]:
    client = _get_supabase_client()
    select_expr = ",".join(BASE_SELECT_COLUMNS)
    page_size = 1000
    offset = 0
    rows: list[dict[str, Any]] = []

    while True:
        query = client.table("v_insights_dashboard").select(select_expr).range(offset, offset + page_size - 1)
        if include_intent:
            insight_type = INTENT_TO_INSIGHT_TYPE.get(plan.intent)
            if insight_type:
                query = query.eq("insight_type", insight_type)
        if plan.filters.start_date:
            query = query.gte("call_date", plan.filters.start_date)
        if plan.filters.end_date:
            query = query.lte("call_date", plan.filters.end_date)

        response = query.execute()
        batch = response.data or []
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size

    filtered = _apply_python_filters(rows=rows, plan=plan)
    return [_json_safe(row) for row in filtered]


def _filter_rows_by_intent(rows: list[dict[str, Any]], plan: QueryPlan) -> list[dict[str, Any]]:
    intent_type = INTENT_TO_INSIGHT_TYPE.get(plan.intent)
    if not intent_type:
        return rows
    return [row for row in rows if str(row.get("insight_type") or "").lower() == intent_type]


def _apply_python_filters(rows: list[dict[str, Any]], plan: QueryPlan) -> list[dict[str, Any]]:
    normalized_filters = {
        "region": {value.strip().upper() for value in plan.filters.region if value and value.strip()},
        "country": {value.strip().upper() for value in plan.filters.country if value and value.strip()},
        "segment": {value.strip().upper() for value in plan.filters.segment if value and value.strip()},
        "deal_stage": {value.strip().upper() for value in plan.filters.deal_stage if value and value.strip()},
        "module": {value.strip().upper() for value in plan.filters.module if value and value.strip()},
    }
    start_date = _parse_date(plan.filters.start_date)
    end_date = _parse_date(plan.filters.end_date)

    filtered: list[dict[str, Any]] = []
    for row in rows:
        if normalized_filters["region"] and _norm(row.get("region")) not in normalized_filters["region"]:
            continue
        if normalized_filters["country"] and _norm(row.get("country")) not in normalized_filters["country"]:
            continue
        if normalized_filters["segment"] and _norm(row.get("segment")) not in normalized_filters["segment"]:
            continue
        if normalized_filters["deal_stage"] and _norm(row.get("deal_stage")) not in normalized_filters["deal_stage"]:
            continue
        if normalized_filters["module"] and _norm(row.get("module")) not in normalized_filters["module"]:
            continue

        call_date = _parse_date(row.get("call_date"))
        if start_date and call_date and call_date < start_date:
            continue
        if end_date and call_date and call_date > end_date:
            continue
        if (start_date or end_date) and not call_date:
            continue

        filtered.append(row)
    return filtered


def _get_supabase_client():
    if create_client is None:
        raise RuntimeError(
            "supabase client package is not installed. Install dependencies with `pip install -r requirements.txt`."
        )
    url = os.getenv("SUPABASE_URL", "").strip()
    key = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY") or "").strip()
    if not url:
        raise RuntimeError("SUPABASE_URL is missing.")
    if not key:
        raise RuntimeError("SUPABASE_KEY or SUPABASE_SERVICE_ROLE_KEY is missing.")
    return create_client(url, key)


def _get_label_for_intent(row: dict[str, Any], intent: Intent) -> str:
    if intent == "pain_points":
        return str(row.get("insight_subtype_display") or row.get("insight_subtype") or "Unknown")
    if intent == "product_gaps":
        return str(
            row.get("feature_display")
            or row.get("feature_name")
            or row.get("insight_subtype_display")
            or row.get("insight_subtype")
            or "Unknown"
        )
    if intent == "deal_friction":
        return str(row.get("insight_subtype_display") or row.get("insight_subtype") or "Unknown")
    if intent == "faq_topics":
        return str(row.get("insight_subtype_display") or row.get("insight_subtype") or "Unknown")
    if intent == "competitors":
        return str(row.get("competitor_name") or "Unknown")
    return str(row.get("insight_type_display") or row.get("insight_type") or "Unknown")


def _render_sql_preview(sql: str, params: list[Any]) -> str:
    rendered = sql
    for param in params:
        rendered = rendered.replace("%s", _to_sql_literal(param), 1)
    return rendered.strip()


def _to_sql_literal(value: Any) -> str:
    if isinstance(value, list):
        joined = ", ".join(_to_sql_literal(item) for item in value)
        return f"ARRAY[{joined}]"
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (datetime, date)):
        return f"'{value.isoformat()}'"
    text = str(value).replace("'", "''")
    return f"'{text}'"


def _build_narrative(question: str, plan: QueryPlan, rows: list[dict[str, Any]]) -> str:
    llm_summary = _build_narrative_with_llm(question=question, plan=plan, rows=rows)
    if llm_summary:
        return llm_summary
    return _build_narrative_fallback(plan=plan, rows=rows)


def _build_narrative_with_llm(question: str, plan: QueryPlan, rows: list[dict[str, Any]]) -> str | None:
    if OpenAI is None or not os.getenv("OPENAI_API_KEY"):
        return None

    model_name = os.getenv("INSIGHTS_COPILOT_SUMMARY_MODEL", os.getenv("OPENAI_MODEL", "gpt-4o-mini"))
    payload = {
        "question": question,
        "plan": plan.model_dump(),
        "rows": rows,
    }
    prompt = (
        "Write a concise business answer based only on the JSON payload. "
        "Include: 1) what was asked, 2) top findings, 3) one practical action. "
        "If rows are empty, clearly state no matching data.\n\n"
        f"{json.dumps(payload, ensure_ascii=True)}"
    )

    try:
        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        response = client.chat.completions.create(
            model=model_name,
            temperature=0.2,
            messages=[
                {"role": "system", "content": "You are a data analyst for sales insights."},
                {"role": "user", "content": prompt},
            ],
        )
        content = response.choices[0].message.content
        if not content:
            return None
        return content.strip()
    except Exception:
        return None


def _build_narrative_fallback(plan: QueryPlan, rows: list[dict[str, Any]]) -> str:
    title = INTENT_META[plan.intent]["title"]
    if not rows:
        return (
            f"No matching data found for {title} with the current filters. "
            "Try broadening region/segment/date filters."
        )

    label_col = INTENT_META[plan.intent]["label_alias"]
    top = rows[0]
    scope_parts = []
    if plan.filters.region:
        scope_parts.append(f"region={', '.join(plan.filters.region)}")
    if plan.filters.segment:
        scope_parts.append(f"segment={', '.join(plan.filters.segment)}")
    scope = f" ({'; '.join(scope_parts)})" if scope_parts else ""

    return (
        f"Top {plan.top_n} {title}{scope} ranked by {plan.metric}. "
        f"Leading item: {top.get(label_col)} "
        f"with {top.get('mentions', 0)} mentions across {top.get('unique_deals', 0)} deals."
    )


def _build_chart_spec(plan: QueryPlan, rows: list[dict[str, Any]]) -> dict[str, Any]:
    label_col = INTENT_META[plan.intent]["label_alias"]
    if not rows:
        return {
            "type": "table",
            "title": "No data",
            "x": None,
            "y": None,
        }
    return {
        "type": "bar",
        "title": f"Top {plan.top_n} {INTENT_META[plan.intent]['title']}",
        "x": label_col,
        "y": "mentions",
    }


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def _parse_date(value: Any) -> date | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def _to_float(value: Any) -> float:
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, Decimal):
        return float(value)
    text = str(value).strip()
    if not text:
        return 0.0
    try:
        return float(text)
    except ValueError:
        return 0.0


def _norm(value: Any) -> str:
    return str(value or "").strip().upper()
