import { describe, it, expect } from "vitest";
import {
  BUILTIN_CAPABILITY_MANIFEST as M,
  APP_CAPABILITIES,
  expandLegacyFeature,
  readStoredGrants,
  effectiveCapabilities,
  hasCapability,
  presetCapabilities,
  presetForRole,
  toggleCapability,
  buildStoredCapabilities,
  legacyFeaturesFor,
  allowedTiersFor,
  unknownCapabilityIds,
  withAppCapabilities,
  type CapabilityManifest,
} from "@/lib/capabilities-shared";
import { parseManifest } from "@/lib/capabilities";
import { allowedSourceTypes, canAccessSensitive, accessFromProfile, canAttachKind, NO_SOURCE_TYPES } from "@/lib/access";
import { allowedModes, canUseExecutive, resolveMode, WORK_MODES, manifestOnlyModeDefs } from "@/lib/work-modes";
import { preparePermissionsForStorage, normalizePermissions, capabilitiesBeyondActor } from "@/lib/admin-users";
import { isSelectionAllowed, type BrainModel } from "@/lib/models";

const ids = M.capabilities.map((c) => c.id);
const memberDefaults = M.capabilities.filter((c) => c.defaultForMembers).map((c) => c.id);
const SENSITIVE_DATA = ["data.call_score", "data.transcript", "data.coaching"];

describe("built-in manifest", () => {
  it("has unique ids and carries this app's own capabilities", () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of APP_CAPABILITIES) expect(ids).toContain(c.id);
    expect(M.source).toBe("fallback");
    expect(M.groups.map((g) => g.id)).toContain("app");
  });

  it("covers every work mode in this app's registry (Auto is always on, not a capability)", () => {
    for (const m of WORK_MODES) {
      if (m.id === "auto") expect(ids).not.toContain("modes.auto");
      else expect(ids).toContain(`modes.${m.id}`);
    }
  });

  it("keeps sensitive capabilities off for members by default", () => {
    for (const c of M.capabilities.filter((x) => x.sensitive)) expect(c.defaultForMembers, c.id).toBe(false);
    for (const id of [...SENSITIVE_DATA, "modes.ceo_advisor", "modes.ceo_content", "app.executive_memory", "jobs.deep_audit"]) {
      expect(memberDefaults).not.toContain(id);
    }
  });
});

describe("legacy feature keys → capability ids", () => {
  it("maps each old key", () => {
    expect(expandLegacyFeature("rag", M)).toEqual(["chat.knowledge"]);
    expect(expandLegacyFeature("projects", M)).toEqual(["app.projects"]);
    expect(expandLegacyFeature("attachments", M).sort()).toEqual(ids.filter((i) => i.startsWith("extract.")).sort());
    expect(expandLegacyFeature("connectors", M)).toEqual(["tools.connectors"]);
    expect(expandLegacyFeature("decisions", M)).toEqual(["modes.decision_memo"]);
    expect(expandLegacyFeature("decision_memo", M)).toEqual(["modes.decision_memo"]);
    expect(expandLegacyFeature("executive", M)).toEqual(["modes.ceo_advisor", "modes.ceo_content", "app.executive_memory"]);
    expect(expandLegacyFeature("nonsense", M)).toEqual([]);
    expect(expandLegacyFeature("data.call_score", M)).toEqual(["data.call_score"]);
  });

  it('"sensitive" covers the call material, reviews, metrics and audits — not the executive experts', () => {
    const s = expandLegacyFeature("sensitive", M);
    for (const id of [...SENSITIVE_DATA, "chat.call_review", "knowledge.performance", "jobs.deep_audit"]) expect(s).toContain(id);
    for (const id of ["modes.ceo_advisor", "modes.decision_memo", "app.executive_memory"]) expect(s).not.toContain(id);
  });

  it("reads legacy features and allowed_tiers as grants / denials", () => {
    const g = readStoredGrants({ features: ["sensitive"], allowed_tiers: ["fast"] }, M);
    expect(g.explicit).toBe(false);
    expect(g.granted.has("data.call_score")).toBe(true);
    expect(g.granted.has("models.fast")).toBe(true);
    expect([...g.denied].sort()).toEqual(["models.max", "models.recommended"]);
  });

  it("normalizePermissions returns the canonical (mapped) form with the same effective access", () => {
    const raw = { features: ["executive", "rag"], allowed_tiers: ["fast", "recommended"], models: ["claude-*"] };
    const n = normalizePermissions(raw, M);
    expect(n.capabilities).toContain("modes.ceo_advisor");
    expect(n.capabilities).toContain("chat.knowledge");
    expect(n.capabilities_denied).toEqual(["models.max"]);
    expect(n.models).toEqual(["claude-*"]);
    for (const role of ["user", "admin"]) {
      expect(effectiveCapabilities({ role, permissions: n }, M)).toEqual(effectiveCapabilities({ role, permissions: raw }, M));
    }
  });
});

describe("effective capabilities", () => {
  it("a user with no stored grants gets the role defaults", () => {
    expect(effectiveCapabilities({ role: "user" }, M)).toEqual(memberDefaults);
    expect(effectiveCapabilities({ role: "user", features: [] }, M)).toEqual(memberDefaults);
    expect(effectiveCapabilities({ role: "admin", permissions: {} }, M)).toEqual(ids);
  });

  it("super admins always hold everything, whatever is stored", () => {
    expect(effectiveCapabilities({ role: "super_admin", permissions: { capabilities: [], capabilities_denied: ids } }, M)).toEqual(ids);
  });

  it("explicit grants override defaults both ways", () => {
    const perms = { capabilities: ["chat.knowledge", "data.document", "data.call_score"], capabilities_denied: ["modes.copywriter"] };
    const caps = effectiveCapabilities({ role: "user", permissions: perms }, M);
    expect(caps).toContain("data.call_score");
    expect(caps).not.toContain("modes.copywriter");
    // Undecided ids keep their default.
    expect(caps).toContain("modes.sales_coach");
    const admin = effectiveCapabilities({ role: "admin", permissions: { capabilities: [], capabilities_denied: ["data.transcript"] } }, M);
    expect(admin).not.toContain("data.transcript");
  });

  it("a capability new to the Brain gets its default until an admin decides", () => {
    const withNew: CapabilityManifest = {
      ...M,
      capabilities: [
        ...M.capabilities,
        { id: "data.qa_scorecard", label: "QA scorecards", description: "x", group: "data", kind: "source_type", sensitive: true, defaultForMembers: false, defaultForAdmins: true },
        { id: "modes.pricing_analyst", label: "Pricing Analyst", description: "x", group: "modes", kind: "mode", defaultForMembers: true, defaultForAdmins: true, requires: ["chat.knowledge"], section: "Analysis" },
      ],
    };
    const saved = { capabilities: memberDefaults, capabilities_denied: ids.filter((i) => !memberDefaults.includes(i)) };
    const member = effectiveCapabilities({ role: "user", permissions: saved }, withNew);
    expect(member).toContain("modes.pricing_analyst");
    expect(member).not.toContain("data.qa_scorecard");
    expect(effectiveCapabilities({ role: "admin", permissions: saved }, withNew)).toContain("data.qa_scorecard");
    // The new expert becomes a selectable mode where that manifest is in use.
    expect(manifestOnlyModeDefs(withNew).map((m) => m.id)).toEqual(["pricing_analyst"]);
    expect(allowedModes({ role: "user", permissions: saved }, withNew)).toContain("pricing_analyst");
  });

  it("drops capabilities whose prerequisites are off", () => {
    const perms = { capabilities: ["chat.knowledge", "chat.call_review", "jobs.deep_audit", "data.call_score"], capabilities_denied: ["data.transcript"] };
    const caps = effectiveCapabilities({ role: "user", permissions: perms }, M);
    expect(caps).not.toContain("chat.call_review");
    expect(caps).not.toContain("jobs.deep_audit");
    expect(caps).toContain("data.call_score");
    // No "Ask the Brain" → no experts.
    const none = effectiveCapabilities({ role: "admin", permissions: { capabilities: [], capabilities_denied: ["chat.knowledge"] } }, M);
    expect(none.some((i) => i.startsWith("modes."))).toBe(false);
  });

  it("a resolved capability list is authoritative (no role defaults added)", () => {
    const resolved = ["chat.knowledge", "data.document", "modes.general"];
    expect(effectiveCapabilities({ role: "admin", features: resolved }, M)).toEqual(resolved);
    expect(hasCapability(resolved, "modes.general")).toBe(true);
    expect(allowedModes({ role: "admin", features: resolved }, M)).toEqual(["auto", "general"]);
  });

  it("accessFromProfile carries the resolved set, falling back to the stored grants", () => {
    const perms = { capabilities: ["chat.knowledge"], capabilities_denied: ids.filter((i) => i !== "chat.knowledge") };
    const caps = effectiveCapabilities({ role: "user", permissions: perms }, M);
    expect(effectiveCapabilities(accessFromProfile({ role: "user", permissions: perms, capabilities: caps }), M)).toEqual(caps);
    // Empty resolved set → resolved again from the stored grants (still nothing extra).
    const zero = { capabilities: [], capabilities_denied: ids };
    expect(effectiveCapabilities(accessFromProfile({ role: "user", permissions: zero, capabilities: [] }), M)).toEqual([]);
  });
});

describe("derived helpers keep their old behaviour", () => {
  it("knowledge sources", () => {
    expect(allowedSourceTypes({ role: "user" }, M)).toEqual(["document"]);
    expect(allowedSourceTypes({ role: "admin" }, M)).toBeUndefined();
    expect(allowedSourceTypes({ role: "user", features: ["sensitive"] }, M)).toBeUndefined();
    const partial = { role: "user", permissions: { capabilities: ["data.document", "data.call_score"] } };
    expect(allowedSourceTypes(partial, M)).toEqual(["document", "call_score"]);
    expect(canAccessSensitive(partial, M)).toBe(false); // not every sensitive source
    const nothing = { role: "admin", permissions: { capabilities: [], capabilities_denied: ["data.document", ...SENSITIVE_DATA] } };
    expect(allowedSourceTypes(nothing, M)).toEqual([NO_SOURCE_TYPES]); // never [] (= all)
  });

  it("work modes + executive memory", () => {
    const denied = { role: "user", permissions: { capabilities: [], capabilities_denied: ["modes.copywriter"] } };
    expect(allowedModes(denied, M)).not.toContain("copywriter");
    expect(resolveMode("copywriter", denied, M)).toBe("auto");
    const exec = { role: "user", permissions: { capabilities: ["modes.ceo_advisor"] } };
    expect(allowedModes(exec, M)).toContain("ceo_advisor");
    expect(canUseExecutive(exec, M)).toBe(false); // the mode, but not the private memory
    expect(canUseExecutive({ role: "user", features: ["executive"] }, M)).toBe(true);
    expect(canUseExecutive({ role: "admin" }, M)).toBe(true);
  });

  it("attachments by kind", () => {
    const noAudio = { role: "user", permissions: { capabilities: [], capabilities_denied: ["extract.audio"] } };
    expect(canAttachKind(noAudio, "audio", M)).toBe(false);
    expect(canAttachKind(noAudio, "pdf", M)).toBe(true);
    expect(canAttachKind(noAudio, "sheet", M)).toBe(true);
    expect(canAttachKind({ role: "user" }, "exe", M)).toBe(false);
  });

  it("smart route / deep analysis honour an explicit denial", () => {
    const catalog: BrainModel[] = [
      { id: "claude-haiku-4-5", provider: "anthropic", label: "Haiku", tier: "fast", available: true },
      { id: "claude-sonnet-4-6", provider: "anthropic", label: "Sonnet", tier: "recommended", available: true },
      { id: "claude-opus-4-8", provider: "anthropic", label: "Opus", tier: "max", available: true },
    ];
    expect(isSelectionAllowed("smart", {}, false, catalog)).toBe(true);
    expect(isSelectionAllowed("smart", { capabilities_denied: ["models.smart_route"] }, false, catalog)).toBe(false);
    expect(isSelectionAllowed("deep", { capabilities_denied: ["models.deep_analysis"] }, true, catalog)).toBe(false);
    expect(isSelectionAllowed("max", { capabilities_denied: ["models.deep_analysis"] }, false, catalog)).toBe(true);
  });
});

describe("editor helpers", () => {
  it("presets", () => {
    expect(presetCapabilities("member", M)).toEqual(memberDefaults);
    const analyst = presetCapabilities("analyst", M);
    for (const id of [...SENSITIVE_DATA, "chat.call_review", "jobs.deep_audit"]) expect(analyst).toContain(id);
    expect(analyst).not.toContain("modes.ceo_advisor");
    const manager = presetCapabilities("manager", M);
    expect(manager).toContain("modes.decision_memo");
    expect(manager).not.toContain("modes.ceo_content");
    expect(manager).not.toContain("app.executive_memory");
    expect(presetCapabilities("executive", M)).toEqual(ids);
    expect(presetForRole("user")).toBe("member");
    expect(presetForRole("admin")).toBe("admin");
  });

  it("toggling pulls in prerequisites and drops dependents", () => {
    const on = toggleCapability(memberDefaults, "jobs.deep_audit", true, M);
    expect(on).toContain("data.transcript");
    const off = toggleCapability(on, "data.transcript", false, M);
    expect(off).not.toContain("jobs.deep_audit");
    expect(off).not.toContain("data.transcript");
  });

  it("stored form decides every offered id and keeps decisions the manifest doesn't carry", () => {
    const prev = { capabilities: ["tools.connector.higgsfield"], capabilities_denied: ["tools.connector.drive"] };
    const s = buildStoredCapabilities(memberDefaults, M, prev);
    expect(s.capabilities).toContain("tools.connector.higgsfield");
    expect(s.capabilities_denied).toContain("tools.connector.drive");
    expect(new Set([...s.capabilities, ...s.capabilities_denied]).size).toBe(ids.length + 2);
  });

  it("a save from an editor that rendered the fallback list leaves live-only ids alone", () => {
    const base = M.capabilities.find((c) => c.id === "tools.connectors")!;
    const live: CapabilityManifest = {
      ...M,
      capabilities: [
        ...M.capabilities,
        { ...base, id: "tools.connector.hubspot", requires: undefined, defaultForMembers: true },
      ],
    };
    // The editor rendered the built-in list (no tools.connector.hubspot).
    const rendered = ids;
    // Explicitly granted before → still granted.
    const prev = { capabilities: [...memberDefaults, "tools.connector.hubspot"], capabilities_denied: [] };
    const kept = buildStoredCapabilities(memberDefaults, live, prev, rendered);
    expect(kept.capabilities).toContain("tools.connector.hubspot");
    expect(kept.capabilities_denied).not.toContain("tools.connector.hubspot");
    // Explicitly denied before → still denied.
    const denied = buildStoredCapabilities(memberDefaults, live, { capabilities: memberDefaults, capabilities_denied: ["tools.connector.hubspot"] }, rendered);
    expect(denied.capabilities_denied).toContain("tools.connector.hubspot");
    // Never decided → left undecided (the role default applies), NOT denied.
    const fresh = buildStoredCapabilities(memberDefaults, live, {}, rendered);
    expect(fresh.capabilities).not.toContain("tools.connector.hubspot");
    expect(fresh.capabilities_denied).not.toContain("tools.connector.hubspot");
    expect(effectiveCapabilities({ role: "user", permissions: fresh }, live)).toContain("tools.connector.hubspot");
    // The ids the editor DID render are still all decided.
    expect(new Set([...fresh.capabilities, ...fresh.capabilities_denied])).toEqual(new Set(ids));
    // Older clients (no list) keep the old behaviour: every offered id decided.
    expect(buildStoredCapabilities(memberDefaults, live, {}).capabilities_denied).toContain("tools.connector.hubspot");
  });

  it("the admin write path passes the editor's rendered ids through (and never stores them)", () => {
    const r = preparePermissionsForStorage({ capabilities: memberDefaults, offered: ids.filter((id) => id !== "data.transcript") }, M, {
      capabilities: [...memberDefaults, "data.transcript"],
      capabilities_denied: [],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Not rendered → its previous grant is kept rather than switched off.
    expect(r.permissions.capabilities).toContain("data.transcript");
    expect(r.permissions).not.toHaveProperty("offered");
  });

  it("legacy mirrors are conservative", () => {
    expect(legacyFeaturesFor(["data.call_score"], M)).not.toContain("sensitive");
    expect(legacyFeaturesFor(expandLegacyFeature("sensitive", M), M)).toContain("sensitive");
    expect(legacyFeaturesFor(["modes.ceo_advisor"], M)).not.toContain("executive");
    expect(allowedTiersFor(ids, M)).toBeUndefined();
    expect(allowedTiersFor(["models.fast"], M)).toEqual(["fast"]);
  });

  it("unknown ids are reported unless legacy or already stored", () => {
    expect(unknownCapabilityIds(["chat.knowledge", "sensitive", "data.bogus"], M)).toEqual(["data.bogus"]);
    expect(unknownCapabilityIds(["tools.connector.x"], M, { capabilities: ["tools.connector.x"] })).toEqual([]);
  });
});

describe("admin write path", () => {
  it("stores explicit grants + mirrors, validating ids", () => {
    const r = preparePermissionsForStorage({ capabilities: [...memberDefaults, "data.call_score"], models: ["gpt-4o"] }, M);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.permissions.capabilities).toContain("data.call_score");
    expect(r.permissions.capabilities_denied).toContain("data.transcript");
    expect(r.permissions.features).toContain("rag");
    expect(r.permissions.features).not.toContain("sensitive");
    expect(r.permissions.allowed_tiers).toBeUndefined();
    expect(r.permissions.models).toEqual(["gpt-4o"]);

    const bad = preparePermissionsForStorage({ capabilities: ["data.bogus"] }, M);
    expect(bad.ok).toBe(false);
    const noTier = preparePermissionsForStorage({ capabilities: ["chat.knowledge"] }, M);
    expect(noTier.ok).toBe(false);
  });

  it("legacy submissions keep legacy semantics and reject capability ids in features", () => {
    const r = preparePermissionsForStorage({ features: ["sensitive"], allowed_tiers: ["fast"] }, M);
    expect(r).toEqual({ ok: true, permissions: { features: ["sensitive"], allowed_tiers: ["fast"] } });
    expect(preparePermissionsForStorage({ features: ["data.call_score"] }, M).ok).toBe(false);
  });

  it("a plain admin cannot grant beyond their own capabilities", () => {
    const actor = { role: "admin" as const, capabilities: memberDefaults };
    expect(capabilitiesBeyondActor(actor, memberDefaults, [...memberDefaults, "data.call_score"])).toEqual(["data.call_score"]);
    // Keeping what the user already had is fine.
    expect(capabilitiesBeyondActor(actor, ["data.call_score"], ["data.call_score"])).toEqual([]);
    expect(capabilitiesBeyondActor({ role: "super_admin", capabilities: [] }, [], ids)).toEqual([]);
  });
});

describe("parsing the Brain's manifest", () => {
  it("skips malformed entries, forces sensitive → off for members, merges this app's capabilities", () => {
    const parsed = parseManifest({
      version: 1,
      generatedAt: "2026-09-25T00:00:00Z",
      groups: [{ id: "chat", label: "Chat" }],
      capabilities: [
        { id: "chat.knowledge", label: "Ask", description: "d", group: "chat", kind: "feature", defaultForMembers: true, defaultForAdmins: true },
        { id: "BAD ID", label: "x", group: "chat" },
        { id: "data.transcript", label: "T", description: "d", group: "data", kind: "source_type", sensitive: true, defaultForMembers: true, defaultForAdmins: true },
        { id: "modes.ceo_advisor", label: "CEO", description: "d", group: "modes", kind: "mode", defaultForMembers: false, defaultForAdmins: true },
      ],
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.capabilities.map((c) => c.id)).toEqual(["chat.knowledge", "data.transcript", "modes.ceo_advisor"]);
    expect(parsed!.capabilities[1].defaultForMembers).toBe(false);
    const resolved = withAppCapabilities(parsed!, { source: "brain" });
    expect(resolved.capabilities.map((c) => c.id)).toContain("app.executive_memory");
    // Groups the payload didn't list are added.
    expect(resolved.groups.map((g) => g.id)).toEqual(expect.arrayContaining(["chat", "app", "data", "modes"]));
    expect(parseManifest({ capabilities: [] })).toBeNull();
    expect(parseManifest(null)).toBeNull();
  });
});
