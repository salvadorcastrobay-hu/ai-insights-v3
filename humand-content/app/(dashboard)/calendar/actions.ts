"use server";

import { revalidatePath } from "next/cache";

import { CONTENT_ROLES, getUserRoles, hasAnyRole } from "@/lib/auth/roles";
import { setFeedback } from "@/lib/content/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { FeedbackState } from "@/lib/content/types";

async function requireContentUser(): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sesión vencida.");
  if (!hasAnyRole(getUserRoles(user), CONTENT_ROLES)) {
    throw new Error("No tenés permiso para esto.");
  }
  return user.email ?? null;
}

export type FeedbackResult = { ok: boolean; message: string };

/**
 * Registra qué pasó con una pieza sugerida.
 *
 * Es lo que alimenta la métrica principal del brief. El `editNote` importa
 * tanto como el estado: saber que algo se editó no dice nada, saber QUÉ se
 * editó es lo que permite mejorar el generador.
 */
export async function decideSuggestion(
  entryKey: string,
  state: FeedbackState,
  editNote?: string,
): Promise<FeedbackResult> {
  try {
    const email = await requireContentUser();
    await setFeedback(entryKey, state, email, editNote?.trim() || null);
    revalidatePath("/calendar");
    revalidatePath("/metrics");
    return { ok: true, message: "Registrado." };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
