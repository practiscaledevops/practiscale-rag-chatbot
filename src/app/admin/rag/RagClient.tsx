"use client";

// Admin › RAG debugger — type a query, see EXACTLY what the Brain retrieves for
// it: the effective (rewritten) query, an overall confidence, and each chunk with
// its reranker score, source type, and snippet. Read-only; all data comes from
// /api/admin/retrieve which re-checks the admin gate.

import { useCallback, useState } from "react";
import { Loader2, Search, AlertTriangle, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/Button";

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
  high: "bg-success/10 text-success",
  medium: "bg-warning/10 text-warning",
  low: "bg-danger/10 text-danger",
};

function scoreBar(score: number | null) {
  if (typeof score !== "number") return null;
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100);
  const tone = pct >= 66 ? "bg-success" : pct >= 33 ? "bg-warning" : "bg-danger";
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-sunken">
        <span className={cn("block h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
      </span>
      <span className="tabular-nums text-xs text-muted-foreground">{pct}%</span>
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
    <div className="w-full">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">RAG debugger</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
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
        <div className="flex h-9 flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3 transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-ring/30">
          <Search size={16} className="shrink-0 text-muted-foreground" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask what a user might ask…"
            className="h-full w-full bg-transparent text-sm outline-none placeholder:text-subtle-foreground focus-visible:outline-none"
          />
        </div>
        <Button
          type="submit"
          disabled={loading || !query.trim()}
          className="shrink-0"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
          Retrieve
        </Button>
      </form>

      {result && !result.ok && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-[13px] text-foreground">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
          <span>{result.error || "Retrieval failed."}</span>
        </div>
      )}

      {result?.ok && (
        <div className="mt-4 space-y-3">
          {/* Summary bar */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-[13px] shadow-soft">
            <div>
              <span className="text-muted-foreground">Chunks: </span>
              <span className="font-semibold">{result.results.length}</span>
            </div>
            {conf && (
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Confidence:</span>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                    TONE_CLS[conf.tone]
                  )}
                >
                  {conf.pct}%
                </span>
              </div>
            )}
            {result.query && (
              <div className="flex min-w-0 items-center gap-1">
                <span className="text-muted-foreground">Searched:</span>
                <span className="font-medium">{result.query}</span>
                {result.rewritten && (
                  <span className="ml-0.5 inline-flex shrink-0 items-center rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-strong">
                    rewritten
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Retrieved chunks */}
          {result.results.length === 0 ? (
            <div className="flex flex-col items-center gap-2.5 rounded-xl border border-border bg-surface p-5 text-center">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-accent-soft text-accent">
                <Search size={16} aria-hidden />
              </span>
              <p className="text-[13px] text-muted-foreground">
                Nothing retrieved. The knowledge base has no matching content in this key&apos;s scope.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {result.results.map((r, i) => (
                <li key={r.id} className="rounded-xl border border-border bg-surface p-4 shadow-soft">
                  <div className="mb-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                      <FileText size={12} aria-hidden />#{i + 1}
                    </span>
                    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium capitalize text-muted-foreground">
                      {(r.source_type || "source").replace(/_/g, " ")}
                    </span>
                    <span className="ml-auto">{scoreBar(r.score)}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-[13px] leading-5 text-foreground/90">
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
