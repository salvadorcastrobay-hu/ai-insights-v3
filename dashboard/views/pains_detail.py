import streamlit as st
import plotly.express as px
from shared import humanize, chart_tooltip

df = st.session_state.get("filtered_df")
if df is None or df.empty:
    st.warning("No hay datos para mostrar.")
    st.stop()

st.header("Pains — Detalle")

pains = df[df["insight_type"] == "pain"].copy()
if pains.empty:
    st.info("No hay pains en los datos filtrados.")
    st.stop()

# Humanize coded columns for display
pains["pain_theme"] = pains["pain_theme"].map(humanize)
pains["pain_scope"] = pains["pain_scope"].map(humanize)
if "module_status" in pains.columns:
    pains["module_status"] = pains["module_status"].map(humanize)

col1, col2, col3 = st.columns(3)
general = pains[pains["pain_scope"] == "General"]
module_linked = pains[pains["pain_scope"] == "Vinculado a Módulo"]
col1.metric("Total Pains", len(pains), help="Cantidad total de pains detectados.")
col2.metric("Generales", len(general), help="Pains no vinculados a un módulo específico.")
col3.metric(
    "Vinculados a Modulo",
    len(module_linked),
    help="Pains asociados a un módulo concreto de producto.",
)

col_left, col_right = st.columns(2)
with col_left:
    theme_counts = pains["pain_theme"].value_counts().reset_index()
    theme_counts.columns = ["Theme", "Cantidad"]
    fig = px.bar(theme_counts, x="Theme", y="Cantidad", title="Pains por Theme", color="Theme")
    fig.update_layout(showlegend=False)
    chart_tooltip(
        "Volumen de pains por tema macro.",
        "Muestra la composición del problema: procesos, tecnología, comunicación, etc.",
    )
    st.plotly_chart(fig, width="stretch")

with col_right:
    if not module_linked.empty:
        mod_counts = module_linked["module_display"].value_counts().head(15).reset_index()
        mod_counts.columns = ["Modulo", "Cantidad"]
        fig = px.bar(mod_counts, x="Cantidad", y="Modulo", orientation="h", title="Pains por Modulo (top 15)")
        fig.update_layout(yaxis=dict(autorange="reversed"))
        chart_tooltip(
            "Top módulos más asociados a pains.",
            "Ayuda a priorizar foco por módulo de producto.",
        )
        st.plotly_chart(fig, width="stretch")

if "module_status" in pains.columns:
    pivot = pains.groupby(["pain_theme", "module_status"]).size().reset_index(name="count")
    if not pivot.empty:
        fig = px.density_heatmap(
            pivot, x="module_status", y="pain_theme", z="count",
            title="Pains: Theme x Status del Modulo",
        )
        chart_tooltip(
            "Cruce entre tema de pain y status del módulo (existente/faltante).",
            "Permite separar dolores sobre capacidades actuales vs gaps del producto.",
        )
        st.plotly_chart(fig, width="stretch")

st.subheader("Detalle de Pains")
chart_tooltip(
    "Tabla de detalle de pains con contexto textual y confianza.",
    "Se usa para validar ejemplos reales detrás de cada categoría.",
)
display_cols = ["company_name", "insight_subtype_display", "pain_theme", "pain_scope", "module_display", "summary", "confidence"]
available_cols = [c for c in display_cols if c in pains.columns]
st.dataframe(pains[available_cols].sort_values("confidence", ascending=False), width="stretch")
