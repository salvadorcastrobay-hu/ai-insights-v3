from __future__ import annotations

from datetime import datetime
from pathlib import Path
import json
import uuid

import pandas as pd
import plotly.express as px
import streamlit as st
try:
    from shared import chart_tooltip
except ImportError:
    def chart_tooltip(*_args, **_kwargs):
        return None


STORE_PATH = Path(__file__).resolve().parent.parent / "custom_dashboards.json"
AGG_CHARTS = {"bar", "line", "area", "pie"}
CHART_TYPES = {
    "bar": "Barras",
    "line": "Líneas",
    "area": "Área",
    "pie": "Torta",
    "scatter": "Dispersión",
    "histogram": "Histograma",
}
AGGREGATIONS = {
    "count": "Conteo de insights",
    "sum": "Suma",
    "mean": "Promedio",
    "median": "Mediana",
    "distinct_count": "Conteo distinto",
}
SOURCE_MODES = {
    "filtered": "Filtrado",
    "all": "Todo",
}
SOURCE_MODE_ALIASES = {
    "filtered": "filtered",
    "filtrado": "filtered",
    "all": "all",
    "todo": "all",
    "completo": "all",
}
SAVE_TARGETS = {
    "new": "Crear dashboard nuevo",
    "existing": "Agregar a dashboard existente",
}
FIELD_LABELS = {
    "insight_type_display": "Tipo de insight",
    "insight_subtype_display": "Subtipo de insight",
    "pain_theme": "Tema de pain",
    "region": "Región",
    "country": "País",
    "segment": "Segmento",
    "deal_owner": "Deal owner (AE)",
    "module_display": "Módulo",
    "module_status": "Estado del módulo",
    "hr_category_display": "Categoría HR",
    "competitor_name": "Competidor",
    "competitor_relationship_display": "Relación competitiva",
    "feature_display": "Feature",
    "gap_priority": "Prioridad del gap",
    "deal_stage": "Etapa del deal",
    "company_name": "Empresa",
    "deal_id": "Deal ID",
    "transcript_id": "Transcript ID",
    "call_date": "Fecha de llamada",
    "amount": "Revenue",
    "confidence": "Confianza",
}
X_AGG_FIELDS = [
    "insight_type_display",
    "insight_subtype_display",
    "pain_theme",
    "region",
    "country",
    "segment",
    "deal_owner",
    "module_display",
    "module_status",
    "hr_category_display",
    "competitor_name",
    "competitor_relationship_display",
    "feature_display",
    "gap_priority",
    "deal_stage",
    "call_date",
]
X_SCATTER_FIELDS = [
    "amount",
    "confidence",
    "call_date",
]
X_HISTOGRAM_FIELDS = [
    "amount",
    "confidence",
]
Y_NUMERIC_FIELDS = [
    "amount",
    "confidence",
]
Y_DISTINCT_FIELDS = [
    "deal_id",
    "transcript_id",
    "company_name",
    "competitor_name",
    "deal_owner",
    "country",
    "region",
    "segment",
    "module_display",
    "feature_display",
    "insight_subtype_display",
    "insight_type_display",
]
COLOR_FIELDS = [
    "insight_type_display",
    "insight_subtype_display",
    "region",
    "country",
    "segment",
    "deal_owner",
    "module_display",
    "module_status",
    "hr_category_display",
    "competitor_name",
    "competitor_relationship_display",
    "gap_priority",
    "deal_stage",
    "pain_theme",
]
QUICK_TEMPLATES = [
    {
        "id": "top_pains",
        "title": "Top pains reportados",
        "description": "Qué pain themes aparecen más para priorizar decisiones de producto.",
        "required": ["pain_theme"],
        "chart_type": "bar",
        "x_col": "pain_theme",
        "y_col": None,
        "aggregation": "count",
        "top_n": 10,
        "sort_desc": True,
        "default_dashboard": "Prioridades de producto",
        "recommended_colors": ["region", "segment", "deal_stage"],
    },
    {
        "id": "insights_by_type",
        "title": "Insights por tipo",
        "description": "Distribución de los hallazgos principales por tipo de insight.",
        "required": ["insight_type_display"],
        "chart_type": "bar",
        "x_col": "insight_type_display",
        "y_col": None,
        "aggregation": "count",
        "top_n": 10,
        "sort_desc": True,
        "default_dashboard": "Vista ejecutiva semanal",
        "recommended_colors": ["region", "segment"],
    },
    {
        "id": "competitors_frequency",
        "title": "Competidores más mencionados",
        "description": "Identifica los competidores con mayor presencia en conversaciones.",
        "required": ["competitor_name"],
        "chart_type": "bar",
        "x_col": "competitor_name",
        "y_col": None,
        "aggregation": "count",
        "top_n": 12,
        "sort_desc": True,
        "default_dashboard": "Pulso competitivo",
        "recommended_colors": ["region", "segment", "deal_stage"],
    },
    {
        "id": "module_status_mix",
        "title": "Estado de módulos",
        "description": "Mix de estados de módulos para monitorear salud del producto.",
        "required": ["module_status"],
        "chart_type": "pie",
        "x_col": "module_status",
        "y_col": None,
        "aggregation": "count",
        "top_n": 8,
        "sort_desc": True,
        "default_dashboard": "Salud de producto",
        "recommended_colors": [],
    },
    {
        "id": "revenue_by_stage",
        "title": "Revenue por etapa del deal",
        "description": "Dónde se concentra el revenue en el pipeline comercial.",
        "required": ["deal_stage", "amount"],
        "chart_type": "bar",
        "x_col": "deal_stage",
        "y_col": "amount",
        "aggregation": "sum",
        "top_n": 10,
        "sort_desc": True,
        "default_dashboard": "Pipeline y revenue",
        "recommended_colors": ["region", "segment", "deal_owner"],
    },
    {
        "id": "confidence_by_owner",
        "title": "Confianza promedio por AE",
        "description": "Compara calidad relativa de insights por deal owner.",
        "required": ["deal_owner", "confidence"],
        "chart_type": "bar",
        "x_col": "deal_owner",
        "y_col": "confidence",
        "aggregation": "mean",
        "top_n": 12,
        "sort_desc": True,
        "default_dashboard": "Calidad de insights",
        "recommended_colors": ["segment", "region"],
    },
]


def _owner() -> str:
    return (
        st.session_state.get("username")
        or st.session_state.get("name")
        or "anonymous"
    )


def _normalize_source_mode(source_mode: str | None) -> str:
    if not source_mode:
        return "filtered"
    key = str(source_mode).strip().lower()
    if key in SOURCE_MODE_ALIASES:
        return SOURCE_MODE_ALIASES[key]
    if key == "filtered":
        return "filtered"
    return "all"


def _source_mode_label(source_mode: str | None) -> str:
    mode = _normalize_source_mode(source_mode)
    return SOURCE_MODES.get(mode, "Filtrado")


def _field_label(column: str | None) -> str:
    if not column:
        return "-"
    return FIELD_LABELS.get(column, column.replace("_", " ").title())


def _chart_type_label(chart_type: str | None) -> str:
    if not chart_type:
        return "-"
    return CHART_TYPES.get(chart_type, chart_type)


def _aggregation_label(aggregation: str | None) -> str:
    if not aggregation:
        return "-"
    return AGGREGATIONS.get(aggregation, aggregation)


def _resolve_columns(df: pd.DataFrame, candidates: list[str]) -> list[str]:
    return [col for col in candidates if col in df.columns]


def _get_df(source_mode: str) -> pd.DataFrame:
    mode = _normalize_source_mode(source_mode)
    if mode == "filtered":
        df = st.session_state.get("filtered_df")
    else:
        df = st.session_state.get("df")
    if df is None:
        return pd.DataFrame()
    out = df.copy()
    if "call_date" in out.columns:
        out["call_date"] = pd.to_datetime(out["call_date"], errors="coerce")
    return out


def _load_store() -> dict:
    if not STORE_PATH.exists():
        return {"version": 1, "dashboards": []}
    try:
        with open(STORE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {"version": 1, "dashboards": []}
        data.setdefault("version", 1)
        data.setdefault("dashboards", [])
        return data
    except Exception:
        return {"version": 1, "dashboards": []}


def _save_store(data: dict) -> tuple[bool, str]:
    try:
        with open(STORE_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=True, indent=2)
        return True, ""
    except OSError as e:
        return False, str(e)


def _get_owner_dashboards(data: dict, owner: str) -> list[dict]:
    return [d for d in data.get("dashboards", []) if d.get("owner") == owner]


def _get_column_options(df: pd.DataFrame) -> dict[str, list[str]]:
    return {
        "x_agg": _resolve_columns(df, X_AGG_FIELDS),
        "x_scatter": _resolve_columns(df, X_SCATTER_FIELDS),
        "x_histogram": _resolve_columns(df, X_HISTOGRAM_FIELDS),
        "y_numeric": _resolve_columns(df, Y_NUMERIC_FIELDS),
        "y_distinct": _resolve_columns(df, Y_DISTINCT_FIELDS),
        "color": _resolve_columns(df, COLOR_FIELDS),
    }


def _axis_labels(*columns: str | None) -> dict[str, str]:
    labels = {"value": "Valor"}
    for col in columns:
        if col:
            labels[col] = _field_label(col)
    return labels


def _safe_dimension_value(value: object) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return "(Sin dato)"
    text = str(value).strip()
    return text or "(Sin dato)"


def _format_value(value: object) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return "-"
    if isinstance(value, (pd.Timestamp, datetime)):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, (int, float)):
        if isinstance(value, float) and pd.isna(value):
            return "-"
        if float(value).is_integer():
            return f"{int(value):,}"
        return f"{value:,.2f}"
    return str(value)


def _series_range_label(series: pd.Series) -> str:
    clean = series.dropna()
    if clean.empty:
        return "sin datos"
    low = clean.min()
    high = clean.max()
    return f"{_format_value(low)} a {_format_value(high)}"


def _available_quick_templates(df: pd.DataFrame) -> list[dict]:
    present_cols = set(df.columns)
    available = []
    for template in QUICK_TEMPLATES:
        required = set(template.get("required", []))
        if required.issubset(present_cols):
            available.append(template)
    return available


def _suggest_chart_name(
    chart_type: str,
    x_col: str | None,
    y_col: str | None = None,
    aggregation: str | None = None,
) -> str:
    x_label = _field_label(x_col)
    if chart_type in AGG_CHARTS:
        agg_label = _aggregation_label(aggregation or "count")
        return f"{agg_label} por {x_label}"
    if chart_type == "scatter":
        return f"{_field_label(y_col)} vs {x_label}"
    if chart_type == "histogram":
        return f"Distribución de {x_label}"
    return _chart_type_label(chart_type)


def _render_save_destination(
    dashboard_names: list[str],
    key_prefix: str,
    suggested_dashboard_name: str,
) -> str:
    target_options = ["new", "existing"] if dashboard_names else ["new"]
    c1, c2 = st.columns([1.1, 1.2])
    with c1:
        target_mode = st.selectbox(
            "Destino de guardado",
            target_options,
            key=f"{key_prefix}_target_mode",
            format_func=lambda mode: SAVE_TARGETS[mode],
            help="Creá un dashboard nuevo o agregá este gráfico a uno existente.",
        )
    with c2:
        if target_mode == "existing" and dashboard_names:
            dashboard_name = st.selectbox(
                "Dashboard",
                dashboard_names,
                key=f"{key_prefix}_dashboard_existing",
                help="Dashboard existente donde se va a guardar este gráfico.",
            )
        else:
            dashboard_name = st.text_input(
                "Nombre del dashboard",
                value="",
                key=f"{key_prefix}_dashboard_new",
                placeholder=f"Ej: {suggested_dashboard_name}",
                help="Nombre del dashboard que va a contener este gráfico.",
            )
            if not dashboard_name.strip():
                dashboard_name = suggested_dashboard_name
    return dashboard_name


def _apply_optional_filters(df: pd.DataFrame, spec: dict) -> pd.DataFrame:
    out = df.copy()
    region_filter = spec.get("region_filter") or []
    country_filter = spec.get("country_filter") or []

    if region_filter and "region" in out.columns:
        out = out[out["region"].isin(region_filter)]
    if country_filter and "country" in out.columns:
        out = out[out["country"].isin(country_filter)]
    return out


def _filter_summary(spec: dict) -> str:
    region_filter = spec.get("region_filter") or []
    country_filter = spec.get("country_filter") or []
    parts = []
    if region_filter:
        parts.append(f"Región ({len(region_filter)})")
    if country_filter:
        parts.append(f"País ({len(country_filter)})")
    if not parts:
        return "Sin filtros locales"
    return " | ".join(parts)


def _render_takeaways(spec: dict, chart_data: pd.DataFrame) -> None:
    if chart_data.empty:
        return

    chart_type = spec.get("chart_type")
    x_col = spec.get("x_col")
    y_col = spec.get("y_col")

    st.markdown("**Lo más relevante**")

    if chart_type in AGG_CHARTS and "value" in chart_data.columns and x_col in chart_data.columns:
        ranking = (
            chart_data.groupby(x_col, dropna=False)["value"]
            .sum()
            .sort_values(ascending=False)
            .head(3)
        )
        total = chart_data["value"].sum()
        for key, value in ranking.items():
            share = (value / total) * 100 if total else 0
            st.write(f"- **{_safe_dimension_value(key)}**: {_format_value(value)} ({share:.1f}% del total)")
        st.caption(f"Total agregado: {_format_value(total)}")
        return

    if chart_type == "scatter" and x_col in chart_data.columns and y_col in chart_data.columns:
        st.write(f"- Registros en vista previa: {_format_value(len(chart_data))}.")
        st.write(f"- Rango de {_field_label(x_col)}: {_series_range_label(chart_data[x_col])}.")
        st.write(f"- Rango de {_field_label(y_col)}: {_series_range_label(chart_data[y_col])}.")
        return

    if chart_type == "histogram" and x_col in chart_data.columns:
        st.write(f"- Registros en vista previa: {_format_value(len(chart_data))}.")
        st.write(f"- Rango de {_field_label(x_col)}: {_series_range_label(chart_data[x_col])}.")


def _render_chart_block(
    spec: dict,
    fig: object | None,
    chart_data: pd.DataFrame,
    data_label: str,
    chart_key: str,
) -> None:
    if fig is None:
        st.info("No se pudo construir el gráfico con la configuración actual. Ajustá las opciones.")
        return
    fig.update_layout(margin=dict(l=10, r=10, t=40, b=10))
    what_shows, how_to_read = _chart_intent(spec)
    chart_tooltip(what_shows, how_to_read)
    st.plotly_chart(fig, width="stretch", key=f"{chart_key}_plot")
    _render_takeaways(spec, chart_data)
    with st.expander(data_label):
        st.dataframe(chart_data.head(200), width="stretch", hide_index=True, height=300)


def _render_region_country_filters(
    df: pd.DataFrame,
    key_prefix: str,
) -> tuple[list[str], list[str]]:
    regions = sorted(df["region"].dropna().unique()) if "region" in df.columns else []
    countries = sorted(df["country"].dropna().unique()) if "country" in df.columns else []
    f1, f2 = st.columns(2)
    with f1:
        selected_regions = st.multiselect(
            "Regiones (opcional)",
            options=regions,
            key=f"{key_prefix}_regions",
            help="Si dejás vacío, incluye todas las regiones.",
        )
    with f2:
        selected_countries = st.multiselect(
            "Países (opcional)",
            options=countries,
            key=f"{key_prefix}_countries",
            help="Si dejás vacío, incluye todos los países.",
        )
    return selected_regions, selected_countries


def _chart_intent(spec: dict) -> tuple[str, str]:
    chart_type = spec.get("chart_type")
    x_col = spec.get("x_col")
    y_col = spec.get("y_col")
    color_col = spec.get("color_col")
    aggregation = spec.get("aggregation", "count")

    x_label = _field_label(x_col)
    y_label = _field_label(y_col)
    color_label = _field_label(color_col) if color_col else "(sin segmentación adicional)"
    chart_label = _chart_type_label(chart_type)

    if chart_type in AGG_CHARTS:
        agg_label = _aggregation_label(aggregation)
        what_shows = (
            f"Gráfico de {chart_label.lower()} para ver **{agg_label.lower()}** por **{x_label}**."
        )
        how_to_read = (
            f"Compará valores entre categorías de {x_label}; color por: {color_label}."
        )
        return what_shows, how_to_read

    if chart_type == "scatter":
        what_shows = (
            f"Gráfico de dispersión para comparar **{y_label}** contra **{x_label}**."
        )
        how_to_read = (
            f"Cada punto representa un registro; color por: {color_label}."
        )
        return what_shows, how_to_read

    if chart_type == "histogram":
        what_shows = (
            f"Histograma para ver la distribución de **{x_label}**."
        )
        how_to_read = (
            f"Muestra concentración y dispersión de valores; color por: {color_label}."
        )
        return what_shows, how_to_read

    return "Visualización del conjunto de datos seleccionado.", "Revisá ejes y filtros para interpretar el contexto."


def _build_agg_frame(
    df: pd.DataFrame,
    x_col: str,
    y_col: str | None,
    color_col: str | None,
    aggregation: str,
) -> pd.DataFrame:
    group_cols = [x_col]
    if color_col:
        group_cols.append(color_col)

    work = df.copy()
    if x_col not in work.columns:
        return pd.DataFrame()

    if aggregation == "count":
        result = work.groupby(group_cols, dropna=False).size().reset_index(name="value")
        return result

    if not y_col or y_col not in work.columns:
        return pd.DataFrame()

    if aggregation == "sum":
        result = (
            work.groupby(group_cols, dropna=False)[y_col]
            .sum(min_count=1)
            .reset_index(name="value")
        )
    elif aggregation == "mean":
        result = (
            work.groupby(group_cols, dropna=False)[y_col]
            .mean()
            .reset_index(name="value")
        )
    elif aggregation == "median":
        result = (
            work.groupby(group_cols, dropna=False)[y_col]
            .median()
            .reset_index(name="value")
        )
    elif aggregation == "distinct_count":
        result = (
            work.groupby(group_cols, dropna=False)[y_col]
            .nunique(dropna=True)
            .reset_index(name="value")
        )
    else:
        return pd.DataFrame()

    return result


def _build_figure(df: pd.DataFrame, spec: dict) -> tuple[object | None, pd.DataFrame]:
    chart_type = spec.get("chart_type")
    x_col = spec.get("x_col")
    y_col = spec.get("y_col")
    color_col = spec.get("color_col")
    aggregation = spec.get("aggregation", "count")
    top_n = int(spec.get("top_n", 12) or 12)
    sort_desc = bool(spec.get("sort_desc", True))

    if chart_type in AGG_CHARTS:
        agg_df = _build_agg_frame(df=df, x_col=x_col, y_col=y_col, color_col=color_col, aggregation=aggregation)
        if agg_df.empty:
            return None, agg_df

        if chart_type in {"bar", "pie"}:
            if "value" in agg_df.columns:
                agg_df = agg_df.sort_values("value", ascending=not sort_desc).head(top_n)

        labels = _axis_labels(x_col, y_col, color_col)
        if chart_type == "bar":
            fig = px.bar(
                agg_df,
                x=x_col,
                y="value",
                color=color_col if color_col else None,
                labels=labels,
            )
        elif chart_type == "line":
            fig = px.line(
                agg_df,
                x=x_col,
                y="value",
                color=color_col if color_col else None,
                labels=labels,
            )
        elif chart_type == "area":
            fig = px.area(
                agg_df,
                x=x_col,
                y="value",
                color=color_col if color_col else None,
                labels=labels,
            )
        else:  # pie
            pie_df = agg_df.groupby(x_col, dropna=False)["value"].sum().reset_index()
            pie_df = pie_df.sort_values("value", ascending=False).head(top_n)
            fig = px.pie(pie_df, names=x_col, values="value", labels=labels)
        return fig, agg_df

    if chart_type == "scatter":
        if not x_col or not y_col or x_col not in df.columns or y_col not in df.columns:
            return None, pd.DataFrame()
        cols = [x_col, y_col] + ([color_col] if color_col else [])
        plot_df = df[cols].dropna(subset=[x_col, y_col]).head(5000)
        if plot_df.empty:
            return None, plot_df
        fig = px.scatter(
            plot_df,
            x=x_col,
            y=y_col,
            color=color_col if color_col else None,
            labels=_axis_labels(x_col, y_col, color_col),
        )
        return fig, plot_df

    if chart_type == "histogram":
        if not x_col or x_col not in df.columns:
            return None, pd.DataFrame()
        cols = [x_col] + ([color_col] if color_col else [])
        plot_df = df[cols].dropna(subset=[x_col]).head(5000)
        if plot_df.empty:
            return None, plot_df
        fig = px.histogram(
            plot_df,
            x=x_col,
            color=color_col if color_col else None,
            labels=_axis_labels(x_col, color_col),
        )
        return fig, plot_df

    return None, pd.DataFrame()


def _new_chart_spec(
    chart_name: str,
    source_mode: str,
    chart_type: str,
    x_col: str,
    y_col: str | None,
    color_col: str | None,
    aggregation: str,
    top_n: int,
    sort_desc: bool,
    region_filter: list[str] | None = None,
    country_filter: list[str] | None = None,
) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "name": chart_name.strip(),
        "source_mode": source_mode,
        "chart_type": chart_type,
        "x_col": x_col,
        "y_col": y_col if y_col else None,
        "color_col": color_col if color_col else None,
        "aggregation": aggregation,
        "top_n": int(top_n),
        "sort_desc": bool(sort_desc),
        "region_filter": list(region_filter or []),
        "country_filter": list(country_filter or []),
        "created_at": datetime.utcnow().isoformat() + "Z",
    }


def _save_chart_to_dashboard(owner: str, dashboard_name: str, chart_spec: dict) -> tuple[bool, str]:
    if not dashboard_name.strip():
        return False, "El nombre del dashboard es obligatorio."
    data = _load_store()
    dashboards = data.setdefault("dashboards", [])

    dashboard = None
    for d in dashboards:
        if d.get("owner") == owner and d.get("name", "").strip().lower() == dashboard_name.strip().lower():
            dashboard = d
            break

    if dashboard is None:
        dashboard = {
            "id": str(uuid.uuid4()),
            "owner": owner,
            "name": dashboard_name.strip(),
            "created_at": datetime.utcnow().isoformat() + "Z",
            "charts": [],
        }
        dashboards.append(dashboard)

    dashboard.setdefault("charts", []).append(chart_spec)
    return _save_store(data)


def _delete_chart(owner: str, dashboard_id: str, chart_id: str) -> tuple[bool, str]:
    data = _load_store()
    for dashboard in data.get("dashboards", []):
        if dashboard.get("id") == dashboard_id and dashboard.get("owner") == owner:
            charts = dashboard.get("charts", [])
            dashboard["charts"] = [c for c in charts if c.get("id") != chart_id]
            return _save_store(data)
    return False, "No se encontró el dashboard o gráfico."


def _delete_dashboard(owner: str, dashboard_id: str) -> tuple[bool, str]:
    data = _load_store()
    before = len(data.get("dashboards", []))
    data["dashboards"] = [
        d for d in data.get("dashboards", [])
        if not (d.get("id") == dashboard_id and d.get("owner") == owner)
    ]
    if len(data["dashboards"]) == before:
        return False, "No se encontró el dashboard."
    return _save_store(data)


st.header("Dashboards Personalizados")
st.caption("Creá gráficos útiles rápido o con control avanzado, y guardalos para reutilizarlos.")

owner = _owner()
builder_store = _load_store()
builder_dashboards = _get_owner_dashboards(builder_store, owner)
builder_dashboard_names = sorted([d.get("name", "Sin título") for d in builder_dashboards])
tabs = st.tabs(["Generador guiado", "Editor avanzado", "Mis dashboards personalizados"])

with tabs[0]:
    st.caption("Elegí una pregunta de negocio y obtené un gráfico útil en pocos pasos.")
    source_mode = st.radio(
        "Fuente de datos",
        list(SOURCE_MODES.keys()),
        key="guided_source_mode",
        format_func=lambda mode: SOURCE_MODES[mode],
        horizontal=True,
        help="Filtrado usa los filtros actuales del sidebar. Todo usa el dataset completo.",
    )
    data_df = _get_df(source_mode)

    if data_df.empty:
        st.warning("No hay datos disponibles en esta fuente.")
    else:
        available_templates = _available_quick_templates(data_df)
        if not available_templates:
            st.warning("No hay plantillas guiadas compatibles con las columnas disponibles.")
        else:
            template_map = {item["id"]: item for item in available_templates}
            selected_template_id = st.selectbox(
                "Pregunta de negocio",
                options=list(template_map.keys()),
                key="guided_template_id",
                format_func=lambda t_id: template_map[t_id]["title"],
            )
            selected_template = template_map[selected_template_id]
            st.info(selected_template["description"])

            c1, c2, c3 = st.columns([1.1, 1, 1.2])
            color_candidates = _resolve_columns(data_df, selected_template.get("recommended_colors", []))
            with c1:
                color_col = st.selectbox(
                    "Segmentar por (opcional)",
                    [None] + color_candidates,
                    key="guided_color_col",
                    format_func=lambda col: "(sin color)" if col is None else _field_label(col),
                )
            with c2:
                top_n = st.slider(
                    "Top N",
                    min_value=3,
                    max_value=50,
                    value=int(selected_template.get("top_n", 10)),
                    step=1,
                    key="guided_top_n",
                )
            with c3:
                suggested_name = _suggest_chart_name(
                    chart_type=selected_template["chart_type"],
                    x_col=selected_template["x_col"],
                    y_col=selected_template.get("y_col"),
                    aggregation=selected_template.get("aggregation"),
                )
                chart_name = st.text_input(
                    "Nombre del gráfico",
                    value="",
                    key="guided_chart_name",
                    placeholder=f"Ej: {selected_template.get('title') or suggested_name}",
                    help="Podés editar este nombre antes de guardar.",
                )

            st.caption("Filtros opcionales del gráfico")
            selected_regions, selected_countries = _render_region_country_filters(data_df, key_prefix="guided")

            dashboard_name = _render_save_destination(
                dashboard_names=builder_dashboard_names,
                key_prefix="guided",
                suggested_dashboard_name=selected_template.get("default_dashboard", "Mi dashboard"),
            )

            spec = _new_chart_spec(
                chart_name=chart_name or suggested_name,
                source_mode=_normalize_source_mode(source_mode),
                chart_type=selected_template["chart_type"],
                x_col=selected_template["x_col"],
                y_col=selected_template.get("y_col"),
                color_col=color_col,
                aggregation=selected_template.get("aggregation", "count"),
                top_n=top_n,
                sort_desc=bool(selected_template.get("sort_desc", True)),
                region_filter=selected_regions,
                country_filter=selected_countries,
            )

            filtered_data_df = _apply_optional_filters(data_df, spec)
            fig = None
            preview_df = pd.DataFrame()
            st.subheader("Vista previa")
            if filtered_data_df.empty:
                st.info("No hay datos para los filtros de región/país seleccionados.")
            else:
                fig, preview_df = _build_figure(filtered_data_df, spec)
                _render_chart_block(
                    spec,
                    fig,
                    preview_df,
                    data_label="Datos de vista previa",
                    chart_key="guided_preview",
                )

            save_disabled = fig is None or not dashboard_name.strip()
            if st.button("Guardar gráfico guiado", width="stretch", key="guided_save", disabled=save_disabled):
                ok, err = _save_chart_to_dashboard(
                    owner=owner,
                    dashboard_name=dashboard_name,
                    chart_spec=spec,
                )
                if ok:
                    st.success(f"Gráfico guardado en '{dashboard_name}'.")
                else:
                    st.error(f"No se pudo guardar el gráfico: {err}")
            st.caption("Los gráficos guardados aparecen en la pestaña de dashboards personalizados.")

with tabs[1]:
    st.caption("Editor manual con control total sobre tipo de gráfico, ejes y agregaciones.")
    source_mode = st.radio(
        "Fuente de datos",
        list(SOURCE_MODES.keys()),
        key="advanced_source_mode",
        format_func=lambda mode: SOURCE_MODES[mode],
        horizontal=True,
        help="Filtrado usa los filtros actuales del sidebar. Todo usa el dataset completo.",
    )
    data_df = _get_df(source_mode)

    if data_df.empty:
        st.warning("No hay datos disponibles en esta fuente.")
    else:
        column_options = _get_column_options(data_df)
        if not any(column_options.values()):
            st.warning("No hay columnas relevantes disponibles para armar gráficos.")
        else:
            dashboard_name = _render_save_destination(
                dashboard_names=builder_dashboard_names,
                key_prefix="advanced",
                suggested_dashboard_name="Mi dashboard",
            )
            chart_name = st.text_input(
                "Nombre del gráfico",
                key="advanced_chart_name",
                placeholder="Ej: Top pains por región",
                help="Título visible del gráfico dentro del dashboard.",
            )

            st.caption("Filtros opcionales del gráfico")
            selected_regions, selected_countries = _render_region_country_filters(data_df, key_prefix="advanced")

            chart_col, x_col_container, color_col_container = st.columns(3)
            with chart_col:
                chart_type = st.selectbox(
                    "Tipo de gráfico",
                    list(CHART_TYPES.keys()),
                    key="advanced_chart_type",
                    index=0,
                    format_func=lambda ct: CHART_TYPES[ct],
                    help="Barras/Líneas/Área/Torta muestran agregados; Dispersión/Histograma muestran datos más crudos.",
                )

            if chart_type in AGG_CHARTS:
                x_options = column_options["x_agg"]
                x_help = "Campo principal para agrupar en el eje X o categorías de torta."
            elif chart_type == "scatter":
                x_options = column_options["x_scatter"]
                x_help = "Eje X para dispersión. Usá variables numéricas (o fecha) para comparar contra Y."
            else:
                x_options = column_options["x_histogram"]
                x_help = "Variable numérica sobre la que querés ver la distribución."

            if not x_options:
                st.warning("No hay columnas relevantes para este tipo de gráfico.")
            else:
                with x_col_container:
                    x_col = st.selectbox(
                        "Eje X",
                        x_options,
                        key="advanced_x_col",
                        format_func=_field_label,
                        help=x_help,
                    )
                with color_col_container:
                    color_col = st.selectbox(
                        "Color por (opcional)",
                        [None] + column_options["color"],
                        key="advanced_color_col",
                        format_func=lambda col: "(sin color)" if col is None else _field_label(col),
                        help="Segmenta el gráfico por una dimensión adicional para comparar cortes (ej: región o tipo de insight).",
                    )

                aggregation = "count"
                y_col = None
                top_n = 12
                sort_desc = True

                if chart_type in AGG_CHARTS:
                    c6, c7, c8, c9 = st.columns(4)
                    with c6:
                        aggregation = st.selectbox(
                            "Agregación",
                            list(AGGREGATIONS.keys()),
                            key="advanced_aggregation",
                            index=0,
                            format_func=_aggregation_label,
                            help="Define cómo calcular el valor: conteo, suma, promedio, mediana o conteo distinto.",
                        )
                    with c7:
                        if aggregation == "count":
                            y_col = None
                            st.text_input(
                                "Columna Y",
                                value="(no aplica para conteo)",
                                key="advanced_y_disabled",
                                disabled=True,
                                help="En conteo solo se usan X y opcionalmente Color por.",
                            )
                        elif aggregation in {"sum", "mean", "median"}:
                            numeric_y_options = column_options["y_numeric"]
                            if numeric_y_options:
                                y_col = st.selectbox(
                                    "Columna Y",
                                    numeric_y_options,
                                    key="advanced_y_numeric",
                                    format_func=_field_label,
                                    help="Métrica numérica a agregar en Y.",
                                )
                            else:
                                st.warning("No hay columnas numéricas relevantes para esta agregación.")
                                y_col = None
                        else:
                            distinct_options = column_options["y_distinct"]
                            if distinct_options:
                                y_col = st.selectbox(
                                    "Columna Y",
                                    distinct_options,
                                    key="advanced_y_distinct",
                                    format_func=_field_label,
                                    help="Campo sobre el cual contar valores únicos dentro de cada grupo.",
                                )
                            else:
                                st.warning("No hay columnas relevantes para conteo distinto.")
                                y_col = None
                    with c8:
                        top_n = st.slider(
                            "Top N",
                            min_value=3,
                            max_value=50,
                            value=12,
                            step=1,
                            key="advanced_top_n",
                            help="Para rankings, limita la vista a las N categorías más relevantes.",
                        )
                    with c9:
                        sort_desc = st.checkbox(
                            "Ordenar de mayor a menor",
                            value=True,
                            key="advanced_sort_desc",
                            help="Si está activo, primero aparecen los valores más altos.",
                        )
                elif chart_type == "scatter":
                    numeric_y_options = column_options["y_numeric"]
                    if numeric_y_options:
                        y_col = st.selectbox(
                            "Eje Y",
                            numeric_y_options,
                            key="advanced_scatter_y",
                            format_func=_field_label,
                            help="Métrica numérica para el eje vertical.",
                        )
                    else:
                        st.warning("No hay columnas numéricas relevantes para el eje Y.")
                        y_col = None

                default_chart_name = _suggest_chart_name(
                    chart_type=chart_type,
                    x_col=x_col,
                    y_col=y_col,
                    aggregation=aggregation,
                )
                spec = _new_chart_spec(
                    chart_name=chart_name or default_chart_name,
                    source_mode=_normalize_source_mode(source_mode),
                    chart_type=chart_type,
                    x_col=x_col,
                    y_col=y_col,
                    color_col=color_col,
                    aggregation=aggregation,
                    top_n=top_n,
                    sort_desc=sort_desc,
                    region_filter=selected_regions,
                    country_filter=selected_countries,
                )

                filtered_data_df = _apply_optional_filters(data_df, spec)
                fig = None
                preview_df = pd.DataFrame()
                st.subheader("Vista previa")
                if filtered_data_df.empty:
                    st.info("No hay datos para los filtros de región/país seleccionados.")
                else:
                    fig, preview_df = _build_figure(filtered_data_df, spec)
                    _render_chart_block(
                        spec,
                        fig,
                        preview_df,
                        data_label="Datos de vista previa",
                        chart_key="advanced_preview",
                    )

                save_disabled = fig is None or not dashboard_name.strip()
                if st.button("Guardar gráfico en dashboard", width="stretch", key="advanced_save", disabled=save_disabled):
                    ok, err = _save_chart_to_dashboard(
                        owner=owner,
                        dashboard_name=dashboard_name,
                        chart_spec=spec,
                    )
                    if ok:
                        st.success(f"Gráfico guardado en '{dashboard_name}'.")
                    else:
                        st.error(f"No se pudo guardar el gráfico: {err}")
                st.caption("Los gráficos guardados aparecen en la pestaña de dashboards personalizados.")

with tabs[2]:
    store = _load_store()
    owner_dashboards = _get_owner_dashboards(store, owner)

    if not owner_dashboards:
        st.info("Todavía no guardaste dashboards.")
    else:
        dashboard_names = [d.get("name", "Sin título") for d in owner_dashboards]
        selected_name = st.selectbox("Dashboard", dashboard_names, key="saved_dashboard_name")
        selected_dashboard = next(d for d in owner_dashboards if d.get("name", "Sin título") == selected_name)

        top_left, top_right = st.columns([3, 1])
        with top_left:
            st.subheader(selected_dashboard.get("name", "Dashboard sin título"))
            st.caption(f"{len(selected_dashboard.get('charts', []))} gráfico(s)")
        with top_right:
            if st.button("Eliminar dashboard", type="secondary", width="stretch"):
                ok, err = _delete_dashboard(owner=owner, dashboard_id=selected_dashboard.get("id", ""))
                if ok:
                    st.success("Dashboard eliminado.")
                    st.rerun()
                else:
                    st.error(err)

        for idx, chart in enumerate(selected_dashboard.get("charts", []), start=1):
            chart_df = _get_df(chart.get("source_mode", "filtered"))

            with st.expander(f"{idx}. {chart.get('name', 'Gráfico sin título')}", expanded=True):
                meta_cols = st.columns([2, 1, 1, 1, 1])
                meta_cols[0].caption(
                    f"Tipo: {_chart_type_label(chart.get('chart_type'))} | Fuente: {_source_mode_label(chart.get('source_mode'))}"
                )
                meta_cols[1].caption(f"X: {_field_label(chart.get('x_col'))}")
                meta_cols[2].caption(f"Y: {_field_label(chart.get('y_col'))}")
                meta_cols[3].caption(f"Agregación: {_aggregation_label(chart.get('aggregation'))}")
                meta_cols[4].caption(f"Filtros: {_filter_summary(chart)}")

                filtered_chart_df = _apply_optional_filters(chart_df, chart)
                if filtered_chart_df.empty:
                    st.warning("No hay datos para los filtros guardados en este gráfico.")
                else:
                    fig, chart_data = _build_figure(filtered_chart_df, chart)
                    _render_chart_block(
                        chart,
                        fig,
                        chart_data,
                        data_label="Datos del gráfico",
                        chart_key=f"saved_{chart.get('id', idx)}",
                    )

                if st.button("Eliminar gráfico", key=f"delete_chart_{chart.get('id')}", width="stretch"):
                    ok, err = _delete_chart(
                        owner=owner,
                        dashboard_id=selected_dashboard.get("id", ""),
                        chart_id=chart.get("id", ""),
                    )
                    if ok:
                        st.success("Gráfico eliminado.")
                        st.rerun()
                    else:
                        st.error(err)
