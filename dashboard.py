"""
Streamlit dashboard for Humand Sales Insights.

Run: streamlit run dashboard.py
Deploy: Streamlit Community Cloud (free)
"""

from __future__ import annotations

import os
from pathlib import Path

import streamlit as st
import streamlit_authenticator as stauth
import yaml
from yaml.loader import SafeLoader
import plotly.express as px
import plotly.graph_objects as go
from supabase import create_client
import pandas as pd
from dotenv import load_dotenv
from sql_chat_agent import page_sql_chat

load_dotenv()

# ── Auth ──

CONFIG_PATH = Path(__file__).parent / "config.yaml"


def load_auth_config():
    with open(CONFIG_PATH) as f:
        return yaml.load(f, Loader=SafeLoader)


def save_auth_config(config):
    with open(CONFIG_PATH, "w") as f:
        yaml.dump(config, f, default_flow_style=False)

# ── Config ──

st.set_page_config(
    page_title="Humand Sales Insights",
    page_icon="📊",
    layout="wide",
)


def _get_secret(key: str) -> str:
    """Read from env vars (local) or st.secrets (Streamlit Cloud)."""
    val = os.environ.get(key)
    if val:
        return val
    try:
        return st.secrets[key]
    except (KeyError, FileNotFoundError):
        raise RuntimeError(f"Missing secret: {key}. Set it as env var or in Streamlit Cloud secrets.")


@st.cache_resource
def get_supabase():
    return create_client(
        _get_secret("SUPABASE_URL"),
        _get_secret("SUPABASE_KEY"),
    )


@st.cache_data(ttl=300)
def load_data() -> pd.DataFrame:
    """Load insights from the dashboard view."""
    client = get_supabase()
    all_data = []
    offset = 0
    page_size = 1000
    while True:
        response = (
            client.table("v_insights_dashboard")
            .select("*")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        all_data.extend(response.data)
        if len(response.data) < page_size:
            break
        offset += page_size

    if not all_data:
        return pd.DataFrame()

    df = pd.DataFrame(all_data)
    if "call_date" in df.columns:
        df["call_date"] = pd.to_datetime(df["call_date"], errors="coerce")
    if "amount" in df.columns:
        df["amount"] = pd.to_numeric(df["amount"], errors="coerce")
    return df


# ── Sidebar Filters ──

def render_sidebar(df: pd.DataFrame) -> pd.DataFrame:
    st.sidebar.title("Filtros")

    if df.empty:
        return df

    # Insight type filter
    types = sorted(df["insight_type_display"].dropna().unique())
    selected_types = st.sidebar.multiselect("Tipo de Insight", types, default=types)

    # Region filter
    regions = sorted(df["region"].dropna().unique())
    selected_regions = st.sidebar.multiselect("Region", regions, default=regions)

    # Segment filter
    if "segment" in df.columns:
        segments = sorted(df["segment"].dropna().unique())
        selected_segments = st.sidebar.multiselect("Segmento", segments)
    else:
        selected_segments = []

    # Country filter
    if "country" in df.columns:
        countries = sorted(df["country"].dropna().unique())
        selected_countries = st.sidebar.multiselect("Pais", countries)
    else:
        selected_countries = []

    # Deal Owner (AE) filter
    if "deal_owner" in df.columns:
        owners = sorted(df["deal_owner"].dropna().unique())
        selected_owners = st.sidebar.multiselect("Deal Owner (AE)", owners)
    else:
        selected_owners = []

    # Date range filter
    if "call_date" in df.columns:
        valid_dates = df["call_date"].dropna()
        if not valid_dates.empty:
            min_date = valid_dates.min().date()
            max_date = valid_dates.max().date()
            date_range = st.sidebar.date_input(
                "Rango de fechas",
                value=(min_date, max_date),
                min_value=min_date,
                max_value=max_date,
            )
        else:
            date_range = None
    else:
        date_range = None

    # Module filter
    modules = sorted(df["module_display"].dropna().unique())
    selected_modules = st.sidebar.multiselect("Modulo", modules)

    # HR Category filter
    categories = sorted(df["hr_category_display"].dropna().unique())
    selected_categories = st.sidebar.multiselect("Categoria HR", categories)

    # Apply filters
    mask = df["insight_type_display"].isin(selected_types) & df["region"].isin(selected_regions)
    if selected_segments:
        mask &= df["segment"].isin(selected_segments)
    if selected_countries:
        mask &= df["country"].isin(selected_countries)
    if selected_owners:
        mask &= df["deal_owner"].isin(selected_owners)
    if date_range and isinstance(date_range, tuple) and len(date_range) == 2:
        start, end = date_range
        mask &= (df["call_date"].dt.date >= start) & (df["call_date"].dt.date <= end)
    if selected_modules:
        mask &= df["module_display"].isin(selected_modules)
    if selected_categories:
        mask &= df["hr_category_display"].isin(selected_categories)

    return df[mask]


# ── Helper functions ──

def format_currency(value: float) -> str:
    if value >= 1_000_000:
        return f"${value / 1_000_000:,.1f}M"
    if value >= 1_000:
        return f"${value / 1_000:,.0f}K"
    return f"${value:,.0f}"


def safe_nunique(series: pd.Series) -> int:
    return series.dropna().nunique()


# ── Page 1: Executive Summary ──

def page_executive_summary(df: pd.DataFrame) -> None:
    st.header("Executive Summary")

    if df.empty:
        st.warning("No hay datos para mostrar. Ejecuta el pipeline primero.")
        return

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
            # Revenue impact per feature: sum amount of unique deals mentioning each feature
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


# ── Page 2: Product Intelligence ──

def page_product_intelligence(df: pd.DataFrame) -> None:
    st.header("Product Intelligence")

    # === Section A: Pains ===
    st.subheader("A. Pains")
    pains = df[df["insight_type"] == "pain"]
    if pains.empty:
        st.info("No hay pains en los datos filtrados.")
    else:
        # Top 15 pains
        top_pains = pains["insight_subtype_display"].value_counts().head(15).reset_index()
        top_pains.columns = ["Pain", "Frecuencia"]
        fig = px.bar(top_pains, x="Frecuencia", y="Pain", orientation="h", title="Top 15 Pains")
        fig.update_layout(yaxis=dict(autorange="reversed"))
        st.plotly_chart(fig, use_container_width=True)

        col_left, col_right = st.columns(2)
        with col_left:
            theme_counts = pains["pain_theme"].value_counts().reset_index()
            theme_counts.columns = ["Theme", "Cantidad"]
            fig = px.bar(theme_counts, x="Theme", y="Cantidad", title="Pains por Theme", color="Theme")
            fig.update_layout(showlegend=False)
            st.plotly_chart(fig, use_container_width=True)

        with col_right:
            # Heatmap: pain_subtype x segment
            if "segment" in pains.columns:
                pains_seg = pains.dropna(subset=["segment"])
                if not pains_seg.empty:
                    top_pain_names = pains_seg["insight_subtype_display"].value_counts().head(15).index
                    hm_data = (
                        pains_seg[pains_seg["insight_subtype_display"].isin(top_pain_names)]
                        .groupby(["insight_subtype_display", "segment"]).size()
                        .reset_index(name="count")
                    )
                    pivot = hm_data.pivot(index="insight_subtype_display", columns="segment", values="count").fillna(0)
                    fig = px.imshow(
                        pivot, text_auto=True, aspect="auto",
                        title="Top 15 Pains x Segmento",
                        labels=dict(x="Segmento", y="Pain", color="Cantidad"),
                    )
                    st.plotly_chart(fig, use_container_width=True)

        # Top pains por modulo con revenue impact
        module_pains = pains.dropna(subset=["module_display"])
        if not module_pains.empty:
            mod_revenue = (
                module_pains.drop_duplicates(subset=["deal_id", "module_display"])
                .groupby("module_display")
                .agg(frecuencia=("module_display", "size"), revenue=("amount", "sum"))
                .reset_index()
                .sort_values("revenue", ascending=False)
                .head(15)
            )
            fig = go.Figure()
            fig.add_trace(go.Bar(
                y=mod_revenue["module_display"], x=mod_revenue["frecuencia"],
                name="Frecuencia", orientation="h", marker_color="#636EFA",
            ))
            fig.add_trace(go.Bar(
                y=mod_revenue["module_display"], x=mod_revenue["revenue"],
                name="Revenue ($)", orientation="h", marker_color="#EF553B",
                xaxis="x2",
            ))
            fig.update_layout(
                title="Pains por Modulo — Revenue Impact",
                xaxis=dict(title="Frecuencia"), xaxis2=dict(title="Revenue ($)", side="top", overlaying="x"),
                yaxis=dict(autorange="reversed"), barmode="group",
                legend=dict(orientation="h", y=-0.15),
            )
            st.plotly_chart(fig, use_container_width=True)

    # === Section B: Feature Gaps ===
    st.subheader("B. Feature Gaps")
    gaps = df[df["insight_type"] == "product_gap"]
    if gaps.empty:
        st.info("No hay product gaps en los datos filtrados.")
    else:
        # Top 20 features
        feature_counts = gaps["feature_display"].value_counts().head(20).reset_index()
        feature_counts.columns = ["Feature", "Frecuencia"]
        fig = px.bar(feature_counts, x="Frecuencia", y="Feature", orientation="h", title="Top 20 Features Faltantes")
        fig.update_layout(yaxis=dict(autorange="reversed"))
        st.plotly_chart(fig, use_container_width=True)

        col_left, col_right = st.columns(2)
        with col_left:
            if "gap_priority" in gaps.columns:
                priority_counts = gaps["gap_priority"].value_counts().reset_index()
                priority_counts.columns = ["Prioridad", "Cantidad"]
                fig = px.pie(priority_counts, values="Cantidad", names="Prioridad", title="Distribucion por Prioridad")
                st.plotly_chart(fig, use_container_width=True)

        with col_right:
            # Feature gaps por segment — stacked bar
            if "segment" in gaps.columns:
                gaps_seg = gaps.dropna(subset=["segment"])
                if not gaps_seg.empty:
                    top_features = gaps_seg["feature_display"].value_counts().head(15).index
                    seg_data = (
                        gaps_seg[gaps_seg["feature_display"].isin(top_features)]
                        .groupby(["feature_display", "segment"]).size()
                        .reset_index(name="count")
                    )
                    fig = px.bar(
                        seg_data, x="count", y="feature_display", color="segment",
                        orientation="h", title="Feature Gaps por Segmento (Top 15)",
                    )
                    fig.update_layout(yaxis=dict(autorange="reversed"))
                    st.plotly_chart(fig, use_container_width=True)

        # Revenue at stake
        gap_rev = (
            gaps.drop_duplicates(subset=["deal_id", "feature_display"])
            .groupby("feature_display")["amount"].sum()
            .reset_index()
            .sort_values("amount", ascending=False)
            .head(10)
        )
        gap_rev.columns = ["Feature", "Revenue at Stake"]
        if gap_rev["Revenue at Stake"].sum() > 0:
            fig = px.bar(
                gap_rev, x="Revenue at Stake", y="Feature", orientation="h",
                title="Revenue at Stake — Top 10 Features",
            )
            fig.update_layout(yaxis=dict(autorange="reversed"))
            st.plotly_chart(fig, use_container_width=True)

        # Modulos missing vs existing
        if "module_status" in gaps.columns:
            status_counts = gaps.groupby("module_status").size().reset_index(name="count")
            if not status_counts.empty:
                fig = px.bar(
                    status_counts, x="module_status", y="count", color="module_status",
                    title="Gaps: Modulos Existing vs Missing",
                    labels={"module_status": "Status del Modulo", "count": "Cantidad"},
                )
                fig.update_layout(showlegend=False)
                st.plotly_chart(fig, use_container_width=True)


# ── Page 3: Competitive Intelligence ──

def page_competitive_intelligence(df: pd.DataFrame) -> None:
    st.header("Competitive Intelligence")

    comp = df[df["insight_type"] == "competitive_signal"]
    if comp.empty:
        st.info("No hay senales competitivas en los datos filtrados.")
        return

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


# ── Page 4: Sales Enablement ──

def page_sales_enablement(df: pd.DataFrame) -> None:
    st.header("Sales Enablement")

    # === Section A: Deal Friction ===
    st.subheader("A. Deal Friction")
    friction = df[df["insight_type"] == "deal_friction"]
    if friction.empty:
        st.info("No hay fricciones de deal en los datos filtrados.")
    else:
        col1, col2, col3 = st.columns(3)
        col1.metric("Total Fricciones", f"{len(friction):,}")
        col2.metric("Deals Afectados", friction["deal_id"].dropna().nunique())
        fric_rev = friction.drop_duplicates("deal_id")["amount"].sum()
        col3.metric("Revenue en Riesgo", format_currency(fric_rev))

        # Ranking of friction subtypes
        subtype_counts = friction["insight_subtype_display"].value_counts().reset_index()
        subtype_counts.columns = ["Tipo de Friccion", "Frecuencia"]
        fig = px.bar(subtype_counts, x="Frecuencia", y="Tipo de Friccion", orientation="h", title="Tipos de Friccion")
        fig.update_layout(yaxis=dict(autorange="reversed"))
        st.plotly_chart(fig, use_container_width=True)

        col_left, col_right = st.columns(2)
        with col_left:
            # Friction por segment
            if "segment" in friction.columns:
                fric_seg = friction.dropna(subset=["segment"])
                if not fric_seg.empty:
                    seg_data = fric_seg.groupby(["insight_subtype_display", "segment"]).size().reset_index(name="count")
                    fig = px.bar(
                        seg_data, x="count", y="insight_subtype_display", color="segment",
                        orientation="h", title="Friccion por Segmento",
                    )
                    fig.update_layout(yaxis=dict(autorange="reversed"))
                    st.plotly_chart(fig, use_container_width=True)

        with col_right:
            # Friction por deal_stage — heatmap
            if "deal_stage" in friction.columns:
                fric_stage = friction.dropna(subset=["deal_stage"])
                if not fric_stage.empty:
                    hm = fric_stage.groupby(["insight_subtype_display", "deal_stage"]).size().reset_index(name="count")
                    pivot = hm.pivot(index="insight_subtype_display", columns="deal_stage", values="count").fillna(0)
                    if not pivot.empty:
                        fig = px.imshow(
                            pivot, text_auto=True, aspect="auto",
                            title="Friccion x Etapa del Deal",
                            labels=dict(x="Deal Stage", y="Friccion", color="Cantidad"),
                        )
                        st.plotly_chart(fig, use_container_width=True)

    # === Section B: Performance por AE ===
    st.subheader("B. Performance por AE")
    if "deal_owner" in df.columns:
        ae_data = df.dropna(subset=["deal_owner"])
        if not ae_data.empty:
            # Table: AE metrics
            ae_metrics = ae_data.groupby("deal_owner").agg(
                total_insights=("id", "count"),
                total_deals=("deal_id", "nunique"),
                avg_amount=("amount", "mean"),
            ).reset_index()

            # Top friction per AE
            ae_friction = (
                ae_data[ae_data["insight_type"] == "deal_friction"]
                .groupby("deal_owner")["insight_subtype_display"]
                .agg(lambda x: x.value_counts().index[0] if len(x) > 0 else "")
                .reset_index()
                .rename(columns={"insight_subtype_display": "top_friction"})
            )
            # Top competitor per AE
            ae_comp = (
                ae_data[ae_data["insight_type"] == "competitive_signal"]
                .dropna(subset=["competitor_name"])
                .groupby("deal_owner")["competitor_name"]
                .agg(lambda x: x.value_counts().index[0] if len(x) > 0 else "")
                .reset_index()
                .rename(columns={"competitor_name": "top_competitor"})
            )

            ae_table = ae_metrics.merge(ae_friction, on="deal_owner", how="left").merge(ae_comp, on="deal_owner", how="left")
            ae_table["avg_amount"] = ae_table["avg_amount"].apply(lambda x: format_currency(x) if pd.notna(x) else "$0")
            ae_table.columns = ["AE", "Insights", "Deals", "Avg Amount", "Top Friccion", "Top Competidor"]
            ae_table = ae_table.sort_values("Insights", ascending=False)
            st.dataframe(ae_table, use_container_width=True)

            # Bar chart: frictions per AE (top 10)
            ae_fric_data = ae_data[ae_data["insight_type"] == "deal_friction"]
            if not ae_fric_data.empty:
                top_aes = ae_fric_data["deal_owner"].value_counts().head(10).index
                fric_by_ae = (
                    ae_fric_data[ae_fric_data["deal_owner"].isin(top_aes)]
                    .groupby(["deal_owner", "insight_subtype_display"]).size()
                    .reset_index(name="count")
                )
                fig = px.bar(
                    fric_by_ae, x="count", y="deal_owner", color="insight_subtype_display",
                    orientation="h", title="Fricciones por AE (Top 10)",
                )
                fig.update_layout(yaxis=dict(autorange="reversed"))
                st.plotly_chart(fig, use_container_width=True)
    else:
        st.info("No hay datos de deal_owner disponibles.")

    # === Section C: Battle Cards (FAQ) ===
    st.subheader("C. Battle Cards (FAQs)")
    faqs = df[df["insight_type"] == "faq"]
    if faqs.empty:
        st.info("No hay FAQs en los datos filtrados.")
    else:
        topic_counts = faqs["insight_subtype_display"].value_counts().reset_index()
        topic_counts.columns = ["Topic", "Frecuencia"]
        fig = px.bar(topic_counts, x="Frecuencia", y="Topic", orientation="h", title="FAQs por Topic")
        fig.update_layout(yaxis=dict(autorange="reversed"))
        st.plotly_chart(fig, use_container_width=True)

        st.subheader("Preguntas y Respuestas")
        display_cols = ["company_name", "insight_subtype_display", "summary", "verbatim_quote"]
        available_cols = [c for c in display_cols if c in faqs.columns]
        st.dataframe(faqs[available_cols], use_container_width=True)


# ── Page 5: Regional / GTM ──

def page_regional_gtm(df: pd.DataFrame) -> None:
    st.header("Regional / GTM")

    if df.empty:
        st.warning("No hay datos para mostrar.")
        return

    # Treemap by country
    if "country" in df.columns:
        country_data = df["country"].dropna().value_counts().reset_index()
        country_data.columns = ["Pais", "Insights"]
        if not country_data.empty:
            fig = px.treemap(
                country_data, path=["Pais"], values="Insights",
                title="Insights por Pais", color="Insights",
                color_continuous_scale="Blues",
            )
            st.plotly_chart(fig, use_container_width=True)

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
                st.plotly_chart(fig, use_container_width=True)

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
            st.plotly_chart(fig, use_container_width=True)

    # Competitors by country — table
    comp = df[df["insight_type"] == "competitive_signal"]
    if not comp.empty and "country" in comp.columns:
        st.subheader("Competidores por Pais")
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
        st.dataframe(comp_country, use_container_width=True)

    # Pipeline coverage: segment x region
    if "segment" in df.columns and "region" in df.columns:
        st.subheader("Pipeline Coverage — Segmento x Region")
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
            st.dataframe(rev_pivot.map(format_currency), use_container_width=True)

            st.write("**Deals por Segmento x Region**")
            st.dataframe(deals_pivot.astype(int), use_container_width=True)


# ── Page 6: Pains (detalle) ──

def page_pains_detail(df: pd.DataFrame) -> None:
    st.header("Pains — Detalle")

    pains = df[df["insight_type"] == "pain"]
    if pains.empty:
        st.info("No hay pains en los datos filtrados.")
        return

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


# ── Page 7: Product Gaps (detalle) ──

def page_product_gaps_detail(df: pd.DataFrame) -> None:
    st.header("Product Gaps — Detalle")

    gaps = df[df["insight_type"] == "product_gap"]
    if gaps.empty:
        st.info("No hay product gaps en los datos filtrados.")
        return

    col1, col2, col3 = st.columns(3)
    col1.metric("Total Gaps", len(gaps))
    col2.metric("Features Unicas", gaps["feature_name"].nunique())
    seed_count = gaps[gaps["feature_is_seed"] == True]["feature_name"].nunique() if "feature_is_seed" in gaps.columns else "?"
    col3.metric("Features Seed", seed_count)

    feature_counts = gaps["feature_display"].value_counts().head(20).reset_index()
    feature_counts.columns = ["Feature", "Frecuencia"]
    fig = px.bar(feature_counts, x="Frecuencia", y="Feature", orientation="h", title="Top 20 Features Faltantes")
    fig.update_layout(yaxis=dict(autorange="reversed"))
    st.plotly_chart(fig, use_container_width=True)

    col_left, col_right = st.columns(2)
    with col_left:
        if "gap_priority" in gaps.columns:
            priority_counts = gaps["gap_priority"].value_counts().reset_index()
            priority_counts.columns = ["Prioridad", "Cantidad"]
            fig = px.pie(priority_counts, values="Cantidad", names="Prioridad", title="Distribucion por Prioridad")
            st.plotly_chart(fig, use_container_width=True)

    with col_right:
        mod_counts = gaps["module_display"].value_counts().head(10).reset_index()
        mod_counts.columns = ["Modulo", "Cantidad"]
        fig = px.bar(mod_counts, x="Cantidad", y="Modulo", orientation="h", title="Gaps por Modulo")
        fig.update_layout(yaxis=dict(autorange="reversed"))
        st.plotly_chart(fig, use_container_width=True)

    st.subheader("Detalle de Gaps")
    display_cols = ["company_name", "feature_display", "module_display", "gap_description", "gap_priority", "confidence"]
    available_cols = [c for c in display_cols if c in gaps.columns]
    st.dataframe(gaps[available_cols], use_container_width=True)


# ── Page 8: FAQs (detalle) ──

def page_faq_detail(df: pd.DataFrame) -> None:
    st.header("FAQs — Detalle")

    faqs = df[df["insight_type"] == "faq"]
    if faqs.empty:
        st.info("No hay FAQs en los datos filtrados.")
        return

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


# ── Main ──

def dashboard():
    """Protected dashboard content — only runs after authentication."""
    st.title("Humand Sales Insights")

    df = load_data()
    filtered_df = render_sidebar(df)

    pages = {
        "Executive Summary": page_executive_summary,
        "Product Intelligence": page_product_intelligence,
        "Competitive Intelligence": page_competitive_intelligence,
        "Sales Enablement": page_sales_enablement,
        "Regional / GTM": page_regional_gtm,
        "Pains (detalle)": page_pains_detail,
        "Product Gaps (detalle)": page_product_gaps_detail,
        "FAQs (detalle)": page_faq_detail,
        "Chat con IA": page_sql_chat,
    }

    page = st.sidebar.radio("Pagina", list(pages.keys()))
    pages[page](filtered_df)

    # Footer
    st.sidebar.markdown("---")
    if not df.empty:
        st.sidebar.caption(f"{len(filtered_df)}/{len(df)} insights mostrados")


def main():
    config = load_auth_config()

    authenticator = stauth.Authenticate(
        config["credentials"],
        config["cookie"]["name"],
        config["cookie"]["key"],
        config["cookie"]["expiry_days"],
        auto_hash=False,
    )

    try:
        authenticator.login()
    except Exception as e:
        st.error(e)

    if st.session_state.get("authentication_status"):
        # Sidebar: user info + logout
        with st.sidebar:
            st.write(f"**{st.session_state.get('name')}**")
            authenticator.logout("Cerrar sesion")
            st.markdown("---")

        dashboard()

    elif st.session_state.get("authentication_status") is False:
        st.error("Usuario o contrasena incorrectos.")

    elif st.session_state.get("authentication_status") is None:
        st.info("Ingresa tu usuario y contrasena para acceder.")

    try:
        save_auth_config(config)
    except OSError:
        pass  # Read-only filesystem (Streamlit Cloud)


if __name__ == "__main__":
    main()
