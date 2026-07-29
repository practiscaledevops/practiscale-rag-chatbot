"use client";

import { Menu, PanelLeftOpen } from "lucide-react";
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
 * Token meter for the current session. Shows the running token count and a thin
 * budget bar; the tooltip breaks out the most recent turn and the soft budget.
 */
function UsageMeter({ usage }: { usage: UsageState }) {
  const { sessionTokens, lastTurnTokens, budget } = usage;
  const pct = budget > 0 ? Math.min(100, (sessionTokens / budget) * 100) : 0;
  // Warm the bar toward the warning colour as the budget fills.
  const barColor =
    pct >= 90 ? "bg-danger" : pct >= 70 ? "bg-warning" : "bg-accent";

  return (
    <div
      className="flex items-center gap-2"
      title={`${sessionTokens.toLocaleString()} tokens this session · last turn ${lastTurnTokens.toLocaleString()} · soft budget ${budget.toLocaleString()}`}
    >
      <span className="hidden tabular-nums text-xs font-medium text-muted-foreground sm:inline">
        {sessionTokens.toLocaleString()}
        <span className="ml-1 hidden text-muted-foreground/70 md:inline">tokens</span>
      </span>
      <div
        className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-surface-muted sm:block"
        role="progressbar"
        aria-label="Session token usage"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn("h-full rounded-full transition-all", barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
