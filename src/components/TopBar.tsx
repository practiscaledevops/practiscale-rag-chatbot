"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrainCircuit, Menu, PanelLeftOpen, Settings, Sparkles } from "lucide-react";
import type { UsageState } from "@/components/AppShell";
import { NotificationsBell } from "@/components/NotificationsBell";
import { PwaInstall } from "@/components/PwaInstall";
import { IconButton } from "@/components/IconButton";
import { cn } from "@/lib/utils";

export interface TopBarProps {
  /** Conversation title, shown muted next to the wordmark. */
  title?: string | null;

  /** Month-to-date token usage. */
  usage: UsageState;

  /** Sidebar controls. */
  collapsed?: boolean;
  /** Chats generating off screen: a dot on the sidebar toggle (whose spinners are hidden then). */
  backgroundGenerating?: number;
  onOpenMobile?: () => void;
  onExpand?: () => void;

  className?: string;
}

/**
 * Workspace header (reference "Qubi" layout): the PractiScale wordmark on the
 * left (with the open conversation's title), and pills on the right — a
 * tea-green usage pill, notifications, and the dark Settings pill.
 */
export function TopBar({
  title,
  usage,
  collapsed = false,
  backgroundGenerating = 0,
  onOpenMobile,
  onExpand,
  className,
}: TopBarProps) {
  const pathname = usePathname();
  const onSettings = pathname.startsWith("/settings");
  // Both toggles only show while the rail is hidden (Menu below lg, Expand
  // when collapsed), exactly when the sidebar's row spinners can't be seen.
  // The count goes in the label (an aria-label overrides the button's text).
  const generating =
    backgroundGenerating > 0
      ? `, ${backgroundGenerating} chat${backgroundGenerating === 1 ? "" : "s"} generating`
      : "";
  const generatingDot = backgroundGenerating > 0 && (
    <span aria-hidden className="absolute right-1 top-1 h-2 w-2 rounded-full bg-accent motion-safe:animate-pulse" />
  );
  return (
    <header
      className={cn(
        "flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-background px-4 sm:px-6",
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <IconButton aria-label={`Open sidebar${generating}`} className="relative lg:hidden" onClick={onOpenMobile}>
          <Menu size={18} />
          {generatingDot}
        </IconButton>
        {collapsed && (
          <IconButton aria-label={`Expand sidebar${generating}`} className="relative hidden lg:inline-flex" onClick={onExpand}>
            <PanelLeftOpen size={16} />
            {generatingDot}
          </IconButton>
        )}
        {/* Product mark: brain icon + "Practiscale" (dark green) + "Intelligent
            Operations" (black). The open thread's title follows on wide screens. */}
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href="/"
            className="flex min-w-0 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Practiscale Intelligent Operations — home"
          >
            <BrainCircuit size={20} strokeWidth={2} className="shrink-0 text-accent" aria-hidden />
            <span className="shrink-0 text-[17px] font-bold leading-none tracking-[-0.02em] text-accent-deep">Practiscale</span>
            <span className="hidden min-w-0 truncate text-[17px] font-semibold leading-none tracking-[-0.02em] text-foreground md:inline">
              Intelligent Operations
            </span>
          </Link>
          {title && (
            <span className="hidden min-w-0 items-center gap-2 xl:flex">
              <span className="text-sm font-light text-subtle-foreground" aria-hidden>
                /
              </span>
              <span className="truncate text-[13px] font-medium text-muted-foreground">{title}</span>
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <UsagePill usage={usage} />
        <PwaInstall />
        <NotificationsBell />
        <Link
          href="/settings"
          aria-label="Settings"
          title="Settings"
          aria-current={onSettings ? "page" : undefined}
          className="inline-flex h-8 w-8 items-center justify-center gap-1.5 rounded-full bg-ink text-[13px] font-medium text-ink-foreground transition-colors hover:bg-ink-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:w-auto sm:px-3"
        >
          <Settings size={14} aria-hidden />
          <span className="hidden sm:inline">Settings</span>
        </Link>
      </div>
    </header>
  );
}

/** Month-to-date token count in the kit's tea-green pill. Informational only. */
function UsagePill({ usage }: { usage: UsageState }) {
  const { sessionTokens, lastTurnTokens } = usage;
  const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(sessionTokens);
  return (
    <div
      className="hidden h-8 items-center gap-1.5 rounded-full bg-tea px-3 text-[13px] font-medium text-tea-foreground sm:inline-flex"
      title={`${sessionTokens.toLocaleString()} tokens this month · last turn ${lastTurnTokens.toLocaleString()}`}
    >
      <Sparkles size={14} aria-hidden />
      <span className="tabular-nums">{compact}</span>
      <span className="hidden font-normal opacity-75 xl:inline">tokens this month</span>
    </div>
  );
}
