// /api/admin/settings — workspace settings (the chatbot's OWN Supabase project).
//
// Reads and writes the single-row public.app_settings table (see
// supabase/setup/settings.sql). This is APP-WIDE configuration, not user data:
//   • disabledModels    — a DENYLIST of concrete model ids turned OFF workspace-
//                          wide (empty ⇒ every Brain-catalog model is enabled;
//                          models the Brain adds later are enabled by default).
//   • defaultModel/Kind — the default selection for a NEW chat: a tier alias
//                          ("fast"|"recommended"|"max") or a concrete model id,
//                          forwarded verbatim as the Brain `model` field.
//   • ragDefaultOn      — whether RAG grounding is ON by default for new chats.
//   • pricingOverrides  — optional per-model $/1M in+out overrides the cost calc
//                          can read (fall back to lib/pricing.ts when absent).
//
// SECURITY / HARD RULE: every request is gated by requireChatbotAdmin() — the
// caller is resolved server-side and their role is read from profiles via the
// SERVICE-ROLE client, never trusted from a client claim (see lib/admin.ts).
// Both `admin` and `super_admin` may save. The row itself is service-role only
// (RLS forced, no user policies), so reads/writes use the service-role client.
//
// The pure settings shape + DEFAULT_SETTINGS + mergeSettings are exported so
// server-side consumers (the chat pipeline / server components / the settings
// page) can reuse the exact same defaults and merge semantics.

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
import { fetchBrainModels, type BrainModel } from "@/lib/models";

export const runtime = "nodejs";
// Reads the session cookie (for gating) and always reflects live settings.
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Settings shape (pure — safe to `import type` from a client component)
// ---------------------------------------------------------------------------

/** How to interpret {@link WorkspaceSettings.defaultModel}. */
export type DefaultModelKind = "tier" | "model";

/** The tiers the Brain accepts as a `model` alias (mirrors lib/brain.ts). */
export const TIERS = ["fast", "recommended", "max"] as const;
export type Tier = (typeof TIERS)[number];

/** Optional per-model price override, USD per 1,000,000 tokens. */
export interface PricingOverride {
  /** input / prompt tokens, USD per 1M — null ⇒ fall back to lib/pricing.ts */
  inputPerMTok: number | null;
  /** output / completion tokens, USD per 1M — null ⇒ fall back to lib/pricing.ts */
  outputPerMTok: number | null;
}

/** Workspace-wide settings persisted as app_settings.data (jsonb). */
export interface WorkspaceSettings {
  /**
   * DENYLIST of concrete model ids disabled workspace-wide. A model is enabled
   * iff its id is NOT in this list, so an empty list enables the whole catalog
   * and new Brain models default to enabled. A disabled model must never be
   * selectable by anyone (this gate is broader than per-user permissions).
   */
  disabledModels: string[];
  /** default selection for a new chat: a tier alias OR a concrete model id */
  defaultModel: string;
  /** whether `defaultModel` is a tier preset or a concrete model id */
  defaultModelKind: DefaultModelKind;
  /** whether RAG grounding is ON by default for new chats */
  ragDefaultOn: boolean;
  /** optional per-model price overrides, keyed by concrete model id */
  pricingOverrides: Record<string, PricingOverride>;
}

/** Code-side defaults — the source of truth when a jsonb key is absent. */
export const DEFAULT_SETTINGS: WorkspaceSettings = {
  disabledModels: [],
  defaultModel: "recommended",
  defaultModelKind: "tier",
  ragDefaultOn: true,
  pricingOverrides: {},
};

// ---------------------------------------------------------------------------
// Reference data for the editor (tier presets)
// ---------------------------------------------------------------------------

/** A tier preset the default-model picker renders. */
export interface TierPreset {
  value: Tier;
  label: string;
  hint: string;
}

export const TIER_PRESETS: ReadonlyArray<TierPreset> = [
  { value: "fast", label: "Fast", hint: "Lowest latency — quick, everyday answers." },
  { value: "recommended", label: "Recommended", hint: "Balanced quality and speed for most work." },
  { value: "max", label: "Max", hint: "Highest quality for hard, high-stakes tasks." },
];

/** A catalog model, trimmed to what the settings editor renders. */
export interface SettingsModelOption {
  id: string;
  provider: string;
  label: string;
  tier?: string;
  available: boolean;
  reason?: string;
}

/** Everything the settings page needs in one payload. */
export interface SettingsPayload {
  settings: WorkspaceSettings;
  /** the Brain catalog, so the UI can render the enable list + pricing rows */
  models: SettingsModelOption[];
  /** tier presets for the default-model picker */
  tiers: TierPreset[];
  /** when the settings row was last saved (null before the first save) */
  updatedAt: string | null;
  /** the signed-in admin's role (both admin + super_admin may save) */
  currentUserRole: ProfileRole;
}

// ---------------------------------------------------------------------------
// Defensive merge / normalize (jsonb from the DB is untrusted-shaped)
// ---------------------------------------------------------------------------

/** Coerce to a finite, non-negative number rounded to 6dp, or null. */
function toRate(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1e6) / 1e6;
}

/** Clean a raw pricing-overrides map: keep only entries with a real override. */
function normalizeOverrides(raw: unknown): Record<string, PricingOverride> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, PricingOverride> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = key.trim();
    if (!id || id.length > 200 || !value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const input = toRate(v.inputPerMTok);
    const output = toRate(v.outputPerMTok);
    // Drop no-op entries (both null) so the store never accumulates dead keys.
    if (input == null && output == null) continue;
    out[id] = { inputPerMTok: input, outputPerMTok: output };
  }
  return out;
}

/** Unique, trimmed, non-empty strings — bounded so a bad blob can't bloat state. */
function normalizeIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const item of raw) {
    const s = typeof item === "string" ? item.trim() : "";
    if (s && s.length <= 200) seen.add(s);
    if (seen.size >= 500) break;
  }
  return [...seen];
}

/**
 * Merge a raw jsonb blob over DEFAULT_SETTINGS into a fully-formed
 * WorkspaceSettings. Reads every field defensively so a partial or malformed
 * row can never throw or leak an unexpected shape.
 */
export function mergeSettings(raw: unknown): WorkspaceSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const kind: DefaultModelKind =
    r.defaultModelKind === "model" || r.defaultModelKind === "tier"
      ? r.defaultModelKind
      : DEFAULT_SETTINGS.defaultModelKind;

  let defaultModel =
    typeof r.defaultModel === "string" && r.defaultModel.trim()
      ? r.defaultModel.trim()
      : DEFAULT_SETTINGS.defaultModel;

  // Keep kind and value coherent: a "tier" default must name a real tier.
  const resolvedKind: DefaultModelKind =
    kind === "tier" && !TIERS.includes(defaultModel as Tier) ? "model" : kind;
  if (resolvedKind === "tier" && !TIERS.includes(defaultModel as Tier)) {
    defaultModel = DEFAULT_SETTINGS.defaultModel;
  }

  return {
    disabledModels: normalizeIdList(r.disabledModels),
    defaultModel,
    defaultModelKind: resolvedKind,
    ragDefaultOn:
      typeof r.ragDefaultOn === "boolean"
        ? r.ragDefaultOn
        : DEFAULT_SETTINGS.ragDefaultOn,
    pricingOverrides: normalizeOverrides(r.pricingOverrides),
  };
}

// ---------------------------------------------------------------------------
// Service-role load
// ---------------------------------------------------------------------------

/**
 * Read the single settings row via the SERVICE-ROLE client and return the merged
 * WorkspaceSettings plus the row's updated_at. Never throws: a missing row or a
 * read error resolves to DEFAULT_SETTINGS so callers always get a usable value.
 *
 * Server-only (touches the service-role client). Exported so the chat pipeline /
 * server components can resolve the same workspace defaults the admin panel writes.
 */
export async function loadWorkspaceSettings(
  service?: SupabaseClient
): Promise<{ settings: WorkspaceSettings; updatedAt: string | null }> {
  try {
    const db = service ?? createSupabaseServiceClient();
    const { data, error } = await db
      .from("app_settings")
      .select("data, updated_at")
      .eq("id", 1)
      .maybeSingle();
    if (error || !data) return { settings: { ...DEFAULT_SETTINGS }, updatedAt: null };
    return {
      settings: mergeSettings((data as { data?: unknown }).data),
      updatedAt: ((data as { updated_at?: string | null }).updated_at) ?? null,
    };
  } catch {
    return { settings: { ...DEFAULT_SETTINGS }, updatedAt: null };
  }
}

/** Map the Brain catalog to the trimmed option shape the editor renders. */
function toModelOptions(catalog: BrainModel[]): SettingsModelOption[] {
  return catalog
    .map((m) => ({
      id: m.id,
      provider: m.provider,
      label: m.label,
      tier: m.tier,
      available: m.available,
      reason: m.reason,
    }))
    .sort((a, b) => a.provider.localeCompare(b.provider) || a.label.localeCompare(b.label));
}

/**
 * Assemble the full settings payload (settings + catalog + tier presets). The
 * caller must have already passed requireChatbotAdmin(); `admin` supplies the
 * current role and proves the gate ran.
 */
export async function buildSettingsPayload(
  admin: ChatbotAdmin
): Promise<SettingsPayload> {
  const service = createSupabaseServiceClient();
  const [{ settings, updatedAt }, catalog] = await Promise.all([
    loadWorkspaceSettings(service),
    fetchBrainModels(),
  ]);

  return {
    settings,
    models: toModelOptions(catalog),
    tiers: [...TIER_PRESETS],
    updatedAt,
    currentUserRole: admin.role,
  };
}

// ---------------------------------------------------------------------------
// Admin gate helper (maps AdminError → JSON response)
// ---------------------------------------------------------------------------
async function resolveAdmin(): Promise<
  { admin: ChatbotAdmin } | { error: NextResponse }
> {
  try {
    return { admin: await requireChatbotAdmin() };
  } catch (e) {
    if (e instanceof AdminError) {
      return { error: NextResponse.json({ error: e.message }, { status: e.status }) };
    }
    return { error: NextResponse.json({ error: "Server error" }, { status: 500 }) };
  }
}

// ---------------------------------------------------------------------------
// GET /api/admin/settings — current settings merged with defaults + reference data
// ---------------------------------------------------------------------------
export async function GET() {
  const gate = await resolveAdmin();
  if ("error" in gate) return gate.error;

  try {
    const payload = await buildSettingsPayload(gate.admin);
    return NextResponse.json(payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not load settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PUT /api/admin/settings — save workspace settings (admin or super_admin)
// ---------------------------------------------------------------------------

// Every field is optional: the handler merges the provided fields over the
// CURRENT saved settings, so the client may send a partial patch or the whole
// object. Bounds mirror the normalize helpers above.
const rateField = z.number().nonnegative().max(1_000_000).nullable();

const putSchema = z
  .object({
    disabledModels: z.array(z.string().trim().min(1).max(200)).max(500).optional(),
    defaultModel: z.string().trim().min(1).max(200).optional(),
    defaultModelKind: z.enum(["tier", "model"]).optional(),
    ragDefaultOn: z.boolean().optional(),
    pricingOverrides: z
      .record(
        z.string().trim().min(1).max(200),
        z.object({ inputPerMTok: rateField, outputPerMTok: rateField })
      )
      .optional(),
  })
  .strict();

export async function PUT(req: Request) {
  const gate = await resolveAdmin();
  if ("error" in gate) return gate.error;
  const { admin } = gate;

  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const patch = parsed.data;

  const service = createSupabaseServiceClient();

  // Start from the current saved settings so a partial PUT never clobbers fields
  // the client didn't send, then overlay the incoming patch and re-normalize.
  const { settings: current } = await loadWorkspaceSettings(service);
  const merged = mergeSettings({
    ...current,
    ...patch,
    // records/arrays: prefer the patch when present, else keep current.
    disabledModels: patch.disabledModels ?? current.disabledModels,
    pricingOverrides: patch.pricingOverrides ?? current.pricingOverrides,
  });

  const updatedAt = new Date().toISOString();
  const { error } = await service.from("app_settings").upsert(
    { id: 1, data: merged, updated_at: updatedAt },
    { onConflict: "id" }
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    settings: merged,
    updatedAt,
    savedBy: admin.email,
  });
}
