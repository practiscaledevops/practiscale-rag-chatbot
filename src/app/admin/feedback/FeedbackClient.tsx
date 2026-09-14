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
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:py-8">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <MessageSquareText size={20} className="text-accent" />
          Feedback &amp; QA
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What people rated on answers. Review the downvotes to find weak responses and
          knowledge gaps.
        </p>
      </div>

      {/* Counts */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 shadow-soft">
          <ThumbsUp size={18} className="text-success" />
          <div>
            <div className="text-lg font-semibold tabular-nums">{counts.up.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Helpful</div>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 shadow-soft">
          <ThumbsDown size={18} className="text-danger" />
          <div>
            <div className="text-lg font-semibold tabular-nums">{counts.down.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Needs work</div>
          </div>
        </div>
      </div>

      {/* Filter */}
      <div className="mt-5 flex items-center gap-2">
        {(["down", "up", "all"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm capitalize transition-colors",
              filter === f
                ? "border-accent bg-accent/10 text-accent"
                : "border-border text-muted-foreground hover:bg-surface-muted"
            )}
          >
            {f === "down" ? "Needs work" : f === "up" ? "Helpful" : "All"}
          </button>
        ))}
        {loading && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
      </div>

      {/* List */}
      {data && !data.enabled ? (
        <p className="mt-6 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground">
          Feedback isn’t enabled yet — run migration 0006_message_feedback.sql in Supabase.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {(data?.items ?? []).map((it) => (
            <li key={it.id} className="rounded-xl border border-border bg-surface p-4 shadow-soft">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {it.rating === "up" ? (
                  <ThumbsUp size={13} className="text-success" />
                ) : (
                  <ThumbsDown size={13} className="text-danger" />
                )}
                <span className="font-medium text-foreground">{it.user || "Someone"}</span>
                {it.mode && it.mode !== "general" && (
                  <span className="rounded bg-surface-muted px-1.5 py-0.5 capitalize">{it.mode.replace(/_/g, " ")}</span>
                )}
                {it.model && <span className="rounded bg-surface-muted px-1.5 py-0.5">{it.model}</span>}
                <span className="ml-auto">{relTime(it.createdAt)}</span>
              </div>
              {it.prompt && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Q: </span>
                  <span className="text-foreground/90">{it.prompt.length > 240 ? it.prompt.slice(0, 240) + "…" : it.prompt}</span>
                </p>
              )}
              {it.content && (
                <p className="mt-1 text-sm text-muted-foreground">
                  <span>A: </span>
                  {it.content.length > 400 ? it.content.slice(0, 400) + "…" : it.content}
                </p>
              )}
            </li>
          ))}
          {!loading && (data?.items?.length ?? 0) === 0 && (
            <li className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No feedback yet in this view.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
