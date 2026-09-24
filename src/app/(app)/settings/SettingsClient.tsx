"use client";

// Assistant settings (reference "Qubi" prompt-settings screen):
//   header card with Save changes · a connection card · "Your saved prompts" ·
//   "Your output" (response-format chips) · a right panel with the default
//   model, work mode, response format and "Search in" knowledge scope (+ an
//   optional collection narrowing).
// Defaults are stored per browser (lib/prefs) and applied to new chats; the
// composer can still override any of them per message.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Brain,
  Check,
  ChevronRight,
  ChevronsUpDown,
  Loader2,
  Monitor,
  Moon,
  Palette,
  PenLine,
  Plus,
  ShieldCheck,
  Sparkles,
  Sun,
  Wand2,
} from "lucide-react";
import { useAppShell } from "@/components/AppShell";
import { OrbAvatar } from "@/components/OrbAvatar";
import { onRadioGroupKeyDown, radioTabIndex } from "@/lib/a11y";
import { Button } from "@/components/Button";
import { PromptLibrary, type UserPrompt } from "../_components/PromptLibrary";
import { knowledgeScopeIcon, useSearchOptions } from "../_components/ComposerControls";
import { OUTPUT_TYPES, type OutputType } from "@/lib/output-types";
import { readPrefs, writePrefs, type ChatPrefs } from "@/lib/prefs";
import { DEFAULT_KNOWLEDGE_SCOPE, isKnowledgeScopeId, type KnowledgeScope } from "@/lib/knowledge-scopes";
import { useTheme, type ThemePref } from "@/lib/theme";
import type { WorkMode } from "@/lib/work-modes";
import { cn } from "@/lib/utils";

const PANEL = "rounded-2xl border border-border bg-surface-muted/60";

export function SettingsClient() {
  const router = useRouter();
  const { options, selection, mode, modeDefs, outputType, email, fullName } = useAppShell();

  // Draft of the defaults, seeded from what's active now + saved prefs.
  const [draft, setDraft] = useState<Required<ChatPrefs>>(() => ({
    model: selection.value,
    mode,
    outputType,
    knowledgeScope: DEFAULT_KNOWLEDGE_SCOPE,
    collectionIds: [],
    responseFont: "serif",
  }));
  // The "Narrow to collections" list starts open only when some are chosen.
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [saved, setSaved] = useState<Required<ChatPrefs> | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    const p = readPrefs();
    const next: Required<ChatPrefs> = {
      model: p.model && options.some((o) => o.value === p.model && o.available) ? p.model : selection.value,
      mode: p.mode && modeDefs.some((m) => m.id === p.mode) ? p.mode : mode,
      outputType: (p.outputType as OutputType) ?? outputType,
      knowledgeScope: isKnowledgeScopeId(p.knowledgeScope) ? p.knowledgeScope : DEFAULT_KNOWLEDGE_SCOPE,
      collectionIds: Array.isArray(p.collectionIds) ? p.collectionIds : [],
      responseFont: p.responseFont === "sans" ? "sans" : "serif",
    };
    setDraft(next);
    setSaved(next);
    setCollectionsOpen(next.collectionIds.length > 0);
    // Seed once on mount; later shell changes shouldn't clobber the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty = useMemo(() => !saved || JSON.stringify(saved) !== JSON.stringify(draft), [saved, draft]);

  const save = useCallback(
    (thenChat = false) => {
      writePrefs(draft);
      setSaved(draft);
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 1800);
      if (thenChat) router.push("/");
    },
    [draft, router]
  );

  // --- Appearance (applies instantly, no Save needed) -----------------------
  const [theme, setTheme] = useTheme();
  const setResponseFont = useCallback((font: "serif" | "sans") => {
    setDraft((d) => ({ ...d, responseFont: font }));
    setSaved((sv) => (sv ? { ...sv, responseFont: font } : sv));
    writePrefs({ ...readPrefs(), responseFont: font });
  }, []);

  // --- Saved prompts -----------------------------------------------------
  const [prompts, setPrompts] = useState<UserPrompt[] | null>(null);
  const [promptsError, setPromptsError] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const loadPrompts = useCallback(async () => {
    try {
      const res = await fetch("/api/prompts", { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as { prompts?: UserPrompt[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Couldn't load prompts");
      setPrompts(json.prompts ?? []);
      setPromptsError(null);
    } catch (e) {
      setPrompts([]);
      setPromptsError(e instanceof Error ? e.message : "Couldn't load prompts");
    }
  }, []);
  useEffect(() => {
    void loadPrompts();
  }, [loadPrompts]);

  // --- Knowledge: "Search in" scopes + collections --------------------------
  const searchOptions = useSearchOptions();
  const scopes = searchOptions?.scopes ?? null;
  const collections = searchOptions?.collections ?? [];
  // A saved scope this user can no longer pick shows (and sends) as Auto.
  const effectiveScope =
    scopes && !scopes.some((s) => s.id === draft.knowledgeScope) ? DEFAULT_KNOWLEDGE_SCOPE : draft.knowledgeScope;

  const usableModels = options.filter((o) => o.available);
  const quickTiers = options.filter((o) => o.kind === "tier" && ["fast", "recommended", "max"].includes(o.value));

  return (
    <div className="h-full overflow-y-auto">
      <PromptLibrary
        open={libraryOpen}
        onClose={() => {
          setLibraryOpen(false);
          void loadPrompts();
        }}
        onInsert={(body) => router.push(`/?prompt=${encodeURIComponent(body.slice(0, 4000))}`)}
      />

      <div className="mx-auto w-full max-w-6xl px-4 pb-8 pt-6 sm:px-6">
        {/* Header card */}
        <div className={cn(PANEL, "flex items-center justify-between gap-4 px-4 py-3")}>
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center">
              <OrbAvatar size={28} />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold leading-7 tracking-tight">Assistant settings</h1>
              <p className="hidden truncate text-[13px] leading-5 text-muted-foreground sm:block">
                Defaults for every new chat. Change any of them per message in the composer.
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => save()}
            disabled={!dirty && !justSaved}
            className="h-8 shrink-0 text-[13px] shadow-soft"
          >
            {justSaved ? <Check size={14} className="text-accent" aria-hidden /> : null}
            {justSaved ? (
              "Saved"
            ) : (
              <>
                <span className="sm:hidden">Save</span>
                <span className="hidden sm:inline">Save changes</span>
              </>
            )}
          </Button>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-4">
            {/* Connection card */}
            <div className={cn(PANEL, "flex items-center gap-3 px-4 py-3")}>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface shadow-soft">
                <Brain size={16} className="text-accent" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-5">PractiScale Brain</p>
                <p className="truncate text-xs leading-4 text-muted-foreground">
                  {email ? `Signed in as ${fullName ? `${fullName} · ` : ""}${email}` : "Your company knowledge base"}
                </p>
              </div>
              <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-tea px-2.5 text-[11px] font-medium text-tea-foreground">
                <Check size={12} aria-hidden /> Connected
              </span>
            </div>

            {/* Appearance */}
            <section className={cn(PANEL, "px-4 py-3.5")} aria-labelledby="set-appearance">
              <h2 id="set-appearance" className="flex items-center gap-2 text-sm font-semibold">
                <Palette size={16} className="shrink-0" aria-hidden /> Appearance
              </h2>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-[13px] font-medium leading-5">Theme</p>
                  <p className="text-xs text-muted-foreground">Applies right away on this device.</p>
                  <Segmented<ThemePref>
                    label="Theme"
                    value={theme}
                    onChange={setTheme}
                    options={[
                      { value: "light", label: "Light", icon: <Sun size={14} aria-hidden /> },
                      { value: "dark", label: "Dark", icon: <Moon size={14} aria-hidden /> },
                      { value: "system", label: "System", icon: <Monitor size={14} aria-hidden /> },
                    ]}
                  />
                </div>
                <div>
                  <p className="text-[13px] font-medium leading-5">Answer font</p>
                  <p className="text-xs text-muted-foreground">The typeface assistant answers are set in.</p>
                  <Segmented<"serif" | "sans">
                    label="Answer font"
                    value={draft.responseFont}
                    onChange={setResponseFont}
                    options={[
                      { value: "serif", label: "Serif", icon: <span className="font-serif text-[15px] leading-none" aria-hidden>Aa</span> },
                      { value: "sans", label: "Sans", icon: <span className="font-sans text-[14px] leading-none" aria-hidden>Aa</span> },
                    ]}
                  />
                </div>
              </div>
            </section>

            <div className="grid gap-4 md:grid-cols-2">
              {/* Saved prompts */}
              <section className={cn(PANEL, "flex min-h-[340px] min-w-0 flex-col")} aria-labelledby="set-prompts">
                <header className="flex h-12 shrink-0 items-center justify-between gap-2 px-4">
                  <h2 id="set-prompts" className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                    <PenLine size={16} className="shrink-0" aria-hidden /> <span className="truncate">Your saved prompts</span>
                  </h2>
                  <button
                    type="button"
                    onClick={() => setLibraryOpen(true)}
                    className="inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-surface px-3 text-xs font-medium shadow-soft transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Plus size={14} aria-hidden /> Add prompt
                  </button>
                </header>
                <div className="flex-1 space-y-2 px-4 pb-4">
                  {prompts === null ? (
                    <div className="flex items-center gap-2 px-1 py-6 text-[13px] text-muted-foreground">
                      <Loader2 size={14} className="animate-spin" aria-hidden /> Loading…
                    </div>
                  ) : prompts.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
                      {promptsError ?? "Save prompts you use often, then drop them into any chat."}
                    </div>
                  ) : (
                    prompts.slice(0, 8).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => router.push(`/?prompt=${encodeURIComponent(p.body.slice(0, 4000))}`)}
                        title="Start a chat with this prompt"
                        className="block w-full rounded-xl bg-surface px-3 py-2.5 text-left shadow-soft transition-[box-shadow,transform] duration-200 hover:-translate-y-px hover:shadow-float focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="block truncate text-[13px] font-medium leading-5 text-foreground">{p.title}</span>
                        <span className="mt-0.5 line-clamp-2 block text-xs leading-[18px] text-muted-foreground">{p.body}</span>
                      </button>
                    ))
                  )}
                  {prompts && prompts.length > 8 && (
                    <button
                      type="button"
                      onClick={() => setLibraryOpen(true)}
                      className="h-8 w-full rounded-full px-3 text-[13px] font-medium text-accent-strong hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      View all {prompts.length} prompts
                    </button>
                  )}
                </div>
              </section>

              {/* Response format */}
              <section className={cn(PANEL, "flex min-h-[340px] min-w-0 flex-col")} aria-labelledby="set-output">
                <header className="flex h-12 shrink-0 items-center justify-between gap-2 px-4">
                  <h2 id="set-output" className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                    <Wand2 size={16} className="shrink-0" aria-hidden /> <span className="truncate">Your output</span>
                  </h2>
                  <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">Response format</span>
                </header>
                <div
                  className="flex flex-wrap gap-2 px-4"
                  role="radiogroup"
                  aria-labelledby="set-output"
                  onKeyDown={onRadioGroupKeyDown}
                >
                  {OUTPUT_TYPES.map((o, i) => {
                    const on = draft.outputType === o.id;
                    return (
                      <button
                        key={o.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        tabIndex={radioTabIndex(on, i, OUTPUT_TYPES.some((x) => x.id === draft.outputType))}
                        title={o.hint}
                        onClick={() => setDraft((d) => ({ ...d, outputType: o.id }))}
                        className={cn(
                          "inline-flex h-8 items-center gap-1 rounded-full px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          on
                            ? "bg-accent-soft text-accent-strong ring-1 ring-inset ring-accent/30"
                            : "bg-surface text-foreground shadow-soft hover:bg-surface-sunken"
                        )}
                      >
                        {on && <Check size={14} className="-ml-0.5 shrink-0" aria-hidden />}
                        {o.label}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-auto px-4 pb-4 pt-5">
                  <div className="rounded-xl bg-surface p-3.5 shadow-soft">
                    <p className="flex items-center gap-2 text-[13px] font-semibold leading-5">
                      <Sparkles size={14} className="shrink-0 text-accent" aria-hidden />
                      {OUTPUT_TYPES.find((o) => o.id === draft.outputType)?.label ?? "Answer"}
                    </p>
                    <p className="mt-1 text-xs leading-[18px] text-muted-foreground">
                      {OUTPUT_TYPES.find((o) => o.id === draft.outputType)?.hint}. New answers start in this format; the
                      Brain never invents data to fill a shape.
                    </p>
                  </div>
                </div>
              </section>
            </div>
          </div>

          {/* Right panel: defaults */}
          <aside className={cn(PANEL, "flex min-w-0 flex-col p-4")} aria-label="Chat defaults">
            <Field label="Model">
              <Select
                value={draft.model}
                onChange={(v) => setDraft((d) => ({ ...d, model: v }))}
                icon={<OrbAvatar size={16} />}
              >
                {(["tier", "model"] as const).map((kind) => {
                  const group = usableModels.filter((o) => o.kind === kind);
                  if (group.length === 0) return null;
                  return (
                    <optgroup key={kind} label={kind === "tier" ? "Quality" : "Specific models"}>
                      {group.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </Select>
            </Field>

            <Field label="Work mode">
              <Select value={draft.mode} onChange={(v) => setDraft((d) => ({ ...d, mode: v as WorkMode }))} icon={<Sparkles size={16} className="text-accent" />}>
                {modeDefs.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] font-medium">Response format</span>
              <div className="w-36">
                <Select value={draft.outputType} onChange={(v) => setDraft((d) => ({ ...d, outputType: v as OutputType }))}>
                  {OUTPUT_TYPES.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="mt-4">
              <p id="set-knowledge" className="text-[13px] font-medium leading-5">
                Search in
              </p>
              <p className="text-xs text-muted-foreground">Which knowledge new chats search.</p>
              <div
                className="mt-2 space-y-0.5"
                role="radiogroup"
                aria-labelledby="set-knowledge"
                onKeyDown={onRadioGroupKeyDown}
              >
                {scopes === null ? (
                  <p className="flex h-8 items-center px-3 text-xs text-muted-foreground">Loading…</p>
                ) : (
                  scopes.map((s, i) => (
                    <ScopeOption
                      key={s.id}
                      scope={s}
                      checked={effectiveScope === s.id}
                      tabIndex={radioTabIndex(effectiveScope === s.id, i, scopes.some((x) => x.id === effectiveScope))}
                      onClick={() => setDraft((d) => ({ ...d, knowledgeScope: s.id }))}
                    />
                  ))
                )}
              </div>
              {collections.length > 0 && (
                <div className="mt-2">
                  <button
                    type="button"
                    aria-expanded={collectionsOpen}
                    onClick={() => setCollectionsOpen((o) => !o)}
                    className="flex h-8 w-full items-center gap-2 rounded-lg px-3 text-left text-[13px] font-medium transition-colors hover:bg-surface/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ChevronRight
                      size={14}
                      className={cn("shrink-0 text-muted-foreground transition-transform", collectionsOpen && "rotate-90")}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate">Narrow to collections (optional)</span>
                    {draft.collectionIds.length > 0 && (
                      <span className="shrink-0 text-xs font-normal text-muted-foreground">{draft.collectionIds.length} selected</span>
                    )}
                  </button>
                  {collectionsOpen && (
                    <div className="mt-0.5 space-y-0.5">
                      {collections.map((c) => {
                        const on = draft.collectionIds.includes(c.id);
                        return (
                          <ScopeRow
                            key={c.id}
                            label={c.name}
                            checked={on}
                            onClick={() =>
                              setDraft((d) => ({
                                ...d,
                                collectionIds: on ? d.collectionIds.filter((x) => x !== c.id) : [...d.collectionIds, c.id],
                              }))
                            }
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {quickTiers.length > 0 && (
              <div className="mt-4">
                <p className="text-[13px] font-medium leading-5">Quick presets</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {quickTiers.map((o) => {
                    const on = draft.model === o.value;
                    return (
                      <button
                        key={o.value}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setDraft((d) => ({ ...d, model: o.value }))}
                        className={cn(
                          "inline-flex h-8 items-center rounded-full px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          on ? "bg-ink text-ink-foreground" : "bg-surface text-foreground shadow-soft hover:bg-surface-sunken"
                        )}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-auto pt-6">
              <Button variant="tea" size="lg" className="w-full" onClick={() => save(true)}>
                <Plus size={16} aria-hidden />
                Save & start a new chat
              </Button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

/** A compact segmented control (radio group) for small, exclusive choices. */
function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: React.ReactNode }[];
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onRadioGroupKeyDown}
      className="mt-2 inline-flex rounded-xl bg-surface p-0.5 shadow-soft"
    >
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={radioTabIndex(on, i, options.some((x) => x.value === value))}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? "bg-accent-soft text-accent-strong" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-4 block">
      <span className="mb-2 block text-[13px] font-medium leading-5">{label}</span>
      {children}
    </label>
  );
}

/** A native select dressed as the kit's rounded field with a ⇅ affordance. */
function Select({
  value,
  onChange,
  children,
  icon,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <span className="relative block">
      {icon && (
        <span className="pointer-events-none absolute left-3 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center">
          {icon}
        </span>
      )}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "h-9 w-full cursor-pointer appearance-none truncate rounded-xl bg-surface pr-8 text-sm font-medium text-foreground shadow-soft outline-none transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          icon ? "pl-9" : "pl-3"
        )}
      >
        {children}
      </select>
      <ChevronsUpDown
        size={14}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
    </span>
  );
}

/** One "Search in" knowledge scope: icon, label, one-line description, a check when chosen. */
function ScopeOption({
  scope,
  checked,
  tabIndex,
  onClick,
}: {
  scope: KnowledgeScope;
  checked: boolean;
  /** Roving tabindex within the radiogroup (lib/a11y radioTabIndex). */
  tabIndex: 0 | -1;
  onClick: () => void;
}) {
  const Icon = knowledgeScopeIcon(scope.id);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      tabIndex={tabIndex}
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg px-3 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        checked ? "bg-surface shadow-soft" : "hover:bg-surface/70"
      )}
    >
      <Icon size={14} className={cn("mt-[3px] shrink-0", checked ? "text-accent" : "text-muted-foreground")} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[13px] font-medium leading-5">
          {scope.label}
          {scope.sensitive && <ShieldCheck size={12} className="shrink-0 text-accent" aria-label="Sensitive data" />}
        </span>
        {scope.description && <span className="block text-xs leading-4 text-muted-foreground">{scope.description}</span>}
      </span>
      {checked && <Check size={14} className="mt-[3px] shrink-0 text-accent" aria-hidden />}
    </button>
  );
}

function ScopeRow({ label, checked, onClick }: { label: string; checked: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onClick}
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-lg px-3 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        checked ? "bg-surface shadow-soft" : "hover:bg-surface/70"
      )}
    >
      <span
        className={cn(
          "grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border",
          checked ? "border-accent bg-accent text-accent-foreground" : "border-border bg-surface"
        )}
        aria-hidden
      >
        {checked && <Check size={12} />}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}
