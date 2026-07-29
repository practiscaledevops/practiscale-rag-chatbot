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
  /** Permitted model catalog (fetched + permission-filtered server-side). */
  models?: BrainModel[];
  /** Signed-in user's first name, for the greeting. */
  firstName?: string;
  /** Whether to surface the Admin link (role resolved server-side). */
  isAdmin?: boolean;
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
  models = [],
  firstName = "",
  isAdmin = false,
  children,
}: AppChromeProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [conversations, setConversations] = useState<Conversation[]>(() =>
    sortConversations(initialConversations)
  );
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  // Selecting a project scopes newly created chats to it (until cleared).
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  // Re-sync when the server layout re-fetches (e.g. the chat view calls
  // router.refresh() after a lazily-created thread is saved). Server data is the
  // source of truth; our own mutations are already persisted before this fires.
  useEffect(() => {
    setConversations(sortConversations(initialConversations));
  }, [initialConversations]);
  useEffect(() => {
    setProjects(initialProjects);
  }, [initialProjects]);

  // Derive the open conversation id from the URL (/c/[id]) for the highlight.
  const activeConversationId = useMemo(() => {
    const m = pathname?.match(/^\/c\/([^/]+)/);
    return m ? m[1] : null;
  }, [pathname]);

  // --- dialog state -------------------------------------------------------
  const [renameTarget, setRenameTarget] = useState<Conversation | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const [projectOpen, setProjectOpen] = useState(false);

  // --- conversation handlers ---------------------------------------------
  const handleNewChat = useCallback(async () => {
    // With no project scope, let the chat surface create the thread lazily on
    // the first message (keeps abandoned empty threads out of history, and the
    // chat view refreshes the sidebar itself once the first turn is saved).
    if (!activeProjectId) {
      router.push("/");
      return;
    }
    // With a project selected, pre-create so the new chat is scoped to it
    // (project_id is set up front, which the lazy flow can't carry).
    try {
      const { conversation } = await mutate<{ conversation: Conversation }>(
        "/api/conversations",
        "POST",
        { projectId: activeProjectId }
      );
      setConversations((prev) => sortConversations([conversation, ...prev]));
      router.push(`/c/${conversation.id}`);
    } catch {
      router.push("/");
    }
  }, [activeProjectId, router]);

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

  // --- project handlers ---------------------------------------------------
  const handleSelectProject = useCallback((id: string) => {
    // Toggle: click the active project again to clear the scope.
    setActiveProjectId((cur) => (cur === id ? null : id));
  }, []);

  // Map the rich records down to the Sidebar's display items (updated_at drives
  // the Today / Yesterday / Previous 7 days grouping).
  const sidebarConversations = useMemo(
    () =>
      conversations.map((c) => ({
        id: c.id,
        title: c.title ?? "New chat",
        pinned: c.pinned,
        updatedAt: c.updated_at,
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
        models={models}
        firstName={firstName}
        isAdmin={isAdmin}
        title={activeTitle}
        onNewChat={handleNewChat}
        onNewProject={() => setProjectOpen(true)}
        onSelectProject={handleSelectProject}
        onSelectConversation={handleSelectConversation}
        onRenameConversation={(id) =>
          setRenameTarget(conversations.find((c) => c.id === id) ?? null)
        }
        onPinConversation={handlePin}
        onDeleteConversation={(id) =>
          setDeleteTarget(conversations.find((c) => c.id === id) ?? null)
        }
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

      <NewProjectDialog
        open={projectOpen}
        onClose={() => setProjectOpen(false)}
        onCreated={(project) => {
          setProjects((prev) => [project, ...prev]);
          setActiveProjectId(project.id); // scope subsequent new chats to it
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
    <Modal open={conversation !== null} onClose={onClose} title="Delete conversation">
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
