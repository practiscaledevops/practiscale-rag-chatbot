"use client";

// /learning — the org's learning records (decisions, experiments, results,
// lessons). Read-only here: records are saved from chat ("Save as learning")
// and completed / validated in the Brain's Learning Lab. Data comes from
// /api/brain/learning.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Lightbulb, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/Button";
import { Chip, ObjectDrawer } from "@/components/ObjectDrawer";
import {
  LEARNING_RECORD_TYPES,
  LEARNING_STATUSES,
  LEARNING_STATUS_LABEL,
  LEARNING_TYPE_LABEL,
  LEARNING_TYPE_TONE,
  humanize,
  type LearningListResponse,
  type LearningRecord,
} from "@/lib/brain-types";

const PAGE_SIZE = 30;

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

const selectCls =
  "h-8 rounded-xl border border-border bg-surface px-3 text-[13px] text-foreground outline-none focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60";

export function LearningClient() {
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [records, setRecords] = useState<LearningRecord[]>([]);
  const [page, setPage] = useState<LearningListResponse["page"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [drawerRef, setDrawerRef] = useState<string | null>(null);

  const url = useCallback(
    (offset: number) => {
      const sp = new URLSearchParams();
      if (status) sp.set("status", status);
      if (type) sp.set("type", type);
      sp.set("limit", String(PAGE_SIZE));
      sp.set("offset", String(offset));
      return `/api/brain/learning?${sp.toString()}`;
    },
    [status, type]
  );

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetch(url(0), { signal: ctrl.signal })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as LearningListResponse & { error?: string };
        if (!res.ok) throw new Error(json.error || `Couldn't load your learnings (${res.status}).`);
        setRecords(Array.isArray(json.records) ? json.records : []);
        setPage(json.page ?? null);
      })
      .catch((e: Error) => {
        if (e.name === "AbortError") return;
        setError(e.message);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [url, reload]);

  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(url(records.length));
      const json = (await res.json().catch(() => ({}))) as LearningListResponse & { error?: string };
      if (!res.ok) throw new Error(json.error || `Couldn't load more (${res.status}).`);
      setRecords((prev) => [...prev, ...(Array.isArray(json.records) ? json.records : [])]);
      setPage(json.page ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load more.");
    } finally {
      setLoadingMore(false);
    }
  }, [url, records.length, loadingMore]);

  const hasMore = !!page && page.returned === page.limit && records.length >= page.limit;
  const filtered = !!(status || type);

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <header className="mb-5">
          <h1 className="text-xl font-semibold tracking-tight">My learnings</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            What the team decided, tried, measured and learned — saved from chat and
            reviewed in the Brain&apos;s Learning Lab.
            {loading && <Loader2 size={12} className="ml-2 inline animate-spin text-muted-foreground" />}
          </p>
        </header>

        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="learning-status">Status</label>
          <select id="learning-status" value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
            <option value="">All statuses</option>
            {LEARNING_STATUSES.map((s) => (
              <option key={s} value={s}>{LEARNING_STATUS_LABEL[s]}</option>
            ))}
          </select>
          <label className="sr-only" htmlFor="learning-type">Type</label>
          <select id="learning-type" value={type} onChange={(e) => setType(e.target.value)} className={selectCls}>
            <option value="">All types</option>
            {LEARNING_RECORD_TYPES.map((t) => (
              <option key={t} value={t}>{LEARNING_TYPE_LABEL[t]}</option>
            ))}
          </select>
          {filtered && (
            <Button variant="ghost" size="sm" className="h-8 px-3 text-[13px]" onClick={() => { setStatus(""); setType(""); }}>
              Clear
            </Button>
          )}
        </div>

        {error && (
          <div role="alert" className="mb-4 rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
            <p>{error}</p>
            <Button variant="secondary" size="sm" className="mt-2" onClick={() => setReload((n) => n + 1)}>
              <RefreshCw size={14} />
              Retry
            </Button>
          </div>
        )}

        {loading && !error ? (
          <ul className="space-y-2" aria-hidden>
            {Array.from({ length: 4 }).map((_, i) => (
              <li key={i} className="h-24 animate-pulse rounded-xl bg-surface-muted" />
            ))}
          </ul>
        ) : !error && records.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 rounded-xl border border-border bg-surface p-5 text-center text-[13px] text-muted-foreground">
            <span
              aria-hidden
              className="grid h-10 w-10 place-items-center rounded-full bg-accent-soft text-accent"
            >
              <Lightbulb size={16} />
            </span>
            {filtered ? (
              "No learnings match these filters."
            ) : (
              <div>
                <p className="text-sm font-medium text-foreground">No learnings yet.</p>
                <p className="mx-auto mt-1 max-w-md">
                  When the assistant spots a decision, experiment or result in a conversation, it
                  offers <span className="font-medium text-foreground">“Save as learning”</span> under
                  the answer. Saved learnings appear here and are completed and validated in the
                  Brain&apos;s Learning Lab.
                </p>
              </div>
            )}
          </div>
        ) : (
          <ul className="space-y-2">
            {records.map((r) => (
              <LearningRow key={r.id} r={r} onOpenRef={setDrawerRef} />
            ))}
          </ul>
        )}

        {hasMore && !loading && !error && (
          <div className="mt-4 flex justify-center">
            <Button variant="secondary" size="sm" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? <Loader2 size={14} className="animate-spin" /> : null}
              Load more
            </Button>
          </div>
        )}
      </div>

      <ObjectDrawer refId={drawerRef} onClose={() => setDrawerRef(null)} />
    </div>
  );
}

function LearningRow({ r, onOpenRef }: { r: LearningRecord; onOpenRef: (ref: string) => void }) {
  const missing = Array.isArray(r.missing_evidence) ? r.missing_evidence : [];
  const playbooks = Array.isArray(r.playbooks) ? r.playbooks : [];
  return (
    <li className="rounded-xl border border-border bg-surface px-4 py-3 shadow-soft">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-xs text-accent-strong">{r.ref}</span>
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
            LEARNING_TYPE_TONE[r.record_type] ?? "border-border text-muted-foreground"
          )}
        >
          {LEARNING_TYPE_LABEL[r.record_type] ?? humanize(r.record_type)}
        </span>
        <Chip>{LEARNING_STATUS_LABEL[r.status] ?? humanize(r.status)}</Chip>
        {r.department && <span className="text-xs text-muted-foreground">{r.department}</span>}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {r.created_at ? relTime(r.created_at) : ""}
        </span>
      </div>
      <p className="mt-1.5 text-sm font-medium leading-5 text-foreground">{r.title}</p>
      {r.summary && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{r.summary}</p>}
      {(playbooks.length > 0 || missing.length > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {playbooks.map((p) => (
            <button
              key={p.ref}
              type="button"
              onClick={() => onOpenRef(p.ref)}
              title={p.name}
              className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent-soft px-2 py-0.5 font-mono text-[11px] leading-4 text-accent-strong transition-colors hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {p.ref}
            </button>
          ))}
          {missing.map((m) => (
            <Chip key={m} tone="warning" title="Evidence still missing">
              <AlertTriangle size={12} aria-hidden />
              {m}
            </Chip>
          ))}
        </div>
      )}
    </li>
  );
}
