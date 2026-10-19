import { describe, it, expect, vi } from "vitest";
import { creativeSettingsSchema, composePromptLayers, selectDraftMemory } from "@/lib/creative";
import { loadDraftMemory } from "@/lib/creative-memory";
import { normalizeTableMarkdown } from "@/lib/table-markdown";
import type { SupabaseClient } from "@supabase/supabase-js";
describe("creative settings and private memory", () => {
  it("bounds layers and personal instructions", () => {
    expect(creativeSettingsSchema.safeParse({ targetWords: 999999 }).success).toBe(false);
    expect(composePromptLayers("Project", [{ title: "Voice", body: "Plain language" }], "Be concise")).toContain("Per-message instructions");
    expect(() => composePromptLayers("x".repeat(8001), [], "")).toThrow("8,000");
  });
  it("ranks relevant recent drafts and caps excerpts", () => {
    const result = selectDraftMemory([{ id: "irrelevant", content: "Operations" }, { id: "relevant", content: `NEMT marketing ${"x".repeat(4000)}` }], "write a NEMT marketing post");
    expect(result[0].id).toBe("relevant"); expect(result[0].content.length).toBe(2400);
  });
  it("requires an explicit owner predicate and narrows thread memory", async () => {
    const eq = vi.fn(() => q);
    const q = { select: () => q, eq, order: () => q, limit: () => q, then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve) };
    const sb = { from: () => q } as unknown as SupabaseClient;
    await loadDraftMemory(sb, "owner", "write a post", "thread", "thread");
    expect(eq).toHaveBeenCalledWith("user_id", "owner"); expect(eq).toHaveBeenCalledWith("conversation_id", "thread");
    eq.mockClear(); await loadDraftMemory(sb, "owner", "write a post", null, "off"); expect(eq).not.toHaveBeenCalled();
  });
});
describe("table repair", () => {
  it("repairs missing separators and inter-row blanks", () => {
    expect(normalizeTableMarkdown("| Consultant | Calls | Pending |\n\n| A | 7 | 2 |")).toBe("| Consultant | Calls | Pending |\n|---|---|---|\n| A | 7 | 2 |");
  });
  it("never fills missing cells or rewrites code examples", () => {
    const wrong = "| Consultant | Calls | Pending |\n| A | 7 |";
    expect(normalizeTableMarkdown(wrong)).toBe(wrong);
    const code = "```\n| A | B | C |\n| D | E | F |\n```";
    expect(normalizeTableMarkdown(code)).toBe(code);
  });
});
