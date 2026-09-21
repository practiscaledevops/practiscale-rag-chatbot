"use client";

// /brain — the Brain map. Shows what the Brain knows at a glance (org-wide
// counts + the five intelligence classes), lets the user narrow by class,
// domain and free text, and opens any object in the ObjectDrawer. Data comes
// from /api/brain/knowledge; the sensitive flag is resolved server-side there.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Brain, Loader2, MessageSquare, RefreshCw, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/Button";
import { Chip, ObjectDrawer } from "@/components/ObjectDrawer";
import {
  ENDORSEMENT_LABEL,
  INTELLIGENCE_CLASSES,
  askPrompt,
  authorityLabel,
  classLabel,
  domainLabel,
  humanize,
  type KnowledgeCounts,
  type KnowledgeListResponse,
  type KnowledgeObjectSummary,
} from "@/lib/brain-types";

const PAGE_SIZE = 30;

function sum(rec: Record<string, number> | undefined): number {
  return rec ? Object.values(rec).reduce((a, b) => a + (Number(b) || 0), 0) : 0;
}

/** "Updated 3 days ago" from an ISO date, or null. */
function freshness(iso?: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function BrainMapClient() {
  const router = useRouter();
  const [cls, setCls] = useState<string | null>(null);
  const [domain, setDomain] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");

  const [data, setData] = useState<KnowledgeListResponse | null>(null);
  const [objects, setObjects] = useState<KnowledgeObjectSummary[]>([]);
  // Hero + class counts come from the first UNFILTERED response so they stay
  // org-wide while the user narrows the list.
  const [baseCounts, setBaseCounts] = useState<KnowledgeCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [drawerRef, setDrawerRef] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const url = useCallback(
    (offset: number) => {
      const sp = new URLSearchParams();
      if (cls) sp.set("class", cls);
      if (domain) sp.set("domain", domain);
      if (debouncedQ) sp.set("q", debouncedQ);
      sp.set("limit", String(PAGE_SIZE));
      sp.set("offset", String(offset));
      return `/api/brain/knowledge?${sp.toString()}`;
    },
    [cls, domain, debouncedQ]
  );

  const filtered = !!(cls || domain || debouncedQ);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetch(url(0), { signal: ctrl.signal })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as KnowledgeListResponse & { error?: string };
        if (!res.ok) throw new Error(json.error || `Couldn't load the Brain map (${res.status}).`);
        setData(json);
        setObjects(Array.isArray(json.objects) ? json.objects : []);
        setBaseCounts((b) => (!filtered || !b ? json.counts : b));
      })
      .catch((e: Error) => {
        if (e.name === "AbortError") return;
        setError(e.message);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [url, filtered, reload]);

  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(url(objects.length));
      const json = (await res.json().catch(() => ({}))) as KnowledgeListResponse & { error?: string };
      if (!res.ok) throw new Error(json.error || `Couldn't load more (${res.status}).`);
      setData(json);
      setObjects((prev) => [...prev, ...(Array.isArray(json.objects) ? json.objects : [])]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load more.");
    } finally {
      setLoadingMore(false);
    }
  }, [url, objects.length, loadingMore]);

  const hero = baseCounts ?? data?.counts ?? null;
  const domains = useMemo(
    () =>
      Object.entries(data?.counts.byDomain ?? hero?.byDomain ?? {})
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1]),
    [data, hero]
  );
  const hasMore = !!data && data.page.returned === data.page.limit && objects.length >= data.page.limit;

  const ask = useCallback(
    (o: KnowledgeObjectSummary) => router.push(`/?prompt=${encodeURIComponent(askPrompt(o.ref, o.name))}`),
    [router]
  );

  const clearFilters = () => {
    setCls(null);
    setDomain(null);
    setQ("");
  };

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <header className="mb-6">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Brain size={22} className="text-accent" />
            Brain map
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What the Brain knows, how much it trusts each piece, and where it came from.
          </p>
        </header>

        {/* Org-wide counts */}
        <section aria-label="Totals" className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Objects" value={hero?.total} />
          <Stat label="Learnings" value={hero ? sum(hero.learningByType) : undefined} />
          <Stat
            label="Relationships"
            value={hero?.relationships.confirmed}
            hint={hero && hero.relationships.suggested > 0 ? `+${hero.relationships.suggested} suggested` : undefined}
          />
          <Stat label="Entities" value={hero ? sum(hero.entitiesByKind) : undefined} />
          <Stat label="Metrics" value={hero?.metrics} />
        </section>

        {/* Class cards */}
        <section aria-label="Intelligence classes" className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {INTELLIGENCE_CLASSES.map((c) => {
            const active = cls === c.id;
            const n = hero?.byClass?.[c.id] ?? 0;
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={active}
                onClick={() => setCls(active ? null : c.id)}
                className={cn(
                  "flex flex-col rounded-xl border bg-surface p-3.5 text-left shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-soft-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "border-accent ring-1 ring-accent/40" : "border-border hover:border-accent/40"
                )}
              >
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {c.label}
                </span>
                <span className="mt-1 text-sm font-medium text-foreground">{c.question}</span>
                <span className="mt-2 text-2xl font-semibold tabular-nums text-accent">
                  {hero ? n.toLocaleString() : "—"}
                </span>
                <span className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{c.description}</span>
              </button>
            );
          })}
        </section>

        {/* Domain chips */}
        {domains.length > 0 && (
          <section aria-label="Domains" className="mt-5 flex flex-wrap gap-1.5">
            {domains.map(([id, n]) => {
              const active = domain === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setDomain(active ? null : id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border bg-surface text-foreground/90 hover:border-accent/40 hover:bg-surface-muted"
                  )}
                >
                  {domainLabel(id)}
                  <span className="tabular-nums text-muted-foreground">{n}</span>
                </button>
              );
            })}
          </section>
        )}

        {/* Search */}
        <div className="mt-5 flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search objects by name, ref or summary…"
              aria-label="Search the Brain"
              className="w-full rounded-xl border border-border bg-surface py-2.5 pl-9 pr-3 text-sm text-foreground shadow-soft placeholder:text-muted-foreground focus-visible:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            />
          </div>
          {filtered && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X size={13} />
              Clear
            </Button>
          )}
        </div>

        {/* Results */}
        <section aria-label="Objects" className="mt-4">
          <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {loading ? (
                <span className="inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Loading…</span>
              ) : (
                <>
                  {objects.length}{hasMore ? "+" : ""} object{objects.length === 1 ? "" : "s"}
                  {cls && <> · {classLabel(cls)}</>}
                  {domain && <> · {domainLabel(domain)}</>}
                  {debouncedQ && <> · “{debouncedQ}”</>}
                </>
              )}
            </span>
          </div>

          {error && (
            <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-3 text-sm text-danger">
              <p>{error}</p>
              <Button variant="secondary" size="sm" className="mt-2" onClick={() => setReload((n) => n + 1)}>
                <RefreshCw size={13} />
                Retry
              </Button>
            </div>
          )}

          {loading && !error ? (
            <ul className="space-y-2" aria-hidden>
              {Array.from({ length: 5 }).map((_, i) => (
                <li key={i} className="h-20 animate-pulse rounded-xl bg-surface-muted" />
              ))}
            </ul>
          ) : !error && objects.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface px-4 py-12 text-center text-sm text-muted-foreground">
              {filtered ? (
                <>
                  No objects match these filters.{" "}
                  <button type="button" onClick={clearFilters} className="text-accent hover:underline">
                    Clear them
                  </button>
                  .
                </>
              ) : (
                "The Brain has no knowledge objects yet. Ingest sources in the Brain's back office to see them here."
              )}
            </div>
          ) : (
            <ul className="space-y-2">
              {objects.map((o) => (
                <ObjectRow key={o.id} o={o} onOpen={() => setDrawerRef(o.ref)} onAsk={() => ask(o)} />
              ))}
            </ul>
          )}

          {hasMore && !loading && !error && (
            <div className="mt-3 flex justify-center">
              <Button variant="secondary" size="sm" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? <Loader2 size={13} className="animate-spin" /> : null}
                Load more
              </Button>
            </div>
          )}
        </section>
      </div>

      <ObjectDrawer refId={drawerRef} onClose={() => setDrawerRef(null)} />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number | undefined; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-3.5 py-3 shadow-soft">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums text-foreground">
        {typeof value === "number" ? value.toLocaleString() : "—"}
      </p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** One result: click to open the drawer; the small Ask button starts a chat about it. */
function ObjectRow({
  o,
  onOpen,
  onAsk,
}: {
  o: KnowledgeObjectSummary;
  onOpen: () => void;
  onAsk: () => void;
}) {
  const fresh = freshness(o.updated_at);
  return (
    <li className="rounded-xl border border-border bg-surface shadow-soft transition-colors hover:border-accent/40">
      <div className="flex items-start gap-2 p-3">
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-mono text-xs text-accent">{o.ref}</span>
            <span className="text-sm font-medium text-foreground">{o.name}</span>
            {o.current === false && (
              <Chip tone="warning">{o.status === "historical" ? "Historical" : "Expired"}</Chip>
            )}
            {o.status === "draft" && <Chip tone="warning">Draft</Chip>}
          </span>
          {o.summary && (
            <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{o.summary}</span>
          )}
          <span className="mt-1.5 flex flex-wrap items-center gap-1">
            <Chip tone="accent">{classLabel(o.intelligence_class)}</Chip>
            {(o.domain || o.object_type || o.subtype) && (
              <Chip>
                {[o.domain && domainLabel(o.domain), o.object_type && humanize(o.object_type), o.subtype && humanize(o.subtype)]
                  .filter(Boolean)
                  .join(" / ")}
              </Chip>
            )}
            <Chip tone="strong" title="Authority">{authorityLabel(o.authority)}</Chip>
            {o.founder_endorsement && (
              <Chip tone={o.founder_endorsement === "practiscale_standard" ? "accent" : "muted"}>
                {ENDORSEMENT_LABEL[o.founder_endorsement] ?? humanize(o.founder_endorsement)}
              </Chip>
            )}
            {fresh && <span className="text-[11px] text-muted-foreground">· updated {fresh}</span>}
          </span>
        </button>
        <Button variant="ghost" size="sm" onClick={onAsk} className="shrink-0" title="Ask the assistant about this object">
          <MessageSquare size={13} />
          <span className="hidden sm:inline">Ask about this</span>
          <span className="sm:hidden">Ask</span>
        </Button>
      </div>
    </li>
  );
}
