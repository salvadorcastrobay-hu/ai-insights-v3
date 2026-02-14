import streamlit as st
import plotly.express as px

df = st.session_state.get("filtered_df")
if df is None or df.empty:
    st.warning("No hay datos para mostrar.")
    st.stop()

st.header("Pains — Detalle")

pains = df[df["insight_type"] == "pain"]
if pains.empty:
    st.info("No hay pains en los datos filtrados.")
    st.stop()

col1, col2, col3 = st.columns(3)
general = pains[pains["pain_scope"] == "general"]
module_linked = pains[pains["pain_scope"] == "module_linked"]
col1.metric("Total Pains", len(pains))
col2.metric("Generales", len(general))
col3.metric("Vinculados a Modulo", len(module_linked))

col_left, col_right = st.columns(2)
with col_left:
    theme_counts = pains["pain_theme"].value_counts().reset_index()
    theme_counts.columns = ["Theme", "Cantidad"]
    fig = px.bar(theme_counts, x="Theme", y="Cantidad", title="Pains por Theme", color="Theme")
    fig.update_layout(showlegend=False)
    st.plotly_chart(fig, use_container_width=True)

with col_right:
    if not module_linked.empty:
        mod_counts = module_linked["module_display"].value_counts().head(15).reset_index()
        mod_counts.columns = ["Modulo", "Cantidad"]
        fig = px.bar(mod_counts, x="Cantidad", y="Modulo", orientation="h", title="Pains por Modulo (top 15)")
        fig.update_layout(yaxis=dict(autorange="reversed"))
        st.plotly_chart(fig, use_container_width=True)

if "module_status" in pains.columns:
    pivot = pains.groupby(["pain_theme", "module_status"]).size().reset_index(name="count")
    if not pivot.empty:
        fig = px.density_heatmap(
            pivot, x="module_status", y="pain_theme", z="count",
            title="Pains: Theme x Status del Modulo",
        )
        st.plotly_chart(fig, use_container_width=True)

st.subheader("Detalle de Pains")
display_cols = ["company_name", "insight_subtype_display", "pain_theme", "pain_scope", "module_display", "summary", "confidence"]
available_cols = [c for c in display_cols if c in pains.columns]
st.dataframe(pains[available_cols].sort_values("confidence", ascending=False), use_container_width=True)
