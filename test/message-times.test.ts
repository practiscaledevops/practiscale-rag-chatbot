import { describe, it, expect } from "vitest";
import { isoOrUndefined, rowTimestamps } from "@/lib/message-times";

const NOW = Date.parse("2026-09-25T12:00:00.000Z");

describe("isoOrUndefined", () => {
  it("normalises dates and ISO strings, rejects junk", () => {
    expect(isoOrUndefined(new Date("2026-09-24T10:00:00Z"))).toBe("2026-09-24T10:00:00.000Z");
    expect(isoOrUndefined("2026-09-24T10:00:00+05:00")).toBe("2026-09-24T05:00:00.000Z");
    expect(isoOrUndefined("yesterday")).toBeUndefined();
    expect(isoOrUndefined(12345)).toBeUndefined();
    expect(isoOrUndefined("x".repeat(65))).toBeUndefined();
    expect(isoOrUndefined(new Date("nope"))).toBeUndefined();
  });
});

describe("rowTimestamps", () => {
  it("keeps each message's own send time", () => {
    const times = rowTimestamps(
      [{ createdAt: "2026-09-24T09:00:00Z" }, { createdAt: "2026-09-24T09:00:05Z" }],
      NOW
    );
    expect(times).toEqual(["2026-09-24T09:00:00.000Z", "2026-09-24T09:00:05.000Z"]);
  });

  it("forces strictly increasing times (thread order wins)", () => {
    const times = rowTimestamps(
      [{ createdAt: "2026-09-24T09:00:00Z" }, { createdAt: "2026-09-24T09:00:00Z" }, { createdAt: "2026-09-24T08:00:00Z" }],
      NOW
    );
    const ms = times.map((t) => Date.parse(t));
    expect(ms[1]).toBeGreaterThan(ms[0]);
    expect(ms[2]).toBeGreaterThan(ms[1]);
  });

  it("places unknown times at the end, never in the future", () => {
    const times = rowTimestamps([{ createdAt: "2026-09-24T09:00:00Z" }, {}, {}], NOW);
    const ms = times.map((t) => Date.parse(t));
    expect(ms[0]).toBe(Date.parse("2026-09-24T09:00:00Z"));
    expect(ms[1]).toBeLessThan(NOW);
    expect(ms[2]).toBeGreaterThan(ms[1]);
    expect(rowTimestamps([{ createdAt: "2030-01-01T00:00:00Z" }], NOW)).toEqual([new Date(NOW).toISOString()]);
  });

  it("orders a thread with no known times", () => {
    const ms = rowTimestamps([{}, {}, {}], NOW).map((t) => Date.parse(t));
    expect(ms[0]).toBeLessThan(ms[1]);
    expect(ms[1]).toBeLessThan(ms[2]);
  });
});
