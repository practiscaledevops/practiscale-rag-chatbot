"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import type { ModelTier } from "@/lib/brain";
import type { BrainModel } from "@/lib/models";
import { allowedModeDefs, DEFAULT_MODE, type WorkMode, type WorkModeDef } from "@/lib/work-modes";
import { Sidebar, type SidebarProps } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { CommandPalette } from "@/components/CommandPalette";
import { DEFAULT_OUTPUT_TYPE, isOutputType, type OutputType } from "@/lib/output-types";
import { PREFS_EVENT, readPrefs, type ChatPrefs } from "@/lib/prefs";
import { capabilitySet } from "@/lib/capabilities-client";

// ---------------------------------------------------------------------------
// Model selection
//
// A single selectable option in the model switcher. `value` is exactly what we
// forward to the Brain as the `model` field — either a TIER token
// ("fast"|"recommended"|"max", the Brain resolves it to a concrete model) or a
// CONCRETE model id ("claude-opus-4-8"). `tier` is the bucket we persist to
// conversations.model_tier (a checked enum), so a concrete pick still stores a
// valid tier. `kind` distinguishes the two for rendering.
// ---------------------------------------------------------------------------
export interface ModelOption {
  /** Sent to the Brain as `model` (tier token or concrete model id). */
  value: string;
  /** Human label for the switcher. */
  label: string;
  /** Short helper text under the label. */
  hint?: string;
  /** Persistable tier bucket (conversations.model_tier). */
  tier: ModelTier;
  /** Group key: "preset" | "anthropic" | "openai" | other provider. */
  provider: string;
  /** Whether the Brain reports this as currently selectable. */
  available: boolean;
  /** Why it is unavailable (shown subtly on disabled rows). */
  reason?: string;
  /** "tier" for the presets, "model" for concrete catalog entries. */
  kind: "tier" | "model";
}

// Friendly names for the three tiers (the concrete model still resolves in the
// Brain). "value" is the token forwarded to the Brain as `model`.
const TIER_LABELS: Record<ModelTier, { label: string; hint: string }> = {
  fast: { label: "Fast", hint: "Quick, lightweight answers" },
  recommended: { label: "Balanced", hint: "Balanced speed & quality" },
  max: { label: "Best quality", hint: "Deepest reasoning" },
};

const TIERS: ModelTier[] = ["fast", "recommended", "max"];

/** Stable default for `features`, so the memoized capability lookups don't churn. */
const NO_FEATURES: string[] = [];

/**
 * "Routed" presets that resolve SERVER-SIDE, not to a fixed model:
 *   Smart Route — the Brain picks Fast/Balanced/Best quality per question.
 *   Deep analysis — strongest tier + a thorough, structured analysis posture.
 * `tier` is only the persistable bucket; the real behaviour lives in the Brain.
 */
const ROUTED_PRESETS: ModelOption[] = [
  {
    value: "smart",
    label: "Smart Route",
    hint: "Auto-pick the best model per question",
    tier: "recommended",
    provider: "preset",
    available: true,
    kind: "tier",
  },
  {
    value: "deep",
    label: "Deep analysis",
    hint: "Thorough, structured, multi-angle",
    tier: "max",
    provider: "preset",
    available: true,
    kind: "tier",
  },
];

/** Build the tier-preset option for a tier token. */
export function tierPreset(tier: ModelTier): ModelOption {
  const meta = TIER_LABELS[tier];
  return {
    value: tier,
    label: meta.label,
    hint: meta.hint,
    tier,
    provider: "preset",
    available: true,
    kind: "tier",
  };
}

/** Map a concrete model id/tier to a persistable tier bucket. */
function bucketFor(model: BrainModel): ModelTier {
  if (model.tier && (TIERS as string[]).includes(model.tier)) {
    return model.tier as ModelTier;
  }
  const id = model.id.toLowerCase();
  if (/opus|gpt-5|o1|o3/.test(id)) return "max";
  if (/haiku|mini|nano|flash/.test(id)) return "fast";
  return "recommended";
}

/**
 * Assemble the switcher's full option list: the three tier presets first, then
 * every permitted catalog model (already filtered by permissions server-side).
 * Concrete models keep the Brain's availability flag so the UI can disable the
 * ones OpenAI/Anthropic can't currently serve.
 *
 * `presets: false` omits the tier/routed presets entirely — for a user confined
 * to a model allowlist, an alias resolves in the Brain to whichever model backs
 * that tier (possibly outside their allowlist; /api/chat rejects it), so they
 * choose a concrete model instead.
 */
export function buildModelOptions(
  catalog: BrainModel[],
  opts: { presets?: boolean } = {}
): ModelOption[] {
  // Smart Route first (the recommended default experience), then the three named
  // tiers, then Deep analysis, then every permitted concrete model.
  const smart = ROUTED_PRESETS.find((p) => p.value === "smart")!;
  const deep = ROUTED_PRESETS.find((p) => p.value === "deep")!;
  const tiers = TIERS.map(tierPreset);
  const models: ModelOption[] = catalog.map((m) => ({
    value: m.id,
    label: m.label || m.id,
    hint: undefined,
    tier: bucketFor(m),
    provider: m.provider || "other",
    available: m.available,
    reason: m.reason,
    kind: "model",
  }));
  if (opts.presets === false) return models;
  return [smart, ...tiers, deep, ...models];
}

/**
 * The switcher's starting selection: the workspace's concrete default model when
 * it is offered here, else the default tier's preset, else (no presets — an
 * allowlisted user) the first usable model in that tier, else the first usable
 * model at all. Falls back to the tier preset so `selection` is never empty.
 */
function initialSelection(
  options: ModelOption[],
  initialTier: ModelTier,
  initialModel: string | null
): ModelOption {
  const preferred = initialModel
    ? options.find((o) => o.kind === "model" && o.value === initialModel && o.available)
    : undefined;
  return (
    preferred ??
    options.find((o) => o.kind === "tier" && o.value === initialTier) ??
    options.find((o) => o.kind === "model" && o.available && o.tier === initialTier) ??
    options.find((o) => o.kind === "model" && o.available) ??
    tierPreset(initialTier)
  );
}

// ---------------------------------------------------------------------------
// Usage meter
// ---------------------------------------------------------------------------
export interface UsageState {
  /** Tokens accumulated this browser session (prompt + completion). */
  sessionTokens: number;
  /** Tokens billed on the most recent completed turn. */
  lastTurnTokens: number;
  /** Soft session budget the meter bar fills against. */
  budget: number;
}

interface AppShellContextValue {
  /** The selected model, shared between the TopBar switcher and the chat page. */
  selection: ModelOption;
  setSelection: (option: ModelOption) => void;
  /** All permitted options for the switcher (presets + catalog). */
  options: ModelOption[];
  /** Live token usage for this session. */
  usage: UsageState;
  /** Add a completed turn's usage (from the stream's finish part). */
  addUsage: (tokens: { promptTokens?: number; completionTokens?: number }) => void;
  /** The signed-in user's first name, for the greeting. */
  firstName: string;
  /** Display name + email (profile card, settings). */
  fullName: string;
  email: string;
  /** Profile picture URL, or null for initials. */
  avatarUrl: string | null;
  /** Whether the user may see the Admin link. */
  isAdmin: boolean;
  /** Active work mode (persona), forwarded to /api/chat. */
  mode: WorkMode;
  setMode: (m: WorkMode) => void;
  /** Work modes this user is allowed to select (restricted ones need admin). */
  modeDefs: WorkModeDef[];
  /** Response format for the next message (Settings default, composer override). */
  outputType: OutputType;
  setOutputType: (o: OutputType) => void;
  /**
   * The signed-in user's RESOLVED capability ids (SessionProfile.capabilities,
   * resolved server-side). Authoritative for the UI: an id that isn't listed is
   * off. Used only to HIDE controls; every route re-checks server-side.
   */
  capabilities: readonly string[];
  /** Whether the user holds capability `id` (e.g. "chat.source_scope"). */
  hasCap: (id: string) => boolean;
}

const AppShellContext = createContext<AppShellContextValue | null>(null);

/**
 * Read shell-level state (model selection, usage meter, identity) from any
 * client component inside the authenticated shell — the chat page reads
 * `selection` to forward it to /api/chat, and calls `addUsage` with the token
 * counts the Brain reports.
 */
export function useAppShell(): AppShellContextValue {
  const ctx = useContext(AppShellContext);
  if (!ctx) throw new Error("useAppShell must be used within <AppShell>");
  return ctx;
}

/**
 * Whether the signed-in user holds capability `id` — for hiding a control the
 * user can't use (hidden, not disabled). UI convenience only: the server
 * enforces every capability on its own.
 */
export function useCapability(id: string): boolean {
  return useAppShell().hasCap(id);
}

export interface AppShellProps
  extends Pick<
    SidebarProps,
    | "projects"
    | "conversations"
    | "activeConversationId"
    | "onNewChat"
    | "onNewProject"
    | "onSelectProject"
    | "activeProjectId"
    | "onRenameProject"
    | "onDeleteProject"
    | "onSelectConversation"
    | "onRenameConversation"
    | "onPinConversation"
    | "onArchiveConversation"
    | "onDeleteConversation"
    | "onBulkArchive"
    | "onBulkDelete"
  > {
  children: React.ReactNode;
  /** Permitted model catalog (from fetchBrainModels + permission filter). */
  models?: BrainModel[];
  /** The user has a model allowlist: hide the tier presets (see buildModelOptions). */
  restrictedToModels?: boolean;
  /** Default tier when a conversation hasn't pinned one yet. */
  initialTier?: ModelTier;
  /** Workspace default when it is a concrete model id (admin settings), else null. */
  initialModel?: string | null;
  /** Conversation title shown in the top bar. */
  title?: string | null;
  firstName?: string;
  /** Display name + email, for the sidebar profile card. */
  fullName?: string;
  email?: string;
  /** Profile picture URL, or null for initials. */
  avatarUrl?: string | null;
  isAdmin?: boolean;
  /**
   * The user's resolved capability ids (SessionProfile.capabilities): gates the
   * work modes offered, the sidebar links and the chat controls (see
   * {@link useCapability}). Treated as authoritative — missing means off.
   */
  features?: string[];
  /** Tokens already spent this month (persisted), used to seed the meter. */
  initialTokens?: number;
}

/**
 * Client shell: a dark Sidebar rail on the left, a TopBar (model switcher +
 * usage meter) on top, and the page content in the main slot. Owns the
 * cross-cutting model-selection and usage state (exposed via {@link useAppShell})
 * and the responsive sidebar (collapsible on desktop, a drawer on mobile).
 */
export function AppShell({
  children,
  projects = [],
  conversations = [],
  activeConversationId = null,
  models = [],
  restrictedToModels = false,
  initialTier = "recommended",
  initialModel = null,
  title = null,
  firstName = "",
  fullName = "",
  email = "",
  avatarUrl = null,
  isAdmin = false,
  features = NO_FEATURES,
  initialTokens = 0,
  onNewChat,
  onNewProject,
  onSelectProject,
  activeProjectId = null,
  onRenameProject,
  onDeleteProject,
  onSelectConversation,
  onRenameConversation,
  onPinConversation,
  onArchiveConversation,
  onDeleteConversation,
  onBulkArchive,
  onBulkDelete,
}: AppShellProps) {
  const router = useRouter();

  const options = useMemo(
    () => buildModelOptions(models, { presets: !restrictedToModels }),
    [models, restrictedToModels]
  );
  const [selection, setSelection] = useState<ModelOption>(() =>
    initialSelection(options, initialTier, initialModel)
  );
  // Seed with the user's persisted month-to-date tokens so the meter reflects
  // real cumulative usage across reloads; live turns add on top of it.
  const [usage, setUsage] = useState<UsageState>({
    sessionTokens: Math.max(0, initialTokens),
    lastTurnTokens: 0,
    budget: 200_000,
  });

  const addUsage = useCallback(
    ({ promptTokens = 0, completionTokens = 0 }) => {
      const turn = Math.max(0, promptTokens) + Math.max(0, completionTokens);
      if (!Number.isFinite(turn) || turn === 0) return;
      setUsage((u) => ({
        ...u,
        sessionTokens: u.sessionTokens + turn,
        lastTurnTokens: turn,
      }));
    },
    []
  );

  // Work mode (persona). Restricted modes are gated by role OR a granted feature;
  // the API re-checks and downgrades a disallowed mode. We only offer the ones
  // this user may use.
  const modeDefs = useMemo(
    () => allowedModeDefs({ role: isAdmin ? "admin" : "user", features }),
    [isAdmin, features]
  );
  const [mode, setMode] = useState<WorkMode>(DEFAULT_MODE);
  const [outputType, setOutputType] = useState<OutputType>(DEFAULT_OUTPUT_TYPE);

  // Apply the user's saved defaults (Settings page) on load, and again whenever
  // they change them. Only values this user may actually use are applied.
  useEffect(() => {
    function apply(p: ChatPrefs) {
      if (p.model) {
        const opt = options.find((o) => o.value === p.model && o.available);
        if (opt) setSelection(opt);
      }
      if (p.mode && modeDefs.some((m) => m.id === p.mode)) setMode(p.mode);
      if (isOutputType(p.outputType)) setOutputType(p.outputType);
    }
    apply(readPrefs());
    const onChange = (e: Event) => apply((e as CustomEvent<ChatPrefs>).detail ?? {});
    window.addEventListener(PREFS_EVENT, onChange);
    return () => window.removeEventListener(PREFS_EVENT, onChange);
  }, [options, modeDefs]);

  // Responsive sidebar: a drawer on mobile, collapsible on desktop.
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Command palette (⌘K / Ctrl+K). Global toggle from anywhere in the shell.
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Capability gating for the chrome and the chat controls. The resolved list
  // is authoritative (a missing id is off) — this only hides UI; the routes
  // enforce every capability server-side.
  const capSet = useMemo(() => capabilitySet(features), [features]);
  const capabilities = useMemo(() => Array.from(capSet), [capSet]);
  const hasCap = useCallback((id: string) => capSet.has(id), [capSet]);

  const value = useMemo<AppShellContextValue>(
    () => ({ selection, setSelection, options, usage, addUsage, firstName, fullName, email, avatarUrl, isAdmin, mode, setMode, modeDefs, outputType, setOutputType, capabilities, hasCap }),
    [selection, options, usage, addUsage, firstName, fullName, email, avatarUrl, isAdmin, mode, modeDefs, outputType, capabilities, hasCap]
  );

  return (
    <AppShellContext.Provider value={value}>
      {/* relative: the frame is the containing block for absolutely positioned
          descendants (sr-only labels, popovers). Without it they resolve against
          the page, and one deep in a long scrolled page makes the whole document
          taller than the window — the page then scrolls, leaving a blank strip. */}
      <div className="relative flex h-app overflow-hidden bg-sidebar">
        {/* Mobile scrim */}
        {mobileOpen && (
          <div
            className="fixed inset-x-0 bottom-0 top-[var(--titlebar-h)] z-30 bg-[#111315]/30 backdrop-blur-[3px] lg:hidden"
            aria-hidden
            onClick={() => setMobileOpen(false)}
          />
        )}

        <Sidebar
          projects={projects}
          conversations={conversations}
          activeConversationId={activeConversationId}
          isAdmin={isAdmin}
          capabilities={capabilities}
          fullName={fullName}
          email={email}
          avatarUrl={avatarUrl}
          mobileOpen={mobileOpen}
          collapsed={collapsed}
          onCloseMobile={() => setMobileOpen(false)}
          onCollapse={() => setCollapsed(true)}
          onNewChat={onNewChat ?? (() => router.push("/"))}
          onNewProject={onNewProject}
          onSelectProject={onSelectProject}
          activeProjectId={activeProjectId}
          onRenameProject={onRenameProject}
          onDeleteProject={onDeleteProject}
          onSelectConversation={onSelectConversation}
          onRenameConversation={onRenameConversation}
          onPinConversation={onPinConversation}
          onArchiveConversation={onArchiveConversation}
          onDeleteConversation={onDeleteConversation}
          onBulkArchive={onBulkArchive}
          onBulkDelete={onBulkDelete}
        />

        <div className="flex min-w-0 flex-1 flex-col bg-background">
          <TopBar
            title={title}
            usage={usage}
            collapsed={collapsed}
            onOpenMobile={() => setMobileOpen(true)}
            onExpand={() => setCollapsed(false)}
          />
          <main className="relative min-h-0 flex-1 overflow-hidden">{children}</main>
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        isAdmin={isAdmin}
        conversations={conversations}
        modeDefs={modeDefs}
        activeMode={mode}
        onSelectMode={setMode}
        options={options}
        onSelectModel={setSelection}
        onNewChat={onNewChat ?? (() => router.push("/"))}
        onSelectConversation={onSelectConversation}
      />
    </AppShellContext.Provider>
  );
}
