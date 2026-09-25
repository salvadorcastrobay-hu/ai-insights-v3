import { createClient } from "@supabase/supabase-js";
import { classifyPosts } from "./lib/content/classify";
(async () => {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data } = await sb
    .from("content_posts")
    .select("post_id, platform, caption, hashtags, format, author_handle, likes_count, comments_count, outlier_factor")
    .not("viral_score", "is", null)
    .not("analysis", "is", null)
    .order("viral_score", { ascending: false })
    .limit(100);
  const posts = (data ?? []) as any[];
  console.log(`clasificando ${posts.length} posts con ${process.env.CONTENT_ANALYSIS_MODEL ?? "gpt-4o-mini"}…\n`);

  const out = await classifyPosts(posts.map((p) => ({
    post_id: p.post_id, caption: p.caption, hashtags: p.hashtags, format: p.format,
    author_label: p.author_handle, likes_count: p.likes_count, comments_count: p.comments_count,
  })));

  const res = [...out.values()] as any[];
  const conClaim = res.filter((r) => r.claim);
  const relevantes = res.filter((r) => r.is_relevant_to_hr);
  const relConClaim = relevantes.filter((r) => r.claim);
  console.log(`devueltos:            ${res.length} / ${posts.length}`);
  console.log(`con claim:            ${conClaim.length} (${Math.round(100*conClaim.length/res.length)}%)`);
  console.log(`relevantes:           ${relevantes.length}`);
  console.log(`  de esos con claim:  ${relConClaim.length} (${Math.round(100*relConClaim.length/Math.max(relevantes.length,1))}%)`);
  const objs = new Map<string, number>();
  for (const r of conClaim) if (r.claim_object) objs.set(r.claim_object, (objs.get(r.claim_object) ?? 0) + 1);
  console.log(`claim_object distintos: ${objs.size} sobre ${conClaim.length} claims`);
  console.log(`  repetidos: ${[...objs.entries()].filter(([,n])=>n>1).map(([k,n])=>`${k}(${n})`).slice(0,8).join(", ") || "ninguno"}`);
  console.log(`\nmuestra:`);
  for (const r of conClaim.slice(0, 6)) {
    console.log(`  · ${r.claim}`);
    console.log(`    contra: ${r.counterclaim ?? "—"}`);
    console.log(`    objeto: ${r.claim_object} · ${r.claim_stance} · ${r.transferable_mechanism}`);
  }
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
