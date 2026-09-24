// Client-side profile-picture helpers: crop/encode in the browser, call
// /api/account/avatar, and a tiny module-level store so every <UserAvatar> on
// the page updates the instant a picture is uploaded or removed (no reload).
//
// Browser-safe: no server imports. The store is only ever WRITTEN from event
// handlers in the browser; on the server useAvatarUrl always returns the
// `initial` prop, so nothing leaks between requests.

import { useSyncExternalStore } from "react";

const AVATAR_ROUTE = "/api/account/avatar";

/** Encoded avatars aim under this so they clear the server's 512 KB cap. */
export const AVATAR_TARGET_BYTES = 480 * 1024;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface Snapshot {
  /** false until setAvatarUrl is first called (then the store is authoritative) */
  set: boolean;
  url: string | null;
}

const UNSET: Snapshot = { set: false, url: null };
let snapshot: Snapshot = UNSET;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => snapshot;
const getServerSnapshot = () => UNSET;

/** Publish the signed-in user's new avatar URL (null = removed) to every consumer. */
export function setAvatarUrl(url: string | null): void {
  snapshot = { set: true, url };
  emit();
}

/**
 * Forget any published value so consumers fall back to their `initial` prop
 * again. Call on sign-out: the app signs in/out with soft navigation, so the
 * module state would otherwise outlive the session.
 */
export function resetAvatarUrl(): void {
  if (snapshot === UNSET) return;
  snapshot = UNSET;
  emit();
}

/**
 * The current avatar URL: `initial` (server-rendered value) until someone calls
 * setAvatarUrl, then the latest published value.
 */
export function useAvatarUrl(initial: string | null | undefined): string | null {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return snap.set ? snap.url : (initial ?? null);
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

async function errorFrom(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body?.error === "string" && body.error) return body.error;
  } catch {
    /* not JSON */
  }
  if (res.status === 413) return "That image is too large.";
  if (res.status === 429) return "Too many changes. Try again in a minute.";
  return fallback;
}

/** Upload an (already cropped) avatar; on success publishes the new URL. */
export async function uploadAvatar(blob: Blob): Promise<{ url: string } | { error: string }> {
  const ext = blob.type === "image/png" ? "png" : blob.type === "image/jpeg" ? "jpg" : "webp";
  const form = new FormData();
  form.append("file", blob, `avatar.${ext}`);
  try {
    const res = await fetch(AVATAR_ROUTE, { method: "POST", body: form });
    if (!res.ok) return { error: await errorFrom(res, "Couldn't save your picture.") };
    const body = (await res.json()) as { url?: unknown };
    if (typeof body?.url !== "string") return { error: "Couldn't save your picture." };
    setAvatarUrl(body.url);
    return { url: body.url };
  } catch {
    return { error: "Network error — check your connection and try again." };
  }
}

/** Remove the avatar; on success publishes null (everyone falls back to initials). */
export async function removeAvatar(): Promise<{ ok: true } | { error: string }> {
  try {
    const res = await fetch(AVATAR_ROUTE, { method: "DELETE" });
    if (!res.ok) return { error: await errorFrom(res, "Couldn't remove your picture.") };
    setAvatarUrl(null);
    return { ok: true };
  } catch {
    return { error: "Network error — check your connection and try again." };
  }
}

// ---------------------------------------------------------------------------
// Crop + encode
// ---------------------------------------------------------------------------

/** Two-letter initials from a display name, else the email's local part. */
export function avatarInitials(name: string, email?: string | null): string {
  const source = name.trim() || email?.split("@")[0]?.trim() || "?";
  const parts = source.split(/\s+/).filter(Boolean);
  const chars =
    parts.length >= 2
      ? (Array.from(parts[0])[0] ?? "") + (Array.from(parts[1])[0] ?? "")
      : Array.from(source).slice(0, 2).join("");
  return chars.toUpperCase() || "?";
}

/**
 * Decode through an <img> (not createImageBitmap) so EXIF orientation and the
 * pixel dimensions match exactly what the editor displayed.
 */
function loadImage(source: Blob): Promise<{ img: HTMLImageElement; revoke: () => void }> {
  const url = URL.createObjectURL(source);
  const img = new Image();
  img.decoding = "async";
  const revoke = () => URL.revokeObjectURL(url);
  return new Promise((resolve, reject) => {
    img.onload = () => resolve({ img, revoke });
    img.onerror = () => {
      revoke();
      reject(new Error("Couldn't read that image."));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Crop the square `crop` (in SOURCE pixels) out of `source`, scale it to
 * `outputPx`², and encode WebP — or JPEG where the browser can't encode WebP —
 * stepping quality down from 0.9 until it fits AVATAR_TARGET_BYTES.
 */
export async function cropToAvatar(
  source: Blob,
  crop: { x: number; y: number; size: number },
  outputPx = 384
): Promise<Blob> {
  const { img, revoke } = await loadImage(source);
  try {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) throw new Error("Couldn't read that image.");

    // Clamp the crop square inside the image.
    const size = Math.max(1, Math.min(crop.size, w, h));
    const x = Math.min(Math.max(0, crop.x), w - size);
    const y = Math.min(Math.max(0, crop.y), h - size);
    const out = Math.max(16, Math.round(outputPx));

    const canvas = document.createElement("canvas");
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Your browser can't process images here.");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const draw = (opaque: boolean) => {
      ctx.clearRect(0, 0, out, out);
      if (opaque) {
        // JPEG has no alpha: flatten transparent pixels onto white, not black.
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, out, out);
      }
      ctx.drawImage(img, x, y, size, size, 0, 0, out, out);
    };

    draw(false);
    let type = "image/webp";
    let quality = 0.9;
    let blob = await canvasToBlob(canvas, type, quality);
    if (!blob || blob.type !== "image/webp") {
      // No WebP encoder (older Safari returns PNG instead) → JPEG.
      type = "image/jpeg";
      draw(true);
      blob = await canvasToBlob(canvas, type, quality);
    }
    if (!blob) throw new Error("Couldn't encode the image.");

    while (blob.size > AVATAR_TARGET_BYTES && quality > 0.35) {
      quality = Math.round((quality - 0.1) * 100) / 100;
      const next = await canvasToBlob(canvas, type, quality);
      if (!next) break;
      blob = next;
    }
    return blob;
  } finally {
    revoke();
  }
}
