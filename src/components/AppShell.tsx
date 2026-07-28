"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ModelTier } from "@/lib/brain";
import { Sidebar, type SidebarProps } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";

interface AppShellContextValue {
  /** Selected model tier, shared between the TopBar switcher and the chat page. */
  tier: ModelTier;
  setTier: (tier: ModelTier) => void;
  /** Placeholder usage numbers; a later agent wires real metering. */
  usage: { usedTokens: number; tokenLimit: number };
  setUsage: (usage: { usedTokens: number; tokenLimit: number }) => void;
}

const AppShellContext = createContext<AppShellContextValue | null>(null);

/**
 * Read shell-level state (model tier, usage meter) from any client component
 * rendered inside the authenticated shell — e.g. the chat page reads `tier` to
 * forward it to /api/chat, and reports token usage back into the meter.
 */
export function useAppShell(): AppShellContextValue {
  const ctx = useContext(AppShellContext);
  if (!ctx) throw new Error("useAppShell must be used within <AppShell>");
  return ctx;
}

export interface AppShellProps
  extends Pick<
    SidebarProps,
    // Optional Sidebar wiring the history/projects agent provides; when omitted
    // the affordances stay inert (backward-compatible with a bare shell).
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
  initialTier?: ModelTier;
}

/**
 * Client shell: Sidebar on the left, TopBar on top, page content in the main
 * slot. Owns the cross-cutting model-tier and usage state and exposes it via
 * {@link useAppShell}. Behavior that needs the database (history, projects) is
 * left to the respective page agents through the Sidebar's handlers.
 */
export function AppShell({
  children,
  projects = [],
  conversations = [],
  activeConversationId = null,
  initialTier = "recommended",
  onNewChat,
  onNewProject,
  onSelectProject,
  onSelectConversation,
  onRenameConversation,
  onPinConversation,
  onDeleteConversation,
}: AppShellProps) {
  const router = useRouter();
  const [tier, setTier] = useState<ModelTier>(initialTier);
  const [usage, setUsage] = useState({ usedTokens: 0, tokenLimit: 100_000 });

  const value = useMemo<AppShellContextValue>(
    () => ({ tier, setTier, usage, setUsage }),
    [tier, usage]
  );

  return (
    <AppShellContext.Provider value={value}>
      <div className="flex h-screen overflow-hidden">
        <Sidebar
          projects={projects}
          conversations={conversations}
          activeConversationId={activeConversationId}
          // Fall back to the blank composer when no handler is wired.
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
            tier={tier}
            onTierChange={setTier}
            usedTokens={usage.usedTokens}
            tokenLimit={usage.tokenLimit}
          />
          <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    </AppShellContext.Provider>
  );
}
