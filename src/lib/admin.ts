// Server-only: admin gating + session-profile resolution for the chatbot.
//
// The HARD RULE (see CLAUDE.md / project brief): a user's identity is resolved
// server-side from the Supabase session (getUser), and their app-wide role is
// read from profiles via the SERVICE-ROLE client — NEVER trusted from a client
// claim. This module is the single choke point every admin surface routes
// through.
//
// Do not import this from a client component: it depends on next/headers (via
// getUser) and the service-role client (SUPABASE_SERVICE_ROLE_KEY).

import { getUser } from "@/lib/auth";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase-server";
import type { UserPermissions } from "@/lib/models";

/** App-wide privilege level (profiles.role). */
export type ProfileRole = "user" | "admin" | "super_admin";

/** Thrown by requireChatbotAdmin when the caller is not an authorized admin. */
export class AdminError extends Error {
  /** 401 when unauthenticated, 403 when authenticated but not an admin. */
  readonly status: 401 | 403;
  constructor(status: 401 | 403, message?: string) {
    super(message ?? (status === 401 ? "Unauthorized" : "Forbidden"));
    this.name = "AdminError";
    this.status = status;
  }
}

/** Result of a successful admin check. */
export interface ChatbotAdmin {
  userId: string;
  email: string | null;
  role: ProfileRole;
  isSuperAdmin: boolean;
}

/**
 * Gate a server route/action to admins. Resolves the current user from the
 * session (getUser), then reads their role/is_active from profiles via the
 * SERVICE-ROLE client (bypasses RLS; the role is authoritative, never a client
 * claim).
 *
 * @returns {ChatbotAdmin} when the user is an active 'admin' or 'super_admin'.
 * @throws  {AdminError}   401 if unauthenticated, 403 if not an active admin.
 */
export async function requireChatbotAdmin(): Promise<ChatbotAdmin> {
  const user = await getUser();
  if (!user) throw new AdminError(401);

  // Service-role read: authoritative role, independent of the caller's RLS.
  const service = createSupabaseServiceClient();
  const { data: profile, error } = await service
    .from("profiles")
    .select("id, email, role, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw new AdminError(403, "Could not resolve profile");
  if (!profile) throw new AdminError(403, "No profile");
  if (profile.is_active === false) throw new AdminError(403, "Account is inactive");

  const role = (profile.role as ProfileRole) ?? "user";
  if (role !== "admin" && role !== "super_admin") throw new AdminError(403);

  return {
    userId: user.id,
    email: (profile.email as string | null) ?? user.email ?? null,
    role,
    isSuperAdmin: role === "super_admin",
  };
}

/** The current user's profile, shaped for gating UI. `null` if unauthenticated. */
export interface SessionProfile {
  userId: string;
  email: string | null;
  displayName: string | null;
  role: ProfileRole;
  isActive: boolean;
  /** per-user model/feature access (profiles.permissions jsonb) */
  permissions: UserPermissions;
  /** overrides permissions.models when true */
  canUseAllModels: boolean;
  /** the user's primary team, if any */
  team: { id: string; name: string } | null;
}

/**
 * Load the current user's profile for UI gating (which nav/features/models to
 * show). Reads through the AUTH-AWARE (RLS) client — a user may read only their
 * OWN profile/team, which is exactly what this returns. This is convenience
 * state for rendering; it is NOT an authorization boundary. Enforce real access
 * server-side (requireChatbotAdmin for admin, RLS for data).
 *
 * @returns {SessionProfile | null} the profile, or null when unauthenticated.
 */
export async function getSessionProfile(): Promise<SessionProfile | null> {
  const user = await getUser();
  if (!user) return null;

  const supabase = await createSupabaseServerClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, display_name, role, is_active, permissions, can_use_all_models, team_id")
    .eq("id", user.id)
    .maybeSingle();

  // Resolve the primary team's name (RLS lets a member read their team).
  let team: { id: string; name: string } | null = null;
  const teamId = profile?.team_id as string | null | undefined;
  if (teamId) {
    const { data: t } = await supabase
      .from("teams")
      .select("id, name")
      .eq("id", teamId)
      .maybeSingle();
    if (t) team = { id: t.id as string, name: (t.name as string) ?? "" };
  }

  return {
    userId: user.id,
    email: (profile?.email as string | null) ?? user.email ?? null,
    displayName: (profile?.display_name as string | null) ?? null,
    role: (profile?.role as ProfileRole) ?? "user",
    isActive: profile?.is_active !== false,
    permissions: (profile?.permissions as UserPermissions) ?? {},
    canUseAllModels: Boolean(profile?.can_use_all_models),
    team,
  };
}
