"use client";

import { Menu, PanelLeftOpen, Sparkles } from "lucide-react";
import type { ModelOption, UsageState } from "@/components/AppShell";
import { ModelSelector } from "@/components/ModelSelector";
import { IconButton } from "@/components/IconButton";
import { cn } from "@/lib/utils";

export interface TopBarProps {
  /** Conversation title, or a neutral default. */
  title?: string | null;

  /** Model switcher state. */
  selection: ModelOption;
  options: ModelOption[];
  onSelect: (option: ModelOption) => void;

  /** Session token usage. */
  usage: UsageState;

  /** Sidebar controls. */
  collapsed?: boolean;
  onOpenMobile?: () => void;
  onExpand?: () => void;

  className?: string;
}

/**
 * App top bar: sidebar toggles on the left, then the conversation title; a token
 * usage meter and the provider-grouped model switcher on the right. Usage is fed
 * by the token counts the Brain reports on each finished turn (see ChatView).
 */
export function TopBar({
  title,
  selection,
  options,
  onSelect,
  usage,
  collapsed = false,
  onOpenMobile,
  onExpand,
  className,
}: TopBarProps) {
  return (
    <header
      className={cn(
        "flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface/80 px-3 backdrop-blur sm:px-4",
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {/* Mobile: open the drawer. */}
        <IconButton
          aria-label="Open sidebar"
          className="lg:hidden"
          onClick={onOpenMobile}
        >
          <Menu size={18} />
        </IconButton>
        {/* Desktop: reopen a collapsed sidebar. */}
        {collapsed && (
          <IconButton
            aria-label="Expand sidebar"
            className="hidden lg:inline-flex"
            onClick={onExpand}
          >
            <PanelLeftOpen size={18} />
          </IconButton>
        )}
        <h1 className="truncate text-sm font-semibold text-foreground">
          {title || "New chat"}
        </h1>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <UsageMeter usage={usage} />
        <ModelSelector
          selection={selection}
          options={options}
          onSelect={onSelect}
        />
      </div>
    </header>
  );
}

/**
 * Token counter for the current month. Seeded from the user's persisted
 * month-to-date usage and incremented live per turn. Informational only — there
 * is no budget cap or limit bar.
 */
function UsageMeter({ usage }: { usage: UsageState }) {
  const { sessionTokens, lastTurnTokens } = usage;

  return (
    <div
      className="hidden items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 sm:flex"
      title={`${sessionTokens.toLocaleString()} tokens this month · last turn ${lastTurnTokens.toLocaleString()}`}
    >
      <Sparkles size={13} className="text-accent" aria-hidden />
      <span className="tabular-nums text-xs font-medium text-muted-foreground">
        {sessionTokens.toLocaleString()}
        <span className="ml-1 hidden text-muted-foreground/70 md:inline">tokens this month</span>
      </span>
    </div>
  );
}
