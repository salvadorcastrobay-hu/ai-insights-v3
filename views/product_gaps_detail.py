import streamlit as st
import plotly.express as px
try:
    from shared import humanize, chart_tooltip
except ImportError:
    from shared import humanize

    def chart_tooltip(*_args, **_kwargs):
        return None

df = st.session_state.get("filtered_df")
if df is None or df.empty:
    st.warning("No hay datos para mostrar.")
    st.stop()

st.header("Product Gaps — Detalle")

gaps = df[df["insight_type"] == "product_gap"].copy()
if gaps.empty:
    st.info("No hay product gaps en los datos filtrados.")
    st.stop()

# Humanize coded columns for display
if "gap_priority" in gaps.columns:
    gaps["gap_priority"] = gaps["gap_priority"].map(humanize)

col1, col2, col3 = st.columns(3)
col1.metric("Total Gaps", len(gaps), help="Cantidad total de insights de tipo product_gap.")
col2.metric(
    "Features Unicas",
    gaps["feature_name"].nunique(),
    help="Cantidad de features distintas detectadas como faltantes.",
)
seed_count = gaps[gaps["feature_is_seed"] == True]["feature_name"].nunique() if "feature_is_seed" in gaps.columns else "?"
col3.metric(
    "Features Seed",
    seed_count,
    help="Features que ya estaban en la lista semilla de taxonomía.",
)

feature_counts = gaps["feature_display"].value_counts().head(20).reset_index()
feature_counts.columns = ["Feature", "Frecuencia"]
fig = px.bar(feature_counts, x="Frecuencia", y="Feature", orientation="h", title="Top 20 Features Faltantes")
fig.update_layout(yaxis=dict(autorange="reversed"))
chart_tooltip(
    "Ranking de features faltantes más mencionadas.",
    "Indica qué funcionalidades aparecen más como brecha de producto.",
)
st.plotly_chart(fig, width="stretch")

col_left, col_right = st.columns(2)
with col_left:
    if "gap_priority" in gaps.columns:
        priority_counts = gaps["gap_priority"].value_counts().reset_index()
        priority_counts.columns = ["Prioridad", "Cantidad"]
        fig = px.pie(priority_counts, values="Cantidad", names="Prioridad", title="Distribucion por Prioridad")
        chart_tooltip(
            "Distribución de gaps por prioridad.",
            "Ayuda a distinguir gaps bloqueantes de mejoras deseables.",
        )
        st.plotly_chart(fig, width="stretch")

with col_right:
    mod_counts = gaps["module_display"].value_counts().head(10).reset_index()
    mod_counts.columns = ["Modulo", "Cantidad"]
    fig = px.bar(mod_counts, x="Cantidad", y="Modulo", orientation="h", title="Gaps por Modulo")
    fig.update_layout(yaxis=dict(autorange="reversed"))
    chart_tooltip(
        "Módulos con mayor concentración de product gaps.",
        "Sirve para priorizar roadmap por área funcional.",
    )
    st.plotly_chart(fig, width="stretch")

st.subheader("Detalle de Gaps")
chart_tooltip(
    "Detalle textual de gaps con descripción y confianza del insight.",
    "Permite revisar evidencia específica detrás de cada gap.",
)
display_cols = ["company_name", "feature_display", "module_display", "gap_description", "gap_priority", "confidence"]
available_cols = [c for c in display_cols if c in gaps.columns]
st.dataframe(gaps[available_cols], width="stretch")
