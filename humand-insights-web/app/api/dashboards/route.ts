import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) return new Response("Unauthorized", { status: 401 });

  const owner = session.user.email;
  const { data, error } = await supabase
    .from("custom_dashboards")
    .select("*")
    .or(`owner.eq.${owner},is_shared.eq.true`)
    .order("updated_at", { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ dashboards: data ?? [] });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) return new Response("Unauthorized", { status: 401 });

  const body = await req.json();
  const owner = session.user.email;

  const { data, error } = await supabase
    .from("custom_dashboards")
    .insert({
      owner,
      name: body.name,
      config: body.config,
      is_shared: Boolean(body.is_shared),
    })
    .select("*")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ dashboard: data });
}

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) return new Response("Unauthorized", { status: 401 });

  const body = await req.json();
  const { data, error } = await supabase
    .from("custom_dashboards")
    .update({
      name: body.name,
      config: body.config,
      is_shared: body.is_shared,
      updated_at: new Date().toISOString(),
    })
    .eq("id", body.id)
    .select("*")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ dashboard: data });
}

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = (await req.json()) as { id?: string };
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const { error } = await supabase
    .from("custom_dashboards")
    .delete()
    .eq("id", id);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
