"use client";

// /approvals — the user's own submissions and their review outcome. Read-only;
// data comes from /api/approvals (RLS-scoped to the caller).

import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { APPROVAL_STATUS_LABEL, type ApprovalItem } from "@/lib/approvals";

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
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <header className="mb-6">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <ClipboardCheck size={22} className="text-accent" />
            My approvals
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Content you submitted for review and where it stands.
            {loading && <Loader2 size={13} className="ml-2 inline animate-spin text-muted-foreground" />}
          </p>
        </header>

        {items && !enabled ? (
          <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground">
            Approvals aren&apos;t enabled yet — ask an admin to run migration 0010.
          </p>
        ) : (
          <ul className="space-y-2">
            {(items ?? []).map((it) => (
              <Row key={it.id} item={it} />
            ))}
            {!loading && (items?.length ?? 0) === 0 && (
              <li className="rounded-xl border border-border bg-surface px-4 py-12 text-center text-sm text-muted-foreground">
                You haven&apos;t submitted anything for approval yet. Use “Submit for
                approval” under an assistant answer.
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
        className="flex w-full items-start gap-3 p-3 text-left"
      >
        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground">
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{item.title}</span>
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
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
        <div className="border-t border-border px-3 py-3">
          <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface-muted/60 p-3 text-sm text-foreground/90">
            {item.content}
          </div>
          {item.reviewNote && (
            <p className="mt-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Reviewer note:</span> {item.reviewNote}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
