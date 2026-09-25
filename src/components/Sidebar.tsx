"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  ArchiveRestore,
  Brain,
  Check,
  ChevronDown,
  ClipboardCheck,
  Folder,
  Lightbulb,
  ListChecks,
  Loader2,
  LogOut,
  MessageSquare,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  ShieldCheck,
  Sun,
  Trash2,
  User,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/Brand";
import { UserAvatar } from "@/components/UserAvatar";
import { resetAvatarUrl } from "@/lib/avatar-client";
import { resetChatSessions } from "@/lib/chat-sessions";
import { resolveTheme, useTheme } from "@/lib/theme";

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
  /** Conversations generating an answer right now (on screen or in the background): a spinner. */
  generatingIds?: ReadonlySet<string>;
  /** Show the Admin link (role admin/super_admin, resolved server-side). */
  isAdmin?: boolean;
  /**
   * The user's resolved capability ids: "knowledge.map" shows the Brain map
   * link, "learning.read" Learnings, "app.projects" the New project actions.
   * Omitted = no gating (everything shown). Hides UI only; the pages and
   * routes enforce the same capabilities server-side.
   */
  capabilities?: readonly string[];
  /** Identity for the profile card. */
  fullName?: string;
  email?: string;
  /** Profile picture URL, or null for initials. */
  avatarUrl?: string | null;

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
  /**
   * Bulk actions for the rail's selection mode ("Select chats" in the Chats
   * menu). Selection mode is only offered when at least one is provided.
   * `archived` is true to archive, false to unarchive (when every selected
   * chat is already archived).
   */
  onBulkArchive?: (ids: string[], archived: boolean) => void;
  /** Delete the selected chats; the host is expected to confirm first. */
  onBulkDelete?: (ids: string[]) => void;

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

/**
 * The `archived` value the bulk Archive button sends for a selection: false
 * ("Unarchive") only when every selected chat is already archived, otherwise
 * true ("Archive" — a mixed selection archives everything).
 */
export function bulkArchiveTarget(selected: readonly Pick<ConversationItem, "archived">[]): boolean {
  return !(selected.length > 0 && selected.every((c) => c.archived));
}

/**
 * Toggle `id` in a selection. With an `anchor` (the last row toggled) and the
 * visible row `order`, the whole anchor→id range takes the new state of `id`
 * (shift-click). Returns a new Set; never mutates `prev`.
 */
export function toggleSelection(
  prev: ReadonlySet<string>,
  id: string,
  opts: { anchor?: string | null; order?: readonly string[] } = {}
): Set<string> {
  const next = new Set(prev);
  const checked = !prev.has(id);
  const order = opts.order ?? [];
  const from = opts.anchor ? order.indexOf(opts.anchor) : -1;
  const to = order.indexOf(id);
  const range = from >= 0 && to >= 0 && from !== to ? order.slice(Math.min(from, to), Math.max(from, to) + 1) : [id];
  for (const rid of range) {
    if (checked) next.add(rid);
    else next.delete(rid);
  }
  return next;
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
  generatingIds,
  isAdmin = false,
  capabilities,
  fullName = "",
  email = "",
  avatarUrl = null,
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
  onBulkArchive,
  onBulkDelete,
  className,
}: SidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
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

  // --- Selection mode (bulk archive / delete) --------------------------------
  // Entered from the Chats "•••" menu. Rows become checkboxes; a bar at the
  // bottom of the panel acts on the selection. The selection only ever holds
  // rows that are currently visible, so a bulk action never touches a chat the
  // user can't see (e.g. one hidden by a search or the collapsed Archived list).
  const canSelect = Boolean(onBulkArchive || onBulkDelete);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  /** Last row toggled — the anchor for shift-click range selection. */
  const anchorRef = useRef<string | null>(null);
  /** Ids handed to onBulkDelete; selection mode ends once they're all gone. */
  const pendingDeleteRef = useRef<string[] | null>(null);
  /** Move focus back into the rail after the selection UI it was on unmounts. */
  const restoreFocusRef = useRef(false);
  const asideRef = useRef<HTMLElement>(null);
  const selectAllRef = useRef<HTMLButtonElement>(null);
  const chatsToggleRef = useRef<HTMLButtonElement>(null);

  const exitSelection = useCallback((restoreFocus = false) => {
    setSelecting(false);
    setSelected((prev) => (prev.size ? new Set() : prev));
    anchorRef.current = null;
    pendingDeleteRef.current = null;
    restoreFocusRef.current = restoreFocus;
  }, []);

  const enterSelection = useCallback(() => {
    setSelected(new Set());
    anchorRef.current = null;
    pendingDeleteRef.current = null;
    setSelecting(true);
    setChatsOpen(true);
    // Only archived chats left: show them, or there'd be nothing to select.
    if (active.length === 0 && archivedList.length > 0) setArchivedOpen(true);
  }, [active.length, archivedList.length]);

  // Focus: land on "Select all" when entering; when leaving via the rail's own
  // controls (Cancel / Archive / Escape), recover focus if it was dropped.
  const wasSelecting = useRef(false);
  useEffect(() => {
    if (selecting === wasSelecting.current) return;
    wasSelecting.current = selecting;
    if (selecting) {
      selectAllRef.current?.focus({ preventScroll: true });
    } else if (restoreFocusRef.current) {
      restoreFocusRef.current = false;
      const focused = document.activeElement;
      if (!focused || focused === document.body) chatsToggleRef.current?.focus({ preventScroll: true });
    }
  }, [selecting]);

  // Navigating anywhere ends selection mode.
  const lastPathname = useRef(pathname);
  useEffect(() => {
    if (lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    exitSelection();
  }, [pathname, exitSelection]);

  // The selectable rows, in on-screen order (drives Select all + shift ranges).
  const visibleIds = useMemo(() => {
    if (!selecting) return [];
    if (searching) return searchResults.map((r) => r.conversation.id);
    if (!chatsOpen) return [];
    const ids = groups.flatMap((g) => g.items.map((c) => c.id));
    if (archivedOpen) ids.push(...archivedList.map((c) => c.id));
    return ids;
  }, [selecting, searching, searchResults, chatsOpen, groups, archivedOpen, archivedList]);

  // Drop selected rows that are no longer visible (filtered out, collapsed,
  // deleted elsewhere). Keeps the same Set when nothing changed.
  useEffect(() => {
    if (!selecting) return;
    const visible = new Set(visibleIds);
    setSelected((prev) => {
      for (const id of prev) {
        if (!visible.has(id)) return new Set([...prev].filter((x) => visible.has(x)));
      }
      return prev;
    });
  }, [selecting, visibleIds]);

  // After a confirmed bulk delete removes every chat it targeted, leave
  // selection mode (a cancelled confirmation keeps the selection intact).
  useEffect(() => {
    const pending = pendingDeleteRef.current;
    if (!pending) return;
    const present = new Set(conversations.map((c) => c.id));
    if (pending.every((id) => !present.has(id))) exitSelection();
  }, [conversations, exitSelection]);

  // Escape leaves selection mode — unless a menu or dialog owns the key, or the
  // user is typing in a field outside the rail (e.g. the composer).
  useEffect(() => {
    if (!selecting) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('[role="menu"], [role="dialog"]')) return;
      const inRail = target ? asideRef.current?.contains(target) : false;
      if (!inRail && target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      exitSelection(true);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selecting, exitSelection]);

  const toggleSelected = useCallback(
    (id: string, range: boolean) => {
      // Read the anchor now: the updater may run after anchorRef moves on.
      const anchor = range ? anchorRef.current : null;
      setSelected((prev) => toggleSelection(prev, id, { anchor, order: visibleIds }));
      anchorRef.current = id;
    },
    [visibleIds]
  );

  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const toggleAll = useCallback(() => {
    setSelected(allVisibleSelected ? new Set() : new Set(visibleIds));
    anchorRef.current = null;
  }, [allVisibleSelected, visibleIds]);

  const selectedItems = useMemo(
    () => conversations.filter((c) => selected.has(c.id)),
    [conversations, selected]
  );
  const archiveTarget = bulkArchiveTarget(selectedItems);

  const runBulkArchive = useCallback(() => {
    if (!onBulkArchive || selectedItems.length === 0) return;
    onBulkArchive(
      selectedItems.map((c) => c.id),
      archiveTarget
    );
    exitSelection(true);
  }, [onBulkArchive, selectedItems, archiveTarget, exitSelection]);

  const runBulkDelete = useCallback(() => {
    if (!onBulkDelete || selectedItems.length === 0) return;
    const ids = selectedItems.map((c) => c.id);
    pendingDeleteRef.current = ids;
    onBulkDelete(ids);
  }, [onBulkDelete, selectedItems]);

  /** Wrap a navigation handler so it also ends selection mode. */
  const leavingSelection = useCallback(
    <A extends unknown[]>(fn?: (...args: A) => void) =>
      fn &&
      ((...args: A) => {
        exitSelection();
        fn(...args);
      }),
    [exitSelection]
  );

  const archivedToggle: MenuItem[] =
    archivedList.length > 0
      ? [
          {
            label: archivedOpen ? "Hide archived" : `Show archived (${archivedList.length})`,
            icon: Archive,
            onSelect: () => setArchivedOpen((o) => !o),
          },
        ]
      : [];
  const chatsMenu: MenuItem[] = [
    ...(canSelect && conversations.length > 0
      ? [{ label: "Select chats", icon: ListChecks, onSelect: enterSelection }]
      : []),
    ...archivedToggle,
  ];

  // Capability gating (hidden, not disabled). No list = ungated.
  const can = useCallback((id: string) => !capabilities || capabilities.includes(id), [capabilities]);
  const canBrainMap = can("knowledge.map");
  const canLearnings = can("learning.read");
  const canCreateProjects = can("app.projects");
  const newProject = canCreateProjects ? onNewProject : undefined;
  // Existing projects stay listed (and usable) without "app.projects"; only
  // creating new ones is gated, so an empty section with nothing to do hides.
  const showProjects = projects.length > 0 || !!newProject;

  // Light/dark switch in the More menu (Settings → Appearance also offers System).
  const [themePref, setThemePref] = useTheme();
  const dark = resolveTheme(themePref) === "dark";

  const signOut = useCallback(async () => {
    // The avatar store outlives a client-side sign-out; never show this
    // user's picture to whoever signs in next on the same tab.
    resetAvatarUrl();
    // Likewise background chats: stop their streams and drop queued turns.
    resetChatSessions();
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
    generatingIds,
    onSelect: onSelectConversation,
    onRename: onRenameConversation,
    onPin: onPinConversation,
    onArchive: onArchiveConversation,
    onDelete: onDeleteConversation,
    selecting,
    onToggleSelect: toggleSelected,
  };

  const selectionHeaderProps = {
    count: selected.size,
    allSelected: allVisibleSelected,
    canToggleAll: visibleIds.length > 0,
    onToggleAll: toggleAll,
    toggleRef: selectAllRef,
  };

  return (
    <aside
      ref={asideRef}
      aria-label="Sidebar"
      className={cn(
        // Below lg the drawer starts under the installed app's draggable title
        // strip (--titlebar-h, 0 in a browser tab); no h-full there, or it
        // would overrun the bottom by that strip. lg:static resets top/bottom.
        "fixed bottom-0 left-0 top-[var(--titlebar-h)] z-40 flex w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground lg:h-full",
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
              ...(canBrainMap ? [{ label: "Brain map", icon: Brain, onSelect: () => router.push("/brain") }] : []),
              ...(canLearnings ? [{ label: "Learnings", icon: Lightbulb, onSelect: () => router.push("/learning") }] : []),
              { label: "Approvals", icon: ClipboardCheck, onSelect: () => router.push("/approvals") },
              { label: "Account", icon: User, onSelect: () => router.push("/account") },
              ...(isAdmin ? [{ label: "Admin", icon: ShieldCheck, onSelect: () => router.push("/admin") }] : []),
              ...(onCollapse
                ? [{ label: "Collapse sidebar", icon: PanelLeftClose, onSelect: onCollapse, desktopOnly: true }]
                : []),
              {
                label: dark ? "Light theme" : "Dark theme",
                icon: dark ? Sun : Moon,
                onSelect: () => setThemePref(dark ? "light" : "dark"),
              },
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
            <RailButton icon={Plus} label="New chat" onClick={leavingSelection(onNewChat)} />
            <label className={cn(ROW, ROW_IDLE, "cursor-text focus-within:bg-sidebar-item-hover")}>
              <span className={ICON_BOX}>
                <Search size={16} strokeWidth={1.75} aria-hidden />
              </span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  // Escape clears a query first (and so doesn't also end selection mode).
                  if (e.key === "Escape" && query) {
                    e.preventDefault();
                    setQuery("");
                  }
                }}
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
              {selecting && <SelectionHeader {...selectionHeaderProps} />}
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
                    selected={selected.has(conversation.id)}
                    {...rowProps}
                  />
                ))}
              </ul>
            </section>
          ) : (
            <>
              {/* Projects (folders) */}
              {showProjects && (
                <section className="mt-4" aria-labelledby="rail-projects">
                  <SectionHeader
                    id="rail-projects"
                    label="Projects"
                    open={projectsOpen}
                    onToggle={() => setProjectsOpen((o) => !o)}
                    onAdd={newProject}
                    addLabel="New project"
                  />
                  {projectsOpen && (
                    <>
                      {projects.length === 0 ? (
                        <button
                          type="button"
                          onClick={newProject}
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
                              onSelect={leavingSelection(onSelectProject)}
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
              )}

              {/* Chats */}
              <section className="mt-4" aria-labelledby="rail-chats">
                {selecting ? (
                  <SelectionHeader
                    id="rail-chats"
                    label="Chats"
                    menu={archivedToggle}
                    {...selectionHeaderProps}
                  />
                ) : (
                  <SectionHeader
                    id="rail-chats"
                    label="Chats"
                    open={chatsOpen}
                    onToggle={() => setChatsOpen((o) => !o)}
                    onAdd={onNewChat}
                    addLabel="New chat"
                    menu={chatsMenu}
                    toggleRef={chatsToggleRef}
                  />
                )}
                {chatsOpen &&
                  (active.length === 0 ? (
                    <p className="py-1 pl-[38px] pr-3 text-xs text-sidebar-muted">Your chats will appear here.</p>
                  ) : (
                    groups.map((group) => (
                      <div key={group.label}>
                        <p className={GROUP_LABEL}>{group.label}</p>
                        <ul className="space-y-0.5">
                          {group.items.map((c) => (
                            <ConversationRow
                              key={c.id}
                              conversation={c}
                              active={c.id === activeConversationId}
                              selected={selected.has(c.id)}
                              {...rowProps}
                            />
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
                        <ConversationRow
                          key={c.id}
                          conversation={c}
                          active={c.id === activeConversationId}
                          selected={selected.has(c.id)}
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

        {/* Selection action bar — pinned to the panel's bottom edge, outside
            the scroll area, so it stays put while the list scrolls. */}
        {selecting && (
          <div
            role="group"
            aria-label="Selected chats"
            className="flex shrink-0 items-center gap-1 border-t border-white/[0.06] p-1.5"
          >
            {onBulkArchive && (
              <button
                type="button"
                onClick={runBulkArchive}
                disabled={selectedItems.length === 0}
                className={cn(BAR_BTN, "flex-auto bg-sidebar-item text-sidebar-foreground hover:bg-sidebar-item-hover hover:text-white")}
              >
                {archiveTarget ? "Archive" : "Unarchive"}
              </button>
            )}
            {onBulkDelete && (
              <button
                type="button"
                onClick={runBulkDelete}
                disabled={selectedItems.length === 0}
                className={cn(BAR_BTN, "flex-auto bg-[#ff8f86]/10 text-[#ff8f86] hover:bg-[#ff8f86]/20")}
              >
                Delete
              </button>
            )}
            <button
              type="button"
              onClick={() => exitSelection(true)}
              className={cn(BAR_BTN, "flex-none text-sidebar-muted hover:bg-white/10 hover:text-sidebar-foreground")}
            >
              Cancel
            </button>
          </div>
        )}
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
          <UserAvatar name={fullName} email={email} avatarUrl={avatarUrl} size={28} />
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
/** Selection action bar buttons: 32px, sized to their label, sharing the row. */
const BAR_BTN =
  "inline-flex h-8 min-w-0 items-center justify-center whitespace-nowrap rounded-lg px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";

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
  toggleRef,
}: {
  id: string;
  label: string;
  open: boolean;
  onToggle: () => void;
  onAdd?: () => void;
  addLabel: string;
  menu?: MenuItem[];
  toggleRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <div className="flex h-7 items-center pr-0.5">
      <button
        ref={toggleRef}
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

/**
 * The Chats header while selecting: "N selected" on the label column and a
 * Select all / Clear toggle in the trailing area (the optional ••• menu keeps
 * the rightmost trailing column). Sticks to the top of the scroll area so the
 * count and toggle stay reachable in a long list.
 */
function SelectionHeader({
  id,
  label,
  count,
  allSelected,
  canToggleAll,
  onToggleAll,
  toggleRef,
  menu,
}: {
  /** Labels the enclosing section (kept as the section name, not the count). */
  id?: string;
  label?: string;
  count: number;
  allSelected: boolean;
  canToggleAll: boolean;
  onToggleAll: () => void;
  toggleRef?: React.Ref<HTMLButtonElement>;
  menu?: MenuItem[];
}) {
  return (
    <div className="sticky top-0 z-10 flex h-7 items-center bg-sidebar-panel pr-0.5">
      <div className="flex h-full min-w-0 flex-1 items-center gap-2.5 pl-3 text-xs font-medium text-sidebar-foreground">
        <span className="flex w-4 shrink-0 items-center justify-center text-accent">
          <ListChecks size={14} aria-hidden />
        </span>
        {id && label && (
          <span id={id} className="sr-only">
            {label}
          </span>
        )}
        <span role="status" aria-live="polite" className="truncate">
          {count} selected
        </span>
      </div>
      <button
        ref={toggleRef}
        type="button"
        onClick={onToggleAll}
        disabled={!canToggleAll}
        aria-label={allSelected ? "Clear selection" : "Select all chats"}
        className="inline-flex h-7 shrink-0 items-center rounded-md px-2 text-xs font-medium text-accent transition-colors hover:bg-white/10 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
      >
        {allSelected ? "Clear" : "Select all"}
      </button>
      {menu && menu.length > 0 && (
        <RailMenu label={`${label ?? "Chats"} options`} icon={<MoreHorizontal size={16} />} items={menu} />
      )}
    </div>
  );
}

/** The 14px checkbox glyph shown in a row's icon box while selecting. */
function SelectBox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-3.5 w-3.5 items-center justify-center rounded-[4px] border transition-colors",
        checked
          ? "border-accent bg-accent text-accent-foreground"
          : "border-sidebar-foreground/40 group-hover:border-sidebar-foreground/70"
      )}
    >
      {checked && <Check size={11} strokeWidth={3} />}
    </span>
  );
}

function ConversationRow({
  conversation: c,
  active,
  snippet,
  generatingIds,
  onSelect,
  onRename,
  onPin,
  onArchive,
  onDelete,
  selecting = false,
  selected = false,
  onToggleSelect,
}: {
  conversation: ConversationItem;
  active: boolean;
  snippet?: string;
  /** Conversations generating an answer: the row's icon becomes a spinner. */
  generatingIds?: ReadonlySet<string>;
  onSelect?: (id: string) => void;
  onRename?: (id: string) => void;
  onPin?: (id: string, pinned: boolean) => void;
  onArchive?: (id: string, archived: boolean) => void;
  onDelete?: (id: string) => void;
  /** Selection mode: the row is a checkbox and clicking toggles it. */
  selecting?: boolean;
  selected?: boolean;
  /** `range` is true for shift-click (select the run from the last toggled row). */
  onToggleSelect?: (id: string, range: boolean) => void;
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
  // While selecting, the highlight follows the selection (not the open chat)
  // and the per-row ••• menu steps aside.
  const highlighted = selecting ? selected : active;
  const generating = !selecting && !!generatingIds?.has(c.id);
  return (
    <li className={cn("group relative flex items-center rounded-lg transition-colors", highlighted ? ROW_ACTIVE : ROW_IDLE)}>
      <button
        type="button"
        role={selecting ? "checkbox" : undefined}
        aria-checked={selecting ? selected : undefined}
        onClick={(e) => (selecting ? onToggleSelect?.(c.id, e.shiftKey) : onSelect?.(c.id))}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2.5 rounded-lg pl-3 pr-1 text-left text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          snippet ? "py-1.5" : "h-8",
          // No ••• while selecting: pad like a plain ROW instead. select-none
          // keeps shift-click (range select) from highlighting row text.
          selecting && "select-none pr-2"
        )}
      >
        <span
          className={cn(ICON_BOX, snippet && "self-start pt-0.5", !selecting && (active || c.pinned || generating) && "text-accent")}
          title={generating ? "Generating an answer" : undefined}
        >
          {selecting ? (
            <SelectBox checked={selected} />
          ) : generating ? (
            <Loader2 size={16} strokeWidth={1.75} className="animate-spin motion-reduce:animate-none" aria-hidden />
          ) : c.pinned ? (
            <Pin size={16} strokeWidth={1.75} aria-hidden />
          ) : (
            <MessageSquare size={16} strokeWidth={1.75} aria-hidden />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="fade-truncate block">{c.title || "Untitled"}</span>
          {snippet && <span className="mt-0.5 block truncate text-[11px] text-sidebar-muted">{snippet}</span>}
          {generating && <span className="sr-only">(generating)</span>}
        </span>
      </button>
      {!selecting && (
        <RailMenu
          label={`Options for ${c.title || "chat"}`}
          icon={<MoreHorizontal size={16} />}
          items={items}
          className="mr-0.5 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
          activeClassName="opacity-100"
        />
      )}
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
    // Rendered items only: a desktopOnly item is display:none below lg, and
    // focusing it silently fails (ArrowDown would get stuck before it).
    const list = itemRefs.current.filter(
      (el): el is HTMLButtonElement => !!el && el.getClientRects().length > 0
    );
    if (list.length === 0) return;
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
