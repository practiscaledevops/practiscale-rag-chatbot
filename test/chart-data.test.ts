import { describe, it, expect } from "vitest";
import { toNumber, isNumericColumn, hasChartableData, chartModel } from "@/lib/chart-data";

describe("toNumber", () => {
  it("parses plain, currency, percent and thousands-separated values", () => {
    expect(toNumber("42")).toBe(42);
    expect(toNumber("$1,234.5")).toBe(1234.5);
    expect(toNumber("87%")).toBe(87);
    expect(toNumber("-3.5")).toBe(-3.5);
  });

  it("returns null for non-numeric cells", () => {
    expect(toNumber("")).toBeNull();
    expect(toNumber("—")).toBeNull();
    expect(toNumber("N/A")).toBeNull();
  });
});

describe("isNumericColumn", () => {
  const rows = [
    ["Alice", "92", "n/a"],
    ["Bob", "87", "12"],
    ["Cara", "—", "8"],
  ];
  it("treats a mostly-numeric column as numeric", () => {
    expect(isNumericColumn(rows, 1)).toBe(true); // 92, 87, — → 2/2 non-empty numeric
    expect(isNumericColumn(rows, 0)).toBe(false); // names
  });
});

describe("chartModel + hasChartableData", () => {
  const headers = ["Consultant", "Score", "Calls"];
  const rows = [
    ["Alice", "92", "40"],
    ["Bob", "87", "35"],
  ];

  it("picks the text column as category and numeric columns as series", () => {
    const m = chartModel(headers, rows);
    expect(m.catCol).toBe(0);
    expect(m.valueCols).toEqual([1, 2]);
  });

  it("flags a table with numeric series as chartable", () => {
    expect(hasChartableData(headers, rows)).toBe(true);
  });

  it("is not chartable without a numeric column or without rows", () => {
    expect(hasChartableData(["Name", "Note"], [["Alice", "good"]])).toBe(false);
    expect(hasChartableData(headers, [])).toBe(false);
  });
});
