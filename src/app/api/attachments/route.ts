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
//
// Capabilities: each kind needs its "extract.*" capability (lib/access
// canAttachKind: pdf → extract.pdf, image → extract.image, audio →
// extract.audio, text/spreadsheet → extract.text); a kind the user may not
// attach is a 403 before the file is read further.
//
// Size limits: every file faces the hard 4 MB cap (the hosting body limit).
// Non-image files are further held to the workspace's "Max file size" (admin
// settings → chat.maxFileMb). Images arrive already optimized by the composer
// (lib/image-compress → prepareUpload), so they only face the hard cap here.

import { getSessionProfile } from "@/lib/admin";
import { accessFromProfile, canAttachKind, type Access } from "@/lib/access";
import { extractAttachment } from "@/lib/attachments";
import { BrainRequestError } from "@/lib/brain";
import { rateLimit } from "@/lib/ratelimit";
import { isDemo } from "@/lib/demo/mode";
import { demoExtract } from "@/lib/demo/brain";
import { loadWorkspaceSettings } from "@/lib/settings";
import { SNIFF_BYTES, contentMatchesExtension } from "@/lib/attachments-sniff";
import {
  ACCEPTED_LABEL,
  DEFAULT_CHAT_LIMITS,
  MB,
  attachmentKind,
  fileExt,
  isBrainExtractedKind,
  maxBytesFor,
  maxMbFor,
  workspaceMaxBytesFor,
  type ChatLimits,
  type ExtractedAttachment,
} from "@/lib/attachments-shared";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
// Must cover the Brain's extraction timeout (120s) for a long voice note.
export const maxDuration = 120;

/** Per-user ceiling on uploads (per instance — see lib/ratelimit). */
const UPLOAD_LIMIT = { limit: 20, windowMs: 60_000 };

export async function POST(req: Request) {
  // DEMO MODE runs with no Supabase, so there's no session to resolve — extract
  // directly (the chat route ignores the Brain in demo anyway). Outside demo, the
  // signed-in user must be resolved server-side before we read the upload.
  // `access` stays null only in demo (no session to gate on).
  let access: Access | null = null;
  if (!isDemo()) {
    const profile = await getSessionProfile();
    if (!profile) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    access = accessFromProfile(profile);
    const limited = rateLimit(
      `attachments:${profile.userId}`,
      UPLOAD_LIMIT.limit,
      UPLOAD_LIMIT.windowMs
    );
    if (limited) return limited;
  }

  // Workspace limits, read alongside the upload (never throws — defaults on any
  // failure; demo has no settings row).
  const limitsPromise: Promise<ChatLimits> = isDemo()
    ? Promise.resolve(DEFAULT_CHAT_LIMITS)
    : loadWorkspaceSettings().then(
        (s) => s.settings.chat,
        () => DEFAULT_CHAT_LIMITS
      );

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
  // The user's capability for this kind of file (extract.pdf / .image / …).
  if (access && !canAttachKind(access, kind)) {
    return Response.json({ error: "That file type isn't enabled for your account." }, { status: 403 });
  }
  if (file.size > maxBytesFor(name)) {
    return Response.json(
      { error: `File is too large (max ${maxMbFor(name)} MB for this type).` },
      { status: 413 }
    );
  }
  // The workspace's own (possibly tighter) per-file limit for non-images.
  const limits = await limitsPromise;
  const workspaceMax = workspaceMaxBytesFor(name, limits);
  if (file.size > workspaceMax) {
    return Response.json(
      { error: `File is too large (max ${Math.round(workspaceMax / MB)} MB in this workspace).` },
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
