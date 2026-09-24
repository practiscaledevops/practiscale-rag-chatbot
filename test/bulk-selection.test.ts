import { describe, expect, it } from "vitest";
import { bulkArchiveTarget, toggleSelection } from "@/components/Sidebar";
import {
  applyBulkArchive,
  removeConversations,
  restoreConversations,
  type Conversation,
} from "@/components/AppChrome";

// Sidebar selection-mode logic and AppChrome's optimistic bulk updates.

describe("bulkArchiveTarget", () => {
  it("archives when nothing or only some of the selection is archived", () => {
    expect(bulkArchiveTarget([])).toBe(true);
    expect(bulkArchiveTarget([{ archived: false }, { archived: false }])).toBe(true);
    expect(bulkArchiveTarget([{ archived: true }, { archived: false }])).toBe(true);
    expect(bulkArchiveTarget([{}])).toBe(true);
  });

  it("unarchives when every selected chat is archived", () => {
    expect(bulkArchiveTarget([{ archived: true }])).toBe(false);
    expect(bulkArchiveTarget([{ archived: true }, { archived: true }])).toBe(false);
  });
});

describe("toggleSelection", () => {
  const order = ["a", "b", "c", "d", "e"];

  it("toggles a single id without mutating the previous set", () => {
    const prev = new Set(["a"]);
    const added = toggleSelection(prev, "b");
    expect([...added].sort()).toEqual(["a", "b"]);
    expect([...prev]).toEqual(["a"]);
    expect([...toggleSelection(added, "a")]).toEqual(["b"]);
  });

  it("selects the whole anchor→target range on shift-click, in either direction", () => {
    expect([...toggleSelection(new Set(["b"]), "d", { anchor: "b", order })].sort()).toEqual(["b", "c", "d"]);
    expect([...toggleSelection(new Set(["d"]), "b", { anchor: "d", order })].sort()).toEqual(["b", "c", "d"]);
  });

  it("clears a range when the target was selected", () => {
    const prev = new Set(order);
    expect([...toggleSelection(prev, "d", { anchor: "b", order })].sort()).toEqual(["a", "e"]);
  });

  it("falls back to a single toggle when the anchor is gone or the same row", () => {
    expect([...toggleSelection(new Set(), "c", { anchor: "zz", order })]).toEqual(["c"]);
    expect([...toggleSelection(new Set(), "c", { anchor: "c", order })]).toEqual(["c"]);
    expect([...toggleSelection(new Set(), "c", { anchor: null, order })]).toEqual(["c"]);
  });
});

function convo(id: string, over: Partial<Conversation> = {}): Conversation {
  return {
    id,
    title: id,
    pinned: false,
    project_id: null,
    model_tier: "recommended",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    archived: false,
    ...over,
  };
}

describe("AppChrome optimistic bulk updates", () => {
  const list = [
    convo("p", { pinned: true, updated_at: "2026-01-01T00:00:00.000Z" }),
    convo("x", { updated_at: "2026-01-03T00:00:00.000Z" }),
    convo("y", { updated_at: "2026-01-02T00:00:00.000Z" }),
  ];

  it("archives the listed ids and unpins them", () => {
    const next = applyBulkArchive(list, new Set(["p", "y"]), true);
    const byId = new Map(next.map((c) => [c.id, c]));
    expect(byId.get("p")).toMatchObject({ archived: true, pinned: false });
    expect(byId.get("y")).toMatchObject({ archived: true });
    expect(byId.get("x")).toMatchObject({ archived: false });
    // Re-sorted: the formerly pinned row no longer leads.
    expect(next.map((c) => c.id)).toEqual(["x", "y", "p"]);
  });

  it("unarchiving keeps pins untouched", () => {
    const archived = list.map((c) => ({ ...c, archived: true }));
    const next = applyBulkArchive(archived, new Set(["p"]), false);
    expect(next.find((c) => c.id === "p")).toMatchObject({ archived: false, pinned: true });
  });

  it("removes the listed ids", () => {
    expect(removeConversations(list, new Set(["x", "nope"])).map((c) => c.id)).toEqual(["p", "y"]);
  });

  it("restores originals after a failed archive, keeping unrelated changes", () => {
    const originals = list.filter((c) => c.id !== "x");
    const optimistic = applyBulkArchive(list, new Set(["p", "y"]), true);
    // Meanwhile "x" was renamed.
    const changed = optimistic.map((c) => (c.id === "x" ? { ...c, title: "renamed" } : c));
    const restored = restoreConversations(changed, originals);
    expect(restored.map((c) => c.id)).toEqual(["p", "x", "y"]);
    expect(restored.find((c) => c.id === "p")).toMatchObject({ pinned: true, archived: false });
    expect(restored.find((c) => c.id === "x")?.title).toBe("renamed");
  });

  it("re-inserts deleted rows after a failed delete", () => {
    const originals = list.filter((c) => c.id !== "x");
    const optimistic = removeConversations(list, new Set(originals.map((c) => c.id)));
    expect(restoreConversations(optimistic, originals).map((c) => c.id)).toEqual(["p", "x", "y"]);
  });
});
