"use client";

// Live progress card for a background deep-audit, shown right on the chat
// screen while the agents run. Polls /api/jobs/[id] until the job finishes,
// then renders the aggregated report summary.

import { useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, AlertTriangle, CircleDashed, Bot, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Progress {
  job: {
    id: string;
    title: string;
    status: string;
    total_tasks: number;
    completed_tasks: number;
    failed_tasks: number;
    result: unknown;
    finished_at: string | null;
  };
  tasks: { idx: number; label: string; status: string }[];
}

interface Consultant { name: string; calls: number; avgScore: number | null }

const DONE = new Set(["completed", "partial", "failed"]);

export function JobProgress({ jobId, title, onDismiss }: { jobId: string; title: string; onDismiss?: () => void }) {
  const [p, setP] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        const json = (await res.json().catch(() => ({}))) as Progress & { error?: string };
        if (!res.ok) {
          setError(json.error ?? "Progress unavailable.");
          return;
        }
        setP(json);
        if (DONE.has(json.job.status)) return; // finished — stop polling
      } catch {
        /* transient — keep polling */
      }
      if (!stopped.current) timer = setTimeout(poll, 3000);
    }
    poll();
    return () => {
      stopped.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);

  const job = p?.job;
  const total = job?.total_tasks ?? 0;
  const done = (job?.completed_tasks ?? 0) + (job?.failed_tasks ?? 0);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const finished = job ? DONE.has(job.status) : false;
  const result = (job?.result ?? null) as { totalCalls?: number; consultants?: Consultant[] } | null;

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
            finished ? "bg-accent/15 text-accent" : "bg-accent/10 text-accent"
          )}
        >
          {finished ? (
            job?.status === "failed" ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />
          ) : (
            <Bot size={14} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-5">{title || job?.title || "Deep audit"}</p>
          <p className="text-xs leading-4 text-muted-foreground">
            {error
              ? error
              : !job
                ? "Starting…"
                : finished
                  ? `Done — ${result?.totalCalls ?? "?"} calls analysed across ${result?.consultants?.length ?? "?"} consultants`
                  : `Agents working — ${done} of ${total} batches done`}
          </p>
        </div>
        {!finished && !error && <Loader2 size={16} className="mr-1.5 shrink-0 animate-spin text-muted-foreground" />}
        {(finished || error) && onDismiss && (
          <button
            type="button"
            aria-label="Dismiss"
            onClick={onDismiss}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Progress bar */}
      {job && total > 0 && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
          <div
            className={cn("h-full rounded-full transition-all", job.status === "failed" ? "bg-danger" : "bg-accent")}
            style={{ width: `${finished ? 100 : pct}%` }}
          />
        </div>
      )}

      {/* Agent/task chips while running */}
      {p && !finished && p.tasks.length > 0 && (
        <ul className="mt-3 grid grid-cols-1 gap-x-3 gap-y-1.5 sm:grid-cols-2">
          {p.tasks.slice(0, 12).map((t) => (
            <li key={t.idx} className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              {t.status === "completed" ? (
                <CheckCircle2 size={14} className="shrink-0 text-accent" />
              ) : t.status === "running" ? (
                <Loader2 size={14} className="shrink-0 animate-spin text-accent" />
              ) : t.status === "failed" ? (
                <AlertTriangle size={14} className="shrink-0 text-danger" />
              ) : (
                <CircleDashed size={14} className="shrink-0" />
              )}
              <span className="truncate">{t.label}</span>
            </li>
          ))}
          {p.tasks.length > 12 && <li className="pl-5 text-xs text-muted-foreground">+{p.tasks.length - 12} more…</li>}
        </ul>
      )}

      {/* Report summary when finished */}
      {finished && result?.consultants && result.consultants.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-xl border border-border">
          <table className="w-full text-[13px] leading-5">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-left font-medium">Consultant</th>
                <th className="px-3 py-2 text-right font-medium">Calls</th>
                <th className="px-3 py-2 text-right font-medium">Avg score</th>
              </tr>
            </thead>
            <tbody>
              {result.consultants.map((c) => (
                <tr key={c.name} className="border-t border-border">
                  <td className="px-3 py-2">{c.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.calls}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.avgScore ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
