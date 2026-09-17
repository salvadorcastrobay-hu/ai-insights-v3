"use server";

import { revalidatePath } from "next/cache";

import { CONTENT_ROLES, getUserRoles, hasAnyRole } from "@/lib/auth/roles";
import { startRun } from "@/lib/content/engine";
import { setSourceApproval } from "@/lib/content/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * El chequeo de permisos vive acá y no solo en el middleware: una server action
 * es un endpoint, y se puede invocar sin pasar por la navegación.
 */
async function requireContentUser(): Promise<{ email: string | null }> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sesión vencida.");
  if (!hasAnyRole(getUserRoles(user), CONTENT_ROLES)) {
    throw new Error("No tenés permiso para esto.");
  }
  return { email: user.email ?? null };
}

export type ActionResult = { ok: boolean; message: string };

export async function approveSource(id: string, state: "approved" | "rejected"): Promise<ActionResult> {
  try {
    await requireContentUser();
    await setSourceApproval(id, state);
    revalidatePath("/sources");
    return { ok: true, message: state === "approved" ? "Fuente aprobada." : "Fuente descartada." };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function triggerDiscovery(sourceIds?: string[]): Promise<ActionResult> {
  try {
    const { email } = await requireContentUser();
    await startRun({ kind: "discovery", sourceIds, actingUser: email });
    revalidatePath("/sources");
    return {
      ok: true,
      message: "Actualización lanzada. Tarda unos minutos; el estado se ve arriba.",
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function triggerAnalysis(platform: "instagram" | "linkedin"): Promise<ActionResult> {
  try {
    const { email } = await requireContentUser();
    await startRun({ kind: "analyze", platform, limit: 100, actingUser: email });
    revalidatePath("/sources");
    return { ok: true, message: "Análisis lanzado sobre los posts mejor rankeados." };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
