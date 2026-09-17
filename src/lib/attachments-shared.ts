// Attachment limits + accepted types, shared by the browser (composer) and the
// server (extraction route). Kept dependency-free so importing it into a client
// component never pulls the heavy SheetJS parser into the browser bundle.

/** Max size of a single uploaded file, in bytes. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB
export const MAX_FILE_MB = MAX_FILE_BYTES / (1024 * 1024);

/** Max files attached to one message. */
export const MAX_FILES = 5;

/** Cap on extracted text per file (characters) — keeps the chat payload bounded. */
export const MAX_CHARS = 20_000;

/**
 * Accepted extensions (lower-case, with the dot). We extract PLAIN TEXT only:
 * text/markdown/csv are decoded as UTF-8, spreadsheets are flattened to CSV.
 * PDFs need a parser we don't ship yet, so they're intentionally excluded.
 */
export const ACCEPTED_EXT = [
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".tsv",
  ".log",
  ".json",
  ".xlsx",
  ".xls",
] as const;

/** `accept` attribute for the file <input> (extensions + a few explicit types). */
export const ACCEPTED_ACCEPT = [
  ...ACCEPTED_EXT,
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
].join(",");

/** Human-readable list for hints/errors, e.g. "TXT, MD, CSV, JSON, XLSX". */
export const ACCEPTED_LABEL = "TXT, MD, CSV, TSV, LOG, JSON, XLSX";

/** Lower-cased file extension (with dot), or "" if none. */
export function fileExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

/** Whether a file name looks like a type we can extract text from. */
export function isSupportedName(name: string): boolean {
  return (ACCEPTED_EXT as readonly string[]).includes(fileExt(name));
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
}
