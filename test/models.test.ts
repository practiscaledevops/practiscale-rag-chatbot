import { describe, it, expect } from "vitest";
import { filterModelsByPermissions, type BrainModel } from "@/lib/models";

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
