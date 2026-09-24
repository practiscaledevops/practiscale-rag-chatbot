"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  ArchiveRestore,
  Brain,
  ChevronDown,
  ClipboardCheck,
  Folder,
  Lightbulb,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  User,
  X,
  type LucideIcon,
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
  /** Archived threads live in a separate, collapsed section. */
  archived?: boolean;
}

export interface SidebarProps {
  projects?: ProjectItem[];
  conversations?: ConversationItem[];
  /** Currently open conversation, for highlight. */
  activeConversationId?: string | null;
  /** Show the Admin link (role admin/super_admin, resolved server-side). */
  isAdmin?: boolean;
  /** Identity for the profile card. */
  fullName?: string;
  email?: string;

  /** Responsive state (owned by AppShell). */
  mobileOpen?: boolean;
  collapsed?: boolean;
  onCloseMobile?: () => void;
  onCollapse?: () => void;

  // Behaviour handlers — optional so the shell renders before they're wired.
  onNewChat?: () => void;
  onNewProject?: () => void;
  onSelectProject?: (id: string) => void;
  /** Currently open project, for the active highlight. */
  activeProjectId?: string | null;
  onRenameProject?: (id: string) => void;
  onDeleteProject?: (id: string) => void;
  onSelectConversation?: (id: string) => void;
  onRenameConversation?: (id: string) => void;
  onPinConversation?: (id: string, pinned: boolean) => void;
  onArchiveConversation?: (id: string, archived: boolean) => void;
  onDeleteConversation?: (id: string) => void;

  className?: string;
}

/** How many projects show before "Show N more". */
const PROJECTS_VISIBLE = 3;
/** Folder accent bars cycle through the kit colors. */
const FOLDER_BARS = ["bg-folder-1", "bg-folder-2", "bg-folder-3", "bg-folder-4", "bg-folder-5"];

/** Bucket conversations into Pinned / Today / Yesterday / Previous 7 days / Older. */
function groupConversations(list: ConversationItem[]) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
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

/** Two-letter initials for the avatar. */
function initials(name: string, email: string): string {
  const src = name.trim() || email.split("@")[0] || "?";
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/**
 * The dark navigation rail (reference "Qubi" layout): logo + menu on top, then a
 * rounded panel holding New Chat, Search, the main nav, Projects (folder pills
 * with colored accent bars) and the chat history grouped by recency, each row
 * with a `•••` menu. A profile card sits at the bottom. Collapsible on desktop,
 * a drawer on mobile.
 */
export function Sidebar({
  projects = [],
  conversations = [],
  activeConversationId = null,
  isAdmin = false,
  fullName = "",
  email = "",
  mobileOpen = false,
  collapsed = false,
  onCloseMobile,
  onCollapse,
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
  className,
}: SidebarProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [chatsOpen, setChatsOpen] = useState(true);
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);

  const trimmed = query.trim().toLowerCase();
  const searching = trimmed.length > 0;

  const active = useMemo(() => conversations.filter((c) => !c.archived), [conversations]);
  const archivedList = useMemo(() => conversations.filter((c) => c.archived), [conversations]);
  const groups = useMemo(() => groupConversations(active), [active]);

  const titleMatches = useMemo(
    () => (trimmed ? conversations.filter((c) => (c.title || "").toLowerCase().includes(trimmed)) : []),
    [conversations, trimmed]
  );

  // Message-body matches (debounced server search), keyed by conversation id.
  const [bodyMatches, setBodyMatches] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setBodyMatches(new Map());
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (!res.ok) return;
        const data = (await res.json()) as { results?: { conversationId: string; snippet: string }[] };
        setBodyMatches(new Map((data.results ?? []).map((r) => [r.conversationId, r.snippet])));
      } catch {
        /* aborted or offline — keep title matches only */
      }
    }, 250);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [query]);

  const searchResults = useMemo(() => {
    if (!searching) return [];
    const byId = new Map(conversations.map((c) => [c.id, c]));
    const seen = new Set<string>();
    const out: { conversation: ConversationItem; snippet?: string }[] = [];
    for (const c of titleMatches) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push({ conversation: c });
    }
    for (const [id, snippet] of bodyMatches) {
      if (seen.has(id)) continue;
      const c = byId.get(id);
      if (!c) continue;
      seen.add(id);
      out.push({ conversation: c, snippet });
    }
    return out;
  }, [searching, conversations, titleMatches, bodyMatches]);

  const visibleProjects = showAllProjects ? projects : projects.slice(0, PROJECTS_VISIBLE);
  const hiddenProjects = Math.max(0, projects.length - PROJECTS_VISIBLE);

  const signOut = useCallback(async () => {
    try {
      // Loaded on demand so supabase-js stays out of every page's shell bundle.
      const { createSupabaseBrowserClient } = await import("@/lib/supabase-browser");
      await createSupabaseBrowserClient().auth.signOut();
    } catch {
      /* fall through to the login redirect */
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }, [router]);

  const rowProps = {
    onSelect: onSelectConversation,
    onRename: onRenameConversation,
    onPin: onPinConversation,
    onArchive: onArchiveConversation,
    onDelete: onDeleteConversation,
  };

  return (
    <aside
      aria-label="Sidebar"
      className={cn(
        "fixed inset-y-0 left-0 z-40 flex h-full w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground",
        "-translate-x-full transition-[transform,width,opacity] duration-200 ease-out",
        mobileOpen && "translate-x-0 shadow-soft-lg",
        "lg:static lg:z-auto lg:translate-x-0",
        collapsed ? "lg:w-0 lg:min-w-0 lg:overflow-hidden lg:opacity-0" : "lg:w-64",
        className
      )}
    >
      {/* Brand + menu — the logo sits flush with the rows' left edge (x=14, like
          the profile avatar), the menu button in the rows' trailing-action
          column (ending at x=240). */}
      <div className="flex h-14 shrink-0 items-center justify-between pl-3.5 pr-4">
        <Link
          href="/"
          className="flex items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Logo variant="dark" className="h-7" />
        </Link>
        <div className="flex items-center">
          <RailMenu
            label="More"
            icon={<MoreHorizontal size={16} />}
            items={[
              { label: "Brain map", icon: Brain, onSelect: () => router.push("/brain") },
              { label: "Learnings", icon: Lightbulb, onSelect: () => router.push("/learning") },
              { label: "Approvals", icon: ClipboardCheck, onSelect: () => router.push("/approvals") },
              { label: "Account", icon: User, onSelect: () => router.push("/account") },
              ...(isAdmin ? [{ label: "Admin", icon: ShieldCheck, onSelect: () => router.push("/admin") }] : []),
              ...(onCollapse
                ? [{ label: "Collapse sidebar", icon: PanelLeftClose, onSelect: onCollapse, desktopOnly: true }]
                : []),
              { label: "Sign out", icon: LogOut, onSelect: signOut, danger: true },
            ]}
          />
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close sidebar"
            className={cn(TRAILING_BTN, "lg:hidden")}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* The rounded panel */}
      <div className="mx-2 flex min-h-0 flex-1 flex-col rounded-2xl bg-sidebar-panel">
        <div className="scrollbar-none fade-bottom flex min-h-0 flex-1 flex-col overflow-y-auto p-1.5 pb-5">
          <div className="space-y-0.5">
            <RailButton icon={Plus} label="New chat" onClick={onNewChat} />
            <label className={cn(ROW, ROW_IDLE, "cursor-text focus-within:bg-sidebar-item-hover")}>
              <span className={ICON_BOX}>
                <Search size={16} strokeWidth={1.75} aria-hidden />
              </span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search chats"
                aria-label="Search chats"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-sidebar-foreground outline-none placeholder:text-sidebar-foreground/70 [&::-webkit-search-cancel-button]:hidden"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="-mr-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-sidebar-muted hover:bg-white/10 hover:text-sidebar-foreground"
                >
                  <X size={14} />
                </button>
              )}
            </label>
          </div>

          {searching ? (
            <section className="mt-3" aria-label="Search results">
              <p className={GROUP_LABEL}>
                {searchResults.length
                  ? `${searchResults.length} result${searchResults.length === 1 ? "" : "s"}`
                  : "No chats match your search."}
              </p>
              <ul className="space-y-0.5">
                {searchResults.map(({ conversation, snippet }) => (
                  <ConversationRow
                    key={conversation.id}
                    conversation={conversation}
                    snippet={snippet}
                    active={conversation.id === activeConversationId}
                    {...rowProps}
                  />
                ))}
              </ul>
            </section>
          ) : (
            <>
              {/* Projects (folders) */}
              <section className="mt-4" aria-labelledby="rail-projects">
                <SectionHeader
                  id="rail-projects"
                  label="Projects"
                  open={projectsOpen}
                  onToggle={() => setProjectsOpen((o) => !o)}
                  onAdd={onNewProject}
                  addLabel="New project"
                />
                {projectsOpen && (
                  <>
                    {projects.length === 0 ? (
                      <button
                        type="button"
                        onClick={onNewProject}
                        className="mt-0.5 w-full rounded-lg border border-dashed border-white/15 px-3 py-2 text-left text-xs leading-snug text-sidebar-muted transition-colors hover:border-white/25 hover:text-sidebar-foreground"
                      >
                        Create a project to group chats, files and instructions
                      </button>
                    ) : (
                      <ul className="space-y-0.5">
                        {visibleProjects.map((p) => (
                          <ProjectRow
                            key={p.id}
                            project={p}
                            bar={FOLDER_BARS[projects.indexOf(p) % FOLDER_BARS.length]}
                            active={p.id === activeProjectId}
                            onSelect={onSelectProject}
                            onRename={onRenameProject}
                            onDelete={onDeleteProject}
                          />
                        ))}
                      </ul>
                    )}
                    {hiddenProjects > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowAllProjects((s) => !s)}
                        className={cn(ROW, "h-7 text-xs text-sidebar-muted hover:text-sidebar-foreground")}
                      >
                        <span className={ICON_BOX}>
                          <Plus size={14} className={cn("transition-transform", showAllProjects && "rotate-45")} aria-hidden />
                        </span>
                        {showAllProjects ? "Show less" : `Show ${hiddenProjects} more`}
                      </button>
                    )}
                  </>
                )}
              </section>

              {/* Chats */}
              <section className="mt-4" aria-labelledby="rail-chats">
                <SectionHeader
                  id="rail-chats"
                  label="Chats"
                  open={chatsOpen}
                  onToggle={() => setChatsOpen((o) => !o)}
                  onAdd={onNewChat}
                  addLabel="New chat"
                  menu={
                    archivedList.length > 0
                      ? [
                          {
                            label: archivedOpen ? "Hide archived" : `Show archived (${archivedList.length})`,
                            icon: Archive,
                            onSelect: () => setArchivedOpen((o) => !o),
                          },
                        ]
                      : undefined
                  }
                />
                {chatsOpen &&
                  (active.length === 0 ? (
                    <p className="py-1 pl-[38px] pr-3 text-xs text-sidebar-muted">Your chats will appear here.</p>
                  ) : (
                    groups.map((group) => (
                      <div key={group.label}>
                        <p className={GROUP_LABEL}>{group.label}</p>
                        <ul className="space-y-0.5">
                          {group.items.map((c) => (
                            <ConversationRow key={c.id} conversation={c} active={c.id === activeConversationId} {...rowProps} />
                          ))}
                        </ul>
                      </div>
                    ))
                  ))}
                {chatsOpen && archivedOpen && archivedList.length > 0 && (
                  <div>
                    <p className={GROUP_LABEL}>Archived</p>
                    <ul className="space-y-0.5">
                      {archivedList.map((c) => (
                        <ConversationRow key={c.id} conversation={c} active={c.id === activeConversationId} {...rowProps} />
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>

      {/* Profile card */}
      {/* Avatar flush with the rows' left edge (x=14) so the name starts on the
          label column (x=52); sign-out ends on the trailing column (x=240). */}
      <div className="m-2 flex shrink-0 items-center gap-2.5 rounded-xl bg-sidebar-panel py-2 pl-1.5 pr-2">
        <Link
          href="/account"
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="Account"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-tea text-[11px] font-semibold text-tea-foreground">
            {initials(fullName, email)}
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[13px] font-medium text-sidebar-foreground">{fullName || "Account"}</span>
            {email && <span className="block truncate text-[11px] text-sidebar-muted">{email}</span>}
          </span>
        </Link>
        <button type="button" onClick={signOut} aria-label="Sign out" title="Sign out" className={TRAILING_BTN}>
          <LogOut size={16} />
        </button>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Rail grid. Every row: 32px tall, 12px left inset, a fixed 16px icon box, a
// 10px gap, then the label — so icons and labels line up in two exact columns
// across nav rows, folders, chats, section headers, group labels and "Show
// more". Trailing actions (+ / •••, 16px glyphs) share one 28px column on the
// right, ending at x=240.
// ---------------------------------------------------------------------------

const ROW =
  "flex h-8 w-full items-center gap-2.5 rounded-lg pl-3 pr-2 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
const ROW_IDLE = "bg-sidebar-item/70 text-sidebar-foreground/90 hover:bg-sidebar-item-hover hover:text-white";
const ROW_ACTIVE = "bg-sidebar-item-hover text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)]";
const ICON_BOX = "flex w-4 shrink-0 items-center justify-center text-sidebar-foreground/70";
/** Group labels start on the label column (12px inset + 16px icon box + 10px gap). */
const GROUP_LABEL = "pb-1 pl-[38px] pr-3 pt-2.5 text-[11px] font-medium text-sidebar-muted/80";
const TRAILING_BTN =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sidebar-muted transition-colors hover:bg-white/10 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function RailButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn(ROW, ROW_IDLE, "font-medium")}>
      <span className={ICON_BOX}>
        <Icon size={16} strokeWidth={1.75} aria-hidden />
      </span>
      {label}
    </button>
  );
}

function SectionHeader({
  id,
  label,
  open,
  onToggle,
  onAdd,
  addLabel,
  menu,
}: {
  id: string;
  label: string;
  open: boolean;
  onToggle: () => void;
  onAdd?: () => void;
  addLabel: string;
  menu?: MenuItem[];
}) {
  return (
    <div className="flex h-7 items-center pr-0.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-md pl-3 text-left text-xs font-medium text-sidebar-muted transition-colors hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex w-4 shrink-0 items-center justify-center">
          <ChevronDown size={14} className={cn("transition-transform", !open && "-rotate-90")} aria-hidden />
        </span>
        <span id={id}>{label}</span>
      </button>
      {/* The optional menu renders first so + always holds the rightmost
          trailing column, aligned across sections and with the rows' •••. */}
      {menu && menu.length > 0 && <RailMenu label={`${label} options`} icon={<MoreHorizontal size={16} />} items={menu} />}
      {onAdd && (
        <button type="button" onClick={onAdd} aria-label={addLabel} title={addLabel} className={TRAILING_BTN}>
          <Plus size={16} />
        </button>
      )}
    </div>
  );
}

function ConversationRow({
  conversation: c,
  active,
  snippet,
  onSelect,
  onRename,
  onPin,
  onArchive,
  onDelete,
}: {
  conversation: ConversationItem;
  active: boolean;
  snippet?: string;
  onSelect?: (id: string) => void;
  onRename?: (id: string) => void;
  onPin?: (id: string, pinned: boolean) => void;
  onArchive?: (id: string, archived: boolean) => void;
  onDelete?: (id: string) => void;
}) {
  const items: MenuItem[] = [
    { label: c.pinned ? "Unpin" : "Pin", icon: c.pinned ? PinOff : Pin, onSelect: () => onPin?.(c.id, !c.pinned) },
    { label: "Rename", icon: Pencil, onSelect: () => onRename?.(c.id) },
    ...(onArchive
      ? [
          {
            label: c.archived ? "Unarchive" : "Archive",
            icon: c.archived ? ArchiveRestore : Archive,
            onSelect: () => onArchive(c.id, !c.archived),
          },
        ]
      : []),
    { label: "Delete", icon: Trash2, onSelect: () => onDelete?.(c.id), danger: true },
  ];
  return (
    <li className={cn("group relative flex items-center rounded-lg transition-colors", active ? ROW_ACTIVE : ROW_IDLE)}>
      <button
        type="button"
        onClick={() => onSelect?.(c.id)}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2.5 rounded-lg pl-3 pr-1 text-left text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          snippet ? "py-1.5" : "h-8"
        )}
      >
        <span className={cn(ICON_BOX, snippet && "self-start pt-0.5", (active || c.pinned) && "text-accent")}>
          {c.pinned ? <Pin size={16} strokeWidth={1.75} aria-hidden /> : <MessageSquare size={16} strokeWidth={1.75} aria-hidden />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="fade-truncate block">{c.title || "Untitled"}</span>
          {snippet && <span className="mt-0.5 block truncate text-[11px] text-sidebar-muted">{snippet}</span>}
        </span>
      </button>
      <RailMenu
        label={`Options for ${c.title || "chat"}`}
        icon={<MoreHorizontal size={16} />}
        items={items}
        className="mr-0.5 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
        activeClassName="opacity-100"
      />
    </li>
  );
}

function ProjectRow({
  project,
  bar,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  project: ProjectItem;
  bar: string;
  active: boolean;
  onSelect?: (id: string) => void;
  onRename?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  const items: MenuItem[] = [
    ...(onRename ? [{ label: "Rename", icon: Pencil, onSelect: () => onRename(project.id) }] : []),
    ...(onDelete ? [{ label: "Delete", icon: Trash2, onSelect: () => onDelete(project.id), danger: true }] : []),
  ];
  return (
    <li className={cn("group relative flex items-center overflow-hidden rounded-lg transition-colors", active ? ROW_ACTIVE : ROW_IDLE)}>
      {/* Folder color bar — absolutely placed so it never shifts the grid. */}
      <span className={cn("absolute inset-y-1.5 left-0 w-[3px] rounded-r-full", bar)} aria-hidden />
      <button
        type="button"
        onClick={() => onSelect?.(project.id)}
        aria-current={active ? "page" : undefined}
        className="flex h-8 min-w-0 flex-1 items-center gap-2.5 pl-3 pr-1 text-left text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className={cn(ICON_BOX, active && "text-accent")}>
          <Folder size={16} strokeWidth={1.75} aria-hidden />
        </span>
        <span className="truncate">{project.name}</span>
      </button>
      {items.length > 0 && (
        <RailMenu
          label={`Options for ${project.name}`}
          icon={<MoreHorizontal size={16} />}
          items={items}
          className="mr-0.5 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
          activeClassName="opacity-100"
        />
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// RailMenu — a small dark popover rendered in a portal (so the scrolling panel
// never clips it). Click-outside / Escape / scroll close it; arrow keys move.
// ---------------------------------------------------------------------------

interface MenuItem {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
  /** Only shown at lg+ (e.g. collapsing the rail). */
  desktopOnly?: boolean;
}

const MENU_WIDTH = 188;

function RailMenu({
  label,
  icon,
  items,
  className,
  activeClassName,
}: {
  label: string;
  icon: React.ReactNode;
  items: MenuItem[];
  className?: string;
  /** Classes applied while the menu is open (e.g. keep a hover-only trigger visible). */
  activeClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const height = items.length * 32 + 10;
    const left = Math.min(window.innerWidth - MENU_WIDTH - 8, Math.max(8, r.right - MENU_WIDTH));
    const below = r.bottom + 4;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, r.top - height - 4) : below;
    setPos({ top, left });
  }, [items.length]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => itemRefs.current[0]?.focus({ preventScroll: true }), 0);
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    const close = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  function onMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const list = itemRefs.current.filter(Boolean) as HTMLButtonElement[];
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
    list[next]?.focus();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={cn(TRAILING_BTN, className, open && cn("bg-white/10 text-sidebar-foreground", activeClassName))}
      >
        {icon}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKeyDown}
            style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}
            className="fixed z-[60] rounded-xl border border-white/10 bg-[#232323] p-1 text-sidebar-foreground shadow-[0_16px_40px_-10px_rgb(0_0_0/0.6)] motion-safe:animate-fadeUp"
          >
            {items.map((it, i) => (
              <button
                key={it.label}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
                className={cn(
                  "flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] transition-colors hover:bg-white/[0.08] focus-visible:bg-white/[0.08] focus-visible:outline-none",
                  it.danger ? "text-[#ff8f86]" : "text-sidebar-foreground",
                  it.desktopOnly && "hidden lg:flex"
                )}
              >
                <it.icon size={14} className="shrink-0 opacity-85" aria-hidden />
                {it.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
