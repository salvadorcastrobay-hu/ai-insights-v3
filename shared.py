"""Shared utilities for Humand Sales Insights dashboard."""

from __future__ import annotations

import os
from pathlib import Path

import streamlit as st
import yaml
from yaml.loader import SafeLoader
from supabase import create_client
import pandas as pd
from dotenv import load_dotenv

load_dotenv()


# Columns expected by dashboard pages. Keep schema stable even when query returns 0 rows.
DASHBOARD_COLUMNS = [
    "id",
    "insight_type",
    "insight_type_display",
    "insight_subtype",
    "insight_subtype_display",
    "region",
    "segment",
    "country",
    "industry",
    "deal_owner",
    "call_date",
    "module",
    "module_display",
    "hr_category_display",
    "transcript_id",
    "deal_id",
    "deal_name",
    "amount",
    "competitor_name",
    "competitor_relationship",
    "feature_display",
    "feature_name",
    "feature_is_seed",
    "pain_theme",
    "pain_scope",
    "module_status",
    "summary",
    "verbatim_quote",
    "company_name",
    "confidence",
    "gap_description",
    "gap_priority",
    "deal_stage",
    "competitor_relationship_display",
    "is_own_brand_competitor",
]

# Columns fetched from v_insights_dashboard.
# Keep this list tight to reduce payload size and first-load latency.
LOAD_DATA_COLUMNS = [
    "id",
    "transcript_id",
    "deal_id",
    "deal_name",
    "company_name",
    "region",
    "country",
    "segment",
    "industry",
    "deal_stage",
    "deal_owner",
    "call_date",
    "amount",
    "insight_type",
    "insight_subtype",
    "module",
    "summary",
    "verbatim_quote",
    "confidence",
    "competitor_name",
    "competitor_relationship",
    "feature_name",
    "gap_description",
    "gap_priority",
    "insight_type_display",
    "insight_subtype_display",
    "module_display",
    "module_status",
    "hr_category_display",
    "pain_theme",
    "pain_scope",
    "feature_display",
    "feature_is_seed",
    "competitor_relationship_display",
]
LOAD_DATA_SELECT = ",".join(LOAD_DATA_COLUMNS)

COMPETITOR_NORMALIZATION = {
    "book": "Buk",
    "buk hr": "Buk",
    "bukhr": "Buk",
}
OWN_BRAND_COMPETITOR_ALIASES = {"humand", "human"}


def normalize_competitor_name(value):
    if not isinstance(value, str):
        return value
    cleaned = " ".join(value.strip().split())
    if not cleaned:
        return None
    lowered = cleaned.lower()
    return COMPETITOR_NORMALIZATION.get(lowered, cleaned)


def is_own_brand_competitor(value) -> bool:
    if not isinstance(value, str):
        return False
    normalized = " ".join(value.strip().split()).lower()
    return normalized in OWN_BRAND_COMPETITOR_ALIASES

# ── Auth helpers ──

CONFIG_PATH = Path(__file__).parent / "config.yaml"


def load_auth_config():
    with open(CONFIG_PATH) as f:
        return yaml.load(f, Loader=SafeLoader)


def save_auth_config(config):
    with open(CONFIG_PATH, "w") as f:
        yaml.dump(config, f, default_flow_style=False)


# ── Secrets & data ──

def _get_secret(key: str) -> str:
    """Read from env vars (local) or st.secrets (Streamlit Cloud)."""
    val = os.environ.get(key)
    if val:
        return val
    try:
        return st.secrets[key]
    except (KeyError, FileNotFoundError):
        raise RuntimeError(f"Missing secret: {key}. Set it as env var or in Streamlit Cloud secrets.")


@st.cache_resource
def get_supabase():
    # Prefer service role key in trusted local envs; fallback to standard key.
    api_key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("SUPABASE_KEY")
    )
    if not api_key:
        try:
            api_key = (
                st.secrets.get("SUPABASE_SERVICE_ROLE_KEY")
                or st.secrets.get("SUPABASE_KEY")
            )
        except Exception:
            api_key = None
    if not api_key:
        raise RuntimeError(
            "Missing Supabase API key. Set SUPABASE_SERVICE_ROLE_KEY or SUPABASE_KEY."
        )
    return create_client(
        _get_secret("SUPABASE_URL"),
        api_key,
    )


def ensure_dashboard_schema(df: pd.DataFrame) -> pd.DataFrame:
    """Ensure DataFrame has required columns to prevent KeyError on empty results."""
    if df is None or df.empty:
        base_cols = list(df.columns) if isinstance(df, pd.DataFrame) else []
        return pd.DataFrame(columns=list(dict.fromkeys(base_cols + DASHBOARD_COLUMNS)))

    for col in DASHBOARD_COLUMNS:
        if col not in df.columns:
            df[col] = pd.NA
    return df


@st.cache_data(show_spinner=False, max_entries=1, persist="disk")
def load_data() -> pd.DataFrame:
    """Load insights from the dashboard view."""
    client = get_supabase()
    all_data = []
    offset = 0
    page_size = 1000
    while True:
        response = (
            client.table("v_insights_dashboard")
            .select(LOAD_DATA_SELECT)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = response.data or []
        if not rows:
            break
        all_data.extend(rows)
        if len(rows) < page_size:
            break
        offset += len(rows)

    if not all_data:
        return ensure_dashboard_schema(pd.DataFrame())

    df = pd.DataFrame(all_data)
    df = ensure_dashboard_schema(df)
    if "call_date" in df.columns:
        df["call_date"] = pd.to_datetime(df["call_date"], errors="coerce")
    if "amount" in df.columns:
        df["amount"] = pd.to_numeric(df["amount"], errors="coerce")
    if "competitor_name" in df.columns:
        df["competitor_name"] = df["competitor_name"].map(normalize_competitor_name)
        df["is_own_brand_competitor"] = df["competitor_name"].map(is_own_brand_competitor)
    return df


# ── Sidebar filters ──

def render_sidebar(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df

    # Insight type filter
    types = sorted(df["insight_type_display"].dropna().unique())
    selected_types = st.sidebar.multiselect("Tipo de Insight", types, default=types)

    # Region filter
    regions = sorted(df["region"].dropna().unique())
    selected_regions = st.sidebar.multiselect("Region", regions, default=regions)

    # Segment filter
    if "segment" in df.columns:
        segments = sorted(df["segment"].dropna().unique())
        selected_segments = st.sidebar.multiselect("Segmento", segments)
    else:
        selected_segments = []

    # Country filter
    if "country" in df.columns:
        countries = sorted(df["country"].dropna().unique())
        selected_countries = st.sidebar.multiselect("Pais", countries)
    else:
        selected_countries = []

    # Industry filter
    if "industry" in df.columns:
        industries = sorted(df["industry"].dropna().unique())
        selected_industries = st.sidebar.multiselect("Industria", industries)
    else:
        selected_industries = []

    # Deal Owner (AE) filter
    if "deal_owner" in df.columns:
        owners = sorted(df["deal_owner"].dropna().unique())
        selected_owners = st.sidebar.multiselect("Deal Owner (AE)", owners)
    else:
        selected_owners = []

    # Date range filter
    if "call_date" in df.columns:
        valid_dates = df["call_date"].dropna()
        if not valid_dates.empty:
            min_date = valid_dates.min().date()
            max_date = valid_dates.max().date()
            date_range = st.sidebar.date_input(
                "Rango de fechas",
                value=(min_date, max_date),
                min_value=min_date,
                max_value=max_date,
            )
        else:
            date_range = None
    else:
        date_range = None

    # Module filter
    modules = sorted(df["module_display"].dropna().unique())
    selected_modules = st.sidebar.multiselect("Modulo", modules)

    # HR Category filter
    categories = sorted(df["hr_category_display"].dropna().unique())
    selected_categories = st.sidebar.multiselect("Categoria HR", categories)

    # Apply filters
    mask = df["insight_type_display"].isin(selected_types) & df["region"].isin(selected_regions)
    if selected_segments:
        mask &= df["segment"].isin(selected_segments)
    if selected_countries:
        mask &= df["country"].isin(selected_countries)
    if selected_industries:
        mask &= df["industry"].isin(selected_industries)
    if selected_owners:
        mask &= df["deal_owner"].isin(selected_owners)
    if date_range and isinstance(date_range, tuple) and len(date_range) == 2:
        start, end = date_range
        mask &= (df["call_date"].dt.date >= start) & (df["call_date"].dt.date <= end)
    if selected_modules:
        mask &= df["module_display"].isin(selected_modules)
    if selected_categories:
        mask &= df["hr_category_display"].isin(selected_categories)

    return df[mask]


# ── Formatting helpers ──

def format_currency(value: float) -> str:
    if value >= 1_000_000:
        return f"${value / 1_000_000:,.1f}M"
    if value >= 1_000:
        return f"${value / 1_000:,.0f}K"
    return f"${value:,.0f}"


def safe_nunique(series: pd.Series) -> int:
    return series.dropna().nunique()


# ── Display-name mapping ──

DISPLAY_NAMES = {
    "must_have": "Debe tener",
    "nice_to_have": "Deseable",
    "dealbreaker": "Dealbreaker",
    "general": "General",
    "module_linked": "Vinculado a Módulo",
    "existing": "Existente",
    "missing": "Faltante",
    "technology": "Tecnología",
    "processes": "Procesos",
    "communication": "Comunicación",
    "talent": "Talento",
    "engagement": "Engagement",
    "data": "Datos",
    "compliance": "Compliance",
    "compensation": "Compensación",
    "operations": "Operaciones",
}


def humanize(value):
    """Return a human-readable Spanish label for a raw enum/code value."""
    if not isinstance(value, str):
        return value
    return DISPLAY_NAMES.get(value, value.replace("_", " ").title())


_TOOLTIP_QUEUE_KEY = "__viz_tooltip_queue"
_ORIGINAL_PLOTLY_CHART = st.plotly_chart
_ORIGINAL_DATAFRAME = st.dataframe


def _queue_viz_tooltip(text: str) -> None:
    queue = list(st.session_state.get(_TOOLTIP_QUEUE_KEY, []))
    queue.append(text)
    st.session_state[_TOOLTIP_QUEUE_KEY] = queue


def _pop_viz_tooltip() -> str | None:
    queue = list(st.session_state.get(_TOOLTIP_QUEUE_KEY, []))
    if not queue:
        return None
    text = queue.pop(0)
    st.session_state[_TOOLTIP_QUEUE_KEY] = queue
    return text


def _render_viz_tooltip_if_any() -> None:
    tooltip_text = _pop_viz_tooltip()
    if tooltip_text:
        st.caption("ⓘ Info de esta visualización", help=tooltip_text, width="content")


def _plotly_chart_with_tooltip(*args, **kwargs):
    result = _ORIGINAL_PLOTLY_CHART(*args, **kwargs)
    _render_viz_tooltip_if_any()
    return result


def _dataframe_with_tooltip(*args, **kwargs):
    result = _ORIGINAL_DATAFRAME(*args, **kwargs)
    _render_viz_tooltip_if_any()
    return result


if getattr(st, "_humand_tooltip_wrapped", False) is False:
    st.plotly_chart = _plotly_chart_with_tooltip
    st.dataframe = _dataframe_with_tooltip
    st._humand_tooltip_wrapped = True


def chart_tooltip(what_shows: str, how_to_read: str | None = None) -> None:
    """Queue one compact hover tooltip to be rendered below the next chart/table."""
    tooltip_text = what_shows.strip()
    if how_to_read:
        tooltip_text += f" {how_to_read.strip()}"
    _queue_viz_tooltip(tooltip_text)
