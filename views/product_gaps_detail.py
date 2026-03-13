import streamlit as st
import plotly.express as px

try:
    from shared import humanize, chart_tooltip, render_inline_filters
except ImportError:
    from shared import humanize

    def chart_tooltip(*_args, **_kwargs):
        return None

    def render_inline_filters(df, **_):
        return df

# ── 1. Load data ──────────────────────────────────────────────────────────────
raw_df = st.session_state.get("df")
if raw_df is None or raw_df.empty:
    st.warning("No hay datos para mostrar.")
    st.stop()

st.header("Product Gaps — Detalle")

# ── 2. Inline filters ─────────────────────────────────────────────────────────
df = render_inline_filters(raw_df, key_prefix="pgd")
if df.empty:
    st.warning("No hay datos para los filtros seleccionados.")
    st.stop()

# ── 3. Filter to product_gap insight_type ─────────────────────────────────────
gaps = df[df["insight_type"] == "product_gap"].copy()
if gaps.empty:
    st.info("No hay product gaps en los datos filtrados.")
    st.stop()

# ── 4. Compute derived columns BEFORE any humanize ───────────────────────────
# Truncate summary for table display (must happen before humanize)
if "summary" in gaps.columns:
    gaps["resumen"] = gaps["summary"].apply(
        lambda x: (str(x)[:120] + "...") if isinstance(x, str) and len(x) > 120 else x
    )
else:
    gaps["resumen"] = None

# Humanized priority — separate column, raw gap_priority is preserved
if "gap_priority" in gaps.columns:
    gaps["gap_priority_display"] = gaps["gap_priority"].map(humanize)
else:
    gaps["gap_priority_display"] = None

# ── A. KPIs ───────────────────────────────────────────────────────────────────
total_detecciones = len(gaps)
distinct_deals = gaps["deal_id"].nunique() if "deal_id" in gaps.columns else 0
ratio = total_detecciones / distinct_deals if distinct_deals > 0 else 0

total_unique_features = gaps["feature_display"].nunique() if "feature_display" in gaps.columns else 0
seed_features = (
    gaps[gaps["feature_is_seed"] == True]["feature_display"].nunique()
    if "feature_is_seed" in gaps.columns
    else 0
)
new_features = total_unique_features - seed_features

col1, col2, col3 = st.columns(3)
col1.metric(
    "Total Detecciones de Gaps",
    total_detecciones,
    help="Cantidad total de insights de tipo product_gap.",
)
col1.caption(f"en {distinct_deals} demos · {ratio:.1f} gaps por demo")

col2.metric(
    "Features en Taxonomía",
    seed_features,
    help="Features que ya estaban en la lista semilla de taxonomía.",
)
col2.caption("seeds definidos previamente por el equipo")

col3.metric(
    "Features Nuevas Detectadas",
    new_features,
    help="Features detectadas por el modelo que no estaban en la taxonomía semilla.",
)
col3.caption("detectadas por el modelo · revisar para ampliar taxonomía")

# ── B. Top 20 Features Faltantes (COUNT DISTINCT deal_id + priority label) ───
st.subheader("Top 20 Features Faltantes")

feature_counts = (
    gaps.groupby("feature_display")["deal_id"]
    .nunique()
    .sort_values(ascending=False)
    .head(20)
    .reset_index()
)
feature_counts.columns = ["Feature", "Deals únicos"]

# Dominant priority per feature (raw values)
if "gap_priority" in gaps.columns:
    dominant_priority = (
        gaps.groupby("feature_display")["gap_priority"]
        .agg(lambda x: x.mode()[0] if len(x) > 0 else "")
        .reset_index()
        .rename(columns={"gap_priority": "Prioridad dominante"})
    )
    priority_emoji_map = {
        "must_have": "🔴 Must Have",
        "nice_to_have": "🟡 Nice to Have",
        "dealbreaker": "🚨 Dealbreaker",
    }
    dominant_priority["Prioridad dominante"] = dominant_priority["Prioridad dominante"].map(
        priority_emoji_map
    ).fillna(dominant_priority["Prioridad dominante"])
    feature_counts = feature_counts.merge(dominant_priority, left_on="Feature", right_on="feature_display", how="left")
    text_col = feature_counts["Prioridad dominante"].tolist()
else:
    text_col = None

fig = px.bar(
    feature_counts,
    x="Deals únicos",
    y="Feature",
    orientation="h",
    title="Top 20 Features Faltantes",
)
fig.update_layout(
    yaxis=dict(autorange="reversed"),
    xaxis_title="Deals únicos (COUNT DISTINCT deal_id)",
)
if text_col is not None:
    fig.update_traces(text=text_col, textposition="outside")

chart_tooltip(
    "Ranking de features faltantes por deals únicos que la mencionaron.",
    "Indica qué funcionalidades aparecen más como brecha de producto.",
)
st.plotly_chart(fig, use_container_width=True)

# ── B2. Priority breakdown table (replaces pie chart) ─────────────────────────
if "gap_priority" in gaps.columns:
    st.subheader("Distribución por Prioridad")

    priority_definitions = {
        "must_have": {
            "label": "🔴 Must Have",
            "meaning": "El prospect indicó que es necesaria para cerrar o adoptar la plataforma",
        },
        "nice_to_have": {
            "label": "🟡 Nice to Have",
            "meaning": "Sería útil pero no es bloqueante para la decisión",
        },
        "dealbreaker": {
            "label": "🚨 Dealbreaker",
            "meaning": "La ausencia fue mencionada como razón de no avanzar con Humand",
        },
    }

    total_gaps = len(gaps)
    priority_rows = []
    for raw_key, info in priority_definitions.items():
        count = int((gaps["gap_priority"] == raw_key).sum())
        pct = round(count / total_gaps * 100, 1) if total_gaps > 0 else 0.0
        priority_rows.append(
            {
                "Prioridad": info["label"],
                "Detecciones": count,
                "% del Total": f"{pct}%",
                "Qué significa": info["meaning"],
            }
        )

    import pandas as pd
    priority_table = pd.DataFrame(priority_rows)
    st.dataframe(priority_table, use_container_width=True, hide_index=True)
    st.caption(
        "⚠️ Los Dealbreakers son el número más accionable de esta página. "
        "Representan features cuya ausencia fue razón de no avanzar."
    )

# ── B3. Prioridad de Gaps por Segmento (%) ────────────────────────────────────
if "segment" in gaps.columns and "gap_priority" in gaps.columns:
    st.subheader("Prioridad de Gaps por Segmento (%)")

    seg_pri = gaps.groupby(["segment", "gap_priority"]).size().reset_index(name="count")
    seg_total = gaps.groupby("segment")["deal_id"].nunique().reset_index(name="total_deals")

    seg_pivot = seg_pri.pivot_table(
        index="segment", columns="gap_priority", values="count", fill_value=0
    )
    seg_pct = seg_pivot.div(seg_pivot.sum(axis=1), axis=0) * 100
    seg_pct = seg_pct.reset_index()
    seg_pct = seg_pct.merge(seg_total, on="segment")

    pct_cols = [c for c in seg_pct.columns if c not in ["segment", "total_deals"]]
    seg_long = seg_pct.melt(
        id_vars=["segment", "total_deals"],
        value_vars=pct_cols,
        var_name="Prioridad",
        value_name="Porcentaje",
    )
    seg_long["Prioridad"] = seg_long["Prioridad"].map(
        {
            "must_have": "🔴 Must Have",
            "nice_to_have": "🟡 Nice to Have",
            "dealbreaker": "🚨 Dealbreaker",
        }
    ).fillna(seg_long["Prioridad"])

    fig = px.bar(
        seg_long,
        x="Porcentaje",
        y="segment",
        color="Prioridad",
        barmode="stack",
        orientation="h",
        title="Prioridad de Gaps por Segmento (%)",
        color_discrete_map={
            "🔴 Must Have": "#E53E3E",
            "🟡 Nice to Have": "#D69E2E",
            "🚨 Dealbreaker": "#9B2335",
        },
    )
    fig.update_layout(xaxis_ticksuffix="%", yaxis_title="Segmento")
    st.plotly_chart(fig, use_container_width=True)

    st.caption(
        "Total de deals únicos por segmento: "
        + " · ".join(
            f"{row['segment']}: {row['total_deals']}" for _, row in seg_pct.iterrows()
        )
    )

# ── B4. Feature Gaps por Segmento (Top 15) ────────────────────────────────────
if "segment" in gaps.columns:
    top15 = gaps["feature_display"].value_counts().head(15).index.tolist()
    seg_feat = (
        gaps[gaps["feature_display"].isin(top15)]
        .groupby(["feature_display", "segment"])["deal_id"]
        .nunique()
        .reset_index(name="Deals únicos")
    )
    if not seg_feat.empty:
        fig = px.density_heatmap(
            seg_feat,
            x="segment",
            y="feature_display",
            z="Deals únicos",
            title="Feature Gaps por Segmento (Top 15)",
            color_continuous_scale="Blues",
        )
        fig.update_layout(yaxis_title="Feature", xaxis_title="Segmento")
        chart_tooltip(
            "Deals únicos por feature y segmento.",
            "Permite ver qué features son más críticas por tamaño de empresa.",
        )
        st.plotly_chart(fig, use_container_width=True)

# ── B5. Módulos Existentes vs. Faltantes ──────────────────────────────────────
if "module_status" in gaps.columns:
    mod_status = gaps.copy()
    mod_status["module_status_display"] = mod_status["module_status"].map(humanize)
    mod_counts = (
        mod_status.groupby("module_status_display")
        .size()
        .reset_index(name="Gaps")
    )
    total_mods = mod_counts["Gaps"].sum()
    mod_counts["Porcentaje"] = (mod_counts["Gaps"] / total_mods * 100).round(1)
    mod_counts["Etiqueta"] = mod_counts.apply(
        lambda r: f"{r['Gaps']:,} ({r['Porcentaje']}%)", axis=1
    )
    existing_row = mod_counts[
        mod_counts["module_status_display"].str.contains("xist", case=False, na=False)
    ]
    existing_pct = existing_row["Porcentaje"].values[0] if not existing_row.empty else 0
    st.caption(
        f"💡 El {existing_pct:.0f}% de los feature gaps son en módulos que **YA EXISTEN** en Humand. "
        "El problema es de profundidad funcional, no de ausencia del módulo."
    )
    fig = px.bar(
        mod_counts,
        x="Gaps",
        y="module_status_display",
        orientation="h",
        text="Etiqueta",
        title="Gaps: Módulos Existentes vs. Faltantes",
        color="module_status_display",
        color_discrete_sequence=["#3182CE", "#E53E3E", "#DD6B20"],
    )
    fig.update_traces(textposition="outside")
    fig.update_layout(
        yaxis_title="",
        showlegend=False,
        yaxis=dict(autorange="reversed"),
    )
    chart_tooltip(
        "Distribución de gaps entre módulos que ya existen en Humand vs. los que faltan.",
        "Un alto porcentaje en Existente indica problema de profundidad funcional, no de cobertura.",
    )
    st.plotly_chart(fig, use_container_width=True)
else:
    # Fallback: original gaps por modulo
    mod_counts = gaps["module_display"].value_counts().head(10).reset_index()
    mod_counts.columns = ["Modulo", "Cantidad"]
    fig = px.bar(
        mod_counts,
        x="Cantidad",
        y="Modulo",
        orientation="h",
        title="Gaps por Módulo",
    )
    fig.update_layout(yaxis=dict(autorange="reversed"))
    chart_tooltip(
        "Módulos con mayor concentración de product gaps.",
        "Sirve para priorizar roadmap por área funcional.",
    )
    st.plotly_chart(fig, use_container_width=True)

# ── C. Tabla de Detalle (con filtros) ─────────────────────────────────────────
st.subheader("Detalle de Gaps")

tf1, tf2, tf3 = st.columns([2, 2, 3])

# Priority filter uses humanized display values
if "gap_priority_display" in gaps.columns:
    priority_opts = ["Todos"] + sorted(gaps["gap_priority_display"].dropna().unique().tolist())
else:
    priority_opts = ["Todos"]
selected_priority_display = tf1.selectbox(
    "Filtrar por Prioridad", priority_opts, key="pgd_table_priority"
)

module_opts = (
    ["Todos"] + sorted(gaps["module_display"].dropna().unique().tolist())
    if "module_display" in gaps.columns
    else ["Todos"]
)
selected_module = tf2.selectbox("Filtrar por Módulo", module_opts, key="pgd_table_module")

search_text = tf3.text_input(
    "Buscar en resumen",
    key="pgd_table_search",
    placeholder="palabras clave...",
)

table_gaps = gaps.copy()
if selected_priority_display != "Todos" and "gap_priority_display" in table_gaps.columns:
    table_gaps = table_gaps[table_gaps["gap_priority_display"] == selected_priority_display]
if selected_module != "Todos" and "module_display" in table_gaps.columns:
    table_gaps = table_gaps[table_gaps["module_display"] == selected_module]
if search_text and "summary" in table_gaps.columns:
    table_gaps = table_gaps[
        table_gaps["summary"].str.contains(search_text, case=False, na=False)
    ]

chart_tooltip(
    "Tabla de detalle de gaps con contexto completo.",
    "Filtrá por Prioridad para ver los Dealbreakers. Click en una fila para ver el resumen completo.",
)

display_cols = [
    "company_name",
    "feature_display",
    "module_display",
    "gap_priority_display",
    "segment",
    "country",
    "deal_stage",
    "deal_owner",
    "resumen",
]
available_cols = [c for c in display_cols if c in table_gaps.columns]
st.dataframe(table_gaps[available_cols], use_container_width=True, height=400)
