import streamlit as st
import plotly.express as px
import pandas as pd
import streamlit.components.v1 as components

try:
    from shared import humanize, format_currency, chart_tooltip, render_inline_filters, dataframe_with_csv
except ImportError:
    from shared import humanize, format_currency

    def chart_tooltip(*_args, **_kwargs):
        return None

    def render_inline_filters(df, **_):
        return df

    def dataframe_with_csv(dataframe, **kwargs):
        kwargs.pop("export_df", None)
        kwargs.pop("file_name", None)
        kwargs.pop("filename_seed", None)
        return st.dataframe(dataframe, **kwargs)

from exp_ds import inject_ds_css, DS, apply_ds_layout, BRAND_SCALE, ds_sub

# ── 1. Load data ──────────────────────────────────────────────────────────────
raw_df = st.session_state.get("df")
if raw_df is None or raw_df.empty:
    st.warning("No hay datos para mostrar.")
    st.stop()

# ── 2. Inline filters ─────────────────────────────────────────────────────────
df = render_inline_filters(raw_df, key_prefix="pgd")
if df.empty:
    st.warning("No hay datos para los filtros seleccionados.")
    st.stop()

inject_ds_css()
ds_sub("Product Gaps — Detalle")

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
ds_sub("Top 20 Features Faltantes")

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
    color_discrete_sequence=[DS["brand_400"]],
)
fig.update_layout(
    yaxis=dict(autorange="reversed"),
    xaxis_title="Deals únicos (COUNT DISTINCT deal_id)",
)
if text_col is not None:
    fig.update_traces(text=text_col, textposition="outside")
fig = apply_ds_layout(fig, "Top 20 Features Faltantes")

chart_tooltip(
    "Ranking de features faltantes por deals únicos que la mencionaron.",
    "Indica qué funcionalidades aparecen más como brecha de producto.",
)
st.plotly_chart(fig, use_container_width=True)

# ── B2. Priority breakdown table (replaces pie chart) ─────────────────────────
if "gap_priority" in gaps.columns:
    ds_sub("Distribución por Prioridad")

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
        priority_mask = gaps["gap_priority"] == raw_key
        count = int(priority_mask.sum())
        pct = round(count / total_gaps * 100, 1) if total_gaps > 0 else 0.0
        if {"deal_id", "amount"}.issubset(gaps.columns):
            priority_deals = (
                gaps.loc[priority_mask, ["deal_id", "amount"]]
                .dropna(subset=["deal_id"])
                .drop_duplicates(subset=["deal_id"])
            )
            revenue_at_risk = float(priority_deals["amount"].fillna(0).sum())
        else:
            revenue_at_risk = 0.0
        priority_rows.append(
            {
                "Prioridad": info["label"],
                "Detecciones": count,
                "% del Total": f"{pct}%",
                "Revenue en Riesgo": format_currency(revenue_at_risk),
                "Qué significa": info["meaning"],
            }
        )

    priority_table = pd.DataFrame(priority_rows)
    st.dataframe(priority_table, use_container_width=True, hide_index=True)
    st.caption(
        "Revenue en Riesgo = suma del amount de los deals únicos que mencionaron este tipo de gap."
    )
    st.caption(
        "⚠️ Los Dealbreakers son el número más accionable de esta página. "
        "Representan features cuya ausencia fue razón de no avanzar."
    )

# ── B3. Prioridad de Gaps por Segmento (%) ────────────────────────────────────
if "segment" in gaps.columns and "gap_priority" in gaps.columns:
    ds_sub("Prioridad de Gaps por Segmento (%)")

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
        color_discrete_sequence=DS["palette"],
    )
    fig.update_layout(xaxis_ticksuffix="%", yaxis_title="Segmento")
    fig = apply_ds_layout(fig, "Prioridad de Gaps por Segmento (%)")
    st.plotly_chart(fig, use_container_width=True)

    st.caption(
        "Total de deals únicos por segmento: "
        + " · ".join(
            f"{row['segment']}: {row['total_deals']}" for _, row in seg_pct.iterrows()
        )
    )

# ── B4. Feature Gaps por Segmento (Top 15) ────────────────────────────────────
if {"segment", "feature_display", "deal_id"}.issubset(gaps.columns):
    seg_base = gaps.dropna(subset=["segment", "feature_display", "deal_id"]).copy()
    top15 = (
        seg_base.groupby("feature_display")["deal_id"]
        .nunique()
        .sort_values(ascending=False)
        .head(15)
        .index.tolist()
    )

    if top15:
        seg_totals = (
            seg_base.groupby("segment")["deal_id"]
            .nunique()
            .reset_index(name="seg_total_deals")
            .sort_values("seg_total_deals", ascending=False)
        )
        seg_feat_counts = (
            seg_base[seg_base["feature_display"].isin(top15)]
            .groupby(["feature_display", "segment"])["deal_id"]
            .nunique()
            .reset_index(name="deals_feature_segment")
        )

        segment_order = seg_totals["segment"].tolist()
        full_grid = pd.MultiIndex.from_product(
            [top15, segment_order], names=["feature_display", "segment"]
        ).to_frame(index=False)
        seg_feat = (
            full_grid.merge(seg_feat_counts, on=["feature_display", "segment"], how="left")
            .merge(seg_totals, on="segment", how="left")
        )
        seg_feat["deals_feature_segment"] = seg_feat["deals_feature_segment"].fillna(0).astype(int)
        seg_feat["pct"] = (
            seg_feat["deals_feature_segment"]
            / seg_feat["seg_total_deals"].replace(0, pd.NA)
            * 100
        ).fillna(0).round(1)

        fig = px.density_heatmap(
            seg_feat,
            x="segment",
            y="feature_display",
            z="pct",
            title="Feature Gaps por Segmento (Top 15)",
            color_continuous_scale=BRAND_SCALE,
        )
        fig.update_layout(
            yaxis_title="Feature",
            xaxis_title="Segmento",
            height=max(620, len(top15) * 38),
            margin=dict(t=60, b=130, l=10, r=10),
        )
        fig.update_xaxes(tickangle=-30, automargin=True)
        fig.update_xaxes(categoryorder="array", categoryarray=segment_order)
        fig.update_yaxes(categoryorder="array", categoryarray=list(reversed(top15)))
        fig.update_coloraxes(colorbar_title="% del segmento", colorbar_ticksuffix="%")

        max_pct = float(seg_feat["pct"].max()) if not seg_feat.empty else 0.0
        for _, row in seg_feat.iterrows():
            pct_value = float(row["pct"])
            pct_label = f"{pct_value:.1f}%"
            if pct_label.endswith(".0%"):
                pct_label = pct_label.replace(".0%", "%")
            font_color = "white" if max_pct > 0 and (pct_value / max_pct) >= 0.55 else DS["blueprimary_800"]
            fig.add_annotation(
                x=row["segment"],
                y=row["feature_display"],
                text=f"{int(row['deals_feature_segment'])} ({pct_label})",
                showarrow=False,
                font=dict(size=9, color=font_color),
            )

        fig = apply_ds_layout(fig, "Feature Gaps por Segmento (Top 15)")
        chart_tooltip(
            "Porcentaje de deals del segmento que mencionaron cada feature gap.",
            "Cada celda muestra el % del segmento y, entre paréntesis, los deals absolutos.",
        )
        st.plotly_chart(fig, use_container_width=True)
        st.caption(
            "% de los deals del segmento que mencionaron este gap. "
            "Número entre paréntesis = deals absolutos."
        )

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
        color_discrete_sequence=DS["palette"],
    )
    fig.update_traces(textposition="outside")
    fig.update_layout(
        yaxis_title="",
        showlegend=False,
        yaxis=dict(autorange="reversed"),
    )
    fig = apply_ds_layout(fig, "Gaps: Módulos Existentes vs. Faltantes")
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
        color_discrete_sequence=[DS["brand_400"]],
    )
    fig.update_layout(yaxis=dict(autorange="reversed"))
    fig = apply_ds_layout(fig, "Gaps por Módulo")
    chart_tooltip(
        "Módulos con mayor concentración de product gaps.",
        "Sirve para priorizar roadmap por área funcional.",
    )
    st.plotly_chart(fig, use_container_width=True)

# ── C. Tabla de Detalle (con filtros) ─────────────────────────────────────────
ds_sub("Detalle de Gaps")

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
table_display = table_gaps[available_cols].copy()
dealbreaker_idx = set(
    table_gaps.index[table_gaps["gap_priority"] == "dealbreaker"]
) if "gap_priority" in table_gaps.columns else set()
styled_table = table_display.style.apply(
    lambda row: (
        ["background-color: #fff0f0 !important; color: #303036 !important"] * len(row)
        if row.name in dealbreaker_idx
        else [""] * len(row)
    ),
    axis=1,
)
column_labels = {
    "company_name": "Empresa",
    "feature_display": "Feature",
    "module_display": "Módulo",
    "gap_priority_display": "Prioridad",
    "segment": "Segmento",
    "country": "País",
    "deal_stage": "Etapa",
    "deal_owner": "AE",
    "resumen": "Resumen (120 chars)",
}
column_config = {
    col: st.column_config.TextColumn(label)
    for col, label in column_labels.items()
    if col in available_cols
}
table_export = table_gaps.copy()
try:
    dataframe_with_csv(
        styled_table,
        export_df=table_export,
        file_name="product-gaps-detalle.csv",
        use_container_width=True,
        height=400,
        hide_index=True,
        column_config=column_config,
    )
except Exception:
    dataframe_with_csv(
        table_display,
        export_df=table_export,
        file_name="product-gaps-detalle.csv",
        use_container_width=True,
        height=400,
        hide_index=True,
        column_config=column_config,
    )

# Streamlit currently prioritizes column_config rendering over Styler row backgrounds.
# Keep the Styler logic above for data intent and apply a lightweight client-side tint as fallback.
components.html(
    """
    <script>
      const tintDealbreakerRows = () => {
        const doc = window.parent?.document;
        if (!doc) return 0;

        const grids = doc.querySelectorAll('[data-testid="stDataFrame"]');
        if (!grids.length) return 0;
        const table = grids[grids.length - 1].querySelector('table');
        if (!table) return 0;

        let tintedCells = 0;
        table.querySelectorAll('tr[role="row"]').forEach((row) => {
          const cells = Array.from(row.querySelectorAll('td[role="gridcell"]'));
          const hasDealbreaker = cells.some((cell) => {
            const value = (cell.textContent || "").trim();
            return value === "Dealbreaker" || value === "🚨 Dealbreaker";
          });
          if (!hasDealbreaker) return;
          cells.forEach((cell) => {
            cell.style.setProperty("background-color", "#fff0f0", "important");
            cell.style.setProperty("color", "#303036", "important");
            tintedCells += 1;
          });
        });
        return tintedCells;
      };

      const runTint = () => {
        const count = tintDealbreakerRows();
        if (window.parent) {
          window.parent.__dealbreaker_tint_ran = true;
          window.parent.__dealbreaker_tinted_cells = count;
        }
      };

      runTint();
      setTimeout(runTint, 50);
      setTimeout(runTint, 250);
      const observer = new MutationObserver(tintDealbreakerRows);
      observer.observe(window.parent.document.body, { childList: true, subtree: true });
    </script>
    """,
    height=0,
)
