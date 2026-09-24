"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import type { ModelTier } from "@/lib/brain";
import type { BrainModel } from "@/lib/models";

// Full history/project shapes (a superset of the Sidebar's display items).
export interface Conversation {
  id: string;
  title: string | null;
  pinned: boolean;
  project_id: string | null;
  model_tier: ModelTier;
  created_at: string;
  updated_at: string;
  /** Archived threads are hidden from the main history list. */
  archived?: boolean;
}

export interface Project {
  id: string;
  name: string;
  system_prompt: string | null;
  created_at: string;
}

export interface AppChromeProps {
  initialConversations: Conversation[];
  initialProjects: Project[];
  initialTier?: ModelTier;
  /** Workspace default when it is a concrete model id (admin settings), else null. */
  initialModel?: string | null;
  /** Permitted model catalog (fetched + permission-filtered server-side). */
  models?: BrainModel[];
  /** The user has a model allowlist: no tier presets, concrete models only. */
  restrictedToModels?: boolean;
  /** Signed-in user's first name, for the greeting. */
  firstName?: string;
  /** Display name + email, for the sidebar profile card. */
  fullName?: string;
  email?: string;
  /** The user's profile picture ("/api/account/avatar?v=…"), or null for initials. */
  avatarUrl?: string | null;
  /** Whether to surface the Admin link (role resolved server-side). */
  isAdmin?: boolean;
  /**
   * The user's resolved capability ids (SessionProfile.capabilities). AppShell
   * exposes them to the chrome and the chat (useCapability) to hide what the
   * user can't use; the routes enforce the same capabilities server-side.
   */
  features?: string[];
  /** Tokens the user has already spent this month, for the persisted meter. */
  initialTokens?: number;
  children: React.ReactNode;
}

// Pinned first, then most-recently-touched first — mirrors the SQL ordering so
// optimistic client updates match what a refetch would return.
function sortConversations(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updated_at.localeCompare(a.updated_at);
  });
}

/** Max ids per bulk request (the /api/conversations bulk limit). */
const BULK_LIMIT = 200;

/** Stable default for `features` (a fresh [] each render would re-run AppShell's capability memos). */
const NO_FEATURES: string[] = [];

/**
 * Optimistic bulk archive/unarchive: flip `archived` on every listed id,
 * unpinning when archiving (as the single Archive action does).
 */
export function applyBulkArchive(
  list: Conversation[],
  ids: ReadonlySet<string>,
  archived: boolean
): Conversation[] {
  return sortConversations(
    list.map((c) =>
      ids.has(c.id) ? { ...c, archived, pinned: archived ? false : c.pinned } : c
    )
  );
}

/** Optimistic bulk delete: drop every listed id. */
export function removeConversations(
  list: Conversation[],
  ids: ReadonlySet<string>
): Conversation[] {
  return list.filter((c) => !ids.has(c.id));
}

/**
 * Undo an optimistic bulk change: put each original record back — replacing
 * its optimistic copy, or re-inserting it if it was removed — while keeping
 * any other change made to the list since.
 */
export function restoreConversations(
  list: Conversation[],
  originals: Conversation[]
): Conversation[] {
  const byId = new Map(originals.map((c) => [c.id, c]));
  const next = list.map((c) => byId.get(c.id) ?? c);
  const present = new Set(list.map((c) => c.id));
  for (const c of originals) if (!present.has(c.id)) next.push(c);
  return sortConversations(next);
}

/** Split ids into request-sized batches. */
function batches(ids: string[], size = BULK_LIMIT): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** POST/PATCH/DELETE helper that returns parsed JSON or throws on failure. */
async function mutate<T>(url: string, method: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail?.error?.message ?? detail?.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/**
 * Client controller that wires the Sidebar's history + project affordances to
 * the user-scoped /api/conversations and /api/projects routes, then renders the
 * authenticated {@link AppShell} chrome around the page. Server-fetched initial
 * data hydrates the lists; every mutation updates local state optimistically and
 * navigates where appropriate.
 */
export function AppChrome({
  initialConversations,
  initialProjects,
  initialTier = "recommended",
  initialModel = null,
  models = [],
  restrictedToModels = false,
  firstName = "",
  fullName = "",
  email = "",
  avatarUrl = null,
  isAdmin = false,
  features = NO_FEATURES,
  initialTokens = 0,
  children,
}: AppChromeProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [conversations, setConversations] = useState<Conversation[]>(() =>
    sortConversations(initialConversations)
  );
  const [projects, setProjects] = useState<Project[]>(initialProjects);

  // Re-sync when the server layout re-fetches (e.g. the chat view calls
  // router.refresh() after a lazily-created thread is saved). Server data is the
  // source of truth; our own mutations are already persisted before this fires.
  useEffect(() => {
    setConversations(sortConversations(initialConversations));
  }, [initialConversations]);
  useEffect(() => {
    setProjects(initialProjects);
  }, [initialProjects]);

  // A new/updated chat streams in ChatView, which persists it and broadcasts
  // "chat:saved". Reflect it in the sidebar immediately (add if new, re-title
  // if it was a placeholder) so history is never stale between navigations.
  useEffect(() => {
    function onSaved(e: Event) {
      const detail = (e as CustomEvent<{ id: string; title?: string }>).detail;
      if (!detail?.id) return;
      const now = new Date().toISOString();
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.id === detail.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], title: detail.title ?? next[idx].title, updated_at: now };
          return sortConversations(next);
        }
        return sortConversations([
          {
            id: detail.id,
            title: detail.title ?? "New chat",
            pinned: false,
            project_id: null,
            model_tier: initialTier ?? "recommended",
            created_at: now,
            updated_at: now,
            archived: false,
          },
          ...prev,
        ]);
      });
    }
    window.addEventListener("chat:saved", onSaved);
    return () => window.removeEventListener("chat:saved", onSaved);
  }, [initialTier]);

  // Derive the open conversation id from the URL (/c/[id]) for the highlight.
  const activeConversationId = useMemo(() => {
    const m = pathname?.match(/^\/c\/([^/]+)/);
    return m ? m[1] : null;
  }, [pathname]);

  // --- dialog state -------------------------------------------------------
  // The project whose workspace page is open (/projects/[id]) drives the sidebar
  // highlight; clicking a project navigates here (see handleSelectProject).
  const activeProjectId = useMemo(() => {
    if (!pathname || !pathname.startsWith("/projects/")) return null;
    const rest = pathname.slice("/projects/".length);
    const slash = rest.indexOf("/");
    return (slash === -1 ? rest : rest.slice(0, slash)) || null;
  }, [pathname]);

  const [renameTarget, setRenameTarget] = useState<Conversation | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  /** Ids awaiting bulk-delete confirmation (null = dialog closed). */
  const [bulkDeleteIds, setBulkDeleteIds] = useState<string[] | null>(null);
  const [projectOpen, setProjectOpen] = useState(false);
  const [renameProjectTarget, setRenameProjectTarget] = useState<Project | null>(null);
  const [deleteProjectTarget, setDeleteProjectTarget] = useState<Project | null>(null);

  // --- conversation handlers ---------------------------------------------
  const handleNewChat = useCallback(() => {
    // The sidebar's New chat is always unscoped: the chat surface creates the
    // thread lazily on the first message. A chat scoped to a project is started
    // from that project's page instead (/projects/[id] -> New chat).
    router.push("/");
  }, [router]);

  const handleSelectConversation = useCallback(
    (id: string) => router.push(`/c/${id}`),
    [router]
  );

  const handlePin = useCallback(
    async (id: string, pinned: boolean) => {
      // Optimistic; revert on failure.
      const snapshot = conversations;
      setConversations((prev) =>
        sortConversations(
          prev.map((c) =>
            c.id === id
              ? { ...c, pinned, updated_at: new Date().toISOString() }
              : c
          )
        )
      );
      try {
        await mutate("/api/conversations", "PATCH", { id, pinned });
      } catch {
        setConversations(snapshot);
      }
    },
    [conversations]
  );

  const handleArchive = useCallback(
    async (id: string, archived: boolean) => {
      const snapshot = conversations;
      // Optimistic: flip the flag (and unpin when archiving).
      setConversations((prev) =>
        sortConversations(
          prev.map((c) =>
            c.id === id ? { ...c, archived, pinned: archived ? false : c.pinned } : c
          )
        )
      );
      // If the open thread is being archived, leave it.
      if (archived && activeConversationId === id) router.push("/");
      try {
        await mutate("/api/conversations", "PATCH", { id, archived });
      } catch {
        setConversations(snapshot); // revert (e.g. before migration 0005)
      }
    },
    [conversations, activeConversationId, router]
  );

  // Bulk archive/unarchive from the sidebar's selection mode. Optimistic like
  // handleArchive; on failure only the targeted rows revert, then we resync
  // from the server (an earlier batch may already have been applied).
  const handleBulkArchive = useCallback(
    async (ids: string[], archived: boolean) => {
      const idSet = new Set(ids);
      const originals = conversations.filter((c) => idSet.has(c.id));
      if (originals.length === 0) return;
      setConversations((prev) => applyBulkArchive(prev, idSet, archived));
      // If the open thread is being archived, leave it.
      if (archived && activeConversationId && idSet.has(activeConversationId)) {
        router.push("/");
      }
      try {
        for (const batch of batches(originals.map((c) => c.id))) {
          await mutate("/api/conversations", "PATCH", { ids: batch, archived });
        }
      } catch {
        setConversations((prev) => restoreConversations(prev, originals));
        router.refresh();
      }
    },
    [conversations, activeConversationId, router]
  );

  // Bulk delete asks first; the dialog calls confirmBulkDelete.
  const handleBulkDelete = useCallback(
    (ids: string[]) => {
      const known = new Set(conversations.map((c) => c.id));
      const targets = ids.filter((id) => known.has(id));
      if (targets.length > 0) setBulkDeleteIds(targets);
    },
    [conversations]
  );

  // Confirmed: remove optimistically, restore the rows (and resync) on
  // failure — the error is rethrown for the dialog to show. Leaves the open
  // thread once its deletion has succeeded, as the single delete does.
  const confirmBulkDelete = useCallback(
    async (ids: string[]) => {
      const idSet = new Set(ids);
      const originals = conversations.filter((c) => idSet.has(c.id));
      setConversations((prev) => removeConversations(prev, idSet));
      try {
        for (const batch of batches(ids)) {
          await mutate("/api/conversations", "DELETE", { ids: batch });
        }
      } catch (err) {
        setConversations((prev) => restoreConversations(prev, originals));
        router.refresh();
        throw err;
      }
      if (activeConversationId && idSet.has(activeConversationId)) router.push("/");
    },
    [conversations, activeConversationId, router]
  );

  // --- project handlers ---------------------------------------------------
  const handleSelectProject = useCallback(
    (id: string) => {
      // Open the project's workspace (its chats, instructions, and files).
      router.push(`/projects/${id}`);
    },
    [router]
  );

  // Map the rich records down to the Sidebar's display items (updated_at drives
  // the Today / Yesterday / Previous 7 days grouping).
  const sidebarConversations = useMemo(
    () =>
      conversations.map((c) => ({
        id: c.id,
        title: c.title ?? "New chat",
        pinned: c.pinned,
        updatedAt: c.updated_at,
        archived: c.archived ?? false,
      })),
    [conversations]
  );
  const sidebarProjects = useMemo(
    () => projects.map((p) => ({ id: p.id, name: p.name })),
    [projects]
  );

  // The open conversation's title for the top bar.
  const activeTitle = useMemo(
    () =>
      activeConversationId
        ? conversations.find((c) => c.id === activeConversationId)?.title ?? null
        : null,
    [conversations, activeConversationId]
  );

  return (
    <>
      <AppShell
        projects={sidebarProjects}
        conversations={sidebarConversations}
        activeConversationId={activeConversationId}
        initialTier={initialTier}
        initialModel={initialModel}
        models={models}
        restrictedToModels={restrictedToModels}
        firstName={firstName}
        fullName={fullName}
        email={email}
        avatarUrl={avatarUrl}
        isAdmin={isAdmin}
        features={features}
        initialTokens={initialTokens}
        title={activeTitle}
        onNewChat={handleNewChat}
        onNewProject={() => setProjectOpen(true)}
        onSelectProject={handleSelectProject}
        activeProjectId={activeProjectId}
        onRenameProject={(id) =>
          setRenameProjectTarget(projects.find((p) => p.id === id) ?? null)
        }
        onDeleteProject={(id) =>
          setDeleteProjectTarget(projects.find((p) => p.id === id) ?? null)
        }
        onSelectConversation={handleSelectConversation}
        onRenameConversation={(id) =>
          setRenameTarget(conversations.find((c) => c.id === id) ?? null)
        }
        onPinConversation={handlePin}
        onArchiveConversation={handleArchive}
        onDeleteConversation={(id) =>
          setDeleteTarget(conversations.find((c) => c.id === id) ?? null)
        }
        onBulkArchive={handleBulkArchive}
        onBulkDelete={handleBulkDelete}
      >
        {children}
      </AppShell>

      <RenameDialog
        conversation={renameTarget}
        onClose={() => setRenameTarget(null)}
        onSaved={(updated) =>
          setConversations((prev) =>
            sortConversations(prev.map((c) => (c.id === updated.id ? updated : c)))
          )
        }
      />

      <DeleteDialog
        conversation={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={(id) => {
          setConversations((prev) => prev.filter((c) => c.id !== id));
          if (activeConversationId === id) router.push("/");
        }}
      />

      <BulkDeleteDialog
        ids={bulkDeleteIds}
        onClose={() => setBulkDeleteIds(null)}
        onConfirm={confirmBulkDelete}
      />

      <NewProjectDialog
        open={projectOpen}
        onClose={() => setProjectOpen(false)}
        onCreated={(project) => {
          setProjects((prev) => [project, ...prev]);
          router.push(`/projects/${project.id}`); // open the new project's page
        }}
      />

      <RenameProjectDialog
        project={renameProjectTarget}
        onClose={() => setRenameProjectTarget(null)}
        onSaved={(updated) =>
          setProjects((prev) =>
            prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p))
          )
        }
      />

      <DeleteProjectDialog
        project={deleteProjectTarget}
        onClose={() => setDeleteProjectTarget(null)}
        onDeleted={(id) => {
          setProjects((prev) => prev.filter((p) => p.id !== id));
          if (activeProjectId === id) router.push("/");
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

function RenameDialog({
  conversation,
  onClose,
  onSaved,
}: {
  conversation: Conversation | null;
  onClose: () => void;
  onSaved: (c: Conversation) => void;
}) {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the input whenever a new target conversation opens the dialog.
  const open = conversation !== null;
  useEffect(() => {
    if (conversation) {
      setValue(conversation.title ?? "");
      setError(null);
    }
  }, [conversation]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!conversation) return;
    const title = value.trim();
    if (!title) return;
    setPending(true);
    setError(null);
    try {
      const { conversation: updated } = await mutate<{ conversation: Conversation }>(
        "/api/conversations",
        "PATCH",
        { id: conversation.id, title }
      );
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Rename conversation">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="rename-title" className="block text-sm font-medium">
            Title
          </label>
          <input
            id="rename-title"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={200}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={pending || !value.trim()}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Where focus lands after a chat delete removed the dialog's opener (a row, or
 * the selection bar that unmounts when selection mode ends): the rail's
 * "Chats" section toggle (the button around its #rail-chats label).
 */
function railChatsToggle(): HTMLElement | null {
  return document.getElementById("rail-chats")?.closest("button") ?? null;
}

function DeleteDialog({
  conversation,
  onClose,
  onDeleted,
}: {
  conversation: Conversation | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConfirm() {
    if (!conversation) return;
    setPending(true);
    setError(null);
    try {
      await mutate("/api/conversations", "DELETE", { id: conversation.id });
      onDeleted(conversation.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open={conversation !== null}
      onClose={onClose}
      title="Delete conversation"
      returnFocus={railChatsToggle}
    >
      <p className="text-sm text-muted-foreground">
        Delete{" "}
        <span className="font-medium text-foreground">
          {conversation?.title || "this conversation"}
        </span>
        ? This also removes its messages and cannot be undone.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="danger"
          size="sm"
          onClick={onConfirm}
          disabled={pending}
        >
          {pending ? "Deleting…" : "Delete"}
        </Button>
      </div>
    </Modal>
  );
}

function BulkDeleteDialog({
  ids,
  onClose,
  onConfirm,
}: {
  ids: string[] | null;
  onClose: () => void;
  /** Performs the delete; rejects with the error to show. */
  onConfirm: (ids: string[]) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = ids?.length ?? 0;
  const label = `${count} chat${count === 1 ? "" : "s"}`;

  // Fresh state each time the dialog opens for a new selection.
  useEffect(() => {
    if (ids) setError(null);
  }, [ids]);

  async function onDelete() {
    if (!ids || pending) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm(ids);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open={ids !== null}
      onClose={onClose}
      title={count === 1 ? "Delete chat" : `Delete ${count} chats`}
      returnFocus={railChatsToggle}
    >
      <p className="text-sm text-muted-foreground">
        Delete <span className="font-medium text-foreground">{label}</span>? This
        can&apos;t be undone.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="danger"
          size="sm"
          onClick={onDelete}
          disabled={pending}
        >
          {pending ? "Deleting…" : "Delete"}
        </Button>
      </div>
    </Modal>
  );
}

function NewProjectDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (p: Project) => void;
}) {
  const [name, setName] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setSystemPrompt("");
    setError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setPending(true);
    setError(null);
    try {
      const { project } = await mutate<{ project: Project }>(
        "/api/projects",
        "POST",
        { name: trimmed, systemPrompt: systemPrompt.trim() || null }
      );
      onCreated(project);
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create project");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="New project"
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="project-name" className="block text-sm font-medium">
            Name
          </label>
          <input
            id="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder="e.g. Q3 Compliance"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="project-prompt" className="block text-sm font-medium">
            System prompt{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id="project-prompt"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={4}
            maxLength={8000}
            placeholder="Extra context sent to the Brain for chats in this project."
            className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={pending || !name.trim()}>
            {pending ? "Creating…" : "Create project"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RenameProjectDialog({
  project,
  onClose,
  onSaved,
}: {
  project: Project | null;
  onClose: () => void;
  onSaved: (p: Project) => void;
}) {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = project !== null;
  useEffect(() => {
    if (project) {
      setValue(project.name ?? "");
      setError(null);
    }
  }, [project]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!project) return;
    const name = value.trim();
    if (!name) return;
    setPending(true);
    setError(null);
    try {
      const { project: updated } = await mutate<{ project: Project }>(
        "/api/projects",
        "PATCH",
        { id: project.id, name }
      );
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename project");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Rename project">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="rename-project" className="block text-sm font-medium">
            Name
          </label>
          <input
            id="rename-project"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={120}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={pending || !value.trim()}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteProjectDialog({
  project,
  onClose,
  onDeleted,
}: {
  project: Project | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConfirm() {
    if (!project) return;
    setPending(true);
    setError(null);
    try {
      await mutate("/api/projects", "DELETE", { id: project.id });
      onDeleted(project.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete project");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal open={project !== null} onClose={onClose} title="Delete project">
      <p className="text-sm text-muted-foreground">
        Delete{" "}
        <span className="font-medium text-foreground">
          {project?.name || "this project"}
        </span>
        ? Its chats are kept and simply un-grouped. This cannot be undone.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="danger"
          size="sm"
          onClick={onConfirm}
          disabled={pending}
        >
          {pending ? "Deleting…" : "Delete"}
        </Button>
      </div>
    </Modal>
  );
}
