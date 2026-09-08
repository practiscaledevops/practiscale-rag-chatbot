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
    <Modal open={open} onClose={onClose} title="Prompt library" className="max-w-lg">
      {showEditor ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="pl-title" className="text-xs font-medium text-muted-foreground">
              Title
            </label>
            <input
              id="pl-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Weekly report summary"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="pl-body" className="text-xs font-medium text-muted-foreground">
              Prompt
            </label>
            <textarea
              id="pl-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={7}
              placeholder="Write the prompt you want to reuse…"
              className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowEditor(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !title.trim() || !body.trim()}>
              {saving && <Loader2 size={14} className="animate-spin" />}
              {editing ? "Save changes" : "Save prompt"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Save prompts you use often and drop them into the composer.
            </p>
            <Button size="sm" onClick={openCreate}>
              <Plus size={14} />
              New
            </Button>
          </div>

          {error && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              <span>{error}</span>
              <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
                <X size={13} />
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 size={14} className="animate-spin" />
              Loading…
            </div>
          ) : prompts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              No saved prompts yet. Create your first one.
            </div>
          ) : (
            <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
              {prompts.map((p) => (
                <li
                  key={p.id}
                  className={cn(
                    "group rounded-xl border border-border bg-surface p-3 transition-colors hover:border-accent/40"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => insert(p)}
                      className="min-w-0 flex-1 text-left"
                      title="Insert into composer"
                    >
                      <div className="flex items-center gap-1.5">
                        {p.is_pinned && <Pin size={12} className="text-accent" />}
                        <span className="truncate text-sm font-medium">{p.title}</span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{p.body}</p>
                    </button>
                    <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
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
