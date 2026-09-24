"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  ArchiveRestore,
  Brain,
  ChevronDown,
  ClipboardCheck,
  Folder,
  House,
  Lightbulb,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  MoreVertical,
  PanelLeftClose,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
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
  const pathname = usePathname();
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

  const nav: { href: string; label: string; icon: LucideIcon }[] = [
    { href: "/", label: "Home", icon: House },
    { href: "/brain", label: "Brain map", icon: Brain },
    { href: "/learning", label: "Learnings", icon: Lightbulb },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

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
        "fixed inset-y-0 left-0 z-40 flex h-full w-[18.5rem] shrink-0 flex-col bg-sidebar text-sidebar-foreground",
        "-translate-x-full transition-[transform,width,opacity] duration-200 ease-out",
        mobileOpen && "translate-x-0 shadow-soft-lg",
        "lg:static lg:z-auto lg:translate-x-0",
        collapsed ? "lg:w-0 lg:min-w-0 lg:overflow-hidden lg:opacity-0" : "lg:w-[18.5rem]",
        className
      )}
    >
      {/* Brand + menu */}
      <div className="flex h-[76px] shrink-0 items-center justify-between pl-6 pr-4">
        <Link
          href="/"
          className="flex items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Logo variant="dark" className="h-[22px]" />
        </Link>
        <div className="flex items-center gap-0.5">
          <RailMenu
            label="More"
            icon={<MoreHorizontal size={20} />}
            items={[
              { label: "Approvals", icon: ClipboardCheck, onSelect: () => router.push("/approvals") },
              { label: "Account", icon: User, onSelect: () => router.push("/account") },
              ...(isAdmin
                ? [{ label: "Admin", icon: ShieldCheck, onSelect: () => router.push("/admin") }]
                : []),
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
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-sidebar-muted transition-colors hover:bg-white/10 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* The rounded panel */}
      <div className="mx-3 flex min-h-0 flex-1 flex-col rounded-[22px] bg-sidebar-panel">
        <div className="scroll-dark flex min-h-0 flex-1 flex-col overflow-y-auto p-2.5">
          <div className="space-y-1.5">
            <RailButton icon={Plus} label="New Chat" onClick={onNewChat} />
            <label className="group flex h-11 cursor-text items-center gap-3 rounded-xl bg-sidebar-item px-3.5 text-[15px] transition-colors focus-within:bg-sidebar-item-hover focus-within:ring-1 focus-within:ring-inset focus-within:ring-white/15 hover:bg-sidebar-item-hover">
              <Search size={18} className="shrink-0 text-sidebar-muted group-focus-within:text-sidebar-foreground" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                aria-label="Search chats"
                className="min-w-0 flex-1 bg-transparent text-sidebar-foreground outline-none placeholder:text-sidebar-foreground/85 [&::-webkit-search-cancel-button]:hidden"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="rounded-full p-0.5 text-sidebar-muted hover:text-sidebar-foreground"
                >
                  <X size={14} />
                </button>
              )}
            </label>
          </div>

          {searching ? (
            <section className="mt-4" aria-label="Search results">
              <p className="px-2 pb-1.5 text-xs text-sidebar-muted">
                {searchResults.length ? `${searchResults.length} result${searchResults.length === 1 ? "" : "s"}` : "No chats match your search."}
              </p>
              <ul className="space-y-1.5">
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
              {/* Main nav */}
              <nav className="mt-4 space-y-1.5" aria-label="Main">
                {nav.map((n) => (
                  <RailLink
                    key={n.href}
                    href={n.href}
                    icon={n.icon}
                    label={n.label}
                    active={n.href === "/" ? pathname === "/" : pathname.startsWith(n.href)}
                  />
                ))}
              </nav>

              {/* Projects (folders) */}
              <section className="mt-5" aria-labelledby="rail-projects">
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
                        className="mt-1 w-full rounded-xl border border-dashed border-white/15 px-3 py-2.5 text-left text-sm text-sidebar-muted transition-colors hover:border-white/25 hover:text-sidebar-foreground"
                      >
                        Create a project to group chats, files and instructions
                      </button>
                    ) : (
                      <ul className="mt-1 space-y-1.5">
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
                        className="mt-2 flex items-center gap-2 px-2 py-1 text-sm text-sidebar-muted transition-colors hover:text-sidebar-foreground"
                      >
                        <Plus size={15} className={cn("transition-transform", showAllProjects && "rotate-45")} aria-hidden />
                        {showAllProjects ? "Show less" : `Show ${hiddenProjects} more`}
                      </button>
                    )}
                  </>
                )}
              </section>

              {/* Chats */}
              <section className="mt-5" aria-labelledby="rail-chats">
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
                    <p className="px-2 pt-1 text-sm text-sidebar-muted">Your conversations will appear here.</p>
                  ) : (
                    groups.map((group) => (
                      <div key={group.label}>
                        <p className="px-2 pb-1.5 pt-3 text-[13px] text-sidebar-muted">{group.label}</p>
                        <ul className="space-y-1.5">
                          {group.items.map((c) => (
                            <ConversationRow
                              key={c.id}
                              conversation={c}
                              active={c.id === activeConversationId}
                              {...rowProps}
                            />
                          ))}
                        </ul>
                      </div>
                    ))
                  ))}
                {chatsOpen && archivedOpen && archivedList.length > 0 && (
                  <div>
                    <p className="px-2 pb-1.5 pt-3 text-[13px] text-sidebar-muted">Archived</p>
                    <ul className="space-y-1.5">
                      {archivedList.map((c) => (
                        <ConversationRow
                          key={c.id}
                          conversation={c}
                          active={c.id === activeConversationId}
                          {...rowProps}
                        />
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
      <div className="m-3 flex shrink-0 items-center gap-3 rounded-2xl bg-sidebar-panel p-2.5 pr-2">
        <Link
          href="/account"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="Account"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-tea text-sm font-semibold text-tea-foreground">
            {initials(fullName, email)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-sidebar-foreground">{fullName || "Account"}</span>
            {email && <span className="block truncate text-xs text-sidebar-muted">{email}</span>}
          </span>
        </Link>
        <button
          type="button"
          onClick={signOut}
          aria-label="Sign out"
          title="Sign out"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sidebar-muted transition-colors hover:bg-white/10 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <LogOut size={17} />
        </button>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Rail pieces
// ---------------------------------------------------------------------------

const rowBase =
  "flex h-11 w-full items-center gap-3 rounded-xl px-3.5 text-left text-[15px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function RailButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn(rowBase, "bg-sidebar-item text-sidebar-foreground hover:bg-sidebar-item-hover")}>
      <Icon size={18} className="shrink-0 text-sidebar-foreground/80" aria-hidden />
      {label}
    </button>
  );
}

function RailLink({ href, icon: Icon, label, active }: { href: string; icon: LucideIcon; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        rowBase,
        active
          ? "bg-sidebar-item-hover text-white ring-1 ring-inset ring-white/10"
          : "bg-sidebar-item text-sidebar-foreground hover:bg-sidebar-item-hover"
      )}
    >
      <Icon size={18} className={cn("shrink-0", active ? "text-accent" : "text-sidebar-foreground/80")} aria-hidden />
      {label}
    </Link>
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
    <div className="flex items-center justify-between pl-1 pr-0.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg px-1 py-1 text-[15px] text-sidebar-muted transition-colors hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronDown size={16} className={cn("transition-transform", !open && "-rotate-90")} aria-hidden />
        <span id={id}>{label}</span>
      </button>
      <div className="flex items-center">
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            aria-label={addLabel}
            title={addLabel}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-sidebar-muted transition-colors hover:bg-white/10 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus size={17} />
          </button>
        )}
        {menu && menu.length > 0 && <RailMenu label={`${label} options`} icon={<MoreVertical size={16} />} items={menu} />}
      </div>
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
      ? [{ label: c.archived ? "Unarchive" : "Archive", icon: c.archived ? ArchiveRestore : Archive, onSelect: () => onArchive(c.id, !c.archived) }]
      : []),
    { label: "Delete", icon: Trash2, onSelect: () => onDelete?.(c.id), danger: true },
  ];
  return (
    <li
      className={cn(
        "group relative flex items-center rounded-xl transition-colors",
        active ? "bg-sidebar-item-hover ring-1 ring-inset ring-white/10" : "bg-sidebar-item hover:bg-sidebar-item-hover"
      )}
    >
      <button
        type="button"
        onClick={() => onSelect?.(c.id)}
        aria-current={active ? "page" : undefined}
        className="flex min-h-[44px] min-w-0 flex-1 items-center gap-3 rounded-xl py-2 pl-3.5 pr-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {c.pinned ? (
          <Pin size={17} className="shrink-0 text-accent" aria-hidden />
        ) : (
          <MessageSquare size={17} className={cn("shrink-0", active ? "text-accent" : "text-sidebar-foreground/75")} aria-hidden />
        )}
        <span className="min-w-0 flex-1">
          <span className={cn("fade-truncate block text-[15px]", active ? "text-white" : "text-sidebar-foreground")}>
            {c.title || "Untitled"}
          </span>
          {snippet && <span className="block truncate text-xs text-sidebar-muted">{snippet}</span>}
        </span>
      </button>
      <RailMenu label={`Options for ${c.title || "chat"}`} icon={<MoreHorizontal size={17} />} items={items} className="mr-1.5" />
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
    <li
      className={cn(
        "group relative flex items-center overflow-hidden rounded-xl transition-colors",
        active ? "bg-sidebar-item-hover ring-1 ring-inset ring-white/10" : "bg-sidebar-item hover:bg-sidebar-item-hover"
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-[3px]", bar)} aria-hidden />
      <button
        type="button"
        onClick={() => onSelect?.(project.id)}
        aria-current={active ? "page" : undefined}
        className="flex h-11 min-w-0 flex-1 items-center gap-3 pl-4 pr-1 text-left text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <Folder size={18} className="shrink-0 text-sidebar-foreground/80" aria-hidden />
        <span className={cn("truncate", active ? "text-white" : "text-sidebar-foreground")}>{project.name}</span>
      </button>
      {items.length > 0 && (
        <RailMenu label={`Options for ${project.name}`} icon={<MoreHorizontal size={17} />} items={items} className="mr-1.5" />
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

function RailMenu({
  label,
  icon,
  items,
  className,
}: {
  label: string;
  icon: React.ReactNode;
  items: MenuItem[];
  className?: string;
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
    const width = 200;
    const height = items.length * 40 + 12;
    const left = Math.min(window.innerWidth - width - 8, Math.max(8, r.right - width));
    const below = r.bottom + 6;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, r.top - height - 6) : below;
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
        className={cn(
          "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sidebar-muted transition-colors hover:bg-white/10 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          open && "bg-white/10 text-sidebar-foreground",
          className
        )}
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
            style={{ top: pos.top, left: pos.left, width: 200 }}
            className="fixed z-[60] rounded-2xl border border-white/10 bg-[#232323] p-1.5 text-sidebar-foreground shadow-[0_18px_44px_-10px_rgb(0_0_0/0.6)] motion-safe:animate-fadeUp"
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
                  "flex h-9 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:bg-white/[0.08] hover:bg-white/[0.08]",
                  it.danger ? "text-[#ff8f86]" : "text-sidebar-foreground",
                  it.desktopOnly && "hidden lg:flex"
                )}
              >
                <it.icon size={15} className="shrink-0 opacity-85" aria-hidden />
                {it.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
