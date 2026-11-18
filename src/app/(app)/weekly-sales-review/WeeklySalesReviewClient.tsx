"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Download, RefreshCw } from "lucide-react";
import { AnswerProgress } from "@/components/AnswerProgress";
import { Button } from "@/components/Button";
import { exportDocx, exportPdf } from "@/lib/export-doc";
import { reviewMoney, reviewTimestamp, weekEnd, type WeeklySalesReview } from "@/lib/weekly-sales-review";

type Metric = [label: string, value: number | string];
type Coverage = { title: string; metrics: Metric[]; notes: string[] };

function payrollCoverage(section: WeeklySalesReview["payroll"]): Coverage {
  const title = "Payroll · Recognized sales";
  if (section.status !== "ready") return { title, metrics: [], notes: [section.message] };
  const p = section.data;
  const metrics: Metric[] = [
    ["Recognized closings", p.closings], ["Closed sales", reviewMoney(p.usdMinor)],
    ["High ticket", p.high.count + " · " + reviewMoney(p.high.usdMinor)],
    ["Low ticket", p.low.count + " · " + reviewMoney(p.low.usdMinor)],
  ];
  if (p.reviewed) {
    const r = p.reviewed;
    metrics.push(
      ["Payroll-reviewed show rate", r.showRate === null ? "Unavailable" : (r.showRate * 100).toFixed(1) + "%"],
      ["Reviewed show-ups", r.showed], ["Elapsed meeting contacts", r.elapsed],
      ["Recorded no-shows", r.noShow], ["Unclassified outcomes", r.unclassified],
    );
  }
  const notes = ["Checked " + reviewTimestamp(p.checkedAt), p.dateBasis + " (UTC date labels)."];
  if (p.reviewWarning) notes.push(p.reviewWarning);
  if (p.undatedEntries) notes.push(p.undatedEntries + " undated entries in the touched Payroll months are excluded from this week.");
  if (p.assumedTickets) notes.push("Payroll supplied an assumed ticket category for " + p.assumedTickets + " included closings.");
  return { title, metrics, notes };
}

function ghlCoverage(section: WeeklySalesReview["ghl"], refreshWarning: string | null): Coverage {
  const title = "GHL · Appointment activity";
  if (section.status !== "ready") return { title, metrics: [], notes: [section.message] };
  const g = section.data;
  const delayed = !!g.lastFailureAt || Date.now() - Date.parse(g.verifiedAt) > 600_000;
  const metrics: Metric[] = [
    ["Appointments in window", g.total], ["CRM showed", g.showed], ["CRM no-show", g.noshow],
    ["Cancelled", g.cancelled], ["Invalid", g.invalid], ["Other statuses", g.total - g.showed - g.noshow - g.cancelled - g.invalid],
  ];
  const notes = [
    "Snapshot verified " + reviewTimestamp(g.verifiedAt) + " · " + g.calendars + " calendars checked.",
    "Counts use scheduled start time in PKT. CRM and Payroll use different outcome definitions.",
  ];
  if (refreshWarning) notes.push(refreshWarning);
  else if (delayed) notes.push("Showing the last complete snapshot. A more recent verification is pending.");
  return { title, metrics, notes };
}

function scoringCoverage(section: WeeklySalesReview["scoring"]): Coverage {
  const title = "Call Scoring · Coaching evidence";
  if (section.status !== "ready") return { title, metrics: [], notes: [section.message] };
  const s = section.data;
  const notes = ["Checked " + reviewTimestamp(s.checkedAt), "Figures cover the indexed roster by source call date."];
  if (s.pendingTranscripts) notes.push(s.pendingTranscripts + " transcripts are still indexing.");
  if (s.failedSamples) notes.push(s.failedSamples + " selected transcripts could not be read.");
  if (s.coachingStatus !== "ready") notes.push(s.coachingStatus === "unavailable"
    ? "Coaching examples are temporarily unavailable." : "No timestamped coaching examples were available in this sample.");
  return { title, notes, metrics: [
    ["Calls in roster", s.calls], ["Scored calls", s.scoredCalls],
    ["Average score", s.averageScore === null ? "Unavailable" : s.averageScore.toFixed(1) + " / 100"],
    ["Calls sampled for examples", s.sampledCalls],
  ] };
}

function CoverageCard({ coverage, children }: { coverage: Coverage; children?: ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-border bg-surface p-4 sm:p-5">
      <h3 className="text-base font-semibold text-foreground">{coverage.title}</h3>
      {coverage.metrics.length > 0 && (
        <dl className="my-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          {coverage.metrics.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-0.5 break-words text-base font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-2 space-y-1 text-sm text-muted-foreground">
        {coverage.notes.map((note) => <p key={note}>{note}</p>)}
      </div>
      {children}
    </section>
  );
}

export function WeeklySalesReviewClient({ initialMonday, demo }: { initialMonday: string; demo: boolean }) {
  const [from, setFrom] = useState(initialMonday);
  const [pending, setPending] = useState<"run" | "refresh" | null>(null);
  const [report, setReport] = useState<WeeklySalesReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ghlWarning, setGhlWarning] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  async function run(start: string, refreshGhl = false) {
    if (active.current) return;
    const request = new AbortController();
    active.current = request;
    setPending(refreshGhl ? "refresh" : "run");
    setError(null);
    try {
      const response = await fetch("/api/weekly-sales-review", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: start, refreshGhl }), signal: request.signal,
      });
      const payload = await response.json().catch(() => null);
      if (request.signal.aborted) return;
      if (!response.ok) throw new Error(payload?.error || "The review could not be loaded. Try again.");
      if (payload?.week?.from !== start || !payload.ghl) throw new Error("The review returned an unexpected week. Try again.");
      if (refreshGhl) {
        const { ghl } = payload as Pick<WeeklySalesReview, "ghl">;
        if (report?.ghl.status === "ready" && ghl.status === "unavailable") {
          setGhlWarning("Refresh failed. Showing the last complete snapshot.");
        } else {
          setGhlWarning(null);
          setReport(current => current?.week.from === start ? { ...current, ghl } : current);
        }
      } else {
        if (!payload.payroll || !payload.scoring) throw new Error("The review did not finish. Try again.");
        setGhlWarning(null);
        setReport(payload as WeeklySalesReview);
      }
    } catch (e) {
      if (!request.signal.aborted) setError(e instanceof Error ? e.message : "The review could not be loaded. Try again.");
    } finally {
      if (active.current === request) {
        active.current = null;
        if (!request.signal.aborted) setPending(null);
      }
    }
  }

  function cancel() {
    active.current?.abort();
    active.current = null;
    setPending(null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!from || from > initialMonday || new Date(from + "T00:00:00Z").getUTCDay() !== 1) {
      setError("Choose a Monday from a completed week.");
      return;
    }
    void run(from);
  }

  const coverage = report ? [
    payrollCoverage(report.payroll), ghlCoverage(report.ghl, ghlWarning), scoringCoverage(report.scoring),
  ] : [];
  const examples = report?.scoring.status === "ready" ? report.scoring.data.examples : [];
  const hasData = coverage.some(section => section.metrics.length > 0);

  async function download(format: "docx" | "pdf") {
    if (!report || exporting || !hasData) return;
    setExporting(true);
    setError(null);
    const content = [
      (demo ? "Sample report\n" : "") + report.week.from + " to " + report.week.through + " · Company-wide · PKT",
      ...coverage.map(section => [section.title, ...section.metrics.map(([label, value]) => label + ": " + value), ...section.notes].join("\n")),
      ...examples.map(example => [
        example.consultant + " · " + example.date + " · " + example.timestamp,
        "Call reference: " + (example.recordId ?? example.documentId),
        "Excerpt: " + example.quote, example.observation, "Coaching action: " + example.action,
      ].join("\n")),
    ].join("\n\n");
    try {
      const title = "Weekly Sales Review " + report.week.from;
      await (format === "docx" ? exportDocx : exportPdf)(title, [{ role: "assistant", content }]);
    } catch {
      setError("The export could not be prepared. Try again.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6 sm:px-8 sm:py-9">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Weekly Sales Review</h1>
        <p className="mt-1 text-sm text-muted-foreground">Company-wide sales, appointment activity, and call coaching.</p>
        {demo && <p className="mt-1 text-sm font-medium text-muted-foreground">Sample data</p>}
      </header>
      <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-surface p-4 sm:p-5">
        <div className="w-full max-w-[16rem]">
          <label htmlFor="review-week" className="mb-1.5 block text-sm font-medium">Week starting Monday</label>
          <input id="review-week" type="date" value={from} max={initialMonday} min="1970-01-05" step={7}
            onChange={event => setFrom(event.target.value)} disabled={!!pending} aria-describedby="review-week-hint"
            className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          <p id="review-week-hint" className="mt-1.5 text-xs text-muted-foreground">
            {from && Number.isFinite(Date.parse(from)) ? "Through " + weekEnd(from) + " · PKT" : "Choose a completed Monday–Sunday week."}
          </p>
        </div>
        <Button size="lg" type="submit" disabled={!!pending || !from} className="mb-5">Run review</Button>
      </form>

      {error && <p role="alert" className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p>}
      {pending && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-4">
          <AnswerProgress pendingHint="The selected week will stay here if the request is interrupted." label={pending === "refresh" ? "Refreshing appointment data from GHL" : "Checking Payroll, GHL, and Call Scoring"} />
          <Button variant="secondary" onClick={cancel}>Stop</Button>
        </div>
      )}
      {report && (
        <div aria-busy={!!pending} className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Week of {report.week.from}</h2>
              <p className="text-xs text-muted-foreground">Through {report.week.through} · PKT</p>
            </div>
            {hasData && (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" disabled={exporting || !!pending} onClick={() => void download("docx")}>
                  <Download size={14} aria-hidden /> Export Word
                </Button>
                <Button variant="secondary" size="sm" disabled={exporting || !!pending} onClick={() => void download("pdf")}>
                  <Download size={14} aria-hidden /> Export PDF
                </Button>
              </div>
            )}
          </div>
          <CoverageCard coverage={coverage[0]} />
          <CoverageCard coverage={coverage[1]}>
            <Button size="sm" variant="secondary" className="mt-3" disabled={!!pending} onClick={() => void run(report.week.from, true)}>
              <RefreshCw size={14} aria-hidden /> Refresh from GHL
            </Button>
          </CoverageCard>
          <CoverageCard coverage={coverage[2]}>
            {examples.length > 0 && (
              <ol className="mt-4 space-y-3">
                {examples.map(example => (
                  <li key={example.documentId} className="rounded-xl border border-border p-3">
                    <p className="text-sm font-medium">{example.consultant} · {example.date} · {example.timestamp}</p>
                    <p className="mt-1 break-all text-xs text-muted-foreground">Call reference {example.recordId ?? example.documentId}</p>
                    <blockquote className="mt-2 border-l-2 border-border pl-3 text-sm text-muted-foreground">“{example.quote}”</blockquote>
                    <p className="mt-2 text-sm">{example.observation}</p>
                    <p className="mt-1 text-sm"><strong>Coaching action:</strong> {example.action}</p>
                  </li>
                ))}
              </ol>
            )}
          </CoverageCard>
        </div>
      )}
    </div>
  );
}
