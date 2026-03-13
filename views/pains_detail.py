import streamlit as st
import plotly.express as px
try:
    from shared import humanize, chart_tooltip, render_inline_filters
except ImportError:
    from shared import humanize

    def chart_tooltip(*_args, **_kwargs):
        return None

    def render_inline_filters(df, **_):
        return df

raw_df = st.session_state.get("df")
if raw_df is None or raw_df.empty:
    st.warning("No hay datos para mostrar.")
    st.stop()

st.header("Pains — Detalle")
df = render_inline_filters(raw_df, key_prefix="pd")
if df.empty:
    st.warning("No hay datos para los filtros seleccionados.")
    st.stop()

pains = df[df["insight_type"] == "pain"].copy()
if pains.empty:
    st.info("No hay pains en los datos filtrados.")
    st.stop()

# Humanize coded columns for display
pains["pain_theme"] = pains["pain_theme"].map(humanize)
pains["pain_scope"] = pains["pain_scope"].map(humanize)
if "module_status" in pains.columns:
    pains["module_status"] = pains["module_status"].map(humanize)

# ── A. KPIs de cabecera ──────────────────────────────────────────────────────
general = pains[pains["pain_scope"] == "General"]
module_linked = pains[pains["pain_scope"] == "Vinculado a Módulo"]

total_pains = len(pains)
distinct_deals = pains["deal_id"].nunique() if "deal_id" in pains.columns else 0
ratio = total_pains / distinct_deals if distinct_deals > 0 else 0
pct_general = len(general) / total_pains * 100 if total_pains > 0 else 0
pct_linked = len(module_linked) / total_pains * 100 if total_pains > 0 else 0

col1, col2, col3 = st.columns(3)
col1.metric("Total Pains", total_pains, help="Cantidad total de pains detectados.")
col1.caption(f"en {distinct_deals} demos · {ratio:.1f} por demo")
col2.metric("Generales", len(general), help="Pains no vinculados a un módulo específico.")
col2.caption(f"{pct_general:.0f}% del total · sin módulo asociado")
col3.metric(
    "Vinculados a Modulo",
    len(module_linked),
    help="Pains asociados a un módulo concreto de producto.",
)
col3.caption(f"{pct_linked:.0f}% del total · señal accionable")

st.info(
    "ℹ️ El total de pains en esta página refleja todos los registros históricos sin filtro de "
    "fecha. El Executive Summary puede mostrar un número menor si aplica filtros de período por defecto."
)

# ── B. Gráficos de distribución ──────────────────────────────────────────────
col_left, col_right = st.columns(2)

with col_left:
    if not module_linked.empty and "deal_id" in pains.columns:
        mod_counts = (
            module_linked.groupby("module_display")["deal_id"]
            .nunique()
            .sort_values(ascending=False)
            .head(15)
            .reset_index()
        )
        mod_counts.columns = ["Modulo", "Deals únicos"]
        fig = px.bar(
            mod_counts,
            x="Deals únicos",
            y="Modulo",
            orientation="h",
            title="¿En qué módulos se concentran más problemas?",
        )
        fig.update_layout(yaxis=dict(autorange="reversed"))
        chart_tooltip(
            "Deals únicos donde se detectó al menos un pain vinculado a este módulo.",
            "Ayuda a priorizar foco por módulo de producto.",
        )
        st.plotly_chart(fig, use_container_width=True)

with col_right:
    if "module_status" in pains.columns:
        pivot = pains.groupby(["pain_theme", "module_status"]).size().reset_index(name="count")
        if not pivot.empty:
            st.caption(
                "💡 **Lectura clave:** El porcentaje de pains en módulos existentes revela si el "
                "problema es de roadmap o de propuesta de valor y UX dentro de los módulos actuales."
            )
            fig = px.density_heatmap(
                pivot, x="module_status", y="pain_theme", z="count",
                title="Pains: Theme x Status del Módulo",
            )
            chart_tooltip(
                "Cruce entre tema de pain y status del módulo (existente/faltante).",
                "Permite separar dolores sobre capacidades actuales vs gaps del producto.",
            )
            st.plotly_chart(fig, use_container_width=True)

# ── C. Tabla de Detalle ───────────────────────────────────────────────────────
st.subheader("Detalle de Pains")

# Truncate summary for table display
if "summary" in pains.columns:
    pains["resumen"] = pains["summary"].apply(
        lambda x: (str(x)[:120] + "...") if isinstance(x, str) and len(x) > 120 else x
    )
else:
    pains["resumen"] = None

# Quick filters — apply only to the table, not to charts above
tf1, tf2, tf3 = st.columns([2, 2, 3])
theme_options = ["Todos"] + sorted(pains["pain_theme"].dropna().unique().tolist())
selected_theme = tf1.selectbox("Filtrar por Theme", theme_options, key="pd_table_theme")
module_options = (
    ["Todos"] + sorted(pains["module_display"].dropna().unique().tolist())
    if "module_display" in pains.columns
    else ["Todos"]
)
selected_module = tf2.selectbox("Filtrar por Módulo", module_options, key="pd_table_module")
search_text = tf3.text_input("Buscar en resumen", key="pd_table_search", placeholder="palabras clave...")

table_pains = pains.copy()
if selected_theme != "Todos":
    table_pains = table_pains[table_pains["pain_theme"] == selected_theme]
if selected_module != "Todos" and "module_display" in table_pains.columns:
    table_pains = table_pains[table_pains["module_display"] == selected_module]
if search_text and "summary" in table_pains.columns:
    table_pains = table_pains[table_pains["summary"].str.contains(search_text, case=False, na=False)]

chart_tooltip(
    "Tabla de detalle de pains con contexto textual y confianza.",
    "Se usa para validar ejemplos reales detrás de cada categoría. Haz click en una fila para ver el resumen completo.",
)
display_cols = [
    "company_name", "insight_subtype_display", "pain_theme", "pain_scope",
    "module_display", "segment", "country", "deal_stage", "deal_owner", "resumen",
]
available_cols = [c for c in display_cols if c in table_pains.columns]
st.dataframe(table_pains[available_cols].sort_values("pain_theme", ascending=True), use_container_width=True, height=400)
