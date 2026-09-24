// Knowledge scopes: the "Search in" choice sent to the Brain as `knowledgeScope`
// (Auto, All Brain, Reality, Playbooks, Learnings, Consultant calls). The Brain
// owns the catalogue and advertises it on GET /api/v1/collections, so a scope it
// adds later shows up here without a code change. This file holds the fallback
// list, the id validation and the access filtering. Pure, so it is safe for
// both client and server.
//
// Security: a scope only ever NARROWS retrieval (the Brain intersects it with the
// key scope and the user's allowed source types). A sensitive scope is still
// filtered out of the picker and refused on /api/chat for users who can't reach
// its data (defense in depth).

export interface KnowledgeScope {
  id: string;
  label: string;
  /** One line shown under the label. */
  description: string;
  /** Raw call material: only offered to users who may retrieve it. */
  sensitive: boolean;
}

export const DEFAULT_KNOWLEDGE_SCOPE = "auto";

/** The ids this app knows today (the Brain may add more; see KNOWLEDGE_SCOPE_ID_RE). */
export const KNOWN_KNOWLEDGE_SCOPE_IDS = ["auto", "all", "reality", "playbook", "learning", "calls"] as const;

/** A safe shape for a scope id the Brain adds later. */
export const KNOWLEDGE_SCOPE_ID_RE = /^[a-z_]{1,32}$/;

/**
 * The source types a KNOWN sensitive scope searches. These are treated as
 * sensitive even if a Brain response says otherwise, and a user may pick one
 * only if they can retrieve at least one of these types.
 */
export const SENSITIVE_SCOPE_SOURCE_TYPES: Readonly<Record<string, readonly string[]>> = {
  calls: ["call_score", "transcript"],
};

/** Used when the Brain is unreachable or too old to advertise scopes. Never includes a sensitive scope. */
export const BUILTIN_KNOWLEDGE_SCOPES: readonly KnowledgeScope[] = [
  { id: "auto", label: "Auto", description: "The Brain picks the right knowledge for each question.", sensitive: false },
  { id: "all", label: "All Brain", description: "Search every lane at full weight: reality, learning, playbooks and platforms.", sensitive: false },
  { id: "reality", label: "Reality", description: "What is true today: company facts, reports, KPIs and the raw archive.", sensitive: false },
  { id: "playbook", label: "Playbooks", description: "Frameworks and methods we believe in, and how to apply them.", sensitive: false },
  { id: "learning", label: "Learnings", description: "What PractiScale tried, what happened and what we learned.", sensitive: false },
];

export function isKnownKnowledgeScope(v: unknown): boolean {
  return typeof v === "string" && (KNOWN_KNOWLEDGE_SCOPE_IDS as readonly string[]).includes(v);
}

/** A known id, or a future id with a safe shape. */
export function isKnowledgeScopeId(v: unknown): v is string {
  return typeof v === "string" && (isKnownKnowledgeScope(v) || KNOWLEDGE_SCOPE_ID_RE.test(v));
}

function oneLine(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/**
 * Parse the Brain's `scopes` list (untrusted JSON): valid ids only, deduped,
 * bounded one-line text, known sensitive ids forced sensitive, and Auto always
 * present and first. Returns null when there is no usable list, so the caller
 * can fall back to BUILTIN_KNOWLEDGE_SCOPES.
 */
export function normalizeKnowledgeScopes(raw: unknown): KnowledgeScope[] | null {
  if (!Array.isArray(raw)) return null;
  const out: KnowledgeScope[] = [];
  const seen = new Set<string>();
  for (const item of raw.slice(0, 50)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id.trim() : "";
    if (!isKnowledgeScopeId(id) || seen.has(id)) continue;
    const builtin = BUILTIN_KNOWLEDGE_SCOPES.find((s) => s.id === id);
    const label = oneLine(r.label, 40) || builtin?.label || id;
    const description = oneLine(r.description, 160) || builtin?.description || "";
    const sensitive = r.sensitive === true || id in SENSITIVE_SCOPE_SOURCE_TYPES;
    seen.add(id);
    out.push({ id, label, description, sensitive });
  }
  if (out.length === 0) return null;
  const auto = out.find((s) => s.id === DEFAULT_KNOWLEDGE_SCOPE) ?? BUILTIN_KNOWLEDGE_SCOPES[0];
  return [auto, ...out.filter((s) => s.id !== DEFAULT_KNOWLEDGE_SCOPE)];
}

/**
 * Whether a user whose retrievable source types are `allowedSourceTypes` may use
 * a scope (from lib/access allowedSourceTypes: undefined = every type the key
 * allows; a list = exactly those).
 *   • not sensitive → yes
 *   • every source type allowed → yes
 *   • a known sensitive scope ("calls") → at least one of its source types
 *   • an unknown sensitive scope → every sensitive source type (all-or-nothing,
 *     like canAccessSensitive)
 */
export function canUseKnowledgeScope(
  scope: Pick<KnowledgeScope, "id" | "sensitive">,
  allowedSourceTypes: readonly string[] | undefined,
  sensitiveSourceTypes: readonly string[]
): boolean {
  const known = SENSITIVE_SCOPE_SOURCE_TYPES[scope.id];
  if (!scope.sensitive && !known) return true;
  if (allowedSourceTypes === undefined) return true;
  if (known) return allowedSourceTypes.some((t) => known.includes(t));
  return sensitiveSourceTypes.length > 0 && sensitiveSourceTypes.every((t) => allowedSourceTypes.includes(t));
}

/** The scopes a user may pick (sensitive ones only when they can reach the data). */
export function scopesForAccess(
  scopes: readonly KnowledgeScope[],
  allowedSourceTypes: readonly string[] | undefined,
  sensitiveSourceTypes: readonly string[]
): KnowledgeScope[] {
  return scopes.filter((s) => canUseKnowledgeScope(s, allowedSourceTypes, sensitiveSourceTypes));
}

/**
 * The scope to forward for a request, resolved SERVER-SIDE. Anything invalid,
 * unknown to the Brain, or sensitive without access silently becomes "auto".
 * `available` (the Brain's advertised list) is only consulted for ids this app
 * doesn't know yet; known ids never need the lookup.
 */
export function resolveKnowledgeScope(
  requested: unknown,
  opts: {
    allowedSourceTypes: readonly string[] | undefined;
    sensitiveSourceTypes: readonly string[];
    available?: readonly KnowledgeScope[] | null;
  }
): string {
  if (!isKnowledgeScopeId(requested)) return DEFAULT_KNOWLEDGE_SCOPE;
  let scope: Pick<KnowledgeScope, "id" | "sensitive"> | undefined;
  if (isKnownKnowledgeScope(requested)) {
    scope = { id: requested, sensitive: requested in SENSITIVE_SCOPE_SOURCE_TYPES };
  } else {
    scope = opts.available?.find((s) => s.id === requested);
    if (!scope) return DEFAULT_KNOWLEDGE_SCOPE;
  }
  return canUseKnowledgeScope(scope, opts.allowedSourceTypes, opts.sensitiveSourceTypes) ? scope.id : DEFAULT_KNOWLEDGE_SCOPE;
}
