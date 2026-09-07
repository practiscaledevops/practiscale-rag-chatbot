// Admin user management — shared types, reference data, validation schemas, and
// the service-role helpers/payload builder for the admin users surface.
//
// This lives in lib/ (not the route file) so the route handlers
// (/api/admin/users and /api/admin/users/[id]) and the server page can all reuse
// the same building blocks without a Next.js route re-exporting non-handler
// symbols. Every helper here does its cross-user reads/writes through the
// SERVICE-ROLE client (bypasses RLS); callers must gate with requireChatbotAdmin
// first (see lib/admin.ts).

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  requireChatbotAdmin,
  AdminError,
  type ChatbotAdmin,
  type ProfileRole,
} from "@/lib/admin";
import { createSupabaseServiceClient } from "@/lib/supabase-server";
import { fetchBrainModels } from "@/lib/models";

// ---------------------------------------------------------------------------
// Types (shared with the route handlers and page.tsx)
// ---------------------------------------------------------------------------

/** Per-user access map — mirrors the profiles.permissions jsonb shape. */
export interface PermissionsShape {
  /** allowlist of model-id globs/exact ids (empty/absent = no restriction) */
  models?: string[];
  /** enabled feature keys, e.g. ["rag","projects","attachments","connectors"] */
  features?: string[];
  /** subset of the tiers the user may select (empty/absent = all tiers) */
  allowed_tiers?: Array<"fast" | "recommended" | "max">;
}

/** Best-effort usage roll-up for a single user. */
export interface AdminUserUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  lastUsedAt: string | null;
}

/** One row in the admin users table. */
export interface AdminUser {
  id: string;
  email: string | null;
  displayName: string | null;
  role: ProfileRole;
  isActive: boolean;
  team: { id: string; name: string } | null;
  permissions: PermissionsShape;
  canUseAllModels: boolean;
  usage: AdminUserUsage | null;
  createdAt: string | null;
  lastSignInAt: string | null;
}

/** A selectable model, trimmed to what the permissions editor renders. */
export interface AdminModelOption {
  id: string;
  provider: string;
  label: string;
  tier?: string;
}

/** A togglable product feature the editor exposes. */
export interface AdminFeature {
  key: string;
  label: string;
  description: string;
}

/** Everything the admin users page needs in one payload. */
export interface AdminUsersPayload {
  users: AdminUser[];
  teams: { id: string; name: string }[];
  models: AdminModelOption[];
  features: AdminFeature[];
  tiers: Array<"fast" | "recommended" | "max">;
  /** the signed-in admin — used to gate super_admin controls and self-guards */
  currentUserId: string;
  currentUserRole: ProfileRole;
  /** true when the usage roll-up hit its scan cap (totals are a lower bound) */
  usagePartial: boolean;
}

// ---------------------------------------------------------------------------
// Reference data (single source of truth for both routes + the client)
// ---------------------------------------------------------------------------

/** The tiers the switcher supports (mirrors lib/brain.ts ModelTier). */
export const TIERS: Array<"fast" | "recommended" | "max"> = [
  "fast",
  "recommended",
  "max",
];

/** Product features that can be granted per-user via profiles.permissions. */
export const KNOWN_FEATURES: AdminFeature[] = [
  { key: "rag", label: "Knowledge (RAG)", description: "Grounded answers with citations from the Brain." },
  { key: "projects", label: "Projects", description: "Group chats and scope them with project context." },
  { key: "attachments", label: "Attachments", description: "Upload files to include in a conversation." },
  { key: "connectors", label: "Connectors", description: "Use MCP and third-party integrations the Brain exposes." },
];

// A high, defensive cap on the usage scan — this is an admin summary, not
// billing. If the fleet has more events than this we surface totals as a lower
// bound (usagePartial) rather than scanning unbounded rows on every page load.
const USAGE_EVENT_CAP = 50_000;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Per-user permissions object accepted on create/update. */
export const permissionsSchema = z
  .object({
    models: z.array(z.string().trim().min(1).max(120)).max(200).optional(),
    features: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
    allowed_tiers: z.array(z.enum(["fast", "recommended", "max"])).max(3).optional(),
  })
  .strict();

/** App-wide role. */
export const roleSchema = z.enum(["user", "admin", "super_admin"]);

// ---------------------------------------------------------------------------
// Shared server helpers
// ---------------------------------------------------------------------------

/**
 * Gate the request to an admin, mapping AdminError to a JSON response. Every
 * handler in this folder starts with this. Returns `{ admin }` on success or
 * `{ error }` (a ready-to-return NextResponse) on failure.
 */
export async function resolveAdmin(): Promise<
  { admin: ChatbotAdmin } | { error: NextResponse }
> {
  try {
    const admin = await requireChatbotAdmin();
    return { admin };
  } catch (e) {
    if (e instanceof AdminError) {
      return { error: NextResponse.json({ error: e.message }, { status: e.status }) };
    }
    return { error: NextResponse.json({ error: "Server error" }, { status: 500 }) };
  }
}

/** The GoTrue admin API, or null when it isn't available (e.g. demo mode). */
export function getAuthAdmin(service: SupabaseClient) {
  const admin = service.auth?.admin;
  if (!admin || typeof admin.createUser !== "function") return null;
  return admin;
}

/** Coerce the profiles.permissions jsonb into a clean, typed shape. */
export function normalizePermissions(raw: unknown): PermissionsShape {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: PermissionsShape = {};
  if (Array.isArray(r.models)) {
    out.models = r.models.filter((x): x is string => typeof x === "string");
  }
  if (Array.isArray(r.features)) {
    out.features = r.features.filter((x): x is string => typeof x === "string");
  }
  if (Array.isArray(r.allowed_tiers)) {
    out.allowed_tiers = r.allowed_tiers.filter(
      (x): x is "fast" | "recommended" | "max" =>
        x === "fast" || x === "recommended" || x === "max"
    );
  }
  return out;
}

/**
 * Keep team_members (the roster source of truth) in sync with a user's PRIMARY
 * team (profiles.team_id). We model one primary team per user in this admin UI:
 * moving to a new team removes the old primary membership and adds the new one.
 * Clearing the team (newTeamId=null) removes the old primary membership only.
 * Best-effort — a membership hiccup never blocks the profile write.
 */
export async function syncPrimaryTeam(
  service: SupabaseClient,
  userId: string,
  oldTeamId: string | null,
  newTeamId: string | null
): Promise<void> {
  if (oldTeamId && oldTeamId !== newTeamId) {
    await service
      .from("team_members")
      .delete()
      .eq("team_id", oldTeamId)
      .eq("user_id", userId);
  }
  if (newTeamId) {
    await service
      .from("team_members")
      .upsert(
        { team_id: newTeamId, user_id: userId, role: "member" },
        { onConflict: "team_id,user_id" }
      );
  }
}

/**
 * Count ACTIVE super_admins other than `exceptId`. Used to refuse the last-one
 * demotion/deactivation/deletion so an install can never lock itself out of the
 * super_admin role.
 */
export async function countOtherActiveSuperAdmins(
  service: SupabaseClient,
  exceptId: string
): Promise<number> {
  const { data } = await service
    .from("profiles")
    .select("id")
    .eq("role", "super_admin")
    .eq("is_active", true)
    .neq("id", exceptId);
  return (data ?? []).length;
}

/** id -> authoritative email + auth timestamps, read via the GoTrue admin API. */
async function loadAuthInfo(
  service: SupabaseClient
): Promise<Map<string, { email: string | null; createdAt: string | null; lastSignInAt: string | null }>> {
  const map = new Map<
    string,
    { email: string | null; createdAt: string | null; lastSignInAt: string | null }
  >();
  const admin = service.auth?.admin;
  if (!admin || typeof admin.listUsers !== "function") return map;

  const perPage = 200;
  // Page through the auth user list; cap the pages so a huge tenant can't stall
  // the admin page (25 * 200 = 5,000 users). Beyond that, email falls back to
  // the profiles.email backfill.
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await admin.listUsers({ page, perPage });
    if (error) break;
    const list = data?.users ?? [];
    for (const u of list) {
      map.set(u.id, {
        email: u.email ?? null,
        createdAt: u.created_at ?? null,
        lastSignInAt: u.last_sign_in_at ?? null,
      });
    }
    if (list.length < perPage) break;
  }
  return map;
}

/**
 * Best-effort per-user usage roll-up. Aggregates usage_events in memory (there
 * is no server-side aggregate RPC here); ordered newest-first and capped so the
 * scan is bounded. If the cap is hit, totals are a lower bound and `partial` is
 * true. lastUsedAt is exact for every included user.
 */
async function loadUsageSummary(
  service: SupabaseClient
): Promise<{ summary: Map<string, AdminUserUsage>; partial: boolean }> {
  const summary = new Map<string, AdminUserUsage>();
  const { data, error } = await service
    .from("usage_events")
    .select("user_id, input_tokens, output_tokens, cost_usd, created_at")
    .order("created_at", { ascending: false })
    .limit(USAGE_EVENT_CAP);

  if (error) return { summary, partial: false }; // usage is a nice-to-have
  const rows = (data ?? []) as Array<{
    user_id: string;
    input_tokens: number | null;
    output_tokens: number | null;
    cost_usd: number | string | null;
    created_at: string | null;
  }>;

  for (const r of rows) {
    if (!r.user_id) continue;
    const cur =
      summary.get(r.user_id) ??
      { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, lastUsedAt: null as string | null };
    cur.inputTokens += r.input_tokens ?? 0;
    cur.outputTokens += r.output_tokens ?? 0;
    cur.totalTokens = cur.inputTokens + cur.outputTokens;
    cur.costUsd += Number(r.cost_usd ?? 0);
    if (r.created_at && (!cur.lastUsedAt || r.created_at > cur.lastUsedAt)) {
      cur.lastUsedAt = r.created_at;
    }
    summary.set(r.user_id, cur);
  }
  return { summary, partial: rows.length >= USAGE_EVENT_CAP };
}

/**
 * Assemble the full admin users payload. Called by the GET handler and by the
 * server page (page.tsx) for a fast first paint. The caller must have already
 * passed requireChatbotAdmin() — `admin` supplies the current-user context and
 * proves the gate ran.
 */
export async function buildAdminUsersPayload(
  admin: ChatbotAdmin
): Promise<AdminUsersPayload> {
  const service = createSupabaseServiceClient();

  // Profiles are the app's user table (one row per auth user, auto-provisioned).
  const { data: profileRows, error: pErr } = await service
    .from("profiles")
    .select(
      "id, email, display_name, role, is_active, team_id, permissions, can_use_all_models, created_at"
    );
  if (pErr) throw new Error(pErr.message);

  // Reference data + enrichment, in parallel.
  const [teamRes, authInfo, usage, catalog] = await Promise.all([
    service.from("teams").select("id, name").order("name", { ascending: true }),
    loadAuthInfo(service),
    loadUsageSummary(service),
    fetchBrainModels(),
  ]);

  const teams = ((teamRes.data ?? []) as Array<{ id: string; name: string }>).map((t) => ({
    id: t.id,
    name: t.name ?? "",
  }));
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const models: AdminModelOption[] = catalog.map((m) => ({
    id: m.id,
    provider: m.provider,
    label: m.label,
    tier: m.tier,
  }));

  const rows = (profileRows ?? []) as Array<Record<string, unknown>>;
  const users: AdminUser[] = rows.map((p) => {
    const id = String(p.id);
    const info = authInfo.get(id);
    const teamId = (p.team_id as string | null) ?? null;
    return {
      id,
      email: info?.email ?? ((p.email as string | null) ?? null),
      displayName: (p.display_name as string | null) ?? null,
      role: ((p.role as ProfileRole) ?? "user"),
      isActive: p.is_active !== false,
      team: teamId ? teamById.get(teamId) ?? null : null,
      permissions: normalizePermissions(p.permissions),
      canUseAllModels: Boolean(p.can_use_all_models),
      usage: usage.summary.get(id) ?? null,
      createdAt: info?.createdAt ?? ((p.created_at as string | null) ?? null),
      lastSignInAt: info?.lastSignInAt ?? null,
    };
  });

  // Stable, friendly ordering: active first, then by email.
  users.sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return (a.email ?? "").localeCompare(b.email ?? "");
  });

  return {
    users,
    teams,
    models,
    features: KNOWN_FEATURES,
    tiers: TIERS,
    currentUserId: admin.userId,
    currentUserRole: admin.role,
    usagePartial: usage.partial,
  };
}
