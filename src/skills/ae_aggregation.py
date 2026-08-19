"""
Agregacion del AE Playbook: unidades de discurso -> glosario y pitch patterns.
Funciones puras, sin I/O. El caller trae las filas y los embeddings.

La metrica que responde al pedido de Marketing ("si puede filtrarse por las demos
mas exitosas mejor") es `validated_lift`: cuanto mas se usa una forma de explicar
en demos validated que en el resto. Ver docstring de `validated_lift` — el detalle
importa, porque la version naive de esa cuenta miente.
"""
from __future__ import annotations

from collections import Counter, defaultdict

MIN_DEMOS_DEFAULT = 2


def validated_lift(
    demos_pattern: int,
    demos_pattern_validated: int,
    demos_total: int,
    demos_total_validated: int,
) -> float | None:
    """Ratio entre la tasa de validated del patron y la tasa base del dataset.

    1.0 = se usa igual en demos exitosas que en el resto. 1.4 = aparece 40% mas
    seguido en demos que validaron. Devuelve None si no hay base para comparar.

    Por que no se usa directamente "% de demos validated que lo usan": ese numero
    sube y baja con la tasa base de validacion del recorte (si el 70% de las demos
    del dataset validaron, cualquier patron va a dar ~70% y parece bueno). Al
    dividir por la tasa base, 1.0 queda como "no aporta informacion" y el numero
    se puede comparar entre patrones y entre recortes.

    NO es causal: mide co-ocurrencia. Un patron con lift alto puede ser una
    consecuencia de la demo que iba bien, no su causa. Se usa para priorizar que
    revisar, no para afirmar que funciona.
    """
    if demos_pattern <= 0 or demos_total <= 0 or demos_total_validated <= 0:
        return None
    tasa_patron = demos_pattern_validated / demos_pattern
    tasa_base = demos_total_validated / demos_total
    if tasa_base == 0:
        return None
    return round(tasa_patron / tasa_base, 2)


def _demo_counts(rows: list[dict]) -> tuple[int, int]:
    """(demos distintas, demos distintas validated) sobre un conjunto de filas."""
    demos = {r.get("transcript_id") for r in rows if r.get("transcript_id")}
    validadas = {r.get("transcript_id") for r in rows
                 if r.get("transcript_id") and r.get("is_validated")}
    return len(demos), len(validadas)


def dataset_baseline(rows: list[dict]) -> tuple[int, int]:
    """Tasa base del recorte: (demos totales, demos validated).

    Se calcula una vez sobre TODAS las unidades del recorte y se pasa a cada
    patron. Calcularla por patron daria 1.0 siempre.
    """
    return _demo_counts(rows)


def build_glossary(
    term_rows: list[dict],
    baseline: tuple[int, int] | None = None,
    min_demos: int = MIN_DEMOS_DEFAULT,
) -> list[dict]:
    """Glosario canonicalizado a partir de las filas de ae_term_usages + su unidad.

    Cada fila de entrada necesita: term, term_norm, gloss, module, transcript_id,
    is_validated, country (opcional), verbatim_quote (opcional, para el ejemplo).

    Agrupa por `term_norm`, elige como canonico la grafia mas usada, y lista el
    resto como alias — que es justo lo que pidio Marketing: no la definicion
    oficial del producto, sino como lo nombra Sales en la cancha.

    `baseline` tiene que venir de dataset_baseline() sobre TODAS las unidades del
    recorte, no solo sobre las que traen terminos: las demos donde el AE no uso
    jerga igual cuentan para la tasa base. Si se omite, se calcula sobre
    `term_rows` y el `validated_lift` queda sesgado hacia 1.0 — sirve para
    inspeccionar, no para priorizar.
    """
    por_norm: dict[str, list[dict]] = defaultdict(list)
    for r in term_rows:
        norm = r.get("term_norm")
        if norm:
            por_norm[norm].append(r)

    total_demos, total_validated = baseline if baseline else dataset_baseline(term_rows)

    out = []
    for norm, group in por_norm.items():
        demos, demos_val = _demo_counts(group)
        if demos < min_demos:
            continue

        grafias = Counter(r["term"].strip() for r in group if r.get("term"))
        canonical = grafias.most_common(1)[0][0]
        aliases = [g for g, _ in grafias.most_common()[1:]]

        glosas = Counter(g for g in (r.get("gloss") for r in group) if g)
        modulos = Counter(m for m in (r.get("module") for r in group) if m)
        ejemplo = next((r.get("verbatim_quote") for r in group if r.get("verbatim_quote")), None)

        out.append({
            "term_canonical": canonical,
            "term_norm": norm,
            "aliases": aliases,
            # La glosa mas repetida, no una sintetizada: es como lo explican, no
            # como deberia explicarse. La sintesis es un paso posterior y humano.
            "definition": glosas.most_common(1)[0][0] if glosas else None,
            "module": modulos.most_common(1)[0][0] if modulos else None,
            "example_quote": ejemplo,
            "usages": len(group),
            "demos": demos,
            "demos_validated": demos_val,
            "validated_lift": validated_lift(demos, demos_val, total_demos, total_validated),
            "markets": sorted({r["country"] for r in group if r.get("country")}),
        })

    out.sort(key=lambda t: (-t["demos"], -t["usages"]))
    return out


def build_pitch_patterns(
    clusters: list[dict],
    baseline: tuple[int, int],
    min_demos: int = MIN_DEMOS_DEFAULT,
    max_examples: int = 3,
) -> list[dict]:
    """Pitch patterns a partir de clusters de unidades `pitch_*`.

    `clusters` es la salida de faq_clustering.cluster_by_vectors sobre las
    unidades (cada uno con "items" = filas de ae_speech_units). `baseline` es
    (demos_totales, demos_validated) del recorte completo, de dataset_baseline().

    El `label` y la `description` que salen de aca son placeholders derivados de
    los datos; la redaccion final la escribe un LLM por cluster y despues la firma
    una persona. Esta funcion no llama a nada — solo arma la estructura y las
    metricas, que es lo que tiene que ser testeable.
    """
    total_demos, total_validated = baseline
    out = []

    for c in clusters:
        items = c.get("items") or []
        demos, demos_val = _demo_counts(items)
        if demos < min_demos:
            continue

        modulos = Counter(m for m in (i.get("module") for i in items) if m)
        tipos = Counter(t for t in (i.get("unit_type") for i in items) if t)

        # Ejemplos: los de mayor confianza y verificados como literales. Un
        # ejemplo no literal en el playbook es una cita que el AE nunca dijo.
        candidatos = sorted(
            (i for i in items if i.get("verbatim_quote") and i.get("is_literal") is not False),
            key=lambda i: (i.get("confidence") or 0),
            reverse=True,
        )

        out.append({
            "unit_type": tipos.most_common(1)[0][0] if tipos else None,
            "module": modulos.most_common(1)[0][0] if modulos else None,
            "label": (c.get("canonical") or "")[:120],
            "description": c.get("canonical") or "",
            "example_quotes": [i["verbatim_quote"] for i in candidatos[:max_examples]],
            "unit_ids": [i["id"] for i in items if i.get("id")],
            "demos": demos,
            "demos_validated": demos_val,
            "validated_lift": validated_lift(demos, demos_val, total_demos, total_validated),
            "markets": sorted({i["country"] for i in items if i.get("country")}),
            "aes": sorted({i["deal_owner"] for i in items if i.get("deal_owner")}),
        })

    # Orden: primero cobertura, despues lift. Un patron con lift 3.0 sobre 2 demos
    # es ruido; uno con lift 1.3 sobre 40 demos es una señal.
    out.sort(key=lambda p: (-p["demos"], -(p["validated_lift"] or 0)))
    return out
