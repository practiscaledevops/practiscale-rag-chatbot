"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import type { ModelTier } from "@/lib/brain";
import type { BrainModel } from "@/lib/models";
import { Sidebar, type SidebarProps } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";

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

const TIER_LABELS: Record<ModelTier, { label: string; hint: string }> = {
  fast: { label: "Fast", hint: "Fastest, lightweight answers" },
  recommended: { label: "Recommended", hint: "Balanced speed & quality" },
  max: { label: "Max", hint: "Deepest reasoning" },
};

const TIERS: ModelTier[] = ["fast", "recommended", "max"];

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
 */
export function buildModelOptions(catalog: BrainModel[]): ModelOption[] {
  const presets = TIERS.map(tierPreset);
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
  return [...presets, ...models];
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
  /** Whether the user may see the Admin link. */
  isAdmin: boolean;
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

export interface AppShellProps
  extends Pick<
    SidebarProps,
    | "projects"
    | "conversations"
    | "activeConversationId"
    | "onNewChat"
    | "onNewProject"
    | "onSelectProject"
    | "onSelectConversation"
    | "onRenameConversation"
    | "onPinConversation"
    | "onDeleteConversation"
  > {
  children: React.ReactNode;
  /** Permitted model catalog (from fetchBrainModels + permission filter). */
  models?: BrainModel[];
  /** Default tier when a conversation hasn't pinned one yet. */
  initialTier?: ModelTier;
  /** Conversation title shown in the top bar. */
  title?: string | null;
  firstName?: string;
  isAdmin?: boolean;
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
  initialTier = "recommended",
  title = null,
  firstName = "",
  isAdmin = false,
  onNewChat,
  onNewProject,
  onSelectProject,
  onSelectConversation,
  onRenameConversation,
  onPinConversation,
  onDeleteConversation,
}: AppShellProps) {
  const router = useRouter();

  const options = useMemo(() => buildModelOptions(models), [models]);
  const [selection, setSelection] = useState<ModelOption>(() =>
    tierPreset(initialTier)
  );
  const [usage, setUsage] = useState<UsageState>({
    sessionTokens: 0,
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

  // Responsive sidebar: a drawer on mobile, collapsible on desktop.
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const value = useMemo<AppShellContextValue>(
    () => ({ selection, setSelection, options, usage, addUsage, firstName, isAdmin }),
    [selection, options, usage, addUsage, firstName, isAdmin]
  );

  return (
    <AppShellContext.Provider value={value}>
      <div className="flex h-screen overflow-hidden bg-background">
        {/* Mobile scrim */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-30 bg-foreground/40 backdrop-blur-sm lg:hidden"
            aria-hidden
            onClick={() => setMobileOpen(false)}
          />
        )}

        <Sidebar
          projects={projects}
          conversations={conversations}
          activeConversationId={activeConversationId}
          isAdmin={isAdmin}
          mobileOpen={mobileOpen}
          collapsed={collapsed}
          onCloseMobile={() => setMobileOpen(false)}
          onCollapse={() => setCollapsed(true)}
          onNewChat={onNewChat ?? (() => router.push("/"))}
          onNewProject={onNewProject}
          onSelectProject={onSelectProject}
          onSelectConversation={onSelectConversation}
          onRenameConversation={onRenameConversation}
          onPinConversation={onPinConversation}
          onDeleteConversation={onDeleteConversation}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            title={title}
            selection={selection}
            options={options}
            onSelect={setSelection}
            usage={usage}
            collapsed={collapsed}
            onOpenMobile={() => setMobileOpen(true)}
            onExpand={() => setCollapsed(false)}
          />
          <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
        </div>
      </div>
    </AppShellContext.Provider>
  );
}
