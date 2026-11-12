import { afterEach, expect, it, vi } from "vitest";
import { brainChat } from "@/lib/brain";
afterEach(() => vi.unstubAllGlobals());
it("forwards Stop through the assistant-to-Brain request", async () => {
  let observed!: AbortSignal;
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => { observed = init.signal; return new Response("fixture"); }));
  const abort = new AbortController();
  await brainChat([{ role: "user", content: "fixture" }], "recommended", "general",
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, abort.signal);
  expect(observed).toBeInstanceOf(AbortSignal);
  abort.abort("user stopped");
  expect(observed.aborted).toBe(true); expect(observed.reason).toBe("user stopped");
});
