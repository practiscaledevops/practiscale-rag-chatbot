"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  Bug,
  Building2,
  ClipboardCheck,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  MessageSquareText,
  ScrollText,
  Settings,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/Brand";
import { Button } from "@/components/Button";
import { IconButton } from "@/components/IconButton";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { ProfileRole } from "@/lib/admin";

/**
 * Admin control-panel chrome — the DARK Practiscale rail (mirroring the Brain
 * back-office) on the left, a soft light top bar, and a light, padded content
 * area. Purely presentational + navigation: the parent server layout
 * (admin/layout.tsx) has already gated the route with requireChatbotAdmin(), so
 * this only ever renders for a verified admin. Section pages (/admin/users,
 * /admin/teams, …) are owned by other agents and rendered as {children}; they
 * inherit this shell's nav, spacing, and max-width.
 *
 * NAV CONTRACT (section agents match these hrefs/labels):
 *   /admin           Overview
 *   /admin/users     Users
 *   /admin/teams     Teams
 *   /admin/usage     Usage & Cost
 *   /admin/settings  Settings
 * Active state: exact match for /admin, prefix match (href + "/") for the rest.
 * Content is wrapped in `mx-auto w-full max-w-6xl` with responsive padding.
 */

/** One primary nav entry. `exact` avoids /admin matching every child route. */
interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
}

const NAV: ReadonlyArray<NavItem> = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/teams", label: "Teams", icon: Building2 },
  { href: "/admin/usage", label: "Usage & Cost", icon: BarChart3 },
  { href: "/admin/feedback", label: "Feedback & QA", icon: MessageSquareText },
  { href: "/admin/approvals", label: "Approvals", icon: ClipboardCheck },
  { href: "/admin/rag", label: "RAG debugger", icon: Bug },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

export interface AdminShellProps {
  /** The signed-in admin's email, resolved server-side. */
  email: string | null;
  /** App-wide role, for the badge next to the email. */
  role: ProfileRole;
  children: React.ReactNode;
}

export function AdminShell({ email, role, children }: AdminShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const roleLabel = role === "super_admin" ? "Super admin" : "Admin";

  async function handleSignOut() {
    setSigningOut(true);
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
    } catch {
      /* even if the network call fails, fall through to the login redirect */
    } finally {
      // Full navigation so Server Components re-read the cleared session cookie.
      router.replace("/login");
      router.refresh();
    }
  }

  // relative: the frame is the containing block for absolutely positioned
  // descendants (sr-only labels, popovers). Without it they resolve against the
  // page, and one deep in a long scrolled page makes the whole document taller
  // than the window — the page then scrolls, leaving a blank strip.
  return (
    <div className="relative flex h-app overflow-hidden bg-sidebar text-foreground">
      {/* --- Desktop rail (static) -------------------------------------- */}
      <aside className="hidden w-64 shrink-0 bg-sidebar lg:block">
        <SidebarContent pathname={pathname} roleLabel={roleLabel} />
      </aside>

      {/* --- Mobile drawer ---------------------------------------------- */}
      {drawerOpen && (
        // Below the installed app's draggable title strip (--titlebar-h is 0 in a tab).
        <div className="fixed inset-x-0 bottom-0 top-[var(--titlebar-h)] z-40 lg:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-[#111315]/30 backdrop-blur-[3px] motion-safe:animate-fadeIn"
          />
          <div className="absolute inset-y-0 left-0 w-64 shadow-soft-lg">
            <SidebarContent
              pathname={pathname}
              roleLabel={roleLabel}
              onNavigate={() => setDrawerOpen(false)}
            />
          </div>
        </div>
      )}

      {/* --- Main column: the clean white workspace ---------------------- */}
      <div className="flex min-w-0 flex-1 flex-col bg-background">
        {/* White top bar — same 56px height and 32px pills as the main TopBar. */}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/70 bg-background px-4 sm:px-6">
          <IconButton
            type="button"
            aria-label="Open menu"
            onClick={() => setDrawerOpen(true)}
            className="lg:hidden"
          >
            <Menu size={18} />
          </IconButton>

          <h1 className="truncate text-sm font-semibold tracking-tight">Control panel</h1>

          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            {/* Identity: role chip + email (email hidden on the smallest screens) */}
            <span className="hidden h-8 items-center gap-2 rounded-full bg-surface-muted pl-1 pr-3 text-[13px] sm:inline-flex">
              <span className="inline-flex h-6 items-center rounded-full bg-accent-soft px-2 text-[11px] font-semibold text-accent-strong">
                {roleLabel}
              </span>
              {email && (
                <span className="max-w-[14rem] truncate text-muted-foreground">
                  {email}
                </span>
              )}
            </span>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleSignOut}
              disabled={signingOut}
              className="h-8 px-3 text-[13px]"
            >
              {signingOut ? (
                <Loader2 size={14} className="animate-spin" aria-hidden />
              ) : (
                <LogOut size={14} aria-hidden />
              )}
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </header>

        {/* Light content area — consistent container for every admin page. */}
        <main className="relative min-h-0 flex-1 overflow-y-auto bg-background">
          <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 sm:py-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

/**
 * The rail's inner content, shared by the static desktop aside and the mobile
 * drawer. `onNavigate` lets the drawer close itself when a link is followed.
 */
function SidebarContent({
  pathname,
  roleLabel,
  onNavigate,
}: {
  pathname: string | null;
  roleLabel: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Brand + Admin badge — the logo sits flush with the rows' left edge (x=14),
          the drawer close button in the rows' trailing column (as in the main rail). */}
      <div className="flex h-14 shrink-0 items-center justify-between pl-3.5 pr-4">
        <Link
          href="/admin"
          onClick={onNavigate}
          className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Logo variant="dark" className="h-[18px]" />
          <span className="inline-flex h-[18px] items-center rounded-full bg-accent/20 px-1.5 text-[11px] font-semibold uppercase leading-none tracking-[0.04em] text-accent">
            Admin
          </span>
        </Link>

        {/* Drawer-only close affordance. */}
        {onNavigate && (
          <button
            type="button"
            aria-label="Close menu"
            onClick={onNavigate}
            className={cn(TRAILING_BTN, "lg:hidden")}
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Primary nav, inside the rounded rail panel. */}
      <nav
        className="mx-2 flex min-h-0 flex-1 flex-col rounded-2xl bg-sidebar-panel"
        aria-label="Admin sections"
      >
        <div className="scrollbar-none flex min-h-0 flex-1 flex-col overflow-y-auto p-1.5">
          <p className={GROUP_LABEL}>Control panel</p>
          <ul className="space-y-0.5">
            {NAV.map((item) => {
              const active = item.exact
                ? pathname === item.href
                : pathname === item.href || (pathname?.startsWith(item.href + "/") ?? false);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(ROW, active ? ROW_ACTIVE : ROW_IDLE)}
                  >
                    <span className={cn(ICON_BOX, active && "text-accent")}>
                      <Icon size={16} strokeWidth={1.75} aria-hidden />
                    </span>
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>

      {/* Footer: back to the chat product (sits where the main rail's profile card does). */}
      {/* One 32px row in a 44px card, same height as the main rail's profile card.
          The role caption sits on the row's right edge but outside the link, so the
          link's accessible name stays "Back to chat". */}
      <div className="relative m-2 shrink-0 rounded-xl bg-sidebar-panel p-1.5">
        <Link href="/" onClick={onNavigate} className={cn(ROW, ROW_IDLE)}>
          <span className={ICON_BOX}>
            <ArrowLeft size={16} strokeWidth={1.75} aria-hidden />
          </span>
          <span className="truncate">Back to chat</span>
        </Link>
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[11px] text-sidebar-muted">
          {roleLabel}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rail grid — identical to the main Sidebar: every row 32px tall, 12px left
// inset, a fixed 16px icon box, a 10px gap, then the label, so icons and labels
// line up in two exact columns. Trailing buttons share one 28px column.
// ---------------------------------------------------------------------------

const ROW =
  "flex h-8 w-full items-center gap-2.5 rounded-lg pl-3 pr-2 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
const ROW_IDLE = "bg-sidebar-item/70 text-sidebar-foreground/90 hover:bg-sidebar-item-hover hover:text-white";
const ROW_ACTIVE = "bg-sidebar-item-hover text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)]";
const ICON_BOX = "flex w-4 shrink-0 items-center justify-center text-sidebar-foreground/70";
/** Group labels start on the label column (12px inset + 16px icon box + 10px gap). */
const GROUP_LABEL = "pb-1 pl-[38px] pr-3 pt-1 text-[11px] font-medium text-sidebar-muted/80";
const TRAILING_BTN =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sidebar-muted transition-colors hover:bg-white/10 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
