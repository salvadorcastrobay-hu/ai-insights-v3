"""
Parser AE-side: respuesta del LLM -> filas de ae_speech_units / ae_term_usages.

Equivalente a parser.py pero para el discurso del AE. Dos diferencias de fondo:

  - Corre el chequeo deterministico de fidelidad ANTES de insertar y persiste el
    resultado (`is_literal`, `attribution`). Asi el pack se puede filtrar a
    unidades verificadas sin volver a leer el transcript.
  - Descarta unidades sin `verbatim_quote` y, opcionalmente, las no literales.
    Una unidad con la cita inventada no tiene valor: el verbatim ES el producto.
"""
from __future__ import annotations

import hashlib
import logging
import re

from src.skills.ae_fidelity import check_attribution, is_literal

logger = logging.getLogger(__name__)

VALID_UNIT_TYPES = {
    "pitch_company", "pitch_module", "faq_answer",
    "objection_handling", "discovery_question", "proof_point",
}

# Metadata que se copia tal cual del deal al momento de extraer.
META_FIELDS = [
    "deal_id", "company_name", "region", "country", "industry", "segment",
    "deal_stage", "deal_owner", "call_date", "is_validated",
]


def compute_unit_hash(unit: dict, transcript_id: str, chunk: int, prompt_version: str) -> str:
    """SHA256 para dedup por upsert(on_conflict='content_hash').

    Incluye la prompt_version por el mismo motivo que db.compute_content_hash:
    la misma cita extraida bajo dos versiones del prompt son dos filas, no una
    que sobreescribe silenciosamente a la otra.

    Usa el verbatim normalizado y no la paraphrase: la paraphrase varia entre
    corridas aunque la cita sea identica, y eso rompe la idempotencia del run.
    """
    key = "|".join([
        transcript_id,
        str(chunk),
        unit.get("unit_type", ""),
        unit.get("module") or "",
        normalize_term(unit.get("verbatim_quote") or ""),
        prompt_version,
    ])
    return hashlib.sha256(key.encode()).hexdigest()


def normalize_term(text: str | None) -> str:
    """Clave de agrupacion para terminos y citas: minusculas, sin acentos ni puntuacion."""
    s = (text or "").lower()
    for a, b in (("á", "a"), ("é", "e"), ("í", "i"), ("ó", "o"), ("ú", "u"),
                 ("ñ", "n"), ("ü", "u")):
        s = s.replace(a, b)
    s = re.sub(r"[^\w\s]", " ", s, flags=re.UNICODE)
    return re.sub(r"\s+", " ", s).strip()


def parse_ae_response(
    result: dict,
    transcript_id: str,
    chunk_index: int,
    chunk_text: str,
    metadata: dict,
    model_used: str,
    prompt_version: str,
    drop_non_literal: bool = True,
    min_confidence: float = 0.0,
) -> tuple[list[dict], dict]:
    """Convierte la respuesta del LLM en filas listas para insertar.

    Devuelve (filas, stats). Cada fila trae `_terms` con las filas hijas de
    ae_term_usages; el caller las separa despues de insertar la unidad, porque
    necesitan el uuid que asigna la DB.
    """
    stats = {
        "recibidas": 0, "insertables": 0,
        "descartadas_sin_quote": 0, "descartadas_no_literal": 0,
        "descartadas_tipo_invalido": 0, "descartadas_confianza": 0,
        "atribucion_mismatch": 0,
    }
    rows: list[dict] = []
    owner = metadata.get("deal_owner")
    vistas: set[str] = set()

    for unit in (result or {}).get("units", []) or []:
        stats["recibidas"] += 1

        unit_type = unit.get("unit_type")
        if unit_type not in VALID_UNIT_TYPES:
            stats["descartadas_tipo_invalido"] += 1
            logger.warning(f"{transcript_id}#{chunk_index}: unit_type invalido {unit_type!r}")
            continue

        quote = (unit.get("verbatim_quote") or "").strip()
        if not quote:
            stats["descartadas_sin_quote"] += 1
            continue

        confidence = unit.get("confidence")
        if confidence is not None and confidence < min_confidence:
            stats["descartadas_confianza"] += 1
            continue

        literal = is_literal(quote, chunk_text)
        if not literal and drop_non_literal:
            stats["descartadas_no_literal"] += 1
            logger.info(f"{transcript_id}#{chunk_index}: cita no literal, descartada: {quote[:60]}")
            continue

        attribution = check_attribution(unit.get("speaker_name"), owner)
        if attribution == "mismatch":
            stats["atribucion_mismatch"] += 1

        content_hash = compute_unit_hash(unit, transcript_id, chunk_index, prompt_version)
        # Dedup intra-chunk: el modelo a veces devuelve la misma cita en dos
        # unit_types. El unique index de la DB lo atajaria, pero asi no se
        # gastan roundtrips ni se inflan los contadores del run.
        if content_hash in vistas:
            continue
        vistas.add(content_hash)

        row = {
            "transcript_id": transcript_id,
            "transcript_chunk": chunk_index,
            **{f: metadata.get(f) for f in META_FIELDS},
            "unit_type": unit_type,
            "module": unit.get("module"),
            "verbatim_quote": quote,
            "paraphrase": unit.get("paraphrase"),
            "trigger_quote": unit.get("trigger"),
            "speaker_name": unit.get("speaker_name"),
            "confidence": confidence,
            "is_literal": literal,
            "attribution": attribution,
            "model_used": model_used,
            "ae_prompt_version": prompt_version,
            "content_hash": content_hash,
            "_terms": _parse_terms(unit.get("terms")),
        }
        rows.append(row)
        stats["insertables"] += 1

    return rows, stats


def _parse_terms(terms) -> list[dict]:
    """Filas de ae_term_usages, deduplicadas por term_norm dentro de la unidad."""
    out, vistos = [], set()
    for t in terms or []:
        term = (t.get("term") or "").strip()
        if not term:
            continue
        norm = normalize_term(term)
        if not norm or norm in vistos:
            continue
        vistos.add(norm)
        out.append({
            "term": term,
            "term_norm": norm,
            "module": t.get("module"),
            "gloss": (t.get("gloss") or "").strip() or None,
        })
    return out
