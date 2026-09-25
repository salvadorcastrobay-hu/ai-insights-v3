/**
 * Embeddings de los objetos sobre los que afirman los posts.
 *
 * Se embebe el OBJETO ("encuestas de clima"), nunca la afirmación completa. Dos
 * afirmaciones opuestas sobre lo mismo tienen coseno ~0,95, así que embeber
 * afirmaciones fusionaría los dos lados de cada debate — ver el comentario de
 * propositions.ts.
 *
 * Son pocas cadenas y cortas: sobre mil posts salen unos cientos de objetos
 * distintos, así que una sola llamada alcanza y cuesta fracciones de centavo.
 */
import { createHash } from "crypto";

const MODEL = "text-embedding-3-small";
const ENDPOINT = "https://api.openai.com/v1/embeddings";

/** La API acepta lotes grandes; este tope es por prudencia, no por límite. */
const BATCH = 256;

export type EmbeddingMap = Map<string, number[]>;

/**
 * Cache en proceso. La síntesis corre sobre los mismos objetos cada semana y no
 * tiene sentido pagarlos de nuevo dentro de la misma corrida.
 */
const cache = new Map<string, number[]>();

function key(text: string): string {
  return createHash("sha1").update(`${MODEL}:${text}`).digest("hex");
}

export async function embedTexts(texts: string[]): Promise<EmbeddingMap> {
  const out: EmbeddingMap = new Map();
  const apiKey = process.env.OPENAI_API_KEY;
  // Sin API key se devuelve vacío y el agrupamiento cae a coincidencia exacta,
  // que ya resuelve buena parte. Degradar es mejor que tirar la corrida.
  if (!apiKey) return out;

  const unique = [...new Set(texts.map((t) => t.trim()).filter(Boolean))];
  const pending: string[] = [];
  for (const text of unique) {
    const cached = cache.get(key(text));
    if (cached) out.set(text, cached);
    else pending.push(text);
  }
  if (!pending.length) return out;

  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: MODEL, input: batch }),
    });
    if (!res.ok) {
      console.warn(`[embeddings] ${res.status}: se agrupa solo por texto exacto`);
      return out;
    }
    const json = (await res.json()) as { data: Array<{ index: number; embedding: number[] }> };
    for (const item of json.data) {
      const text = batch[item.index];
      cache.set(key(text), item.embedding);
      out.set(text, item.embedding);
    }
  }
  return out;
}
