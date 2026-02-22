"""Ayuda y Taxonomia — Guia completa del dashboard + explorador de taxonomia."""

from __future__ import annotations

from collections import defaultdict

import pandas as pd
import streamlit as st

from src.skills.taxonomy import (
    COMPETITIVE_RELATIONSHIPS,
    COMPETITOR_CATEGORIES,
    COMPETITORS,
    DEAL_FRICTION_SUBTYPES,
    FAQ_SUBTYPES,
    HR_CATEGORIES,
    INSIGHT_TYPES,
    MODULES,
    PAIN_SUBTYPES,
    PRODUCT_GAP_SUBTYPES,
    SEED_FEATURE_NAMES,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

PAIN_THEME_NAMES = {
    "technology": "Tecnologia",
    "processes": "Procesos",
    "communication": "Comunicacion",
    "talent": "Talento",
    "engagement": "Engagement",
    "data_and_analytics": "Datos y Analytics",
    "compliance_and_scale": "Compliance y Escala",
}

STATUS_LABELS = {"existing": "Existente", "missing": "Faltante", "roadmap": "Roadmap"}
STATUS_ICONS = {"existing": "\u2705", "missing": "\u274c", "roadmap": "\U0001f7e1"}

REGION_LABELS = {
    "latam": "LATAM",
    "global": "Global",
    "emea": "EMEA",
    "north_america": "North America",
    "apac": "APAC",
}


def _matches(text: str, query: str) -> bool:
    """Case-insensitive substring match."""
    return query in text.lower()


def _any_matches(fields: list[str], query: str) -> bool:
    return any(_matches(f, query) for f in fields)


# ---------------------------------------------------------------------------
# Page
# ---------------------------------------------------------------------------

st.header("Ayuda y Taxonomia")
st.caption(
    "Guia completa para interpretar el dashboard y explorar la taxonomia de "
    "insights, modulos, competidores y features de Humand."
)

# Global search
search = st.text_input(
    "\U0001f50d Buscar en toda la pagina",
    placeholder="Ej: nomina, Buk, alta rotacion, onboarding...",
    key="taxonomy_search",
)
q = search.strip().lower()


# ── 1. Como funciona ──────────────────────────────────────────────────────

show_section_1 = not q or _any_matches(
    ["como funciona", "flujo", "ingesta", "enriquecimiento", "normalizacion",
     "extraccion", "consolidacion", "visualizacion", "pipeline"],
    q,
)

if show_section_1:
    with st.expander("Como funciona", expanded=not q):
        st.markdown(
            """
El flujo de AI Sales Insights sigue esta logica:

1. **Ingesta de fuentes**: se toman transcripts de llamadas y datos comerciales del CRM.
2. **Enriquecimiento**: se cruzan senales de conversacion con contexto de deal (owner, etapa, monto, segmento, pais).
3. **Normalizacion**: el contenido libre se clasifica usando una taxonomia comun (tipos de insight, subtipos, modulos, competencia).
4. **Extraccion de insights**: una llamada puede generar uno o varios insights, cada uno con su tipo y atributos.
5. **Consolidacion**: todo queda estructurado en tablas/vistas para analisis y filtros.
6. **Visualizacion**: dashboards y chat consultan ese dataset para responder preguntas y mostrar tendencias.

**Para el usuario**: los graficos no muestran texto crudo sino **insights ya clasificados**. Los filtros del sidebar cambian el universo analizado en tiempo real. El mismo deal puede aparecer en varios insights porque una llamada puede tener multiples senales.
            """
        )


# ── 2. Tipos de Insight ──────────────────────────────────────────────────

insight_rows = []
for code, display in INSIGHT_TYPES.items():
    insight_rows.append({"Tipo": display, "Codigo": code})

if q:
    insight_rows = [r for r in insight_rows if _any_matches([r["Tipo"], r["Codigo"]], q)]

if insight_rows:
    st.subheader("Tipos de Insight")
    st.markdown("Cada insight extraido de una llamada se clasifica en **uno** de estos 5 tipos.")
    descriptions = {
        "pain": "El prospecto describe un problema, frustracion o necesidad actual.",
        "product_gap": "Se pide una funcionalidad que no existe o no alcanza.",
        "competitive_signal": "Se menciona un competidor en contexto comercial.",
        "deal_friction": "Bloqueos que frenan el avance del deal.",
        "faq": "Pregunta recurrente del prospecto sobre producto/servicio.",
    }
    full_rows = []
    for r in insight_rows:
        full_rows.append({
            "Tipo": r["Tipo"],
            "Codigo": r["Codigo"],
            "Descripcion": descriptions.get(r["Codigo"], ""),
        })
    st.dataframe(pd.DataFrame(full_rows), use_container_width=True, hide_index=True)


# ── 3. Taxonomia de Subtipos ─────────────────────────────────────────────

st.subheader("Taxonomia de Subtipos") if not q else None

# Pain Subtypes (31, grouped by theme)
pain_by_theme: dict[str, list[dict]] = defaultdict(list)
for code, info in PAIN_SUBTYPES.items():
    row = {
        "Subtipo": info["display_name"],
        "Codigo": code,
        "Descripcion": info.get("description", ""),
    }
    if not q or _any_matches([row["Subtipo"], row["Codigo"], row["Descripcion"], PAIN_THEME_NAMES.get(info["theme"], "")], q):
        pain_by_theme[info["theme"]].append(row)

if pain_by_theme:
    total_shown = sum(len(v) for v in pain_by_theme.values())
    with st.expander(f"Pain Subtypes ({total_shown} de {len(PAIN_SUBTYPES)}, agrupados por tema)", expanded=bool(q)):
        for theme_code, rows in pain_by_theme.items():
            theme_name = PAIN_THEME_NAMES.get(theme_code, theme_code)
            st.markdown(f"**{theme_name}** ({len(rows)})")
            st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)

# Product Gap Subtypes (5)
pg_rows = []
for code, info in PRODUCT_GAP_SUBTYPES.items():
    row = {"Subtipo": info["display_name"], "Codigo": code, "Descripcion": info.get("description", "")}
    if not q or _any_matches([row["Subtipo"], row["Codigo"], row["Descripcion"]], q):
        pg_rows.append(row)

if pg_rows:
    with st.expander(f"Product Gap Subtypes ({len(pg_rows)} de {len(PRODUCT_GAP_SUBTYPES)})", expanded=bool(q)):
        st.dataframe(pd.DataFrame(pg_rows), use_container_width=True, hide_index=True)

# Deal Friction Subtypes (14)
df_rows = []
for code, info in DEAL_FRICTION_SUBTYPES.items():
    row = {"Subtipo": info["display_name"], "Codigo": code, "Descripcion": info.get("description", "")}
    if not q or _any_matches([row["Subtipo"], row["Codigo"], row["Descripcion"]], q):
        df_rows.append(row)

if df_rows:
    with st.expander(f"Deal Friction Subtypes ({len(df_rows)} de {len(DEAL_FRICTION_SUBTYPES)})", expanded=bool(q)):
        st.dataframe(pd.DataFrame(df_rows), use_container_width=True, hide_index=True)

# FAQ Subtypes (18)
faq_rows = []
for code, info in FAQ_SUBTYPES.items():
    row = {"Subtipo": info["display_name"], "Codigo": code, "Descripcion": info.get("description", "")}
    if not q or _any_matches([row["Subtipo"], row["Codigo"], row["Descripcion"]], q):
        faq_rows.append(row)

if faq_rows:
    with st.expander(f"FAQ Subtypes ({len(faq_rows)} de {len(FAQ_SUBTYPES)})", expanded=bool(q)):
        st.dataframe(pd.DataFrame(faq_rows), use_container_width=True, hide_index=True)


# ── 4. Categorias HR y Modulos ───────────────────────────────────────────

modules_by_cat: dict[str, list[dict]] = defaultdict(list)
for mod_code, mod_info in sorted(MODULES.items(), key=lambda x: x[1]["sort_order"]):
    cat = mod_info["hr_category"]
    cat_display = HR_CATEGORIES[cat]["display_name"]
    status = mod_info["status"]
    row = {
        "Modulo": mod_info["display_name"],
        "Codigo": mod_code,
        "Estado": f"{STATUS_ICONS.get(status, '')} {STATUS_LABELS.get(status, status)}",
    }
    if not q or _any_matches([row["Modulo"], row["Codigo"], cat_display, status], q):
        modules_by_cat[cat].append(row)

if modules_by_cat:
    total_mods = sum(len(v) for v in modules_by_cat.values())
    st.subheader(f"Categorias HR y Modulos ({total_mods} de {len(MODULES)})")
    st.markdown(
        "Humand organiza sus modulos en 7 categorias HR. "
        "Estado: \u2705 Existente | \u274c Faltante | \U0001f7e1 Roadmap"
    )
    for cat_code, cat_info in sorted(HR_CATEGORIES.items(), key=lambda x: x[1]["sort_order"]):
        if cat_code not in modules_by_cat:
            continue
        rows = modules_by_cat[cat_code]
        with st.expander(f"{cat_info['display_name']} ({len(rows)} modulos)", expanded=bool(q)):
            st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)


# ── 5. Competencia ───────────────────────────────────────────────────────

# Competitive relationships
rel_rows = []
for code, info in COMPETITIVE_RELATIONSHIPS.items():
    row = {"Relacion": info["display_name"], "Codigo": code, "Descripcion": info.get("description", "")}
    if not q or _any_matches([row["Relacion"], row["Codigo"], row["Descripcion"]], q):
        rel_rows.append(row)

# Competitors by category
comp_by_cat: dict[str, list[dict]] = defaultdict(list)
for name, info in sorted(COMPETITORS.items()):
    cat = info["category"]
    cat_display = COMPETITOR_CATEGORIES[cat]["display_name"]
    region = REGION_LABELS.get(info.get("region", ""), info.get("region", ""))
    row = {"Competidor": name, "Region": region}
    if not q or _any_matches([name, cat_display, region], q):
        comp_by_cat[cat].append(row)

show_competition = rel_rows or comp_by_cat
if show_competition:
    total_comp = sum(len(v) for v in comp_by_cat.values())
    st.subheader(f"Competencia ({total_comp} de {len(COMPETITORS)} competidores)")

    if rel_rows:
        with st.expander(f"Tipos de relacion competitiva ({len(rel_rows)})", expanded=bool(q)):
            st.dataframe(pd.DataFrame(rel_rows), use_container_width=True, hide_index=True)

    for cat_code, cat_info in COMPETITOR_CATEGORIES.items():
        if cat_code not in comp_by_cat:
            continue
        rows = comp_by_cat[cat_code]
        with st.expander(f"{cat_info['display_name']} ({len(rows)})", expanded=bool(q)):
            st.caption(cat_info.get("description", ""))
            st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)


# ── 6. Feature Names de referencia ───────────────────────────────────────

feat_rows = []
for code, info in SEED_FEATURE_NAMES.items():
    suggested = info.get("suggested_module")
    mod_display = MODULES[suggested]["display_name"] if suggested and suggested in MODULES else "-"
    row = {"Feature": info["display_name"], "Codigo": code, "Modulo sugerido": mod_display}
    if not q or _any_matches([row["Feature"], row["Codigo"], row["Modulo sugerido"]], q):
        feat_rows.append(row)

if feat_rows:
    st.subheader(f"Feature Names de referencia ({len(feat_rows)} de {len(SEED_FEATURE_NAMES)})")
    st.markdown(
        "Lista de features conocidas usadas para clasificar product gaps. "
        "El modelo puede detectar features nuevas fuera de esta lista."
    )
    st.dataframe(pd.DataFrame(feat_rows), use_container_width=True, hide_index=True)


# ── 7. Guia de Dashboard ─────────────────────────────────────────────────

show_guide = not q or _any_matches(
    ["indicador", "kpi", "executive summary", "grafico", "custom dashboard",
     "variable", "diccionario", "eje x", "eje y", "agregacion", "top n",
     "region", "country", "segment", "deal_owner", "module_display",
     "insight_subtype", "pain_theme", "confidence", "amount", "call_date"],
    q,
)

if show_guide:
    st.subheader("Guia de Dashboard")

    with st.expander("Indicadores del Executive Summary", expanded=False):
        kpi_df = pd.DataFrame([
            {"Indicador": "Total Insights", "Calculo": "Cantidad total de insights en el dataset filtrado.", "Lectura": "Volumen total analizado."},
            {"Indicador": "Transcripts", "Calculo": "Cantidad de transcript_id unicos.", "Lectura": "Cobertura de conversaciones analizadas."},
            {"Indicador": "Deals con Match", "Calculo": "Cantidad de deal_id unicos no nulos.", "Lectura": "Deals con senales enlazadas."},
            {"Indicador": "Revenue Total", "Calculo": "Suma de amount por deal_id unico.", "Lectura": "Magnitud economica del universo analizado."},
            {"Indicador": "Competidores Unicos", "Calculo": "Cantidad de competitor_name unicos no nulos.", "Lectura": "Diversidad competitiva detectada."},
        ])
        st.dataframe(kpi_df, use_container_width=True, hide_index=True)

    with st.expander("Como leer graficos", expanded=False):
        chart_df = pd.DataFrame([
            {"Campo": "Eje X", "Definicion": "Dimension principal (ej: Region, Tipo de insight, Modulo).", "Tip": "Elegi una variable categorica para comparar grupos."},
            {"Campo": "Columna Y", "Definicion": "Metrica a calcular/mostrar en el eje vertical.", "Tip": "Para suma/promedio/mediana usa metricas numericas."},
            {"Campo": "Color por", "Definicion": "Segmenta cada barra/linea por otra dimension.", "Tip": "Compara cortes dentro del mismo grafico."},
            {"Campo": "Agregacion", "Definicion": "Regla para calcular el valor del grafico.", "Tip": "Conteo, Suma, Promedio, Mediana o Conteo distinto."},
            {"Campo": "Top N", "Definicion": "Limita a las N categorias mas relevantes.", "Tip": "Evita graficos sobrecargados."},
        ])
        st.dataframe(chart_df, use_container_width=True, hide_index=True)

    with st.expander("Diccionario de variables", expanded=False):
        var_df = pd.DataFrame([
            {"Variable": "region", "Significado": "Region comercial/geografica del deal."},
            {"Variable": "country", "Significado": "Pais asociado al deal o la conversacion."},
            {"Variable": "segment", "Significado": "Segmento comercial (ej: SMB, Mid-Market, Enterprise)."},
            {"Variable": "deal_owner", "Significado": "AE responsable del deal."},
            {"Variable": "module_display", "Significado": "Modulo de Humand asociado al insight."},
            {"Variable": "hr_category_display", "Significado": "Categoria HR del modulo."},
            {"Variable": "insight_subtype_display", "Significado": "Subtipo dentro del tipo de insight."},
            {"Variable": "pain_theme", "Significado": "Tema macro del pain (procesos, tecnologia, etc.)."},
            {"Variable": "gap_priority", "Significado": "Urgencia del gap: must_have, nice_to_have, dealbreaker."},
            {"Variable": "competitor_relationship_display", "Significado": "Relacion con competidor (usa, evalua, migra, etc.)."},
            {"Variable": "call_date", "Significado": "Fecha de la llamada analizada."},
            {"Variable": "confidence", "Significado": "Confianza del modelo para ese insight (0 a 1)."},
            {"Variable": "amount", "Significado": "Monto del deal usado para analisis de revenue."},
        ])
        st.dataframe(var_df, use_container_width=True, hide_index=True)


# ── Empty state ──────────────────────────────────────────────────────────

if q and not any([
    show_section_1,
    insight_rows,
    pain_by_theme,
    pg_rows,
    df_rows,
    faq_rows,
    modules_by_cat,
    show_competition,
    feat_rows,
    show_guide,
]):
    st.info(f'No se encontraron resultados para "{search}".')
