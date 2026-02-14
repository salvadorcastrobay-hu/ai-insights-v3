import streamlit as st
import plotly.express as px
from shared import format_currency

df = st.session_state.get("filtered_df")
if df is None or df.empty:
    st.warning("No hay datos para mostrar.")
    st.stop()

st.header("Competitive Intelligence")

comp = df[df["insight_type"] == "competitive_signal"]
if comp.empty:
    st.info("No hay senales competitivas en los datos filtrados.")
    st.stop()

col1, col2, col3 = st.columns(3)
col1.metric("Total Senales", f"{len(comp):,}")
col2.metric("Competidores Unicos", comp["competitor_name"].dropna().nunique())
total_rev = comp.drop_duplicates("deal_id")["amount"].sum()
col3.metric("Revenue Asociado", format_currency(total_rev))

# Top 15 competitors + relationship breakdown
col_left, col_right = st.columns(2)
with col_left:
    comp_counts = comp["competitor_name"].value_counts().head(15).reset_index()
    comp_counts.columns = ["Competidor", "Menciones"]
    fig = px.bar(comp_counts, x="Menciones", y="Competidor", orientation="h", title="Top 15 Competidores")
    fig.update_layout(yaxis=dict(autorange="reversed"))
    st.plotly_chart(fig, use_container_width=True)

with col_right:
    rel_counts = comp["competitor_relationship_display"].value_counts().reset_index()
    rel_counts.columns = ["Relacion", "Cantidad"]
    fig = px.pie(rel_counts, values="Cantidad", names="Relacion", title="Tipo de Relacion")
    st.plotly_chart(fig, use_container_width=True)

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
            st.plotly_chart(fig, use_container_width=True)

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
            st.plotly_chart(fig, use_container_width=True)

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
            st.plotly_chart(fig, use_container_width=True)

# Migration opportunities
migrating = comp[comp["competitor_relationship"] == "migrating_from"]
if not migrating.empty:
    st.subheader("Migration Opportunities")
    display_cols = ["competitor_name", "company_name", "country", "segment", "amount", "deal_stage", "deal_name"]
    available_cols = [c for c in display_cols if c in migrating.columns]
    st.dataframe(
        migrating[available_cols].sort_values("amount", ascending=False),
        use_container_width=True,
    )
