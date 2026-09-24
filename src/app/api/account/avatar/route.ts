// /api/account/avatar — the signed-in user's OWN profile picture.
//
//   GET    ?v=<epoch ms>      — the image bytes (v is only a cache-buster)
//   POST   multipart {file}   — validate + store; → { url } (new versioned URL)
//   DELETE                    — remove; → { ok: true }
//
// SECURITY
//   • The user is always the verified session user. Nothing identifies a user in
//     the URL or body, so this route can never serve or change anyone else's
//     picture. Every read/write goes through the session-bound (RLS) client —
//     profile_avatars policies confine it to user_id = auth.uid().
//   • Uploads are capped (512 KB) and sniffed by magic bytes (PNG/JPEG/WebP);
//     the SNIFFED type is stored and served, with nosniff + a locked-down CSP,
//     so a disguised HTML/SVG payload can't execute even if opened directly.
//   • Writes are rate-limited per user and refused for deactivated accounts.
//
// Before migration 0013 the table doesn't exist: GET → 404 (UI shows initials),
// POST → 503 with a message telling the admin which migration to run.

import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { getSessionProfile } from "@/lib/admin";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { rateLimit } from "@/lib/ratelimit";
import {
  AVATAR_MAX_BYTES,
  AVATAR_UNAVAILABLE_MESSAGE,
  avatarEtag,
  deleteAvatar,
  readAvatar,
  validateAvatarBytes,
  writeAvatar,
} from "@/lib/avatar";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";

/** Per-user ceiling on avatar writes (per instance — see lib/ratelimit). */
const WRITE_LIMIT = { limit: 10, windowMs: 60_000 };

/** Multipart overhead allowance on top of the image cap for the early check. */
const MAX_BODY_BYTES = AVATAR_MAX_BYTES + 64 * 1024;

const NO_STORE = { "Cache-Control": "private, no-store" };

function jsonError(error: string, status: number, headers?: Record<string, string>) {
  return NextResponse.json({ error }, { status, headers: { ...NO_STORE, ...headers } });
}

/** Reject browser requests initiated by another site (defence in depth for writes). */
function isCrossSite(req: Request): boolean {
  return req.headers.get("sec-fetch-site") === "cross-site";
}

/** Signed-in AND active (a deactivated account can't change its picture). */
async function requireActiveUser() {
  const user = await getUser();
  if (!user) return null;
  const profile = await getSessionProfile(user);
  if (!profile) return null;
  const supabase = await createSupabaseServerClient();
  return { userId: user.id, supabase };
}

// GET /api/account/avatar?v=… — the caller's own image.
export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return jsonError("Unauthorized", 401);

  const supabase = await createSupabaseServerClient();
  const res = await readAvatar(supabase, user.id);
  if (!res.ok) {
    return res.unavailable
      ? jsonError("Not found", 404)
      : jsonError(res.error, 500);
  }
  const avatar = res.avatar;
  if (!avatar) return jsonError("Not found", 404);

  // Long-lived caching only when the URL names the CURRENT version; an old or
  // missing `v` revalidates (ETag) so it never pins a stale picture.
  const v = new URL(req.url).searchParams.get("v");
  const etag = avatarEtag(avatar.bytes);
  const headers: Record<string, string> = {
    "Content-Type": avatar.mime,
    "Cache-Control":
      v !== null && v === avatar.version
        ? "private, max-age=31536000, immutable"
        : "private, no-cache",
    ETag: etag,
    Vary: "Cookie",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Disposition": "inline",
  };

  const ifNoneMatch = req.headers.get("if-none-match");
  if (ifNoneMatch && ifNoneMatch.split(",").some((t) => t.trim() === etag)) {
    return new Response(null, { status: 304, headers });
  }

  headers["Content-Length"] = String(avatar.bytes.length);
  return new Response(new Uint8Array(avatar.bytes), { status: 200, headers });
}

// POST /api/account/avatar — multipart { file }
export async function POST(req: Request) {
  if (isCrossSite(req)) return jsonError("Forbidden", 403);

  const auth = await requireActiveUser();
  if (!auth) return jsonError("Unauthorized", 401);
  const { userId, supabase } = auth;

  const limited = rateLimit(`avatar:${userId}`, WRITE_LIMIT.limit, WRITE_LIMIT.windowMs);
  if (limited) return limited;

  // Refuse an oversized body before buffering/parsing it.
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return jsonError(`Image is too large (max ${AVATAR_MAX_BYTES / 1024} KB).`, 413);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError("Expected a multipart upload.", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) return jsonError("No file provided.", 400);
  if (file.size === 0) return jsonError("The image is empty.", 400);
  if (file.size > AVATAR_MAX_BYTES) {
    return jsonError(`Image is too large (max ${AVATAR_MAX_BYTES / 1024} KB).`, 413);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = validateAvatarBytes(bytes, file.type);
  if (!check.ok) return jsonError(check.error, check.status);

  const saved = await writeAvatar(supabase, userId, bytes, check.mime);
  if (!saved.ok) {
    return saved.unavailable
      ? jsonError(AVATAR_UNAVAILABLE_MESSAGE, 503)
      : jsonError(saved.error, 500);
  }
  return NextResponse.json({ url: saved.url }, { status: 200, headers: NO_STORE });
}

// DELETE /api/account/avatar
export async function DELETE(req: Request) {
  if (isCrossSite(req)) return jsonError("Forbidden", 403);

  const auth = await requireActiveUser();
  if (!auth) return jsonError("Unauthorized", 401);
  const { userId, supabase } = auth;

  const limited = rateLimit(`avatar:${userId}`, WRITE_LIMIT.limit, WRITE_LIMIT.windowMs);
  if (limited) return limited;

  const res = await deleteAvatar(supabase, userId);
  if (!res.ok) return jsonError(res.error, 500);
  return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE });
}
