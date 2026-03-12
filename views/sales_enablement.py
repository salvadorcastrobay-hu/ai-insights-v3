import streamlit as st
import plotly.express as px
import pandas as pd
try:
    from shared import format_currency, chart_tooltip, render_inline_filters
except ImportError:
    from shared import format_currency

    def chart_tooltip(*_args, **_kwargs):
        return None

    def render_inline_filters(df, **_):
        return df

raw_df = st.session_state.get("df")
if raw_df is None or raw_df.empty:
    st.warning("No hay datos para mostrar.")
    st.stop()

st.header("Sales Enablement")
df = render_inline_filters(raw_df, key_prefix="se")
if df.empty:
    st.warning("No hay datos para los filtros seleccionados.")
    st.stop()

# === Section A: ¿Qué está frenando los deals? ===
st.subheader("A. ¿Qué está frenando los deals?")
friction = df[df["insight_type"] == "deal_friction"]
if friction.empty:
    st.info("No hay fricciones de deal en los datos filtrados.")
else:
    total_fricciones = len(friction)
    deals_afectados = friction["deal_id"].dropna().nunique()

    col1, col2, col3, col4 = st.columns(4)
    col1.metric(
        "Total Fricciones",
        f"{total_fricciones:,}",
        help="Cantidad total de fricciones detectadas.",
    )
    col2.metric(
        "Deals Afectados",
        deals_afectados,
        help="Deals únicos con al menos una fricción identificada.",
    )
    fric_rev = friction.drop_duplicates("deal_id")["amount"].sum()
    col3.metric(
        "Revenue en Riesgo",
        format_currency(fric_rev),
        help="Suma de monto de deals afectados por fricciones.",
    )
    avg_fric_per_deal = round(total_fricciones / deals_afectados, 1) if deals_afectados > 0 else 0
    col4.metric(
        "Fricciones por deal",
        avg_fric_per_deal,
        help="Promedio de fricciones por deal afectado. Indica qué tan complicados son los deals.",
    )

    # Ranking of friction subtypes — side by side with breakdown of top 2
    subtype_counts = (
        friction.drop_duplicates(subset=["deal_id", "insight_subtype_display"])
        .groupby("insight_subtype_display")["deal_id"]
        .nunique()
        .reset_index(name="Deals")
        .sort_values("Deals", ascending=False)
    )
    subtype_counts.columns = ["Tipo de Friccion", "Deals"]

    fig = px.bar(
        subtype_counts,
        x="Deals",
        y="Tipo de Friccion",
        orientation="h",
        title="¿Qué está frenando más los deals?",
    )
    fig.update_layout(yaxis=dict(autorange="reversed"))
    chart_tooltip(
        "Ranking de fricciones más frecuentes (deals únicos).",
        "Muestra qué bloqueos de venta aparecen en más deals distintos.",
    )
    st.plotly_chart(fig, use_container_width=True)

    st.markdown("**Fricción Breakdown — Top 2**")
    top2_frictions = subtype_counts["Tipo de Friccion"].head(2).tolist()
    bd_cols = st.columns(len(top2_frictions)) if len(top2_frictions) > 1 else [st]
    for col, fric_name in zip(bd_cols, top2_frictions):
        fric_subset = friction[friction["insight_subtype_display"] == fric_name]
        n_deals = fric_subset["deal_id"].dropna().nunique()
        total_deals_pct = round(n_deals / deals_afectados * 100) if deals_afectados > 0 else 0
        col.markdown(f"**{fric_name}** — aparece en {n_deals} deals ({total_deals_pct}%)")
        if "summary" in fric_subset.columns:
            top_summaries = fric_subset["summary"].dropna().value_counts().head(5)
            if not top_summaries.empty:
                total_s = top_summaries.sum()
                for s_text, s_count in top_summaries.items():
                    pct = round(s_count / total_s * 100) if total_s > 0 else 0
                    short_s = s_text[:120] + "…" if len(s_text) > 120 else s_text
                    col.caption(f"• {short_s} → {pct}%")
            else:
                col.caption("_(Sin datos de summary)_")
        else:
            col.caption("_(Sin datos de summary)_")

    # Friction por segment — full width
    if "segment" in friction.columns:
        fric_seg = friction.dropna(subset=["segment"])
        if not fric_seg.empty:
            seg_data = (
                fric_seg.drop_duplicates(subset=["deal_id", "insight_subtype_display", "segment"])
                .groupby(["insight_subtype_display", "segment"])["deal_id"]
                .nunique()
                .reset_index(name="count")
            )
            fig = px.bar(
                seg_data, x="count", y="insight_subtype_display", color="segment",
                orientation="h", title="¿Varía la fricción según el tamaño de empresa?",
                labels={"insight_subtype_display": "Fricción", "count": "Deals"},
            )
            fig.update_layout(yaxis=dict(autorange="reversed"))
            chart_tooltip(
                "Fricciones cruzadas por segmento comercial (deals únicos).",
                "Permite ver si cada segmento enfrenta bloqueos distintos.",
            )
            st.plotly_chart(fig, use_container_width=True)

    # Friction por deal_stage — heatmap, full width
    if "deal_stage" in friction.columns:
        fric_stage = friction.dropna(subset=["deal_stage"])
        if not fric_stage.empty:
            hm = (
                fric_stage.drop_duplicates(subset=["deal_id", "insight_subtype_display", "deal_stage"])
                .groupby(["insight_subtype_display", "deal_stage"])["deal_id"]
                .nunique()
                .reset_index(name="count")
            )
            pivot = hm.pivot(index="insight_subtype_display", columns="deal_stage", values="count").fillna(0)
            if not pivot.empty:
                fig = px.imshow(
                    pivot, text_auto=True, aspect="auto",
                    title="¿En qué etapa del deal aparece cada fricción?",
                    labels=dict(x="Deal Stage", y="Fricción", color="Deals"),
                )
                chart_tooltip(
                    "Cruce entre tipo de fricción y etapa del deal (deals únicos).",
                    "Ayuda a detectar en qué fase del pipeline se traba cada fricción.",
                )
                st.plotly_chart(fig, use_container_width=True)
                st.info(
                    "Si una fricción aparece mucho en Discovery, es una señal de que hay que abordarla "
                    "desde el principio de la conversación. Si aparece en Final Negotiation o Postponed, "
                    "es un bloqueante tardío que necesita un argumento preparado de antemano."
                )

    # Blockers por Industria
    if "industry" in friction.columns:
        fric_ind = friction.dropna(subset=["industry"]).copy()
        if not fric_ind.empty:
            fric_ind["industry"] = fric_ind["industry"].str.replace("_", " ").str.title()
            ind_data = (
                fric_ind.drop_duplicates(subset=["deal_id", "insight_subtype_display", "industry"])
                .groupby(["insight_subtype_display", "industry"])["deal_id"]
                .nunique()
                .reset_index(name="count")
            )
            pivot_ind = ind_data.pivot(
                index="insight_subtype_display", columns="industry", values="count"
            ).fillna(0)
            if not pivot_ind.empty:
                fig = px.imshow(
                    pivot_ind, text_auto=True, aspect="auto",
                    title="¿Qué fricción predomina según la industria?",
                    labels=dict(x="Industria", y="Fricción", color="Deals"),
                )
                chart_tooltip(
                    "Heatmap de fricciones por industria (deals únicos).",
                    "Permite adaptar el pitch según el sector del prospect.",
                )
                st.plotly_chart(fig, use_container_width=True)

# === Section B: ¿Qué AEs necesitan más soporte? ===
st.subheader("B. ¿Qué AEs necesitan más soporte?")
if "deal_owner" in df.columns:
    ae_data = df.dropna(subset=["deal_owner"])
    if not ae_data.empty:
        # Base metrics per AE
        ae_metrics = ae_data.groupby("deal_owner").agg(
            total_insights=("id", "count"),
            total_deals=("deal_id", "nunique"),
            avg_amount=("amount", "mean"),
        ).reset_index()

        # Friction metrics per AE
        ae_fric_base = ae_data[ae_data["insight_type"] == "deal_friction"]
        ae_fric_metrics = (
            ae_fric_base.groupby("deal_owner").agg(
                total_fricciones=("id", "count"),
            ).reset_index()
        )
        # Deals with at least one friction per AE
        ae_deals_with_fric = (
            ae_fric_base.drop_duplicates(subset=["deal_owner", "deal_id"])
            .groupby("deal_owner")["deal_id"]
            .nunique()
            .reset_index(name="deals_con_friccion")
        )

        # Top friction per AE
        ae_friction = (
            ae_fric_base
            .groupby("deal_owner")["insight_subtype_display"]
            .agg(lambda x: x.value_counts().index[0] if len(x) > 0 else "")
            .reset_index()
            .rename(columns={"insight_subtype_display": "top_friction"})
        )
        # Top competitor per AE
        ae_comp_base = ae_data[ae_data["insight_type"] == "competitive_signal"].copy()
        if "is_own_brand_competitor" in ae_comp_base.columns:
            ae_comp_base = ae_comp_base[~ae_comp_base["is_own_brand_competitor"].fillna(False)]
        ae_comp = (
            ae_comp_base
            .dropna(subset=["competitor_name"])
            .groupby("deal_owner")["competitor_name"]
            .agg(lambda x: x.value_counts().index[0] if len(x) > 0 else "")
            .reset_index()
            .rename(columns={"competitor_name": "top_competitor"})
        )

        ae_table = (
            ae_metrics
            .merge(ae_fric_metrics, on="deal_owner", how="left")
            .merge(ae_deals_with_fric, on="deal_owner", how="left")
            .merge(ae_friction, on="deal_owner", how="left")
            .merge(ae_comp, on="deal_owner", how="left")
        )
        ae_table["total_fricciones"] = ae_table["total_fricciones"].fillna(0)
        ae_table["deals_con_friccion"] = ae_table["deals_con_friccion"].fillna(0)

        ae_table["fricciones_por_deal"] = (
            ae_table["total_fricciones"] / ae_table["total_deals"].replace(0, pd.NA)
        ).round(1)
        ae_table["pct_deals_con_friccion"] = (
            ae_table["deals_con_friccion"] / ae_table["total_deals"].replace(0, pd.NA) * 100
        ).round(0).astype("Int64").astype(str) + "%"

        ae_table["avg_amount"] = ae_table["avg_amount"].apply(lambda x: format_currency(x) if pd.notna(x) else "$0")
        ae_table = ae_table.sort_values("fricciones_por_deal", ascending=False)
        ae_table = ae_table[[
            "deal_owner", "total_deals", "avg_amount",
            "fricciones_por_deal", "pct_deals_con_friccion",
            "top_friction", "top_competitor",
        ]]
        ae_table.columns = [
            "AE", "Deals", "Avg Amount",
            "Fricc/deal", "% c/fricción",
            "Top Fricción", "Top Competidor",
        ]
        chart_tooltip(
            "Tabla comparativa de AEs ordenada por fricciones promedio por deal (de mayor a menor).",
            "El AE con más fricciones/deal es quien más soporte de coaching necesita.",
        )
        st.caption("Ordenado por fricciones promedio por deal — el AE con más complejidad aparece primero")
        st.dataframe(ae_table, use_container_width=True)

        # Bar chart: frictions per AE ordered by total frictions descending
        ae_fric_data = ae_data[ae_data["insight_type"] == "deal_friction"]
        if not ae_fric_data.empty:
            ae_fric_totals = ae_fric_data["deal_owner"].value_counts().head(10)
            top_aes = ae_fric_totals.index
            fric_by_ae = (
                ae_fric_data[ae_fric_data["deal_owner"].isin(top_aes)]
                .groupby(["deal_owner", "insight_subtype_display"]).size()
                .reset_index(name="count")
            )
            # Sort y axis by total frictions descending
            ae_order = ae_fric_totals.index.tolist()
            fig = px.bar(
                fric_by_ae,
                x="count",
                y="deal_owner",
                color="insight_subtype_display",
                orientation="h",
                title="¿Qué tipo de fricciones enfrenta cada AE?",
                category_orders={"deal_owner": ae_order},
            )
            fig.update_layout(yaxis=dict(autorange="reversed"))
            chart_tooltip(
                "Distribución de fricciones por AE, ordenado por total de fricciones descendente.",
                "Si un AE tiene muchas fricciones de un tipo, necesita argumentos específicos para ese bloqueo.",
            )
            st.plotly_chart(fig, use_container_width=True)
else:
    st.info("No hay datos de deal_owner disponibles.")

# === Section C: ¿Qué preguntan los prospects? (Battle Cards) ===
st.subheader("C. ¿Qué preguntan los prospects? (Battle Cards)")

st.info(
    "Estas son las preguntas que los prospects hacen más frecuentemente en las primeras demos. "
    "Usá esta sección para preparar respuestas antes de una llamada. "
    "Las integraciones y los precios son los temas más frecuentes — si tu próxima demo es con una empresa enterprise, "
    "revisá también seguridad y compliance regulatorio."
)

faqs = df[df["insight_type"] == "faq"]
if faqs.empty:
    st.info("No hay FAQs en los datos filtrados.")
else:
    topic_counts = (
        faqs.drop_duplicates(subset=["transcript_id", "insight_subtype_display"])
        .groupby("insight_subtype_display")["transcript_id"]
        .nunique()
        .reset_index(name="Demos")
        .sort_values("Demos", ascending=False)
    )
    topic_counts.columns = ["Topic", "Demos"]

    fig = px.bar(
        topic_counts,
        x="Demos",
        y="Topic",
        orientation="h",
        title="¿Qué temas preguntan más los prospects?",
    )
    fig.update_layout(yaxis=dict(autorange="reversed"))
    chart_tooltip(
        "Ranking de temas de FAQ más consultados (demos únicas).",
        "Se usa para priorizar materiales de enablement y battle cards.",
    )
    st.plotly_chart(fig, use_container_width=True)

    st.markdown("**FAQ Breakdown — Top 2 topics**")
    top2_topics = topic_counts["Topic"].head(2).tolist()
    faq_bd_cols = st.columns(len(top2_topics)) if len(top2_topics) > 1 else [st]
    for col, topic_name in zip(faq_bd_cols, top2_topics):
        topic_subset = faqs[faqs["insight_subtype_display"] == topic_name]
        n_demos = topic_subset["transcript_id"].dropna().nunique()
        col.markdown(f"**{topic_name}** — aparece en {n_demos} demos")
        if "summary" in topic_subset.columns:
            faq_questions = topic_subset["summary"].dropna().value_counts().head(5)
            if not faq_questions.empty:
                total_q = faq_questions.sum()
                for q_text, q_count in faq_questions.items():
                    pct = round(q_count / total_q * 100) if total_q > 0 else 0
                    short_q = q_text[:120] + "…" if len(q_text) > 120 else q_text
                    col.caption(f"• {short_q} → {pct}%")
            else:
                col.caption("_(Sin preguntas disponibles)_")
        else:
            col.caption("_(Sin datos de summary)_")

    st.subheader("Preguntas y Respuestas por Topic")
    st.caption("Filtrá por topic para prepararte antes de una demo")

    available_topics = ["Todos"] + topic_counts["Topic"].tolist()
    selected_topic = st.selectbox("Filtrar por topic", available_topics)

    display_cols = ["company_name", "insight_subtype_display", "summary", "verbatim_quote"]
    available_cols = [c for c in display_cols if c in faqs.columns]

    faqs_display = faqs if selected_topic == "Todos" else faqs[faqs["insight_subtype_display"] == selected_topic]

    col_rename = {
        "company_name": "Empresa",
        "insight_subtype_display": "Topic",
        "summary": "Pregunta",
        "verbatim_quote": "Cita textual",
    }
    faqs_display = faqs_display[available_cols].rename(columns=col_rename)

    chart_tooltip(
        "Detalle textual de preguntas y respuestas detectadas en llamadas.",
        "Útil para crear argumentos y respuestas tipo por tema.",
    )
    st.dataframe(
        faqs_display,
        use_container_width=True,
        column_config={
            "Pregunta": st.column_config.TextColumn("Pregunta", width="large"),
            "Cita textual": st.column_config.TextColumn("Cita textual", width="large"),
        },
    )
