import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BRAIN_MAX_ATTACHMENTS,
  CHAT_LIMIT_BOUNDS,
  DEFAULT_CHAT_LIMITS,
  MB,
  normalizeChatLimits,
  workspaceMaxBytesFor,
} from "@/lib/attachments-shared";
import { BRAIN_WINDOW_TOKENS } from "@/lib/compaction";
import { DEFAULT_SETTINGS, mergeSettings } from "@/lib/settings";

describe("DEFAULT_CHAT_LIMITS", () => {
  it("matches the contract", () => {
    expect(DEFAULT_CHAT_LIMITS).toEqual({
      contextWindowTokens: 30_000,
      compactAtPct: 80,
      autoCompact: true,
      maxImageMb: 20,
      maxFileMb: 4,
      maxFiles: 5,
    });
  });

  it("is what the browser module re-exports", async () => {
    const mod = await import("@/lib/chat-limits");
    expect(mod.DEFAULT_CHAT_LIMITS).toBe(DEFAULT_CHAT_LIMITS);
  });
});

describe("normalizeChatLimits", () => {
  it("falls back to defaults for missing / malformed input", () => {
    expect(normalizeChatLimits(undefined)).toEqual(DEFAULT_CHAT_LIMITS);
    expect(normalizeChatLimits("nope")).toEqual(DEFAULT_CHAT_LIMITS);
    expect(
      normalizeChatLimits({
        contextWindowTokens: "lots",
        compactAtPct: NaN,
        autoCompact: "yes",
        maxImageMb: null,
        maxFileMb: {},
        maxFiles: Infinity,
      })
    ).toEqual(DEFAULT_CHAT_LIMITS);
  });

  it("clamps every number into its bounds", () => {
    const low = normalizeChatLimits({
      contextWindowTokens: 5,
      compactAtPct: 1,
      maxImageMb: 0,
      maxFileMb: -3,
      maxFiles: 0,
    });
    expect(low).toMatchObject({
      contextWindowTokens: 10_000,
      compactAtPct: 50,
      maxImageMb: 1,
      maxFileMb: 1,
      maxFiles: 1,
    });
    const high = normalizeChatLimits({
      contextWindowTokens: 5_000_000,
      compactAtPct: 100,
      maxImageMb: 500,
      maxFileMb: 25,
      maxFiles: 99,
    });
    expect(high).toMatchObject({
      contextWindowTokens: 30_000, // never above what the Brain keeps
      compactAtPct: 95,
      maxImageMb: 50,
      maxFileMb: 4, // never above the hosting body cap
      maxFiles: 5, // never above the Brain's attachment cap
    });
  });

  it("rounds to whole numbers and accepts numeric strings", () => {
    expect(normalizeChatLimits({ compactAtPct: 72.6, maxFiles: "3" })).toMatchObject({
      compactAtPct: 73,
      maxFiles: 3,
    });
  });

  it("keeps an explicit autoCompact=false", () => {
    expect(normalizeChatLimits({ autoCompact: false }).autoCompact).toBe(false);
  });

  it("exposes the documented bounds", () => {
    expect(CHAT_LIMIT_BOUNDS).toEqual({
      contextWindowTokens: { min: 10_000, max: 30_000 },
      compactAtPct: { min: 50, max: 95 },
      maxImageMb: { min: 1, max: 50 },
      maxFileMb: { min: 1, max: 4 },
      maxFiles: { min: 1, max: 5 },
    });
  });

  it("stays inside the Brain's contract (attachments, model window)", () => {
    expect(CHAT_LIMIT_BOUNDS.maxFiles.max).toBeLessThanOrEqual(BRAIN_MAX_ATTACHMENTS);
    expect(CHAT_LIMIT_BOUNDS.contextWindowTokens.max).toBeLessThanOrEqual(BRAIN_WINDOW_TOKENS);
    expect(DEFAULT_CHAT_LIMITS.contextWindowTokens).toBeLessThanOrEqual(BRAIN_WINDOW_TOKENS);
  });

  it("clamps a saved 6-10 attachment limit down to the Brain's cap", () => {
    expect(normalizeChatLimits({ maxFiles: 8 }).maxFiles).toBe(BRAIN_MAX_ATTACHMENTS);
  });
});

describe("workspace settings: chat", () => {
  it("DEFAULT_SETTINGS carries the chat defaults", () => {
    expect(DEFAULT_SETTINGS.chat).toEqual(DEFAULT_CHAT_LIMITS);
  });

  it("mergeSettings fills and normalizes the chat block", () => {
    expect(mergeSettings({}).chat).toEqual(DEFAULT_CHAT_LIMITS);
    expect(mergeSettings(null).chat).toEqual(DEFAULT_CHAT_LIMITS);
    const merged = mergeSettings({
      ragDefaultOn: false,
      chat: { contextWindowTokens: 25_000, maxFileMb: 9, autoCompact: false },
    });
    expect(merged.ragDefaultOn).toBe(false);
    expect(merged.chat).toEqual({
      ...DEFAULT_CHAT_LIMITS,
      contextWindowTokens: 25_000,
      maxFileMb: 4,
      autoCompact: false,
    });
  });

  it("mergeSettings never shares the defaults object", () => {
    const a = mergeSettings(null);
    a.chat.maxFiles = 2;
    expect(mergeSettings(null).chat.maxFiles).toBe(DEFAULT_CHAT_LIMITS.maxFiles);
    expect(DEFAULT_CHAT_LIMITS.maxFiles).toBe(5);
  });
});

describe("workspaceMaxBytesFor", () => {
  it("tightens non-image files to the workspace limit", () => {
    expect(workspaceMaxBytesFor("notes.pdf", { maxFileMb: 2 })).toBe(2 * MB);
    expect(workspaceMaxBytesFor("data.csv", { maxFileMb: 1 })).toBe(1 * MB);
  });

  it("never exceeds the 4 MB hard cap", () => {
    expect(workspaceMaxBytesFor("notes.pdf", { maxFileMb: 40 })).toBe(4 * MB);
  });

  it("leaves images at the hard cap (they are optimized in the browser)", () => {
    expect(workspaceMaxBytesFor("photo.png", { maxFileMb: 1 })).toBe(4 * MB);
  });
});

describe("loadChatLimits", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("fetches once per page load and shares the result", async () => {
    vi.stubGlobal("window", {});
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ...DEFAULT_CHAT_LIMITS, maxFiles: 3, compactAtPct: 120 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { loadChatLimits } = await import("@/lib/chat-limits");
    const [a, b] = await Promise.all([loadChatLimits(), loadChatLimits()]);
    const c = await loadChatLimits();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ ...DEFAULT_CHAT_LIMITS, maxFiles: 3, compactAtPct: 95 });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it("resolves to the defaults when the request fails", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      })
    );
    const { loadChatLimits } = await import("@/lib/chat-limits");
    await expect(loadChatLimits()).resolves.toEqual(DEFAULT_CHAT_LIMITS);
  });

  it("resolves to the defaults on a non-2xx answer", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    const { loadChatLimits } = await import("@/lib/chat-limits");
    await expect(loadChatLimits()).resolves.toEqual(DEFAULT_CHAT_LIMITS);
  });

  it("does not cache a failure: the next call retries and caches the real answer", async () => {
    vi.stubGlobal("window", {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValue(
        new Response(JSON.stringify({ ...DEFAULT_CHAT_LIMITS, maxFiles: 2 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    const { loadChatLimits } = await import("@/lib/chat-limits");
    await expect(loadChatLimits()).resolves.toEqual(DEFAULT_CHAT_LIMITS);
    await expect(loadChatLimits()).resolves.toEqual(DEFAULT_CHAT_LIMITS);
    await expect(loadChatLimits()).resolves.toEqual({ ...DEFAULT_CHAT_LIMITS, maxFiles: 2 });
    // The success is cached: no further request.
    await expect(loadChatLimits()).resolves.toEqual({ ...DEFAULT_CHAT_LIMITS, maxFiles: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
