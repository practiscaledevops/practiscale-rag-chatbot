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

import type { User } from "@supabase/supabase-js";
import { getUser } from "@/lib/auth";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase-server";
import type { UserPermissions } from "@/lib/models";
import { effectiveCapabilities, peekCapabilityManifest } from "@/lib/capabilities";

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
  /** per-user model/feature access (profiles.permissions jsonb, as stored) */
  permissions: UserPermissions;
  /**
   * The capability ids this user holds RIGHT NOW (Brain manifest + this app's
   * own), resolved from role + stored grants — the set to gate on. Pass it via
   * accessFromProfile(profile) (lib/access) to the gating helpers.
   */
  capabilities: string[];
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
 * A DEACTIVATED account (is_active === false) resolves to `null`, exactly like
 * a signed-out caller — so every route that gates on this helper answers 401
 * and the app layout bounces the user to /login the moment an admin flips the
 * switch, without each caller having to remember the flag.
 *
 * @param user  an already-resolved session user (e.g. from the layout's
 *              getUser call) to skip the verification round-trip; `undefined`
 *              resolves it here, `null` short-circuits to null.
 * @returns {SessionProfile | null} the profile, or null when unauthenticated
 *          or deactivated.
 */
export async function getSessionProfile(
  user?: User | null
): Promise<SessionProfile | null> {
  if (user === undefined) user = await getUser();
  if (!user) return null;

  const supabase = await createSupabaseServerClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, display_name, role, is_active, permissions, can_use_all_models, team_id")
    .eq("id", user.id)
    .maybeSingle();

  // Deactivated → treated as signed out everywhere (see the doc comment).
  if (profile?.is_active === false) return null;

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

  const role = (profile?.role as ProfileRole) ?? "user";
  const permissions = (profile?.permissions as UserPermissions) ?? {};
  return {
    userId: user.id,
    email: (profile?.email as string | null) ?? user.email ?? null,
    displayName: (profile?.display_name as string | null) ?? null,
    role,
    isActive: profile?.is_active !== false,
    permissions,
    // Resolved against the cached manifest (never waits on the Brain; a cold
    // cache uses the built-in list and refreshes in the background).
    capabilities: effectiveCapabilities({ role, permissions }, peekCapabilityManifest()),
    canUseAllModels: Boolean(profile?.can_use_all_models),
    team,
  };
}
