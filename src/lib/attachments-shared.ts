// Attachment limits + accepted types, shared by the browser (composer) and the
// server (extraction route). Kept dependency-free so importing it into a client
// component never pulls the heavy SheetJS parser into the browser bundle.
//
// It also holds the pure core of the admin-tunable CHAT LIMITS (context budget,
// compaction threshold, upload sizes). That core must be importable by BOTH
// server code (lib/settings) and the browser hook in lib/chat-limits — and
// lib/chat-limits imports React hooks, which Next forbids in the server graph —
// so the shape, defaults, bounds and normalizer live here, dependency-free.

// lib/compaction is dependency-free too (no cycle): the Brain's real window.
import { BRAIN_WINDOW_TOKENS } from "./compaction";

/** How a file is turned into text: locally (text/sheet) or by the Brain (pdf/image/audio). */
export type AttachmentKind = "text" | "sheet" | "pdf" | "image" | "audio";

/** Bytes per megabyte (binary), as used by every size limit in the app. */
export const MB = 1024 * 1024;

// Every upload travels as a request body to this app's /api/attachments (and,
// for binary kinds, on to the Brain's extractor). Vercel rejects bodies over
// ~4.5 MB before a handler runs, so promising more only yields an opaque 413.
// Bigger recordings need a storage-upload path; until then 4 MB is the truth.
/** Max size of a text / spreadsheet upload (extracted locally), in bytes. */
export const MAX_FILE_BYTES = 4 * MB;
export const MAX_FILE_MB = MAX_FILE_BYTES / MB;
/** PDFs and screenshots go to the Brain's extractor. */
export const MAX_PDF_BYTES = 4 * MB;
export const MAX_IMAGE_BYTES = 4 * MB;
/** Voice notes are transcribed by the Brain. */
export const MAX_AUDIO_BYTES = 4 * MB;

/** Max files attached to one message. */
export const MAX_FILES = 5;

/**
 * Most attachments the Brain's /api/v1/chat accepts in one request (its
 * ChatBodySchema `attachments.max(5)`; more is a 400). Project files count
 * toward it too — /api/chat folds them into one entry.
 */
export const BRAIN_MAX_ATTACHMENTS = 5;

/** Cap on extracted text per file (characters) — keeps the chat payload bounded. */
export const MAX_CHARS = 20_000;

/**
 * Accepted extensions (lower-case, with the dot) → extraction kind. Text and
 * spreadsheets are read here; PDFs, images (screenshots) and audio (voice
 * notes) are forwarded to the Brain's /api/v1/extract.
 */
const KIND_BY_EXT: Record<string, AttachmentKind> = {
  ".txt": "text",
  ".md": "text",
  ".markdown": "text",
  ".csv": "text",
  ".tsv": "text",
  ".log": "text",
  ".json": "text",
  ".xlsx": "sheet",
  ".xls": "sheet",
  ".pdf": "pdf",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".webp": "image",
  ".gif": "image",
  ".mp3": "audio",
  ".m4a": "audio",
  ".wav": "audio",
  ".mp4": "audio",
  ".webm": "audio",
  ".ogg": "audio",
};

export const ACCEPTED_EXT = Object.keys(KIND_BY_EXT) as readonly string[];

/** `accept` attribute for the file <input> (extensions + a few explicit types). */
export const ACCEPTED_ACCEPT = [
  ...ACCEPTED_EXT,
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/pdf",
  "image/*",
  "audio/*",
  "video/mp4",
  "video/webm",
].join(",");

/** Human-readable list for hints/errors. */
export const ACCEPTED_LABEL = "TXT, MD, CSV, JSON, XLSX, PDF, images, voice notes";

/** Lower-cased file extension (with dot), or "" if none. */
export function fileExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

/** The extraction kind for a file name, or null when the type isn't accepted. */
export function attachmentKind(name: string): AttachmentKind | null {
  return KIND_BY_EXT[fileExt(name)] ?? null;
}

/** Whether a file name looks like a type we can extract text from. */
export function isSupportedName(name: string): boolean {
  return attachmentKind(name) !== null;
}

/** Whether this kind is extracted by the Brain (binary) rather than locally. */
export function isBrainExtractedKind(kind: AttachmentKind | null): boolean {
  return kind === "pdf" || kind === "image" || kind === "audio";
}

/** Per-file size limit in bytes, by type (all 4 MB today — the hosting body limit; kept per-type so a storage path can raise audio/PDF later). */
export function maxBytesFor(name: string): number {
  switch (attachmentKind(name)) {
    case "pdf":
      return MAX_PDF_BYTES;
    case "image":
      return MAX_IMAGE_BYTES;
    case "audio":
      return MAX_AUDIO_BYTES;
    default:
      return MAX_FILE_BYTES;
  }
}

/** Per-file size limit in whole megabytes, for messages ("max 25 MB"). */
export function maxMbFor(name: string): number {
  return Math.round(maxBytesFor(name) / MB);
}

/** What the composer chip says while a file is being processed. */
export function statusLabelFor(name: string): string {
  switch (attachmentKind(name)) {
    case "audio":
      return "Transcribing…";
    case "pdf":
      return "Reading PDF…";
    case "image":
      return "Reading image…";
    default:
      return "Reading…";
  }
}

/** The extracted text of one attachment, as forwarded to the Brain. */
export interface ChatAttachment {
  name: string;
  text: string;
}

/** Successful response of POST /api/attachments. */
export interface ExtractedAttachment {
  name: string;
  size: number;
  chars: number;
  truncated: boolean;
  text: string;
  /** How the text was produced (text/sheet locally; pdf/image/audio via the Brain). */
  kind?: AttachmentKind;
}

// ---------------------------------------------------------------------------
// Workspace chat limits (admin-tunable; persisted in app_settings.data.chat)
// ---------------------------------------------------------------------------

/** Chat + upload limits an admin sets for the whole workspace. */
export interface ChatLimits {
  /** conversation budget (tokens) the composer meter measures against */
  contextWindowTokens: number;
  /** % of the budget at which compacting the chat is suggested */
  compactAtPct: number;
  /** compact automatically once the threshold is reached */
  autoCompact: boolean;
  /** raster images above this size (MB) are rejected; smaller ones are optimized */
  maxImageMb: number;
  /** per-file limit (MB) for non-image uploads; never above the 4 MB body cap */
  maxFileMb: number;
  /** attachments allowed on one message */
  maxFiles: number;
}

/** Code-side defaults — used until the workspace saves its own values. */
export const DEFAULT_CHAT_LIMITS: ChatLimits = {
  // The Brain keeps ~30k tokens (120k chars) per turn — see lib/compaction.
  contextWindowTokens: BRAIN_WINDOW_TOKENS,
  compactAtPct: 80,
  autoCompact: true,
  maxImageMb: 20,
  maxFileMb: 4,
  maxFiles: 5,
};

/** Inclusive bounds for every numeric chat limit. */
export const CHAT_LIMIT_BOUNDS = {
  // Never above what the Brain actually keeps for the model (a bigger budget
  // would only let the Brain drop turns silently before compaction runs).
  contextWindowTokens: { min: 10_000, max: BRAIN_WINDOW_TOKENS },
  compactAtPct: { min: 50, max: 95 },
  maxImageMb: { min: 1, max: 50 },
  // The hosting platform rejects request bodies over ~4.5 MB before a handler
  // runs, so a per-file limit above 4 MB could never be honoured.
  maxFileMb: { min: 1, max: MAX_FILE_MB },
  // The Brain rejects more than BRAIN_MAX_ATTACHMENTS per request.
  maxFiles: { min: 1, max: BRAIN_MAX_ATTACHMENTS },
} as const satisfies Record<
  Exclude<keyof ChatLimits, "autoCompact">,
  { min: number; max: number }
>;

/** A whole number clamped into [min, max]; `fallback` when not a finite number. */
function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Coerce an untrusted blob (a jsonb column, an API response) into valid
 * ChatLimits: every field falls back to its default when missing/malformed and
 * numbers are rounded and clamped into CHAT_LIMIT_BOUNDS. Never throws.
 */
export function normalizeChatLimits(raw: unknown): ChatLimits {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_CHAT_LIMITS;
  const b = CHAT_LIMIT_BOUNDS;
  return {
    contextWindowTokens: clampInt(
      r.contextWindowTokens,
      b.contextWindowTokens.min,
      b.contextWindowTokens.max,
      d.contextWindowTokens
    ),
    compactAtPct: clampInt(r.compactAtPct, b.compactAtPct.min, b.compactAtPct.max, d.compactAtPct),
    autoCompact: typeof r.autoCompact === "boolean" ? r.autoCompact : d.autoCompact,
    maxImageMb: clampInt(r.maxImageMb, b.maxImageMb.min, b.maxImageMb.max, d.maxImageMb),
    maxFileMb: clampInt(r.maxFileMb, b.maxFileMb.min, b.maxFileMb.max, d.maxFileMb),
    maxFiles: clampInt(r.maxFiles, b.maxFiles.min, b.maxFiles.max, d.maxFiles),
  };
}

/**
 * The effective per-file byte limit for an upload under the workspace limits:
 * the hard per-type cap (the 4 MB body limit), tightened by the workspace
 * `maxFileMb` for NON-image files. Images are optimized in the browser (see
 * lib/image-compress) and only face the hard cap here.
 */
export function workspaceMaxBytesFor(name: string, limits: Pick<ChatLimits, "maxFileMb">): number {
  const hard = maxBytesFor(name);
  if (attachmentKind(name) === "image") return hard;
  const mb = clampInt(limits.maxFileMb, CHAT_LIMIT_BOUNDS.maxFileMb.min, CHAT_LIMIT_BOUNDS.maxFileMb.max, MAX_FILE_MB);
  return Math.min(hard, mb * MB);
}
