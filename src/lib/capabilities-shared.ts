// Capability permissions — the pure, client/server-safe half.
//
// The Brain publishes a CAPABILITY MANIFEST (GET /api/v1/capabilities): every
// user-facing thing it can do — chat features, work modes, knowledge sources
// (incl. the sensitive call material), background jobs, extraction, model tiers,
// connectors — each with a stable id ("modes.ceo_advisor", "data.call_score",
// "jobs.deep_audit" …), a label, a one-line description, defaults per role and
// dependencies. The admin panel renders permissions from it, so a capability
// the Brain gains appears there with no chatbot change. lib/capabilities.ts
// (server-only) fetches + caches it; this module holds everything that must
// also run in the browser: the types, the BUILT-IN manifest (a mirror of the
// Brain's, used when the Brain is unreachable and as the synchronous default),
// this app's own capabilities (projects, executive memory), the legacy
// feature-key mapping, and effective-permission resolution.
//
// STORAGE (profiles.permissions jsonb, backward compatible):
//   capabilities         string[]  granted capability ids        (explicit grants)
//   capabilities_denied  string[]  ids the admin switched off
//   features             string[]  LEGACY keys — still read for users saved by
//                                  the old editor; for explicit users it is a
//                                  conservative mirror written for old readers
//   allowed_tiers        string[]  mirror of the models.<tier> grants (read by
//                                  lib/models; [] / absent = every tier)
//   models               string[]  model allowlist (unchanged)
// A user is EXPLICIT once `capabilities` is an array. Effective access is, per
// manifest capability: granted → on, denied → off, otherwise the manifest
// default for the user's role — so a user with no stored grants gets the role
// defaults and a capability new to the Brain gets its default until an admin
// decides. Then a prerequisite closure (`requires`) drops anything whose
// prerequisites are off. super_admin always has everything.

export type CapabilityKind = "feature" | "mode" | "source_type" | "tool";

export interface CapabilityGroup {
  id: string;
  label: string;
}

export interface Capability {
  id: string;
  label: string;
  description: string;
  group: string;
  kind: CapabilityKind;
  sensitive?: boolean;
  defaultForMembers: boolean;
  defaultForAdmins: boolean;
  requires?: string[];
  since?: string;
  /** Optional sub-heading inside the group (e.g. a work mode's expert family). */
  section?: string;
}

export interface CapabilityManifest {
  version: number;
  generatedAt: string;
  groups: CapabilityGroup[];
  capabilities: Capability[];
}

export type ManifestSource = "brain" | "fallback";

/** A manifest as this app uses it: the Brain's (or the built-in one) + this app's own capabilities. */
export interface ResolvedCapabilityManifest extends CapabilityManifest {
  /** "brain" when fetched live, "fallback" when the built-in list is in use. */
  source: ManifestSource;
  /** Why the fallback is in use (demo mode, Brain error, timeout …). */
  reason?: string;
  fetchedAt: string;
}

export type Tier = "fast" | "recommended" | "max";

/** The tier → capability id mapping (models.<tier>). */
export const TIER_CAPABILITY: Record<Tier, string> = {
  fast: "models.fast",
  recommended: "models.recommended",
  max: "models.max",
};
export const SMART_ROUTE_CAPABILITY = "models.smart_route";
export const DEEP_ANALYSIS_CAPABILITY = "models.deep_analysis";

const CAPABILITY_ID_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_-]+)+$/;

/** Whether a string has the shape of a capability id ("group.name"). */
export function isCapabilityId(v: unknown): v is string {
  return typeof v === "string" && v.length <= 120 && CAPABILITY_ID_RE.test(v);
}

// ---------------------------------------------------------------------------
// Built-in manifest — mirrors the Brain's GET /api/v1/capabilities for a
// full-scope key (practsicale-rag-backend-/src/lib/capability-manifest.ts).
// Only used when the Brain can't be reached (and as the synchronous default
// before the first fetch); the live manifest always wins.
// ---------------------------------------------------------------------------

type Opts = Partial<Pick<Capability, "sensitive" | "requires" | "since" | "section">> & {
  members?: boolean;
  admins?: boolean;
};

function cap(id: string, group: string, kind: CapabilityKind, label: string, description: string, o: Opts = {}): Capability {
  const c: Capability = {
    id,
    label,
    description,
    group,
    kind,
    defaultForMembers: o.members ?? !o.sensitive,
    defaultForAdmins: o.admins ?? true,
  };
  if (o.sensitive) c.sensitive = true;
  if (o.requires?.length) c.requires = o.requires;
  if (o.since) c.since = o.since;
  if (o.section) c.section = o.section;
  return c;
}

const CHAT = ["chat.knowledge"];
const mode = (id: string, section: string, label: string, hint: string, restricted = false) =>
  cap(`modes.${id}`, "modes", "mode", label, hint, { section, sensitive: restricted, requires: CHAT });
const extract = (id: string, label: string, description: string) =>
  cap(`extract.${id}`, "extract", "feature", label, description, { since: "2026-09-21" });

const BRAIN_BUILTIN: CapabilityManifest = {
  version: 1,
  generatedAt: "2026-09-25T00:00:00.000Z",
  groups: [
    { id: "chat", label: "Chat" },
    { id: "modes", label: "Work modes" },
    { id: "data", label: "Knowledge sources" },
    { id: "knowledge", label: "Brain map & insight" },
    { id: "learning", label: "Organizational learning" },
    { id: "jobs", label: "Background jobs" },
    { id: "extract", label: "Files & media" },
    { id: "models", label: "Models" },
    { id: "tools", label: "Connectors" },
  ],
  capabilities: [
    cap("chat.knowledge", "chat", "feature", "Ask the Brain", "Grounded, cited answers from the company knowledge the Brain holds."),
    cap("chat.source_scope", "chat", "feature", "Source scoping", "Narrow a question with the Search-in picker: one knowledge lane or chosen collections.", { requires: CHAT }),
    cap("chat.call_review", "chat", "feature", "Call reviews", "Review every call for a named day, range, consultant or practice type, each call read in full.", {
      sensitive: true,
      requires: ["chat.knowledge", "data.transcript"],
      since: "2026-09-24",
    }),
    cap("chat.compaction", "chat", "feature", "Long-chat compaction", "Summarize a long conversation so it can keep going past the model's context window.", {
      requires: CHAT,
      since: "2026-09-25",
    }),
    mode("general", "General", "General", "Company knowledge, calls and on-brand writing"),
    mode("ceo_advisor", "Business", "CEO Advisor", "Private strategic co-pilot: company truth, KPIs, learning", true),
    mode("strategy_advisor", "Business", "Strategy Advisor", "Options, trade-offs, risks, direction"),
    mode("sales_coach", "Business", "Sales Coach", "Calls, objections, close rate, follow-ups"),
    mode("marketing_advisor", "Business", "Marketing Advisor", "Acquisition, positioning, funnels, CRO"),
    mode("offer_architect", "Business", "Offer Architect", "Pricing, value, guarantees, packaging"),
    mode("cs_advisor", "Business", "Customer Success Advisor", "Onboarding, retention, expectations, churn"),
    mode("management_coach", "Business", "Management Coach", "Delegation, accountability, manager leverage"),
    mode("hiring_advisor", "Business", "Hiring Advisor", "Selection, interviewing, ownership signals"),
    mode("operations_advisor", "Business", "Operations Advisor", "Processes, fulfillment, workflow, QA"),
    mode("content_strategist", "Content", "Content Strategist", "Ideas, angles, calendars, formats"),
    mode("copywriter", "Content", "Copywriter", "Ads, emails, landing pages, hooks, CTAs"),
    mode("ceo_content", "Content", "CEO Content", "Founder stories from real experience", true),
    mode("distribution_strategist", "Content", "Distribution Strategist", "Reach, platform mechanics, repurposing"),
    mode("training_builder", "Build", "Training Builder", "Complete trainings: modules, exercises, assessment"),
    mode("sop_builder", "Build", "SOP Builder", "Standard operating procedures and systems"),
    mode("decision_memo", "Analysis", "Decision Memo", "Structured decision with options and risks", true),
    mode("research_analyst", "Analysis", "Research Analyst", "Patterns, trends, quantified evidence"),
    cap("data.document", "data", "source_type", "Company knowledge", "SOPs, offers, brand and playbooks, uploaded documents and compiled knowledge."),
    cap("data.call_score", "data", "source_type", "AI call scores", "Call-scoring results per call: scores, bands, outcomes, phase scores, consultants.", { sensitive: true }),
    cap("data.transcript", "data", "source_type", "Call transcripts (QA)", "Full sales-call transcripts from the scoring app, quoted word for word with timestamps.", { sensitive: true }),
    cap("data.coaching", "data", "source_type", "Coaching notes", "Coaching recommendations and QA feedback written about individual calls.", { sensitive: true }),
    cap("knowledge.map", "knowledge", "feature", "Brain map", "Browse what the Brain knows: knowledge objects, their relationships and refs.", { since: "2026-09-21" }),
    cap("knowledge.performance", "knowledge", "feature", "Performance metrics", "Structured numbers in answers: team and per-consultant scores, close rates and KPIs.", {
      sensitive: true,
      requires: ["chat.knowledge", "data.call_score"],
      since: "2026-09-21",
    }),
    cap("knowledge.conflicts", "knowledge", "feature", "Source disagreements", "Flag when the sources behind an answer contradict each other, and which carries more authority.", {
      requires: CHAT,
      since: "2026-09-21",
    }),
    cap("learning.read", "learning", "feature", "View learnings", "Read the organization's learning records: decisions, experiments, results and lessons.", { since: "2026-09-21" }),
    cap("learning.write", "learning", "feature", "Save learnings", "Save a learning the Brain spotted in chat after confirming it, or record one by hand.", { since: "2026-09-21" }),
    cap("jobs.deep_audit", "jobs", "feature", "Deep call audits", "Background audits that read every matching call transcript and build a per-call QA report.", {
      sensitive: true,
      requires: ["data.transcript"],
      since: "2026-09-24",
    }),
    extract("url", "Web links", "Read a web page from a link."),
    extract("youtube", "YouTube videos", "Pull a YouTube video's captions from a link."),
    extract("pdf", "PDFs", "Read attached PDF documents."),
    extract("text", "Text files", "Read attached text, Markdown, CSV and JSON files."),
    extract("audio", "Voice notes & audio", "Transcribe voice dictation and attached audio files."),
    extract("image", "Images & screenshots", "Read the text and content of attached images and screenshots."),
    cap("models.fast", "models", "feature", "Fast", "Claude Haiku 4.5: quick, low-cost answers."),
    cap("models.recommended", "models", "feature", "Recommended", "Claude Sonnet 4.6: the default for most work."),
    cap("models.max", "models", "feature", "Max quality", "Claude Opus 4.8: the strongest model for hard, high-stakes work."),
    cap("models.smart_route", "models", "feature", "Smart Route", "Let the Brain pick the tier for each question (it may use any tier).", {
      requires: ["models.fast", "models.recommended", "models.max"],
      since: "2026-09-14",
    }),
    cap("models.deep_analysis", "models", "feature", "Deep analysis", "Max-quality model with a longer, more thorough analysis budget.", {
      requires: ["models.max"],
      since: "2026-09-14",
    }),
    cap("tools.connectors", "tools", "tool", "Connectors", "Use the MCP servers and third-party integrations the Brain grants this app."),
  ],
};

// ---------------------------------------------------------------------------
// This app's own capabilities (not the Brain's): merged into every manifest.
// ---------------------------------------------------------------------------

export const APP_GROUP: CapabilityGroup = { id: "app", label: "This app" };

export const APP_CAPABILITIES: readonly Capability[] = [
  cap("app.projects", "app", "feature", "Projects", "Group chats into projects with shared instructions and files."),
  cap("app.executive_memory", "app", "feature", "Executive memory", "Private executive context the CEO modes draw on; never shared with anyone else.", {
    sensitive: true,
    requires: ["modes.ceo_advisor"],
  }),
];

/** Drop capabilities whose prerequisites are not offered (repeat until stable). */
function closeOverRequires(caps: Capability[]): Capability[] {
  let out = caps;
  for (let changed = true; changed; ) {
    const ids = new Set(out.map((c) => c.id));
    const next = out.filter((c) => (c.requires ?? []).every((r) => ids.has(r)));
    changed = next.length !== out.length;
    out = next;
  }
  return out;
}

function humanize(id: string): string {
  const s = id.replace(/[_-]+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : id;
}

/**
 * Merge this app's capabilities into a Brain manifest (the app group sits right
 * after "Chat"), make sure every referenced group exists, and drop anything
 * whose prerequisites the manifest doesn't offer.
 */
export function withAppCapabilities(
  m: CapabilityManifest,
  meta: { source: ManifestSource; reason?: string; fetchedAt?: string }
): ResolvedCapabilityManifest {
  const seen = new Set<string>();
  const merged: Capability[] = [];
  for (const c of [...m.capabilities, ...APP_CAPABILITIES]) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    merged.push(c);
  }
  const capabilities = closeOverRequires(merged);

  const groups: CapabilityGroup[] = [];
  const addGroup = (g: CapabilityGroup) => {
    if (!groups.some((x) => x.id === g.id)) groups.push(g);
  };
  for (const g of m.groups) {
    addGroup(g);
    if (g.id === "chat") addGroup(APP_GROUP);
  }
  addGroup(APP_GROUP);
  for (const c of capabilities) if (!groups.some((g) => g.id === c.group)) addGroup({ id: c.group, label: humanize(c.group) });
  const used = new Set(capabilities.map((c) => c.group));

  return {
    version: m.version,
    generatedAt: m.generatedAt,
    groups: groups.filter((g) => used.has(g.id)),
    capabilities,
    source: meta.source,
    ...(meta.reason ? { reason: meta.reason } : {}),
    fetchedAt: meta.fetchedAt ?? m.generatedAt,
  };
}

/** The built-in manifest (Brain mirror + this app's capabilities). */
export const BUILTIN_CAPABILITY_MANIFEST: ResolvedCapabilityManifest = withAppCapabilities(BRAIN_BUILTIN, {
  source: "fallback",
  reason: "built-in list",
});

// The manifest the synchronous helpers default to. On the server,
// lib/capabilities.ts swaps in the Brain's live manifest after each successful
// fetch, so permission checks there track the Brain (including capabilities
// added since this app was built). In the browser it stays the built-in one.
let activeManifest: ResolvedCapabilityManifest = BUILTIN_CAPABILITY_MANIFEST;

export function getActiveManifest(): ResolvedCapabilityManifest {
  return activeManifest;
}

/** Server-only: install the latest fetched manifest as the default for sync checks. */
export function setActiveManifest(m: ResolvedCapabilityManifest): void {
  activeManifest = m;
}

// ---------------------------------------------------------------------------
// Legacy feature keys (the old editor's fixed list) → capability ids
// ---------------------------------------------------------------------------

/** The legacy keys the old editor stored in permissions.features. */
export const LEGACY_FEATURE_KEYS = [
  "rag",
  "projects",
  "attachments",
  "connectors",
  "sensitive",
  "decisions",
  "executive",
] as const;

const LEGACY_ALIASES: Record<string, (typeof LEGACY_FEATURE_KEYS)[number]> = {
  knowledge: "rag",
  decision_memo: "decisions",
  decision_maker: "decisions",
  ceo: "executive",
};

/** The capabilities the legacy "sensitive" grant covers: every sensitive capability except the executive ones. */
function isLegacySensitive(c: Capability): boolean {
  return c.sensitive === true && c.kind !== "mode" && !c.id.startsWith("app.");
}

/**
 * The capability ids a legacy feature key (or a capability id) stands for.
 * Mapping: rag → chat.knowledge · projects → app.projects · attachments →
 * extract.* · connectors → tools.* · sensitive → every sensitive data source
 * + call reviews, performance metrics and deep audits · decisions →
 * modes.decision_memo · executive → modes.ceo_advisor + modes.ceo_content +
 * app.executive_memory. Unknown keys map to nothing.
 */
export function expandLegacyFeature(key: string, manifest: CapabilityManifest = activeManifest): string[] {
  if (isCapabilityId(key)) return [key];
  const k = LEGACY_ALIASES[key] ?? key;
  const ids = manifest.capabilities;
  switch (k) {
    case "rag":
      return ["chat.knowledge"];
    case "projects":
      return ["app.projects"];
    case "attachments":
      return ids.filter((c) => c.id.startsWith("extract.")).map((c) => c.id);
    case "connectors":
      return ids.filter((c) => c.group === "tools").map((c) => c.id);
    case "sensitive":
      return ids.filter(isLegacySensitive).map((c) => c.id);
    case "decisions":
      return ["modes.decision_memo"];
    case "executive":
      return ["modes.ceo_advisor", "modes.ceo_content", "app.executive_memory"];
    default:
      return [];
  }
}

/** Whether `key` is a legacy feature key (or an accepted alias of one). */
export function isLegacyFeatureKey(key: string): boolean {
  return (LEGACY_FEATURE_KEYS as readonly string[]).includes(LEGACY_ALIASES[key] ?? key);
}

// ---------------------------------------------------------------------------
// Stored grants
// ---------------------------------------------------------------------------

export interface StoredGrants {
  /** true once profiles.permissions.capabilities is an array (saved by the new editor). */
  explicit: boolean;
  granted: Set<string>;
  denied: Set<string>;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

const TIERS: Tier[] = ["fast", "recommended", "max"];

/**
 * Read profiles.permissions into grants/denials. Explicit users: the stored
 * capabilities / capabilities_denied. Legacy users: their feature keys mapped
 * to capability ids, and a non-empty allowed_tiers as tier grants + denials.
 */
export function readStoredGrants(raw: unknown, manifest: CapabilityManifest = activeManifest): StoredGrants {
  const out: StoredGrants = { explicit: false, granted: new Set(), denied: new Set() };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;

  if (Array.isArray(r.capabilities)) {
    out.explicit = true;
    for (const id of strings(r.capabilities)) for (const x of expandLegacyFeature(id, manifest)) out.granted.add(x);
    for (const id of strings(r.capabilities_denied)) if (isCapabilityId(id) && !out.granted.has(id)) out.denied.add(id);
    return out;
  }

  for (const key of strings(r.features)) for (const x of expandLegacyFeature(key, manifest)) out.granted.add(x);
  const tiers = strings(r.allowed_tiers).filter((t): t is Tier => (TIERS as string[]).includes(t));
  if (tiers.length > 0) {
    for (const t of TIERS) (tiers.includes(t) ? out.granted : out.denied).add(TIER_CAPABILITY[t]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Effective access
// ---------------------------------------------------------------------------

/**
 * Who is asking, as the gating helpers see it.
 *   role         profiles.role ("user" | "admin" | "super_admin")
 *   features     legacy feature keys (profiles.permissions.features) — OR an
 *                already-resolved list of capability ids (SessionProfile.
 *                capabilities). A list that carries capability ids is taken as
 *                the user's complete, authoritative capability set.
 *   permissions  the stored profiles.permissions (explicit grants or legacy)
 */
export interface Access {
  role?: string | null;
  features?: readonly string[] | null;
  permissions?: unknown;
}

export type AccessInput = Access | readonly string[] | ReadonlySet<string> | null | undefined;

function looksLikeStoredPermissions(o: Record<string, unknown>): boolean {
  return "capabilities" in o || "capabilities_denied" in o || "allowed_tiers" in o || "models" in o;
}

/**
 * The capability ids this access holds, in manifest order. Accepts an Access,
 * a raw profiles.permissions object (resolved with member defaults), or an
 * already-resolved list/Set (returned as-is).
 */
export function effectiveCapabilities(input: AccessInput, manifest: CapabilityManifest = activeManifest): string[] {
  if (!input) return resolve(null, { explicit: false, granted: new Set(), denied: new Set() }, manifest);
  if (Array.isArray(input) || input instanceof Set) {
    return Array.from(input as Iterable<unknown>).filter((x): x is string => typeof x === "string");
  }

  const a = input as Access & Record<string, unknown>;
  const features = strings(a.features);
  // A resolved capability list (SessionProfile.capabilities) is authoritative.
  if (features.some(isCapabilityId)) {
    return Array.from(new Set(features.flatMap((f) => expandLegacyFeature(f, manifest))));
  }

  const stored =
    a.permissions !== undefined
      ? readStoredGrants(a.permissions, manifest)
      : looksLikeStoredPermissions(a)
        ? readStoredGrants(a, manifest)
        : { explicit: false, granted: new Set<string>(), denied: new Set<string>() };
  if (!stored.explicit) for (const f of features) for (const x of expandLegacyFeature(f, manifest)) stored.granted.add(x);
  return resolve(typeof a.role === "string" ? a.role : null, stored, manifest);
}

function resolve(role: string | null, stored: StoredGrants, manifest: CapabilityManifest): string[] {
  const all = manifest.capabilities;
  let on: Capability[];
  if (role === "super_admin") {
    on = [...all];
  } else {
    const admin = role === "admin";
    on = all.filter((c) =>
      stored.granted.has(c.id) ? true : stored.denied.has(c.id) ? false : admin ? c.defaultForAdmins : c.defaultForMembers
    );
  }
  return closeOverRequires(on).map((c) => c.id);
}

/** Whether the access holds capability `id`. */
export function hasCapability(input: AccessInput, id: string, manifest: CapabilityManifest = activeManifest): boolean {
  return effectiveCapabilities(input, manifest).includes(id);
}

/** Close a hand-picked set over `requires` (drop anything whose prerequisites are off). */
export function closeGrantSet(ids: Iterable<string>, manifest: CapabilityManifest = activeManifest): string[] {
  const set = new Set(ids);
  return closeOverRequires(manifest.capabilities.filter((c) => set.has(c.id))).map((c) => c.id);
}

// ---------------------------------------------------------------------------
// Editor helpers: presets, dependencies, mirrors, validation
// ---------------------------------------------------------------------------

export type CapabilityPresetId = "member" | "analyst" | "manager" | "executive" | "admin";

export interface CapabilityPreset {
  id: CapabilityPresetId;
  label: string;
  description: string;
}

export const CAPABILITY_PRESETS: readonly CapabilityPreset[] = [
  { id: "member", label: "Member", description: "The Brain's defaults for team members: no sensitive call data." },
  { id: "analyst", label: "Analyst / QA", description: "Members plus the sensitive call data, call reviews, metrics and deep audits." },
  { id: "manager", label: "Manager", description: "Everything except the private executive experts and memory." },
  { id: "executive", label: "Executive", description: "Every capability, including the private executive experts." },
  { id: "admin", label: "Admin", description: "The Brain's defaults for admins." },
];

const isExecutiveCapability = (c: Capability) => c.id.startsWith("modes.ceo_") || c.id.startsWith("app.executive_");

/** The capability ids a preset turns on (closed over prerequisites). */
export function presetCapabilities(id: CapabilityPresetId, manifest: CapabilityManifest = activeManifest): string[] {
  const all = manifest.capabilities;
  const pick = (pred: (c: Capability) => boolean) => closeGrantSet(all.filter(pred).map((c) => c.id), manifest);
  switch (id) {
    case "member":
      return pick((c) => c.defaultForMembers);
    case "analyst":
      return pick((c) => c.defaultForMembers || isLegacySensitive(c));
    case "manager":
      return pick((c) => !isExecutiveCapability(c));
    case "executive":
      return pick(() => true);
    case "admin":
      return pick((c) => c.defaultForAdmins);
  }
}

/** The preset a role starts from in the editor. */
export function presetForRole(role: string | null | undefined): CapabilityPresetId {
  return role === "super_admin" ? "executive" : role === "admin" ? "admin" : "member";
}

/** Everything `id` needs, transitively (not including `id`). */
export function prerequisitesOf(id: string, manifest: CapabilityManifest = activeManifest): string[] {
  const byId = new Map(manifest.capabilities.map((c) => [c.id, c]));
  const out = new Set<string>();
  const walk = (x: string) => {
    for (const r of byId.get(x)?.requires ?? []) {
      if (out.has(r)) continue;
      out.add(r);
      walk(r);
    }
  };
  walk(id);
  return [...out];
}

/** Everything that (transitively) needs `id`. */
export function dependentsOf(id: string, manifest: CapabilityManifest = activeManifest): string[] {
  const out = new Set<string>();
  const walk = (x: string) => {
    for (const c of manifest.capabilities) {
      if (!out.has(c.id) && (c.requires ?? []).includes(x)) {
        out.add(c.id);
        walk(c.id);
      }
    }
  };
  walk(id);
  return [...out];
}

/**
 * Toggle one capability in an editor state: switching it on also switches on
 * its prerequisites; switching it off also switches off what depends on it.
 */
export function toggleCapability(
  current: Iterable<string>,
  id: string,
  on: boolean,
  manifest: CapabilityManifest = activeManifest
): string[] {
  const set = new Set(current);
  if (on) {
    set.add(id);
    for (const r of prerequisitesOf(id, manifest)) set.add(r);
  } else {
    set.delete(id);
    for (const d of dependentsOf(id, manifest)) set.delete(d);
  }
  return manifest.capabilities.filter((c) => set.has(c.id)).map((c) => c.id);
}

/**
 * The legacy `features` mirror for an explicit grant set, for readers that
 * still look at features. CONSERVATIVE: a key is written only when everything
 * it stands for is granted, so an old reader never sees more than the grants.
 */
export function legacyFeaturesFor(granted: Iterable<string>, manifest: CapabilityManifest = activeManifest): string[] {
  const g = new Set(granted);
  const out: string[] = [];
  for (const key of LEGACY_FEATURE_KEYS) {
    const ids = expandLegacyFeature(key, manifest).filter((id) => manifest.capabilities.some((c) => c.id === id));
    if (ids.length > 0 && ids.every((id) => g.has(id))) out.push(key);
  }
  return out;
}

/**
 * The allowed_tiers mirror for a grant set: undefined when every tier the
 * manifest offers is granted (no restriction), else the granted tiers.
 */
export function allowedTiersFor(granted: Iterable<string>, manifest: CapabilityManifest = activeManifest): Tier[] | undefined {
  const g = new Set(granted);
  const offered = TIERS.filter((t) => manifest.capabilities.some((c) => c.id === TIER_CAPABILITY[t]));
  if (offered.length === 0) return undefined;
  const on = offered.filter((t) => g.has(TIER_CAPABILITY[t]));
  return on.length === offered.length ? undefined : on;
}

/**
 * The explicit grant/denial lists to store for a submitted grant set: every
 * capability the manifest offers is decided (granted or denied); decisions
 * already stored for ids the manifest doesn't carry right now (e.g. while the
 * Brain is unreachable) are kept.
 *
 * `editorOffered` — the capability ids the admin's editor actually RENDERED.
 * When given, only those are decided from the submitted set; an id the editor
 * never showed (it rendered the built-in fallback list while the server now
 * has the Brain's live manifest, with e.g. tools.connector.<slug> or a new
 * data.<type>) keeps its previous decision, or stays undecided (→ the role
 * default). Without it, a save would silently deny every live-only capability.
 */
export function buildStoredCapabilities(
  granted: Iterable<string>,
  manifest: CapabilityManifest,
  previousRaw?: unknown,
  editorOffered?: Iterable<string>
): { capabilities: string[]; capabilities_denied: string[] } {
  const offered = manifest.capabilities.map((c) => c.id);
  const offeredSet = new Set(offered);
  const shown = editorOffered ? new Set(editorOffered) : null;
  const decided = shown ? offered.filter((id) => shown.has(id)) : offered;
  const undecided = shown ? offered.filter((id) => !shown.has(id)) : [];
  const on = new Set(closeGrantSet(granted, manifest));
  const prev = readStoredGrants(previousRaw, manifest);
  const keepGranted = prev.explicit ? [...prev.granted].filter((id) => !offeredSet.has(id)) : [];
  const keepDenied = prev.explicit ? [...prev.denied].filter((id) => !offeredSet.has(id)) : [];
  return {
    capabilities: [
      ...decided.filter((id) => on.has(id)),
      ...undecided.filter((id) => prev.explicit && prev.granted.has(id)),
      ...keepGranted,
    ],
    capabilities_denied: [
      ...decided.filter((id) => !on.has(id)),
      ...undecided.filter((id) => prev.explicit && prev.denied.has(id)),
      ...keepDenied,
    ],
  };
}

/**
 * Submitted ids that are neither offered by the manifest, nor a legacy
 * feature key, nor already stored on the user. Non-empty → reject the write.
 */
export function unknownCapabilityIds(ids: Iterable<string>, manifest: CapabilityManifest, previousRaw?: unknown): string[] {
  const offered = new Set(manifest.capabilities.map((c) => c.id));
  const prev = readStoredGrants(previousRaw, manifest);
  const out: string[] = [];
  for (const id of ids) {
    if (offered.has(id) || isLegacyFeatureKey(id) || prev.granted.has(id) || prev.denied.has(id)) continue;
    out.push(id);
  }
  return out;
}
