import streamlit as st
import plotly.express as px
import pandas as pd
try:
    from shared import format_currency, chart_tooltip, render_inline_filters, annotate_heatmap
except ImportError:
    from shared import format_currency

    def chart_tooltip(*_args, **_kwargs):
        return None

    def render_inline_filters(df, **_):
        return df

    def annotate_heatmap(*_args, **_kwargs):
        return None

try:
    from taxonomy import COMPETITORS
    CURATED_COMPETITORS = set(COMPETITORS.keys())
except ImportError:
    CURATED_COMPETITORS = set()

raw_df = st.session_state.get("df")
if raw_df is None or raw_df.empty:
    st.warning("No hay datos para mostrar.")
    st.stop()

st.header("Competitive Intelligence")
df = render_inline_filters(raw_df, key_prefix="ci")
if df.empty:
    st.warning("No hay datos para los filtros seleccionados.")
    st.stop()

comp = df[df["insight_type"] == "competitive_signal"].copy()
if "is_own_brand_competitor" in comp.columns:
    comp = comp[~comp["is_own_brand_competitor"].fillna(False)]

# Restrict to curated competitor list to eliminate noise (e.g. stack mentions like Slack)
if CURATED_COMPETITORS and "competitor_name" in comp.columns:
    comp = comp[comp["competitor_name"].isin(CURATED_COMPETITORS)]

if comp.empty:
    st.info("No hay señales competitivas en los datos filtrados.")
    st.stop()

# ── KPIs ──────────────────────────────────────────────────────────────────────
# "Relevant" competitors = curated list + at least one strong-relationship signal
STRONG_RELATIONSHIPS = {
    "currently_using", "evaluating", "migrating_from",
    "migrating_to", "replaced", "previously_used",
}
if "competitor_relationship" in comp.columns:
    strong_comp = comp[comp["competitor_relationship"].isin(STRONG_RELATIONSHIPS)]
else:
    strong_comp = comp

relevant_competitors = (
    strong_comp["competitor_name"].dropna().nunique()
    if not strong_comp.empty
    else comp["competitor_name"].dropna().nunique()
)

total_deals_all = df["deal_id"].dropna().nunique()
deals_with_competition = comp["deal_id"].dropna().nunique()
pct_deals = (deals_with_competition / total_deals_all * 100) if total_deals_all > 0 else 0

total_rev = comp.drop_duplicates("deal_id")["amount"].sum()

col1, col2, col3 = st.columns(3)
col1.metric(
    "Competidores relevantes",
    f"{relevant_competitors}",
    help="Competidores de la lista curada con al menos una señal de relación fuerte (excluye 'Mencionado').",
)
col2.metric(
    "Deals con señal competitiva",
    f"{deals_with_competition:,}",
    delta=f"{pct_deals:.1f}% del total",
    help="Cantidad de deals únicos donde se detectó al menos una señal competitiva.",
)
col3.metric(
    "Revenue con competencia activa",
    format_currency(total_rev),
    help="Suma del monto de deals únicos con señales competitivas.",
)

# ── A. ¿Contra quién competimos? ──────────────────────────────────────────────
st.markdown("---")
st.subheader("A. ¿Contra quién competimos?")

col_left, col_right = st.columns(2)
with col_left:
    comp_deals = comp.dropna(subset=["competitor_name", "deal_id"]).drop_duplicates(
        ["competitor_name", "deal_id"]
    )
    comp_counts = (
        comp_deals["competitor_name"].value_counts().head(15).reset_index()
    )
    comp_counts.columns = ["Competidor", "Deals únicos"]
    fig = px.bar(
        comp_counts,
        x="Deals únicos",
        y="Competidor",
        orientation="h",
        title="¿Contra quién competimos más seguido?",
        labels={"Deals únicos": "Deals únicos"},
    )
    fig.update_layout(yaxis=dict(autorange="reversed"))
    chart_tooltip(
        "Ranking de competidores por deals únicos donde aparecieron.",
        "Solo competidores de la lista curada. Cada competidor cuenta una vez por deal.",
    )
    st.plotly_chart(fig, width="stretch")

with col_right:
    rel_data = comp.dropna(subset=["competitor_name", "competitor_relationship_display"])
    if not rel_data.empty:
        top_comp = (
            rel_data.drop_duplicates(["competitor_name", "deal_id"])["competitor_name"]
            .value_counts()
            .head(10)
            .index
        )
        rel_data = (
            rel_data[rel_data["competitor_name"].isin(top_comp)]
            .drop_duplicates(["competitor_name", "deal_id", "competitor_relationship_display"])
            .groupby(["competitor_name", "competitor_relationship_display"])
            .size()
            .reset_index(name="Deals únicos")
        )
        COLOR_MAP = {
            "Usa actualmente": "#E53935",
            "Evaluando": "#FB8C00",
            "Migrando desde": "#FDD835",
            "Uso anterior": "#43A047",
            "Mencionado": "#1E88E5",
            "Descartado": "#424242",
            "Currently Using": "#E53935",
            "Evaluating": "#FB8C00",
            "Migrating From": "#FDD835",
            "Previously Used": "#43A047",
            "Mentioned": "#1E88E5",
            "Replaced": "#424242",
        }
        fig = px.bar(
            rel_data,
            x="Deals únicos",
            y="competitor_name",
            color="competitor_relationship_display",
            orientation="h",
            barmode="stack",
            title="¿Cuál es la relación del prospect con el competidor?",
            labels={
                "Deals únicos": "Deals únicos",
                "competitor_name": "Competidor",
                "competitor_relationship_display": "Tipo de Relación",
            },
            color_discrete_map=COLOR_MAP,
        )
        fig.update_layout(yaxis=dict(autorange="reversed"))
    else:
        fig = None
    chart_tooltip(
        "Breakdown de deals por tipo de relación con el competidor.",
        "🔴 Usa actualmente · 🟠 Evaluando · 🟡 Migrando desde · 🟢 Uso anterior · 🔵 Mencionado (señal débil) · ⚫ Descartado",
    )
    if fig is None:
        st.info("No hay datos suficientes para el breakdown competitivo.")
    else:
        st.plotly_chart(fig, width="stretch")

st.caption(
    "**Leyenda de tipos de relación competitiva:** "
    "🔴 **Usa actualmente** — desplazamiento activo, máxima prioridad | "
    "🟠 **Evaluando** — necesita battle card específica | "
    "🟡 **Migrando desde** — oportunidad activa, acelerar | "
    "🟢 **Uso anterior** — aprender por qué lo dejaron | "
    "🔵 **Mencionado** — señal débil, no actuar sin más contexto | "
    "⚫ **Descartado** — win para Humand, documentar el motivo"
)

# ── B. ¿Dónde y con quién? ────────────────────────────────────────────────────
st.markdown("---")
st.subheader("B. ¿Dónde y con quién?")

if "country" in comp.columns:
    comp_country = comp.dropna(subset=["country", "competitor_name"])
    if not comp_country.empty:
        top_comp = (
            comp_country.drop_duplicates(["competitor_name", "deal_id"])["competitor_name"]
            .value_counts()
            .head(10)
            .index
        )
        top_countries = comp_country["country"].value_counts().head(12).index
        hm = (
            comp_country[
                comp_country["competitor_name"].isin(top_comp)
                & comp_country["country"].isin(top_countries)
            ]
            .drop_duplicates(["competitor_name", "country", "deal_id"])
            .groupby(["competitor_name", "country"])
            .size()
            .reset_index(name="Deals únicos")
        )
        pivot = hm.pivot(
            index="competitor_name", columns="country", values="Deals únicos"
        ).fillna(0)
        if not pivot.empty:
            row_order = pivot.sum(axis=1).sort_values(ascending=False).index
            col_order = pivot.sum(axis=0).sort_values(ascending=False).index
            pivot = pivot.loc[row_order, col_order]
            fig = px.imshow(
                pivot,
                text_auto=False,
                aspect="auto",
                title="¿En qué países aparece cada competidor?",
                labels=dict(x="País", y="Competidor", color="Deals únicos"),
                color_continuous_scale="Blues",
            )
            fig.update_layout(height=max(350, len(pivot) * 38), margin=dict(t=60, b=130, l=10, r=10))
            fig.update_xaxes(tickangle=-30, automargin=True)
            ci_flat = pivot.to_numpy().flatten().tolist()
            ci_max = float(max(ci_flat)) if ci_flat else 0.0
            annotate_heatmap(fig, pivot, ci_max, 0.0)
            chart_tooltip(
                "Heatmap de competidores por país (deals únicos).",
                "Más oscuro = más deals con ese competidor en ese país. Celdas en blanco = 0.",
            )
            st.plotly_chart(fig, use_container_width=True)

col_left, col_right = st.columns(2)
with col_left:
    if "segment" in comp.columns:
        comp_seg = comp.dropna(subset=["segment", "competitor_name"])
        if not comp_seg.empty:
            top_comp = (
                comp_seg.drop_duplicates(["competitor_name", "deal_id"])["competitor_name"]
                .value_counts()
                .head(10)
                .index
            )
            seg_data = (
                comp_seg[comp_seg["competitor_name"].isin(top_comp)]
                .drop_duplicates(["competitor_name", "segment", "deal_id"])
                .groupby(["competitor_name", "segment"])
                .size()
                .reset_index(name="Deals únicos")
            )
            fig = px.bar(
                seg_data,
                x="Deals únicos",
                y="competitor_name",
                color="segment",
                orientation="h",
                title="¿En qué segmento aparece cada competidor?",
                labels={"competitor_name": "Competidor", "Deals únicos": "Deals únicos"},
            )
            fig.update_layout(yaxis=dict(autorange="reversed"))
            chart_tooltip(
                "Presencia de competidores por segmento comercial (deals únicos).",
                "Ayuda a entender en qué segmento tiene más presión cada competidor.",
            )
            st.plotly_chart(fig, width="stretch")

with col_right:
    if "industry" in comp.columns:
        comp_ind = comp.dropna(subset=["industry", "competitor_name"])
        if not comp_ind.empty:
            top_comp = (
                comp_ind.drop_duplicates(["competitor_name", "deal_id"])["competitor_name"]
                .value_counts()
                .head(10)
                .index
            )
            top_industries = (
                comp_ind.drop_duplicates(["competitor_name", "deal_id"])["industry"]
                .value_counts()
                .head(5)
                .index
            )
            ind_data = (
                comp_ind[
                    comp_ind["competitor_name"].isin(top_comp)
                    & comp_ind["industry"].isin(top_industries)
                ]
                .drop_duplicates(["competitor_name", "industry", "deal_id"])
                .groupby(["competitor_name", "industry"])
                .size()
                .reset_index(name="Deals únicos")
            )
            fig = px.bar(
                ind_data,
                x="Deals únicos",
                y="competitor_name",
                color="industry",
                orientation="h",
                title="¿En qué industrias aparece cada competidor?",
                labels={"competitor_name": "Competidor", "Deals únicos": "Deals únicos"},
            )
            fig.update_layout(yaxis=dict(autorange="reversed"))
            chart_tooltip(
                "Presencia de competidores por industria (deals únicos).",
                "Ayuda a detectar qué competidores presionan más en cada vertical.",
            )
            st.plotly_chart(fig, use_container_width=True)

# ── C. ¿En qué momento del deal aparecen? ────────────────────────────────────
st.markdown("---")
st.subheader("C. ¿En qué momento del deal aparecen?")

if "deal_stage" in comp.columns:
    comp_stage = comp.dropna(subset=["deal_stage", "competitor_name"])
    if not comp_stage.empty:
        top_comp = (
            comp_stage.drop_duplicates(["competitor_name", "deal_id"])["competitor_name"]
            .value_counts()
            .head(10)
            .index
        )
        stage_data = (
            comp_stage[comp_stage["competitor_name"].isin(top_comp)]
            .drop_duplicates(["competitor_name", "deal_stage", "deal_id"])
            .groupby(["competitor_name", "deal_stage"])
            .size()
            .reset_index(name="Deals únicos")
        )
        fig = px.bar(
            stage_data,
            x="Deals únicos",
            y="competitor_name",
            color="deal_stage",
            orientation="h",
            title="¿En qué etapa del deal aparece cada competidor?",
            labels={"competitor_name": "Competidor", "Deals únicos": "Deals únicos", "deal_stage": "Etapa del Deal"},
        )
        fig.update_layout(yaxis=dict(autorange="reversed"))
        chart_tooltip(
            "Competidores por etapa del deal (deals únicos).",
            "Si un competidor aparece mucho en etapas finales, necesitamos argumentos específicos para ese momento del proceso comercial.",
        )
        st.plotly_chart(fig, width="stretch")

# ── D. Migration Opportunities ────────────────────────────────────────────────
st.markdown("---")
st.subheader("D. Migration Opportunities")

if "competitor_relationship" in comp.columns:
    migrating = comp[
        comp["competitor_relationship"].isin(["migrating_from", "currently_using"])
    ]
else:
    migrating = comp.iloc[0:0]

if not migrating.empty:
    st.info(
        "Estas son empresas donde detectamos que el prospect usa actualmente, o está migrando desde, "
        "un competidor directo. Son oportunidades activas de desplazamiento. "
        "Filtrar por competidor o región para trabajarlas con el AE asignado."
    )
    chart_tooltip(
        "Deals donde el prospecto usa o migra desde un competidor de la lista curada.",
        "Ordenado por revenue descendente. Columna 'Tipo de Relación' indica si es desplazamiento activo o migración en curso.",
    )
    display_cols = [
        "company_name",
        "competitor_name",
        "competitor_relationship_display",
        "industry",
        "country",
        "segment",
        "amount",
        "deal_stage",
        "deal_owner",
        "deal_name",
    ]
    available_cols = [c for c in display_cols if c in migrating.columns]
    dedup_keys = [c for c in ["deal_id", "competitor_name"] if c in migrating.columns]
    display_df = (
        migrating.sort_values("amount", ascending=False)
        .drop_duplicates(subset=dedup_keys if dedup_keys else available_cols)
        [available_cols]
        .rename(
            columns={
                "company_name": "Empresa",
                "competitor_name": "Competidor",
                "competitor_relationship_display": "Tipo de Relación",
                "industry": "Industria",
                "country": "País",
                "segment": "Segmento",
                "amount": "Revenue",
                "deal_stage": "Etapa",
                "deal_owner": "AE",
                "deal_name": "Deal",
            }
        )
    )
    st.dataframe(display_df, width="stretch")
else:
    st.info("No hay oportunidades de migración detectadas en los datos filtrados.")
