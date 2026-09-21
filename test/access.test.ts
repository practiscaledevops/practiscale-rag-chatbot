import { describe, it, expect } from "vitest";
import { allowedModes, canUseExecutive, normalizeMode, resolveMode, WORK_MODES } from "@/lib/work-modes";
import { allowedSourceTypes, canAccessSensitive } from "@/lib/access";

// The expert registry: restricted modes are the private executive experts
// (ceo_advisor, ceo_content) and the Decision Memo; everything else is open.
const OPEN_MODES = WORK_MODES.filter((m) => !m.restricted).map((m) => m.id);
const RESTRICTED_MODES = WORK_MODES.filter((m) => m.restricted).map((m) => m.id);

describe("work-mode + data access gating", () => {
  it("the registry gates exactly the executive experts and the decision memo", () => {
    expect(RESTRICTED_MODES.sort()).toEqual(["ceo_advisor", "ceo_content", "decision_memo"]);
    expect(OPEN_MODES).toContain("auto");
    expect(OPEN_MODES).toContain("general");
    expect(OPEN_MODES).toContain("sales_coach");
    expect(OPEN_MODES).toContain("training_builder");
  });

  it("a normal user gets only the unrestricted modes and general knowledge", () => {
    const access = { role: "user", features: [] as string[] };
    const modes = allowedModes(access);
    expect(modes).toEqual(OPEN_MODES);
    for (const m of RESTRICTED_MODES) expect(modes).not.toContain(m);
    expect(canUseExecutive(access)).toBe(false);
    expect(allowedSourceTypes(access)).toEqual(["document"]); // no call_score
    expect(canAccessSensitive(access)).toBe(false);
  });

  it("an admin gets every mode and the sensitive data", () => {
    const access = { role: "admin", features: [] as string[] };
    expect(allowedModes(access)).toEqual(WORK_MODES.map((m) => m.id));
    expect(canUseExecutive(access)).toBe(true);
    expect(allowedSourceTypes(access)).toBeUndefined(); // no narrowing → all
    expect(canAccessSensitive(access)).toBe(true);
  });

  it("a normal user GRANTED 'executive' can use the executive experts (but not sensitive data)", () => {
    const access = { role: "user", features: ["executive"] };
    expect(allowedModes(access)).toContain("ceo_advisor");
    expect(allowedModes(access)).toContain("ceo_content");
    expect(canUseExecutive(access)).toBe(true);
    expect(allowedModes(access)).not.toContain("decision_memo"); // not granted
    expect(allowedSourceTypes(access)).toEqual(["document"]); // sensitive not granted
  });

  it("a normal user GRANTED 'sensitive' can retrieve call_score data", () => {
    const access = { role: "user", features: ["sensitive"] };
    expect(canAccessSensitive(access)).toBe(true);
    expect(allowedSourceTypes(access)).toBeUndefined();
    expect(allowedModes(access)).not.toContain("ceo_advisor"); // executive not granted
  });

  it("grants combine", () => {
    const access = { role: "user", features: ["executive", "decisions", "sensitive"] };
    expect(allowedModes(access)).toContain("ceo_advisor");
    expect(allowedModes(access)).toContain("decision_memo");
    expect(allowedSourceTypes(access)).toBeUndefined();
  });

  it("legacy ids resolve to the new experts and restricted requests downgrade to Auto", () => {
    expect(normalizeMode("ceo")).toBe("ceo_advisor");
    expect(normalizeMode("decision_maker")).toBe("decision_memo");
    expect(normalizeMode("sales")).toBe("sales_coach");
    expect(normalizeMode("nonsense")).toBeNull();
    const user = { role: "user", features: [] as string[] };
    expect(resolveMode("ceo", user)).toBe("auto"); // may not use it → Auto
    expect(resolveMode("sales", user)).toBe("sales_coach");
    expect(resolveMode("ceo", { role: "super_admin", features: [] })).toBe("ceo_advisor");
  });
});
