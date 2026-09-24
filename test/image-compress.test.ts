import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CHAT_LIMITS, MB, type ChatLimits } from "@/lib/attachments-shared";
import {
  IMAGE_MAX_EDGE,
  IMAGE_TARGET_BYTES,
  MAX_DECODE_PIXELS,
  imageDimensions,
  prepareUpload,
  rasterKind,
} from "@/lib/image-compress";

// ---------------------------------------------------------------------------
// Minimal browser stand-ins: createImageBitmap + OffscreenCanvas whose encoder
// output size is scripted per test.
// ---------------------------------------------------------------------------

interface EncodeCall {
  type: string;
  quality: number;
  w: number;
  h: number;
}

let encodes: EncodeCall[] = [];
let canvases: FakeOffscreenCanvas[] = [];
let transparent = false;
let supportsWebp = true;
let sizeFor: (type: string, quality: number, w: number, h: number) => number = () => MB;

class FakeCtx {
  imageSmoothingEnabled = false;
  imageSmoothingQuality = "low";
  fillStyle = "";
  fills = 0;
  draws: [number, number][] = [];
  fillRect() {
    this.fills++;
  }
  drawImage(_src: unknown, _x: number, _y: number, w: number, h: number) {
    this.draws.push([w, h]);
  }
  getImageData() {
    // Only the alpha bytes matter to the code under test.
    return { data: Uint8ClampedArray.from(transparent ? [0, 0, 0, 0] : [0, 0, 0, 255]) };
  }
}

class FakeOffscreenCanvas {
  ctx = new FakeCtx();
  constructor(
    public width: number,
    public height: number
  ) {
    canvases.push(this);
  }
  getContext(kind: string) {
    return kind === "2d" ? this.ctx : null;
  }
  async convertToBlob(opts: { type?: string; quality?: number } = {}) {
    const requested = opts.type ?? "image/png";
    // Like Safari: an unsupported type silently becomes PNG.
    const type = requested === "image/webp" && !supportsWebp ? "image/png" : requested;
    const quality = opts.quality ?? 0.92;
    encodes.push({ type, quality, w: this.width, h: this.height });
    return new Blob([new Uint8Array(sizeFor(type, quality, this.width, this.height))], { type });
  }
}

function stubImage(width: number, height: number) {
  const close = vi.fn();
  const create = vi.fn(async () => ({ width, height, close }));
  vi.stubGlobal("createImageBitmap", create);
  vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
  return { create, close };
}

function makeFile(name: string, type: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

const limits = (over: Partial<ChatLimits> = {}): ChatLimits => ({ ...DEFAULT_CHAT_LIMITS, ...over });

beforeEach(() => {
  encodes = [];
  canvases = [];
  transparent = false;
  supportsWebp = true;
  sizeFor = () => MB;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("rasterKind", () => {
  it("recognizes PNG / JPEG / WebP by MIME type or extension", () => {
    expect(rasterKind({ name: "a.png", type: "image/png" })).toBe("png");
    expect(rasterKind({ name: "a", type: "image/jpeg" })).toBe("jpeg");
    expect(rasterKind({ name: "a.webp", type: "" })).toBe("webp");
    expect(rasterKind({ name: "a.JPG", type: "" })).toBe("jpeg");
  });

  it("does not optimize GIF, SVG or non-images", () => {
    expect(rasterKind({ name: "a.gif", type: "image/gif" })).toBeNull();
    expect(rasterKind({ name: "a.svg", type: "image/svg+xml" })).toBeNull();
    expect(rasterKind({ name: "a.pdf", type: "application/pdf" })).toBeNull();
  });
});

describe("prepareUpload — non-images", () => {
  it("returns a file under the workspace limit untouched", async () => {
    const f = makeFile("notes.pdf", "application/pdf", 2 * MB);
    const out = await prepareUpload(f, limits());
    expect(out).toEqual({ file: f });
    expect("file" in out && out.file).toBe(f);
  });

  it("rejects a file over the workspace max file size", async () => {
    const f = makeFile("notes.pdf", "application/pdf", 3 * MB);
    const out = await prepareUpload(f, limits({ maxFileMb: 2 }));
    expect("error" in out && out.error).toMatch(/notes\.pdf.*3\.0 MB.*up to 2 MB/);
  });

  it("treats GIFs as plain files (no re-encoding)", async () => {
    const { create } = stubImage(4000, 3000);
    const small = makeFile("anim.gif", "image/gif", 3 * MB);
    expect(await prepareUpload(small, limits())).toEqual({ file: small });
    const big = makeFile("anim.gif", "image/gif", 5 * MB);
    expect("error" in (await prepareUpload(big, limits()))).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("prepareUpload — raster images", () => {
  it("rejects an image over the workspace max image size without decoding it", async () => {
    const { create } = stubImage(4000, 3000);
    const f = makeFile("huge.png", "image/png", 3 * MB);
    const out = await prepareUpload(f, limits({ maxImageMb: 2 }));
    expect("error" in out && out.error).toMatch(/huge\.png.*images can be up to 2 MB/);
    expect(create).not.toHaveBeenCalled();
  });

  it("returns a small image untouched", async () => {
    const { close } = stubImage(1200, 800);
    const f = makeFile("shot.png", "image/png", 1 * MB);
    const out = await prepareUpload(f, limits());
    expect("file" in out && out.file).toBe(f);
    expect(encodes).toHaveLength(0);
    expect(close).toHaveBeenCalled();
  });

  it("downscales an oversized opaque image to a JPEG with a longest edge of 2048", async () => {
    stubImage(4000, 3000);
    const f = makeFile("photo.png", "image/png", 1 * MB);
    const out = await prepareUpload(f, limits());
    if (!("file" in out)) throw new Error(out.error);
    expect(out.file).not.toBe(f);
    expect(out.file.name).toBe("photo.jpg");
    expect(out.file.type).toBe("image/jpeg");
    expect(canvases[0].width).toBe(IMAGE_MAX_EDGE);
    expect(canvases[0].height).toBe(1536);
    expect(encodes[0]).toMatchObject({ type: "image/jpeg", quality: 0.85 });
  });

  it("steps the quality down from 0.85 until the image fits in 3.5 MB", async () => {
    stubImage(1800, 1200);
    sizeFor = (_t, q) => (q > 0.7 ? 5 * MB : 3 * MB);
    const f = makeFile("big.jpg", "image/jpeg", 6 * MB);
    const out = await prepareUpload(f, limits());
    if (!("file" in out)) throw new Error(out.error);
    expect(encodes.map((e) => e.quality)).toEqual([0.85, 0.75, 0.65]);
    expect(out.file.size).toBeLessThanOrEqual(IMAGE_TARGET_BYTES);
    expect(out.file.name).toBe("big.jpg");
    // Not wider than the source (only the byte size needed work).
    expect(canvases[0].width).toBe(1800);
  });

  it("keeps transparency by encoding WebP", async () => {
    stubImage(3000, 1000);
    transparent = true;
    const f = makeFile("logo.png", "image/png", 5 * MB);
    const out = await prepareUpload(f, limits());
    if (!("file" in out)) throw new Error(out.error);
    expect(out.file.name).toBe("logo.webp");
    expect(out.file.type).toBe("image/webp");
    expect(canvases[0].ctx.fills).toBe(0);
  });

  it("falls back to a JPEG on white when WebP can't be encoded", async () => {
    stubImage(3000, 1000);
    transparent = true;
    supportsWebp = false;
    const f = makeFile("logo.png", "image/png", 5 * MB);
    const out = await prepareUpload(f, limits());
    if (!("file" in out)) throw new Error(out.error);
    expect(out.file.type).toBe("image/jpeg");
    expect(out.file.name).toBe("logo.jpg");
    expect(canvases[0].ctx.fills).toBeGreaterThan(0);
  });

  it("shrinks the dimensions when even the lowest quality is too big", async () => {
    stubImage(4000, 3000);
    // Fits only once the canvas is at most 1536 px wide.
    sizeFor = (_t, _q, w) => (w > 1536 ? 5 * MB : 2 * MB);
    const f = makeFile("scan.jpg", "image/jpeg", 8 * MB);
    const out = await prepareUpload(f, limits());
    if (!("file" in out)) throw new Error(out.error);
    expect(canvases.map((c) => c.width)).toEqual([2048, 1536]);
    expect(out.file.size).toBeLessThanOrEqual(IMAGE_TARGET_BYTES);
  });

  it("gives up with a friendly error when the image can't be made small enough", async () => {
    stubImage(4000, 3000);
    sizeFor = () => IMAGE_TARGET_BYTES + 1;
    const f = makeFile("noise.png", "image/png", 8 * MB);
    const out = await prepareUpload(f, limits());
    expect("error" in out && out.error).toMatch(/Couldn't shrink "noise\.png"/);
  });

  it("sends a small image as-is when the browser can't decode it", async () => {
    // Node has neither createImageBitmap nor a DOM.
    const f = makeFile("shot.webp", "image/webp", 3 * MB);
    expect(await prepareUpload(f, limits())).toEqual({ file: f });
  });

  it("errors (never throws) for a large image the browser can't decode", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        throw new Error("bad image");
      })
    );
    const f = makeFile("broken.jpg", "image/jpeg", 5 * MB);
    const out = await prepareUpload(f, limits());
    expect("error" in out && out.error).toMatch(/Couldn't read "broken\.jpg"/);
  });

  it("tolerates missing / malformed limits", async () => {
    const f = makeFile("notes.txt", "text/plain", 1024);
    const out = await prepareUpload(f, undefined as unknown as ChatLimits);
    expect(out).toEqual({ file: f });
  });
});

// ---------------------------------------------------------------------------
// Pixel ceiling: dimensions come from the header, BEFORE any decode.
// ---------------------------------------------------------------------------

/** A PNG signature + IHDR carrying w×h (the rest of the file is irrelevant). */
function pngHeader(w: number, h: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, w);
  dv.setUint32(20, h);
  return b;
}

/** SOI + an APP0 segment + SOF0 carrying w×h. */
function jpegHeader(w: number, h: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(40);
  b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]); // SOI, APP0 (length 16)
  const sof = 2 + 2 + 16; // after SOI + the APP0 segment
  b.set([0xff, 0xc0, 0x00, 0x11, 0x08], sof);
  const dv = new DataView(b.buffer);
  dv.setUint16(sof + 5, h);
  dv.setUint16(sof + 7, w);
  return b;
}

/** RIFF/WEBP with a VP8X chunk carrying w×h. */
function webpHeader(w: number, h: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(30);
  b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58]);
  const cw = w - 1;
  const ch = h - 1;
  b.set([cw & 0xff, (cw >> 8) & 0xff, (cw >> 16) & 0xff, ch & 0xff, (ch >> 8) & 0xff, (ch >> 16) & 0xff], 24);
  return b;
}

describe("imageDimensions", () => {
  it("reads PNG, JPEG and WebP (VP8X) headers", () => {
    expect(imageDimensions(pngHeader(12000, 9000))).toEqual({ w: 12000, h: 9000 });
    expect(imageDimensions(jpegHeader(4032, 3024))).toEqual({ w: 4032, h: 3024 });
    expect(imageDimensions(webpHeader(16383, 16383))).toEqual({ w: 16383, h: 16383 });
  });

  it("returns null for unknown or truncated data", () => {
    expect(imageDimensions(new Uint8Array(40))).toBeNull();
    expect(imageDimensions(pngHeader(10, 10).subarray(0, 20))).toBeNull();
    expect(imageDimensions(new Uint8Array([0xff, 0xd8, 0x00, 0x00]))).toBeNull();
  });
});

describe("prepareUpload — pixel ceiling", () => {
  it("refuses an image above MAX_DECODE_PIXELS without decoding it", async () => {
    const { create } = stubImage(12000, 9000);
    const f = new File([pngHeader(12000, 9000), new Uint8Array(2 * MB)], "scan.png", { type: "image/png" });
    const out = await prepareUpload(f, limits());
    expect(12000 * 9000).toBeGreaterThan(MAX_DECODE_PIXELS);
    expect("error" in out && out.error).toMatch(/"scan\.png" is 12000×9000 px — too large/);
    expect(create).not.toHaveBeenCalled();
  });

  it("still optimizes a large image under the ceiling", async () => {
    const { create } = stubImage(4032, 3024);
    const f = new File([jpegHeader(4032, 3024), new Uint8Array(5 * MB)], "photo.jpg", { type: "image/jpeg" });
    const out = await prepareUpload(f, limits());
    expect(create).toHaveBeenCalledTimes(1);
    expect("file" in out && out.file.name).toBe("photo.jpg");
  });
});
