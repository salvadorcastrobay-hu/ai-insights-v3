"""
Helpers compartidos para filtros de mercado en skills del advisor.
"""
from __future__ import annotations

CANONICAL_REGION_OPTIONS = [
    "",
    "HISPAM",
    "ANGLO AMERICA",
    "Brazil",
    "EMEA",
    "APAC",
    "MENA",
]

REGION_FILTER_MAP = {
    "HISPAM": [
        "HISPAM",
        "LATAM",
        "Santa Fe Province",
        "Mendoza Province",
        "Mendoza",
        "Cordoba",
        "Córdoba",
        "Ciudad de Mexico",
        "Ciudad de México",
        "Mexico City",
    ],
    "Brazil": ["Brazil", "Brasil"],
    "EMEA": ["EMEA", "Community of Madrid", "Madrid", "Spain", "Espana", "España"],
    "ANGLO AMERICA": ["ANGLO AMERICA", "NORTH AMERICA", "North America", "NAMER"],
    "APAC": ["APAC"],
    "MENA": ["MENA"],
}


def build_region_filter_clause(column: str, region_value: str | list[str] | None) -> tuple[str | None, list]:
    """
    Devuelve una clausula SQL parameterizada y sus params para filtros de region.

    Si la region no esta en el mapa canonico, cae a un ILIKE simple sobre el valor recibido.
    """
    if not region_value:
        return None, []

    if isinstance(region_value, list):
        clauses = []
        params = []
        for value in region_value:
            clause, clause_params = build_region_filter_clause(column, value)
            if clause:
                clauses.append(f"({clause})")
                params.extend(clause_params)
        if not clauses:
            return None, []
        return " OR ".join(clauses) if len(clauses) == 1 else f"({' OR '.join(clauses)})", params

    mapped_values = REGION_FILTER_MAP.get(region_value)
    if mapped_values:
        lowered = [value.lower() for value in mapped_values]
        return f"LOWER(COALESCE({column}, '')) = ANY(%s)", [lowered]

    return f"{column} ILIKE %s", [f"%{region_value}%"]
