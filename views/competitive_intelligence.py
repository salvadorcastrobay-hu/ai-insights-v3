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

st.header("Competitive Intelligence")

comp = df[df["insight_type"] == "competitive_signal"].copy()
if "is_own_brand_competitor" in comp.columns:
    comp = comp[~comp["is_own_brand_competitor"].fillna(False)]
if comp.empty:
    st.info("No hay senales competitivas en los datos filtrados.")
    st.stop()

col1, col2, col3 = st.columns(3)
col1.metric(
    "Total Senales",
    f"{len(comp):,}",
    help="Cantidad total de señales competitivas detectadas.",
)
col2.metric(
    "Competidores Unicos",
    comp["competitor_name"].dropna().nunique(),
    help="Cantidad de competidores distintos mencionados.",
)
total_rev = comp.drop_duplicates("deal_id")["amount"].sum()
col3.metric(
    "Revenue Asociado",
    format_currency(total_rev),
    help="Suma del monto de deals con señales competitivas.",
)

# Top 15 competitors + relationship breakdown
col_left, col_right = st.columns(2)
with col_left:
    comp_counts = comp["competitor_name"].value_counts().head(15).reset_index()
    comp_counts.columns = ["Competidor", "Menciones"]
    fig = px.bar(comp_counts, x="Menciones", y="Competidor", orientation="h", title="Top 15 Competidores")
    fig.update_layout(yaxis=dict(autorange="reversed"))
    chart_tooltip(
        "Ranking de competidores más mencionados.",
        "Permite identificar los jugadores más presentes en conversaciones comerciales.",
    )
    st.plotly_chart(fig, width="stretch")

with col_right:
    rel_data = comp.dropna(subset=["competitor_name", "competitor_relationship_display"])
    if not rel_data.empty:
        top_comp = rel_data["competitor_name"].value_counts().head(10).index
        rel_data = (
            rel_data[rel_data["competitor_name"].isin(top_comp)]
            .groupby(["competitor_name", "competitor_relationship_display"])
            .size()
            .reset_index(name="count")
        )
        fig = px.bar(
            rel_data,
            x="count",
            y="competitor_name",
            color="competitor_relationship_display",
            orientation="h",
            barmode="stack",
            title="Competidores — Breakdown por Tipo de Relacion",
            labels={
                "count": "Menciones",
                "competitor_name": "Competidor",
                "competitor_relationship_display": "Tipo de Relacion",
            },
        )
        fig.update_layout(yaxis=dict(autorange="reversed"))
    else:
        fig = None
    chart_tooltip(
        "Para cada competidor, muestra el desglose de menciones por tipo de relación (usa, evalúa, migra, etc.).",
    )
    if fig is None:
        st.info("No hay datos suficientes para el breakdown competitivo.")
    else:
        st.plotly_chart(fig, width="stretch")

# Heatmap: competitor x country
if "country" in comp.columns:
    comp_country = comp.dropna(subset=["country", "competitor_name"])
    if not comp_country.empty:
        top_comp = comp_country["competitor_name"].value_counts().head(10).index
        top_countries = comp_country["country"].value_counts().head(10).index
        hm = (
            comp_country[
                comp_country["competitor_name"].isin(top_comp)
                & comp_country["country"].isin(top_countries)
            ]
            .groupby(["competitor_name", "country"]).size()
            .reset_index(name="count")
        )
        pivot = hm.pivot(index="competitor_name", columns="country", values="count").fillna(0)
        if not pivot.empty:
            fig = px.imshow(
                pivot, text_auto=True, aspect="auto",
                title="Competidores x Pais (Top 10)",
                labels=dict(x="Pais", y="Competidor", color="Menciones"),
            )
            chart_tooltip(
                "Cruce de competidores y países por cantidad de menciones.",
                "Sirve para detectar concentración competitiva por geografía.",
            )
            st.plotly_chart(fig, width="stretch")

# Competitors by segment — stacked bar
col_left, col_right = st.columns(2)
with col_left:
    if "segment" in comp.columns:
        comp_seg = comp.dropna(subset=["segment"])
        if not comp_seg.empty:
            top_comp = comp_seg["competitor_name"].value_counts().head(10).index
            seg_data = (
                comp_seg[comp_seg["competitor_name"].isin(top_comp)]
                .groupby(["competitor_name", "segment"]).size()
                .reset_index(name="count")
            )
            fig = px.bar(
                seg_data, x="count", y="competitor_name", color="segment",
                orientation="h", title="Competidores por Segmento (Top 10)",
            )
            fig.update_layout(yaxis=dict(autorange="reversed"))
            chart_tooltip(
                "Presencia de competidores por segmento comercial.",
                "Ayuda a entender dónde cada competidor tiene mayor presión competitiva.",
            )
            st.plotly_chart(fig, width="stretch")

with col_right:
    # Win/Loss signals: competitor x deal_stage
    if "deal_stage" in comp.columns:
        comp_stage = comp.dropna(subset=["deal_stage"])
        if not comp_stage.empty:
            top_comp = comp_stage["competitor_name"].value_counts().head(10).index
            stage_data = (
                comp_stage[comp_stage["competitor_name"].isin(top_comp)]
                .groupby(["competitor_name", "deal_stage"]).size()
                .reset_index(name="count")
            )
            fig = px.bar(
                stage_data, x="count", y="competitor_name", color="deal_stage",
                orientation="h", title="Win/Loss Signals — Competidor x Deal Stage",
            )
            fig.update_layout(yaxis=dict(autorange="reversed"))
            chart_tooltip(
                "Competidores por etapa del deal.",
                "Permite ver en qué momento del pipeline aparece cada competidor.",
            )
            st.plotly_chart(fig, width="stretch")

# Migration opportunities
migrating = comp[comp["competitor_relationship"] == "migrating_from"]
if not migrating.empty:
    st.subheader("Migration Opportunities")
    chart_tooltip(
        "Listado de deals donde el prospecto declara migración desde un competidor.",
        "Es una vista accionable para priorizar oportunidades de reemplazo.",
    )
    display_cols = ["competitor_name", "company_name", "industry", "country", "segment", "amount", "deal_stage", "deal_name"]
    available_cols = [c for c in display_cols if c in migrating.columns]
    st.dataframe(
        migrating[available_cols].sort_values("amount", ascending=False),
        width="stretch",
    )
