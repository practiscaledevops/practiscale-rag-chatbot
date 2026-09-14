// Work modes (persona routing) — shared by the API (role gating) and the UI.
// Pure data + helpers, safe to import from client or server. Which modes a user
// may use is decided by their role, resolved SERVER-SIDE (never from chat).

export type WorkMode =
  | "general"
  | "copywriter"
  | "media"
  | "sales"
  | "strategy"
  | "decision_maker"
  | "ceo";

export interface WorkModeDef {
  id: WorkMode;
  label: string;
  hint: string;
  /** Restricted modes (decision memo, executive) require an admin/super_admin. */
  restricted?: boolean;
}

export const WORK_MODES: WorkModeDef[] = [
  { id: "general", label: "General", hint: "Company knowledge & SOPs" },
  { id: "copywriter", label: "Copywriter", hint: "Ads, emails, hooks, CTAs" },
  { id: "media", label: "Media", hint: "Briefs, hooks, calendars" },
  { id: "sales", label: "Sales coach", hint: "Calls, objections, follow-ups" },
  { id: "strategy", label: "Strategy", hint: "Options, trade-offs, risks" },
  { id: "decision_maker", label: "Decision memo", hint: "Structured decisions", restricted: true },
  { id: "ceo", label: "Executive", hint: "Private strategic co-pilot", restricted: true },
];

export const DEFAULT_MODE: WorkMode = "general";

/** Who is asking — their role and their granted feature permissions. */
export interface Access {
  role?: string | null;
  features?: string[] | null;
}

// A restricted mode is unlocked by an exec role OR by this granted feature.
const MODE_FEATURE: Partial<Record<WorkMode, string>> = {
  decision_maker: "decisions",
  ceo: "executive",
};

export function isWorkMode(v: unknown): v is WorkMode {
  return typeof v === "string" && WORK_MODES.some((m) => m.id === v);
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

/** Whether this access may use the private Executive (CEO) mode + memory. */
export function canUseExecutive(access: Access): boolean {
  return isExecRole(access.role) || hasFeature(access.features, "executive");
}

/** The mode ids this access may select. */
export function allowedModes(access: Access): WorkMode[] {
  return WORK_MODES.filter((m) => canUseMode(m, access)).map((m) => m.id);
}

/** Mode defs this access may see, for rendering the selector. */
export function allowedModeDefs(access: Access): WorkModeDef[] {
  return WORK_MODES.filter((m) => canUseMode(m, access));
}

/** Resolve a requested mode against access, downgrading to General if not allowed. */
export function resolveMode(requested: unknown, access: Access): WorkMode {
  if (!isWorkMode(requested)) return DEFAULT_MODE;
  return allowedModes(access).includes(requested) ? requested : DEFAULT_MODE;
}
