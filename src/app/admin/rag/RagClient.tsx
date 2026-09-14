"use client";

// Admin › RAG debugger — type a query, see EXACTLY what the Brain retrieves for
// it: the effective (rewritten) query, an overall confidence, and each chunk with
// its reranker score, source type, and snippet. Read-only; all data comes from
// /api/admin/retrieve which re-checks the admin gate.

import { useCallback, useState } from "react";
import { Bug, Loader2, Search, AlertTriangle, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

interface DebugItem {
  id: string;
  content: string;
  source_type: string | null;
  document_id: string;
  score: number | null;
}

interface DebugResult {
  ok: boolean;
  query?: string;
  rewritten?: boolean;
  confidence?: number | null;
  results: DebugItem[];
  error?: string;
}

function confidenceMeta(c: number | null | undefined) {
  if (typeof c !== "number") return null;
  const pct = Math.round(Math.max(0, Math.min(1, c)) * 100);
  const tone = pct >= 66 ? "high" : pct >= 33 ? "medium" : "low";
  return { pct, tone } as const;
}

const TONE_CLS: Record<string, string> = {
  high: "text-emerald-600 dark:text-emerald-400",
  medium: "text-amber-600 dark:text-amber-400",
  low: "text-rose-600 dark:text-rose-400",
};

function scoreBar(score: number | null) {
  if (typeof score !== "number") return null;
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100);
  const tone = pct >= 66 ? "bg-emerald-500" : pct >= 33 ? "bg-amber-500" : "bg-rose-500";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-muted">
        <span className={cn("block h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
      </span>
      <span className="tabular-nums text-[11px] text-muted-foreground">{pct}%</span>
    </span>
  );
}

export function RagClient() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DebugResult | null>(null);

  const run = useCallback(async () => {
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/retrieve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const data = (await res.json()) as DebugResult;
      setResult(data);
    } catch {
      setResult({ ok: false, results: [], error: "Request failed. Try again." });
    } finally {
      setLoading(false);
    }
  }, [query, loading]);

  const conf = result?.ok ? confidenceMeta(result.confidence) : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:py-8">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Bug size={20} className="text-accent" />
          RAG debugger
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          See exactly what the knowledge base retrieves for a query — the effective
          search, the confidence, and every chunk with its relevance score.
        </p>
      </div>

      <form
        className="mt-5 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <div className="flex flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3 shadow-soft">
          <Search size={16} className="shrink-0 text-muted-foreground" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask what a user might ask…"
            className="w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:pointer-events-none disabled:opacity-50"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
          Retrieve
        </button>
      </form>

      {result && !result.ok && (
        <div className="mt-5 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-foreground">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
          <span>{result.error || "Retrieval failed."}</span>
        </div>
      )}

      {result?.ok && (
        <div className="mt-5 space-y-4">
          {/* Summary bar */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm shadow-soft">
            <div>
              <span className="text-muted-foreground">Chunks: </span>
              <span className="font-semibold">{result.results.length}</span>
            </div>
            {conf && (
              <div>
                <span className="text-muted-foreground">Confidence: </span>
                <span className={cn("font-semibold", TONE_CLS[conf.tone])}>{conf.pct}%</span>
              </div>
            )}
            {result.query && (
              <div className="min-w-0">
                <span className="text-muted-foreground">Searched: </span>
                <span className="font-medium">{result.query}</span>
                {result.rewritten && (
                  <span className="ml-1.5 rounded-full border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    rewritten
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Retrieved chunks */}
          {result.results.length === 0 ? (
            <p className="rounded-xl border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
              Nothing retrieved. The knowledge base has no matching content in this key&apos;s scope.
            </p>
          ) : (
            <ul className="space-y-2">
              {result.results.map((r, i) => (
                <li key={r.id} className="rounded-xl border border-border bg-surface p-3 shadow-soft">
                  <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                      <FileText size={12} aria-hidden />#{i + 1}
                    </span>
                    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {(r.source_type || "source").replace(/_/g, " ")}
                    </span>
                    <span className="ml-auto">{scoreBar(r.score)}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">
                    {r.content.length > 600 ? r.content.slice(0, 600) + "…" : r.content}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
