import { describe, it, expect } from "vitest";
import {
  AVATAR_MAX_BASE64_CHARS,
  AVATAR_MAX_BYTES,
  AVATAR_ROUTE,
  avatarEtag,
  avatarUrlFor,
  avatarVersion,
  isMissingAvatarTable,
  normalizeMime,
  sniffImageMime,
  validateAvatarBytes,
} from "@/lib/avatar";
import { avatarInitials } from "@/lib/avatar-client";

const bytes = (...b: number[]) => new Uint8Array(b);
const ascii = (s: string) => new TextEncoder().encode(s);
/** A buffer of `size` bytes that starts with `head`. */
function padded(head: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size);
  out.set(head.subarray(0, Math.min(head.length, size)));
  return out;
}

const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46);
const WEBP = (() => {
  const b = new Uint8Array(16);
  b.set(ascii("RIFF"), 0);
  b.set([0x24, 0, 0, 0], 4); // chunk size (ignored)
  b.set(ascii("WEBP"), 8);
  b.set(ascii("VP8 "), 12);
  return b;
})();
const GIF = ascii("GIF89a\x01\x00\x01\x00");
const SVG = ascii('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML = ascii("<!doctype html><html><body><script>alert(1)</script></body></html>");
const TEXT = ascii("just some text, definitely not an image");

describe("sniffImageMime", () => {
  it("recognises PNG, JPEG and WebP by magic bytes", () => {
    expect(sniffImageMime(PNG)).toBe("image/png");
    expect(sniffImageMime(JPEG)).toBe("image/jpeg");
    expect(sniffImageMime(WEBP)).toBe("image/webp");
  });

  it("rejects GIF, SVG, HTML, text and empty input", () => {
    expect(sniffImageMime(GIF)).toBeNull();
    expect(sniffImageMime(SVG)).toBeNull();
    expect(sniffImageMime(HTML)).toBeNull();
    expect(sniffImageMime(TEXT)).toBeNull();
    expect(sniffImageMime(new Uint8Array(0))).toBeNull();
  });

  it("needs the full signature (truncated / partial headers fail)", () => {
    expect(sniffImageMime(PNG.subarray(0, 4))).toBeNull(); // only \x89PNG
    expect(sniffImageMime(bytes(0xff, 0xd8))).toBeNull();
    // RIFF container that is not WebP (e.g. WAV/AVI).
    const wav = new Uint8Array(WEBP);
    wav.set(ascii("WAVE"), 8);
    expect(sniffImageMime(wav)).toBeNull();
    expect(sniffImageMime(WEBP.subarray(0, 10))).toBeNull();
  });
});

describe("normalizeMime", () => {
  it("lower-cases, strips parameters and aliases image/jpg", () => {
    expect(normalizeMime("IMAGE/PNG")).toBe("image/png");
    expect(normalizeMime("image/webp; charset=binary")).toBe("image/webp");
    expect(normalizeMime("image/jpg")).toBe("image/jpeg");
    expect(normalizeMime("")).toBe("");
    expect(normalizeMime(null)).toBe("");
  });
});

describe("validateAvatarBytes", () => {
  it("accepts each allowed type, with or without a matching declared type", () => {
    expect(validateAvatarBytes(PNG, "image/png")).toEqual({ ok: true, mime: "image/png" });
    expect(validateAvatarBytes(JPEG, "image/jpeg")).toEqual({ ok: true, mime: "image/jpeg" });
    expect(validateAvatarBytes(JPEG, "image/jpg")).toEqual({ ok: true, mime: "image/jpeg" });
    expect(validateAvatarBytes(WEBP, "image/webp")).toEqual({ ok: true, mime: "image/webp" });
    expect(validateAvatarBytes(WEBP, "")).toEqual({ ok: true, mime: "image/webp" });
    expect(validateAvatarBytes(PNG)).toEqual({ ok: true, mime: "image/png" });
  });

  it("rejects non-images with 415", () => {
    for (const [data, type] of [
      [GIF, "image/gif"],
      [SVG, "image/svg+xml"],
      [HTML, "text/html"],
      [TEXT, "text/plain"],
    ] as const) {
      const r = validateAvatarBytes(data, type);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(415);
    }
  });

  it("rejects a disguised file whose bytes don't match its declared type", () => {
    // HTML/SVG claiming to be an image.
    expect(validateAvatarBytes(HTML, "image/png")).toMatchObject({ ok: false, status: 415 });
    expect(validateAvatarBytes(SVG, "image/webp")).toMatchObject({ ok: false, status: 415 });
    // A real image under the wrong (allowed) type.
    expect(validateAvatarBytes(PNG, "image/jpeg")).toMatchObject({ ok: false, status: 415 });
    expect(validateAvatarBytes(JPEG, "image/webp")).toMatchObject({ ok: false, status: 415 });
    expect(validateAvatarBytes(WEBP, "text/html")).toMatchObject({ ok: false, status: 415 });
  });

  it("enforces the 512 KB cap (413) and rejects empty input (400)", () => {
    expect(AVATAR_MAX_BYTES).toBe(512 * 1024);
    expect(validateAvatarBytes(padded(PNG, AVATAR_MAX_BYTES), "image/png")).toEqual({
      ok: true,
      mime: "image/png",
    });
    expect(validateAvatarBytes(padded(PNG, AVATAR_MAX_BYTES + 1), "image/png")).toMatchObject({
      ok: false,
      status: 413,
    });
    expect(validateAvatarBytes(new Uint8Array(0), "image/png")).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("keeps the max upload within the table's base64 check constraint", () => {
    expect(Math.ceil(AVATAR_MAX_BYTES / 3) * 4).toBeLessThanOrEqual(AVATAR_MAX_BASE64_CHARS);
    expect(AVATAR_MAX_BASE64_CHARS).toBe(700_000);
  });
});

describe("avatar URL builder", () => {
  it("builds a versioned URL from an ISO / Postgres timestamp", () => {
    const iso = "2026-09-25T10:11:12.123Z";
    expect(avatarUrlFor(iso)).toBe(`${AVATAR_ROUTE}?v=${Date.parse(iso)}`);
    // Postgres microsecond precision truncates to the same millisecond.
    expect(avatarUrlFor("2026-09-25T10:11:12.123456+00:00")).toBe(avatarUrlFor(iso));
    expect(avatarVersion("2026-09-25T10:11:12.123456+00:00")).toBe(String(Date.parse(iso)));
  });

  it("accepts epoch ms and Date", () => {
    expect(avatarUrlFor(1790331072123)).toBe("/api/account/avatar?v=1790331072123");
    expect(avatarUrlFor(new Date(1790331072123))).toBe("/api/account/avatar?v=1790331072123");
  });

  it("never carries a user id — only the v cache-buster", () => {
    const url = avatarUrlFor("2026-09-25T10:11:12.123Z")!;
    const parsed = new URL(url, "http://x");
    expect(parsed.pathname).toBe("/api/account/avatar");
    expect([...parsed.searchParams.keys()]).toEqual(["v"]);
  });

  it("returns null for missing or unparseable timestamps", () => {
    expect(avatarUrlFor(null)).toBeNull();
    expect(avatarUrlFor(undefined)).toBeNull();
    expect(avatarUrlFor("")).toBeNull();
    expect(avatarUrlFor("not a date")).toBeNull();
    expect(avatarUrlFor(Number.NaN)).toBeNull();
  });
});

describe("avatarEtag", () => {
  it("is a stable quoted tag that changes with the bytes", () => {
    const a = avatarEtag(PNG);
    expect(a).toMatch(/^"[A-Za-z0-9_-]{27}"$/);
    expect(avatarEtag(new Uint8Array(PNG))).toBe(a);
    expect(avatarEtag(JPEG)).not.toBe(a);
  });
});

describe("isMissingAvatarTable", () => {
  it("detects the pre-migration errors only", () => {
    expect(isMissingAvatarTable({ code: "42P01", message: 'relation "public.profile_avatars" does not exist' })).toBe(true);
    expect(
      isMissingAvatarTable({
        code: "PGRST205",
        message: "Could not find the table 'public.profile_avatars' in the schema cache",
      })
    ).toBe(true);
    expect(isMissingAvatarTable({ code: "42501", message: "permission denied for table profile_avatars" })).toBe(false);
    expect(isMissingAvatarTable(null)).toBe(false);
  });
});

describe("avatarInitials", () => {
  it("uses the first letters of two words, else the first two characters", () => {
    expect(avatarInitials("Ada Lovelace")).toBe("AL");
    expect(avatarInitials("cher")).toBe("CH");
    expect(avatarInitials("", "sam.jones@example.com")).toBe("SA");
    expect(avatarInitials("  ", null)).toBe("?");
  });
});
