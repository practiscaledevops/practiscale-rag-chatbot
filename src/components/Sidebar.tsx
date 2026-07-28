"use client";

import Link from "next/link";
import {
  FolderPlus,
  MessageSquarePlus,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/IconButton";

export interface ProjectItem {
  id: string;
  name: string;
}

export interface ConversationItem {
  id: string;
  title: string;
  pinned?: boolean;
}

export interface SidebarProps {
  projects?: ProjectItem[];
  conversations?: ConversationItem[];
  /** Currently open conversation, for highlight. */
  activeConversationId?: string | null;

  // Handlers are optional so the shell renders before the history/project
  // agents wire them. When omitted, the affordances are hidden or inert.
  onNewChat?: () => void;
  onNewProject?: () => void;
  onSelectProject?: (id: string) => void;
  onSelectConversation?: (id: string) => void;
  onRenameConversation?: (id: string) => void;
  onPinConversation?: (id: string, pinned: boolean) => void;
  onDeleteConversation?: (id: string) => void;

  className?: string;
}

/**
 * Left navigation rail: New chat, a Projects section, and the Chat History list.
 * Purely presentational — all behavior is delegated to the optional handlers so
 * the history and projects agents can wire persistence without touching layout.
 */
export function Sidebar({
  projects = [],
  conversations = [],
  activeConversationId = null,
  onNewChat,
  onNewProject,
  onSelectProject,
  onSelectConversation,
  onRenameConversation,
  onPinConversation,
  onDeleteConversation,
  className,
}: SidebarProps) {
  return (
    <aside
      className={cn(
        "flex h-full w-64 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900",
        className
      )}
      aria-label="Sidebar"
    >
      {/* New chat */}
      <div className="p-3">
        <button
          type="button"
          onClick={onNewChat}
          className="flex w-full items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:border-neutral-700 dark:bg-neutral-950 dark:hover:bg-neutral-800"
        >
          <MessageSquarePlus size={16} />
          New chat
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-3" aria-label="Conversations">
        {/* Projects */}
        <section className="mb-4" aria-labelledby="sidebar-projects-heading">
          <div className="flex items-center justify-between px-2 py-1">
            <h2
              id="sidebar-projects-heading"
              className="text-xs font-semibold uppercase tracking-wide text-neutral-500"
            >
              Projects
            </h2>
            <IconButton
              aria-label="New project"
              size="sm"
              onClick={onNewProject}
            >
              <FolderPlus size={15} />
            </IconButton>
          </div>
          {projects.length === 0 ? (
            <p className="px-2 py-1 text-xs text-neutral-400">No projects yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {projects.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onSelectProject?.(p.id)}
                    className="w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:hover:bg-neutral-800"
                  >
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Chat history */}
        <section aria-labelledby="sidebar-history-heading">
          <h2
            id="sidebar-history-heading"
            className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-neutral-500"
          >
            Chat history
          </h2>
          {conversations.length === 0 ? (
            <p className="px-2 py-1 text-xs text-neutral-400">
              Your conversations will appear here.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {conversations.map((c) => {
                const active = c.id === activeConversationId;
                return (
                  <li key={c.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => onSelectConversation?.(c.id)}
                      className={cn(
                        "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 pr-16 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400",
                        active
                          ? "bg-neutral-200 dark:bg-neutral-800"
                          : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      )}
                    >
                      {c.pinned && (
                        <Pin size={12} className="shrink-0 text-neutral-400" />
                      )}
                      <span className="truncate">{c.title || "Untitled"}</span>
                    </button>

                    {/* Row affordances — revealed on hover/focus-within. */}
                    <div className="absolute right-1 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 group-hover:flex group-focus-within:flex">
                      <IconButton
                        aria-label={c.pinned ? "Unpin conversation" : "Pin conversation"}
                        size="sm"
                        onClick={() => onPinConversation?.(c.id, !c.pinned)}
                      >
                        {c.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                      </IconButton>
                      <IconButton
                        aria-label="Rename conversation"
                        size="sm"
                        onClick={() => onRenameConversation?.(c.id)}
                      >
                        <Pencil size={14} />
                      </IconButton>
                      <IconButton
                        aria-label="Delete conversation"
                        size="sm"
                        onClick={() => onDeleteConversation?.(c.id)}
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </nav>

      {/* Footer slot: account link (wired by a later agent). */}
      <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
        <Link
          href="/account"
          className="block truncate rounded-md px-2 py-1.5 text-sm text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          Account
        </Link>
      </div>
    </aside>
  );
}
