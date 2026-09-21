"use client";

// Global command palette (⌘K / Ctrl+K). A fast, keyboard-first launcher for the
// things a user does most: start a chat, jump to a recent thread, switch work
// mode or model, and reach the admin areas. Purely a navigation/quick-action
// surface — every privileged action it triggers is still enforced server-side.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  MessageSquarePlus,
  Sparkles,
  Cpu,
  Shield,
  Bug,
  Brain,
  Lightbulb,
  User,
  MessagesSquare,
  ClipboardCheck,
  CornerDownLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ModelOption } from "@/components/AppShell";
import type { WorkMode, WorkModeDef } from "@/lib/work-modes";
import type { ConversationItem } from "@/components/Sidebar";

interface Command {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon: typeof Search;
  run: () => void;
  keywords?: string;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
  conversations: ConversationItem[];
  modeDefs: WorkModeDef[];
  activeMode: WorkMode;
  onSelectMode: (m: WorkMode) => void;
  options: ModelOption[];
  onSelectModel: (o: ModelOption) => void;
  onNewChat: () => void;
  onSelectConversation?: (id: string) => void;
}

export function CommandPalette({
  open,
  onClose,
  isAdmin,
  conversations,
  modeDefs,
  activeMode,
  onSelectMode,
  options,
  onSelectModel,
  onNewChat,
  onSelectConversation,
}: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const go = useCallback(
    (fn: () => void) => {
      onClose();
      fn();
    },
    [onClose]
  );

  // Assemble the command list from the current shell state.
  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [];

    cmds.push({
      id: "new-chat",
      label: "New chat",
      group: "Actions",
      icon: MessageSquarePlus,
      run: () => go(onNewChat),
    });

    if (isAdmin) {
      cmds.push(
        {
          id: "admin",
          label: "Admin control panel",
          group: "Navigate",
          icon: Shield,
          run: () => go(() => router.push("/admin")),
        },
        {
          id: "rag-debugger",
          label: "RAG debugger",
          hint: "Inspect retrieval",
          group: "Navigate",
          icon: Bug,
          run: () => go(() => router.push("/admin/rag")),
        }
      );
    }
    cmds.push(
      {
        id: "brain-map",
        label: "Open Brain map",
        hint: "What the Brain knows",
        group: "Navigate",
        icon: Brain,
        keywords: "knowledge objects playbooks",
        run: () => go(() => router.push("/brain")),
      },
      {
        id: "my-learnings",
        label: "My learnings",
        hint: "Decisions, experiments, results",
        group: "Navigate",
        icon: Lightbulb,
        keywords: "learning lab",
        run: () => go(() => router.push("/learning")),
      },
      {
        id: "my-approvals",
        label: "My approvals",
        hint: "Submissions & status",
        group: "Navigate",
        icon: ClipboardCheck,
        run: () => go(() => router.push("/approvals")),
      }
    );
    if (isAdmin) {
      cmds.push({
        id: "admin-approvals",
        label: "Approvals queue",
        hint: "Review submissions",
        group: "Navigate",
        icon: ClipboardCheck,
        run: () => go(() => router.push("/admin/approvals")),
      });
    }
    cmds.push({
      id: "account",
      label: "Account settings",
      group: "Navigate",
      icon: User,
      run: () => go(() => router.push("/account")),
    });

    for (const m of modeDefs) {
      cmds.push({
        id: `mode-${m.id}`,
        label: `Work mode: ${m.label}`,
        hint: m.id === activeMode ? "current" : m.hint,
        group: "Work mode",
        icon: Sparkles,
        keywords: m.hint,
        run: () => go(() => onSelectMode(m.id)),
      });
    }

    for (const o of options) {
      if (o.available === false) continue;
      cmds.push({
        id: `model-${o.value}`,
        label: `Model: ${o.label}`,
        hint: o.hint,
        group: "Model",
        icon: Cpu,
        keywords: o.provider,
        run: () => go(() => onSelectModel(o)),
      });
    }

    for (const c of conversations.slice(0, 20)) {
      cmds.push({
        id: `conv-${c.id}`,
        label: c.title || "Untitled chat",
        group: "Recent chats",
        icon: MessagesSquare,
        run: () =>
          go(() =>
            onSelectConversation ? onSelectConversation(c.id) : router.push(`/c/${c.id}`)
          ),
      });
    }

    return cmds;
  }, [
    isAdmin,
    conversations,
    modeDefs,
    activeMode,
    options,
    onNewChat,
    onSelectMode,
    onSelectModel,
    onSelectConversation,
    router,
    go,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) =>
      `${c.label} ${c.group} ${c.hint ?? ""} ${c.keywords ?? ""}`.toLowerCase().includes(q)
    );
  }, [commands, query]);

  // Reset transient state whenever the palette opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // Focus after paint so the caret lands in the input.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        filtered[active]?.run();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [filtered, active, onClose]
  );

  // Keep the active row scrolled into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  // Group the filtered results in stable order for section headers.
  const groupsOrder = ["Actions", "Navigate", "Work mode", "Model", "Recent chats"];
  let runningIdx = -1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-foreground/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-soft-lg">
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search size={16} className="shrink-0 text-muted-foreground" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search commands, chats, modes…"
            className="w-full bg-transparent py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">
            Esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">No matches.</p>
          ) : (
            groupsOrder.map((group) => {
              const rows = filtered.filter((c) => c.group === group);
              if (rows.length === 0) return null;
              return (
                <div key={group} className="mb-1">
                  <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {group}
                  </p>
                  {rows.map((c) => {
                    runningIdx += 1;
                    const idx = runningIdx;
                    const Icon = c.icon;
                    const isActive = idx === active;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        data-idx={idx}
                        onMouseMove={() => setActive(idx)}
                        onClick={() => c.run()}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                          isActive ? "bg-accent/10 text-foreground" : "text-foreground/90 hover:bg-surface-muted"
                        )}
                      >
                        <Icon size={15} className="shrink-0 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{c.label}</span>
                        {c.hint && (
                          <span className="shrink-0 text-[11px] text-muted-foreground">{c.hint}</span>
                        )}
                        {isActive && (
                          <CornerDownLeft size={13} className="shrink-0 text-muted-foreground" aria-hidden />
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
