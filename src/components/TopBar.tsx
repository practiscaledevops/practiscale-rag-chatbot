"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, PanelLeftOpen, Settings, Sparkles } from "lucide-react";
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
  onOpenMobile?: () => void;
  onExpand?: () => void;

  className?: string;
}

/**
 * Workspace header (reference "Qubi" layout): the PractiScale wordmark on the
 * left (with the open conversation's title), and pills on the right — a
 * tea-green usage pill, notifications, and the dark Settings pill.
 */
export function TopBar({ title, usage, collapsed = false, onOpenMobile, onExpand, className }: TopBarProps) {
  const pathname = usePathname();
  const onSettings = pathname.startsWith("/settings");
  return (
    <header
      className={cn(
        "flex h-[76px] shrink-0 items-center justify-between gap-3 bg-background px-4 sm:px-6 lg:px-10",
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <IconButton aria-label="Open sidebar" className="-ml-1 lg:hidden" onClick={onOpenMobile}>
          <Menu size={20} />
        </IconButton>
        {collapsed && (
          <IconButton aria-label="Expand sidebar" className="-ml-1 hidden lg:inline-flex" onClick={onExpand}>
            <PanelLeftOpen size={20} />
          </IconButton>
        )}
        <Link
          href="/"
          className="shrink-0 rounded-lg text-[26px] font-semibold leading-none tracking-[-0.03em] text-[#12202a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="PractiScale home"
        >
          Practi<span className="text-accent">Scale</span>
        </Link>
        {title && (
          <span className="hidden min-w-0 items-center gap-2 md:flex">
            <span className="text-lg font-light text-subtle-foreground" aria-hidden>
              /
            </span>
            <span className="truncate text-sm font-medium text-muted-foreground">{title}</span>
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
        <UsagePill usage={usage} />
        <PwaInstall />
        <NotificationsBell />
        <Link
          href="/settings"
          aria-current={onSettings ? "page" : undefined}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-[#262626] px-3 text-sm font-medium text-white transition-colors hover:bg-[#1a1a1a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:px-4"
        >
          <Settings size={17} aria-hidden />
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
      className="hidden h-10 items-center gap-2 rounded-full bg-tea px-4 text-sm font-medium text-tea-foreground sm:inline-flex"
      title={`${sessionTokens.toLocaleString()} tokens this month · last turn ${lastTurnTokens.toLocaleString()}`}
    >
      <Sparkles size={16} aria-hidden />
      <span className="tabular-nums">{compact}</span>
      <span className="hidden font-normal opacity-75 lg:inline">tokens this month</span>
    </div>
  );
}
