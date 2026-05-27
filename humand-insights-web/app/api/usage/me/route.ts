import { createClient } from "@/lib/supabase/server";

export async function GET(): Promise<Response> {
  const base = process.env.PYTHON_SERVICE_URL;
  if (!base) {
    return new Response(JSON.stringify({ error: "PYTHON_SERVICE_URL not configured" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const upstream = `${base.replace(/\/$/, "")}/usage/me`;
  const res = await fetch(upstream, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "content-type": "application/json",
    },
    cache: "no-store",
  });

  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
