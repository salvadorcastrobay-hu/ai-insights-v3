import pandas as pd
import streamlit as st
import plotly.express as px
from exp_ds import inject_ds_css, DS, apply_ds_layout, BRAND_SCALE, ds_sub

try:
    from shared import chart_tooltip, render_inline_filters
except ImportError:
    def chart_tooltip(*_args, **_kwargs):
        return None

    def render_inline_filters(df, **_):
        return df

raw_df = st.session_state.get("df")
if raw_df is None or raw_df.empty:
    st.warning("No hay datos para mostrar.")
    st.stop()

inject_ds_css()
ds_sub("FAQs — Detalle")
df = render_inline_filters(raw_df, key_prefix="faq")
if df.empty:
    st.warning("No hay datos para los filtros seleccionados.")
    st.stop()

faqs = df[df["insight_type"] == "faq"].copy()
if faqs.empty:
    st.info("No hay FAQs en los datos filtrados.")
    st.stop()

# ── A. KPIs de cabecera ──────────────────────────────────────────────────────
total_faqs = len(faqs)
distinct_deals = faqs["deal_id"].nunique() if "deal_id" in faqs.columns else 0
ratio = total_faqs / distinct_deals if distinct_deals > 0 else 0

col1, col2, col3 = st.columns(3)
col1.metric("Total FAQs", total_faqs, help="Cantidad total de insights de tipo FAQ.")
col1.caption(f"en {distinct_deals} demos")
col2.metric(
    "Topics Únicos",
    faqs["insight_subtype_display"].nunique(),
    help="Cantidad de temas de preguntas frecuentes distintos.",
)
col2.caption("categorías de preguntas detectadas")
col3.metric(
    "Preguntas por Demo",
    f"{ratio:.1f}",
    help="Promedio de FAQs detectadas por demo. Un número alto señala gaps de contenido pre-demo.",
)
col3.caption("promedio por primera demo · ↓ ideal con el tiempo")

# ── B. Gráfico: FAQs por Topic ────────────────────────────────────────────────
if "deal_id" in faqs.columns:
    topic_counts = (
        faqs.groupby("insight_subtype_display")["deal_id"]
        .nunique()
        .sort_values(ascending=False)
        .reset_index()
    )
    topic_counts.columns = ["Topic", "Deals únicos"]
    topic_counts["% de demos"] = (
        topic_counts["Deals únicos"] / distinct_deals * 100
    ).round(1) if distinct_deals > 0 else 0.0
    topic_counts["label"] = topic_counts.apply(
        lambda r: f"{r['Deals únicos']}  ({r['% de demos']}%)", axis=1
    )
else:
    topic_counts = faqs["insight_subtype_display"].value_counts().reset_index()
    topic_counts.columns = ["Topic", "Deals únicos"]
    topic_counts["% de demos"] = 0.0
    topic_counts["label"] = topic_counts["Deals únicos"].astype(str)

if not topic_counts.empty:
    top3 = topic_counts.head(3)
    names = " / ".join(top3["Topic"].tolist())
    pcts = ", ".join([f"{p}%" for p in top3["% de demos"].tolist()])
    st.caption(
        f"💡 Los 3 topics más frecuentes ({names}) aparecen en {pcts} de las demos. "
        f"Son los temas prioritarios para Battle Cards."
    )

fig = px.bar(
    topic_counts,
    x="Deals únicos",
    y="Topic",
    orientation="h",
    title="FAQs por Topic (deals únicos con al menos 1 pregunta de ese topic)",
    text="label",
    color_discrete_sequence=[DS["brand_400"]],
)
fig.update_traces(textposition="inside", insidetextanchor="start")
fig.update_layout(yaxis=dict(autorange="reversed"))
fig = apply_ds_layout(fig, "FAQs por Topic (deals únicos con al menos 1 pregunta de ese topic)")
chart_tooltip(
    "Deals únicos que tuvieron al menos 1 FAQ de ese topic.",
    "Usar para priorizar Battle Cards: los topics con mayor % de demos son los más urgentes.",
)
st.plotly_chart(fig, use_container_width=True)

# ── B2. Top 5 preguntas por Topic (Battle Cards) ─────────────────────────────
ds_sub("Top 5 preguntas por Topic")
topic_options = ["(Seleccionar Topic)"] + sorted(
    faqs["insight_subtype_display"].dropna().unique().tolist()
)
selected_topic = st.selectbox("Seleccionar Topic", topic_options, key="faq_battle_topic")
if selected_topic != "(Seleccionar Topic)" and "summary" in faqs.columns:
    topic_df = faqs[faqs["insight_subtype_display"] == selected_topic]
    if "deal_id" in topic_df.columns:
        q_counts = (
            topic_df.groupby("summary")["deal_id"]
            .nunique()
            .sort_values(ascending=False)
            .head(5)
            .reset_index()
        )
    else:
        q_counts = topic_df["summary"].value_counts().head(5).reset_index()
    q_counts.columns = ["Pregunta", "Deals únicos"]
    fig2 = px.bar(
        q_counts,
        x="Deals únicos",
        y="Pregunta",
        orientation="h",
        title=f"Top 5 preguntas — {selected_topic}",
        color_discrete_sequence=[DS["brand_400"]],
    )
    fig2.update_layout(yaxis=dict(autorange="reversed"))
    fig2 = apply_ds_layout(fig2, f"Top 5 preguntas — {selected_topic}")
    chart_tooltip(
        f"Las 5 preguntas más frecuentes dentro del topic {selected_topic}.",
        "Base para construir la Battle Card de este topic.",
    )
    st.plotly_chart(fig2, use_container_width=True)
    st.caption(f"→ Estas 5 preguntas son la base para la Battle Card de {selected_topic}. Cada AE debería tener una respuesta preparada para cada una.")

# ── C. Tabla de Preguntas Frecuentes ─────────────────────────────────────────
ds_sub("Preguntas Frecuentes")

# Derived display columns
if "verbatim_quote" in faqs.columns:
    faqs["pregunta_especifica"] = faqs["verbatim_quote"].apply(
        lambda x: (str(x)[:100] + "...") if isinstance(x, str) and len(x) > 100 else x
    )
elif "summary" in faqs.columns:
    faqs["pregunta_especifica"] = faqs["summary"].apply(
        lambda x: (str(x)[:100] + "...") if isinstance(x, str) and len(x) > 100 else x
    )

if "summary" in faqs.columns:
    faqs["resumen"] = faqs["summary"].apply(
        lambda x: (str(x)[:120] + "...") if isinstance(x, str) and len(x) > 120 else x
    )

# Quick filters above the table
tf1, tf2 = st.columns([2, 3])
topic_filter_options = ["Todos"] + sorted(
    faqs["insight_subtype_display"].dropna().unique().tolist()
)
sel_topic_table = tf1.selectbox(
    "Filtrar por Topic", topic_filter_options, key="faq_table_topic"
)
search_text = tf2.text_input(
    "Buscar en preguntas", key="faq_table_search", placeholder="palabras clave..."
)

table_faqs = faqs.copy()
if sel_topic_table != "Todos":
    table_faqs = table_faqs[table_faqs["insight_subtype_display"] == sel_topic_table]
if search_text:
    mask = pd.Series(False, index=table_faqs.index)
    if "verbatim_quote" in table_faqs.columns:
        mask |= table_faqs["verbatim_quote"].astype(str).str.contains(search_text, case=False, na=False)
    if "summary" in table_faqs.columns:
        mask |= table_faqs["summary"].astype(str).str.contains(search_text, case=False, na=False)
    table_faqs = table_faqs[mask]

chart_tooltip(
    "Detalle de FAQs con pregunta específica y contexto del deal.",
    "Permite a los AEs revisar ejemplos reales para preparar respuestas estándar (Battle Cards).",
)
display_cols = [
    "company_name",
    "insight_subtype_display",
    "pregunta_especifica",
    "segment",
    "country",
    "deal_stage",
    "deal_owner",
    "resumen",
]
available_cols = [c for c in display_cols if c in table_faqs.columns]
st.dataframe(
    table_faqs[available_cols].sort_values("insight_subtype_display", ascending=True),
    use_container_width=True,
    height=400,
)
