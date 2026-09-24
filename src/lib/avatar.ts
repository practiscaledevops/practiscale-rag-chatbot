// Server-only helpers for profile pictures (table public.profile_avatars,
// migration 0013). Do not import from a client component: it uses node:crypto
// and Buffer, and every read/write expects the session-bound (RLS) Supabase
// client so a user can only ever reach their OWN row.
//
// Tolerates the table not existing yet (before migration 0013): reads report
// "no avatar" / `unavailable` instead of throwing, so pages keep rendering with
// initials and the upload route can answer a clear 503.
//
// DEMO MODE (no Supabase): avatars live in an in-memory Map keyed by the demo
// user id, hung off globalThis so the page render and the API route share it
// (Next's dev server gives route modules separate registries — see
// lib/demo/fixtures).

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isDemo } from "@/lib/demo/mode";

/** The one avatar endpoint. It always serves the SIGNED-IN user's own picture. */
export const AVATAR_ROUTE = "/api/account/avatar";

/** Max decoded image size accepted by the API (the client targets <= 480 KB). */
export const AVATAR_MAX_BYTES = 512 * 1024;

/** Mirrors the table's check constraint on the base64 `data` column. */
export const AVATAR_MAX_BASE64_CHARS = 700_000;

export const AVATAR_MIME_TYPES = ["image/webp", "image/jpeg", "image/png"] as const;
export type AvatarMime = (typeof AVATAR_MIME_TYPES)[number];

const TABLE = "profile_avatars";

/** Shown by the upload route (503) until migration 0013 has been applied. */
export const AVATAR_UNAVAILABLE_MESSAGE =
  "Profile pictures aren't enabled yet — run the one-time migration 0013_profile_avatars in Supabase, then try again.";

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** Epoch-ms version string for an updated_at value, or null when unparseable. */
export function avatarVersion(
  updatedAt: string | number | Date | null | undefined
): string | null {
  if (updatedAt === null || updatedAt === undefined || updatedAt === "") return null;
  const ms =
    typeof updatedAt === "number"
      ? updatedAt
      : updatedAt instanceof Date
        ? updatedAt.getTime()
        : Date.parse(updatedAt);
  if (!Number.isFinite(ms)) return null;
  return String(Math.trunc(ms));
}

/**
 * The versioned avatar URL ("/api/account/avatar?v=<epoch ms>"), or null.
 * `v` is only a cache-buster: the route never reads a user id from the URL.
 */
export function avatarUrlFor(
  updatedAt: string | number | Date | null | undefined
): string | null {
  const v = avatarVersion(updatedAt);
  return v === null ? null : `${AVATAR_ROUTE}?v=${v}`;
}

function startsWith(bytes: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[offset + i] !== sig[i]) return false;
  return true;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_SIG = [0xff, 0xd8, 0xff] as const;
const RIFF_SIG = [0x52, 0x49, 0x46, 0x46] as const; // "RIFF"
const WEBP_SIG = [0x57, 0x45, 0x42, 0x50] as const; // "WEBP" at offset 8

/**
 * Identify an accepted image type from its leading (magic) bytes. Anything
 * else — GIF, SVG, HTML, text, a renamed executable — is null.
 */
export function sniffImageMime(bytes: Uint8Array): AvatarMime | null {
  if (startsWith(bytes, PNG_SIG)) return "image/png";
  if (startsWith(bytes, JPEG_SIG)) return "image/jpeg";
  if (startsWith(bytes, RIFF_SIG) && startsWith(bytes, WEBP_SIG, 8)) return "image/webp";
  return null;
}

/** Lower-cased media type without parameters; image/jpg → image/jpeg. */
export function normalizeMime(type: string | null | undefined): string {
  const base = (type ?? "").split(";")[0].trim().toLowerCase();
  return base === "image/jpg" || base === "image/pjpeg" ? "image/jpeg" : base;
}

export type AvatarValidation =
  | { ok: true; mime: AvatarMime }
  | { ok: false; status: 400 | 413 | 415; error: string };

/**
 * Validate an uploaded avatar: non-empty, <= AVATAR_MAX_BYTES, a PNG/JPEG/WebP
 * by its magic bytes, and — when the upload declares a type — the declared
 * type must match what the bytes actually are. The SNIFFED type is what gets
 * stored and served.
 */
export function validateAvatarBytes(
  bytes: Uint8Array,
  claimedType?: string | null
): AvatarValidation {
  if (bytes.length === 0) {
    return { ok: false, status: 400, error: "The image is empty." };
  }
  if (bytes.length > AVATAR_MAX_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `Image is too large (max ${AVATAR_MAX_BYTES / 1024} KB).`,
    };
  }
  const sniffed = sniffImageMime(bytes);
  if (!sniffed) {
    return { ok: false, status: 415, error: "Use a PNG, JPEG or WebP image." };
  }
  const claimed = normalizeMime(claimedType);
  if (claimed && claimed !== sniffed) {
    return { ok: false, status: 415, error: "The image content doesn't match its type." };
  }
  return { ok: true, mime: sniffed };
}

/** Strong ETag derived from the image bytes. */
export function avatarEtag(bytes: Uint8Array): string {
  return `"${createHash("sha256").update(bytes).digest("base64url").slice(0, 27)}"`;
}

/** True when the error means "profile_avatars doesn't exist" (pre-0013). */
export function isMissingAvatarTable(
  err: { code?: string; message?: string } | null | undefined
): boolean {
  if (!err) return false;
  if (err.code === "42P01") return true;
  const msg = err.message ?? "";
  return (
    /profile_avatars/i.test(msg) &&
    /does not exist|could not find the table|schema cache/i.test(msg)
  );
}

function isAvatarMime(v: unknown): v is AvatarMime {
  return typeof v === "string" && (AVATAR_MIME_TYPES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Demo store
// ---------------------------------------------------------------------------

interface DemoAvatar {
  mime: AvatarMime;
  data: string; // base64
  updatedAt: string;
}

const _g = globalThis as unknown as { __demoAvatars?: Map<string, DemoAvatar> };
function demoAvatars(): Map<string, DemoAvatar> {
  if (!_g.__demoAvatars) _g.__demoAvatars = new Map();
  return _g.__demoAvatars;
}

// ---------------------------------------------------------------------------
// Data access (session-bound client; RLS confines everything to the owner)
// ---------------------------------------------------------------------------

export interface StoredAvatar {
  mime: AvatarMime;
  bytes: Buffer;
  updatedAt: string;
  /** epoch-ms string, the `v` of the current URL */
  version: string;
}

export type AvatarFailure = { ok: false; unavailable: boolean; error: string };

/**
 * The avatar URL for the (app) layout / account page: reads ONLY updated_at.
 * Null when there is no avatar, the table is missing, or anything fails —
 * never throws, so it is safe inside a page's Promise.all.
 */
export async function loadAvatarUrl(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  if (!userId) return null;
  try {
    if (isDemo()) return avatarUrlFor(demoAvatars().get(userId)?.updatedAt);
    const { data, error } = await supabase
      .from(TABLE)
      .select("updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return null;
    return avatarUrlFor((data as { updated_at?: string | null }).updated_at);
  } catch {
    return null;
  }
}

/** The user's stored avatar (bytes + type), or `avatar: null` when none. */
export async function readAvatar(
  supabase: SupabaseClient,
  userId: string
): Promise<{ ok: true; avatar: StoredAvatar | null } | AvatarFailure> {
  let row: { mime?: unknown; data?: unknown; updated_at?: unknown } | null;
  if (isDemo()) {
    const d = demoAvatars().get(userId);
    row = d ? { mime: d.mime, data: d.data, updated_at: d.updatedAt } : null;
  } else {
    const { data, error } = await supabase
      .from(TABLE)
      .select("mime, data, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      return {
        ok: false,
        unavailable: isMissingAvatarTable(error),
        error: "Could not load the profile picture.",
      };
    }
    row = data as typeof row;
  }
  if (!row) return { ok: true, avatar: null };

  const version = avatarVersion(row.updated_at as string | null | undefined);
  if (!isAvatarMime(row.mime) || typeof row.data !== "string" || version === null) {
    return { ok: true, avatar: null };
  }
  const bytes = Buffer.from(row.data, "base64");
  // Defence in depth: only ever serve bytes that are really the stored type.
  if (bytes.length === 0 || sniffImageMime(bytes) !== row.mime) {
    return { ok: true, avatar: null };
  }
  return {
    ok: true,
    avatar: { mime: row.mime, bytes, updatedAt: String(row.updated_at), version },
  };
}

/**
 * Store (insert or replace) the user's avatar. Callers validate first with
 * validateAvatarBytes; the size/type are re-checked here regardless. Returns
 * the new versioned URL.
 */
export async function writeAvatar(
  supabase: SupabaseClient,
  userId: string,
  bytes: Uint8Array,
  mime: AvatarMime
): Promise<{ ok: true; url: string } | AvatarFailure> {
  if (bytes.length === 0 || bytes.length > AVATAR_MAX_BYTES || sniffImageMime(bytes) !== mime) {
    return { ok: false, unavailable: false, error: "Invalid image." };
  }
  const data = Buffer.from(bytes).toString("base64");
  if (data.length > AVATAR_MAX_BASE64_CHARS) {
    return { ok: false, unavailable: false, error: "Image is too large." };
  }
  const now = new Date().toISOString();

  if (isDemo()) {
    demoAvatars().set(userId, { mime, data, updatedAt: now });
    return { ok: true, url: avatarUrlFor(now)! };
  }

  const { data: saved, error } = await supabase
    .from(TABLE)
    .upsert(
      { user_id: userId, mime, data, updated_at: now }, // RLS: user_id must = auth.uid()
      { onConflict: "user_id" }
    )
    .select("updated_at")
    .single();
  if (error) {
    const unavailable = isMissingAvatarTable(error);
    return {
      ok: false,
      unavailable,
      error: unavailable ? AVATAR_UNAVAILABLE_MESSAGE : "Could not save the profile picture.",
    };
  }
  const url =
    avatarUrlFor((saved as { updated_at?: string } | null)?.updated_at) ?? avatarUrlFor(now)!;
  return { ok: true, url };
}

/** Remove the user's avatar. Missing table = nothing to remove = ok. */
export async function deleteAvatar(
  supabase: SupabaseClient,
  userId: string
): Promise<{ ok: true } | AvatarFailure> {
  if (isDemo()) {
    demoAvatars().delete(userId);
    return { ok: true };
  }
  const { error } = await supabase.from(TABLE).delete().eq("user_id", userId);
  if (error) {
    if (isMissingAvatarTable(error)) return { ok: true };
    return { ok: false, unavailable: false, error: "Could not remove the profile picture." };
  }
  return { ok: true };
}
