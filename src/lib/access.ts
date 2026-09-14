// Role-based knowledge access (partitioning), resolved SERVER-SIDE from the
// user's profile role and passed to the Brain as a scope narrowing. The Brain
// intersects it with the scoped key (it can only ever restrict, never widen).
//
// Policy: the sensitive AI call-scoring / QA data (source_type "call_score") is
// restricted to admins / decision-makers. Regular team members retrieve only the
// general company knowledge (source_type "document": SOPs, brand, offers,
// approved examples). Adjust here as the data model grows (e.g. per-collection
// confidentiality tiers).

const SENSITIVE_SOURCE_TYPES = ["call_score"];
const GENERAL_SOURCE_TYPES = ["document"];

function isExecRole(role: string | undefined | null): boolean {
  return role === "admin" || role === "super_admin";
}

/**
 * The source_types this role may retrieve, or `undefined` for "no narrowing"
 * (full key scope, including the sensitive sources). Passed to the Brain as
 * `sourceTypes`. Returning `["document"]` for a regular user excludes call_score.
 */
export function allowedSourceTypes(role: string | undefined | null): string[] | undefined {
  return isExecRole(role) ? undefined : [...GENERAL_SOURCE_TYPES];
}

/** Whether a role may access the sensitive sources (for UI hints/labels). */
export function canAccessSensitive(role: string | undefined | null): boolean {
  return isExecRole(role);
}

export { SENSITIVE_SOURCE_TYPES };
