// Workspace settings — pure shape, defaults, defensive merge, and the
// service-role loaders/payload builder for the admin settings surface.
//
// This module is the single source of truth for workspace-wide configuration
// (the chatbot's OWN Supabase project). It lives in lib/ (not the route file) so
// server consumers (the chat pipeline, server components, the settings page) and
// the API route can all reuse the exact same defaults + merge semantics without
// a Next.js route re-exporting non-handler symbols.
//
// The pure shape/defaults/merge are safe to `import type` from a client
// component. The loaders (loadWorkspaceSettings / buildSettingsPayload) touch the
// SERVICE-ROLE client and are server-only.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatbotAdmin, ProfileRole } from "@/lib/admin";
import { createSupabaseServiceClient } from "@/lib/supabase-server";
import { fetchBrainModels, type BrainModel } from "@/lib/models";

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
