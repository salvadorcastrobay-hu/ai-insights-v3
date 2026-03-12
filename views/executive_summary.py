import streamlit as st
import plotly.express as px
try:
    from shared import format_currency, chart_tooltip
except ImportError:
    from shared import format_currency

    def chart_tooltip(*_args, **_kwargs):
        return None

df = st.session_state.get("filtered_df")
if df is None or df.empty:
    st.warning("No hay datos para mostrar.")
    st.stop()

st.header("Executive Summary")

# KPIs row
c1, c2, c3, c4, c5 = st.columns(5)
c1.metric(
    "Total Insights",
    f"{len(df):,}",
    help="Cantidad total de insights en el universo filtrado.",
)
c2.metric(
    "Transcripts",
    f"{df['transcript_id'].nunique():,}",
    help="Cantidad de transcripts únicos analizados.",
)
deals_matched = df["deal_id"].dropna().nunique()
c3.metric(
    "Deals con Match",
    f"{deals_matched:,}",
    help="Cantidad de deals únicos con al menos un insight vinculado.",
)
total_revenue = df.drop_duplicates("deal_id")["amount"].sum()
c4.metric(
    "Revenue Total",
    format_currency(total_revenue),
    help="Suma de monto de deal por deal_id único dentro del recorte actual.",
)
comp_all = df[df["insight_type"] == "competitive_signal"].copy()
if "is_own_brand_competitor" in comp_all.columns:
    comp_all = comp_all[~comp_all["is_own_brand_competitor"].fillna(False)]
c5.metric(
    "Competidores Unicos",
    comp_all["competitor_name"].dropna().nunique(),
    help="Cantidad de competidores distintos detectados en señales competitivas.",
)

# Row 2: Insights by type + Top 10 Pains
col_left, col_right = st.columns(2)
with col_left:
    type_counts = df["insight_type_display"].value_counts().reset_index()
    type_counts.columns = ["Tipo", "Cantidad"]
    fig = px.bar(
        type_counts, x="Cantidad", y="Tipo", orientation="h",
        title="Insights por Tipo", color="Tipo",
    )
    fig.update_layout(yaxis=dict(autorange="reversed"), showlegend=False)
    chart_tooltip(
        "Distribución del volumen total de insights por tipo (pain, gap, fricción, FAQ, competencia).",
        "Barras más largas indican dónde se concentra la mayor parte de señales del mercado.",
    )
    st.plotly_chart(fig, width="stretch")

with col_right:
    pains = df[df["insight_type"] == "pain"]
    if not pains.empty:
        top_pains = pains["insight_subtype_display"].value_counts().head(10).reset_index()
        top_pains.columns = ["Pain", "Frecuencia"]
        fig = px.bar(
            top_pains, x="Frecuencia", y="Pain", orientation="h",
            title="Top 10 Pains",
        )
        fig.update_layout(yaxis=dict(autorange="reversed"))
        chart_tooltip(
            "Ranking de los 10 pains más mencionados en las conversaciones.",
            "Sirve para priorizar problemas de cliente por frecuencia de aparición.",
        )
        st.plotly_chart(fig, width="stretch")

# Row 3: Feature Gaps
col_left, col_right = st.columns(2)
with col_left:
    gaps = df[df["insight_type"] == "product_gap"]
    if not gaps.empty:
        gap_counts = (
            gaps.drop_duplicates(subset=["deal_id", "feature_display"])
            .groupby("feature_display")
            .agg(frecuencia=("feature_display", "size"))
            .reset_index()
            .sort_values("frecuencia", ascending=False)
            .head(10)
        )
        fig = px.bar(
            gap_counts,
            x="frecuencia",
            y="feature_display",
            orientation="h",
            title="Top 10 Feature Gaps — Frecuencia",
            labels={"feature_display": "Feature", "frecuencia": "Frecuencia"},
        )
        fig.update_layout(yaxis=dict(autorange="reversed"))
        chart_tooltip(
            "Top de features faltantes por frecuencia de aparición en deals únicos.",
        )
        st.plotly_chart(fig, width="stretch")

with col_right:
    gaps = df[df["insight_type"] == "product_gap"]
    if not gaps.empty:
        gap_revenue = (
            gaps.drop_duplicates(subset=["deal_id", "feature_display"])
            .groupby("feature_display")["amount"]
            .sum()
            .reset_index()
            .sort_values("amount", ascending=False)
            .head(10)
        )
        fig = px.bar(
            gap_revenue,
            x="amount",
            y="feature_display",
            orientation="h",
            title="Top 10 Feature Gaps — Revenue Impact",
            labels={"feature_display": "Feature", "amount": "Revenue"},
        )
        fig.update_layout(yaxis=dict(autorange="reversed"))
        chart_tooltip(
            "Top de features faltantes por revenue asociado a los deals que las mencionan.",
        )
        st.plotly_chart(fig, width="stretch")

# Row 4: Top competitors (replace pie chart)
comp = df[df["insight_type"] == "competitive_signal"].copy()
if "is_own_brand_competitor" in comp.columns:
    comp = comp[~comp["is_own_brand_competitor"].fillna(False)]
if not comp.empty:
    comp_counts = comp["competitor_name"].dropna().value_counts().head(10).reset_index()
    comp_counts.columns = ["Competidor", "Menciones"]
    fig = px.bar(
        comp_counts,
        x="Menciones",
        y="Competidor",
        orientation="h",
        title="Top Competidores Mencionados",
    )
    fig.update_layout(yaxis=dict(autorange="reversed"))
    chart_tooltip(
        "Ranking de competidores más mencionados en el recorte actual.",
    )
    st.plotly_chart(fig, width="stretch")

# Trend mensual
if "call_date" in df.columns:
    trend = df.dropna(subset=["call_date"]).copy()
    if not trend.empty:
        trend["month"] = trend["call_date"].dt.to_period("M").astype(str)
        monthly = trend.groupby(["month", "insight_type_display"]).size().reset_index(name="count")
        fig = px.line(
            monthly, x="month", y="count", color="insight_type_display",
            title="Tendencia Mensual de Insights",
            labels={"month": "Mes", "count": "Cantidad", "insight_type_display": "Tipo"},
        )
        fig.update_layout(xaxis_tickangle=-45)
        chart_tooltip(
            "Evolución mensual del volumen de insights por tipo.",
            "Ayuda a detectar tendencias, estacionalidades o cambios recientes en la demanda.",
        )
        st.plotly_chart(fig, width="stretch")
