// Attachment limits + accepted types, shared by the browser (composer) and the
// server (extraction route). Kept dependency-free so importing it into a client
// component never pulls the heavy SheetJS parser into the browser bundle.

/** How a file is turned into text: locally (text/sheet) or by the Brain (pdf/image/audio). */
export type AttachmentKind = "text" | "sheet" | "pdf" | "image" | "audio";

const MB = 1024 * 1024;

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
