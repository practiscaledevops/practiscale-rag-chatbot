import { describe, it, expect } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  MIME_CANDIDATES,
  fileNameForMime,
  formatElapsed,
  overUploadLimit,
  pickRecorderMimeType,
  spliceText,
} from "@/lib/voice-shared";

describe("pickRecorderMimeType", () => {
  it("returns the first candidate the browser supports", () => {
    // Only mp4 is supported (Safari-like).
    const pick = pickRecorderMimeType((t) => t === "audio/mp4");
    expect(pick).toBe("audio/mp4");
  });

  it("prefers opus/webm when everything is supported", () => {
    const pick = pickRecorderMimeType(() => true);
    expect(pick).toBe(MIME_CANDIDATES[0]);
    expect(pick).toBe("audio/webm;codecs=opus");
  });

  it("returns undefined when nothing is supported (browser default)", () => {
    expect(pickRecorderMimeType(() => false)).toBeUndefined();
  });
});

describe("overUploadLimit", () => {
  it("is false at or below the cap and true above it", () => {
    expect(overUploadLimit(0)).toBe(false);
    expect(overUploadLimit(MAX_UPLOAD_BYTES)).toBe(false);
    expect(overUploadLimit(MAX_UPLOAD_BYTES + 1)).toBe(true);
  });
});

describe("fileNameForMime", () => {
  it("maps the recorder mime (ignoring codecs) to a matching extension", () => {
    expect(fileNameForMime("audio/webm;codecs=opus")).toBe("voice.webm");
    expect(fileNameForMime("audio/ogg;codecs=opus")).toBe("voice.ogg");
    expect(fileNameForMime("audio/mp4")).toBe("voice.mp4");
    expect(fileNameForMime("audio/mpeg")).toBe("voice.mp3");
    expect(fileNameForMime("audio/wav")).toBe("voice.wav");
  });

  it("falls back to voice.webm for unknown / empty types", () => {
    expect(fileNameForMime("")).toBe("voice.webm");
    expect(fileNameForMime(null)).toBe("voice.webm");
    expect(fileNameForMime("application/octet-stream")).toBe("voice.webm");
  });
});

describe("formatElapsed", () => {
  it("formats mm:ss and pads seconds", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(7_000)).toBe("0:07");
    expect(formatElapsed(83_000)).toBe("1:23");
    expect(formatElapsed(-5)).toBe("0:00");
  });
});

describe("spliceText", () => {
  it("appends to the end with a separating space", () => {
    const r = spliceText("Hello", "world", 5, 5);
    expect(r.value).toBe("Hello world");
    expect(r.caret).toBe("Hello world".length);
  });

  it("inserts into an empty field without a leading space", () => {
    const r = spliceText("", "hi there", 0, 0);
    expect(r.value).toBe("hi there");
    expect(r.caret).toBe("hi there".length);
  });

  it("replaces the current selection", () => {
    const r = spliceText("keep XXX end", "new", 5, 8);
    expect(r.value).toBe("keep new end");
    expect(r.caret).toBe("keep new".length);
  });

  it("does not double a space that is already there", () => {
    const r = spliceText("Hello ", "world", 6, 6);
    expect(r.value).toBe("Hello world");
  });

  it("clamps out-of-range selection offsets", () => {
    const r = spliceText("abc", "x", 99, 99);
    expect(r.value).toBe("abc x");
  });
});
