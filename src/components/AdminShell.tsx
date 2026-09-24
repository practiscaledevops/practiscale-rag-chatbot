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

  return (
    <div className="flex h-screen overflow-hidden bg-sidebar text-foreground">
      {/* --- Desktop rail (static) -------------------------------------- */}
      <aside className="hidden w-64 shrink-0 bg-sidebar lg:block">
        <SidebarContent pathname={pathname} roleLabel={roleLabel} />
      </aside>

      {/* --- Mobile drawer ---------------------------------------------- */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
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
        {/* White top bar */}
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background px-4 sm:px-6">
          <IconButton
            type="button"
            aria-label="Open menu"
            onClick={() => setDrawerOpen(true)}
            className="-ml-1 lg:hidden"
          >
            <Menu size={18} />
          </IconButton>

          <h1 className="truncate text-sm font-semibold tracking-tight">Control panel</h1>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {/* Identity: role chip + email (email hidden on the smallest screens) */}
            <span className="hidden items-center gap-2 rounded-full bg-surface-muted py-1 pl-1 pr-3 text-xs sm:inline-flex">
              <span className="rounded-full bg-accent-soft px-2.5 py-0.5 font-semibold text-accent-strong">
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
        <main className="min-h-0 flex-1 overflow-y-auto bg-background">
          <div className="mx-auto w-full max-w-6xl p-4 sm:p-6 lg:p-8">{children}</div>
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
    <div className="flex h-full flex-col gap-3 bg-sidebar p-3 text-sidebar-foreground">
      {/* Brand + Admin badge. */}
      <div className="flex h-10 shrink-0 items-center gap-2 px-1.5">
        <Link
          href="/admin"
          onClick={onNavigate}
          className="flex items-center gap-2 rounded-lg px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Logo variant="dark" className="h-6" />
          <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
            Admin
          </span>
        </Link>

        {/* Drawer-only close affordance. */}
        {onNavigate && (
          <button
            type="button"
            aria-label="Close menu"
            onClick={onNavigate}
            className="ml-auto grid h-8 w-8 place-items-center rounded-full text-sidebar-muted transition-colors hover:bg-sidebar-item-hover hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Primary nav, inside the rounded rail panel. */}
      <nav
        className="scroll-dark flex min-h-0 flex-1 flex-col overflow-y-auto rounded-2xl bg-sidebar-panel p-2"
        aria-label="Admin sections"
      >
        <p className="px-2 pb-2 pt-1 text-xs text-sidebar-muted">Control panel</p>
        <ul className="space-y-1">
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
                  className={cn(
                    "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-sidebar-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-sidebar-item-hover font-medium ring-1 ring-inset ring-white/10"
                      : "bg-sidebar-item hover:bg-sidebar-item-hover"
                  )}
                >
                  <Icon
                    size={17}
                    aria-hidden
                    className={cn(
                      "shrink-0 transition-colors",
                      active ? "text-accent" : "text-sidebar-muted group-hover:text-sidebar-foreground"
                    )}
                  />
                  <span className="truncate">{item.label}</span>
                  {active && (
                    <span aria-hidden className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer: back to the chat product. */}
      <div className="shrink-0 rounded-2xl bg-sidebar-panel p-2">
        <Link
          href="/"
          onClick={onNavigate}
          className="flex items-center gap-3 rounded-xl bg-sidebar-item px-3 py-2.5 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-item-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft size={17} aria-hidden className="shrink-0 text-sidebar-muted" />
          Back to chat
        </Link>
        <p className="px-2 pb-0.5 pt-2 text-xs text-sidebar-muted">{roleLabel} access</p>
      </div>
    </div>
  );
}
