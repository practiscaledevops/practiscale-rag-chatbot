// Pure, dependency-free helpers shared by the VoiceInput recorder component and
// its unit tests. No DOM or React here so the logic can be exercised in node —
// the component supplies the browser bits (MediaRecorder, streams, fetch).

const MB = 1024 * 1024;

/**
 * Preferred recording container/codec, best first. Opus-in-WebM is the smallest
 * and is supported by Chrome / Edge / Firefox; Safari has no WebM support and
 * falls back to mp4/aac. An empty result means "let the browser pick".
 */
export const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/mpeg",
] as const;

/** Ignore a recording shorter than this — a mis-click, not speech. */
export const MIN_RECORDING_MS = 500;
/** Auto-stop a long recording so it can't run forever (a note is shown). */
export const AUTO_STOP_MS = 5 * 60 * 1000;
/** Hard duration ceiling (defensive; the auto-stop above fires first). */
export const HARD_MAX_MS = 10 * 60 * 1000;
/**
 * The recorded upload must clear the hosting platform's ~4.5 MB request-body
 * limit (Vercel rejects bigger bodies before the handler runs). A minute or two
 * of opus audio is well under 1 MB, so a normal dictation is always fine.
 */
export const MAX_UPLOAD_BYTES = 4 * MB;

/**
 * The first candidate the running browser can actually record, or `undefined`
 * to let the browser choose its own default. `isSupported` is injectable for
 * tests; in the browser it defaults to `MediaRecorder.isTypeSupported`.
 */
export function pickRecorderMimeType(
  isSupported?: (type: string) => boolean
): string | undefined {
  const check =
    isSupported ??
    (typeof MediaRecorder !== "undefined"
      ? (t: string) => MediaRecorder.isTypeSupported(t)
      : () => false);
  for (const t of MIME_CANDIDATES) if (check(t)) return t;
  return undefined;
}

/** Whether a recorded blob is over the upload cap (too long to send). */
export function overUploadLimit(bytes: number): boolean {
  return bytes > MAX_UPLOAD_BYTES;
}

/**
 * A safe upload filename derived from the recorder's mime type. The Brain sniffs
 * the audio container from the extension, so the name must match the recorded
 * format rather than always claiming ".webm".
 */
export function fileNameForMime(mime: string | null | undefined): string {
  const base = (mime ?? "").toLowerCase().split(";")[0].trim();
  switch (base) {
    case "audio/webm":
      return "voice.webm";
    case "audio/ogg":
      return "voice.ogg";
    case "audio/mp4":
      return "voice.mp4";
    case "audio/mpeg":
      return "voice.mp3";
    case "audio/wav":
    case "audio/wave":
      return "voice.wav";
    default:
      return "voice.webm";
  }
}

/** "0:07", "1:23" elapsed-timer label from a millisecond duration. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Insert `insert` into `value` over the selection [start, end], returning the
 * new value and the caret position after the inserted text. A separating space
 * is added when joining onto existing non-space text so words don't run together.
 */
export function spliceText(
  value: string,
  insert: string,
  start: number,
  end: number
): { value: string; caret: number } {
  const s = Math.max(0, Math.min(start, value.length));
  const e = Math.max(s, Math.min(end, value.length));
  const before = value.slice(0, s);
  const after = value.slice(e);
  const needsLeadingSpace =
    before.length > 0 && !/\s$/.test(before) && !/^\s/.test(insert);
  const glue = needsLeadingSpace ? " " : "";
  const head = before + glue + insert;
  return { value: head + after, caret: head.length };
}
