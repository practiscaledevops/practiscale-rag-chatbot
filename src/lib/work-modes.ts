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

export function isWorkMode(v: unknown): v is WorkMode {
  return typeof v === "string" && WORK_MODES.some((m) => m.id === v);
}

function isExecRole(role: string | undefined | null): boolean {
  return role === "admin" || role === "super_admin";
}

/** The mode ids a role may select (restricted modes need an exec role). */
export function allowedModes(role: string | undefined | null): WorkMode[] {
  return WORK_MODES.filter((m) => isExecRole(role) || !m.restricted).map((m) => m.id);
}

/** Mode defs a role may see, for rendering the selector. */
export function allowedModeDefs(role: string | undefined | null): WorkModeDef[] {
  return WORK_MODES.filter((m) => isExecRole(role) || !m.restricted);
}

/** Resolve a requested mode against a role, downgrading to General if not allowed. */
export function resolveMode(requested: unknown, role: string | undefined | null): WorkMode {
  if (!isWorkMode(requested)) return DEFAULT_MODE;
  return allowedModes(role).includes(requested) ? requested : DEFAULT_MODE;
}
