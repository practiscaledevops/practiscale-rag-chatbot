// Work modes — "which expert am I talking to". Mirrors the Brain's registry
// (practsicale-rag-backend-/src/lib/work-modes.ts): one Brain, many expert
// jobs; a mode changes retrieval priorities + reasoning, never the knowledge.
//
// Auto is the default: the Brain detects the expert job per message and the
// user can override it. Legacy ids (sales, media, strategy, decision_maker,
// ceo) stay valid as aliases. Which modes a user may use is decided by their
// role SERVER-SIDE (never from chat). Pure data + helpers, client/server safe.

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
  /** Restricted modes (executive, decision memo) require an admin/super_admin or a granted feature. */
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

/** Who is asking — their role and their granted feature permissions. */
export interface Access {
  role?: string | null;
  features?: string[] | null;
}

// A restricted mode is unlocked by an exec role OR by this granted feature.
const MODE_FEATURE: Partial<Record<WorkMode, string>> = {
  decision_memo: "decisions",
  ceo_advisor: "executive",
  ceo_content: "executive",
};

/** Canonical mode for any accepted id or alias, or null. */
export function normalizeMode(v: unknown): WorkMode | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (WORK_MODES.some((m) => m.id === s)) return s as WorkMode;
  return ALIASES[s] ?? null;
}

export function isWorkMode(v: unknown): v is WorkMode {
  return normalizeMode(v) !== null;
}

export function modeLabel(v: unknown): string {
  const id = normalizeMode(v);
  return WORK_MODES.find((m) => m.id === id)?.label ?? "Auto";
}

function isExecRole(role: string | undefined | null): boolean {
  return role === "admin" || role === "super_admin";
}

function hasFeature(features: string[] | null | undefined, key: string): boolean {
  return Array.isArray(features) && features.includes(key);
}

/** Whether this access may use a given mode (restricted modes need role or feature). */
export function canUseMode(mode: WorkModeDef, access: Access): boolean {
  if (!mode.restricted) return true;
  if (isExecRole(access.role)) return true;
  const feat = MODE_FEATURE[mode.id];
  return !!feat && hasFeature(access.features, feat);
}

/** Whether this access may use the private Executive modes + memory. */
export function canUseExecutive(access: Access): boolean {
  return isExecRole(access.role) || hasFeature(access.features, "executive");
}

export function isExecutiveMode(mode: unknown): boolean {
  const id = normalizeMode(mode);
  return !!id && EXECUTIVE_MODES.includes(id);
}

/** The mode ids this access may select (canonical; includes "auto"). */
export function allowedModes(access: Access): WorkMode[] {
  return WORK_MODES.filter((m) => canUseMode(m, access)).map((m) => m.id);
}

/** Mode defs this access may see, for rendering the selector. */
export function allowedModeDefs(access: Access): WorkModeDef[] {
  return WORK_MODES.filter((m) => canUseMode(m, access));
}

/**
 * Resolve a requested mode (canonical id or legacy alias) against access.
 * Unknown → Auto; a restricted mode the user may not use → Auto (the Brain's
 * Auto detection is itself constrained by the allowlist the API forwards).
 */
export function resolveMode(requested: unknown, access: Access): WorkMode {
  const id = normalizeMode(requested);
  if (!id) return DEFAULT_MODE;
  return allowedModes(access).includes(id) ? id : DEFAULT_MODE;
}
