import streamlit as st
import plotly.express as px
import pandas as pd
from shared import format_currency

df = st.session_state.get("filtered_df")
if df is None or df.empty:
    st.warning("No hay datos para mostrar.")
    st.stop()

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
