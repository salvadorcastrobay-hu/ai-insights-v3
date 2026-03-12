import streamlit as st
import plotly.express as px
from shared import humanize, chart_tooltip, render_inline_filters
from computations import cached_value_counts, cached_dedup_groupby, cached_pains_with_pct

raw_df = st.session_state.get("df")
if raw_df is None or raw_df.empty:
    st.warning("No hay datos para mostrar.")
    st.stop()

df = render_inline_filters(raw_df, key_prefix="pi")
if df.empty:
    st.warning("No hay datos para los filtros seleccionados.")
    st.stop()

st.header("Product Intelligence")

# ============================================================
# === Section A: ¿Con qué problemas llegan los prospects? ===
# ============================================================
st.subheader("A. ¿Con qué problemas llegan los prospects?")
pains = df[df["insight_type"] == "pain"].copy()
if pains.empty:
    st.info("No hay pains en los datos filtrados.")
else:
    pains["pain_theme"] = pains["pain_theme"].map(humanize)

    # Top 15 Pains (demos únicas + % del total) — side by side with Pain Breakdown
    top_pains_pct = cached_pains_with_pct(pains, n=15)
    # Also keep a simple list for the detail selector
    top_pain_names = top_pains_pct["Pain"].tolist()

    col_left, col_right = st.columns([3, 2])
    with col_left:
        fig = px.bar(
            top_pains_pct,
            x="Demos",
            y="Pain",
            orientation="h",
            title="Top 15 Pains",
            hover_data={"% del total": True},
            labels={"Demos": "Demos únicas"},
        )
        fig.update_layout(yaxis=dict(autorange="reversed"))
        chart_tooltip(
            "Ranking de los pains más frecuentes. Cada barra = demos únicas donde se detectó el pain.",
            "El % del total indica qué fracción de todas las demos analizadas mencionó ese pain.",
        )
        st.plotly_chart(fig, use_container_width=True, key="pi_top15_pains")

    with col_right:
        st.markdown("**Pain Breakdown — Top 2**")
        for pain_name in top_pain_names[:2]:
            pain_sub = pains[pains["insight_subtype_display"] == pain_name].dropna(subset=["module_display"])
            if pain_sub.empty:
                continue
            mod_breakdown = (
                pain_sub.groupby("module_display")["transcript_id"]
                .nunique()
                .sort_values(ascending=False)
                .head(6)
                .reset_index()
            )
            mod_breakdown.columns = ["Módulo", "Demos"]
            total = mod_breakdown["Demos"].sum()
            if total > 0:
                mod_breakdown["% dentro del pain"] = (mod_breakdown["Demos"] / total * 100).round(1).astype(str) + "%"
            else:
                mod_breakdown["% dentro del pain"] = "0%"
            fig = px.bar(
                mod_breakdown,
                x="Demos",
                y="Módulo",
                orientation="h",
                title=f"📌 {pain_name}",
                hover_data={"% dentro del pain": True},
                labels={"Demos": "Demos únicas"},
            )
            fig.update_layout(
                yaxis=dict(autorange="reversed"),
                margin=dict(l=0, r=0, t=40, b=0),
                height=220,
            )
            st.plotly_chart(fig, use_container_width=True, key=f"pi_pain_breakdown_{pain_name}")

    # Heatmap: Top 15 Pains × Segmento — full width
    if "segment" in pains.columns:
        pains_seg = pains.fillna({"segment": "Desconocido"})
        if not pains_seg.empty:
            top_pain_labels = pains_seg["insight_subtype_display"].value_counts().head(15).index
            hm_data = (
                pains_seg[pains_seg["insight_subtype_display"].isin(top_pain_labels)]
                .groupby(["insight_subtype_display", "segment"])["transcript_id"]
                .nunique()
                .reset_index(name="count")
            )
            pivot = hm_data.pivot(index="insight_subtype_display", columns="segment", values="count").fillna(0)
            fig = px.imshow(
                pivot, text_auto=True, aspect="auto",
                title="¿Varía el pain según el tamaño de empresa?",
                labels=dict(x="Segmento", y="Pain", color="Demos únicas"),
            )
            fig.update_layout(height=620)
            chart_tooltip(
                "Cruce entre pains principales y segmento comercial. Unidad: demos únicas.",
                "Permite ver si ciertos pains son más fuertes en SMB, Mid-Market o Enterprise.",
            )
            st.plotly_chart(fig, use_container_width=True, key="pi_pains_segmento")

    # Pains por Industria — full width, fixed labels
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
                title="¿Varía el pain según la industria?",
                labels={"count": "Menciones", "industry": "Industria", "pain_theme": "Tema de pain"},
            )
            fig.update_layout(yaxis=dict(autorange="reversed", automargin=True))
            chart_tooltip(
                "Desglose de pains por industria, segmentado por tema.",
                "Permite identificar qué narrativa duele más en cada vertical.",
            )
            st.plotly_chart(fig, use_container_width=True, key="pi_pains_industria")

    # Pains por Theme — moved to bottom of Section A as context
    theme_counts = pains["pain_theme"].value_counts().reset_index()
    theme_counts.columns = ["Theme", "Cantidad"]
    fig = px.bar(theme_counts, x="Theme", y="Cantidad", title="Pains por Theme", color="Theme")
    fig.update_layout(showlegend=False)
    chart_tooltip(
        "Volumen de pains agrupados por tema macro (procesos, tecnología, comunicación, etc.).",
        "Referencia adicional: muestra qué dimensión del problema domina en el total.",
    )
    st.plotly_chart(fig, use_container_width=True, key="pi_pains_theme")

    @st.fragment
    def _pain_detail_fragment():
        st.subheader("Detalle por Pain")
        pain_options = top_pain_names
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

# ============================================================
# === Section B: ¿Qué módulos y features buscan los prospects? ===
# ============================================================
st.subheader("B. ¿Qué módulos y features buscan los prospects?")
gaps = df[df["insight_type"] == "product_gap"].copy()

# --- Demanda de Módulos (moved from Section A) ---
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
        title="Módulos más buscados en la primera demo",
        labels={"count": "Menciones", "module_display": "Módulo", "segment": "Segmento"},
    )
    fig.update_layout(yaxis=dict(autorange="reversed"))
    chart_tooltip(
        "Módulos más demandados por segmento a partir de pains y product gaps.",
        "Ayuda a priorizar mensaje comercial por tipo de cliente.",
    )
    st.plotly_chart(fig, use_container_width=True, key="pi_modulos_segmento")

# --- Feature Gaps charts ---
if gaps.empty:
    st.info("No hay product gaps en los datos filtrados.")
else:
    if "gap_priority" in gaps.columns:
        gaps["gap_priority"] = gaps["gap_priority"].map(humanize)
    if "module_status" in gaps.columns:
        gaps["module_status"] = gaps["module_status"].map(humanize)

    # Top 20 features (frequency) + Revenue at Stake — side by side
    feature_counts = cached_value_counts(gaps, "feature_display", n=20)
    feature_counts.columns = ["Feature", "Frecuencia"]

    gap_rev = cached_dedup_groupby(
        gaps, dedup_cols=("deal_id", "feature_display"),
        group_col="feature_display", agg_col="amount", agg_func="sum", n=10,
    )
    gap_rev.columns = ["Feature", "Revenue at Stake"]

    col_left, col_right = st.columns(2)
    with col_left:
        fig = px.bar(
            feature_counts, x="Frecuencia", y="Feature", orientation="h",
            title="¿Qué nos piden que no tenemos? (por frecuencia)",
        )
        fig.update_layout(yaxis=dict(autorange="reversed"))
        chart_tooltip(
            "Top de funcionalidades faltantes más mencionadas.",
            "Indica qué gaps aparecen más veces en procesos de venta.",
        )
        st.plotly_chart(fig, use_container_width=True, key="pi_feature_freq")

    with col_right:
        if gap_rev["Revenue at Stake"].sum() > 0:
            fig = px.bar(
                gap_rev, x="Revenue at Stake", y="Feature", orientation="h",
                title="Revenue at Stake — Top 10",
            )
            fig.update_layout(yaxis=dict(autorange="reversed"))
            chart_tooltip(
                "Revenue potencial comprometido por cada feature faltante.",
                "Permite priorizar por impacto económico además de frecuencia.",
            )
            st.plotly_chart(fig, use_container_width=True, key="pi_rev_preview")

    # Feature gaps por segmento — full width
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
                orientation="h", title="¿Qué nos falta según el tamaño de empresa?",
            )
            fig.update_layout(yaxis=dict(autorange="reversed"))
            chart_tooltip(
                "Features faltantes cruzadas por segmento comercial.",
                "Revela si la demanda de funcionalidades cambia según tipo de cliente.",
            )
            st.plotly_chart(fig, use_container_width=True, key="pi_gaps_segmento")

    # Priority table — replaces pie/bar chart
    if "gap_priority" in gaps.columns:
        priority_desc = {
            "Must Have": "El prospect no avanza sin esto",
            "Nice to Have": "Lo pide pero no es bloqueante",
            "Dealbreaker": "Perdimos deals por esto",
        }
        priority_counts_raw = gaps["gap_priority"].value_counts().reset_index()
        priority_counts_raw.columns = ["Prioridad", "Cantidad de features"]
        priority_counts_raw["Descripción"] = priority_counts_raw["Prioridad"].map(
            lambda p: priority_desc.get(p, "")
        )
        st.markdown("**Distribución por prioridad de gaps**")
        st.dataframe(priority_counts_raw, width="stretch", hide_index=True)

    @st.fragment
    def _feature_gap_detail_fragment():
        st.subheader("Detalle por Feature Gap")
        st.caption("Seleccioná una feature para ver qué empresas la pidieron, en qué industria y segmento.")
        feature_options = feature_counts["Feature"].tolist()
        selected_feature = st.selectbox(
            "Feature",
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
            "amount",
            "summary",
            "verbatim_quote",
            "confidence",
        ]
        available_gap_detail_cols = [c for c in gap_detail_cols if c in gap_detail.columns]
        sort_col = "amount" if "amount" in gap_detail.columns else "confidence"
        chart_tooltip(
            "Detalle textual de la feature seleccionada con contexto de cliente y mercado.",
        )
        st.dataframe(
            gap_detail[available_gap_detail_cols].sort_values(sort_col, ascending=False),
            width="stretch",
            height=400,
        )

    _feature_gap_detail_fragment()

# ============================================================
# === Section C: ¿Cuánto revenue estamos dejando ir? ===
# ============================================================
if not gaps.empty and gap_rev["Revenue at Stake"].sum() > 0:
    st.subheader("C. ¿Cuánto revenue estamos dejando ir por lo que no tenemos?")
    st.caption(
        "El revenue at stake es el pipeline total de deals donde se mencionó esa feature como faltante. "
        "No es revenue perdido confirmado — es revenue en riesgo si el gap no se resuelve."
    )

    col_left, col_right = st.columns(2)
    with col_left:
        fig = px.bar(
            gap_rev, x="Revenue at Stake", y="Feature", orientation="h",
            title="Revenue at Stake — Top 10 Features",
        )
        fig.update_layout(yaxis=dict(autorange="reversed"))
        chart_tooltip(
            "Revenue potencial comprometido por cada feature faltante.",
            "Permite priorizar por impacto económico además de frecuencia.",
        )
        st.plotly_chart(fig, use_container_width=True, key="pi_rev_main")

    with col_right:
        if "gap_priority" in gaps.columns:
            priority_desc = {
                "Must Have": "El prospect no avanza sin esto",
                "Nice to Have": "Lo pide pero no es bloqueante",
                "Dealbreaker": "Perdimos deals por esto",
            }
            # Count unique features + revenue sum per priority
            prio_summary = (
                gaps.drop_duplicates(subset=["deal_id", "feature_display"])
                .groupby("gap_priority")
                .agg(
                    Features=("feature_display", "nunique"),
                    Revenue=("amount", "sum"),
                )
                .reset_index()
                .rename(columns={"gap_priority": "Prioridad"})
            )
            prio_summary["Descripción"] = prio_summary["Prioridad"].map(
                lambda p: priority_desc.get(p, "")
            )
            prio_summary["Revenue"] = prio_summary["Revenue"].apply(
                lambda v: f"${v:,.0f}" if v > 0 else "—"
            )
            st.markdown("**Prioridad de gaps**")
            st.dataframe(prio_summary[["Prioridad", "Features", "Revenue", "Descripción"]], width="stretch", hide_index=True)
        else:
            st.info("No hay datos de prioridad disponibles para este filtro.")
