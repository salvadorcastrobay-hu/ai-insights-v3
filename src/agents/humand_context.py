"""
Deterministic Humand brand context for the marketing advisor.

This module turns first-party product knowledge into prompt-ready text so the
advisor understands what Humand is, what modules exist today, and which
competitors matter strategically by market. It does not use any network calls.
"""
from __future__ import annotations

from collections import defaultdict

from taxonomy import COMPETITORS, HR_CATEGORIES, MODULES


HUMAND_BRAND_BRIEF = {
    "company_name": "Humand",
    "domain": "humand.co",
    "category": "software HR all-in-one y app de empleados",
    "core_promise": (
        "Centralizar interacciones de empleados, procesos de RRHH y cultura en una "
        "sola plataforma simple de usar."
    ),
    "product_pillars": [
        "Internal Communication",
        "HR Management",
        "Company Culture",
        "Talent Development",
        "Operations",
    ],
    "strategic_strengths": [
        "Centraliza comunicacion, procesos de personas y operaciones del empleado en una sola plataforma",
        "Permite comunicacion segmentada por grupos o locaciones y alcance rapido a la audiencia correcta",
        "Tiene buen fit para organizaciones distribuidas, multisede y con mucho personal frontline",
        "Cubre workflows de RRHH como documentos, onboarding, vacaciones, control horario, capacitacion y desempeno",
    ],
    "focus_industries": [
        "Logistics",
        "Technology",
        "Manufacturing",
        "Construction",
        "Retail",
        "Healthcare",
    ],
}


MARKET_LABELS = {
    "latam": "LATAM",
    "emea": "EMEA",
    "north_america": "North America",
    "apac": "APAC",
}


REGION_TO_COMPETITOR_MARKET = {
    "LATAM": "latam",
    "Brazil": "latam",
    "EMEA": "emea",
    "North America": "north_america",
    "APAC": "apac",
    "MENA": "emea",
}


COUNTRY_TO_COMPETITOR_MARKET = {
    "argentina": "latam",
    "bolivia": "latam",
    "brasil": "latam",
    "brazil": "latam",
    "chile": "latam",
    "colombia": "latam",
    "costa rica": "latam",
    "ecuador": "latam",
    "guatemala": "latam",
    "mexico": "latam",
    "méxico": "latam",
    "panama": "latam",
    "panamá": "latam",
    "paraguay": "latam",
    "peru": "latam",
    "perú": "latam",
    "uruguay": "latam",
    "venezuela": "latam",
    "spain": "emea",
    "españa": "emea",
    "portugal": "emea",
    "france": "emea",
    "germany": "emea",
    "italy": "emea",
    "united kingdom": "emea",
    "uk": "emea",
    "united states": "north_america",
    "usa": "north_america",
    "canada": "north_america",
    "australia": "apac",
    "new zealand": "apac",
    "singapore": "apac",
    "india": "apac",
}


MODULE_STATUS_BY_DISPLAY = {
    meta["display_name"]: meta["status"] for meta in MODULES.values()
}


def get_module_status_label(module_display: str | None) -> str:
    """Returns taxonomy status for a human-readable module name."""
    if not module_display:
        return ""
    return MODULE_STATUS_BY_DISPLAY.get(module_display, "")


def _group_modules_by_category(status: str) -> list[tuple[str, list[str]]]:
    grouped: dict[str, list[str]] = defaultdict(list)
    for module in sorted(MODULES.values(), key=lambda item: item["sort_order"]):
        if module["status"] != status:
            continue
        category_code = module["hr_category"]
        grouped[category_code].append(module["display_name"])

    rows = []
    for category_code, category_meta in sorted(
        HR_CATEGORIES.items(), key=lambda item: item[1]["sort_order"]
    ):
        items = grouped.get(category_code, [])
        if items:
            rows.append((category_meta["display_name"], items))
    return rows


def _resolve_competitor_market(filters: dict) -> tuple[str | None, str]:
    region = (filters.get("region") or "").strip()
    if region:
        market_code = REGION_TO_COMPETITOR_MARKET.get(region)
        if market_code:
            if region == "Brazil":
                return market_code, "Brazil (within LATAM)"
            return market_code, region

    country = (filters.get("country") or "").strip().lower()
    if country:
        market_code = COUNTRY_TO_COMPETITOR_MARKET.get(country)
        if market_code:
            return market_code, filters.get("country") or MARKET_LABELS.get(market_code, market_code)

    return None, "mercado global"


def _competitor_examples_for_market(filters: dict, max_items: int = 12) -> tuple[str, list[str]]:
    market_code, market_label = _resolve_competitor_market(filters)
    if market_code:
        competitors = sorted(
            [name for name, region in COMPETITORS.items() if region == market_code]
        )
        return market_label, competitors[:max_items]

    competitors = sorted(COMPETITORS.keys())
    return market_label, competitors[:max_items]


def build_humand_brand_context(filters: dict) -> str:
    """Formats first-party Humand context for the marketing advisor prompt."""
    existing_modules = _group_modules_by_category("existing")
    missing_modules = _group_modules_by_category("missing")
    competitor_market, competitor_examples = _competitor_examples_for_market(filters)

    lines = ["=== CONTEXTO HUMAND (FIRST-PARTY) ==="]
    lines.append(
        f"- Compania: {HUMAND_BRAND_BRIEF['company_name']} ({HUMAND_BRAND_BRIEF['domain']})"
    )
    lines.append(f"- Categoria: {HUMAND_BRAND_BRIEF['category']}")
    lines.append(f"- Propuesta central: {HUMAND_BRAND_BRIEF['core_promise']}")
    lines.append(
        "- Pilares de producto: "
        + ", ".join(HUMAND_BRAND_BRIEF["product_pillars"])
    )
    lines.append(
        "- Fortalezas estrategicas: "
        + "; ".join(HUMAND_BRAND_BRIEF["strategic_strengths"])
    )
    lines.append(
        "- Industrias foco visibles en el sitio: "
        + ", ".join(HUMAND_BRAND_BRIEF["focus_industries"])
    )
    lines.append("")
    lines.append("MODULOS EXISTENTES DE HUMAND:")
    for category_name, module_names in existing_modules:
        lines.append(f"- {category_name}: {', '.join(module_names)}")
    lines.append("")
    lines.append("MODULOS MARCADOS COMO MISSING / GAP CONOCIDO:")
    for category_name, module_names in missing_modules:
        lines.append(f"- {category_name}: {', '.join(module_names)}")
    lines.append("")
    lines.append("GUARDRAILS DE POSICIONAMIENTO:")
    lines.append(
        "- Nunca presentes un modulo marcado como missing como fortaleza actual o capacidad nativa confirmada."
    )
    lines.append(
        "- Si el segmento pide algo missing o un feature gap critico, recomienda transparencia, calificacion upfront o un angulo alternativo apoyado en modulos existentes."
    )
    lines.append(
        "- Usa el catalogo competitivo solo para orientacion estrategica. Las menciones reales del segmento vienen aparte en el bloque de evidencia."
    )
    lines.append("")
    lines.append(
        f"CATALOGO COMPETITIVO CURADO PARA ORIENTACION ({competitor_market}):"
    )
    lines.append(f"- Ejemplos relevantes: {', '.join(competitor_examples)}")
    lines.append(f"- Competidores curados totales en taxonomia: {len(COMPETITORS)}")
    return "\n".join(lines)
