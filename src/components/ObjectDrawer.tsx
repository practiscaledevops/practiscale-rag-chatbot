"use client";

// Right-side sheet that shows ONE knowledge object from the Brain: what it is,
// how much to trust it (governance), where it came from, the compiled text,
// how it connects to other objects, and the learning records built on it.
// Reused by the Brain map, the learnings page and the chat's evidence panel.
//
// Data comes from this app's /api/brain/knowledge/[ref] proxy (the scoped key
// and the sensitive flag are both resolved server-side).

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BadgeCheck,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  Lightbulb,
  Link2,
  MessageSquare,
  RefreshCw,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/Button";
import { IconButton } from "@/components/IconButton";
import { Markdown } from "@/app/(app)/_components/Markdown";
import {
  ENDORSEMENT_LABEL,
  EVIDENCE_LABEL,
  IMPLEMENTATION_LABEL,
  LEARNING_TYPE_LABEL,
  LEARNING_TYPE_TONE,
  LEARNING_STATUS_LABEL,
  PRIORITY_LABEL,
  STATUS_LABEL,
  VALIDATION_LABEL,
  askPrompt,
  authorityLabel,
  classLabel,
  domainLabel,
  humanize,
  relationshipLabel,
  type KnowledgeDetailResponse,
  type KnowledgeRelationship,
} from "@/lib/brain-types";

export interface ObjectDrawerProps {
  /** Ref of the object to show (e.g. "MG-001"); null keeps the drawer closed. */
  refId: string | null;
  onClose: () => void;
  /**
   * "Ask about this" handler, given a ready-made prompt. Defaults to opening a
   * new chat with the composer pre-filled (`/?prompt=`).
   */
  onAsk?: (prompt: string) => void;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string; notFound: boolean }
  | { status: "ready"; data: KnowledgeDetailResponse };

/** Short date for the governance row ("12 Mar 2026"). */
function shortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  return t.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Free-form provenance → display strings (strings, or objects with name/title/url). */
function asStringList(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === "string" && v.trim() ? [v] : [];
  return list
    .map((x) => {
      if (typeof x === "string") return x;
      if (x && typeof x === "object") {
        const o = x as Record<string, unknown>;
        const name = [o.name, o.title, o.label].find((s) => typeof s === "string" && s) as string | undefined;
        const url = typeof o.url === "string" ? o.url : undefined;
        return name && url ? `${name} — ${url}` : name || url || "";
      }
      return "";
    })
    .filter(Boolean);
}

export function ObjectDrawer({ refId, onClose, onAsk }: ObjectDrawerProps) {
  const router = useRouter();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const open = refId !== null;

  // Latest onClose in a ref, so the key-handling effect below depends only on
  // `open` — a parent passing a fresh callback each render must not re-run it
  // (that would re-focus the close button and re-fire the focus restore).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // In-drawer navigation: clicking a related object pushes it on a small stack
  // so the user can step back without closing the sheet.
  const [stack, setStack] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(refId);
  useEffect(() => {
    setActive(refId);
    setStack([]);
  }, [refId]);

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!active) return;
    const ctrl = new AbortController();
    setState({ status: "loading" });
    fetch(`/api/brain/knowledge/${encodeURIComponent(active)}`, { signal: ctrl.signal })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as KnowledgeDetailResponse & { error?: string };
        if (!res.ok) {
          const notFound = res.status === 404;
          throw Object.assign(
            new Error(
              notFound
                ? "This object isn't available to you or no longer exists."
                : json.error || `Couldn't load the object (${res.status}).`
            ),
            { notFound }
          );
        }
        setState({ status: "ready", data: json });
      })
      .catch((e: Error & { notFound?: boolean }) => {
        if (e.name === "AbortError") return;
        setState({ status: "error", message: e.message, notFound: !!e.notFound });
      });
    return () => ctrl.abort();
  }, [active, reload]);

  // Escape closes; focus lands on the close button on open, stays inside the
  // sheet while it is open (Tab / Shift+Tab wrap, as in Modal), and returns to
  // the trigger on close.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => closeRef.current?.focus());
    const focusables = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab") {
        // Minimal focus trap: wrap Tab / Shift+Tab within the panel.
        const items = focusables();
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  const navigate = useCallback((ref: string) => {
    setStack((s) => (active ? [...s, active] : s));
    setActive(ref);
  }, [active]);

  const back = useCallback(() => {
    setStack((s) => {
      const prev = s[s.length - 1];
      if (prev) setActive(prev);
      return s.slice(0, -1);
    });
  }, []);

  const [copied, setCopied] = useState(false);
  const copyRef = useCallback(async (ref: string) => {
    try {
      await navigator.clipboard.writeText(ref);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable (insecure context) — ignore.
    }
  }, []);

  const ask = useCallback(
    (ref: string, name: string | null) => {
      const prompt = askPrompt(ref, name);
      if (onAsk) onAsk(prompt);
      else router.push(`/?prompt=${encodeURIComponent(prompt)}`);
    },
    [onAsk, router]
  );

  if (!open) return null;

  const data = state.status === "ready" ? state.data : null;
  const o = data?.object ?? null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-[#111315]/30 backdrop-blur-[3px] motion-safe:animate-fadeIn"
        onClick={onClose}
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 flex h-full w-full max-w-xl flex-col overflow-hidden border-l border-border bg-surface text-foreground shadow-soft-lg sm:rounded-l-2xl"
      >
        {/* Header */}
        <div className="flex shrink-0 items-start gap-2 border-b border-border px-4 py-3.5 sm:px-5">
          {stack.length > 0 && (
            <IconButton aria-label="Back to previous object" size="sm" onClick={back} className="-ml-1 shrink-0">
              <ArrowLeft size={16} />
            </IconButton>
          )}
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[11px] leading-4 text-accent-strong">{active}</p>
            <h2 id={titleId} className="mt-0.5 text-[15px] font-semibold leading-snug tracking-tight">
              {o ? o.name : state.status === "loading" ? "Loading…" : "Knowledge object"}
            </h2>
            {o && (
              <div className="mt-2 flex flex-wrap gap-1">
                <Chip tone="accent">{classLabel(o.intelligence_class)}</Chip>
                {o.domain && <Chip>{domainLabel(o.domain)}</Chip>}
                {o.object_type && <Chip>{humanize(o.object_type)}</Chip>}
                {o.subtype && <Chip>{humanize(o.subtype)}</Chip>}
              </div>
            )}
          </div>
          <IconButton ref={closeRef} aria-label="Close object" size="sm" onClick={onClose} className="-mr-1 shrink-0">
            <X size={16} />
          </IconButton>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {state.status === "loading" && <DrawerSkeleton />}

          {state.status === "error" && (
            <div
              role="alert"
              className={cn(
                "rounded-xl border px-3.5 py-3 text-[13px]",
                state.notFound
                  ? "border-border bg-surface-muted text-muted-foreground"
                  : "border-danger/30 bg-danger/10 text-danger"
              )}
            >
              <p>{state.message}</p>
              {!state.notFound && (
                <Button variant="secondary" size="sm" className="mt-2.5" onClick={() => setReload((n) => n + 1)}>
                  <RefreshCw size={14} />
                  Retry
                </Button>
              )}
            </div>
          )}

          {o && data && (
            <div className="divide-y divide-border">
              {/* Governance */}
              <section aria-label="Governance" className={sectionClass}>
                <div className="flex flex-wrap gap-1">
                  <Chip tone="strong" title="Authority — what the Brain believes when sources conflict">
                    <BadgeCheck size={12} aria-hidden />
                    {authorityLabel(o.authority)}
                  </Chip>
                  {o.founder_endorsement && (
                    <Chip tone={o.founder_endorsement === "practiscale_standard" ? "accent" : "muted"}>
                      {ENDORSEMENT_LABEL[o.founder_endorsement] ?? humanize(o.founder_endorsement)}
                    </Chip>
                  )}
                  {o.current === false ? (
                    <Chip tone="warning">
                      {o.status === "historical" ? "Historical" : "Expired"}
                      {shortDate(o.effective_until) ? ` · until ${shortDate(o.effective_until)}` : ""}
                    </Chip>
                  ) : (
                    <Chip tone="success">
                      Current{shortDate(o.effective_from) ? ` · since ${shortDate(o.effective_from)}` : ""}
                    </Chip>
                  )}
                  {o.status && o.status !== "active" && o.status !== "historical" && (
                    <Chip tone="warning">{STATUS_LABEL[o.status] ?? humanize(o.status)}</Chip>
                  )}
                </div>
                <dl className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-2.5 text-[13px] sm:grid-cols-3">
                  <Fact label="Implementation" value={o.implementation_status ? IMPLEMENTATION_LABEL[o.implementation_status] ?? humanize(o.implementation_status) : null} />
                  <Fact label="Validation" value={o.internal_validation ? VALIDATION_LABEL[o.internal_validation] ?? humanize(o.internal_validation) : null} />
                  <Fact label="Priority" value={o.priority ? PRIORITY_LABEL[o.priority] ?? humanize(o.priority) : null} />
                  <Fact label="Updated" value={shortDate(o.updated_at)} />
                  <Fact label="Last verified" value={shortDate(o.last_verified_at)} />
                  <Fact label="Indexed" value={`${data.chunks} chunk${data.chunks === 1 ? "" : "s"}`} />
                </dl>
              </section>

              {/* Summary */}
              {o.summary && (
                <section aria-label="Summary" className={sectionClass}>
                  <p className="text-sm leading-6 text-foreground/90">{o.summary}</p>
                  {(o.applies_to.length > 0 || o.goals.length > 0 || o.platforms.length > 0) && (
                    <div className="mt-2.5 flex flex-wrap gap-1">
                      {o.applies_to.map((t) => <Chip key={`a-${t}`} title="Applies to">{t}</Chip>)}
                      {o.goals.map((t) => <Chip key={`g-${t}`} title="Goal">{humanize(t)}</Chip>)}
                      {o.platforms.map((t) => <Chip key={`p-${t}`} title="Platform">{humanize(t)}</Chip>)}
                    </div>
                  )}
                </section>
              )}

              {/* Provenance */}
              <section aria-labelledby={`${titleId}-src`} className={sectionClass}>
                <h3 id={`${titleId}-src`} className={sectionHeading}>
                  <FileText size={14} aria-hidden /> Where it came from
                </h3>
                <Provenance o={o} />
              </section>

              {/* Compiled markdown */}
              {o.compiled_markdown && (
                <section aria-label="Full object" className={sectionClass}>
                  <FullObject markdown={o.compiled_markdown} />
                </section>
              )}

              {/* Relationships */}
              <section aria-labelledby={`${titleId}-rel`} className={sectionClass}>
                <h3 id={`${titleId}-rel`} className={sectionHeading}>
                  <Link2 size={14} aria-hidden /> How it connects
                </h3>
                <Relationships self={o.ref} list={data.relationships} onOpen={navigate} />
              </section>

              {/* Linked learning */}
              <section aria-labelledby={`${titleId}-lrn`} className={sectionClass}>
                <h3 id={`${titleId}-lrn`} className={sectionHeading}>
                  <Lightbulb size={14} aria-hidden /> Learning built on it
                </h3>
                {data.learning.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">No learning records reference this object yet.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {data.learning.map((l) => (
                      <li key={l.id} className="rounded-xl border border-border bg-surface px-3 py-2 text-xs">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[11px] text-accent-strong">{l.ref}</span>
                          <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4", LEARNING_TYPE_TONE[l.record_type] ?? "border-border text-muted-foreground")}>
                            {LEARNING_TYPE_LABEL[l.record_type] ?? humanize(l.record_type)}
                          </span>
                          <span className="text-muted-foreground">{LEARNING_STATUS_LABEL[l.status] ?? humanize(l.status)}</span>
                          {l.department && <span className="text-muted-foreground">· {l.department}</span>}
                        </div>
                        <p className="mt-1 text-[13px] font-medium text-foreground">{l.title}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}
        </div>

        {/* Actions */}
        {o && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-4 py-3 sm:px-5">
            <Button size="sm" className="h-8 px-3.5 text-[13px]" onClick={() => ask(o.ref, o.name)}>
              <MessageSquare size={14} />
              Ask about this
            </Button>
            <Button size="sm" variant="secondary" className="h-8 px-3.5 text-[13px]" onClick={() => copyRef(o.ref)}>
              {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy ref"}
            </Button>
          </div>
        )}
      </aside>
    </div>
  );
}

// Drawer sections are stacked with hairline dividers (divide-y on the parent).
const sectionClass = "py-4 first:pt-0 last:pb-0";

const sectionHeading =
  "mb-2.5 flex items-center gap-1.5 text-sm font-semibold text-foreground [&>svg]:text-accent";

type ChipTone = "muted" | "accent" | "strong" | "warning" | "success";

const CHIP_TONE: Record<ChipTone, string> = {
  muted: "border-transparent bg-surface-muted text-muted-foreground",
  accent: "border-transparent bg-accent-soft text-accent-strong",
  strong: "border-border bg-surface text-foreground",
  warning: "border-transparent bg-warning/10 text-warning",
  success: "border-transparent bg-success/10 text-success",
};

/** Small rounded label used across the drawer + pages. */
export function Chip({
  children,
  tone = "muted",
  title,
  className,
}: {
  children: React.ReactNode;
  tone?: ChipTone;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
        CHIP_TONE[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-[13px] font-medium text-foreground">{value}</dd>
    </div>
  );
}

function Provenance({ o }: { o: KnowledgeDetailResponse["object"] }) {
  const claims = asStringList(o.source_claims);
  const sources = asStringList(o.sources);
  const rows: Array<[string, React.ReactNode]> = [];
  if (o.source_expert) rows.push(["Expert / author", o.source_expert]);
  if (o.source_type) rows.push(["Source type", humanize(o.source_type)]);
  if (o.source_platform) rows.push(["Platform", humanize(o.source_platform)]);
  if (o.source_date) rows.push(["Source date", shortDate(o.source_date) ?? o.source_date]);
  if (o.evidence_level) rows.push(["Evidence level", EVIDENCE_LABEL[o.evidence_level] ?? humanize(o.evidence_level)]);
  if (o.source_url) {
    // Only an http(s) URL becomes a link; anything else (javascript:, data:,
    // a bare note) is shown as plain text — the value comes from the Brain's
    // stored provenance, not from this UI.
    const isHttp = /^https?:\/\//i.test(o.source_url);
    rows.push([
      "Link",
      isHttp ? (
        <a
          key="url"
          href={o.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex max-w-full items-center gap-1 text-accent-strong hover:underline"
        >
          <span className="truncate">{o.source_url.replace(/^https?:\/\//, "")}</span>
          <ExternalLink size={12} className="shrink-0" aria-hidden />
        </a>
      ) : (
        <span key="url" className="truncate">{o.source_url}</span>
      ),
    ]);
  }
  if (rows.length === 0 && claims.length === 0 && sources.length === 0) {
    return <p className="text-[13px] text-muted-foreground">No provenance recorded for this object.</p>;
  }
  return (
    <div className="rounded-xl border border-border bg-surface-muted/50 px-3.5 py-3 text-[13px]">
      {rows.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0 truncate text-foreground">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {claims.length > 0 && (
        <div className={rows.length ? "mt-3 border-t border-border pt-3" : ""}>
          <p className="text-xs font-medium text-muted-foreground">Source claims</p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-foreground/90">
            {claims.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      )}
      {sources.length > 0 && (
        <div className={rows.length || claims.length ? "mt-3 border-t border-border pt-3" : ""}>
          <p className="text-xs font-medium text-muted-foreground">Sources</p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-foreground/90">
            {sources.map((s, i) => <li key={i} className="break-words">{s}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Collapsible compiled markdown, rendered with the chat's Markdown component. */
function FullObject({ markdown }: { markdown: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex h-10 w-full items-center justify-between gap-2 px-3.5 text-left text-[13px] font-medium text-foreground transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="inline-flex items-center gap-1.5">
          {open ? (
            <ChevronDown size={14} className="text-muted-foreground" aria-hidden />
          ) : (
            <ChevronRight size={14} className="text-muted-foreground" aria-hidden />
          )}
          Read the full object
        </span>
        <span className="text-xs font-normal text-muted-foreground">
          {Math.max(1, Math.round(markdown.length / 1000))}k chars
        </span>
      </button>
      {open && (
        <div className="border-t border-border px-4 py-3.5 text-sm leading-6 text-foreground">
          <Markdown content={markdown} />
        </div>
      )}
    </div>
  );
}

function Relationships({
  self,
  list,
  onOpen,
}: {
  self: string;
  list: KnowledgeRelationship[];
  onOpen: (ref: string) => void;
}) {
  if (list.length === 0) {
    return <p className="text-[13px] text-muted-foreground">No confirmed or suggested connections yet.</p>;
  }
  const out = list.filter((r) => r.direction === "out");
  const inn = list.filter((r) => r.direction === "in");
  const row = (r: KnowledgeRelationship, incoming: boolean) => (
    <li key={r.id}>
      <button
        type="button"
        onClick={() => onOpen(r.ref)}
        className="flex w-full items-start gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-left text-[13px] transition-colors hover:border-accent/30 hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0 flex-1 leading-snug">
          {incoming ? (
            <>
              <span className="font-mono text-xs text-accent-strong">{r.ref}</span>{" "}
              <span className="font-medium text-foreground">{r.name}</span>{" "}
              <span className="text-muted-foreground">{relationshipLabel(r.type)} {self}</span>
            </>
          ) : (
            <>
              <span className="text-muted-foreground">{relationshipLabel(r.type)}</span>{" "}
              <span className="font-mono text-xs text-accent-strong">{r.ref}</span>{" "}
              <span className="font-medium text-foreground">{r.name}</span>
            </>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {r.intelligence_class && <Chip>{classLabel(r.intelligence_class)}</Chip>}
          {r.status && r.status !== "confirmed" && (
            <Chip tone="warning" title="Suggested by the Brain, not yet confirmed">{humanize(r.status)}</Chip>
          )}
        </span>
      </button>
    </li>
  );
  return (
    <div className="space-y-3.5">
      {out.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">This object…</p>
          <ul className="space-y-1.5">{out.map((r) => row(r, false))}</ul>
        </div>
      )}
      {inn.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Other objects…</p>
          <ul className="space-y-1.5">{inn.map((r) => row(r, true))}</ul>
        </div>
      )}
    </div>
  );
}

function DrawerSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="flex gap-1.5">
        <div className="h-5 w-40 animate-pulse rounded-full bg-surface-muted" />
        <div className="h-5 w-24 animate-pulse rounded-full bg-surface-muted" />
        <div className="h-5 w-20 animate-pulse rounded-full bg-surface-muted" />
      </div>
      <div className="space-y-2">
        <div className="h-3 w-11/12 animate-pulse rounded-full bg-surface-muted" />
        <div className="h-3 w-4/5 animate-pulse rounded-full bg-surface-muted [animation-delay:120ms]" />
        <div className="h-3 w-2/3 animate-pulse rounded-full bg-surface-muted [animation-delay:240ms]" />
      </div>
      <div className="h-20 animate-pulse rounded-xl bg-surface-muted" />
      <div className="h-10 animate-pulse rounded-xl bg-surface-muted" />
      <div className="space-y-1.5">
        <div className="h-9 animate-pulse rounded-xl bg-surface-muted" />
        <div className="h-9 animate-pulse rounded-xl bg-surface-muted [animation-delay:120ms]" />
      </div>
    </div>
  );
}
