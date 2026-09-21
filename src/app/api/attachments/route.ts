// POST /api/attachments — extract plain text from one uploaded file.
//
// The composer uploads each attached file here; we authenticate the user, cap
// the size (per type), extract text (see lib/attachments), and return it. The
// browser then forwards the extracted text with the next chat message (POST
// /api/chat), which hands it to the Brain as data-only source material for
// that turn.
//
// Text and spreadsheets are read locally. PDFs, screenshots and voice notes are
// forwarded to the Brain's /api/v1/extract (server-side, with the scoped key),
// which is why this route may run long — transcription is the slow case.
//
// Nothing is stored: extraction is per-message and ephemeral.

import { getSessionProfile } from "@/lib/admin";
import { extractAttachment } from "@/lib/attachments";
import { BrainRequestError } from "@/lib/brain";
import { rateLimit } from "@/lib/ratelimit";
import { isDemo } from "@/lib/demo/mode";
import { demoExtract } from "@/lib/demo/brain";
import {
  ACCEPTED_LABEL,
  attachmentKind,
  fileExt,
  isBrainExtractedKind,
  maxBytesFor,
  maxMbFor,
  type ExtractedAttachment,
} from "@/lib/attachments-shared";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
// Must cover the Brain's extraction timeout (120s) for a long voice note.
export const maxDuration = 120;

/** Per-user ceiling on uploads (per instance — see lib/ratelimit). */
const UPLOAD_LIMIT = { limit: 20, windowMs: 60_000 };

/** Bytes to read for the signature check (the longest signature is 12 bytes). */
const SNIFF_BYTES = 16;

/** Whether `head` carries `sig` at `offset`. */
function hasBytes(head: Uint8Array, sig: number[], offset = 0): boolean {
  if (head.length < offset + sig.length) return false;
  return sig.every((b, i) => head[offset + i] === b);
}

/**
 * Magic-byte check: does the file CONTENT match what its extension promises?
 * A renamed file (an executable called report.pdf, a zip bomb called
 * data.xlsx) is rejected before it reaches SheetJS or the Brain's extractor.
 * Only types with a fixed signature are checked; text (any bytes are "text"),
 * legacy .xls (several container formats) and audio (many containers) pass.
 */
function contentMatchesExtension(ext: string, head: Uint8Array): boolean {
  switch (ext) {
    case ".pdf":
      return hasBytes(head, [0x25, 0x50, 0x44, 0x46]); // %PDF
    case ".xlsx":
      return hasBytes(head, [0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04 (OOXML zip)
    case ".png":
      return hasBytes(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case ".jpg":
    case ".jpeg":
      return hasBytes(head, [0xff, 0xd8, 0xff]);
    case ".gif":
      return hasBytes(head, [0x47, 0x49, 0x46, 0x38]); // GIF8(7a|9a)
    case ".webp":
      // RIFF <size> WEBP
      return hasBytes(head, [0x52, 0x49, 0x46, 0x46]) && hasBytes(head, [0x57, 0x45, 0x42, 0x50], 8);
    default:
      return true;
  }
}

export async function POST(req: Request) {
  // DEMO MODE runs with no Supabase, so there's no session to resolve — extract
  // directly (the chat route ignores the Brain in demo anyway). Outside demo, the
  // signed-in user must be resolved server-side before we read the upload.
  if (!isDemo()) {
    const profile = await getSessionProfile();
    if (!profile) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const limited = rateLimit(
      `attachments:${profile.userId}`,
      UPLOAD_LIMIT.limit,
      UPLOAD_LIMIT.windowMs
    );
    if (limited) return limited;
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Expected a multipart upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "No file provided." }, { status: 400 });
  }

  const name = (file.name || "attachment").slice(0, 200);
  const kind = attachmentKind(name);
  if (!kind) {
    return Response.json(
      { error: `Unsupported file type. Accepted: ${ACCEPTED_LABEL}.` },
      { status: 415 }
    );
  }
  if (file.size > maxBytesFor(name)) {
    return Response.json(
      { error: `File is too large (max ${maxMbFor(name)} MB for this type).` },
      { status: 413 }
    );
  }

  // Sniff the leading bytes before any parser sees the file.
  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  if (!contentMatchesExtension(fileExt(name), head)) {
    return Response.json(
      { error: "File content doesn't match its extension." },
      { status: 415 }
    );
  }

  // Demo: no Brain to parse/transcribe binaries — return a canned extraction.
  if (isDemo() && isBrainExtractedKind(kind)) {
    const out = demoExtract(name, kind as "pdf" | "image" | "audio");
    const result: ExtractedAttachment = {
      name,
      size: file.size,
      chars: out.chars,
      truncated: out.truncated,
      text: out.text,
      kind,
    };
    return Response.json(result, { status: 200 });
  }

  let result: ExtractedAttachment;
  try {
    // The bounded name we validated is what the Brain sees (no File re-wrap).
    const { text, truncated } = await extractAttachment(file, name);
    if (!text.trim()) {
      return Response.json(
        { error: "Couldn't read any text from that file." },
        { status: 422 }
      );
    }
    result = { name, size: file.size, chars: text.length, truncated, text, kind };
  } catch (e) {
    // A Brain-side rejection (unsupported/too large/quota) keeps its status so
    // the chip can show the real reason; a timeout reads as "took too long".
    if (e instanceof BrainRequestError) {
      return Response.json({ error: e.message }, { status: e.status >= 500 ? 502 : e.status });
    }
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    const msg = timedOut
      ? "That file took too long to process. Try a shorter recording or a smaller file."
      : e instanceof Error
        ? e.message
        : "Could not read the file.";
    return Response.json({ error: msg }, { status: timedOut ? 504 : 422 });
  }

  return Response.json(result, { status: 200 });
}
