import { describe, it, expect } from "vitest";
import {
  applyDisabledModels,
  filterModelsByPermissions,
  isSelectionAllowed,
  DISABLED_BY_ADMIN_REASON,
  type BrainModel,
  type UserPermissions,
} from "@/lib/models";

const CATALOG: BrainModel[] = [
  { id: "claude-haiku-4-5", provider: "anthropic", label: "Haiku", tier: "fast", available: true },
  { id: "claude-sonnet-4-6", provider: "anthropic", label: "Sonnet", tier: "recommended", available: true },
  { id: "claude-opus-4-8", provider: "anthropic", label: "Opus", tier: "max", available: true },
  { id: "gpt-4o-mini", provider: "openai", label: "GPT-4o mini", tier: "fast", available: true },
  { id: "gpt-4o", provider: "openai", label: "GPT-4o", tier: "recommended", available: true },
];

const ids = (ms: BrainModel[]) => ms.map((m) => m.id);

describe("filterModelsByPermissions", () => {
  it("returns the full catalog when there are no restrictions", () => {
    expect(ids(filterModelsByPermissions(CATALOG, {}))).toEqual(ids(CATALOG));
    expect(ids(filterModelsByPermissions(CATALOG, null))).toEqual(ids(CATALOG));
  });

  it("canUseAllModels bypasses the model allowlist", () => {
    const out = filterModelsByPermissions(CATALOG, { models: ["gpt-4o"] }, true);
    expect(ids(out)).toEqual(ids(CATALOG));
  });

  it("applies a model-id glob allowlist", () => {
    const out = filterModelsByPermissions(CATALOG, { models: ["claude-*"] });
    expect(ids(out)).toEqual(["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-8"]);
  });

  it("matches an exact model id in the allowlist", () => {
    const out = filterModelsByPermissions(CATALOG, { models: ["gpt-4o-mini"] });
    expect(ids(out)).toEqual(["gpt-4o-mini"]);
  });

  it("restricts by allowed_tiers (keeps only matching tiers)", () => {
    const out = filterModelsByPermissions(CATALOG, { allowed_tiers: ["fast"] });
    expect(ids(out)).toEqual(["claude-haiku-4-5", "gpt-4o-mini"]);
  });

  it("combines a model glob and a tier restriction", () => {
    const out = filterModelsByPermissions(CATALOG, {
      models: ["claude-*"],
      allowed_tiers: ["fast", "recommended"],
    });
    expect(ids(out)).toEqual(["claude-haiku-4-5", "claude-sonnet-4-6"]);
  });
});

describe("applyDisabledModels", () => {
  it("marks admin-disabled models unavailable with the reason, keeps the rest", () => {
    const out = applyDisabledModels(CATALOG, ["GPT-4o", "  claude-opus-4-8 "]);
    const byId = Object.fromEntries(out.map((m) => [m.id, m]));
    expect(byId["gpt-4o"]).toMatchObject({ available: false, reason: DISABLED_BY_ADMIN_REASON });
    expect(byId["claude-opus-4-8"]).toMatchObject({ available: false, reason: DISABLED_BY_ADMIN_REASON });
    expect(byId["gpt-4o-mini"].available).toBe(true);
    expect(out).toHaveLength(CATALOG.length);
  });

  it("is a no-op for an empty denylist", () => {
    expect(applyDisabledModels(CATALOG, [])).toBe(CATALOG);
  });
});

describe("isSelectionAllowed", () => {
  // One model per tier so an alias resolves to exactly one catalog entry.
  const ONE_PER_TIER: BrainModel[] = [
    { id: "claude-haiku-4-5", provider: "anthropic", label: "Haiku", tier: "fast", available: true },
    { id: "gpt-4o", provider: "openai", label: "GPT-4o", tier: "recommended", available: true },
    { id: "claude-opus-4-8", provider: "anthropic", label: "Opus", tier: "max", available: true },
  ];
  const UNRESTRICTED: UserPermissions = {};
  const CLAUDE_ONLY: UserPermissions = { models: ["claude-*"] };
  const ALL: UserPermissions = { models: ["claude-*", "gpt-*"] };

  const cases: Array<{
    name: string;
    selection: string;
    perms: UserPermissions;
    canUseAll?: boolean;
    catalog?: BrainModel[];
    disabled?: string[];
    expected: boolean;
  }> = [
    // Unrestricted user: every alias and any id goes.
    { name: "unrestricted + tier alias", selection: "fast", perms: UNRESTRICTED, expected: true },
    { name: "unrestricted + smart", selection: "smart", perms: UNRESTRICTED, expected: true },
    { name: "unrestricted + deep", selection: "deep", perms: UNRESTRICTED, expected: true },
    { name: "unrestricted + unknown concrete id", selection: "some-new-model", perms: UNRESTRICTED, expected: true },
    // Restricted user: an alias resolves through the catalog's tier field.
    { name: "restricted + alias → allowed model", selection: "fast", perms: CLAUDE_ONLY, expected: true },
    { name: "restricted + alias (case-insensitive)", selection: "MAX", perms: CLAUDE_ONLY, expected: true },
    { name: "restricted + alias → disallowed model", selection: "recommended", perms: CLAUDE_ONLY, expected: false },
    { name: "restricted + deep → allowed max model", selection: "deep", perms: CLAUDE_ONLY, expected: true },
    {
      name: "restricted + deep → disallowed max model",
      selection: "deep",
      perms: { models: ["gpt-*"] },
      expected: false,
    },
    { name: "restricted + smart (a tier resolves outside the allowlist)", selection: "smart", perms: CLAUDE_ONLY, expected: false },
    { name: "restricted + smart (every tier allowed)", selection: "smart", perms: ALL, expected: true },
    // Unresolvable alias (no catalog model carries the tier) → rejected.
    {
      name: "restricted + alias with no catalog model for that tier",
      selection: "fast",
      perms: CLAUDE_ONLY,
      catalog: ONE_PER_TIER.filter((m) => m.tier !== "fast"),
      expected: false,
    },
    // A tier with several models: ALL must be allowed (the Brain picks one).
    { name: "restricted + alias, tier shared with a disallowed model", selection: "fast", perms: CLAUDE_ONLY, catalog: CATALOG, expected: false },
    // Concrete ids.
    { name: "restricted + allowed concrete id", selection: "claude-haiku-4-5", perms: CLAUDE_ONLY, expected: true },
    { name: "restricted + disallowed concrete id", selection: "gpt-4o", perms: CLAUDE_ONLY, expected: false },
    // allowed_tiers gates aliases the same as before.
    { name: "tier-restricted + allowed alias", selection: "fast", perms: { allowed_tiers: ["fast"] }, expected: true },
    { name: "tier-restricted + disallowed alias", selection: "max", perms: { allowed_tiers: ["fast"] }, expected: false },
    { name: "tier-restricted + deep without max", selection: "deep", perms: { allowed_tiers: ["fast"] }, expected: false },
    { name: "tier-restricted + deep with max", selection: "deep", perms: { allowed_tiers: ["max"] }, expected: true },
    { name: "tier-restricted + smart", selection: "smart", perms: { allowed_tiers: ["fast", "max"] }, expected: false },
    // canUseAllModels bypasses the allowlist…
    { name: "canUseAllModels + disallowed id", selection: "gpt-4o", perms: CLAUDE_ONLY, canUseAll: true, expected: true },
    // …but never the workspace denylist.
    { name: "canUseAllModels + admin-disabled id", selection: "gpt-4o", perms: UNRESTRICTED, canUseAll: true, disabled: ["gpt-4o"], expected: false },
    { name: "unrestricted + admin-disabled id", selection: "GPT-4o", perms: UNRESTRICTED, disabled: ["gpt-4o"], expected: false },
    {
      name: "restricted + alias resolving to an admin-disabled model",
      selection: "fast",
      perms: CLAUDE_ONLY,
      disabled: ["claude-haiku-4-5"],
      expected: false,
    },
    { name: "empty selection", selection: "  ", perms: UNRESTRICTED, expected: false },
  ];

  it.each(cases)("$name", ({ selection, perms, canUseAll = false, catalog = ONE_PER_TIER, disabled = [], expected }) => {
    expect(isSelectionAllowed(selection, perms, canUseAll, catalog, disabled)).toBe(expected);
  });
});
