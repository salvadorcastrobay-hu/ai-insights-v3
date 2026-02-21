import streamlit as st
import plotly.express as px
from shared import chart_tooltip

df = st.session_state.get("filtered_df")
if df is None or df.empty:
    st.warning("No hay datos para mostrar.")
    st.stop()

st.header("FAQs — Detalle")

faqs = df[df["insight_type"] == "faq"]
if faqs.empty:
    st.info("No hay FAQs en los datos filtrados.")
    st.stop()

col1, col2 = st.columns(2)
col1.metric("Total FAQs", len(faqs), help="Cantidad total de insights de tipo FAQ.")
col2.metric(
    "Topics Unicos",
    faqs["insight_subtype_display"].nunique(),
    help="Cantidad de temas de preguntas frecuentes distintos.",
)

topic_counts = faqs["insight_subtype_display"].value_counts().reset_index()
topic_counts.columns = ["Topic", "Frecuencia"]
fig = px.bar(topic_counts, x="Frecuencia", y="Topic", orientation="h", title="FAQs por Topic")
fig.update_layout(yaxis=dict(autorange="reversed"))
chart_tooltip(
    "Ranking de temas de FAQ más preguntados.",
    "Se usa para priorizar contenidos de soporte comercial.",
)
st.plotly_chart(fig, width="stretch")

st.subheader("Preguntas Frecuentes")
chart_tooltip(
    "Detalle de FAQs con resumen y cita textual.",
    "Permite revisar ejemplos concretos para preparar respuestas estándar.",
)
display_cols = ["company_name", "insight_subtype_display", "summary", "verbatim_quote"]
available_cols = [c for c in display_cols if c in faqs.columns]
st.dataframe(faqs[available_cols], width="stretch")
