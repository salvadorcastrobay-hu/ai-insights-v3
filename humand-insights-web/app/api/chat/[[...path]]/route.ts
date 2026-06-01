import { getAuthenticatedSession } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

const UPSTREAM_BASE = "/sql-chat";

async function resolveUpstream(context: RouteContext): Promise<string> {
  const base = process.env.PYTHON_SERVICE_URL;
  if (!base) throw new Error("PYTHON_SERVICE_URL is not configured");
  const { path } = await context.params;
  const segments = path?.length ? `/${path.join("/")}` : "/query";
  return `${base.replace(/\/$/, "")}${UPSTREAM_BASE}${segments}`;
}

async function getSessionOrUnauthorized() {
  const session = await getAuthenticatedSession();
  if (!session) return { session: null, response: new Response("Unauthorized", { status: 401 }) };
  return { session, response: null };
}

async function passthrough(
  req: Request,
  context: RouteContext,
  method: "GET" | "POST" | "PATCH" | "DELETE",
): Promise<Response> {
  const { session, response } = await getSessionOrUnauthorized();
  if (response) return response;

  const upstream = await resolveUpstream(context);
  const hasBody = method === "POST" || method === "PATCH";
  const bodyText = hasBody ? await req.text() : undefined;

  const target =
    method === "GET" ? upstream + (new URL(req.url).search ?? "") : upstream;

  const upstreamResponse = await fetch(target, {
    method,
    headers: {
      Authorization: `Bearer ${session!.access_token}`,
      Accept: "application/json",
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
    },
    body: bodyText,
    cache: "no-store",
  });

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: {
      "Content-Type": upstreamResponse.headers.get("content-type") ?? "application/json",
    },
  });
}

export const GET = (req: Request, context: RouteContext) => passthrough(req, context, "GET");
export const POST = (req: Request, context: RouteContext) => passthrough(req, context, "POST");
export const PATCH = (req: Request, context: RouteContext) => passthrough(req, context, "PATCH");
export const DELETE = (req: Request, context: RouteContext) => passthrough(req, context, "DELETE");
