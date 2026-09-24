// Capability checks for CLIENT components: which controls to show.
//
// Browser-safe on purpose — it imports only the dependency-free
// lib/attachments-shared (never lib/access, lib/capabilities or anything that
// reaches the Brain key). The input is the user's RESOLVED capability ids
// (SessionProfile.capabilities, handed down by the (app) layout → AppChrome →
// AppShell), and the list is taken as authoritative: an id that isn't in it is
// off. This only HIDES UI; every route re-checks the capability server-side.

import { ACCEPTED_EXT, attachmentKind, type AttachmentKind } from "@/lib/attachments-shared";

/** The capability ids the chat UI gates on (see lib/capabilities-shared for the manifest). */
export const UI_CAPABILITY = {
  sourceScope: "chat.source_scope",
  compaction: "chat.compaction",
  brainMap: "knowledge.map",
  performance: "knowledge.performance",
  conflicts: "knowledge.conflicts",
  learningRead: "learning.read",
  learningWrite: "learning.write",
  deepAudit: "jobs.deep_audit",
  projects: "app.projects",
  dictation: "extract.audio",
} as const;

/**
 * The capability an attachment kind needs. Mirrors the server's
 * ATTACHMENT_KIND_CAPABILITY in lib/access (test/capabilities-client.test.ts
 * keeps the two in step): PDFs, images and audio go through the Brain's
 * extractors; text and spreadsheets are read locally but fall under "Text files".
 */
export const ATTACHMENT_KIND_CAPABILITY: Readonly<Record<AttachmentKind, string>> = {
  text: "extract.text",
  sheet: "extract.text",
  pdf: "extract.pdf",
  image: "extract.image",
  audio: "extract.audio",
};

/** Every attachment kind, in the order the composer lists them. */
const KIND_ORDER: readonly AttachmentKind[] = ["text", "sheet", "pdf", "image", "audio"];

/** Explicit MIME types added to the file picker's `accept`, per kind (extensions come from attachments-shared). */
const KIND_MIME: Readonly<Record<AttachmentKind, readonly string[]>> = {
  text: ["text/plain", "text/markdown", "text/csv", "application/json"],
  sheet: ["application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  pdf: ["application/pdf"],
  image: ["image/*"],
  audio: ["audio/*", "video/mp4", "video/webm"],
};

/** Human-readable name per kind, for hints and errors. */
const KIND_LABEL: Readonly<Record<AttachmentKind, string>> = {
  text: "TXT, MD, CSV, JSON",
  sheet: "XLSX",
  pdf: "PDF",
  image: "images",
  audio: "voice notes",
};

/** A lookup set over a resolved capability list (null/undefined → empty: nothing granted). */
export function capabilitySet(ids: Iterable<string> | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!ids) return out;
  for (const id of ids) if (typeof id === "string") out.add(id);
  return out;
}

/** The attachment kinds a capability set may attach, in composer order. */
export function grantedAttachmentKinds(caps: ReadonlySet<string>): AttachmentKind[] {
  return KIND_ORDER.filter((k) => caps.has(ATTACHMENT_KIND_CAPABILITY[k]));
}

/** Whether a file NAME is an attachable type that the given kinds allow. */
export function isAllowedAttachmentName(name: string, kinds: readonly AttachmentKind[]): boolean {
  const kind = attachmentKind(name);
  return kind !== null && kinds.includes(kind);
}

/** The file picker's `accept` attribute for the granted kinds ("" when none). */
export function acceptForKinds(kinds: readonly AttachmentKind[]): string {
  if (kinds.length === 0) return "";
  const exts = ACCEPTED_EXT.filter((ext) => {
    const k = attachmentKind(ext);
    return k !== null && kinds.includes(k);
  });
  const mimes = KIND_ORDER.filter((k) => kinds.includes(k)).flatMap((k) => KIND_MIME[k]);
  return [...exts, ...mimes].join(",");
}

/** "TXT, MD, CSV, JSON, PDF" style label for the granted kinds ("" when none). */
export function acceptedLabelForKinds(kinds: readonly AttachmentKind[]): string {
  return KIND_ORDER.filter((k) => kinds.includes(k))
    .map((k) => KIND_LABEL[k])
    .join(", ");
}
