import streamlit as st
import plotly.express as px

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
col1.metric("Total FAQs", len(faqs))
col2.metric("Topics Unicos", faqs["insight_subtype_display"].nunique())

topic_counts = faqs["insight_subtype_display"].value_counts().reset_index()
topic_counts.columns = ["Topic", "Frecuencia"]
fig = px.bar(topic_counts, x="Frecuencia", y="Topic", orientation="h", title="FAQs por Topic")
fig.update_layout(yaxis=dict(autorange="reversed"))
st.plotly_chart(fig, use_container_width=True)

st.subheader("Preguntas Frecuentes")
display_cols = ["company_name", "insight_subtype_display", "summary", "verbatim_quote"]
available_cols = [c for c in display_cols if c in faqs.columns]
st.dataframe(faqs[available_cols], use_container_width=True)
