import { NextResponse } from "next/server";

import { loadInsights } from "@/lib/supabase/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Must fit the worst-case cold scan (~95s full table pagination).
export const maxDuration = 300;

/**
 * Fire-and-forget endpoint to warm the insights unstable_cache.
 * Called by the login page so the big fetch runs in parallel with the
 * user entering credentials, avoiding a long wait on first dashboard hit.
 */
export async function GET() {
  try {
    const rows = await loadInsights(process.env.NEXT_PUBLIC_PROMPT_VERSION ?? "v3.1");
    return NextResponse.json({ ok: true, rows: rows.length });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
