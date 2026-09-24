// Capability-based access, resolved SERVER-SIDE from the user's profile and
// passed to the Brain as a scope narrowing (the Brain intersects it with the
// scoped key: it can only ever restrict, never widen).
//
// What a user may do is a set of CAPABILITY ids from the Brain's manifest
// ("data.call_score", "modes.decision_memo", "jobs.deep_audit" …) — see
// lib/capabilities-shared for how stored grants, legacy feature keys and the
// role defaults resolve into that set. The helpers below are the stable API the
// routes call; they all DERIVE from capabilities:
//   • knowledge sources: data.<source_type> — members get "data.document"
//     (general company knowledge) by default; the sensitive call material
//     (data.call_score / data.transcript / data.coaching) is off for members
//     unless granted, on for admins.
//   • work modes / executive memory: lib/work-modes (modes.<id>, app.executive_memory).
//
// Existing call sites pass `{ role, features }`; that still works (legacy
// feature keys on top of the role defaults). New code should pass
// accessFromProfile(profile), which carries the resolved capability set.

import {
  effectiveCapabilities,
  hasCapability,
  getActiveManifest,
  BUILTIN_CAPABILITY_MANIFEST,
  type Access,
  type AccessInput,
  type CapabilityManifest,
} from "@/lib/capabilities-shared";

export { effectiveCapabilities, hasCapability };
export type { Access, AccessInput };

const DATA_PREFIX = "data.";
/** Matches no source type: sent when a user may retrieve NO knowledge source (an empty list would mean "all"). */
export const NO_SOURCE_TYPES = "__none__";

/** The source-type capabilities a manifest offers ("data.<type>"). */
function sourceCapabilities(manifest: CapabilityManifest) {
  return manifest.capabilities.filter((c) => c.kind === "source_type" && c.id.startsWith(DATA_PREFIX));
}

/** The sensitive source types (raw call material) in the built-in manifest. */
export const SENSITIVE_SOURCE_TYPES: string[] = sourceCapabilities(BUILTIN_CAPABILITY_MANIFEST)
  .filter((c) => c.sensitive)
  .map((c) => c.id.slice(DATA_PREFIX.length));

/**
 * The capability an attachment kind needs (lib/attachments-shared AttachmentKind).
 * PDFs, images and audio go through the Brain's extractors; text and
 * spreadsheets are read here but fall under "Text files".
 */
export const ATTACHMENT_KIND_CAPABILITY: Readonly<Record<string, string>> = {
  pdf: "extract.pdf",
  image: "extract.image",
  audio: "extract.audio",
  text: "extract.text",
  sheet: "extract.text",
};

/** Whether this access may attach a file of `kind` (unknown kinds: no). */
export function canAttachKind(access: AccessInput, kind: string, manifest: CapabilityManifest = getActiveManifest()): boolean {
  const cap = ATTACHMENT_KIND_CAPABILITY[kind];
  return !!cap && hasCapability(access, cap, manifest);
}

/** The profile fields access resolution needs (SessionProfile satisfies it). */
export interface ProfileAccessFields {
  role: string;
  permissions?: unknown;
  /** The resolved capability ids (SessionProfile.capabilities), when available. */
  capabilities?: readonly string[] | null;
}

/**
 * The Access for a signed-in profile: its resolved capability set when present
 * (authoritative), with the stored permissions as the fallback source.
 */
export function accessFromProfile(profile: ProfileAccessFields): Access {
  const caps = profile.capabilities;
  return {
    role: profile.role,
    ...(caps && caps.length > 0 ? { features: [...caps] } : {}),
    permissions: profile.permissions ?? {},
  };
}

/** The knowledge source types this access may retrieve (from its data.* capabilities). */
export function grantedSourceTypes(access: AccessInput, manifest: CapabilityManifest = getActiveManifest()): string[] {
  const caps = new Set(effectiveCapabilities(access, manifest));
  return sourceCapabilities(manifest)
    .filter((c) => caps.has(c.id))
    .map((c) => c.id.slice(DATA_PREFIX.length));
}

/**
 * Whether this access may retrieve the sensitive call material: it holds EVERY
 * sensitive source type the manifest offers (the old "sensitive" grant). Used
 * for the Brain map's all-or-nothing `sensitive` flag.
 */
export function canAccessSensitive(access: AccessInput, manifest: CapabilityManifest = getActiveManifest()): boolean {
  const sensitive = sourceCapabilities(manifest).filter((c) => c.sensitive);
  if (sensitive.length === 0) return false;
  const caps = new Set(effectiveCapabilities(access, manifest));
  return sensitive.every((c) => caps.has(c.id));
}

/**
 * The source_types this access may retrieve, or `undefined` for "no narrowing"
 * (every source type the key allows). Passed to the Brain as `sourceTypes`.
 *   • all offered source types granted → undefined
 *   • some granted                     → exactly those (e.g. ["document"])
 *   • none granted                     → [NO_SOURCE_TYPES] (matches nothing —
 *     never [], which the Brain reads as "no restriction")
 */
export function allowedSourceTypes(access: AccessInput, manifest: CapabilityManifest = getActiveManifest()): string[] | undefined {
  const offered = sourceCapabilities(manifest);
  const granted = grantedSourceTypes(access, manifest);
  if (granted.length === offered.length) return undefined;
  return granted.length > 0 ? granted : [NO_SOURCE_TYPES];
}
