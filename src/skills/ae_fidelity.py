"""
Chequeos de calidad de las unidades de discurso del AE. Funciones puras, sin I/O.

La idea central: la fidelidad del `verbatim_quote` es verificable sin juez LLM —
si la cita no aparece en el chunk, el modelo la invento o la edito. Eso convierte
el gate de calidad en algo deterministico y gratis, que se puede correr sobre el
100% de las unidades en vez de sobre una muestra.
"""
from __future__ import annotations

import re

# Muletillas y aperturas que el modelo suele recortar o agregar al inicio de la
# cita. No afectan la literalidad de la idea, si el resto matchea.
_FILLER_PREFIX = re.compile(r"^(mira|o sea|digamos|este|eh+|bueno|nada|si|claro)[\s,]+", re.I)

MIN_QUOTE_WORDS = 8
NEEDS_TRIGGER = ("faq_answer", "objection_handling")


def normalize_for_match(s: str | None) -> str:
    """Normaliza texto para comparar citas contra el transcript.

    Colapsa espacios y saca puntuacion: sin esto la fidelidad da falsos negativos
    por comillas tipograficas, saltos de linea o dobles espacios que el modelo no
    reproduce caracter por caracter.
    """
    s = (s or "").lower().replace("’", "'").replace("“", '"').replace("”", '"')
    s = re.sub(r"[^\w\s]", " ", s, flags=re.UNICODE)
    return re.sub(r"\s+", " ", s).strip()


def is_literal(quote: str | None, chunk_text: str | None) -> bool:
    """True si la cita aparece textual en el chunk (modulo normalizacion)."""
    q = normalize_for_match(quote)
    if not q:
        return False
    haystack = normalize_for_match(chunk_text)
    if q in haystack:
        return True
    # Segundo intento sin la muletilla inicial: "Mira, Humand es..." vs "Humand es..."
    stripped = normalize_for_match(_FILLER_PREFIX.sub("", quote or ""))
    return bool(stripped) and stripped in haystack


def check_attribution(speaker_name: str | None, deal_owner: str | None) -> str:
    """'ok' | 'mismatch' | 'sin_dato'.

    Match por partes del nombre: el transcript trae "Salvador" o "Salvador Castro"
    y HubSpot "Salvador Castro Bay". Se ignoran tokens de <=2 chars (particulas).
    """
    speaker = (speaker_name or "").strip().lower()
    if not speaker or not (deal_owner or "").strip():
        return "sin_dato"
    partes = [p.lower() for p in re.split(r"\s+", deal_owner.strip()) if len(p) > 2]
    if not partes:
        return "sin_dato"
    return "ok" if any(p in speaker for p in partes) else "mismatch"


def check_unit(unit: dict, chunk_text: str, deal_owner: str | None) -> dict:
    """Evalua una unidad. Devuelve {literal, attrib, problemas: [str]}."""
    quote = unit.get("verbatim_quote") or ""
    literal = is_literal(quote, chunk_text)
    attrib = check_attribution(unit.get("speaker_name"), deal_owner)
    unit_type = unit.get("unit_type")

    problemas: list[str] = []
    if not literal:
        problemas.append("cita no literal")
    if attrib == "mismatch":
        problemas.append(f"speaker '{unit.get('speaker_name')}' != owner '{deal_owner}'")
    if unit_type in NEEDS_TRIGGER and not unit.get("trigger"):
        problemas.append("falta trigger")
    if unit_type == "pitch_module" and not unit.get("module"):
        problemas.append("pitch_module sin module")
    if len(quote.split()) < MIN_QUOTE_WORDS:
        problemas.append("cita muy corta")

    return {"literal": literal, "attrib": attrib, "problemas": problemas}


def gate(stats: dict, total_units: int) -> tuple[bool, str]:
    """Decide si el prompt esta listo para el run completo.

    Dos condiciones: fidelidad >= 90% y a lo sumo 5% de atribuciones erroneas.
    Se elige un gate duro a proposito: el output alimenta un bot que le habla a
    leads, y una cita inventada ahi cuesta mas que un run de LLM.
    """
    if not total_units:
        return False, "sin unidades extraidas"
    fid = 100 * stats.get("literal_ok", 0) / total_units
    mismatch = stats.get("attrib_mismatch", 0)
    if fid < 90:
        return False, f"fidelidad {fid:.1f}% < 90%"
    if mismatch > total_units * 0.05:
        return False, f"{mismatch} atribuciones erroneas (> 5% de {total_units})"
    return True, f"fidelidad {fid:.1f}%, {mismatch} atribuciones erroneas"
