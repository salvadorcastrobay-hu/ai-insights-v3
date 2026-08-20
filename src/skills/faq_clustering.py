"""
Agrupado de preguntas de leads en preguntas canonicas. Funciones puras, sin I/O.

Dos estrategias, misma interfaz:

  - `cluster_by_vectors`: sobre embeddings, la que se usa. Necesaria porque las
    variantes reales son sinonimicas y no lexicas: "cuanto sale" / "que precio
    tiene", "se integra con" / "tienen integracion con". Los vectores los provee
    el caller (esta capa no hace I/O).
  - `cluster_by_tokens`: Jaccard sobre palabras de contenido. Fallback sin red,
    util para tests y para inspeccionar rapido. Agrupa parafrasis lexicas y se
    pierde los sinonimos — no usarla para el pack que consume el bot.

`cluster_by_vectors` combina tres mecanismos, y la razon de que sean tres es una
leccion pagada en produccion:

  1. Single-linkage (componentes conexas del grafo de similitud). Es lo correcto
     para unir sinonimos, porque basta parecerse a UN miembro del grupo.
  2. Busqueda de umbral. El single-linkage encadena, y cuanto mas denso el
     conjunto, mas encadena, hasta colapsar todo en un pozo. El umbral que evita
     eso depende de la densidad, que no se conoce de antemano: se mide subiendo
     por THRESHOLD_LADDER hasta que el cluster mas grande baje de MAX_CLUSTER_SHARE.
  3. k-means esferico como ultimo recurso. Si ningun umbral parte el pozo, el
     conjunto es un continuo y no hay corte natural que encontrar — el umbral no
     puede ayudar por definicion. Ahi se fuerza una particion en k partes.

Y cada cluster reporta `coherence` (similitud media al medoide), porque contar
clusters no dice si son coherentes: la version que solo contaba dio "171
preguntas canonicas" donde una sola cubria 4045 demos de 7256.
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

# Fraccion maxima del universo que puede caer en un solo cluster antes de
# considerarlo un pozo. El single-linkage encadena: A~B, B~C, C~D y aunque A y D
# no tengan nada que ver terminan juntos. Medido en produccion: con umbral 0.62
# sobre 1326 parafrasis de pitch, 45 clusters donde uno se comia 138 de 140 demos;
# sobre 39k preguntas, un cluster cubria 4045 demos de 7256. Contar clusters no
# detecta eso — hay que mirar el tamaño del mas grande.
MAX_CLUSTER_SHARE = 0.15
# Umbrales que prueba la busqueda automatica, de mas permisivo a mas estricto.
THRESHOLD_LADDER = (0.62, 0.68, 0.74, 0.78, 0.82, 0.86, 0.90)


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
    threshold: float | None = None,
    max_share: float = MAX_CLUSTER_SHARE,
) -> list[dict]:
    """Agrupa por similitud de embeddings, subiendo el umbral hasta que no haya pozos.

    Con `threshold=None` (default) recorre THRESHOLD_LADDER y se queda con el
    primer umbral donde el cluster mas grande no supera `max_share` del universo.
    Con un umbral explicito lo respeta y no busca.

    POR QUE LA BUSQUEDA. Cada corte es single-linkage, que encadena: A~B, B~C, C~D
    y aunque A y D no tengan nada que ver caen juntos. A baja densidad eso es lo
    que se quiere — une "cuanto sale" con "que precio tiene" pasando por "cuanto
    cuesta". A alta densidad colapsa todo en un pozo. Ver el docstring del modulo.

    Cada cluster devuelve `coherence` (similitud media al medoide), `threshold`
    (el umbral con el que se corto) y, si hubo particion forzada,
    `split_from_blob`. Sirven para juzgar la salida en vez de confiar en el conteo.

    Cae al camino en Python puro si no hay numpy — correcto pero lento, solo
    viable para unos cientos de items.
    """
    try:
        import numpy as np  # noqa: F401
    except ImportError:
        return _agglomerate(
            items, text_key,
            score=lambda i, j: cosine(vectors[i], vectors[j]),
            threshold=threshold if threshold is not None else VECTOR_THRESHOLD,
            skip=lambda i: not vectors[i],
        )

    if threshold is not None:
        return _cluster_at(items, vectors, text_key, threshold)

    return _cluster_auto(items, vectors, text_key, max_share)


def _cluster_auto(items, vectors, text_key, max_share) -> list[dict]:
    """Sube el umbral hasta que no haya pozos; si no alcanza, parte por k-means.

    Cuando el pozo es real la particion forzada es lo correcto: si 138 de 140 demos
    dicen "somos una plataforma todo en uno", eso no es un error de clustering, es
    el pitch dominante — y lo util es ver en que se subdivide, no tirarlo ni
    dejarlo como un bloque unico.
    """
    escalera = THRESHOLD_LADDER
    resultado, usado = None, escalera[-1]
    for t in escalera:
        resultado = _cluster_at(items, vectors, text_key, t)
        total = sum(c["size"] for c in resultado) or 1
        if resultado and resultado[0]["size"] / total <= max_share:
            usado = t
            break
    else:
        # Ningun umbral de la escalera partio el pozo. Eso pasa cuando el conjunto
        # es un continuo: cada item esta pegado al siguiente y no hay ningun corte
        # natural. Ahi el umbral no puede ayudar por definicion — hay que forzar
        # una particion en k partes.
        pozo = resultado[0] if resultado else None
        if pozo and pozo["size"] > 4:
            indice = {id(it): k for k, it in enumerate(items)}
            sub_items = pozo["items"]
            sub_vecs = [vectors[indice[id(it)]] for it in sub_items]
            partes = _kmeans_split(sub_items, sub_vecs, text_key, max_share)
            for p in partes:
                p["split_from_blob"] = True
                p["threshold"] = escalera[-1]
            out = partes + resultado[1:]
            out.sort(key=lambda c: c["size"], reverse=True)
            return out
        for c in resultado or []:
            c["threshold"] = escalera[-1]
            c["blob_warning"] = True
        return resultado or []

    for c in resultado:
        c["threshold"] = usado
    return resultado


def _kmeans_split(items, vectors, text_key, max_share: float) -> list[dict]:
    """Parte un continuo en k partes con k-means esferico (Lloyd sobre cosine).

    Se usa solo cuando el umbral ya demostro no poder partir: en un continuo no hay
    corte natural que encontrar, asi que se elige k y se acepta que las fronteras
    son convencionales. k sale de max_share, o sea del tamaño maximo que se
    considera legible en la salida.

    Las fronteras siendo convencionales importa para leer el resultado: dos partes
    vecinas pueden ser variantes del mismo discurso, no dos discursos distintos.
    Por eso las partes van marcadas con split_from_blob.
    """
    import numpy as np

    validos = [i for i in range(len(items)) if vectors[i]]
    if len(validos) < 2:
        return [_con_coherencia(_pack_cluster(items, text_key))]

    M = np.asarray([vectors[i] for i in validos], dtype=np.float32)
    normas = np.linalg.norm(M, axis=1, keepdims=True)
    normas[normas == 0] = 1.0
    M /= normas

    # k tal que una parte promedio quede en torno a max_share del total.
    k = min(len(validos), max(2, int(np.ceil(1.0 / max_share))))

    # Inicializacion determinista (los k mas separados por muestreo espaciado) para
    # que la salida no cambie entre corridas con los mismos datos.
    paso = max(1, len(validos) // k)
    centros = M[[min(i * paso, len(validos) - 1) for i in range(k)]].copy()

    asignacion = np.zeros(len(validos), dtype=int)
    for _ in range(15):
        sims = M @ centros.T
        nueva = sims.argmax(axis=1)
        if np.array_equal(nueva, asignacion):
            break
        asignacion = nueva
        for c in range(k):
            miembros = M[asignacion == c]
            if len(miembros):
                v = miembros.mean(axis=0)
                n = np.linalg.norm(v)
                centros[c] = v / n if n else centros[c]

    out = []
    for c in range(k):
        locales = [l for l in range(len(validos)) if asignacion[l] == c]
        if not locales:
            continue
        cl = _pack_cluster([items[validos[l]] for l in locales], text_key)
        cl["coherence"], medoide = _coherence(M, locales)
        if medoide is not None:
            texto = str(items[validos[medoide]].get(text_key) or "").strip()
            if texto:
                cl["canonical"] = texto
        out.append(cl)

    for i in range(len(items)):
        if not vectors[i]:
            out.append(_con_coherencia(_pack_cluster([items[i]], text_key)))

    out.sort(key=lambda c: c["size"], reverse=True)
    return out


def _con_coherencia(cluster: dict) -> dict:
    """Garantiza la clave `coherence` en clusters armados sin vectores."""
    cluster.setdefault("coherence", None)
    return cluster


def _cluster_at(items, vectors, text_key, threshold: float) -> list[dict]:
    """Un corte de single-linkage al umbral dado."""
    import numpy as np

    n = len(items)
    validos = [i for i in range(n) if vectors[i]]
    if not validos:
        return [_con_coherencia(_pack_cluster([it], text_key)) for it in items]

    # Normalizar una vez: con vectores unitarios el cosine es el producto punto,
    # asi que el grafo sale de un solo matmul por bloque.
    M = np.asarray([vectors[i] for i in validos], dtype=np.float32)
    normas = np.linalg.norm(M, axis=1, keepdims=True)
    normas[normas == 0] = 1.0
    M /= normas

    padre = list(range(len(validos)))

    def find(x):
        while padre[x] != x:
            padre[x] = padre[padre[x]]
            x = padre[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            padre[rb] = ra

    # Por bloques de filas: la matriz completa de 39k x 39k no entra en memoria.
    BLOQUE = 512
    for ini in range(0, len(validos), BLOQUE):
        fin = min(ini + BLOQUE, len(validos))
        sims = M[ini:fin] @ M.T
        for local, fila in enumerate(sims):
            i = ini + local
            # Solo j > i: el grafo es simetrico y asi no se recorre dos veces.
            vecinos = np.nonzero(fila[i + 1:] >= threshold)[0]
            for off in vecinos:
                union(i, i + 1 + int(off))

    grupos: dict[int, list[int]] = {}
    for local in range(len(validos)):
        grupos.setdefault(find(local), []).append(local)

    out = []
    for locales in grupos.values():
        miembros = [items[validos[l]] for l in locales]
        c = _pack_cluster(miembros, text_key)
        c["coherence"], medoide = _coherence(M, locales)
        # El representante pasa a ser el medoide (el mas central), no la mediana
        # por largo de texto: en un cluster grande el texto mediano es arbitrario.
        if medoide is not None:
            texto = str(items[validos[medoide]].get(text_key) or "").strip()
            if texto:
                c["canonical"] = texto
        out.append(c)

    # Los items sin vector no participan del grafo: cada uno va solo, para no
    # inventar agrupaciones que no se midieron.
    for i in range(n):
        if not vectors[i]:
            c = _pack_cluster([items[i]], text_key)
            c["coherence"] = None
            out.append(c)

    out.sort(key=lambda c: c["size"], reverse=True)
    return out


def _coherence(M, locales: list[int]) -> tuple[float | None, int | None]:
    """(similitud media al medoide, indice del medoide).

    Es la señal que faltaba: un cluster con 4000 miembros y coherencia 0.35 es un
    pozo por encadenamiento, no un tema. Contar clusters no lo distingue.
    """
    import numpy as np

    if len(locales) < 2:
        return (1.0, locales[0] if locales else None)
    sub = M[locales]
    sims = sub @ sub.T
    medias = sims.mean(axis=1)
    k = int(np.argmax(medias))
    return (round(float(medias[k]), 3), locales[k])


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

    out = [_pack_cluster([items[i] for i in c], text_key) for c in clusters]
    out.sort(key=lambda c: c["size"], reverse=True)
    return out


def _pack_cluster(miembros: list[dict], text_key: str) -> dict:
    """Forma comun de un cluster, compartida por el camino numpy y el de Python."""
    textos = [t for t in (str(m.get(text_key) or "").strip() for m in miembros) if t]
    return {
        "canonical": _pick_canonical(textos),
        "variants": [t for t, _ in Counter(textos).most_common()],
        "items": miembros,
        "size": len(miembros),
    }


# Interrogativos de arranque. Sirven para separar preguntas reales de afirmaciones
# del AE que el prompt v3.2 guardo en verbatim_quote: en la primera corrida del pack
# aparecian cosas como "las implementaciones demoran entre 4 y 8 semanas" listadas
# bajo "como la preguntan", que es una respuesta, no una pregunta.
_INTERROGATIVOS = re.compile(
    r"\b(que|cual|cuales|como|cuando|cuanto|cuanta|cuantos|cuantas|donde|quien|"
    r"quienes|por que|para que|se puede|puedo|podemos|podrian|tienen|tiene|hay|"
    r"existe|existen|es posible|sirve|funciona|incluye|permite)\b"
)


def looks_like_question(text: str | None) -> bool:
    """Heuristica: el texto parece una pregunta y no una afirmacion.

    Signo de interrogacion, o un interrogativo en las primeras palabras. Los
    transcripts de Fathom no siempre puntuan, asi que el '?' solo no alcanza.
    """
    s = (text or "").strip()
    if not s:
        return False
    if "?" in s or "¿" in s:
        return True
    arranque = " ".join(normalize_for_match_words(s).split()[:4])
    return bool(_INTERROGATIVOS.search(arranque))


def normalize_for_match_words(text: str) -> str:
    """Minusculas sin acentos, para el matcheo de interrogativos."""
    s = text.lower()
    for a, b in (("á", "a"), ("é", "e"), ("í", "i"), ("ó", "o"), ("ú", "u"), ("ñ", "n")):
        s = s.replace(a, b)
    return s


def _pick_canonical(textos: list[str]) -> str:
    """La pregunta mas representativa del cluster: la de largo mediano.

    La mas corta suele estar truncada ("y el precio?") y la mas larga suele traer
    contexto de esa empresa en particular. La mediana es la mas reutilizable.
    """
    if not textos:
        return ""
    ordenados = sorted(set(textos), key=len)
    return ordenados[len(ordenados) // 2]
