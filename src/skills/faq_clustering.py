"""
Agrupado de preguntas de leads en preguntas canonicas. Funciones puras, sin I/O.

Dos estrategias, misma interfaz:

  - `cluster_by_vectors`: single-linkage sobre similitud cosine de embeddings. Es
    la que se usa. Necesaria porque las variantes reales son sinonimicas, no
    lexicas: "cuanto sale" / "que precio tiene", "se integra con" / "tienen
    integracion con". Los vectores los provee el caller (esta capa no hace I/O).
  - `cluster_by_tokens`: Jaccard sobre palabras de contenido. Fallback sin red,
    util para tests y para inspeccionar rapido. Agrupa parafrasis lexicas y se
    pierde los sinonimos — no usarla para el pack que consume el bot.
"""
from __future__ import annotations

import math
import re
from collections import Counter

# Stopwords de español acotadas a lo que aparece en preguntas de demo. No usar una
# lista generica: palabras como "precio" o "integracion" son justamente la señal.
STOPWORDS = {
    "a", "al", "algo", "ahi", "como", "con", "cual", "cuales", "de", "del", "donde",
    "e", "el", "ella", "ellos", "en", "es", "esa", "ese", "eso", "esta", "este",
    "esto", "hay", "la", "las", "le", "les", "lo", "los", "mas", "me", "mi", "muy",
    "ni", "no", "nos", "o", "os", "para", "pero", "por", "que", "se", "si", "sin",
    "sobre", "su", "sus", "tambien", "te", "tiene", "tienen", "todo", "u", "un",
    "una", "uno", "unos", "vos", "y", "ya", "yo", "ustedes", "nosotros",
}

TOKEN_THRESHOLD = 0.45      # Jaccard, fallback lexico
VECTOR_THRESHOLD = 0.62     # cosine sobre text-embedding-3-large
MIN_TOKENS = 2


def tokenize(text: str | None) -> set[str]:
    """Palabras de contenido, sin acentos ni stopwords, para comparar preguntas."""
    s = (text or "").lower()
    for a, b in (("á", "a"), ("é", "e"), ("í", "i"), ("ó", "o"), ("ú", "u"), ("ñ", "n")):
        s = s.replace(a, b)
    words = re.findall(r"[a-z0-9]+", s)
    # Cortar plurales simples: "integraciones" y "integracion" tienen que caer juntas.
    stems = {w[:-2] if len(w) > 6 and w.endswith("es") else w.rstrip("s") if len(w) > 4 else w
             for w in words if w not in STOPWORDS and len(w) > 2}
    return stems


def similarity(a: set[str], b: set[str]) -> float:
    """Jaccard. 0 si alguno esta vacio."""
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def cosine(a: list[float], b: list[float]) -> float:
    """Cosine similarity. 0 si alguno es nulo o de norma cero."""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def cluster_by_vectors(
    items: list[dict],
    vectors: list[list[float]],
    text_key: str = "question",
    threshold: float = VECTOR_THRESHOLD,
) -> list[dict]:
    """Single-linkage sobre cosine. `vectors[i]` corresponde a `items[i]`.

    Single-linkage y no centroide: una pregunta entra al cluster si se parece a
    CUALQUIER miembro. Con centroide, un cluster que ya acumulo varias variantes
    empieza a rechazar la siguiente ("que precio tiene" contra un centroide de
    cuanto+sale+usuario diluye la señal) y se fragmenta justo en los clusters
    grandes, que son los que importan.
    """
    return _agglomerate(
        items, text_key,
        score=lambda i, j: cosine(vectors[i], vectors[j]),
        threshold=threshold,
        skip=lambda i: not vectors[i],
    )


def cluster_by_tokens(
    items: list[dict],
    text_key: str = "question",
    threshold: float = TOKEN_THRESHOLD,
) -> list[dict]:
    """Fallback lexico (Jaccard). Ver docstring del modulo: no agrupa sinonimos."""
    toks = [tokenize(it.get(text_key)) for it in items]
    return _agglomerate(
        items, text_key,
        score=lambda i, j: similarity(toks[i], toks[j]),
        threshold=threshold,
        skip=lambda i: len(toks[i]) < MIN_TOKENS,
    )


def _agglomerate(items, text_key, score, threshold, skip) -> list[dict]:
    """Single-linkage de un pase. O(n^2) en el peor caso; n aca son cientos.

    Estable en el orden de entrada, asi que el pack no cambia de forma entre
    corridas con los mismos datos. Los items que `skip` marca (sin vector, o con
    menos de MIN_TOKENS palabras de contenido, tipo "y eso?") van cada uno a su
    propio cluster en vez de contaminar uno grande.
    """
    clusters: list[list[int]] = []
    for i in range(len(items)):
        if skip(i):
            clusters.append([i])
            continue
        best, best_score = None, 0.0
        for c in clusters:
            s = max((score(i, j) for j in c), default=0.0)
            if s > best_score:
                best, best_score = c, s
        if best is not None and best_score >= threshold:
            best.append(i)
        else:
            clusters.append([i])

    out = []
    for c in clusters:
        miembros = [items[i] for i in c]
        textos = [t for t in (str(m.get(text_key) or "").strip() for m in miembros) if t]
        out.append({
            "canonical": _pick_canonical(textos),
            "variants": [t for t, _ in Counter(textos).most_common()],
            "items": miembros,
            "size": len(miembros),
        })
    out.sort(key=lambda c: c["size"], reverse=True)
    return out


def _pick_canonical(textos: list[str]) -> str:
    """La pregunta mas representativa del cluster: la de largo mediano.

    La mas corta suele estar truncada ("y el precio?") y la mas larga suele traer
    contexto de esa empresa en particular. La mediana es la mas reutilizable.
    """
    if not textos:
        return ""
    ordenados = sorted(set(textos), key=len)
    return ordenados[len(ordenados) // 2]
