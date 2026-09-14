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

interface Access {
  role?: string | null;
  features?: string[] | null;
}

function isExecRole(role: string | undefined | null): boolean {
  return role === "admin" || role === "super_admin";
}

/** Whether this access may retrieve the sensitive sources (exec role OR the grant). */
export function canAccessSensitive(access: Access): boolean {
  return isExecRole(access.role) || (Array.isArray(access.features) && access.features.includes("sensitive"));
}

/**
 * The source_types this access may retrieve, or `undefined` for "no narrowing"
 * (full key scope, including the sensitive sources). Passed to the Brain as
 * `sourceTypes`. Returning `["document"]` excludes the sensitive call_score data.
 */
export function allowedSourceTypes(access: Access): string[] | undefined {
  return canAccessSensitive(access) ? undefined : [...GENERAL_SOURCE_TYPES];
}

export { SENSITIVE_SOURCE_TYPES };
