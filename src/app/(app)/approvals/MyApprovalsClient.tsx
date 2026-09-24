"use client";

// /approvals — the user's own submissions and their review outcome. Read-only;
// data comes from /api/approvals (RLS-scoped to the caller).

import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { APPROVAL_STATUS_LABEL, type ApprovalItem } from "@/lib/approvals";

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

export function MyApprovalsClient() {
  const [items, setItems] = useState<ApprovalItem[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/approvals", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { items: ApprovalItem[]; enabled: boolean };
        setItems(data.items);
        setEnabled(data.enabled);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <header className="mb-5">
          <h1 className="text-xl font-semibold tracking-tight">My approvals</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Content you submitted for review and where it stands.
            {loading && <Loader2 size={12} className="ml-2 inline animate-spin text-muted-foreground" />}
          </p>
        </header>

        {items && !enabled ? (
          <p className="rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-[13px] text-foreground">
            Approvals aren&apos;t enabled yet — ask an admin to run migration 0010.
          </p>
        ) : (
          <ul className="space-y-2">
            {(items ?? []).map((it) => (
              <Row key={it.id} item={it} />
            ))}
            {!loading && (items?.length ?? 0) === 0 && (
              <li className="flex flex-col items-center gap-2.5 rounded-xl border border-border bg-surface p-5 text-center">
                <span
                  aria-hidden
                  className="grid h-10 w-10 place-items-center rounded-full bg-accent-soft text-accent"
                >
                  <ClipboardCheck size={16} />
                </span>
                <p className="max-w-sm text-[13px] text-muted-foreground">
                  You haven&apos;t submitted anything for approval yet. Use “Submit for
                  approval” under an assistant answer.
                </p>
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

function Row({ item }: { item: ApprovalItem }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="rounded-xl border border-border bg-surface shadow-soft">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className={cn(
          "flex w-full items-start gap-2.5 px-4 py-3 text-left transition-colors hover:bg-surface-muted/60",
          expanded ? "rounded-t-xl" : "rounded-xl"
        )}
      >
        <span className="flex h-5 w-4 shrink-0 items-center justify-center text-muted-foreground">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium leading-5">{item.title}</span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium leading-4",
                STATUS_CLS[item.status]
              )}
            >
              {APPROVAL_STATUS_LABEL[item.status]}
            </span>
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Submitted {relTime(item.createdAt)}
            {item.reviewedAt ? ` · reviewed ${relTime(item.reviewedAt)}` : ""}
          </span>
          {!expanded && (
            <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground/90">{item.content}</span>
          )}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border px-4 py-3.5">
          <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl bg-surface-muted p-3.5 text-[13px] leading-relaxed text-foreground/90">
            {item.content}
          </div>
          {item.reviewNote && (
            <p className="mt-2.5 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Reviewer note:</span> {item.reviewNote}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
