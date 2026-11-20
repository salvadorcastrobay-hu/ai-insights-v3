import { NextResponse } from "next/server";

import { answer, type ChatTurn } from "@/lib/content/chat";

// El middleware ya exige sesión con rol de Content para todo, /api incluido.
export const dynamic = "force-dynamic";
export const maxDuration = 120; // gpt-5.5 tarda 15–40 s, más una corrección si hace falta

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { messages?: ChatTurn[] } | null;
  const messages = (body?.messages ?? []).filter(
    (m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim(),
  );
  if (!messages.length || messages.at(-1)?.role !== "user") {
    return NextResponse.json({ error: "Falta la pregunta." }, { status: 400 });
  }
  try {
    const result = await answer(messages);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[chat]", err);
    return NextResponse.json({ error: "No pude responder ahora. Probá de nuevo en un rato." }, { status: 500 });
  }
}
