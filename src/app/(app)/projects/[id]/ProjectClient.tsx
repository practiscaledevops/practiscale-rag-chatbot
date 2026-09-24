"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  FileText,
  Loader2,
  MessageSquarePlus,
  Paperclip,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/Button";
import { IconButton } from "@/components/IconButton";

interface ChatItem {
  id: string;
  title: string;
  updatedAt: string;
}
interface FileItem {
  id: string;
  name: string;
  mime: string | null;
  size: number | null;
  chars: number;
  created_at: string;
}
interface ProjectShape {
  id: string;
  name: string;
  system_prompt: string | null;
}

/** POST/PATCH/DELETE JSON helper that throws the server's error message. */
async function mutate<T>(url: string, method: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: unknown };
  if (!res.ok) {
    const msg =
      typeof json.error === "string"
        ? json.error
        : json.error
          ? JSON.stringify(json.error)
          : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return json as T;
}

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function fileMeta(f: FileItem): string {
  const kb = f.size ? Math.max(1, Math.round(f.size / 1024)) : null;
  const chars = f.chars ? `${f.chars.toLocaleString()} chars` : null;
  return [kb ? `${kb} KB` : null, chars].filter(Boolean).join(" · ");
}

export function ProjectClient({
  project,
  initialChats,
  initialFiles,
  filesAvailable,
}: {
  project: ProjectShape;
  initialChats: ChatItem[];
  initialFiles: FileItem[];
  filesAvailable: boolean;
}) {
  const router = useRouter();

  const [name, setName] = useState(project.name);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(project.name);

  const [instructions, setInstructions] = useState(project.system_prompt ?? "");
  const [savedInstructions, setSavedInstructions] = useState(project.system_prompt ?? "");
  const [savingInstr, setSavingInstr] = useState(false);
  const [instrSaved, setInstrSaved] = useState(false);

  const [chats] = useState<ChatItem[]>(initialChats);
  const [files, setFiles] = useState<FileItem[]>(initialFiles);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- project name -------------------------------------------------------
  const saveName = useCallback(async () => {
    const next = nameDraft.trim();
    setEditingName(false);
    if (!next || next === name) {
      setNameDraft(name);
      return;
    }
    setName(next);
    try {
      await mutate("/api/projects", "PATCH", { id: project.id, name: next });
      router.refresh();
    } catch (e) {
      setName(project.name);
      setError(e instanceof Error ? e.message : "Could not rename the project.");
    }
  }, [nameDraft, name, project.id, project.name, router]);

  // --- instructions -------------------------------------------------------
  const saveInstructions = useCallback(async () => {
    if (instructions === savedInstructions) return;
    setSavingInstr(true);
    setError(null);
    try {
      await mutate("/api/projects", "PATCH", {
        id: project.id,
        systemPrompt: instructions.trim() ? instructions : null,
      });
      setSavedInstructions(instructions);
      setInstrSaved(true);
      setTimeout(() => setInstrSaved(false), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save instructions.");
    } finally {
      setSavingInstr(false);
    }
  }, [instructions, savedInstructions, project.id]);

  // --- new chat in this project -------------------------------------------
  const newChat = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const { conversationId } = await mutate<{ conversationId: string }>(
        "/api/conversations",
        "POST",
        { projectId: project.id }
      );
      router.push(`/c/${conversationId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start a chat.");
      setCreating(false);
    }
  }, [project.id, router]);

  // --- files --------------------------------------------------------------
  const onPickFile = useCallback(
    async (fileList: FileList | null) => {
      const file = fileList?.[0];
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (!file) return;
      setUploading(true);
      setError(null);
      try {
        const fd = new FormData();
        fd.append("projectId", project.id);
        fd.append("file", file, file.name);
        const res = await fetch("/api/projects/files", { method: "POST", body: fd });
        const json = (await res.json().catch(() => ({}))) as {
          file?: FileItem;
          error?: string;
        };
        if (!res.ok || !json.file) throw new Error(json.error || "Upload failed.");
        setFiles((prev) => [...prev, json.file as FileItem]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not add the file.");
      } finally {
        setUploading(false);
      }
    },
    [project.id]
  );

  const removeFile = useCallback(async (id: string) => {
    const snapshot = id;
    setFiles((prev) => prev.filter((f) => f.id !== id));
    try {
      await mutate("/api/projects/files", "DELETE", { id: snapshot });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the file.");
    }
  }, []);

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-6 overflow-y-auto px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/"
            className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft size={13} /> Back to chat
          </Link>
          {editingName ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName();
                if (e.key === "Escape") {
                  setNameDraft(name);
                  setEditingName(false);
                }
              }}
              maxLength={120}
              className="h-11 w-full rounded-xl border border-border bg-surface px-3.5 text-xl font-semibold tracking-tight outline-none focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            />
          ) : (
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <span className="truncate">{name}</span>
              <IconButton
                aria-label="Rename project"
                size="sm"
                onClick={() => {
                  setNameDraft(name);
                  setEditingName(true);
                }}
              >
                <Pencil size={14} />
              </IconButton>
            </h1>
          )}
          <p className="mt-1 text-sm text-muted-foreground">
            {chats.length} {chats.length === 1 ? "chat" : "chats"}
            {filesAvailable && files.length > 0 ? ` · ${files.length} files` : ""}
          </p>
        </div>
        <Button onClick={newChat} disabled={creating} className="shrink-0">
          {creating ? <Loader2 size={15} className="animate-spin" /> : <MessageSquarePlus size={15} />}
          New chat
        </Button>
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {/* Instructions */}
      <section className="rounded-2xl border border-border bg-surface p-5 shadow-soft">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Instructions</h2>
          <div className="flex items-center gap-2">
            {instrSaved && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-accent-strong">
                <Check size={13} /> Saved
              </span>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={saveInstructions}
              disabled={savingInstr || instructions === savedInstructions}
            >
              {savingInstr ? <Loader2 size={13} className="animate-spin" /> : null}
              Save
            </Button>
          </div>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Added to every chat in this project — tone, role, rules, what to focus on.
        </p>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          onBlur={saveInstructions}
          rows={4}
          maxLength={8000}
          placeholder="e.g. You are helping the sales team. Always ground answers in call data and cite sources."
          className="w-full resize-y rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm outline-none placeholder:text-subtle-foreground focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        />
      </section>

      {/* Project knowledge (files) */}
      <section className="rounded-2xl border border-border bg-surface p-5 shadow-soft">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Project knowledge</h2>
          {filesAvailable && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => onPickFile(e.target.files)}
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />}
                Add file
              </Button>
            </>
          )}
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Files here are read once and added as shared context to every chat in this project.
        </p>

        {!filesAvailable ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
            Project files need a one-time database setup. Run the migration{" "}
            <code className="rounded-md bg-surface-muted px-1">supabase/migrations/0012_project_files.sql</code>{" "}
            in Supabase, then reload. Everything else in the project works now.
          </div>
        ) : files.length === 0 ? (
          <p className="text-sm text-muted-foreground">No files yet.</p>
        ) : (
          <ul className="space-y-2">
            {files.map((f) => (
              <li
                key={f.id}
                className="group flex items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-2.5 transition-colors hover:bg-surface-muted/60"
              >
                <FileText size={15} className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{f.name}</span>
                  {fileMeta(f) && (
                    <span className="block truncate text-xs text-muted-foreground">{fileMeta(f)}</span>
                  )}
                </span>
                <IconButton
                  aria-label={`Remove ${f.name}`}
                  size="sm"
                  className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                  onClick={() => removeFile(f.id)}
                >
                  <Trash2 size={14} />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Chats in this project */}
      <section className="rounded-2xl border border-border bg-surface p-5 shadow-soft">
        <h2 className="mb-2 text-sm font-semibold">Chats in this project</h2>
        {chats.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <span
              aria-hidden
              className="grid h-12 w-12 place-items-center rounded-full bg-accent-soft text-accent"
            >
              <MessageSquarePlus size={20} />
            </span>
            <p className="max-w-sm text-sm text-muted-foreground">
              No chats yet. Start one — it will use this project&apos;s instructions and files.
            </p>
            <Button onClick={newChat} disabled={creating} size="sm">
              {creating ? <Loader2 size={14} className="animate-spin" /> : <MessageSquarePlus size={14} />}
              New chat
            </Button>
          </div>
        ) : (
          <ul className="-mx-2 space-y-0.5">
            {chats.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/c/${c.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-surface-muted"
                >
                  <span className="truncate">{c.title || "New chat"}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{relTime(c.updatedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
