import { describe, it, expect } from "vitest";
import { extractTables, tablesFrom, safeName, type ExportMessage } from "@/lib/export-doc";

describe("safeName", () => {
  it("slugifies a title and falls back for empty/garbage", () => {
    expect(safeName("Q4 Report: Sales!")).toBe("Q4-Report-Sales");
    expect(safeName("")).toBe("conversation");
    expect(safeName(null)).toBe("conversation");
    expect(safeName("***")).toBe("conversation");
  });
});

describe("extractTables", () => {
  it("parses a GFM table into headers + normalised rows", () => {
    const md = [
      "Here is the data:",
      "",
      "| Name | Score |",
      "| --- | --- |",
      "| Alice | 92 |",
      "| Bob | 87 |",
      "",
      "Done.",
    ].join("\n");
    const tables = extractTables(md);
    expect(tables).toHaveLength(1);
    expect(tables[0].headers).toEqual(["Name", "Score"]);
    expect(tables[0].rows).toEqual([
      ["Alice", "92"],
      ["Bob", "87"],
    ]);
  });

  it("returns nothing when there is no table", () => {
    expect(extractTables("just a sentence, no table here")).toEqual([]);
  });

  it("ignores the machine-readable options block", () => {
    const md = "Pick one:\n```options\nA\nB\n```\n";
    expect(extractTables(md)).toEqual([]);
  });
});

describe("tablesFrom", () => {
  it("collects tables only from assistant turns", () => {
    const messages: ExportMessage[] = [
      { role: "user", content: "| a | b |\n| - | - |\n| 1 | 2 |" }, // ignored (user)
      { role: "assistant", content: "| x | y |\n| - | - |\n| 3 | 4 |" },
    ];
    const tables = tablesFrom(messages);
    expect(tables).toHaveLength(1);
    expect(tables[0].headers).toEqual(["x", "y"]);
  });
});
