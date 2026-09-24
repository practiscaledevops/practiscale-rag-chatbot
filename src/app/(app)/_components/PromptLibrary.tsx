"use client";

// The user's personal prompt library. Create, edit, pin, and delete reusable
// prompts, then insert one into the composer with a click. All data lives in the
// chatbot's own DB (per-user, RLS-scoped) via /api/prompts.

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Pin, PinOff, Pencil, Trash2, CornerDownLeft, X } from "lucide-react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { IconButton } from "@/components/IconButton";
import { cn } from "@/lib/utils";

export interface UserPrompt {
  id: string;
  title: string;
  body: string;
  is_pinned: boolean;
  created_at?: string;
  updated_at?: string;
}

export function PromptLibrary({
  open,
  onClose,
  onInsert,
}: {
  open: boolean;
  onClose: () => void;
  /** Insert the chosen prompt body into the composer. */
  onInsert: (body: string) => void;
}) {
  const [prompts, setPrompts] = useState<UserPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editor state (create or edit).
  const [editing, setEditing] = useState<UserPrompt | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/prompts", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load prompts");
      setPrompts((json.prompts ?? []) as UserPrompt[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load prompts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  function openCreate() {
    setEditing(null);
    setTitle("");
    setBody("");
    setShowEditor(true);
  }
  function openEdit(p: UserPrompt) {
    setEditing(p);
    setTitle(p.title);
    setBody(p.body);
    setShowEditor(true);
  }

  async function save() {
    if (!title.trim() || !body.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/prompts", {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          editing ? { id: editing.id, title, body } : { title, body }
        ),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Save failed");
      }
      setShowEditor(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function togglePin(p: UserPrompt) {
    await fetch("/api/prompts", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: p.id, isPinned: !p.is_pinned }),
    });
    await load();
  }

  async function remove(p: UserPrompt) {
    await fetch(`/api/prompts?id=${encodeURIComponent(p.id)}`, { method: "DELETE" });
    await load();
  }

  function insert(p: UserPrompt) {
    onInsert(p.body);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Saved prompts" className="max-w-lg">
      {showEditor ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="pl-title" className="block text-xs font-medium text-muted-foreground">
              Title
            </label>
            <input
              id="pl-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Weekly report summary"
              className="h-9 w-full rounded-xl border border-border bg-surface px-3 text-sm outline-none placeholder:text-subtle-foreground focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="pl-body" className="block text-xs font-medium text-muted-foreground">
              Prompt
            </label>
            <textarea
              id="pl-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              placeholder="Write the prompt you want to reuse…"
              className="block w-full resize-y rounded-xl border border-border bg-surface px-3 py-2 text-sm leading-6 outline-none placeholder:text-subtle-foreground focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setShowEditor(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !title.trim() || !body.trim()}>
              {saving && <Loader2 size={16} className="animate-spin" />}
              {editing ? "Save changes" : "Save prompt"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 text-xs text-muted-foreground">
              Save prompts you use often and drop them into the composer.
            </p>
            <Button size="sm" onClick={openCreate} className="shrink-0">
              <Plus size={14} />
              New
            </Button>
          </div>

          {error && (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              <span className="min-w-0">{error}</span>
              <IconButton
                type="button"
                aria-label="Dismiss"
                size="sm"
                onClick={() => setError(null)}
                className="-my-1.5 -mr-1.5 shrink-0 text-danger hover:bg-danger/10 hover:text-danger"
              >
                <X size={14} />
              </IconButton>
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2 py-6 text-[13px] text-muted-foreground">
              <Loader2 size={14} className="animate-spin" />
              Loading…
            </div>
          ) : prompts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
              No saved prompts yet. Create your first one.
            </div>
          ) : (
            <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
              {prompts.map((p) => (
                <li
                  key={p.id}
                  className={cn(
                    "group rounded-xl border border-border bg-surface px-3 py-2.5 transition-colors hover:border-accent/40 hover:bg-accent-softer"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => insert(p)}
                      className="min-w-0 flex-1 text-left"
                      title="Insert into composer"
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-[13px] font-medium leading-5">{p.title}</span>
                        {p.is_pinned && <Pin size={12} className="shrink-0 text-accent" />}
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs leading-[18px] text-muted-foreground">{p.body}</p>
                    </button>
                    <div className="-my-1 -mr-1 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <IconButton
                        aria-label="Insert prompt"
                        size="sm"
                        onClick={() => insert(p)}
                        title="Insert into composer"
                      >
                        <CornerDownLeft size={14} />
                      </IconButton>
                      <IconButton
                        aria-label={p.is_pinned ? "Unpin" : "Pin"}
                        size="sm"
                        onClick={() => togglePin(p)}
                      >
                        {p.is_pinned ? <PinOff size={14} /> : <Pin size={14} />}
                      </IconButton>
                      <IconButton aria-label="Edit prompt" size="sm" onClick={() => openEdit(p)}>
                        <Pencil size={14} />
                      </IconButton>
                      <IconButton aria-label="Delete prompt" size="sm" onClick={() => remove(p)}>
                        <Trash2 size={14} />
                      </IconButton>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
