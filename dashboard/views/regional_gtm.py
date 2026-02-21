import streamlit as st
import plotly.express as px
import pandas as pd
from shared import format_currency, chart_tooltip

df = st.session_state.get("filtered_df")
if df is None or df.empty:
    st.warning("No hay datos para mostrar.")
    st.stop()

st.header("Regional / GTM")

# Top countries with insight-type breakdown
if "country" in df.columns:
    country_data = df.dropna(subset=["country"]).copy()
    if not country_data.empty:
        top_countries = country_data["country"].value_counts().head(15).index
        country_breakdown = (
            country_data[country_data["country"].isin(top_countries)]
            .groupby(["country", "insight_type_display"])
            .size()
            .reset_index(name="count")
        )
        fig = px.bar(
            country_breakdown,
            x="count",
            y="country",
            color="insight_type_display",
            orientation="h",
            barmode="stack",
            title="Top 15 Paises por Insights (breakdown por tipo)",
            labels={
                "country": "Pais",
                "count": "Insights",
                "insight_type_display": "Tipo de insight",
            },
        )
        fig.update_layout(yaxis=dict(categoryorder="total ascending"))
        chart_tooltip(
            "Top 15 países por cantidad de insights, con desglose por tipo de insight.",
        )
        st.plotly_chart(fig, width="stretch")

# Top pains por region
pains = df[df["insight_type"] == "pain"]
if not pains.empty and "region" in pains.columns:
    pain_region = pains.dropna(subset=["region"])
    if not pain_region.empty:
        regions_list = pain_region["region"].unique()
        top_pains_per_region = []
        for r in regions_list:
            region_pains = pain_region[pain_region["region"] == r]
            top5 = region_pains["insight_subtype_display"].value_counts().head(5).reset_index()
            top5.columns = ["Pain", "Frecuencia"]
            top5["Region"] = r
            top_pains_per_region.append(top5)
        if top_pains_per_region:
            combined = pd.concat(top_pains_per_region)
            fig = px.bar(
                combined, x="Frecuencia", y="Pain", color="Region",
                orientation="h", title="Top 5 Pains por Region",
                barmode="group",
            )
            fig.update_layout(yaxis=dict(autorange="reversed"))
            chart_tooltip(
                "Top 5 pains por cada región.",
                "Permite comparar diferencias de dolor entre mercados.",
            )
            st.plotly_chart(fig, width="stretch")

# Modules by region — heatmap
mod_region = df.dropna(subset=["module_display", "region"])
if not mod_region.empty:
    top_mods = mod_region["module_display"].value_counts().head(15).index
    hm = (
        mod_region[mod_region["module_display"].isin(top_mods)]
        .groupby(["module_display", "region"]).size()
        .reset_index(name="count")
    )
    pivot = hm.pivot(index="module_display", columns="region", values="count").fillna(0)
    if not pivot.empty:
        fig = px.imshow(
            pivot, text_auto=True, aspect="auto",
            title="Modulos Demandados por Region (Top 15)",
            labels=dict(x="Region", y="Modulo", color="Menciones"),
        )
        chart_tooltip(
            "Módulos más mencionados por región.",
            "Sirve para detectar prioridades de producto o GTM según geografía.",
        )
        st.plotly_chart(fig, width="stretch")

# Competitors by country — table
comp = df[df["insight_type"] == "competitive_signal"].copy()
if "is_own_brand_competitor" in comp.columns:
    comp = comp[~comp["is_own_brand_competitor"].fillna(False)]
if not comp.empty and "country" in comp.columns:
    st.subheader("Competidores por Pais")
    chart_tooltip(
        "Tabla de competidores por país con menciones y relación principal.",
        "Da contexto competitivo local para mensajes comerciales por mercado.",
    )
    comp_country = (
        comp.dropna(subset=["country", "competitor_name"])
        .groupby(["country", "competitor_name"])
        .agg(
            menciones=("id", "count"),
            relacion_principal=("competitor_relationship_display", lambda x: x.value_counts().index[0] if len(x) > 0 else ""),
        )
        .reset_index()
        .sort_values(["country", "menciones"], ascending=[True, False])
    )
    comp_country.columns = ["Pais", "Competidor", "Menciones", "Relacion Principal"]
    st.dataframe(comp_country, width="stretch")

# Pipeline coverage: segment x region
if "segment" in df.columns and "region" in df.columns:
    st.subheader("Pipeline Coverage — Segmento x Region")
    chart_tooltip(
        "Cobertura de pipeline por segmento y región (revenue y cantidad de deals).",
        "Permite detectar desbalance de cobertura comercial entre mercados.",
    )
    pipeline_data = df.dropna(subset=["segment", "region"]).drop_duplicates("deal_id")
    if not pipeline_data.empty:
        coverage = (
            pipeline_data.groupby(["segment", "region"])
            .agg(revenue=("amount", "sum"), deals=("deal_id", "nunique"))
            .reset_index()
        )
        coverage["revenue_fmt"] = coverage["revenue"].apply(format_currency)

        # Display as pivot table
        rev_pivot = coverage.pivot(index="segment", columns="region", values="revenue").fillna(0)
        deals_pivot = coverage.pivot(index="segment", columns="region", values="deals").fillna(0)

        st.write("**Revenue por Segmento x Region**")
        st.dataframe(rev_pivot.map(format_currency), width="stretch")

        st.write("**Deals por Segmento x Region**")
        st.dataframe(deals_pivot.astype(int), width="stretch")
