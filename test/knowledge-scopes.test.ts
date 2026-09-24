import { describe, it, expect } from "vitest";
import {
  BUILTIN_KNOWLEDGE_SCOPES,
  DEFAULT_KNOWLEDGE_SCOPE,
  KNOWN_KNOWLEDGE_SCOPE_IDS,
  canUseKnowledgeScope,
  isKnowledgeScopeId,
  isKnownKnowledgeScope,
  normalizeKnowledgeScopes,
  resolveKnowledgeScope,
  scopesForAccess,
  type KnowledgeScope,
} from "@/lib/knowledge-scopes";
import { SENSITIVE_SOURCE_TYPES, allowedSourceTypes } from "@/lib/access";

const SENSITIVE = SENSITIVE_SOURCE_TYPES; // call_score, transcript, coaching
const BRAIN_SCOPES: KnowledgeScope[] = [
  ...BUILTIN_KNOWLEDGE_SCOPES,
  { id: "calls", label: "Consultant calls", description: "Sales-call transcripts and AI call scores only.", sensitive: true },
];

describe("knowledge scope ids", () => {
  it("knows the Brain's scopes and accepts safe future ids", () => {
    expect(KNOWN_KNOWLEDGE_SCOPE_IDS).toEqual(["auto", "all", "reality", "playbook", "learning", "calls"]);
    for (const id of KNOWN_KNOWLEDGE_SCOPE_IDS) expect(isKnowledgeScopeId(id)).toBe(true);
    expect(isKnowledgeScopeId("platforms")).toBe(true);
    expect(isKnownKnowledgeScope("platforms")).toBe(false);
  });

  it("rejects anything that is not a safe id", () => {
    for (const bad of ["", "Auto", "calls!", "a-b", "x".repeat(33), "../etc", " auto", 42, null, undefined, {}]) {
      expect(isKnowledgeScopeId(bad), String(bad)).toBe(false);
    }
  });

  it("the built-in fallback starts with Auto and never includes a sensitive scope", () => {
    expect(BUILTIN_KNOWLEDGE_SCOPES[0].id).toBe(DEFAULT_KNOWLEDGE_SCOPE);
    expect(BUILTIN_KNOWLEDGE_SCOPES.map((s) => s.id)).toEqual(["auto", "all", "reality", "playbook", "learning"]);
    expect(BUILTIN_KNOWLEDGE_SCOPES.some((s) => s.sensitive)).toBe(false);
  });
});

describe("normalizeKnowledgeScopes (the Brain's list is untrusted JSON)", () => {
  it("returns null when there is no usable list, so the caller falls back", () => {
    expect(normalizeKnowledgeScopes(undefined)).toBeNull();
    expect(normalizeKnowledgeScopes({})).toBeNull();
    expect(normalizeKnowledgeScopes([])).toBeNull();
    expect(normalizeKnowledgeScopes([{ id: "BAD ID" }, "x", null])).toBeNull();
  });

  it("keeps valid entries, dedupes, bounds text and puts Auto first", () => {
    const out = normalizeKnowledgeScopes([
      { id: "playbook", label: "Playbooks", description: "Frameworks\nwe believe in.", sensitive: false },
      { id: "playbook", label: "dup" },
      { id: "auto", label: "Auto", description: "Per question." },
      { id: "platforms", label: "x".repeat(200), description: "", sensitive: "yes" },
      { id: "Nope", label: "invalid" },
    ])!;
    expect(out.map((s) => s.id)).toEqual(["auto", "playbook", "platforms"]);
    expect(out[1].description).toBe("Frameworks we believe in.");
    expect(out[2].label.length).toBeLessThanOrEqual(40);
    expect(out[2].sensitive).toBe(false); // only a literal true counts
  });

  it("adds Auto when the Brain's list lacks it, and fills missing text from the built-ins", () => {
    const out = normalizeKnowledgeScopes([{ id: "reality" }])!;
    expect(out.map((s) => s.id)).toEqual(["auto", "reality"]);
    expect(out[1].label).toBe("Reality");
    expect(out[1].description.length).toBeGreaterThan(0);
  });

  it("a known sensitive scope stays sensitive even if the Brain says otherwise", () => {
    const out = normalizeKnowledgeScopes([{ id: "calls", label: "Consultant calls", sensitive: false }])!;
    expect(out.find((s) => s.id === "calls")!.sensitive).toBe(true);
  });
});

describe("sensitive scope access", () => {
  const calls = BRAIN_SCOPES.find((s) => s.id === "calls")!;
  const futureSensitive = { id: "coaching_notes", sensitive: true };

  it("everyone may use non-sensitive scopes", () => {
    for (const s of BUILTIN_KNOWLEDGE_SCOPES) expect(canUseKnowledgeScope(s, ["document"], SENSITIVE)).toBe(true);
  });

  it("calls needs call_score or transcript (or no narrowing at all)", () => {
    expect(canUseKnowledgeScope(calls, undefined, SENSITIVE)).toBe(true);
    expect(canUseKnowledgeScope(calls, ["document"], SENSITIVE)).toBe(false);
    expect(canUseKnowledgeScope(calls, ["__none__"], SENSITIVE)).toBe(false);
    expect(canUseKnowledgeScope(calls, ["document", "transcript"], SENSITIVE)).toBe(true);
    expect(canUseKnowledgeScope(calls, ["call_score"], SENSITIVE)).toBe(true);
    // Coaching notes alone are not call data.
    expect(canUseKnowledgeScope(calls, ["document", "coaching"], SENSITIVE)).toBe(false);
    // Known sensitive even when a list mislabels it.
    expect(canUseKnowledgeScope({ id: "calls", sensitive: false }, ["document"], SENSITIVE)).toBe(false);
  });

  it("an unknown sensitive scope needs every sensitive source type", () => {
    expect(canUseKnowledgeScope(futureSensitive, undefined, SENSITIVE)).toBe(true);
    expect(canUseKnowledgeScope(futureSensitive, ["document", "call_score"], SENSITIVE)).toBe(false);
    expect(canUseKnowledgeScope(futureSensitive, ["document", ...SENSITIVE], SENSITIVE)).toBe(true);
  });

  it("scopesForAccess hides calls from a member and keeps it for an admin", () => {
    const member = allowedSourceTypes({ role: "user", features: [] });
    const admin = allowedSourceTypes({ role: "admin", features: [] });
    expect(scopesForAccess(BRAIN_SCOPES, member, SENSITIVE).map((s) => s.id)).toEqual(["auto", "all", "reality", "playbook", "learning"]);
    expect(scopesForAccess(BRAIN_SCOPES, admin, SENSITIVE).map((s) => s.id)).toContain("calls");
  });
});

describe("resolveKnowledgeScope (server-side, silent fallback to auto)", () => {
  const member = { allowedSourceTypes: ["document"], sensitiveSourceTypes: SENSITIVE };
  const admin = { allowedSourceTypes: undefined, sensitiveSourceTypes: SENSITIVE };

  it("missing / invalid ids become auto", () => {
    expect(resolveKnowledgeScope(undefined, admin)).toBe("auto");
    expect(resolveKnowledgeScope("", admin)).toBe("auto");
    expect(resolveKnowledgeScope("DROP TABLE", admin)).toBe("auto");
    expect(resolveKnowledgeScope(7, admin)).toBe("auto");
  });

  it("known lane scopes pass for everyone", () => {
    for (const id of ["auto", "all", "reality", "playbook", "learning"]) {
      expect(resolveKnowledgeScope(id, member)).toBe(id);
    }
  });

  it("calls only for users who can reach call data", () => {
    expect(resolveKnowledgeScope("calls", member)).toBe("auto");
    expect(resolveKnowledgeScope("calls", admin)).toBe("calls");
    expect(resolveKnowledgeScope("calls", { ...member, allowedSourceTypes: ["document", "call_score"] })).toBe("calls");
  });

  it("a future id must be advertised by the Brain, and respects its sensitivity", () => {
    const available: KnowledgeScope[] = [
      ...BRAIN_SCOPES,
      { id: "platforms", label: "Platforms", description: "How each platform works.", sensitive: false },
      { id: "coaching_notes", label: "Coaching", description: "Coaching notes.", sensitive: true },
    ];
    expect(resolveKnowledgeScope("platforms", { ...member, available: null })).toBe("auto");
    expect(resolveKnowledgeScope("platforms", { ...member, available })).toBe("platforms");
    expect(resolveKnowledgeScope("unknown_scope", { ...admin, available })).toBe("auto");
    expect(resolveKnowledgeScope("coaching_notes", { ...member, available })).toBe("auto");
    expect(resolveKnowledgeScope("coaching_notes", { ...admin, available })).toBe("coaching_notes");
  });
});
