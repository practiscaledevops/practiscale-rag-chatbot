import { describe, it, expect } from "vitest";
import { allowedModes, canUseExecutive } from "@/lib/work-modes";
import { allowedSourceTypes, canAccessSensitive } from "@/lib/access";

describe("work-mode + data access gating", () => {
  it("a normal user gets only the unrestricted modes and general knowledge", () => {
    const access = { role: "user", features: [] as string[] };
    const modes = allowedModes(access);
    expect(modes).toEqual(["general", "copywriter", "media", "sales", "strategy"]);
    expect(modes).not.toContain("ceo");
    expect(modes).not.toContain("decision_maker");
    expect(canUseExecutive(access)).toBe(false);
    expect(allowedSourceTypes(access)).toEqual(["document"]); // no call_score
    expect(canAccessSensitive(access)).toBe(false);
  });

  it("an admin gets every mode and the sensitive data", () => {
    const access = { role: "admin", features: [] as string[] };
    expect(allowedModes(access)).toContain("ceo");
    expect(allowedModes(access)).toContain("decision_maker");
    expect(canUseExecutive(access)).toBe(true);
    expect(allowedSourceTypes(access)).toBeUndefined(); // no narrowing → all
    expect(canAccessSensitive(access)).toBe(true);
  });

  it("a normal user GRANTED 'executive' can use Executive mode (but not sensitive data)", () => {
    const access = { role: "user", features: ["executive"] };
    expect(allowedModes(access)).toContain("ceo");
    expect(canUseExecutive(access)).toBe(true);
    expect(allowedModes(access)).not.toContain("decision_maker"); // not granted
    expect(allowedSourceTypes(access)).toEqual(["document"]); // sensitive not granted
  });

  it("a normal user GRANTED 'sensitive' can retrieve call_score data", () => {
    const access = { role: "user", features: ["sensitive"] };
    expect(canAccessSensitive(access)).toBe(true);
    expect(allowedSourceTypes(access)).toBeUndefined();
    expect(allowedModes(access)).not.toContain("ceo"); // executive not granted
  });

  it("grants combine", () => {
    const access = { role: "user", features: ["executive", "decisions", "sensitive"] };
    expect(allowedModes(access)).toContain("ceo");
    expect(allowedModes(access)).toContain("decision_maker");
    expect(allowedSourceTypes(access)).toBeUndefined();
  });
});
