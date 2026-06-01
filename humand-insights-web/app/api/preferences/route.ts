import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data, error } = await supabase
    .from("user_preferences")
    .select("filter_prefs")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ filter_prefs: data?.filter_prefs ?? {} });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await req.json();
  const { error } = await supabase
    .from("user_preferences")
    .upsert({
      user_id: user.id,
      filter_prefs: body.filter_prefs ?? {},
      updated_at: new Date().toISOString(),
    });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
