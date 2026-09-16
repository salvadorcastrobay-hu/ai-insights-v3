/**
 * Cliente del motor (humand-insights-web).
 *
 * Solo se usa para DISPARAR trabajo: scraping, clasificación. El motor vive
 * allá porque necesita ffmpeg y Docker para transcribir video, y duplicarlo acá
 * sería mantener dos copias de lo mismo.
 *
 * Los resultados NO vuelven por acá: los jobs están persistidos en Postgres, así
 * que el estado se lee de Supabase (queries.loadLatestJob). Eso hace que un
 * redeploy del motor no rompa el seguimiento desde esta app.
 *
 * Solo se puede llamar desde el servidor: CONTENT_ENGINE_TOKEN nunca cruza al
 * cliente. La autorización del usuario la hace esta app contra su sesión de
 * Supabase antes de llegar acá; el token solo prueba que quien llama es un
 * servicio nuestro.
 */
import "server-only";

export type EngineRunKind = "discovery" | "analyze";

export type EngineRunInput = {
  kind: EngineRunKind;
  sourceIds?: string[];
  platform?: "instagram" | "linkedin";
  limit?: number;
  /** Email de quien disparó, para auditoría en content_refresh_jobs. */
  actingUser?: string | null;
};

function engineConfig(): { url: string; token: string } {
  const url = process.env.CONTENT_ENGINE_URL;
  const token = process.env.CONTENT_ENGINE_TOKEN;
  if (!url || !token) {
    throw new Error("Faltan CONTENT_ENGINE_URL o CONTENT_ENGINE_TOKEN.");
  }
  return { url: url.replace(/\/$/, ""), token };
}

async function call(path: string, init: RequestInit & { actingUser?: string | null } = {}) {
  const { url, token } = engineConfig();
  const { actingUser, ...rest } = init;

  const res = await fetch(`${url}${path}`, {
    ...rest,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(actingUser ? { "x-acting-user": actingUser } : {}),
      ...rest.headers,
    },
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    // El motor devuelve JSON; si vuelve HTML es casi seguro que el middleware
    // de allá interceptó la ruta y redirigió al login.
    const snippet = text.slice(0, 200);
    throw new Error(
      text.trimStart().startsWith("<")
        ? `El motor devolvió HTML (${res.status}): revisá que /api/internal esté en PUBLIC_PATHS.`
        : `Motor ${res.status}: ${snippet}`,
    );
  }
  return text ? JSON.parse(text) : {};
}

export async function engineHealth(): Promise<{
  ok: boolean;
  apify: boolean;
  openai: boolean;
  supabase: boolean;
}> {
  return call("/api/internal/content/health");
}

export async function startRun(input: EngineRunInput): Promise<unknown> {
  const { actingUser, ...body } = input;
  return call("/api/internal/content/runs", {
    method: "POST",
    body: JSON.stringify(body),
    actingUser,
  });
}
