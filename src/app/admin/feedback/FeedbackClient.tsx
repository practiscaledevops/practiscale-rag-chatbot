"use client";

// Admin › Feedback & QA — review thumbs up/down on answers to spot weak or
// inaccurate responses and knowledge gaps. All authority is server-side
// (/api/admin/feedback re-checks the admin gate); this only reads + displays.

import { useCallback, useEffect, useState } from "react";
import { ThumbsUp, ThumbsDown, Loader2, MessageSquareText } from "lucide-react";
import { cn } from "@/lib/utils";

interface FeedbackItem {
  id: string;
  rating: "up" | "down";
  content: string | null;
  prompt: string | null;
  mode: string | null;
  model: string | null;
  createdAt: string;
  user: string | null;
}
interface Payload {
  items: FeedbackItem[];
  counts: { up: number; down: number };
  enabled: boolean;
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
  return new Date(iso).toLocaleDateString();
}

export function FeedbackClient() {
  const [data, setData] = useState<Payload | null>(null);
  const [filter, setFilter] = useState<"all" | "up" | "down">("down");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter === "all" ? "" : `?rating=${filter}`;
      const res = await fetch(`/api/admin/feedback${qs}`, { cache: "no-store" });
      if (res.ok) setData((await res.json()) as Payload);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = data?.counts ?? { up: 0, down: 0 };

  return (
    <div className="w-full">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Feedback &amp; QA</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          What people rated on answers. Review the downvotes to find weak responses and
          knowledge gaps.
        </p>
      </div>

      {/* Counts */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-4 shadow-soft">
          <div className="flex items-center gap-2.5 text-muted-foreground">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-success/10 text-success">
              <ThumbsUp size={16} />
            </span>
            <span className="text-[13px] font-medium">Helpful</span>
          </div>
          <div className="mt-3 text-[22px] font-semibold leading-7 tracking-tight tabular-nums">{counts.up.toLocaleString()}</div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4 shadow-soft">
          <div className="flex items-center gap-2.5 text-muted-foreground">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-danger/10 text-danger">
              <ThumbsDown size={16} />
            </span>
            <span className="text-[13px] font-medium">Needs work</span>
          </div>
          <div className="mt-3 text-[22px] font-semibold leading-7 tracking-tight tabular-nums">{counts.down.toLocaleString()}</div>
        </div>
      </div>

      {/* Filter */}
      <div className="mt-5 flex items-center gap-3">
        <div className="inline-flex h-8 items-center rounded-full bg-surface-muted p-0.5">
          {(["down", "up", "all"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "inline-flex h-7 items-center rounded-full px-3 text-[13px] font-medium capitalize transition-colors",
                filter === f
                  ? "bg-surface text-foreground shadow-soft"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {f === "down" ? "Needs work" : f === "up" ? "Helpful" : "All"}
            </button>
          ))}
        </div>
        {loading && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
      </div>

      {/* List */}
      {data && !data.enabled ? (
        <p className="mt-5 rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-[13px] text-foreground">
          Feedback isn’t enabled yet — run migration 0006_message_feedback.sql in Supabase.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {(data?.items ?? []).map((it) => (
            <li key={it.id} className="rounded-xl border border-border bg-surface p-4 shadow-soft">
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {it.rating === "up" ? (
                  <ThumbsUp size={13} className="shrink-0 text-success" />
                ) : (
                  <ThumbsDown size={13} className="shrink-0 text-danger" />
                )}
                <span className="font-medium text-foreground">{it.user || "Someone"}</span>
                {it.mode && it.mode !== "general" && (
                  <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium capitalize">{it.mode.replace(/_/g, " ")}</span>
                )}
                {it.model && <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium">{it.model}</span>}
                <span className="ml-auto text-[11px]">{relTime(it.createdAt)}</span>
              </div>
              {it.prompt && (
                <p className="text-[13px] leading-5">
                  <span className="text-muted-foreground">Q: </span>
                  <span className="text-foreground/90">{it.prompt.length > 240 ? it.prompt.slice(0, 240) + "…" : it.prompt}</span>
                </p>
              )}
              {it.content && (
                <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
                  <span>A: </span>
                  {it.content.length > 400 ? it.content.slice(0, 400) + "…" : it.content}
                </p>
              )}
            </li>
          ))}
          {!loading && (data?.items?.length ?? 0) === 0 && (
            <li className="flex flex-col items-center gap-2.5 rounded-xl border border-border bg-surface p-5 text-center">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-accent-soft text-accent">
                <MessageSquareText size={16} />
              </span>
              <p className="text-[13px] text-muted-foreground">No feedback yet in this view.</p>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
