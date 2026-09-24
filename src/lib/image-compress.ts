// Browser-side upload preparation for the composer.
//
// Every upload travels as one request body to /api/attachments, and the host
// rejects bodies over ~4.5 MB before a handler runs. Phone photos and retina
// screenshots routinely exceed that, so raster images (PNG / JPEG / WebP) are
// optimized HERE before upload: downscaled so the longest edge is ≤ 2048 px and
// re-encoded until they fit in 3.5 MB. That is plenty for the Brain's OCR /
// vision extraction.
//
//   • raster images: refused above the workspace "max image size"; otherwise
//     sent as-is when already small (≤ 3.5 MB and ≤ 2048 px), else resized and
//     re-encoded — JPEG, or WebP when the image has transparency (so PNG alpha
//     survives; browsers that can't encode WebP get a JPEG on white instead);
//   • everything else (documents, audio, GIFs, SVGs): refused above the
//     workspace "max file size" (never above the 4 MB cap), else sent as-is.
//
// Client-only in practice (uses createImageBitmap + OffscreenCanvas, falling
// back to <img> + <canvas>), but import-safe anywhere: no server imports, and
// prepareUpload never throws — failures resolve to { error } with a friendly
// message the composer can show on the attachment chip.

import {
  MAX_IMAGE_BYTES,
  MB,
  fileExt,
  normalizeChatLimits,
  type ChatLimits,
} from "@/lib/attachments-shared";

/** Re-encoded images must fit comfortably under the 4 MB upload cap. */
export const IMAGE_TARGET_BYTES = 3.5 * MB;
/** Longest edge (px) an uploaded image keeps; larger images are downscaled. */
export const IMAGE_MAX_EDGE = 2048;
/** Encoder quality ladder: start high, step down until the image fits. */
export const QUALITY_STEPS = [0.85, 0.75, 0.65, 0.55, 0.45, 0.35] as const;
/** When even the lowest quality is too big, shrink dimensions by this factor… */
const SCALE_STEP = 0.75;
/** …but never below this longest edge (legibility for OCR). */
const MIN_EDGE = 640;
/**
 * Most pixels decoded for optimization. Decoding happens at full resolution
 * (4 bytes/pixel) before the downscale, and the byte cap doesn't bound pixels —
 * a 100 MP scan fits in 40 MB and decodes to ~400 MB, enough to kill a phone
 * tab. Checked from the file header, before anything is decoded.
 */
export const MAX_DECODE_PIXELS = 50_000_000;
/** Bytes read to find the dimensions (a JPEG's SOF can sit behind big EXIF/ICC segments). */
const PROBE_BYTES = 256 * 1024;

export type PrepareUploadResult = { file: File } | { error: string };

type RasterKind = "png" | "jpeg" | "webp";

/**
 * The raster kind we can optimize, from the MIME type (falling back to the
 * extension when the browser reports none). GIF (animation) and SVG (vector)
 * are deliberately NOT optimized — they're treated like any other file.
 */
export function rasterKind(file: Pick<File, "name" | "type">): RasterKind | null {
  const type = (file.type || "").toLowerCase().split(";")[0].trim();
  if (type === "image/png") return "png";
  if (type === "image/jpeg" || type === "image/jpg" || type === "image/pjpeg") return "jpeg";
  if (type === "image/webp") return "webp";
  if (type && type !== "application/octet-stream") return null;
  switch (fileExt(file.name || "")) {
    case ".png":
      return "png";
    case ".jpg":
    case ".jpeg":
      return "jpeg";
    case ".webp":
      return "webp";
    default:
      return null;
  }
}

/** "24.3" — megabytes with one decimal, for messages. */
function formatMb(bytes: number): string {
  const mb = bytes / MB;
  return mb >= 10 ? mb.toFixed(0) : mb.toFixed(1);
}

/** A file name safe to quote in a message (bounded, never empty). */
function shownName(name: string): string {
  const n = (name || "").trim() || "This file";
  return n.length > 60 ? `${n.slice(0, 57)}…` : n;
}

/** The name without its last extension, bounded for the server's 200-char cap. */
function baseName(name: string): string {
  const base = (name || "").replace(/\.[^./\\]+$/, "").trim();
  return (base || "image").slice(0, 180);
}

// ---------------------------------------------------------------------------
// Header probe (no decode)
// ---------------------------------------------------------------------------

/**
 * An image's pixel dimensions read from its header — PNG (IHDR), WebP
 * (VP8 / VP8L / VP8X) or JPEG (the first SOFn marker) — without decoding it.
 * null for anything else or a truncated header. EXIF orientation may swap
 * width and height, which doesn't change the pixel count.
 */
export function imageDimensions(bytes: Uint8Array): { w: number; h: number } | null {
  const n = bytes.length;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (from: number, to: number) => {
    let s = "";
    for (let i = from; i < to && i < n; i++) s += String.fromCharCode(bytes[i]);
    return s;
  };
  // PNG: 8-byte signature, then the IHDR chunk (width @16, height @20).
  if (n >= 24 && bytes[0] === 0x89 && ascii(1, 4) === "PNG") {
    return { w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  // WebP: RIFF <size> WEBP, then the first chunk.
  if (n >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    const chunk = ascii(12, 16);
    if (chunk === "VP8X") {
      return {
        w: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)),
        h: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)),
      };
    }
    if (chunk === "VP8 ") return { w: dv.getUint16(26, true) & 0x3fff, h: dv.getUint16(28, true) & 0x3fff };
    if (chunk === "VP8L") {
      const b = dv.getUint32(21, true);
      return { w: (b & 0x3fff) + 1, h: ((b >>> 14) & 0x3fff) + 1 };
    }
    return null;
  }
  // JPEG: walk the marker segments to the first start-of-frame.
  if (n >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let off = 2;
    while (off + 9 < n) {
      if (bytes[off] !== 0xff) return null;
      const marker = bytes[off + 1];
      if (marker === 0xff) {
        off++; // fill byte
        continue;
      }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
        off += 2; // standalone marker (no length)
        continue;
      }
      // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: dv.getUint16(off + 5), w: dv.getUint16(off + 7) };
      }
      const len = dv.getUint16(off + 2);
      if (len < 2) return null;
      off += 2 + len;
    }
  }
  return null;
}

/** imageDimensions from the file's first bytes; null when unknown or unreadable. */
async function probeDimensions(file: File): Promise<{ w: number; h: number } | null> {
  try {
    return imageDimensions(new Uint8Array(await file.slice(0, PROBE_BYTES).arrayBuffer()));
  } catch {
    return null;
  }
}

/**
 * Decodes run one at a time: the composer prepares every added file at once,
 * and several full-resolution bitmaps in memory together is what gets a phone
 * tab killed.
 */
let imageQueue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const run = imageQueue.then(task, task);
  imageQueue = run.catch(() => undefined);
  return run;
}

// ---------------------------------------------------------------------------
// Decode + draw (feature-detected; every failure resolves to null)
// ---------------------------------------------------------------------------

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

/** Decode an image file: createImageBitmap first, then an <img> element. */
async function decodeImage(file: File): Promise<Decoded | null> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file);
      if (bmp.width > 0 && bmp.height > 0) {
        return {
          source: bmp,
          width: bmp.width,
          height: bmp.height,
          close: () => {
            try {
              bmp.close();
            } catch {
              /* already closed */
            }
          },
        };
      }
    } catch {
      /* fall through to <img> */
    }
  }
  if (
    typeof document === "undefined" ||
    typeof Image === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return null;
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("decode failed"));
      img.src = url;
    });
    if (!img.naturalWidth || !img.naturalHeight) throw new Error("empty image");
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

/** The 2D-context members we use — satisfied by both canvas flavours. */
interface Ctx2D {
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: ImageSmoothingQuality;
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
  getImageData(sx: number, sy: number, sw: number, sh: number): ImageData;
}

interface Surface {
  ctx: Ctx2D;
  /** Encode the canvas; null when the browser can't produce a blob. */
  encode(type: string, quality: number): Promise<Blob | null>;
}

/** A w×h drawing surface: OffscreenCanvas when usable, else a <canvas>. */
function makeSurface(w: number, h: number): Surface | null {
  if (typeof OffscreenCanvas !== "undefined") {
    try {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext("2d") as Ctx2D | null;
      if (ctx && typeof canvas.convertToBlob === "function") {
        return {
          ctx,
          encode: (type, quality) => canvas.convertToBlob({ type, quality }).catch(() => null),
        };
      }
    } catch {
      /* fall back to a DOM canvas */
    }
  }
  if (typeof document === "undefined") return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d") as Ctx2D | null;
    if (!ctx) return null;
    return {
      ctx,
      encode: (type, quality) =>
        new Promise<Blob | null>((resolve) => {
          try {
            canvas.toBlob((b) => resolve(b), type, quality);
          } catch {
            resolve(null);
          }
        }),
    };
  } catch {
    return null;
  }
}

/** Draw the image at w×h; `flatten` paints white first (JPEG has no alpha). */
function paint(surface: Surface, img: Decoded, w: number, h: number, flatten: boolean): void {
  const { ctx } = surface;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (flatten) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(img.source, 0, 0, w, h);
}

/** Whether any pixel is not fully opaque. Unknown (tainted/failed) → true. */
function hasTransparency(ctx: Ctx2D, w: number, h: number): boolean {
  try {
    const { data } = ctx.getImageData(0, 0, w, h);
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true;
    }
    return false;
  } catch {
    return true;
  }
}

type EncodeOutcome = { blob: Blob } | "too-big" | "unsupported" | "failed";

/** Step the quality down until the encoded image fits `target` bytes. */
async function encodeUnder(surface: Surface, type: string, target: number): Promise<EncodeOutcome> {
  for (const q of QUALITY_STEPS) {
    const blob = await surface.encode(type, q);
    if (!blob) return "failed";
    // Browsers silently fall back to PNG for types they can't encode.
    if (blob.type && blob.type !== type) return "unsupported";
    if (blob.size <= target) return { blob };
  }
  return "too-big";
}

/**
 * Resize + re-encode a decoded raster image until it fits IMAGE_TARGET_BYTES.
 * Resolves to the encoded blob and its type, or null when it can't be done.
 */
async function optimize(
  img: Decoded,
  kind: RasterKind
): Promise<{ blob: Blob; type: string } | null> {
  const longest = Math.max(img.width, img.height);
  let scale = Math.min(1, IMAGE_MAX_EDGE / longest);
  let alpha: boolean | null = null;
  let webpOk = true;

  for (;;) {
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const surface = makeSurface(w, h);
    if (!surface) return null;

    paint(surface, img, w, h, false);
    // JPEG sources never carry alpha; PNG/WebP are checked once, on real pixels.
    if (alpha === null) alpha = kind !== "jpeg" && hasTransparency(surface.ctx, w, h);

    let type = "image/jpeg";
    let outcome: EncodeOutcome = "unsupported";
    if (alpha && webpOk) {
      // Transparent image: WebP keeps the alpha channel.
      type = "image/webp";
      outcome = await encodeUnder(surface, type, IMAGE_TARGET_BYTES);
      if (outcome === "unsupported") webpOk = false;
    }
    if (!alpha || !webpOk) {
      // JPEG: opaque images, or transparent ones where WebP can't be encoded
      // (flattened onto white so transparent areas don't turn black).
      type = "image/jpeg";
      if (alpha) paint(surface, img, w, h, true);
      outcome = await encodeUnder(surface, type, IMAGE_TARGET_BYTES);
    }

    if (typeof outcome === "object") return { blob: outcome.blob, type };
    if (outcome !== "too-big") return null;

    // Still too big at the lowest quality: shrink the dimensions and retry.
    const nextLongest = Math.max(w, h) * SCALE_STEP;
    if (nextLongest < MIN_EDGE) return null;
    scale *= SCALE_STEP;
  }
}

/** Decode a raster image and, when it's too big or too large, resize + re-encode it. */
async function decodeAndOptimize(file: File, kind: RasterKind, name: string): Promise<PrepareUploadResult> {
  const img = await decodeImage(file);
  if (!img) {
    // Can't decode here (old browser / odd file): send it untouched when the
    // server will still take it — it validates + extracts on its side.
    if (file.size <= MAX_IMAGE_BYTES) return { file };
    return {
      error: `Couldn't read "${name}" to shrink it for upload. Try saving it as a PNG or JPEG under 4 MB.`,
    };
  }

  try {
    const needsWork =
      file.size > IMAGE_TARGET_BYTES || Math.max(img.width, img.height) > IMAGE_MAX_EDGE;
    if (!needsWork) return { file };

    const out = await optimize(img, kind);
    if (!out) {
      if (file.size <= MAX_IMAGE_BYTES) return { file };
      return {
        error: `Couldn't shrink "${name}" enough to upload. Try a smaller or cropped image.`,
      };
    }
    const ext = out.type === "image/webp" ? ".webp" : ".jpg";
    const optimized = new File([out.blob], `${baseName(file.name)}${ext}`, {
      type: out.type,
      lastModified: Date.now(),
    });
    return { file: optimized };
  } finally {
    img.close();
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Prepare one file for POST /api/attachments under the workspace limits.
 *
 * @returns `{ file }` — the original file, or an optimized copy (new name/type)
 *          `{ error }` — a friendly, user-facing reason it can't be attached
 * Never throws.
 */
export async function prepareUpload(file: File, limits: ChatLimits): Promise<PrepareUploadResult> {
  const name = shownName(file?.name ?? "");
  try {
    const lim = normalizeChatLimits(limits);
    const kind = rasterKind(file);

    // Documents, audio, GIFs, SVGs: a plain size check, sent as-is.
    if (!kind) {
      if (file.size > lim.maxFileMb * MB) {
        return {
          error: `"${name}" is ${formatMb(file.size)} MB — files can be up to ${lim.maxFileMb} MB.`,
        };
      }
      return { file };
    }

    if (file.size > lim.maxImageMb * MB) {
      return {
        error: `"${name}" is ${formatMb(file.size)} MB — images can be up to ${lim.maxImageMb} MB. Try a smaller or cropped image.`,
      };
    }

    // The byte cap doesn't bound pixels: refuse what would be too big to decode.
    const dims = await probeDimensions(file);
    if (dims && dims.w * dims.h > MAX_DECODE_PIXELS) {
      return {
        error: `"${name}" is ${dims.w}×${dims.h} px — too large to process here. Try a smaller or cropped image.`,
      };
    }

    return await oneAtATime(() => decodeAndOptimize(file, kind, name));
  } catch {
    return { error: `Couldn't prepare "${name}" for upload. Try again, or use a smaller file.` };
  }
}
