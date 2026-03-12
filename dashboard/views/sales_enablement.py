import streamlit as st
import plotly.express as px
import pandas as pd
from shared import format_currency, chart_tooltip, clean_stage_label, topn_with_other, render_inline_filters
from computations import cached_value_counts, cached_unique_deals_revenue

raw_df = st.session_state.get("df")
if raw_df is None or raw_df.empty:
    st.warning("No hay datos para mostrar.")
    st.stop()

df = render_inline_filters(raw_df, key_prefix="se")
if df.empty:
    st.warning("No hay datos para los filtros seleccionados.")
    st.stop()

st.header("Sales Enablement")

# === Section A: Deal Friction ===
st.subheader("A. Deal Friction")
friction = df[df["insight_type"] == "deal_friction"]
if friction.empty:
    st.info("No hay fricciones de deal en los datos filtrados.")
else:
    col1, col2, col3 = st.columns(3)
    col1.metric(
        "Total Fricciones",
        f"{len(friction):,}",
        help="Cantidad total de fricciones detectadas.",
    )
    col2.metric(
        "Deals Afectados",
        friction["deal_id"].dropna().nunique(),
        help="Deals únicos con al menos una fricción identificada.",
    )
    fric_rev = cached_unique_deals_revenue(friction)
    col3.metric(
        "Revenue en Riesgo",
        format_currency(fric_rev),
        help="Suma de monto de deals afectados por fricciones.",
    )

    # Ranking of friction subtypes
    subtype_counts = cached_value_counts(friction, "insight_subtype_display", n=50)
    subtype_counts.columns = ["Tipo de Friccion", "Frecuencia"]
    fig = px.bar(subtype_counts, x="Frecuencia", y="Tipo de Friccion", orientation="h", title="Tipos de Friccion")
    fig.update_layout(yaxis=dict(autorange="reversed"))
    chart_tooltip(
        "Ranking de fricciones más frecuentes.",
        "Muestra qué bloqueos de venta aparecen con mayor repetición.",
    )
    st.plotly_chart(fig, use_container_width=True)

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
            chart_tooltip(
                "Fricciones cruzadas por segmento comercial.",
                "Permite ver si cada segmento enfrenta bloqueos distintos.",
            )
            st.plotly_chart(fig, use_container_width=True)

    # Friction por deal_stage — heatmap legible
    if "deal_stage" in friction.columns:
        fric_stage = friction.dropna(subset=["deal_stage", "insight_subtype_display"]).copy()
        if not fric_stage.empty:
            fric_stage["friction_group"] = topn_with_other(
                fric_stage["insight_subtype_display"], n=10, other_label="Other"
            )
            fric_stage["stage_group"] = topn_with_other(
                fric_stage["deal_stage"], n=8, other_label="Other"
            )
            hm = (
                fric_stage.groupby(["friction_group", "stage_group"], as_index=False)
                .size()
                .rename(columns={"size": "count"})
            )
            pivot = (
                hm.pivot(index="friction_group", columns="stage_group", values="count")
                .fillna(0)
                .astype(int)
            )
            if not pivot.empty:
                row_order = pivot.sum(axis=1).sort_values(ascending=False).index
                col_order = pivot.sum(axis=0).sort_values(ascending=False).index
                pivot = pivot.loc[row_order, col_order]

                display_columns = []
                seen_labels = {}
                for raw_stage in pivot.columns:
                    stage_label = clean_stage_label(raw_stage, max_chars=16)
                    occurrence = seen_labels.get(stage_label, 0) + 1
                    seen_labels[stage_label] = occurrence
                    if occurrence > 1:
                        stage_label = f"{stage_label}<br>({occurrence})"
                    display_columns.append(stage_label)
                display_pivot = pivot.copy()
                display_pivot.columns = display_columns

                fig = px.imshow(
                    display_pivot,
                    text_auto=False,
                    aspect="auto",
                    title="Friccion x Etapa del Deal",
                    labels=dict(x="Etapa del Deal", y="Friccion", color="Cantidad"),
                )
                fig.update_layout(
                    height=560,
                    margin=dict(t=70, b=120, l=10, r=10),
                )
                fig.update_xaxes(tickangle=-30, automargin=True)
                fig.update_yaxes(automargin=True)
                hover_stage_matrix = [
                    [str(raw_stage) for raw_stage in pivot.columns]
                    for _ in pivot.index
                ]
                fig.update_traces(
                    customdata=hover_stage_matrix,
                    hovertemplate=(
                        "Friccion: %{y}<br>"
                        "Etapa: %{customdata}<br>"
                        "Cantidad: %{z}<extra></extra>"
                    )
                )

                flattened = pivot.to_numpy().flatten().tolist()
                positive_values = [value for value in flattened if value > 0]
                threshold = (
                    float(pd.Series(positive_values).quantile(0.85)) if positive_values else 0.0
                )
                max_value = float(max(flattened)) if flattened else 0.0
                for row_idx, row_name in enumerate(pivot.index):
                    row_values = pivot.iloc[row_idx]
                    row_max = float(row_values.max())
                    for col_idx, _ in enumerate(pivot.columns):
                        value = float(pivot.iat[row_idx, col_idx])
                        if value <= 0:
                            continue
                        if value >= threshold or value == row_max:
                            font_color = "white" if value >= max_value * 0.6 else "#DDEBFF"
                            fig.add_annotation(
                                x=display_columns[col_idx],
                                y=row_name,
                                text=str(int(value)),
                                showarrow=False,
                                font=dict(size=10, color=font_color),
                            )

                chart_tooltip(
                    "Cruce entre fricciones y etapas del deal (Top 10 fricciones x Top 8 etapas). "
                    "El resto se agrupa en 'Other'.",
                    "El color representa cantidad y solo se rotulan celdas relevantes "
                    "(p85 global o maximo por friccion).",
                )
                st.plotly_chart(fig, use_container_width=True)

                detail_hm = (
                    fric_stage.groupby(["insight_subtype_display", "deal_stage"], as_index=False)
                    .size()
                    .rename(columns={"size": "count"})
                )
                detail_pivot = (
                    detail_hm.pivot(
                        index="insight_subtype_display",
                        columns="deal_stage",
                        values="count",
                    )
                    .fillna(0)
                    .astype(int)
                )
                if not detail_pivot.empty:
                    detail_row_order = detail_pivot.sum(axis=1).sort_values(ascending=False).index
                    detail_col_order = detail_pivot.sum(axis=0).sort_values(ascending=False).index
                    detail_pivot = detail_pivot.loc[detail_row_order, detail_col_order]
                    detail_csv = detail_hm.sort_values("count", ascending=False).to_csv(index=False).encode("utf-8")
                    with st.expander("Ver detalle completo (sin agrupacion Top N)"):
                        st.dataframe(detail_pivot, width="stretch", height=360)
                        st.download_button(
                            "Descargar detalle (CSV)",
                            data=detail_csv,
                            file_name="friccion_x_etapa_detalle.csv",
                            mime="text/csv",
                            key="download_friccion_etapa_csv",
                        )

    if "industry" in friction.columns:
        fric_industry = friction.dropna(subset=["industry", "insight_subtype_display"])
        if not fric_industry.empty:
            top_industries = fric_industry["industry"].value_counts().head(10).index
            top_blockers = fric_industry["insight_subtype_display"].value_counts().head(10).index
            hm = (
                fric_industry[
                    fric_industry["industry"].isin(top_industries)
                    & fric_industry["insight_subtype_display"].isin(top_blockers)
                ]
                .groupby(["insight_subtype_display", "industry"])
                .size()
                .reset_index(name="count")
            )
            pivot = hm.pivot(index="insight_subtype_display", columns="industry", values="count").fillna(0)
            if not pivot.empty:
                fig = px.imshow(
                    pivot,
                    text_auto=True,
                    aspect="auto",
                    title="Blockers por Industria (Top 10)",
                    labels=dict(x="Industria", y="Blocker", color="Cantidad"),
                )
                chart_tooltip(
                    "Matriz de blockers por industria.",
                    "Permite identificar objeciones dominantes por vertical para ajustar playbooks.",
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

        ae_table = ae_metrics.merge(ae_friction, on="deal_owner", how="left").merge(ae_comp, on="deal_owner", how="left")
        ae_table["avg_amount"] = ae_table["avg_amount"].apply(lambda x: format_currency(x) if pd.notna(x) else "$0")
        ae_table.columns = ["AE", "Insights", "Deals", "Avg Amount", "Top Friccion", "Top Competidor"]
        ae_table = ae_table.sort_values("Insights", ascending=False)
        chart_tooltip(
            "Tabla comparativa de performance por AE: volumen, deals y principales señales.",
            "Sirve para coaching comercial y asignación de soporte.",
        )
        st.dataframe(ae_table, width="stretch", height=400)

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
            chart_tooltip(
                "Distribución de fricciones por AE para los AEs con mayor volumen.",
                "Permite entender qué bloqueos predominan en cada cartera.",
            )
            st.plotly_chart(fig, use_container_width=True)
else:
    st.info("No hay datos de deal_owner disponibles.")

# === Section C: Battle Cards (FAQ) ===
st.subheader("C. Battle Cards (FAQs)")
faqs = df[df["insight_type"] == "faq"]
if faqs.empty:
    st.info("No hay FAQs en los datos filtrados.")
else:
    topic_counts = cached_value_counts(faqs, "insight_subtype_display", n=50)
    topic_counts.columns = ["Topic", "Frecuencia"]
    fig = px.bar(topic_counts, x="Frecuencia", y="Topic", orientation="h", title="FAQs por Topic")
    fig.update_layout(yaxis=dict(autorange="reversed"))
    chart_tooltip(
        "Ranking de temas de FAQ más consultados en ventas.",
        "Se usa para priorizar materiales de enablement y battle cards.",
    )
    st.plotly_chart(fig, use_container_width=True)

    st.subheader("Preguntas y Respuestas")
    chart_tooltip(
        "Detalle textual de preguntas y respuestas detectadas en llamadas.",
        "Útil para crear argumentos y respuestas tipo por tema.",
    )
    display_cols = ["company_name", "insight_subtype_display", "summary", "verbatim_quote"]
    available_cols = [c for c in display_cols if c in faqs.columns]
    st.dataframe(faqs[available_cols], width="stretch", height=400)
