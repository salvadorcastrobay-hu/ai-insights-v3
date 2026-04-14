from __future__ import annotations

import pandas as pd
import plotly.express as px
import streamlit as st

from exp_ds import DS, apply_ds_layout, ds_section, ds_sub, inject_ds_css

try:
    from shared import chart_tooltip, format_currency, render_inline_filters
except ImportError:
    from shared import format_currency

    def chart_tooltip(*_args, **_kwargs):
        return None

    def render_inline_filters(df, **_):
        return df


inject_ds_css()

COMPARISON_OPTIONS = {
    "Períodos": {"mode": "time"},
    "Regiones": {"mode": "category", "column": "region"},
    "Países": {"mode": "category", "column": "country"},
    "Segmentos": {"mode": "category", "column": "segment"},
    "Industrias": {"mode": "category", "column": "industry"},
    "Canales de adquisición": {"mode": "category", "column": "acquisition_channel"},
}

FACET_OPTIONS = {
    "Tipo de insight": "insight_type_display",
    "Subtipo de insight": "insight_subtype_display",
    "Tema de pain": "pain_theme",
    "Módulo": "module_display",
    "Estado del módulo": "module_status",
    "Categoría HR": "hr_category_display",
    "Feature gap": "feature_display",
    "Competidor": "competitor_name",
    "Relación competitiva": "competitor_relationship_display",
    "Deal stage": "deal_stage",
    "Deal owner": "deal_owner",
    "País": "country",
    "Región": "region",
    "Segmento": "segment",
    "Industria": "industry",
    "Canal de adquisición": "acquisition_channel",
    "Fuente del deal": "deal_source",
}

METRIC_OPTIONS = {
    "Menciones": "mentions",
    "Deals únicos": "unique_deals",
    "Calls únicas": "unique_calls",
    "Revenue": "revenue",
    "Confianza promedio": "avg_confidence",
}

DISPLAY_OPTIONS = [
    "Volumen absoluto",
    "Participación porcentual",
    "Delta absoluto",
    "Delta porcentual",
]


def _clean_label(value) -> str | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    text = " ".join(str(value).strip().split())
    return text or None


def _available_facet_options(df: pd.DataFrame) -> dict[str, str]:
    options = {}
    for label, column in FACET_OPTIONS.items():
        if column in df.columns and df[column].dropna().astype(str).str.strip().ne("").any():
            options[label] = column
    return options


def _window_dates(df: pd.DataFrame, days: int) -> tuple[pd.Timestamp, pd.Timestamp, pd.Timestamp, pd.Timestamp]:
    valid_dates = df["call_date"].dropna()
    max_date = valid_dates.max().normalize()
    end_a = max_date
    start_a = end_a - pd.Timedelta(days=days - 1)
    end_b = start_a - pd.Timedelta(days=1)
    start_b = end_b - pd.Timedelta(days=days - 1)
    return start_a, end_a, start_b, end_b


def _apply_date_window(df: pd.DataFrame, start, end) -> pd.DataFrame:
    if "call_date" not in df.columns:
        return pd.DataFrame(columns=df.columns)
    start_ts = pd.Timestamp(start)
    end_ts = pd.Timestamp(end) + pd.Timedelta(days=1) - pd.Timedelta(microseconds=1)
    mask = df["call_date"].between(start_ts, end_ts, inclusive="both")
    return df.loc[mask].copy()


def _safe_pct_delta(a: float, b: float) -> float | None:
    if b == 0:
        return None
    return ((a - b) / b) * 100


def _metric_total(df: pd.DataFrame, metric_key: str) -> float:
    if df.empty:
        return 0.0
    if metric_key == "mentions":
        return float(len(df))
    if metric_key == "unique_deals":
        return float(df["deal_id"].dropna().nunique()) if "deal_id" in df.columns else 0.0
    if metric_key == "unique_calls":
        return float(df["transcript_id"].dropna().nunique()) if "transcript_id" in df.columns else 0.0
    if metric_key == "revenue":
        if "deal_id" not in df.columns or "amount" not in df.columns:
            return 0.0
        dedup = df.dropna(subset=["deal_id"]).drop_duplicates(subset=["deal_id"])
        return float(dedup["amount"].fillna(0).sum())
    if metric_key == "avg_confidence":
        if "confidence" not in df.columns:
            return 0.0
        value = pd.to_numeric(df["confidence"], errors="coerce").mean()
        return float(value) if pd.notna(value) else 0.0
    return 0.0


def _group_metric(df: pd.DataFrame, facet_col: str, metric_key: str) -> pd.Series:
    if df.empty or facet_col not in df.columns:
        return pd.Series(dtype=float)
    base = df.copy()
    base[facet_col] = base[facet_col].map(_clean_label)
    base = base.dropna(subset=[facet_col])
    if base.empty:
        return pd.Series(dtype=float)

    if metric_key == "mentions":
        series = base.groupby(facet_col).size()
    elif metric_key == "unique_deals":
        series = base.dropna(subset=["deal_id"]).groupby(facet_col)["deal_id"].nunique()
    elif metric_key == "unique_calls":
        series = base.dropna(subset=["transcript_id"]).groupby(facet_col)["transcript_id"].nunique()
    elif metric_key == "revenue":
        revenue_base = (
            base.dropna(subset=["deal_id"])
            .sort_values([facet_col, "deal_id"])
            .drop_duplicates(subset=[facet_col, "deal_id"])
        )
        series = revenue_base.groupby(facet_col)["amount"].sum(min_count=1)
    elif metric_key == "avg_confidence":
        confidence = pd.to_numeric(base["confidence"], errors="coerce")
        base = base.assign(confidence_numeric=confidence).dropna(subset=["confidence_numeric"])
        series = base.groupby(facet_col)["confidence_numeric"].mean()
    else:
        series = pd.Series(dtype=float)

    if series.empty:
        return pd.Series(dtype=float)
    return series.astype(float).sort_values(ascending=False)


def _format_metric_value(value: float | None, metric_key: str, percentage: bool = False) -> str:
    if value is None or pd.isna(value):
        return "n/a"
    if percentage:
        return f"{value:.1f}%"
    if metric_key == "revenue":
        return format_currency(float(value))
    if metric_key == "avg_confidence":
        return f"{float(value):.2f}"
    return f"{int(round(float(value))):,}"


def _build_comparison_table(
    df_a: pd.DataFrame,
    df_b: pd.DataFrame,
    facet_col: str,
    metric_key: str,
) -> pd.DataFrame:
    series_a = _group_metric(df_a, facet_col, metric_key).rename("A")
    series_b = _group_metric(df_b, facet_col, metric_key).rename("B")
    comparison = pd.concat([series_a, series_b], axis=1).fillna(0).reset_index()
    first_col = comparison.columns[0]
    comparison = comparison.rename(columns={first_col: "arista"})
    total_a = float(series_a.sum())
    total_b = float(series_b.sum())
    comparison["share_a"] = comparison["A"].map(lambda x: (x / total_a * 100) if total_a > 0 else 0.0)
    comparison["share_b"] = comparison["B"].map(lambda x: (x / total_b * 100) if total_b > 0 else 0.0)
    comparison["delta_abs"] = comparison["A"] - comparison["B"]
    comparison["delta_pct"] = comparison.apply(
        lambda row: _safe_pct_delta(float(row["A"]), float(row["B"])),
        axis=1,
    )
    return comparison


def _warn_if_small_sample(df_a: pd.DataFrame, df_b: pd.DataFrame) -> None:
    calls_a = df_a["transcript_id"].dropna().nunique() if "transcript_id" in df_a.columns else 0
    calls_b = df_b["transcript_id"].dropna().nunique() if "transcript_id" in df_b.columns else 0
    if min(calls_a, calls_b) < 5:
        st.warning(
            "Uno de los lados tiene menos de 5 calls únicas. Tomá la comparación como señal exploratoria, no conclusión."
        )


raw_df = st.session_state.get("df")
if raw_df is None or raw_df.empty:
    st.warning("No hay datos para mostrar.")
    st.stop()

st.markdown(
    f'<div style="font-size:{DS["size_xl"]};font-weight:600;font-family:{DS["font"]};'
    f'color:{DS["text_default"]};line-height:1.3;margin-bottom:4px;letter-spacing:0.2px;">'
    f'Comparative Analysis</div>',
    unsafe_allow_html=True,
)
st.caption(
    "Compará períodos o mercados y elegí qué arista leer: pains, gaps, competidores, módulos, stages y más."
)

df = render_inline_filters(raw_df, key_prefix="ca")
if df.empty:
    st.warning("No hay datos para los filtros seleccionados.")
    st.stop()

valid_dates = df["call_date"].dropna() if "call_date" in df.columns else pd.Series(dtype="datetime64[ns]")
facet_options = _available_facet_options(df)
if not facet_options:
    st.warning("No hay suficientes columnas disponibles para comparar aristas.")
    st.stop()

ds_section("Configurar comparación")

cfg1, cfg2, cfg3, cfg4 = st.columns([1.2, 1.1, 1.1, 0.9])
comparison_label = cfg1.selectbox("Comparar por", list(COMPARISON_OPTIONS.keys()), index=0)
facet_label = cfg2.selectbox("Arista", list(facet_options.keys()), index=1 if len(facet_options) > 1 else 0)
metric_label = cfg3.selectbox("Métrica", list(METRIC_OPTIONS.keys()), index=0)
display_mode = cfg4.selectbox("Lectura", DISPLAY_OPTIONS, index=0)

cfg5, cfg6 = st.columns([1.2, 1.0])
top_n = cfg5.slider("Top aristas", min_value=5, max_value=25, value=10, step=1)
normalize_by_share = cfg6.toggle(
    "Normalizar por share",
    value=display_mode == "Participación porcentual",
    help="Si estás en volumen absoluto, cambia a lectura relativa dentro de cada lado para evitar sesgo por tamaño de muestra.",
)

comparison_meta = COMPARISON_OPTIONS[comparison_label]
facet_col = facet_options[facet_label]
metric_key = METRIC_OPTIONS[metric_label]

if facet_col == "competitor_name":
    if "is_own_brand_competitor" in df.columns:
        df = df[~df["is_own_brand_competitor"].fillna(False)].copy()
    elif "competitor_name" in df.columns:
        df = df[df["competitor_name"] != "Humand"].copy()

    if df.empty:
        st.warning("No hay competidores externos para mostrar con los filtros seleccionados.")
        st.stop()

label_a = "Lado A"
label_b = "Lado B"

if comparison_meta["mode"] == "time":
    if valid_dates.empty:
        st.warning("No hay fechas válidas para comparar períodos.")
        st.stop()

    preset = st.selectbox(
        "Ventana temporal",
        ["Últimos 30 días vs 30 anteriores", "Últimos 90 días vs 90 anteriores", "Custom"],
        index=1,
    )
    if preset == "Últimos 30 días vs 30 anteriores":
        start_a, end_a, start_b, end_b = _window_dates(df, 30)
    elif preset == "Últimos 90 días vs 90 anteriores":
        start_a, end_a, start_b, end_b = _window_dates(df, 90)
    else:
        min_date = valid_dates.min().date()
        max_date = valid_dates.max().date()
        col_a, col_b = st.columns(2)
        with col_a:
            st.markdown("**Lado A**")
            start_a = st.date_input("Desde A", value=min_date, min_value=min_date, max_value=max_date, key="ca_start_a")
            end_a = st.date_input("Hasta A", value=max_date, min_value=min_date, max_value=max_date, key="ca_end_a")
        with col_b:
            st.markdown("**Lado B**")
            start_b = st.date_input("Desde B", value=min_date, min_value=min_date, max_value=max_date, key="ca_start_b")
            end_b = st.date_input("Hasta B", value=max_date, min_value=min_date, max_value=max_date, key="ca_end_b")
        if start_a > end_a or start_b > end_b:
            st.error("Cada lado necesita un rango válido: la fecha inicial no puede ser mayor que la final.")
            st.stop()

    df_a = _apply_date_window(df, start_a, end_a)
    df_b = _apply_date_window(df, start_b, end_b)
    label_a = f"{pd.Timestamp(start_a).date()} → {pd.Timestamp(end_a).date()}"
    label_b = f"{pd.Timestamp(start_b).date()} → {pd.Timestamp(end_b).date()}"
else:
    compare_col = comparison_meta["column"]
    available_values = sorted(
        {
            value
            for value in df[compare_col].dropna().map(_clean_label).tolist()
            if value
        }
    )
    if len(available_values) < 2:
        st.warning(f"No hay suficientes valores en `{compare_col}` para armar una comparación A/B.")
        st.stop()
    col_a, col_b = st.columns(2)
    default_b = 1 if len(available_values) > 1 else 0
    value_a = col_a.selectbox("Lado A", available_values, index=0, key="ca_value_a")
    remaining_values = [value for value in available_values if value != value_a]
    value_b = col_b.selectbox("Lado B", remaining_values, index=min(default_b - 1, len(remaining_values) - 1), key="ca_value_b")
    df_a = df[df[compare_col].map(_clean_label) == value_a].copy()
    df_b = df[df[compare_col].map(_clean_label) == value_b].copy()
    label_a = value_a
    label_b = value_b

if df_a.empty or df_b.empty:
    st.warning("Uno de los lados no tiene datos con la configuración elegida.")
    st.stop()

_warn_if_small_sample(df_a, df_b)

total_a = _metric_total(df_a, metric_key)
total_b = _metric_total(df_b, metric_key)
delta_total = total_a - total_b
delta_total_pct = _safe_pct_delta(total_a, total_b)
calls_a = df_a["transcript_id"].dropna().nunique() if "transcript_id" in df_a.columns else 0
calls_b = df_b["transcript_id"].dropna().nunique() if "transcript_id" in df_b.columns else 0
deals_a = df_a["deal_id"].dropna().nunique() if "deal_id" in df_a.columns else 0
deals_b = df_b["deal_id"].dropna().nunique() if "deal_id" in df_b.columns else 0

ds_section("Resumen A/B")
k1, k2, k3 = st.columns(3)
k1.metric(
    label_a,
    _format_metric_value(total_a, metric_key),
    help=f"{calls_a} calls únicas | {deals_a} deals únicos",
)
k2.metric(
    label_b,
    _format_metric_value(total_b, metric_key),
    help=f"{calls_b} calls únicas | {deals_b} deals únicos",
)
k3.metric(
    "Delta",
    _format_metric_value(delta_total, metric_key),
    delta=f"{delta_total_pct:.1f}%" if delta_total_pct is not None else "n/a",
)

comparison = _build_comparison_table(df_a, df_b, facet_col, metric_key)
if comparison.empty:
    st.warning("No hay datos suficientes para la arista seleccionada.")
    st.stop()

show_share = display_mode == "Participación porcentual" or (
    display_mode == "Volumen absoluto" and normalize_by_share
)

if show_share:
    sort_col = "share_a"
elif display_mode == "Delta absoluto":
    sort_col = "delta_abs"
elif display_mode == "Delta porcentual":
    sort_col = "delta_pct"
else:
    sort_col = "A"

if display_mode in {"Delta absoluto", "Delta porcentual"}:
    comparison["sort_metric"] = comparison[sort_col].abs()
else:
    secondary = "share_b" if show_share else "B"
    comparison["sort_metric"] = comparison[[sort_col, secondary]].max(axis=1)

chart_df = comparison.sort_values("sort_metric", ascending=False).head(top_n).copy()

if show_share:
    plot_df = chart_df.melt(
        id_vars=["arista"],
        value_vars=["share_a", "share_b"],
        var_name="serie",
        value_name="valor",
    )
    series_labels = {"share_a": label_a, "share_b": label_b}
    plot_df["serie"] = plot_df["serie"].map(series_labels)
    fig = px.bar(
        plot_df,
        x="valor",
        y="arista",
        color="serie",
        orientation="h",
        barmode="group",
        labels={"valor": "% share", "arista": facet_label, "serie": "Lado"},
        color_discrete_sequence=DS["palette"][:2],
        title=f"{facet_label} por participación relativa",
    )
    fig.update_xaxes(ticksuffix="%")
    chart_tooltip(
        "Participación de cada arista dentro del lado A y del lado B.",
        "Útil para comparar mercados o períodos de distinto tamaño sin sesgo por volumen bruto.",
    )
elif display_mode == "Delta absoluto":
    fig = px.bar(
        chart_df.sort_values("delta_abs"),
        x="delta_abs",
        y="arista",
        orientation="h",
        color="delta_abs",
        color_continuous_scale=[DS["brand_100"], DS["brand_400"], DS["blueprimary_800"]],
        labels={"delta_abs": "Delta", "arista": facet_label},
        title=f"Delta absoluto por {facet_label}",
    )
    chart_tooltip(
        "Diferencia absoluta entre A y B para cada arista.",
        "Valores positivos implican mayor presencia en A; negativos, mayor presencia en B.",
    )
elif display_mode == "Delta porcentual":
    delta_plot = chart_df.copy()
    delta_plot["delta_pct_plot"] = delta_plot["delta_pct"].fillna(0)
    fig = px.bar(
        delta_plot.sort_values("delta_pct_plot"),
        x="delta_pct_plot",
        y="arista",
        orientation="h",
        color="delta_pct_plot",
        color_continuous_scale=[DS["brand_100"], DS["brand_400"], DS["blueprimary_800"]],
        labels={"delta_pct_plot": "Delta %", "arista": facet_label},
        title=f"Delta porcentual por {facet_label}",
    )
    fig.update_xaxes(ticksuffix="%")
    chart_tooltip(
        "Variación porcentual de A contra B.",
        "Cuando B es muy chico, el delta % puede inflarse; conviene leerlo junto al tamaño de muestra.",
    )
else:
    plot_df = chart_df.melt(
        id_vars=["arista"],
        value_vars=["A", "B"],
        var_name="serie",
        value_name="valor",
    )
    series_labels = {"A": label_a, "B": label_b}
    plot_df["serie"] = plot_df["serie"].map(series_labels)
    fig = px.bar(
        plot_df,
        x="valor",
        y="arista",
        color="serie",
        orientation="h",
        barmode="group",
        labels={"valor": metric_label, "arista": facet_label, "serie": "Lado"},
        color_discrete_sequence=DS["palette"][:2],
        title=f"{facet_label} en A vs B",
    )
    chart_tooltip(
        "Comparación directa del valor absoluto de cada arista entre ambos lados.",
        "Ideal para ver rápidamente dónde se concentra más volumen, revenue o confianza.",
    )

fig = apply_ds_layout(fig, fig.layout.title.text if getattr(fig.layout.title, "text", None) else "")
fig.update_layout(height=max(460, min(900, 60 + 34 * len(chart_df))))
st.plotly_chart(fig, use_container_width=True)

ds_sub("Detalle de comparación")

table_df = chart_df.copy()
table_df[label_a] = table_df["A"].map(lambda x: _format_metric_value(x, metric_key))
table_df[label_b] = table_df["B"].map(lambda x: _format_metric_value(x, metric_key))
table_df["Share A"] = table_df["share_a"].map(lambda x: _format_metric_value(x, metric_key, percentage=True))
table_df["Share B"] = table_df["share_b"].map(lambda x: _format_metric_value(x, metric_key, percentage=True))
table_df["Delta abs"] = table_df["delta_abs"].map(lambda x: _format_metric_value(x, metric_key))
table_df["Delta %"] = table_df["delta_pct"].map(lambda x: _format_metric_value(x, metric_key, percentage=True))
table_df = table_df.rename(columns={"arista": facet_label})

st.dataframe(
    table_df[[facet_label, label_a, label_b, "Share A", "Share B", "Delta abs", "Delta %"]],
    use_container_width=True,
    hide_index=True,
)

leaders_a = chart_df.sort_values("A", ascending=False).head(3)["arista"].tolist()
leaders_b = chart_df.sort_values("B", ascending=False).head(3)["arista"].tolist()
gainers = chart_df.sort_values("delta_abs", ascending=False).head(3)["arista"].tolist()

ds_section("Lecturas rápidas")
col_a, col_b, col_c = st.columns(3)
with col_a:
    st.markdown(f"**Top en {label_a}**")
    for item in leaders_a:
        st.markdown(f"- {item}")
with col_b:
    st.markdown(f"**Top en {label_b}**")
    for item in leaders_b:
        st.markdown(f"- {item}")
with col_c:
    st.markdown("**Mayor uplift en A**")
    for item in gainers:
        st.markdown(f"- {item}")
