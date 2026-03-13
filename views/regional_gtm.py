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

df = render_inline_filters(raw_df, key_prefix="rg")
if df.empty:
    st.warning("No hay datos para los filtros seleccionados.")
    st.stop()

st.header("Regional / GTM")

# ── A. ¿Dónde estamos teniendo más conversaciones? ────────────────────────────
st.subheader("A. ¿Dónde estamos teniendo más conversaciones?")

if "country" in df.columns:
    country_data = df.dropna(subset=["country"]).copy()
    if not country_data.empty:
        country_totals = country_data["country"].value_counts()
        top_countries = country_totals.head(15).index
        grand_total = int(country_totals.sum())

        country_breakdown = (
            country_data[country_data["country"].isin(top_countries)]
            .groupby(["country", "insight_type_display"])
            .size()
            .reset_index(name="count")
        )

        # Per-country % of total insights for Y-axis labels
        country_sums = country_breakdown.groupby("country")["count"].sum()
        country_order = country_sums.sort_values(ascending=True).index.tolist()
        pct_map = {
            c: f"{c}<br><sub>{round(country_sums[c] / grand_total * 100)}%</sub>"
            for c in country_order
        }

        fig = px.bar(
            country_breakdown,
            x="count",
            y="country",
            color="insight_type_display",
            orientation="h",
            barmode="stack",
            title="¿En qué países tenemos más señales de venta?",
            labels={
                "country": "País",
                "count": "Cantidad de insights únicos detectados",
                "insight_type_display": "Tipo de insight",
            },
            category_orders={"country": country_order},
        )
        fig.update_yaxes(
            tickmode="array",
            tickvals=country_order,
            ticktext=[pct_map[c] for c in country_order],
        )
        chart_tooltip(
            "Top 15 países por cantidad de insights, con desglose por tipo de insight.",
            "El porcentaje indica la proporción del total de señales detectadas.",
        )
        st.plotly_chart(fig, use_container_width=True)

# ── B. ¿Qué encontramos en cada mercado? ─────────────────────────────────────
st.subheader("B. ¿Qué encontramos en cada mercado?")

# Top 3 pains per region — % of unique demos in that region
pains = df[df["insight_type"] == "pain"]
if not pains.empty and "region" in pains.columns:
    pain_region = pains.dropna(subset=["region", "transcript_id"])
    if not pain_region.empty:
        regions_list = pain_region["region"].unique()
        top_pains_per_region = []
        for r in regions_list:
            region_pains = pain_region[pain_region["region"] == r]
            total_demos_region = region_pains["transcript_id"].nunique()
            pain_demos = (
                region_pains.groupby("insight_subtype_display")["transcript_id"]
                .nunique()
                .sort_values(ascending=False)
                .head(3)
                .reset_index()
            )
            pain_demos.columns = ["Pain", "Demos"]
            pain_demos["Pct"] = (
                (pain_demos["Demos"] / total_demos_region * 100).round(1)
                if total_demos_region > 0
                else 0.0
            )
            pain_demos["Region"] = r
            top_pains_per_region.append(pain_demos)

        if top_pains_per_region:
            combined = pd.concat(top_pains_per_region, ignore_index=True)
            fig = px.bar(
                combined,
                x="Pct",
                y="Pain",
                facet_col="Region",
                orientation="h",
                title="Top 3 Pains por Región (% de demos únicas en esa región)",
                labels={
                    "Pct": "% de demos en la región",
                    "Pain": "Pain",
                    "Region": "Región",
                },
                text="Pct",
            )
            fig.update_traces(texttemplate="%{text:.1f}%", textposition="outside")
            fig.update_yaxes(autorange="reversed", matches=None)
            fig.update_xaxes(matches=None)
            fig.for_each_annotation(lambda a: a.update(text=a.text.split("=")[-1]))
            chart_tooltip(
                "Top 3 pains por región medidos como % de demos únicas donde apareció ese pain.",
                "Normalizado por volumen de demos en cada región — permite comparar mercados de distinto tamaño.",
            )
            st.plotly_chart(fig, use_container_width=True)

# Modules by region — heatmap (color intensity only)
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
            pivot,
            aspect="auto",
            title="Módulos Demandados por Región (Top 15)",
            labels=dict(x="Región", y="Módulo", color="Menciones"),
            color_continuous_scale="Blues",
        )
        chart_tooltip(
            "Módulos más mencionados por región.",
            "Más oscuro = más menciones. Hover sobre cada celda para ver la cantidad exacta.",
        )
        st.plotly_chart(fig, use_container_width=True)

# Competitors by country — with country filter and fixed column widths
comp = df[df["insight_type"] == "competitive_signal"].copy()
if "is_own_brand_competitor" in comp.columns:
    comp = comp[~comp["is_own_brand_competitor"].fillna(False)]

if not comp.empty and "country" in comp.columns:
    st.subheader("Competidores por País")
    chart_tooltip(
        "Tabla de competidores por país con menciones y relación principal.",
        "Da contexto competitivo local para mensajes comerciales por mercado.",
    )
    comp_country_full = (
        comp.dropna(subset=["country", "competitor_name"])
        .groupby(["country", "competitor_name"])
        .agg(
            menciones=("id", "count"),
            relacion_principal=(
                "competitor_relationship_display",
                lambda x: x.value_counts().index[0] if len(x) > 0 else "",
            ),
        )
        .reset_index()
        .sort_values(["country", "menciones"], ascending=[True, False])
    )
    comp_country_full.columns = ["Pais", "Competidor", "Menciones", "Relacion Principal"]

    sorted_countries = sorted(comp_country_full["Pais"].dropna().unique().tolist())
    selected_country = st.selectbox(
        "Filtrar por país:",
        ["(Todos)"] + sorted_countries,
        key="rg_comp_country_filter",
    )
    comp_display = (
        comp_country_full[comp_country_full["Pais"] == selected_country]
        if selected_country != "(Todos)"
        else comp_country_full
    )

    st.dataframe(
        comp_display,
        use_container_width=True,
        height=400,
        column_config={
            "Relacion Principal": st.column_config.TextColumn(
                "Relación Principal",
                width="large",
            ),
            "Competidor": st.column_config.TextColumn(
                "Competidor",
                width="medium",
            ),
        },
    )

# ── C. ¿Cuánto vale cada mercado? ─────────────────────────────────────────────
st.subheader("C. ¿Cuánto vale cada mercado?")

if "region" in df.columns:
    pipeline_data = df.dropna(subset=["region"]).drop_duplicates("deal_id")

    if not pipeline_data.empty:
        # KPI cards — top region by %, total pipeline, highest avg ticket
        region_rev = (
            pipeline_data.groupby("region")
            .agg(revenue=("amount", "sum"), deals=("deal_id", "nunique"))
            .reset_index()
        )
        region_rev["avg_ticket"] = (
            region_rev["revenue"] / region_rev["deals"].replace(0, pd.NA)
        )
        total_pipeline = float(region_rev["revenue"].sum())

        if total_pipeline > 0 and not region_rev.empty:
            region_rev["pct_pipeline"] = region_rev["revenue"] / total_pipeline * 100
            top_region_row = region_rev.loc[region_rev["pct_pipeline"].idxmax()]
            top_region_name = str(top_region_row["region"])
            top_region_pct = round(float(top_region_row["pct_pipeline"]), 1)
        else:
            top_region_name = "—"
            top_region_pct = 0.0

        avg_valid = region_rev.dropna(subset=["avg_ticket"])
        if not avg_valid.empty:
            highest_avg_row = avg_valid.loc[avg_valid["avg_ticket"].idxmax()]
            highest_avg_region = str(highest_avg_row["region"])
            highest_avg_value = format_currency(float(highest_avg_row["avg_ticket"]))
        else:
            highest_avg_region = "—"
            highest_avg_value = "—"

        kpi1, kpi2, kpi3 = st.columns(3)
        kpi1.metric(
            "Región con más pipeline",
            top_region_name,
            delta=f"{top_region_pct}% del total",
            help="Región con mayor porcentaje del revenue total de pipeline en el recorte actual.",
        )
        kpi2.metric(
            "Pipeline total",
            format_currency(total_pipeline),
            help="Suma del revenue de todos los deals únicos con región asignada.",
        )
        kpi3.metric(
            "Mayor ticket promedio",
            highest_avg_value,
            delta=highest_avg_region,
            help="Región con el ticket promedio más alto (revenue / cantidad de deals únicos).",
        )

        # Unified pipeline table: Revenue | Deals | Avg per Segment × Region
        chart_tooltip(
            "Cobertura de pipeline por segmento y región — cada celda muestra Revenue | Deals | Ticket Promedio.",
            "Permite detectar desbalance de cobertura comercial entre mercados de un solo vistazo.",
        )

        if "segment" in pipeline_data.columns:
            pipeline_seg = pipeline_data.dropna(subset=["segment", "region"])
            if not pipeline_seg.empty:
                coverage = (
                    pipeline_seg.groupby(["segment", "region"])
                    .agg(revenue=("amount", "sum"), deals=("deal_id", "nunique"))
                    .reset_index()
                )
                coverage["avg_ticket"] = (
                    coverage["revenue"] / coverage["deals"].replace(0, pd.NA)
                ).fillna(0)

                def _format_cell(row):
                    rev = format_currency(row["revenue"])
                    deals_n = int(row["deals"])
                    avg = format_currency(row["avg_ticket"]) if row["avg_ticket"] > 0 else "—"
                    return f"{rev} | {deals_n} | {avg}"

                coverage["celda"] = coverage.apply(_format_cell, axis=1)
                unified_pivot = coverage.pivot(
                    index="segment", columns="region", values="celda"
                ).fillna("—")

                st.write("**Pipeline por Segmento × Región** (Revenue | Deals | Ticket Promedio)")
                st.dataframe(unified_pivot, use_container_width=True, height=300)
        else:
            region_summary = region_rev[["region", "revenue", "deals", "avg_ticket"]].copy()
            region_summary["revenue"] = region_summary["revenue"].apply(format_currency)
            region_summary["avg_ticket"] = region_summary["avg_ticket"].apply(
                lambda v: format_currency(v) if pd.notna(v) else "—"
            )
            region_summary.columns = ["Región", "Revenue", "Deals", "Ticket Promedio"]
            st.dataframe(region_summary, use_container_width=True, height=300)
