"use client";

// Admin › Audit log — the governance trail (chat requests with mode + whether
// sensitive knowledge was in scope, executive-memory access). Read-only; the
// data comes from /api/admin/audit which re-checks the admin gate.

import { useCallback, useEffect, useState } from "react";
import { Loader2, ScrollText, ShieldAlert, MessageSquare, Crown } from "lucide-react";
import { cn } from "@/lib/utils";

interface AuditItem {
  id: string;
  action: string;
  detail: Record<string, unknown>;
  createdAt: string;
  user: string | null;
}

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
  return new Date(iso).toLocaleString();
}

function actionMeta(action: string): { label: string; icon: typeof MessageSquare } {
  switch (action) {
    case "chat":
      return { label: "Chat", icon: MessageSquare };
    case "ceo_memory_read":
      return { label: "Executive memory read", icon: Crown };
    case "ceo_memory_write":
      return { label: "Executive memory updated", icon: Crown };
    default:
      return { label: action.replace(/_/g, " "), icon: ScrollText };
  }
}

/** A compact one-line summary of an event's detail payload. */
function summarize(action: string, detail: Record<string, unknown>): string {
  if (action === "chat") {
    const parts: string[] = [];
    if (detail.mode && detail.mode !== "general") parts.push(String(detail.mode).replace(/_/g, " "));
    if (detail.model) parts.push(String(detail.model));
    if (detail.sensitiveAccess === true) parts.push("sensitive data in scope");
    return parts.join(" · ");
  }
  const bits = Object.entries(detail)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
  return bits.join(" · ");
}

export function AuditClient() {
  const [items, setItems] = useState<AuditItem[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [filter, setFilter] = useState<"all" | "chat" | "ceo_memory_write">("all");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter === "all" ? "" : `?action=${filter}`;
      const res = await fetch(`/api/admin/audit${qs}`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { items: AuditItem[]; enabled: boolean };
        setItems(data.items);
        setEnabled(data.enabled);
      }
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="w-full">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ScrollText size={22} className="text-accent" />
          Audit log
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Governance trail: who used what, which mode, and when sensitive data was in scope.
        </p>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <div className="inline-flex rounded-full bg-surface-muted p-1">
          {(["all", "chat", "ceo_memory_write"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                filter === f
                  ? "bg-surface text-foreground shadow-soft"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {f === "all" ? "All" : f === "chat" ? "Chats" : "Executive memory"}
            </button>
          ))}
        </div>
        {loading && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
      </div>

      {items && !enabled ? (
        <p className="mt-6 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-foreground">
          Audit log isn’t enabled yet — run migration 0008_audit_log.sql in Supabase.
        </p>
      ) : (
        <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-surface shadow-soft">
          <ul className="divide-y divide-border">
            {(items ?? []).map((it) => {
              const meta = actionMeta(it.action);
              const Icon = meta.icon;
              const sensitive = it.action === "chat" && it.detail.sensitiveAccess === true;
              return (
                <li
                  key={it.id}
                  className="flex items-start gap-3 px-5 py-4 transition-colors hover:bg-surface-muted/60"
                >
                  <span
                    className={cn(
                      "grid h-9 w-9 shrink-0 place-items-center rounded-xl",
                      sensitive ? "bg-warning/10 text-warning" : "bg-surface-muted text-muted-foreground"
                    )}
                  >
                    {sensitive ? <ShieldAlert size={16} /> : <Icon size={16} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{meta.label}</span>
                      <span className="text-muted-foreground">· {it.user || "system"}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{relTime(it.createdAt)}</span>
                    </div>
                    {summarize(it.action, it.detail) && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {summarize(it.action, it.detail)}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
            {!loading && (items?.length ?? 0) === 0 && (
              <li className="flex flex-col items-center gap-3 px-6 py-12 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-accent-soft text-accent">
                  <ScrollText size={20} />
                </span>
                <p className="text-sm text-muted-foreground">No audit events yet.</p>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
