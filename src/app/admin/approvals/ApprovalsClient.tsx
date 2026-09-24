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
import { Button } from "@/components/Button";
import { IconButton } from "@/components/IconButton";
import { APPROVAL_STATUS_LABEL, type ApprovalItem, type ReviewAction } from "@/lib/approvals";

const STATUS_CLS: Record<string, string> = {
  pending: "bg-warning/10 text-warning",
  approved: "bg-success/10 text-success",
  rejected: "bg-danger/10 text-danger",
  changes_requested: "bg-info/10 text-info",
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
    <div className="w-full">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ClipboardCheck size={22} className="text-accent" />
          Approvals
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review content submitted by the team. Approving, rejecting, or requesting
          changes notifies the person who submitted it.
        </p>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <div className="inline-flex rounded-full bg-surface-muted p-1">
          {(["pending", "all"] as const).map((f) => (
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
              {f === "pending" ? "Pending" : "All"}
            </button>
          ))}
        </div>
        {loading && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
      </div>

      {items && !enabled ? (
        <p className="mt-6 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-foreground">
          Approvals aren&apos;t enabled yet — run migration 0010_approvals.sql in Supabase.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {(items ?? []).map((it) => (
            <ApprovalRow key={it.id} item={it} onReviewed={load} />
          ))}
          {!loading && (items?.length ?? 0) === 0 && (
            <li className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface px-6 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-accent-soft text-accent">
                <ClipboardCheck size={20} />
              </span>
              <p className="text-sm text-muted-foreground">
                {filter === "pending" ? "Nothing waiting for review." : "No submissions yet."}
              </p>
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
    <li className="rounded-2xl border border-border bg-surface shadow-soft">
      <div className="flex items-start gap-3 p-4">
        <IconButton
          type="button"
          size="sm"
          onClick={() => setExpanded((e) => !e)}
          className="-mt-0.5 shrink-0"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </IconButton>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{item.title}</span>
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-medium",
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
        <div className="border-t border-border px-4 py-4">
          {item.prompt && (
            <p className="mb-2 text-xs text-muted-foreground">
              <span className="font-semibold">Prompt:</span> {item.prompt}
            </p>
          )}
          <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl bg-surface-muted p-4 text-sm text-foreground/90">
            {item.content}
          </div>

          {item.reviewNote && (
            <p className="mt-2 text-xs text-muted-foreground">
              <span className="font-semibold">Review note:</span> {item.reviewNote}
            </p>
          )}

          {isPending && (
            <div className="mt-4 space-y-3">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional note to the submitter…"
                rows={2}
                className="w-full resize-none rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm outline-none placeholder:text-subtle-foreground focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={!!busy}
                  onClick={() => review("approve")}
                >
                  {busy === "approve" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  Approve
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!!busy}
                  onClick={() => review("request_changes")}
                >
                  {busy === "request_changes" ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                  Request changes
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!!busy}
                  onClick={() => review("reject")}
                  className="border-danger/30 text-danger hover:bg-danger/10"
                >
                  {busy === "reject" ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                  Reject
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
