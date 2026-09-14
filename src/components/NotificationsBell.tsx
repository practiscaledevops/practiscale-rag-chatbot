"use client";

// Notifications bell + panel for the top bar. Fetches the signed-in user's recent
// notifications (RLS-scoped), shows an unread badge, and lets them mark items
// read. Self-contained: it owns its own data so no props need threading through
// the shell. Polls the unread count on a gentle interval and refreshes on open.
// Silently hides itself if notifications aren't enabled yet (before migration 0009).

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  Info,
  CheckCircle2,
  AlertTriangle,
  Zap,
  Loader2,
  CheckCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NotificationItem {
  id: string;
  category: "info" | "success" | "warning" | "action" | string;
  title: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
}

const CATEGORY_META: Record<string, { icon: typeof Info; cls: string }> = {
  info: { icon: Info, cls: "text-sky-500" },
  success: { icon: CheckCircle2, cls: "text-emerald-500" },
  warning: { icon: AlertTriangle, cls: "text-amber-500" },
  action: { icon: Zap, cls: "text-accent" },
};

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationsBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as {
          items: NotificationItem[];
          unread: number;
          enabled: boolean;
        };
        setEnabled(data.enabled);
        setItems(data.items ?? []);
        setUnread(data.unread ?? 0);
      }
    } catch {
      /* offline — keep the last known state */
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + gentle polling for the unread badge.
  useEffect(() => {
    void load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  // Refresh when opened.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const markAll = useCallback(async () => {
    setUnread(0);
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
    } catch {
      /* optimistic; the next poll reconciles */
    }
  }, []);

  const openItem = useCallback(
    async (n: NotificationItem) => {
      if (!n.read_at) {
        setUnread((u) => Math.max(0, u - 1));
        setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
        try {
          await fetch("/api/notifications", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: n.id }),
          });
        } catch {
          /* optimistic */
        }
      }
      if (n.href) {
        setOpen(false);
        router.push(n.href);
      }
    },
    [router]
  );

  // Hide entirely until the feature is enabled (migration applied).
  if (!enabled) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1.5 w-80 overflow-hidden rounded-xl border border-border bg-surface shadow-soft-lg"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            <div className="flex items-center gap-2">
              {loading && <Loader2 size={13} className="animate-spin text-muted-foreground" />}
              {unread > 0 && (
                <button
                  type="button"
                  onClick={markAll}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
                >
                  <CheckCheck size={13} />
                  Mark all read
                </button>
              )}
            </div>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-10 text-center text-sm text-muted-foreground">
                You&apos;re all caught up.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((n) => {
                  const meta = CATEGORY_META[n.category] ?? CATEGORY_META.info;
                  const Icon = meta.icon;
                  const clickable = !!n.href;
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        disabled={!clickable && !!n.read_at}
                        onClick={() => openItem(n)}
                        className={cn(
                          "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors",
                          clickable ? "hover:bg-surface-muted" : "cursor-default",
                          !n.read_at && "bg-accent/5"
                        )}
                      >
                        <Icon size={16} className={cn("mt-0.5 shrink-0", meta.cls)} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className={cn("truncate text-sm", n.read_at ? "text-foreground/90" : "font-semibold text-foreground")}>
                              {n.title}
                            </span>
                            {!n.read_at && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />}
                          </span>
                          {n.body && <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{n.body}</span>}
                          <span className="mt-0.5 block text-[11px] text-muted-foreground/70">{relTime(n.created_at)}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
