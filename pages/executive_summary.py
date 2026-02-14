import streamlit as st
import plotly.express as px
import plotly.graph_objects as go
from shared import format_currency

df = st.session_state.get("filtered_df")
if df is None or df.empty:
    st.warning("No hay datos para mostrar.")
    st.stop()

st.header("Executive Summary")

# KPIs row
c1, c2, c3, c4, c5 = st.columns(5)
c1.metric("Total Insights", f"{len(df):,}")
c2.metric("Transcripts", f"{df['transcript_id'].nunique():,}")
deals_matched = df["deal_id"].dropna().nunique()
c3.metric("Deals con Match", f"{deals_matched:,}")
total_revenue = df.drop_duplicates("deal_id")["amount"].sum()
c4.metric("Revenue Total", format_currency(total_revenue))
c5.metric("Competidores Unicos", df["competitor_name"].dropna().nunique())

# Row 2: Insights by type + Top 10 Pains
col_left, col_right = st.columns(2)
with col_left:
    type_counts = df["insight_type_display"].value_counts().reset_index()
    type_counts.columns = ["Tipo", "Cantidad"]
    fig = px.bar(
        type_counts, x="Cantidad", y="Tipo", orientation="h",
        title="Insights por Tipo", color="Tipo",
    )
    fig.update_layout(yaxis=dict(autorange="reversed"), showlegend=False)
    st.plotly_chart(fig, use_container_width=True)

with col_right:
    pains = df[df["insight_type"] == "pain"]
    if not pains.empty:
        top_pains = pains["insight_subtype_display"].value_counts().head(10).reset_index()
        top_pains.columns = ["Pain", "Frecuencia"]
        fig = px.bar(
            top_pains, x="Frecuencia", y="Pain", orientation="h",
            title="Top 10 Pains",
        )
        fig.update_layout(yaxis=dict(autorange="reversed"))
        st.plotly_chart(fig, use_container_width=True)

# Row 3: Feature Gaps with Revenue Impact + Competitive Positioning
col_left, col_right = st.columns(2)
with col_left:
    gaps = df[df["insight_type"] == "product_gap"]
    if not gaps.empty:
        gap_revenue = (
            gaps.drop_duplicates(subset=["deal_id", "feature_display"])
            .groupby("feature_display")
            .agg(frecuencia=("feature_display", "size"), revenue=("amount", "sum"))
            .reset_index()
            .sort_values("revenue", ascending=False)
            .head(10)
        )
        fig = go.Figure()
        fig.add_trace(go.Bar(
            y=gap_revenue["feature_display"], x=gap_revenue["frecuencia"],
            name="Frecuencia", orientation="h", marker_color="#636EFA",
        ))
        fig.add_trace(go.Bar(
            y=gap_revenue["feature_display"], x=gap_revenue["revenue"],
            name="Revenue ($)", orientation="h", marker_color="#EF553B",
            xaxis="x2",
        ))
        fig.update_layout(
            title="Top 10 Feature Gaps — Revenue Impact",
            xaxis=dict(title="Frecuencia", side="bottom"),
            xaxis2=dict(title="Revenue ($)", side="top", overlaying="x"),
            yaxis=dict(autorange="reversed"),
            barmode="group",
            legend=dict(orientation="h", y=-0.15),
        )
        st.plotly_chart(fig, use_container_width=True)

with col_right:
    comp = df[df["insight_type"] == "competitive_signal"]
    if not comp.empty:
        rel_counts = comp["competitor_relationship_display"].value_counts().reset_index()
        rel_counts.columns = ["Relacion", "Cantidad"]
        fig = px.pie(
            rel_counts, values="Cantidad", names="Relacion",
            title="Posicionamiento Competitivo",
        )
        st.plotly_chart(fig, use_container_width=True)

# Trend mensual
if "call_date" in df.columns:
    trend = df.dropna(subset=["call_date"]).copy()
    if not trend.empty:
        trend["month"] = trend["call_date"].dt.to_period("M").astype(str)
        monthly = trend.groupby(["month", "insight_type_display"]).size().reset_index(name="count")
        fig = px.line(
            monthly, x="month", y="count", color="insight_type_display",
            title="Tendencia Mensual de Insights",
            labels={"month": "Mes", "count": "Cantidad", "insight_type_display": "Tipo"},
        )
        fig.update_layout(xaxis_tickangle=-45)
        st.plotly_chart(fig, use_container_width=True)
