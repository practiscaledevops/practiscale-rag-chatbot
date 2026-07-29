// Server-side helper for the Brain's model catalog.
//
// SECURITY: like lib/brain.ts, this reads BRAIN_API_KEY from the server
// environment and must NEVER be imported into a client component or shipped to
// the browser. The browser reaches the catalog through this app's own /api
// routes, which call fetchBrainModels() server-side.
//
// The permission-filter helper (filterModelsByPermissions) and its types are
// pure and safe to import anywhere; only fetchBrainModels touches the network.

const BRAIN_URL = process.env.BRAIN_API_URL ?? "http://localhost:3000";
const BRAIN_KEY = process.env.BRAIN_API_KEY ?? "";

/** A selectable model, normalized to a single shape regardless of Brain payload. */
export interface BrainModel {
  /** concrete model id, e.g. "claude-opus-4-8", "gpt-4o-mini" */
  id: string;
  /** provider family; "anthropic" | "openai" | other */
  provider: string;
  /** human-friendly label for the switcher */
  label: string;
  /** optional tier hint: "fast" | "recommended" | "max" (or any Brain value) */
  tier?: string;
  /** whether the Brain reports this model as currently selectable */
  available: boolean;
  /** optional reason when unavailable (or a note on the fallback catalog) */
  reason?: string;
}

/**
 * Per-user model/feature access, mirroring the profiles.permissions jsonb shape
 * documented in supabase/setup/admin.sql. All keys are optional; an empty
 * object means "no explicit restriction".
 */
export interface UserPermissions {
  /** allowlist of model-id globs ("*" wildcard) or exact ids, e.g. ["claude-*","gpt-4o-mini"] */
  models?: string[];
  /** feature flags, e.g. ["rag","projects","attachments","connectors"] */
  features?: string[];
  /** subset of the tiers the user may select */
  allowed_tiers?: Array<"fast" | "recommended" | "max">;
}

// ---------------------------------------------------------------------------
// Static fallback catalog — Claude + GPT families. Used when the Brain's
// /api/v1/models call fails or returns nothing usable, so the switcher is never
// empty. Availability is UNKNOWN in this path, so entries are marked available
// (optimistic) with a `reason` noting the fallback; the real Brain response
// always wins when reachable.
// ---------------------------------------------------------------------------
const FALLBACK_MODELS: ReadonlyArray<BrainModel> = [
  { id: "claude-opus-4-8", provider: "anthropic", label: "Claude Opus 4.8", tier: "max", available: true, reason: "fallback catalog" },
  { id: "claude-3-5-sonnet", provider: "anthropic", label: "Claude Sonnet", tier: "recommended", available: true, reason: "fallback catalog" },
  { id: "claude-3-5-haiku", provider: "anthropic", label: "Claude Haiku", tier: "fast", available: true, reason: "fallback catalog" },
  { id: "gpt-4o", provider: "openai", label: "GPT-4o", tier: "recommended", available: true, reason: "fallback catalog" },
  { id: "gpt-4o-mini", provider: "openai", label: "GPT-4o mini", tier: "fast", available: true, reason: "fallback catalog" },
  { id: "gpt-5", provider: "openai", label: "GPT-5", tier: "max", available: true, reason: "fallback catalog" },
];

/** Coerce an unknown value to a trimmed string, or "" — defensive JSON reading. */
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v);
}

/** Infer a provider from an id when the payload omits it. */
function inferProvider(id: string): string {
  const s = id.toLowerCase();
  if (s.includes("claude") || s.includes("opus") || s.includes("sonnet") || s.includes("haiku")) {
    return "anthropic";
  }
  if (s.includes("gpt") || s.startsWith("o1") || s.startsWith("o3")) return "openai";
  return "unknown";
}

/**
 * Normalize one raw catalog entry into a BrainModel. Reads defensively: the
 * Brain's shape is likely { id, provider, label, tier?, available, reason? },
 * but we tolerate missing fields (derive label from id, provider from id, and
 * default availability to true unless explicitly false).
 */
function normalizeModel(raw: unknown, providerHint?: string): BrainModel | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id ?? r.model ?? r.name);
  if (!id) return null;

  const provider = str(r.provider ?? providerHint) || inferProvider(id);
  const label = str(r.label ?? r.name ?? r.displayName) || id;
  const tier = r.tier != null ? str(r.tier) : undefined;
  // Default to available unless the Brain explicitly says false.
  const available = r.available === false ? false : Boolean(r.available ?? true);
  const reason = r.reason != null ? str(r.reason) : undefined;

  return { id, provider, label, tier: tier || undefined, available, reason: reason || undefined };
}

/**
 * Flatten the many shapes the catalog might arrive in into BrainModel[]:
 *   • { models: [ … ] }
 *   • [ … ]  (bare array)
 *   • { anthropic: [ … ], openai: [ … ] }  (grouped by provider)
 */
function normalizeCatalog(payload: unknown): BrainModel[] {
  const out: BrainModel[] = [];

  const pushArray = (arr: unknown, providerHint?: string) => {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      const m = normalizeModel(item, providerHint);
      if (m) out.push(m);
    }
  };

  if (Array.isArray(payload)) {
    pushArray(payload);
  } else if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.models)) {
      pushArray(obj.models);
    } else if (Array.isArray(obj.data)) {
      pushArray(obj.data);
    } else {
      // Grouped by provider: { anthropic: [...], openai: [...] }.
      for (const [key, value] of Object.entries(obj)) {
        if (Array.isArray(value)) pushArray(value, key);
      }
    }
  }

  return out;
}

/**
 * Fetch the Brain's selectable-model catalog (server-side, with the scoped
 * BRAIN_API_KEY) and return it normalized to BrainModel[]. On any failure
 * (missing key, network error, non-OK status, empty/unusable body) it falls
 * back to the static catalog so callers always get a non-empty list.
 *
 * Server-only. Do not import into a client component.
 */
export async function fetchBrainModels(): Promise<BrainModel[]> {
  if (!BRAIN_KEY) return [...FALLBACK_MODELS];

  try {
    const res = await fetch(`${BRAIN_URL}/api/v1/models`, {
      method: "GET",
      headers: { authorization: `Bearer ${BRAIN_KEY}` },
      // Availability can change; revalidate periodically rather than per request.
      next: { revalidate: 300 },
    });
    if (!res.ok) return [...FALLBACK_MODELS];

    const payload = await res.json().catch(() => null);
    const models = normalizeCatalog(payload);
    return models.length > 0 ? models : [...FALLBACK_MODELS];
  } catch {
    return [...FALLBACK_MODELS];
  }
}

/** Compile a permission glob ("claude-*") into an anchored, case-insensitive RegExp. */
function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .trim()
    .toLowerCase()
    // escape regex specials EXCEPT "*", which we translate to ".*"
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/**
 * Filter a catalog down to the models a user is permitted to select.
 *
 * Rules (see profiles.permissions / can_use_all_models in admin.sql):
 *   • canUseAllModels === true            → the full catalog (allowlist ignored).
 *   • perms.models present & non-empty    → only models whose id matches one of
 *                                           the globs/exact ids.
 *   • otherwise (no allowlist)            → the full catalog (unrestricted; an
 *                                           absent allowlist is not a lockout).
 * When perms.allowed_tiers is present, results are additionally restricted to
 * models whose `tier` is in that list (models without a tier are kept).
 *
 * Pure — safe to call on the server or, with a catalog already fetched, in a
 * server component before handing the list to the client.
 */
export function filterModelsByPermissions(
  catalog: BrainModel[],
  perms: UserPermissions | null | undefined,
  canUseAllModels = false
): BrainModel[] {
  let out = catalog;

  if (!canUseAllModels) {
    const allow = perms?.models;
    if (Array.isArray(allow) && allow.length > 0) {
      const patterns = allow.map(globToRegExp);
      out = out.filter((m) => patterns.some((re) => re.test(m.id.toLowerCase())));
    }
  }

  const tiers = perms?.allowed_tiers;
  if (Array.isArray(tiers) && tiers.length > 0) {
    const set = new Set(tiers as string[]);
    // Keep models without a tier hint; only filter ones that declare a tier.
    out = out.filter((m) => !m.tier || set.has(m.tier));
  }

  return out;
}
