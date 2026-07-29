"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  Boxes,
  Check,
  CircleDollarSign,
  Gauge,
  Loader2,
  RotateCcw,
  Save,
  Sparkles,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/Button";
import type {
  PricingOverride,
  SettingsModelOption,
  SettingsPayload,
  Tier,
  WorkspaceSettings,
} from "@/app/api/admin/settings/route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Provider → group heading, mirroring the product's ModelSelector.
const GROUP_LABELS: Record<string, string> = { anthropic: "Claude", openai: "GPT" };
const GROUP_ORDER = ["anthropic", "openai"];

function groupLabel(provider: string): string {
  return GROUP_LABELS[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}

/** Group + order catalog models by provider (Claude, GPT, then the rest). */
function groupModels(models: SettingsModelOption[]) {
  const byProvider = new Map<string, SettingsModelOption[]>();
  for (const m of models) {
    const list = byProvider.get(m.provider) ?? [];
    list.push(m);
    byProvider.set(m.provider, list);
  }
  return [...byProvider.keys()]
    .sort((a, b) => {
      const ia = GROUP_ORDER.indexOf(a);
      const ib = GROUP_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    })
    .map((provider) => ({
      provider,
      label: groupLabel(provider),
      items: byProvider.get(provider)!,
    }));
}

/** Canonical serialization so dirty-state ignores array/key ordering. */
function canonical(s: WorkspaceSettings): string {
  const overrides: Record<string, PricingOverride> = {};
  for (const k of Object.keys(s.pricingOverrides).sort()) overrides[k] = s.pricingOverrides[k];
  return JSON.stringify({
    ...s,
    disabledModels: [...s.disabledModels].sort(),
    pricingOverrides: overrides,
  });
}

// ---------------------------------------------------------------------------
// Small presentational primitives
// ---------------------------------------------------------------------------

/** Section wrapper: icon + title + description over a soft card. */
function Section({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface shadow-soft">
      <header className="flex items-start gap-3 border-b border-border px-4 py-4 sm:px-5">
        <span
          className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent"
          aria-hidden
        >
          {icon}
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
      </header>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

/** A provider tag pill. */
function ProviderBadge({ provider }: { provider: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium capitalize text-muted-foreground">
      {provider || "unknown"}
    </span>
  );
}

/** Accessible on/off switch (role="switch"). */
function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
        checked ? "bg-accent" : "bg-surface-muted border border-border"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-block h-[18px] w-[18px] transform rounded-full bg-white shadow-soft transition-transform",
          checked ? "translate-x-[23px]" : "translate-x-[3px]"
        )}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SettingsClient({ initial }: { initial: SettingsPayload }) {
  const { models, tiers } = initial;

  const [settings, setSettings] = useState<WorkspaceSettings>(initial.settings);
  const [baseline, setBaseline] = useState<WorkspaceSettings>(initial.settings);
  const [updatedAt, setUpdatedAt] = useState<string | null>(initial.updatedAt);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const dirty = useMemo(
    () => canonical(settings) !== canonical(baseline),
    [settings, baseline]
  );

  const groups = useMemo(() => groupModels(models), [models]);
  const disabledSet = useMemo(
    () => new Set(settings.disabledModels),
    [settings.disabledModels]
  );
  const enabledCount = models.length - disabledSet.size;

  // Enabled catalog models (for the default-model picker's concrete select).
  const enabledModels = useMemo(
    () => models.filter((m) => !disabledSet.has(m.id)),
    [models, disabledSet]
  );

  // Whether the currently-chosen concrete default still resolves to a live,
  // enabled model — surfaced as a warning if not.
  const defaultModelValid =
    settings.defaultModelKind !== "model" ||
    enabledModels.some((m) => m.id === settings.defaultModel);

  // Pricing rows: enabled models, plus any id that already carries an override
  // (so an override on a now-disabled/absent model stays visible to clear).
  const pricingRows = useMemo(() => {
    const byId = new Map<string, { id: string; label: string; provider: string }>();
    for (const m of enabledModels) byId.set(m.id, { id: m.id, label: m.label, provider: m.provider });
    for (const id of Object.keys(settings.pricingOverrides)) {
      if (!byId.has(id)) byId.set(id, { id, label: id, provider: "unknown" });
    }
    return [...byId.values()].sort(
      (a, b) => a.provider.localeCompare(b.provider) || a.label.localeCompare(b.label)
    );
  }, [enabledModels, settings.pricingOverrides]);

  // --- mutators ------------------------------------------------------------

  function patch(next: Partial<WorkspaceSettings>) {
    setJustSaved(false);
    setSettings((s) => ({ ...s, ...next }));
  }

  function toggleModel(id: string, enabled: boolean) {
    setJustSaved(false);
    setSettings((s) => {
      const set = new Set(s.disabledModels);
      if (enabled) set.delete(id);
      else set.add(id);
      return { ...s, disabledModels: [...set] };
    });
  }

  function chooseTier(tier: Tier) {
    patch({ defaultModel: tier, defaultModelKind: "tier" });
  }

  function chooseSpecific() {
    // Switch to a concrete default; seed with the current value if already a
    // real model, else the first enabled model in the catalog.
    const seed =
      settings.defaultModelKind === "model" &&
      enabledModels.some((m) => m.id === settings.defaultModel)
        ? settings.defaultModel
        : enabledModels[0]?.id ?? "";
    patch({ defaultModel: seed, defaultModelKind: "model" });
  }

  function setOverride(id: string, field: keyof PricingOverride, raw: string) {
    setJustSaved(false);
    const value = raw.trim() === "" ? null : Math.max(0, Number(raw));
    const parsed = value == null || Number.isFinite(value) ? value : null;
    setSettings((s) => {
      const overrides = { ...s.pricingOverrides };
      const cur = overrides[id] ?? { inputPerMTok: null, outputPerMTok: null };
      const nextEntry: PricingOverride = { ...cur, [field]: parsed };
      if (nextEntry.inputPerMTok == null && nextEntry.outputPerMTok == null) {
        delete overrides[id]; // no-op override → drop the key
      } else {
        overrides[id] = nextEntry;
      }
      return { ...s, pricingOverrides: overrides };
    });
  }

  function discard() {
    setSettings(baseline);
    setError(null);
    setJustSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setJustSaved(false);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          typeof body?.error === "string" ? body.error : `Save failed (${res.status})`;
        throw new Error(msg);
      }
      // Adopt the server-normalized settings as the new baseline.
      const saved = (body?.settings as WorkspaceSettings) ?? settings;
      setSettings(saved);
      setBaseline(saved);
      setUpdatedAt((body?.updatedAt as string | null) ?? new Date().toISOString());
      setJustSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save settings");
    } finally {
      setSaving(false);
    }
  }

  const savedLabel = updatedAt
    ? new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(updatedAt))
    : null;

  return (
    <div className="mx-auto w-full max-w-4xl">
      {/* Header */}
      <header className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Workspace settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Control which models the workspace can use, the defaults for new chats,
          and the cost rates behind the usage meter. Changes apply to everyone.
        </p>
      </header>

      {/* Error banner */}
      {error ? (
        <div
          role="alert"
          className="mb-5 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger"
        >
          <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden />
          <div>
            <div className="font-medium">Could not save settings</div>
            <div className="text-danger/80">{error}</div>
          </div>
        </div>
      ) : null}

      <div className="space-y-5 pb-28">
        {/* --- Default chat ------------------------------------------------ */}
        <Section
          icon={<Gauge size={18} />}
          title="Defaults for new chats"
          description="The model and grounding a brand-new conversation starts with. Members can still switch per chat."
        >
          <fieldset>
            <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Default model
            </legend>
            <div role="radiogroup" aria-label="Default model" className="grid gap-2 sm:grid-cols-3">
              {tiers.map((t) => {
                const active =
                  settings.defaultModelKind === "tier" && settings.defaultModel === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => chooseTier(t.value)}
                    className={cn(
                      "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "border-accent bg-accent/5 ring-1 ring-accent"
                        : "border-border bg-surface hover:bg-surface-muted"
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                      <Zap size={14} className={active ? "text-accent" : "text-muted-foreground"} aria-hidden />
                      {t.label}
                    </span>
                    <span className="text-xs text-muted-foreground">{t.hint}</span>
                  </button>
                );
              })}
            </div>

            {/* Specific model option */}
            <div
              className={cn(
                "mt-2 rounded-lg border p-3 transition-colors",
                settings.defaultModelKind === "model"
                  ? "border-accent bg-accent/5 ring-1 ring-accent"
                  : "border-border bg-surface"
              )}
            >
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  role="radio"
                  aria-checked={settings.defaultModelKind === "model"}
                  onClick={chooseSpecific}
                  className="flex items-center gap-1.5 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                >
                  <Sparkles
                    size={14}
                    className={settings.defaultModelKind === "model" ? "text-accent" : "text-muted-foreground"}
                    aria-hidden
                  />
                  Specific model
                </button>

                <label className="sr-only" htmlFor="default-model-select">
                  Default model
                </label>
                <select
                  id="default-model-select"
                  value={settings.defaultModelKind === "model" ? settings.defaultModel : ""}
                  disabled={settings.defaultModelKind !== "model"}
                  onChange={(e) => patch({ defaultModel: e.target.value, defaultModelKind: "model" })}
                  className="h-8 min-w-[12rem] flex-1 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-foreground shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  {/* Always present so the controlled value always has a match. */}
                  <option value="">Choose a model…</option>
                  {/* Keep a missing/disabled current default visible + selectable. */}
                  {settings.defaultModelKind === "model" && !defaultModelValid ? (
                    <option value={settings.defaultModel}>{settings.defaultModel} (unavailable)</option>
                  ) : null}
                  {enabledModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} · {m.id}
                    </option>
                  ))}
                </select>
              </div>

              {settings.defaultModelKind === "model" && !defaultModelValid ? (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-warning">
                  <AlertCircle size={13} aria-hidden />
                  This model is disabled or no longer in the catalog. New chats will
                  fall back until you pick an enabled model.
                </p>
              ) : null}
            </div>
          </fieldset>

          {/* RAG default */}
          <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-border bg-surface px-3 py-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">Knowledge (RAG) grounding on by default</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                New chats start with grounded, cited answers from the Brain. Members
                can turn it off per conversation.
              </p>
            </div>
            <Switch
              checked={settings.ragDefaultOn}
              onChange={(v) => patch({ ragDefaultOn: v })}
              label="RAG grounding on by default"
            />
          </div>
        </Section>

        {/* --- Enabled models --------------------------------------------- */}
        <Section
          icon={<Boxes size={18} />}
          title="Available models"
          description="Turn models on or off for the whole workspace. A disabled model can't be selected by anyone, regardless of individual permissions."
        >
          <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">{enabledCount}</span> of{" "}
              {models.length} models enabled
            </span>
            {settings.disabledModels.length > 0 ? (
              <button
                type="button"
                onClick={() => patch({ disabledModels: [] })}
                className="font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              >
                Enable all
              </button>
            ) : null}
          </div>

          {models.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface-muted/50 px-3 py-6 text-center text-sm text-muted-foreground">
              No models reported by the Brain catalog.
            </p>
          ) : (
            <div className="space-y-4">
              {groups.map((group) => (
                <div key={group.provider}>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.label}
                  </p>
                  <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                    {group.items.map((m) => {
                      const enabled = !disabledSet.has(m.id);
                      return (
                        <li
                          key={m.id}
                          className="flex items-center justify-between gap-3 bg-surface px-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium text-foreground">
                                {m.label}
                              </span>
                              {m.tier ? (
                                <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                  {m.tier}
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                              <span className="truncate">{m.id}</span>
                              {!m.available ? (
                                <span className="text-warning">· {m.reason || "unavailable on the Brain"}</span>
                              ) : null}
                            </div>
                          </div>
                          <Switch
                            checked={enabled}
                            onChange={(v) => toggleModel(m.id, v)}
                            label={`Enable ${m.label}`}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* --- Pricing overrides ------------------------------------------ */}
        <Section
          icon={<CircleDollarSign size={18} />}
          title="Pricing overrides"
          description="Optional per-model rates in USD per 1M tokens. Leave blank to use the built-in estimate. These feed the usage meter's cost estimates."
        >
          {pricingRows.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface-muted/50 px-3 py-6 text-center text-sm text-muted-foreground">
              Enable a model to set a price override.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse">
                <caption className="sr-only">Per-model price overrides in USD per 1M tokens</caption>
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="px-2 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Model
                    </th>
                    <th scope="col" className="px-2 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Input $/1M
                    </th>
                    <th scope="col" className="px-2 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Output $/1M
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pricingRows.map((row) => {
                    const ov = settings.pricingOverrides[row.id];
                    return (
                      <tr key={row.id} className="border-b border-border/60 last:border-0">
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-foreground">{row.label}</span>
                            <ProviderBadge provider={row.provider} />
                          </div>
                          <div className="text-xs text-muted-foreground">{row.id}</div>
                        </td>
                        <td className="px-2 py-2 text-right">
                          <RateInput
                            id={`in-${row.id}`}
                            ariaLabel={`Input rate for ${row.label} in USD per 1M tokens`}
                            value={ov?.inputPerMTok ?? null}
                            onChange={(raw) => setOverride(row.id, "inputPerMTok", raw)}
                          />
                        </td>
                        <td className="px-2 py-2 text-right">
                          <RateInput
                            id={`out-${row.id}`}
                            ariaLabel={`Output rate for ${row.label} in USD per 1M tokens`}
                            value={ov?.outputPerMTok ?? null}
                            onChange={(raw) => setOverride(row.id, "outputPerMTok", raw)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>

      {/* --- Sticky save bar -------------------------------------------------- */}
      <div className="pointer-events-none sticky bottom-0 z-20 -mx-4 px-4 pb-4 sm:-mx-6 sm:px-6">
        <div
          className={cn(
            "pointer-events-auto mx-auto flex max-w-4xl items-center justify-between gap-3 rounded-xl border bg-surface/95 px-4 py-3 shadow-soft-lg backdrop-blur transition-colors",
            dirty ? "border-accent/40" : "border-border"
          )}
        >
          <div className="min-w-0 text-xs text-muted-foreground">
            {dirty ? (
              <span className="font-medium text-foreground">Unsaved changes</span>
            ) : justSaved ? (
              <span className="flex items-center gap-1.5 font-medium text-success">
                <Check size={14} aria-hidden /> Saved
              </span>
            ) : savedLabel ? (
              <span>Last saved {savedLabel}</span>
            ) : (
              <span>No changes yet</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={discard}
              disabled={!dirty || saving}
            >
              <RotateCcw size={14} aria-hidden />
              Discard
            </Button>
            <Button type="button" size="sm" onClick={save} disabled={!dirty || saving}>
              {saving ? (
                <Loader2 size={14} className="animate-spin" aria-hidden />
              ) : (
                <Save size={14} aria-hidden />
              )}
              Save changes
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rate input — a small USD-per-1M number field with a subtle "$" prefix.
// ---------------------------------------------------------------------------

function RateInput({
  id,
  ariaLabel,
  value,
  onChange,
}: {
  id: string;
  ariaLabel: string;
  value: number | null;
  onChange: (raw: string) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1 shadow-soft focus-within:ring-2 focus-within:ring-ring">
      <span className="text-xs text-muted-foreground" aria-hidden>
        $
      </span>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        aria-label={ariaLabel}
        placeholder="default"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-20 bg-transparent text-right text-sm tabular-nums text-foreground outline-none placeholder:text-muted-foreground/60"
      />
    </div>
  );
}
