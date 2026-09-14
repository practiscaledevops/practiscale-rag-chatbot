"use client";

// Admin › Approvals — the content review queue. Pending items first; a reviewer
// can approve, reject, or request changes with an optional note. Each action
// notifies the submitter. All data comes from /api/admin/approvals (admin-gated).

import { useCallback, useEffect, useState } from "react";
import {
  ClipboardCheck,
  Loader2,
  Check,
  X,
  RotateCcw,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { APPROVAL_STATUS_LABEL, type ApprovalItem, type ReviewAction } from "@/lib/approvals";

const STATUS_CLS: Record<string, string> = {
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  approved: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  rejected: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400",
  changes_requested: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400",
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

export function ApprovalsClient() {
  const [items, setItems] = useState<ApprovalItem[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter === "pending" ? "?status=pending" : "";
      const res = await fetch(`/api/admin/approvals${qs}`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { items: ApprovalItem[]; enabled: boolean };
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
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:py-8">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <ClipboardCheck size={20} className="text-accent" />
          Approvals
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review content submitted by the team. Approving, rejecting, or requesting
          changes notifies the person who submitted it.
        </p>
      </div>

      <div className="mt-5 flex items-center gap-2">
        {(["pending", "all"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              filter === f
                ? "border-accent bg-accent/10 text-accent"
                : "border-border text-muted-foreground hover:bg-surface-muted"
            )}
          >
            {f === "pending" ? "Pending" : "All"}
          </button>
        ))}
        {loading && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
      </div>

      {items && !enabled ? (
        <p className="mt-6 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground">
          Approvals aren&apos;t enabled yet — run migration 0010_approvals.sql in Supabase.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {(items ?? []).map((it) => (
            <ApprovalRow key={it.id} item={it} onReviewed={load} />
          ))}
          {!loading && (items?.length ?? 0) === 0 && (
            <li className="rounded-xl border border-border bg-surface px-4 py-12 text-center text-sm text-muted-foreground">
              {filter === "pending" ? "Nothing waiting for review." : "No submissions yet."}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function ApprovalRow({ item, onReviewed }: { item: ApprovalItem; onReviewed: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<ReviewAction | null>(null);
  const isPending = item.status === "pending";

  const review = useCallback(
    async (action: ReviewAction) => {
      setBusy(action);
      try {
        const res = await fetch("/api/admin/approvals", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: item.id, action, note: note.trim() || undefined }),
        });
        if (res.ok) onReviewed();
      } finally {
        setBusy(null);
      }
    },
    [item.id, note, onReviewed]
  );

  return (
    <li className="rounded-xl border border-border bg-surface shadow-soft">
      <div className="flex items-start gap-3 p-3">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{item.title}</span>
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                STATUS_CLS[item.status]
              )}
            >
              {APPROVAL_STATUS_LABEL[item.status]}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {item.submitter || "Unknown"}
            {item.mode && item.mode !== "general" ? ` · ${item.mode.replace(/_/g, " ")}` : ""}
            {` · ${relTime(item.createdAt)}`}
          </p>
          {!expanded && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground/90">{item.content}</p>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-3 py-3">
          {item.prompt && (
            <p className="mb-2 text-xs text-muted-foreground">
              <span className="font-semibold">Prompt:</span> {item.prompt}
            </p>
          )}
          <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface-muted/60 p-3 text-sm text-foreground/90">
            {item.content}
          </div>

          {item.reviewNote && (
            <p className="mt-2 text-xs text-muted-foreground">
              <span className="font-semibold">Review note:</span> {item.reviewNote}
            </p>
          )}

          {isPending && (
            <div className="mt-3 space-y-2">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional note to the submitter…"
                rows={2}
                className="w-full resize-none rounded-lg border border-border bg-surface px-2.5 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => review("approve")}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-600/90 disabled:opacity-50"
                >
                  {busy === "approve" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  Approve
                </button>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => review("request_changes")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-surface-muted disabled:opacity-50"
                >
                  {busy === "request_changes" ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                  Request changes
                </button>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => review("reject")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 px-3 py-1.5 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-500/10 disabled:opacity-50 dark:text-rose-400"
                >
                  {busy === "reject" ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                  Reject
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
