"""
Agregacion del AE Playbook: unidades de discurso -> glosario y pitch patterns.
Funciones puras, sin I/O. El caller trae las filas y los embeddings.

La metrica que responde al pedido de Marketing ("si puede filtrarse por las demos
mas exitosas mejor") es `success_lift`: cuanto mas se usa una forma de explicar en demos exitosas que
en el resto. Ver su docstring y la nota de SUCCESS_METRIC_DEFAULT — el detalle
importa, porque la version naive de esa cuenta miente y la eleccion de que cuenta
como "exitosa" la puede volver inservible.
"""
from __future__ import annotations

from collections import Counter, defaultdict

MIN_DEMOS_DEFAULT = 2

# Default 'won' y no 'validated'. Medido sobre HISPAM: is_validated cubre el 78.9%
# de los transcripts (6438/8161), asi que no es una señal de exito sino un flag de
# higiene — "la reunion paso y era real". Con una tasa base de 0.789 el lift maximo
# posible es 1/0.789 = 1.27, o sea todo da entre 0.9 y 1.2 y no distingue nada.
# Won es 12.7% (1040/8161): base baja, rango real, y es lo que Marketing quiere
# decir con "las que cierran al cliente".
SUCCESS_METRIC_DEFAULT = "won"


def success_predicate(metric: str = SUCCESS_METRIC_DEFAULT):
    """Devuelve la funcion que decide si una fila es de una demo 'exitosa'.

    - 'won': el deal llego a una etapa de cierre ganado.
    - 'validated': first_meeting_status = 'Validated'. Sirve como filtro de
      higiene, NO como señal de exito (ver nota de SUCCESS_METRIC_DEFAULT).
    """
    if metric == "validated":
        return lambda r: bool(r.get("is_validated"))
    if metric == "won":
        return lambda r: "won" in (r.get("deal_stage") or "").lower()
    raise ValueError(f"metrica de exito desconocida: {metric!r}")


def success_lift(
    demos_pattern: int,
    demos_pattern_success: int,
    demos_total: int,
    demos_total_success: int,
) -> float | None:
    """Ratio entre la tasa de exito del patron y la tasa base del dataset.

    1.0 = se usa igual en demos exitosas que en el resto. 1.4 = aparece 40% mas
    seguido en las que cerraron. Devuelve None si no hay base para comparar.

    Por que no se usa directamente "% de demos exitosas que lo usan": ese numero
    sube y baja con la tasa base del recorte (si el 70% de las demos del dataset
    cuentan como exitosas, cualquier patron va a dar ~70% y parece bueno). Al
    dividir por la tasa base, 1.0 queda como "no aporta informacion" y el numero
    se puede comparar entre patrones y entre recortes.

    NO es causal: mide co-ocurrencia. Un patron con lift alto puede ser una
    consecuencia de la demo que iba bien, no su causa. Se usa para priorizar que
    revisar, no para afirmar que funciona.
    """
    if demos_pattern <= 0 or demos_total <= 0 or demos_total_success <= 0:
        return None
    tasa_patron = demos_pattern_success / demos_pattern
    tasa_base = demos_total_success / demos_total
    if tasa_base == 0:
        return None
    return round(tasa_patron / tasa_base, 2)


def _demo_counts(rows: list[dict], es_exito=None) -> tuple[int, int]:
    """(demos distintas, demos distintas exitosas) sobre un conjunto de filas."""
    if es_exito is None:
        es_exito = success_predicate()
    demos = {r.get("transcript_id") for r in rows if r.get("transcript_id")}
    exitosas = {r.get("transcript_id") for r in rows
                if r.get("transcript_id") and es_exito(r)}
    return len(demos), len(exitosas)


def dataset_baseline(rows: list[dict], metric: str = SUCCESS_METRIC_DEFAULT) -> tuple[int, int]:
    """Tasa base del recorte: (demos totales, demos exitosas).

    Se calcula una vez sobre TODAS las unidades del recorte y se pasa a cada
    patron. Calcularla por patron daria 1.0 siempre.
    """
    return _demo_counts(rows, success_predicate(metric))


def build_glossary(
    term_rows: list[dict],
    baseline: tuple[int, int] | None = None,
    min_demos: int = MIN_DEMOS_DEFAULT,
    metric: str = SUCCESS_METRIC_DEFAULT,
) -> list[dict]:
    """Glosario canonicalizado a partir de las filas de ae_term_usages + su unidad.

    Cada fila de entrada necesita: term, term_norm, gloss, module, transcript_id,
    deal_stage (o is_validated si metric='validated'), country y verbatim_quote
    (opcionales, para mercados y ejemplo).

    Agrupa por `term_norm`, elige como canonico la grafia mas usada, y lista el
    resto como alias — que es justo lo que pidio Marketing: no la definicion
    oficial del producto, sino como lo nombra Sales en la cancha.

    `baseline` tiene que venir de dataset_baseline() sobre TODAS las unidades del
    recorte, no solo sobre las que traen terminos: las demos donde el AE no uso
    jerga igual cuentan para la tasa base. Si se omite, se calcula sobre
    `term_rows` y el `success_lift` queda sesgado hacia 1.0 — sirve para
    inspeccionar, no para priorizar.
    """
    por_norm: dict[str, list[dict]] = defaultdict(list)
    for r in term_rows:
        norm = r.get("term_norm")
        if norm:
            por_norm[norm].append(r)

    es_exito = success_predicate(metric)
    total_demos, total_success = baseline if baseline else dataset_baseline(term_rows, metric)

    out = []
    for norm, group in por_norm.items():
        demos, demos_val = _demo_counts(group, es_exito)
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
            "demos_success": demos_val,
            "success_lift": success_lift(demos, demos_val, total_demos, total_success),
            "markets": sorted({r["country"] for r in group if r.get("country")}),
        })

    out.sort(key=lambda t: (-t["demos"], -t["usages"]))
    return out


def build_pitch_patterns(
    clusters: list[dict],
    baseline: tuple[int, int],
    min_demos: int = MIN_DEMOS_DEFAULT,
    max_examples: int = 3,
    metric: str = SUCCESS_METRIC_DEFAULT,
) -> list[dict]:
    """Pitch patterns a partir de clusters de unidades `pitch_*`.

    `clusters` es la salida de faq_clustering.cluster_by_vectors sobre las
    unidades (cada uno con "items" = filas de ae_speech_units). `baseline` es
    (demos_totales, demos_exitosas) del recorte completo, de dataset_baseline().

    El `label` y la `description` que salen de aca son placeholders derivados de
    los datos; la redaccion final la escribe un LLM por cluster y despues la firma
    una persona. Esta funcion no llama a nada — solo arma la estructura y las
    metricas, que es lo que tiene que ser testeable.
    """
    total_demos, total_success = baseline
    es_exito = success_predicate(metric)
    out = []

    for c in clusters:
        items = c.get("items") or []
        demos, demos_val = _demo_counts(items, es_exito)
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
            "demos_success": demos_val,
            "success_lift": success_lift(demos, demos_val, total_demos, total_success),
            "markets": sorted({i["country"] for i in items if i.get("country")}),
            "aes": sorted({i["deal_owner"] for i in items if i.get("deal_owner")}),
        })

    # Orden: primero cobertura, despues lift. Un patron con lift 3.0 sobre 2 demos
    # es ruido; uno con lift 1.3 sobre 40 demos es una señal.
    out.sort(key=lambda p: (-p["demos"], -(p["success_lift"] or 0)))
    return out
