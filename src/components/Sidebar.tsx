"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Compass,
  FolderOpen,
  FolderPlus,
  Library,
  MessageSquarePlus,
  Pencil,
  Pin,
  PinOff,
  PanelLeftClose,
  Search,
  ShieldCheck,
  Trash2,
  User,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/Brand";

export interface ProjectItem {
  id: string;
  name: string;
}

export interface ConversationItem {
  id: string;
  title: string;
  pinned?: boolean;
  /** ISO timestamp used to bucket the thread by recency. */
  updatedAt?: string;
}

export interface SidebarProps {
  projects?: ProjectItem[];
  conversations?: ConversationItem[];
  /** Currently open conversation, for highlight. */
  activeConversationId?: string | null;
  /** Show the Admin link (role admin/super_admin, resolved server-side). */
  isAdmin?: boolean;

  /** Responsive state (owned by AppShell). */
  mobileOpen?: boolean;
  collapsed?: boolean;
  onCloseMobile?: () => void;
  onCollapse?: () => void;

  // Behaviour handlers — optional so the shell renders before they're wired.
  onNewChat?: () => void;
  onNewProject?: () => void;
  onSelectProject?: (id: string) => void;
  onSelectConversation?: (id: string) => void;
  onRenameConversation?: (id: string) => void;
  onPinConversation?: (id: string, pinned: boolean) => void;
  onDeleteConversation?: (id: string) => void;

  className?: string;
}

/** Bucket conversations into Pinned / Today / Yesterday / Previous 7 days / Older. */
function groupConversations(list: ConversationItem[]) {
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();
  const day = 86_400_000;

  const groups: Record<string, ConversationItem[]> = {
    Pinned: [],
    Today: [],
    Yesterday: [],
    "Previous 7 days": [],
    Older: [],
  };

  for (const c of list) {
    if (c.pinned) {
      groups.Pinned.push(c);
      continue;
    }
    const t = c.updatedAt ? new Date(c.updatedAt).getTime() : 0;
    if (t >= startOfToday) groups.Today.push(c);
    else if (t >= startOfToday - day) groups.Yesterday.push(c);
    else if (t >= startOfToday - 7 * day) groups["Previous 7 days"].push(c);
    else groups.Older.push(c);
  }

  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }));
}

/**
 * The dark navigation rail. Contents: the Practiscale wordmark, a prominent New
 * chat button, a search box, a small nav cluster (Explore / Library / Files),
 * the Projects list, and the chat history grouped by recency with rename / pin /
 * delete on hover. When the signed-in user is an admin, an Admin link sits at
 * the bottom. Collapsible on desktop, a drawer on mobile.
 */
export function Sidebar({
  projects = [],
  conversations = [],
  activeConversationId = null,
  isAdmin = false,
  mobileOpen = false,
  collapsed = false,
  onCloseMobile,
  onCollapse,
  onNewChat,
  onNewProject,
  onSelectProject,
  onSelectConversation,
  onRenameConversation,
  onPinConversation,
  onDeleteConversation,
  className,
}: SidebarProps) {
  const [query, setQuery] = useState("");

  const trimmed = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      trimmed
        ? conversations.filter((c) =>
            (c.title || "").toLowerCase().includes(trimmed)
          )
        : conversations,
    [conversations, trimmed]
  );
  const groups = useMemo(() => groupConversations(filtered), [filtered]);

  return (
    <aside
      aria-label="Sidebar"
      className={cn(
        "fixed inset-y-0 left-0 z-40 flex h-full w-[17rem] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
        "-translate-x-full transition-[transform,width,opacity] duration-200 ease-out",
        mobileOpen && "translate-x-0 shadow-soft-lg",
        "lg:static lg:z-auto lg:translate-x-0",
        collapsed
          ? "lg:w-0 lg:min-w-0 lg:overflow-hidden lg:opacity-0"
          : "lg:w-[17rem]",
        className
      )}
    >
      {/* Brand + collapse / close */}
      <div className="flex h-14 shrink-0 items-center justify-between px-3">
        <Link href="/" className="flex items-center rounded-lg px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Logo variant="dark" className="h-6" />
        </Link>
        <div className="flex items-center">
          {/* Desktop: collapse the rail. */}
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Collapse sidebar"
            className="hidden h-8 w-8 items-center justify-center rounded-lg text-sidebar-muted transition-colors hover:bg-white/10 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:inline-flex"
          >
            <PanelLeftClose size={18} />
          </button>
          {/* Mobile: close the drawer. */}
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close sidebar"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-sidebar-muted transition-colors hover:bg-white/10 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* New chat */}
      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={onNewChat}
          className="flex w-full items-center gap-2.5 rounded-xl bg-white/[0.06] px-3 py-2.5 text-sm font-medium text-sidebar-foreground ring-1 ring-inset ring-white/10 transition-colors hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <MessageSquarePlus size={15} />
          </span>
          New chat
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sidebar-muted"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
            className="w-full rounded-lg border border-sidebar-border bg-white/[0.04] py-2 pl-9 pr-3 text-sm text-sidebar-foreground placeholder:text-sidebar-muted focus-visible:border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
        {/* Primary nav cluster */}
        <ul className="space-y-0.5 px-1 pb-2">
          <NavItem icon={<Compass size={16} />} label="Explore" onClick={onNewChat} />
          <NavItem icon={<Library size={16} />} label="Library" soon />
          <NavItem icon={<FolderOpen size={16} />} label="Files" soon />
        </ul>

        {/* Projects */}
        <section className="mb-1" aria-labelledby="sidebar-projects-heading">
          <div className="flex items-center justify-between px-2 py-1">
            <h2
              id="sidebar-projects-heading"
              className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted"
            >
              Projects
            </h2>
            <button
              type="button"
              onClick={onNewProject}
              aria-label="New project"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-sidebar-muted transition-colors hover:bg-white/10 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <FolderPlus size={14} />
            </button>
          </div>
          {projects.length === 0 ? (
            <p className="px-2 pb-1 text-xs text-sidebar-muted/80">No projects yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {projects.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onSelectProject?.(p.id)}
                    className="w-full truncate rounded-lg px-2.5 py-1.5 text-left text-sm text-sidebar-foreground/90 transition-colors hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* History */}
        <section className="mt-1" aria-labelledby="sidebar-history-heading">
          <h2
            id="sidebar-history-heading"
            className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted"
          >
            History
          </h2>

          {filtered.length === 0 ? (
            <p className="px-2 py-1 text-xs text-sidebar-muted/80">
              {trimmed ? "No chats match your search." : "Your conversations will appear here."}
            </p>
          ) : (
            <div className="space-y-2">
              {groups.map((group) => (
                <div key={group.label}>
                  <p className="px-2 pb-0.5 pt-1 text-[10px] font-medium uppercase tracking-wider text-sidebar-muted/70">
                    {group.label}
                  </p>
                  <ul className="space-y-0.5">
                    {group.items.map((c) => (
                      <ConversationRow
                        key={c.id}
                        conversation={c}
                        active={c.id === activeConversationId}
                        onSelect={onSelectConversation}
                        onRename={onRenameConversation}
                        onPin={onPinConversation}
                        onDelete={onDeleteConversation}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      </nav>

      {/* Footer: admin + account */}
      <div className="shrink-0 space-y-0.5 border-t border-sidebar-border p-2">
        {isAdmin && (
          <Link
            href="/admin"
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ShieldCheck size={16} className="text-accent" />
            Admin
          </Link>
        )}
        <Link
          href="/account"
          className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-sidebar-muted transition-colors hover:bg-white/[0.08] hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <User size={16} />
          Account
        </Link>
      </div>
    </aside>
  );
}

/** A compact primary-nav row. `soon` marks an upcoming, non-navigating item. */
function NavItem({
  icon,
  label,
  onClick,
  soon,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  soon?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={soon ? undefined : onClick}
        aria-disabled={soon || undefined}
        title={soon ? "Coming soon" : undefined}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          soon
            ? "cursor-default text-sidebar-muted/70"
            : "text-sidebar-foreground/90 hover:bg-white/[0.07]"
        )}
      >
        <span className="text-sidebar-muted">{icon}</span>
        {label}
        {soon && (
          <span className="ml-auto rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sidebar-muted">
            Soon
          </span>
        )}
      </button>
    </li>
  );
}

/** A single history row with hover-revealed pin / rename / delete controls. */
function ConversationRow({
  conversation: c,
  active,
  onSelect,
  onRename,
  onPin,
  onDelete,
}: {
  conversation: ConversationItem;
  active: boolean;
  onSelect?: (id: string) => void;
  onRename?: (id: string) => void;
  onPin?: (id: string, pinned: boolean) => void;
  onDelete?: (id: string) => void;
}) {
  return (
    <li className="group relative">
      <button
        type="button"
        onClick={() => onSelect?.(c.id)}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 pr-16 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active
            ? "bg-white/[0.12] text-sidebar-foreground"
            : "text-sidebar-foreground/85 hover:bg-white/[0.07]"
        )}
      >
        {c.pinned && <Pin size={12} className="shrink-0 text-accent" aria-hidden />}
        <span className="truncate">{c.title || "Untitled"}</span>
      </button>

      {/* Hover / focus-within affordances. A dark-rail-tuned control set. */}
      <div className="absolute right-1 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 group-hover:flex group-focus-within:flex">
        <RowAction
          label={c.pinned ? "Unpin conversation" : "Pin conversation"}
          onClick={() => onPin?.(c.id, !c.pinned)}
        >
          {c.pinned ? <PinOff size={13} /> : <Pin size={13} />}
        </RowAction>
        <RowAction label="Rename conversation" onClick={() => onRename?.(c.id)}>
          <Pencil size={13} />
        </RowAction>
        <RowAction label="Delete conversation" onClick={() => onDelete?.(c.id)}>
          <Trash2 size={13} />
        </RowAction>
      </div>
    </li>
  );
}

function RowAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-sidebar-muted transition-colors hover:bg-white/15 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}
