// POST /api/voice — transcribe a recorded voice note into text for the composer.
//
// The composer's mic records in the browser and POSTs the audio here; we
// authenticate the user, cap the size, and forward the file to the Brain's
// /api/v1/extract (server-side, with the scoped key), which transcribes it. The
// transcript is returned as { text } and the browser inserts it into the input.
//
// Nothing is stored: transcription is per-request and ephemeral. We never log
// the audio or the transcript. Needs the "extract.audio" capability.

import { getSessionProfile } from "@/lib/admin";
import { accessFromProfile, hasCapability } from "@/lib/access";
import { brainExtract, BrainRequestError } from "@/lib/brain";
import { rateLimit } from "@/lib/ratelimit";
import { isDemo } from "@/lib/demo/mode";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
// Must cover the Brain's transcription time for a couple of minutes of audio.
export const maxDuration = 120;

const MB = 1024 * 1024;
/** Logical ceiling (the platform rejects bodies over ~4.5 MB first). */
const MAX_VOICE_BYTES = 25 * MB;
/** Per-user ceiling on transcriptions (per instance — see lib/ratelimit). */
const VOICE_LIMIT = { limit: 20, windowMs: 60_000 };

export async function POST(req: Request) {
  // DEMO MODE runs with no Supabase / Brain — bypass auth (as elsewhere) and
  // return a canned transcript so the mic is clickable in a click-through demo.
  if (isDemo()) {
    return Response.json({ text: "[demo] transcribed voice note" }, { status: 200 });
  }

  const profile = await getSessionProfile();
  if (!profile) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasCapability(accessFromProfile(profile), "extract.audio")) {
    return Response.json({ error: "Voice input isn't enabled for your account." }, { status: 403 });
  }
  const limited = rateLimit(`voice:${profile.userId}`, VOICE_LIMIT.limit, VOICE_LIMIT.windowMs);
  if (limited) return limited;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Expected a multipart upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "No audio provided." }, { status: 400 });
  }
  if (file.size === 0) {
    return Response.json({ error: "The recording was empty." }, { status: 400 });
  }
  if (file.size > MAX_VOICE_BYTES) {
    return Response.json(
      { error: "Recording too long — keep dictation under a few minutes." },
      { status: 413 }
    );
  }

  const name = (file.name || "voice.webm").slice(0, 200);

  try {
    // The Brain transcribes the audio (audio kind → /api/v1/extract). Its text
    // is DATA, never instructions — it flows into the composer for the user to
    // review before sending.
    const { text } = await brainExtract(file, name);
    if (!text?.trim()) {
      return Response.json({ error: "No speech detected in the recording." }, { status: 422 });
    }
    return Response.json({ text }, { status: 200 });
  } catch (e) {
    // A Brain-side rejection (no key / unsupported / too large / quota) keeps its
    // status so the mic can show the real reason; a timeout reads as "took too long".
    if (e instanceof BrainRequestError) {
      return Response.json({ error: e.message }, { status: e.status >= 500 ? 502 : e.status });
    }
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    const msg = timedOut
      ? "That recording took too long to transcribe. Try a shorter one."
      : e instanceof Error
        ? e.message
        : "Could not transcribe the recording.";
    return Response.json({ error: msg }, { status: timedOut ? 504 : 502 });
  }
}
