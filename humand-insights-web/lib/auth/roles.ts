import type { Session, User } from "@supabase/supabase-js";

export const APP_ROLES = ["admin", "campaign_advisor", "viewer"] as const;
export type AppRole = (typeof APP_ROLES)[number];

const APP_ROLE_SET = new Set<AppRole>(APP_ROLES);
export const CAMPAIGN_ADVISOR_ROLES: readonly AppRole[] = ["admin", "campaign_advisor"];

function isAppRole(value: string): value is AppRole {
  return APP_ROLE_SET.has(value as AppRole);
}

export function getRolesFromMetadata(metadata: unknown): AppRole[] {
  if (!metadata || typeof metadata !== "object") {
    return [];
  }

  const roles = (metadata as { roles?: unknown }).roles;
  if (!Array.isArray(roles)) {
    return [];
  }

  return roles.filter((role): role is AppRole => typeof role === "string" && isAppRole(role));
}

export function getUserRoles(user: Pick<User, "app_metadata"> | null | undefined): AppRole[] {
  return getRolesFromMetadata(user?.app_metadata);
}

export function getSessionRoles(session: Pick<Session, "user"> | null | undefined): AppRole[] {
  return getUserRoles(session?.user);
}

export function hasRole(userRoles: readonly AppRole[], role: AppRole): boolean {
  return userRoles.includes(role);
}

export function hasAnyRole(userRoles: readonly AppRole[], requiredRoles: readonly AppRole[]): boolean {
  return requiredRoles.some((role) => userRoles.includes(role));
}

export function requireRole(userRoles: readonly AppRole[], requiredRoles: readonly AppRole[]): void {
  if (!hasAnyRole(userRoles, requiredRoles)) {
    throw new Error(`Missing required role. Expected one of: ${requiredRoles.join(", ")}`);
  }
}

export function canAccessCampaignAdvisor(userRoles: readonly AppRole[]): boolean {
  return hasAnyRole(userRoles, CAMPAIGN_ADVISOR_ROLES);
}

export function isAdmin(userRoles: readonly AppRole[]): boolean {
  return hasRole(userRoles, "admin");
}

/**
 * Gating de data textual sensible (verbatim_quote, gap_description) en UI
 * y CSV. El backend / AI chat siempre tienen acceso al data completo —
 * esta función solo controla qué cruza el RSC boundary al cliente.
 */
export function canSeeRawQuotes(userRoles: readonly AppRole[]): boolean {
  return isAdmin(userRoles);
}

export function formatRole(role: AppRole): string {
  switch (role) {
    case "admin":
      return "Admin";
    case "campaign_advisor":
      return "Campaign Advisor";
    case "viewer":
      return "Viewer";
    default:
      return role;
  }
}
