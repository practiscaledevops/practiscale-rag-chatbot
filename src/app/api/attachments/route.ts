// POST /api/attachments — extract plain text from one uploaded file.
//
// The composer uploads each attached file here; we authenticate the user, cap
// the size, extract text (see lib/attachments), and return it. The browser then
// forwards the extracted text with the next chat message (POST /api/chat), which
// hands it to the Brain as data-only source material for that turn.
//
// Nothing is stored: extraction is per-message and ephemeral. The scoped Brain
// key is never touched here.

import { getSessionProfile } from "@/lib/admin";
import { extractText } from "@/lib/attachments";
import { isDemo } from "@/lib/demo/mode";
import {
  MAX_FILE_BYTES,
  MAX_FILE_MB,
  isSupportedName,
  ACCEPTED_LABEL,
  type ExtractedAttachment,
} from "@/lib/attachments-shared";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const maxDuration = 30;

export async function POST(req: Request) {
  // DEMO MODE runs with no Supabase, so there's no session to resolve — extract
  // directly (the chat route ignores the Brain in demo anyway). Outside demo, the
  // signed-in user must be resolved server-side before we read the upload.
  if (!isDemo()) {
    const profile = await getSessionProfile();
    if (!profile) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
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
  if (!isSupportedName(name)) {
    return Response.json(
      { error: `Unsupported file type. Accepted: ${ACCEPTED_LABEL}.` },
      { status: 415 }
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    return Response.json(
      { error: `File is too large (max ${MAX_FILE_MB} MB).` },
      { status: 413 }
    );
  }

  let result: ExtractedAttachment;
  try {
    const bytes = await file.arrayBuffer();
    const { text, truncated } = await extractText(name, bytes);
    if (!text.trim()) {
      return Response.json(
        { error: "Couldn't read any text from that file." },
        { status: 422 }
      );
    }
    result = { name, size: file.size, chars: text.length, truncated, text };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not read the file.";
    return Response.json({ error: msg }, { status: 422 });
  }

  return Response.json(result, { status: 200 });
}
