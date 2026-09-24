// Work modes — "which expert am I talking to". Mirrors the Brain's registry
// (practsicale-rag-backend-/src/lib/work-modes.ts): one Brain, many expert
// jobs; a mode changes retrieval priorities + reasoning, never the knowledge.
//
// Auto is the default: the Brain detects the expert job per message and the
// user can override it. Legacy ids (sales, media, strategy, decision_maker,
// ceo) stay valid as aliases. Which modes a user may use is decided SERVER-SIDE
// from their capabilities ("modes.<id>" in the Brain's capability manifest —
// see lib/capabilities-shared), never from chat. Pure data + helpers,
// client/server safe.

import {
  effectiveCapabilities,
  hasCapability,
  getActiveManifest,
  type Access,
  type AccessInput,
  type CapabilityManifest,
} from "@/lib/capabilities-shared";

export type WorkMode =
  | "auto"
  | "general"
  | "ceo_advisor"
  | "strategy_advisor"
  | "sales_coach"
  | "marketing_advisor"
  | "offer_architect"
  | "cs_advisor"
  | "management_coach"
  | "hiring_advisor"
  | "operations_advisor"
  | "content_strategist"
  | "copywriter"
  | "ceo_content"
  | "distribution_strategist"
  | "training_builder"
  | "sop_builder"
  | "decision_memo"
  | "research_analyst";

export type ModeGroup = "general" | "business" | "content" | "build" | "analysis";

export interface WorkModeDef {
  id: WorkMode;
  label: string;
  hint: string;
  group: ModeGroup;
  /** Restricted experts (executive, decision memo): off for members unless granted (display hint; gating is by capability). */
  restricted?: boolean;
}

export const WORK_MODES: WorkModeDef[] = [
  { id: "auto", label: "Auto", hint: "Picks the right expert for each message", group: "general" },
  { id: "general", label: "General", hint: "Company knowledge, calls & on-brand writing", group: "general" },
  { id: "ceo_advisor", label: "CEO Advisor", hint: "Private strategic co-pilot", group: "business", restricted: true },
  { id: "strategy_advisor", label: "Strategy Advisor", hint: "Options, trade-offs, direction", group: "business" },
  { id: "sales_coach", label: "Sales Coach", hint: "Calls, objections, close rate", group: "business" },
  { id: "marketing_advisor", label: "Marketing Advisor", hint: "Acquisition, positioning, funnels", group: "business" },
  { id: "offer_architect", label: "Offer Architect", hint: "Pricing, value, guarantees", group: "business" },
  { id: "cs_advisor", label: "Customer Success Advisor", hint: "Onboarding, retention, churn", group: "business" },
  { id: "management_coach", label: "Management Coach", hint: "Delegation, accountability, leverage", group: "business" },
  { id: "hiring_advisor", label: "Hiring Advisor", hint: "Selection, interviews, onboarding", group: "business" },
  { id: "operations_advisor", label: "Operations Advisor", hint: "Processes, fulfillment, QA", group: "business" },
  { id: "content_strategist", label: "Content Strategist", hint: "Ideas, angles, calendars", group: "content" },
  { id: "copywriter", label: "Copywriter", hint: "Ads, emails, hooks, CTAs", group: "content" },
  { id: "ceo_content", label: "CEO Content", hint: "Founder stories from real experience", group: "content", restricted: true },
  { id: "distribution_strategist", label: "Distribution Strategist", hint: "Reach, platform mechanics", group: "content" },
  { id: "training_builder", label: "Training Builder", hint: "Complete trainings & courses", group: "build" },
  { id: "sop_builder", label: "SOP Builder", hint: "Procedures & operating systems", group: "build" },
  { id: "decision_memo", label: "Decision Memo", hint: "Structured decisions", group: "analysis", restricted: true },
  { id: "research_analyst", label: "Research Analyst", hint: "Patterns, trends, evidence", group: "analysis" },
];

export const MODE_GROUP_LABELS: Record<ModeGroup, string> = {
  general: "General",
  business: "Business",
  content: "Content",
  build: "Build",
  analysis: "Analysis",
};

export const DEFAULT_MODE: WorkMode = "auto";

/** Modes that unlock the private executive workspace (CEO memory injection). */
export const EXECUTIVE_MODES: WorkMode[] = ["ceo_advisor", "ceo_content"];

const ALIASES: Record<string, WorkMode> = {
  sales: "sales_coach",
  media: "content_strategist",
  strategy: "strategy_advisor",
  decision_maker: "decision_memo",
  ceo: "ceo_advisor",
  executive: "ceo_advisor",
  content: "content_strategist",
  training: "training_builder",
  sop: "sop_builder",
  analyst: "research_analyst",
  management: "management_coach",
  hiring: "hiring_advisor",
  operations: "operations_advisor",
  marketing: "marketing_advisor",
  offers: "offer_architect",
  cs: "cs_advisor",
  distribution: "distribution_strategist",
};

/** Who is asking — role + capability grants (see lib/capabilities-shared). */
export type { Access };

const MODE_PREFIX = "modes.";
const EXECUTIVE_MEMORY = "app.executive_memory";

const STATIC_IDS = new Set<string>(WORK_MODES.map((m) => m.id));
const GROUP_BY_LABEL = new Map<string, ModeGroup>(
  (Object.entries(MODE_GROUP_LABELS) as [ModeGroup, string][]).map(([g, label]) => [label.toLowerCase(), g])
);

/**
 * Work modes the Brain's manifest offers that this app's registry doesn't list
 * yet (an expert added in the Brain). They are selectable wherever the manifest
 * in use carries them — on the server, the Brain's live one.
 */
export function manifestOnlyModeDefs(manifest: CapabilityManifest = getActiveManifest()): WorkModeDef[] {
  return manifest.capabilities
    .filter((c) => c.kind === "mode" && c.id.startsWith(MODE_PREFIX) && !STATIC_IDS.has(c.id.slice(MODE_PREFIX.length)))
    .map((c) => ({
      id: c.id.slice(MODE_PREFIX.length) as WorkMode,
      label: c.label,
      hint: c.description,
      group: GROUP_BY_LABEL.get((c.section ?? "").toLowerCase()) ?? "general",
      ...(c.defaultForMembers ? {} : { restricted: true }),
    }));
}

/** Every mode def: this app's registry + any the Brain added since. */
function allModeDefs(manifest: CapabilityManifest): WorkModeDef[] {
  const extra = manifestOnlyModeDefs(manifest);
  return extra.length ? [...WORK_MODES, ...extra] : WORK_MODES;
}

/** Canonical mode for any accepted id or alias, or null. */
export function normalizeMode(v: unknown): WorkMode | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (STATIC_IDS.has(s)) return s as WorkMode;
  if (ALIASES[s]) return ALIASES[s];
  return manifestOnlyModeDefs().find((m) => m.id === s)?.id ?? null;
}

export function isWorkMode(v: unknown): v is WorkMode {
  return normalizeMode(v) !== null;
}

export function modeLabel(v: unknown): string {
  const id = normalizeMode(v);
  return allModeDefs(getActiveManifest()).find((m) => m.id === id)?.label ?? "Auto";
}

/**
 * Whether this access may use a given mode: Auto always (it only ever resolves
 * to a permitted mode); every other mode needs its "modes.<id>" capability.
 * The restricted experts (CEO Advisor, CEO Content, Decision Memo) are off for
 * members and on for admins by default; a grant can change either.
 */
export function canUseMode(mode: WorkModeDef, access: AccessInput, manifest: CapabilityManifest = getActiveManifest()): boolean {
  if (mode.id === "auto") return true;
  return hasCapability(access, `${MODE_PREFIX}${mode.id}`, manifest);
}

/** Whether this access may use the private executive memory (injected in the CEO modes). */
export function canUseExecutive(access: AccessInput, manifest: CapabilityManifest = getActiveManifest()): boolean {
  const caps = effectiveCapabilities(access, manifest);
  return caps.includes(EXECUTIVE_MEMORY) && EXECUTIVE_MODES.some((m) => caps.includes(`${MODE_PREFIX}${m}`));
}

export function isExecutiveMode(mode: unknown): boolean {
  const id = normalizeMode(mode);
  return !!id && EXECUTIVE_MODES.includes(id);
}

/** Mode defs this access may see, for rendering the selector. */
export function allowedModeDefs(access: AccessInput, manifest: CapabilityManifest = getActiveManifest()): WorkModeDef[] {
  const caps = new Set(effectiveCapabilities(access, manifest));
  return allModeDefs(manifest).filter((m) => m.id === "auto" || caps.has(`${MODE_PREFIX}${m.id}`));
}

/** The mode ids this access may select (canonical; includes "auto"). */
export function allowedModes(access: AccessInput, manifest: CapabilityManifest = getActiveManifest()): WorkMode[] {
  return allowedModeDefs(access, manifest).map((m) => m.id);
}

/**
 * Resolve a requested mode (canonical id or legacy alias) against access.
 * Unknown → Auto; a mode the user may not use → Auto (the Brain's Auto
 * detection is itself constrained by the allowlist the API forwards).
 */
export function resolveMode(requested: unknown, access: AccessInput, manifest: CapabilityManifest = getActiveManifest()): WorkMode {
  const id = normalizeMode(requested);
  if (!id) return DEFAULT_MODE;
  return allowedModes(access, manifest).includes(id) ? id : DEFAULT_MODE;
}
