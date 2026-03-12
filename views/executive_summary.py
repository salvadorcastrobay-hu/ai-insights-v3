import streamlit as st
import plotly.express as px
from shared import format_currency, chart_tooltip, load_total_transcripts_count
from computations import (
    cached_value_counts,
    cached_dedup_groupby,
    cached_unique_deals_revenue,
    cached_pains_with_pct,
)

raw_df = st.session_state.get("df")
if raw_df is None or raw_df.empty:
    st.warning("No hay datos para mostrar.")
    st.stop()

st.header("Executive Summary")

# ── Top-of-page filters ──────────────────────────────────────────────────────

with st.expander("Filtros", expanded=False):
    opts_types = sorted(raw_df["insight_type_display"].dropna().unique())
    opts_regions = sorted(raw_df["region"].dropna().unique())
    opts_segments = sorted(raw_df["segment"].dropna().unique()) if "segment" in raw_df.columns else []
    opts_countries = sorted(raw_df["country"].dropna().unique()) if "country" in raw_df.columns else []
    opts_industries = sorted(raw_df["industry"].dropna().unique()) if "industry" in raw_df.columns else []
    opts_owners = sorted(raw_df["deal_owner"].dropna().unique()) if "deal_owner" in raw_df.columns else []

    fr1, fr2, fr3 = st.columns(3)
    sel_types = fr1.multiselect("Tipo de Insight", opts_types, default=opts_types, key="es_types")
    sel_regions = fr2.multiselect("Region", opts_regions, default=opts_regions, key="es_regions")
    sel_segments = fr3.multiselect("Segmento", opts_segments, key="es_segments")

    fr4, fr5, fr6 = st.columns(3)
    sel_countries = fr4.multiselect("País", opts_countries, key="es_countries")
    sel_industries = fr5.multiselect("Industria", opts_industries, key="es_industries")
    sel_owners = fr6.multiselect("Deal Owner (AE)", opts_owners, key="es_owners")

    date_range = None
    if "call_date" in raw_df.columns:
        valid_dates = raw_df["call_date"].dropna()
        if not valid_dates.empty:
            min_d, max_d = valid_dates.min().date(), valid_dates.max().date()
            fd1, fd2 = st.columns([1, 2])
            date_range = fd1.date_input(
                "Rango de fechas",
                value=(min_d, max_d),
                min_value=min_d,
                max_value=max_d,
                key="es_dates",
            )

# Apply filters
mask = raw_df["insight_type_display"].isin(sel_types) & raw_df["region"].isin(sel_regions)
if sel_segments:
    mask &= raw_df["segment"].isin(sel_segments)
if sel_countries:
    mask &= raw_df["country"].isin(sel_countries)
if sel_industries:
    mask &= raw_df["industry"].isin(sel_industries)
if sel_owners:
    mask &= raw_df["deal_owner"].isin(sel_owners)
if date_range and isinstance(date_range, tuple) and len(date_range) == 2:
    start, end = date_range
    mask &= (raw_df["call_date"].dt.date >= start) & (raw_df["call_date"].dt.date <= end)

df = raw_df[mask].copy()

if df.empty:
    st.warning("No hay datos para los filtros seleccionados.")
    st.stop()

# ── KPIs ─────────────────────────────────────────────────────────────────────

total_calls = df["transcript_id"].nunique()
insights_per_call = round(len(df) / total_calls, 1) if total_calls > 0 else 0.0

total_transcripts = load_total_transcripts_count()
pct_with_insights = round(total_calls / total_transcripts * 100, 1) if total_transcripts > 0 else 0.0

deals_matched = df["deal_id"].dropna().nunique()
total_revenue = cached_unique_deals_revenue(df)

c1, c2, c3, c4, c5 = st.columns(5)
c1.metric(
    "Insights por Call",
    f"{insights_per_call}",
    help=(
        "Promedio de insights detectados por demo. "
        "Un insight es un pain, gap de producto, fricción, pregunta frecuente o señal competitiva "
        "extraída automáticamente de la transcripción."
    ),
)
c2.metric(
    "Transcripts",
    f"{total_calls:,}",
    help="Cantidad de transcripts únicos analizados en el recorte actual.",
)
c3.metric(
    "Deals con Match",
    f"{deals_matched:,}",
    help="Cantidad de deals únicos con al menos un insight vinculado.",
)
c4.metric(
    "Revenue Total",
    format_currency(total_revenue),
    help="Suma de monto de deal por deal_id único dentro del recorte actual.",
)
c5.metric(
    "Calls con Insights",
    f"{pct_with_insights}%",
    help="Porcentaje de demos procesadas (sobre el total en base de datos) que contienen al menos un insight detectado.",
)

# ── Composición de la muestra ─────────────────────────────────────────────────

st.subheader("Composición de la muestra analizada")
col_ind, col_seg = st.columns(2)

with col_ind:
    if "industry" in df.columns:
        ind_demos = (
            df.dropna(subset=["industry"])
            .groupby("industry")["transcript_id"]
            .nunique()
            .sort_values(ascending=False)
            .head(15)
            .reset_index()
        )
        ind_demos.columns = ["Industria", "Demos"]
        if not ind_demos.empty:
            fig = px.bar(
                ind_demos, x="Demos", y="Industria", orientation="h",
                title="Distribución por Industria",
            )
            fig.update_layout(yaxis=dict(autorange="reversed"), showlegend=False)
            chart_tooltip("Número de demos únicas por industria en el recorte actual.")
            st.plotly_chart(fig, use_container_width=True)

with col_seg:
    if "segment" in df.columns:
        seg_df = df.copy()
        seg_df["segment"] = seg_df["segment"].fillna("Desconocido")
        seg_demos = (
            seg_df.groupby("segment")["transcript_id"]
            .nunique()
            .sort_values(ascending=False)
            .reset_index()
        )
        seg_demos.columns = ["Segmento", "Demos"]
        if not seg_demos.empty:
            fig = px.bar(
                seg_demos, x="Demos", y="Segmento", orientation="h",
                title="Distribución por Segmento",
            )
            fig.update_layout(yaxis=dict(autorange="reversed"), showlegend=False)
            chart_tooltip("Número de demos únicas por segmento comercial en el recorte actual.")
            st.plotly_chart(fig, use_container_width=True)

# ── Resumen de señales detectadas (Insights por Tipo) ─────────────────────────

st.subheader("Resumen de señales detectadas")
st.caption(
    "Cantidad de insights únicos detectados en el período seleccionado. "
    "Una misma demo puede generar múltiples insights de distintos tipos."
)
type_counts = cached_value_counts(df, "insight_type_display", n=20)
type_counts.columns = ["Tipo", "Cantidad"]
fig = px.bar(
    type_counts, x="Cantidad", y="Tipo", orientation="h",
    title="Insights por Tipo", color="Tipo",
)
fig.update_layout(yaxis=dict(autorange="reversed"), showlegend=False)
chart_tooltip(
    "Distribución del total de insights por tipo.",
    "Cada fila es una detección individual. Una demo puede generar múltiples insights del mismo tipo "
    "(ej: 10 FAQs + 1 fricción + 3 pains = 14 insights en total).",
)
st.plotly_chart(fig, use_container_width=True)

# ── 1️⃣ ¿Con qué problemas llegan los clientes? ───────────────────────────────

st.subheader("¿Con qué problemas llegan los clientes?")

pains = df[df["insight_type"] == "pain"].copy()
col_pains, col_pain_insights = st.columns([2, 3])

with col_pains:
    if not pains.empty:
        top_pains = cached_pains_with_pct(pains, n=10)
        fig = px.bar(
            top_pains, x="Demos", y="Pain", orientation="h",
            title="Top 10 Pains (demos únicas)",
            text="% del total",
            hover_data=["% del total"],
        )
        fig.update_traces(textposition="outside")
        fig.update_layout(yaxis=dict(autorange="reversed"))
        chart_tooltip(
            "Ranking de los 10 pains más mencionados.",
            "Frecuencia = número de demos únicas donde se detectó el pain "
            "(no el total de detecciones). El % indica qué porción del total de demos lo mencionó.",
        )
        st.plotly_chart(fig, use_container_width=True)

with col_pain_insights:
    if not pains.empty:
        pain_module = (
            pains.dropna(subset=["module_display"])
            .groupby(["insight_subtype_display", "module_display"])["transcript_id"]
            .nunique()
            .reset_index(name="Demos")
        )
        top2_pain_names = pains["insight_subtype_display"].value_counts().head(2).index.tolist()
        if pain_module.empty or not top2_pain_names:
            st.info("Sin datos de módulos asociados a los pains.")
        else:
            st.markdown("**Pain Insights — Desglose de los 2 principales pains**")
            chart_tooltip(
                "Para cada uno de los 2 pains más frecuentes, los módulos donde más aparece.",
                "Muestra en qué áreas de producto se concentra cada pain principal.",
            )
            for pain_name in top2_pain_names:
                subset = (
                    pain_module[pain_module["insight_subtype_display"] == pain_name]
                    .nlargest(6, "Demos")
                    .reset_index(drop=True)
                )
                subset.columns = ["Pain", "Módulo", "Demos"]
                if not subset.empty:
                    fig = px.bar(
                        subset, x="Demos", y="Módulo", orientation="h",
                        title=f"Desglose: {pain_name}",
                        labels={"Módulo": "Módulo", "Demos": "Demos únicas"},
                    )
                    fig.update_layout(
                        yaxis=dict(autorange="reversed"),
                        height=240,
                        margin=dict(t=40, b=20),
                    )
                    st.plotly_chart(fig, use_container_width=True)

# Top 15 Pains × Segmento heatmap (full-width)
if not pains.empty and "segment" in pains.columns:
    pains_seg = pains.copy()
    pains_seg["segment"] = pains_seg["segment"].fillna("Desconocido")
    if not pains_seg.empty:
        top_pain_names_seg = pains_seg["insight_subtype_display"].value_counts().head(15).index
        hm_data = (
            pains_seg[pains_seg["insight_subtype_display"].isin(top_pain_names_seg)]
            .groupby(["insight_subtype_display", "segment"])
            .size()
            .reset_index(name="count")
        )
        pivot = hm_data.pivot(
            index="insight_subtype_display", columns="segment", values="count"
        ).fillna(0)
        fig = px.imshow(
            pivot, text_auto=True, aspect="auto",
            title="Top 15 Pains × Segmento",
            color_continuous_scale="Blues",
        )
        fig.update_layout(height=500)
        chart_tooltip(
            "Cruce entre pains principales y segmento comercial.",
            "Permite ver si ciertos pains son más fuertes en SMB, Mid-Market o Enterprise.",
        )
        st.plotly_chart(fig, use_container_width=True)

# ── 2️⃣ ¿Qué módulos buscan más? ──────────────────────────────────────────────

st.subheader("¿Qué módulos buscan y qué les falta?")

module_focus = df[df["insight_type"].isin(["pain", "product_gap"])].dropna(subset=["module_display"])
if not module_focus.empty:
    mod_counts = (
        module_focus.groupby("module_display")["transcript_id"]
        .nunique()
        .sort_values(ascending=False)
        .head(12)
        .reset_index()
    )
    mod_counts.columns = ["Modulo", "Demos"]
    fig = px.bar(
        mod_counts, x="Demos", y="Modulo", orientation="h",
        title="Módulos más buscados en la primera Demo",
        labels={"Modulo": "Módulo", "Demos": "Demos únicas"},
    )
    fig.update_layout(yaxis=dict(autorange="reversed"), showlegend=False)
    chart_tooltip(
        "Módulos más mencionados en pains y product gaps combinados, contando demos únicas.",
        "Refleja qué áreas de producto generan más interés o preguntas en las primeras demos.",
    )
    st.plotly_chart(fig, use_container_width=True)

col_gap_freq, col_gap_rev = st.columns(2)
with col_gap_freq:
    gaps = df[df["insight_type"] == "product_gap"]
    if not gaps.empty:
        gap_counts = cached_dedup_groupby(
            gaps, dedup_cols=("deal_id", "feature_display"),
            group_col="feature_display", agg_func="size", n=10,
        )
        gap_counts.columns = ["feature_display", "frecuencia"]
        fig = px.bar(
            gap_counts, x="frecuencia", y="feature_display", orientation="h",
            title="Top 10 Feature Gaps — Frecuencia",
            labels={"feature_display": "Feature", "frecuencia": "Frecuencia"},
        )
        fig.update_layout(yaxis=dict(autorange="reversed"))
        chart_tooltip("Top de features faltantes por frecuencia de aparición en deals únicos.")
        st.plotly_chart(fig, use_container_width=True)

with col_gap_rev:
    gaps = df[df["insight_type"] == "product_gap"]
    if not gaps.empty:
        gap_revenue = cached_dedup_groupby(
            gaps, dedup_cols=("deal_id", "feature_display"),
            group_col="feature_display", agg_col="amount", agg_func="sum", n=10,
        )
        gap_revenue.columns = ["feature_display", "amount"]
        gap_revenue["Revenue_fmt"] = gap_revenue["amount"].apply(format_currency)
        fig = px.bar(
            gap_revenue, x="amount", y="feature_display", orientation="h",
            title="Top 10 Feature Gaps — Revenue Impact",
            text="Revenue_fmt",
            labels={"feature_display": "Feature", "amount": "Revenue en Riesgo"},
        )
        fig.update_traces(textposition="outside")
        fig.update_layout(
            yaxis=dict(autorange="reversed"),
            xaxis=dict(tickformat="$,.2s"),
        )
        chart_tooltip(
            "Top de features faltantes por revenue asociado a los deals que las mencionan.",
            "Revenue asociado a deals en los que se mencionó esta feature como ausente.",
        )
        st.plotly_chart(fig, use_container_width=True)

# ── 3️⃣ ¿Qué competidores se mencionan más? ───────────────────────────────────

st.subheader("¿Qué competidores se mencionan más?")

comp = df[df["insight_type"] == "competitive_signal"].copy()
if "is_own_brand_competitor" in comp.columns:
    comp = comp[~comp["is_own_brand_competitor"].fillna(False)]
if not comp.empty:
    comp_no_na = comp.dropna(subset=["competitor_name"])
    # Order by total mentions descending
    order = comp_no_na["competitor_name"].value_counts().head(10).index.tolist()
    rel_data = comp_no_na[comp_no_na["competitor_name"].isin(order)].copy()
    rel_data["competitor_relationship_display"] = rel_data["competitor_relationship_display"].fillna("Sin clasificar")
    rel_breakdown = (
        rel_data.groupby(["competitor_name", "competitor_relationship_display"])
        .size()
        .reset_index(name="Menciones")
    )
    fig = px.bar(
        rel_breakdown,
        x="Menciones", y="competitor_name",
        color="competitor_relationship_display",
        orientation="h", barmode="stack",
        title="Top Competidores Mencionados",
        labels={
            "competitor_name": "Competidor",
            "competitor_relationship_display": "Relación",
        },
        category_orders={"competitor_name": order[::1]},
    )
    chart_tooltip(
        "Ranking de competidores más mencionados, desglosado por tipo de relación.",
        "Colores: usa actualmente, está evaluando, migrando, etc. Para análisis detallado, ir a Competitive Intelligence.",
    )
    st.plotly_chart(fig, use_container_width=True)

# ── 4️⃣ ¿Cuáles son las fricciones más recurrentes? ───────────────────────────

st.subheader("¿Cuáles son las fricciones más recurrentes en la primera demo?")

friction_all = df[df["insight_type"] == "deal_friction"].copy()
col_fric, col_fric_insights = st.columns(2)

with col_fric:
    if not friction_all.empty:
        top_frictions = (
            friction_all.groupby("insight_subtype_display")["transcript_id"]
            .nunique()
            .sort_values(ascending=False)
            .head(10)
            .reset_index()
        )
        top_frictions.columns = ["Fricción", "Demos"]
        fig = px.bar(
            top_frictions, x="Demos", y="Fricción", orientation="h",
            title="Top 10 Fricciones (demos únicas)",
        )
        fig.update_layout(yaxis=dict(autorange="reversed"))
        chart_tooltip(
            "Ranking de las 10 fricciones más frecuentes.",
            "Frecuencia = demos únicas donde se detectó la fricción.",
        )
        st.plotly_chart(fig, use_container_width=True)
    else:
        st.info("Sin datos de fricciones en el recorte actual.")

with col_fric_insights:
    if not friction_all.empty:
        top2_fric_types = (
            friction_all.groupby("insight_subtype_display")["transcript_id"]
            .nunique()
            .nlargest(2)
            .index.tolist()
        )
        breakdown_col = "deal_stage" if "deal_stage" in friction_all.columns else "segment"
        breakdown_label = "Etapa del Deal" if breakdown_col == "deal_stage" else "Segmento"
        if top2_fric_types:
            st.markdown("**Desglose de las 2 principales fricciones**")
            chart_tooltip(
                f"Para cada fricción principal, distribución por {breakdown_label.lower()}.",
                "Ayuda a los AEs a entender en qué momento del proceso aparece cada fricción.",
            )
            for fric_name in top2_fric_types:
                subset = friction_all[friction_all["insight_subtype_display"] == fric_name]
                if breakdown_col in subset.columns:
                    fric_bd = (
                        subset.dropna(subset=[breakdown_col])
                        .groupby(breakdown_col)["transcript_id"]
                        .nunique()
                        .sort_values(ascending=False)
                        .head(8)
                        .reset_index()
                    )
                    fric_bd.columns = [breakdown_label, "Demos"]
                    if not fric_bd.empty:
                        fig = px.bar(
                            fric_bd, x="Demos", y=breakdown_label, orientation="h",
                            title=f"Desglose: {fric_name}",
                            labels={breakdown_label: breakdown_label, "Demos": "Demos únicas"},
                        )
                        fig.update_layout(
                            yaxis=dict(autorange="reversed"),
                            height=240,
                            margin=dict(t=40, b=20),
                        )
                        st.plotly_chart(fig, use_container_width=True)

# Fricciones por revenue (full-width)
if not friction_all.empty and "amount" in friction_all.columns:
    fric_rev = (
        friction_all.drop_duplicates(subset=["deal_id", "insight_subtype_display"])
        .groupby("insight_subtype_display")["amount"]
        .sum()
        .sort_values(ascending=False)
        .head(10)
        .reset_index()
    )
    fric_rev.columns = ["Fricción", "Revenue"]
    if fric_rev["Revenue"].sum() > 0:
        fig = px.bar(
            fric_rev, x="Revenue", y="Fricción", orientation="h",
            title="Fricciones — Revenue en Riesgo",
            labels={"Fricción": "Tipo de Fricción", "Revenue": "Revenue en Riesgo"},
        )
        fig.update_layout(yaxis=dict(autorange="reversed"))
        chart_tooltip(
            "Revenue total en riesgo asociado a cada tipo de fricción.",
            "Calculado como suma del monto de deals únicos afectados por cada fricción.",
        )
        st.plotly_chart(fig, use_container_width=True)

# ── 5️⃣ ¿Qué preguntas aparecen siempre? ──────────────────────────────────────

st.subheader("¿Qué preguntas aparecen siempre?")

faq_all = df[df["insight_type"] == "faq"].copy()

# Pre-compute transcript→module mapping (reused in heatmap and desglose below)
transcript_modules = (
    df.dropna(subset=["module_display"])[["transcript_id", "module_display"]]
    .drop_duplicates()
)

col_faq, col_faq_insights = st.columns([2, 3])

with col_faq:
    if not faq_all.empty:
        top_faqs = (
            faq_all.groupby("insight_subtype_display")["transcript_id"]
            .nunique()
            .sort_values(ascending=False)
            .head(10)
            .reset_index()
        )
        top_faqs.columns = ["Pregunta", "Demos"]
        fig = px.bar(
            top_faqs, x="Demos", y="Pregunta", orientation="h",
            title="Top 10 Preguntas Frecuentes (demos únicas)",
        )
        fig.update_layout(yaxis=dict(autorange="reversed"))
        chart_tooltip(
            "Ranking de las 10 preguntas más frecuentes.",
            "Frecuencia = demos únicas donde apareció la pregunta.",
        )
        st.plotly_chart(fig, use_container_width=True)
    else:
        st.info("Sin datos de FAQs en el recorte actual.")

with col_faq_insights:
    if not faq_all.empty:
        # FAQs have no module tag — use co-occurrence
        faq_module = (
            faq_all[["transcript_id", "insight_subtype_display"]]
            .drop_duplicates()
            .merge(transcript_modules, on="transcript_id", how="inner")
        )
        if not faq_module.empty:
            module_faq_counts = (
                faq_module
                .groupby(["module_display", "insight_subtype_display"])["transcript_id"]
                .nunique()
                .reset_index(name="count")
            )
            top_modules_faq = (
                module_faq_counts.groupby("module_display")["count"].sum()
                .nlargest(10).index
            )
            top_faqs_global = faq_all["insight_subtype_display"].value_counts().head(6).index
            hm_faq = module_faq_counts[
                module_faq_counts["module_display"].isin(top_modules_faq) &
                module_faq_counts["insight_subtype_display"].isin(top_faqs_global)
            ]
            pivot_faq = hm_faq.pivot(
                index="module_display", columns="insight_subtype_display", values="count"
            ).fillna(0)
            fig = px.imshow(
                pivot_faq, text_auto=True, aspect="auto",
                title="FAQ Insights — Top Preguntas por Módulo",
                color_continuous_scale="Blues",
                labels=dict(x="Pregunta", y="Módulo", color="Demos"),
            )
            fig.update_layout(height=420)
            chart_tooltip(
                "Para los 10 módulos más demandados, las 6 preguntas más frecuentes.",
                "Co-ocurrencia: demos donde el módulo y la pregunta coinciden.",
            )
            st.plotly_chart(fig, use_container_width=True)

# FAQ desglose: top 2 FAQ topics × module co-occurrence
if not faq_all.empty and not transcript_modules.empty:
    top2_faq_types = faq_all["insight_subtype_display"].value_counts().head(2).index.tolist()
    if top2_faq_types:
        st.markdown("**Desglose de los 2 principales topics de FAQs por módulo co-ocurrente**")
        chart_tooltip(
            "Para cada uno de los 2 topics de FAQ más frecuentes, los módulos donde más co-ocurre.",
            "Co-ocurrencia: demos en las que aparece el topic y también se menciona el módulo.",
        )
        faq_dcol1, faq_dcol2 = st.columns(2)
        for col_d, topic in zip([faq_dcol1, faq_dcol2], top2_faq_types):
            faq_topic_modules = (
                faq_all[faq_all["insight_subtype_display"] == topic][["transcript_id"]]
                .drop_duplicates()
                .merge(transcript_modules, on="transcript_id", how="inner")
                .groupby("module_display")["transcript_id"]
                .nunique()
                .sort_values(ascending=False)
                .head(6)
                .reset_index()
            )
            faq_topic_modules.columns = ["Módulo", "Demos"]
            if not faq_topic_modules.empty:
                with col_d:
                    fig = px.bar(
                        faq_topic_modules, x="Demos", y="Módulo", orientation="h",
                        title=f"Módulos donde aparece: {topic}",
                        labels={"Módulo": "Módulo", "Demos": "Demos únicas"},
                    )
                    fig.update_layout(
                        yaxis=dict(autorange="reversed"),
                        height=280,
                        margin=dict(t=40, b=20),
                    )
                    st.plotly_chart(fig, use_container_width=True)

# ── Tendencia Mensual ─────────────────────────────────────────────────────────

st.subheader("Tendencia Mensual")
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
        chart_tooltip(
            "Evolución mensual del volumen de insights por tipo.",
            "Ayuda a detectar tendencias, estacionalidades o cambios recientes en la demanda.",
        )
        st.plotly_chart(fig, use_container_width=True)
        st.caption(
            "La caída en las últimas semanas del período puede reflejar que el dataset "
            "aún no está completo para esas fechas al momento de esta captura."
        )
