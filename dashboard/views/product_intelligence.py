import streamlit as st
import plotly.express as px
from shared import humanize, chart_tooltip, render_inline_filters
from computations import cached_value_counts, cached_dedup_groupby

raw_df = st.session_state.get("df")
if raw_df is None or raw_df.empty:
    st.warning("No hay datos para mostrar.")
    st.stop()

df = render_inline_filters(raw_df, key_prefix="pi")
if df.empty:
    st.warning("No hay datos para los filtros seleccionados.")
    st.stop()

st.header("Product Intelligence")

# === Section A: Pains ===
st.subheader("A. Pains")
pains = df[df["insight_type"] == "pain"].copy()
if pains.empty:
    st.info("No hay pains en los datos filtrados.")
else:
    pains["pain_theme"] = pains["pain_theme"].map(humanize)
    # Top 15 pains
    top_pains = cached_value_counts(pains, "insight_subtype_display", n=15)
    top_pains.columns = ["Pain", "Frecuencia"]
    fig = px.bar(top_pains, x="Frecuencia", y="Pain", orientation="h", title="Top 15 Pains")
    fig.update_layout(yaxis=dict(autorange="reversed"))
    chart_tooltip(
        "Ranking de los pains más repetidos en el recorte actual.",
        "Muestra cuáles son los dolores más urgentes desde la voz del cliente.",
    )
    st.plotly_chart(fig, use_container_width=True)

    col_left, col_right = st.columns(2)
    with col_left:
        theme_counts = cached_value_counts(pains, "pain_theme", n=50)
        theme_counts.columns = ["Theme", "Cantidad"]
        fig = px.bar(theme_counts, x="Theme", y="Cantidad", title="Pains por Theme", color="Theme")
        fig.update_layout(showlegend=False)
        chart_tooltip(
            "Volumen de pains agrupados por tema macro (procesos, tecnología, comunicación, etc.).",
            "Sirve para entender qué dimensión del problema domina.",
        )
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
                fig.update_layout(height=620)
                chart_tooltip(
                    "Cruce entre pains principales y segmento comercial.",
                    "Permite ver si ciertos pains son más fuertes en SMB, Mid-Market o Enterprise.",
                )
                st.plotly_chart(fig, use_container_width=True)

    col_left, col_right = st.columns(2)
    with col_left:
        if "industry" in pains.columns and "pain_theme" in pains.columns:
            pains_ind = pains.dropna(subset=["industry", "pain_theme"])
            if not pains_ind.empty:
                top_industries = pains_ind["industry"].value_counts().head(10).index
                pain_industry = (
                    pains_ind[pains_ind["industry"].isin(top_industries)]
                    .groupby(["industry", "pain_theme"])
                    .size()
                    .reset_index(name="count")
                )
                fig = px.bar(
                    pain_industry,
                    x="count",
                    y="industry",
                    color="pain_theme",
                    orientation="h",
                    barmode="stack",
                    title="Pains por Industria (Top 10)",
                    labels={"count": "Menciones", "industry": "Industria", "pain_theme": "Tema de pain"},
                )
                fig.update_layout(yaxis=dict(autorange="reversed"))
                chart_tooltip(
                    "Desglose de pains por industria, segmentado por tema.",
                    "Permite identificar qué narrativa duele más en cada vertical.",
                )
                st.plotly_chart(fig, use_container_width=True)

    with col_right:
        module_focus = df[
            df["insight_type"].isin(["pain", "product_gap"])
        ].dropna(subset=["module_display", "segment"])
        if not module_focus.empty:
            top_modules = module_focus["module_display"].value_counts().head(12).index
            module_segment = (
                module_focus[module_focus["module_display"].isin(top_modules)]
                .groupby(["module_display", "segment"])
                .size()
                .reset_index(name="count")
            )
            fig = px.bar(
                module_segment,
                x="count",
                y="module_display",
                color="segment",
                orientation="h",
                barmode="stack",
                title="Demanda de Modulos por Segmento",
                labels={"count": "Menciones", "module_display": "Modulo", "segment": "Segmento"},
            )
            fig.update_layout(yaxis=dict(autorange="reversed"))
            chart_tooltip(
                "Módulos más demandados por segmento a partir de pains y product gaps.",
                "Ayuda a priorizar mensaje comercial por tipo de cliente.",
            )
            st.plotly_chart(fig, use_container_width=True)

    module_focus_industry = df[
        df["insight_type"].isin(["pain", "product_gap"])
    ].dropna(subset=["module_display", "industry"])
    if not module_focus_industry.empty:
        top_modules = module_focus_industry["module_display"].value_counts().head(10).index
        top_industries = module_focus_industry["industry"].value_counts().head(8).index
        module_industry = (
            module_focus_industry[
                module_focus_industry["module_display"].isin(top_modules)
                & module_focus_industry["industry"].isin(top_industries)
            ]
            .groupby(["module_display", "industry"])
            .size()
            .reset_index(name="count")
        )
        fig = px.bar(
            module_industry,
            x="count",
            y="module_display",
            color="industry",
            orientation="h",
            barmode="stack",
            title="Demanda de Modulos por Industria",
            labels={"count": "Menciones", "module_display": "Modulo", "industry": "Industria"},
        )
        fig.update_layout(yaxis=dict(autorange="reversed"))
        chart_tooltip(
            "Cruce entre módulos demandados e industria.",
            "Sirve para orientar campañas y assets por vertical.",
        )
        st.plotly_chart(fig, use_container_width=True)

    # Top pains por modulo (deals unicos)
    module_pains = pains.dropna(subset=["module_display"])
    if not module_pains.empty:
        mod_counts = (
            module_pains.drop_duplicates(subset=["deal_id", "module_display"])
            .groupby("module_display")
            .size()
            .reset_index(name="deals_unicos")
            .sort_values("deals_unicos", ascending=False)
            .head(15)
        )
        if mod_counts["deals_unicos"].sum() == 0:
            mod_counts = (
                module_pains.groupby("module_display")
                .size()
                .reset_index(name="menciones")
                .sort_values("menciones", ascending=False)
                .head(15)
            )
            x_col = "menciones"
            x_label = "Menciones"
        else:
            x_col = "deals_unicos"
            x_label = "Deals unicos"

        fig = px.bar(
            mod_counts,
            x=x_col,
            y="module_display",
            orientation="h",
            title="Pains por Modulo (Top 15)",
            labels={"module_display": "Modulo", x_col: x_label},
        )
        fig.update_layout(yaxis=dict(autorange="reversed"))
        chart_tooltip(
            "Cantidad de deals únicos que mencionan pains asociados a cada módulo.",
        )
        st.plotly_chart(fig, use_container_width=True)

    @st.fragment
    def _pain_detail_fragment():
        st.subheader("Detalle por Pain")
        pain_options = top_pains["Pain"].tolist()
        selected_pain = st.selectbox(
            "Seleccioná un pain para ver el detalle",
            pain_options,
            key="product_intelligence_pain_detail",
        )
        pains_detail = pains[pains["insight_subtype_display"] == selected_pain]
        pain_detail_cols = [
            "company_name",
            "industry",
            "segment",
            "country",
            "module_display",
            "summary",
            "verbatim_quote",
            "confidence",
        ]
        available_pain_detail_cols = [c for c in pain_detail_cols if c in pains_detail.columns]
        chart_tooltip(
            "Detalle textual del pain seleccionado con contexto de compañía/segmento/país.",
        )
        st.dataframe(
            pains_detail[available_pain_detail_cols].sort_values("confidence", ascending=False),
            width="stretch",
            height=400,
        )

    _pain_detail_fragment()

# === Section B: Feature Gaps ===
st.subheader("B. Feature Gaps")
gaps = df[df["insight_type"] == "product_gap"].copy()
if gaps.empty:
    st.info("No hay product gaps en los datos filtrados.")
else:
    if "gap_priority" in gaps.columns:
        gaps["gap_priority"] = gaps["gap_priority"].map(humanize)
    if "module_status" in gaps.columns:
        gaps["module_status"] = gaps["module_status"].map(humanize)
    # Top 20 features
    feature_counts = cached_value_counts(gaps, "feature_display", n=20)
    feature_counts.columns = ["Feature", "Frecuencia"]
    fig = px.bar(feature_counts, x="Frecuencia", y="Feature", orientation="h", title="Top 20 Features Faltantes")
    fig.update_layout(yaxis=dict(autorange="reversed"))
    chart_tooltip(
        "Top de funcionalidades faltantes más mencionadas.",
        "Indica qué gaps aparecen más veces en procesos de venta.",
    )
    st.plotly_chart(fig, use_container_width=True)

    col_left, col_right = st.columns(2)
    with col_left:
        if "gap_priority" in gaps.columns and "segment" in gaps.columns:
            priority_seg = (
                gaps.dropna(subset=["gap_priority", "segment"])
                .groupby(["segment", "gap_priority"])
                .size()
                .reset_index(name="count")
            )
            if not priority_seg.empty:
                fig = px.bar(
                    priority_seg,
                    x="count",
                    y="segment",
                    color="gap_priority",
                    orientation="h",
                    barmode="stack",
                    title="Prioridad de Gaps por Segmento",
                    labels={
                        "segment": "Segmento",
                        "count": "Cantidad",
                        "gap_priority": "Prioridad",
                    },
                )
                chart_tooltip(
                    "Desglose de prioridades de feature gaps por segmento comercial.",
                )
                st.plotly_chart(fig, use_container_width=True)
        elif "gap_priority" in gaps.columns:
            priority_counts = gaps["gap_priority"].value_counts().reset_index()
            priority_counts.columns = ["Prioridad", "Cantidad"]
            fig = px.bar(priority_counts, x="Cantidad", y="Prioridad", orientation="h", title="Distribucion por Prioridad")
            fig.update_layout(yaxis=dict(autorange="reversed"))
            chart_tooltip(
                "Distribución general de prioridades de feature gaps.",
            )
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
                chart_tooltip(
                    "Features faltantes cruzadas por segmento comercial.",
                    "Revela si la demanda de funcionalidades cambia según tipo de cliente.",
                )
                st.plotly_chart(fig, use_container_width=True)

    # Revenue at stake
    gap_rev = cached_dedup_groupby(
        gaps, dedup_cols=("deal_id", "feature_display"),
        group_col="feature_display", agg_col="amount", agg_func="sum", n=10,
    )
    gap_rev.columns = ["Feature", "Revenue at Stake"]
    if gap_rev["Revenue at Stake"].sum() > 0:
        fig = px.bar(
            gap_rev, x="Revenue at Stake", y="Feature", orientation="h",
            title="Revenue at Stake — Top 10 Features",
        )
        fig.update_layout(yaxis=dict(autorange="reversed"))
        chart_tooltip(
            "Revenue potencial comprometido por cada feature faltante.",
            "Permite priorizar por impacto económico además de frecuencia.",
        )
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
            chart_tooltip(
                "Comparación de gaps en módulos existentes vs faltantes.",
                "Ayuda a decidir entre mejorar capacidades actuales o construir nuevas.",
            )
            st.plotly_chart(fig, use_container_width=True)

    @st.fragment
    def _feature_gap_detail_fragment():
        st.subheader("Detalle por Feature Gap")
        feature_options = feature_counts["Feature"].tolist()
        selected_feature = st.selectbox(
            "Seleccioná una feature para ver el detalle",
            feature_options,
            key="product_intelligence_feature_detail",
        )
        gap_detail = gaps[gaps["feature_display"] == selected_feature]
        gap_detail_cols = [
            "company_name",
            "industry",
            "segment",
            "country",
            "module_display",
            "gap_priority",
            "summary",
            "verbatim_quote",
            "confidence",
        ]
        available_gap_detail_cols = [c for c in gap_detail_cols if c in gap_detail.columns]
        chart_tooltip(
            "Detalle textual de la feature seleccionada con contexto de cliente y mercado.",
        )
        st.dataframe(
            gap_detail[available_gap_detail_cols].sort_values("confidence", ascending=False),
            width="stretch",
            height=400,
        )

    _feature_gap_detail_fragment()
