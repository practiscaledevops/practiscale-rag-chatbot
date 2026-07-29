"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  CircleDollarSign,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types — mirror the /api/admin/usage response.
// ---------------------------------------------------------------------------

type Range = "7d" | "30d" | "90d";
type Scope = "overall" | "user" | "team";

interface Tally {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}
interface ByModel extends Tally {
  model: string;
  provider: string;
}
interface ByUser extends Tally {
  userId: string;
  label: string;
  email: string | null;
}
interface ByTeam extends Tally {
  teamId: string | null;
  name: string;
  budgetUsd: number | null;
  remainingUsd: number | null;
  overBudget: boolean;
}
interface Point extends Tally {
  date: string;
}
interface AvailableModel {
  id: string;
  provider: string;
}
interface UsageResponse {
  filters: { range: Range; model: string; scope: Scope; from: string; to: string };
  availableModels: AvailableModel[];
  overall: Tally;
  byModel: ByModel[];
  byUser: ByUser[];
  byTeam: ByTeam[];
  timeseries: Point[];
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const intFmt = new Intl.NumberFormat("en-US");
const compactFmt = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Compact token count, e.g. 1.2M / 12.3K / 840. */
function formatTokens(n: number): string {
  return compactFmt.format(Math.max(0, Math.round(n)));
}

/** Grouped integer, e.g. 1,204,553. */
function formatInt(n: number): string {
  return intFmt.format(Math.max(0, Math.round(n)));
}

/** USD, adaptive precision: sub-cent amounts get 4dp so tiny costs aren't "$0.00". */
function formatMoney(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  const dp = v !== 0 && Math.abs(v) < 0.01 ? 4 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  }).format(v);
}

/** "Jul 29" (UTC) for chart axis ticks. */
function formatDayShort(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}

/** "Tue, Jul 29" (UTC) for the chart tooltip label. */
function formatDayLong(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

const RANGE_OPTIONS: { value: Range; label: string }[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
];

const SCOPE_OPTIONS: { value: Scope; label: string }[] = [
  { value: "overall", label: "Overall" },
  { value: "user", label: "By user" },
  { value: "team", label: "By team" },
];

/** Accessible segmented control (single-select button group). */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex rounded-lg border border-border bg-surface p-0.5"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              active
                ? "bg-accent text-accent-foreground shadow-soft"
                : "text-muted-foreground hover:text-foreground hover:bg-surface-muted"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** A provider tag pill. */
function ProviderBadge({ provider }: { provider: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium capitalize text-muted-foreground">
      {provider || "unknown"}
    </span>
  );
}

/** One KPI card. */
function KpiCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-soft">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className="text-muted-foreground" aria-hidden>
          {icon}
        </span>
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
        {value}
      </div>
      {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

/** Detect the OS colour scheme so the chart palette matches the theme. */
function usePrefersDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setDark(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return dark;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function UsageClient() {
  const [range, setRange] = useState<Range>("30d");
  const [model, setModel] = useState<string>("all");
  const [scope, setScope] = useState<Scope>("overall");

  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const dark = usePrefersDark();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Fetch on range/model change (and manual refresh). Scope is a pure view
  // toggle — the API always returns every breakdown, so switching scope needs
  // no refetch.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ range, model, scope });
    fetch(`/api/admin/usage?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const msg =
            typeof body?.error === "string"
              ? body.error
              : `Request failed (${res.status})`;
          throw new Error(msg);
        }
        return res.json() as Promise<UsageResponse>;
      })
      .then((json) => setData(json))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Failed to load usage");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
    // `scope` intentionally excluded — it does not change the response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, model, reloadKey]);

  // Model dropdown options. Always include the current selection so a controlled
  // <select> never points at a missing option after the range changes.
  const modelOptions = useMemo<AvailableModel[]>(() => {
    const list = data?.availableModels ?? [];
    if (model !== "all" && !list.some((m) => m.id === model)) {
      return [{ id: model, provider: "unknown" }, ...list];
    }
    return list;
  }, [data, model]);

  const overall = data?.overall;
  const hasData = (overall?.requests ?? 0) > 0;

  const chartColors = dark
    ? {
        grid: "#1f2c2a",
        axis: "#94a3b8",
        input: "#2dd4bf",
        output: "#5eead4",
        cost: "#fbbf24",
        tooltipBg: "#101818",
        tooltipBorder: "#1f2c2a",
        tooltipText: "#ecf0ef",
      }
    : {
        grid: "#e2e8f0",
        axis: "#64748b",
        input: "#0d9488",
        output: "#5eead4",
        cost: "#d97706",
        tooltipBg: "#ffffff",
        tooltipBorder: "#e0e7e5",
        tooltipText: "#10181b",
      };

  const rangeLabel = RANGE_OPTIONS.find((r) => r.value === range)?.label ?? range;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      {/* Header */}
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Usage &amp; cost
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Requests, token consumption and estimated spend across the workspace.
            {model !== "all" ? (
              <>
                {" "}
                Filtered to <span className="font-medium text-foreground">{model}</span>.
              </>
            ) : null}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-soft transition-colors hover:text-foreground hover:bg-surface-muted"
        >
          <RefreshCw size={14} className={cn(loading && "animate-spin")} />
          Refresh
        </button>
      </header>

      {/* Filter bar */}
      <div className="mb-5 flex flex-wrap items-end gap-4 rounded-xl border border-border bg-surface p-4 shadow-soft">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Time range</span>
          <Segmented label="Time range" value={range} options={RANGE_OPTIONS} onChange={setRange} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="model-filter" className="text-xs font-medium text-muted-foreground">
            Model
          </label>
          <select
            id="model-filter"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="h-8 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-foreground shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">All models</option>
            {modelOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
                {m.provider && m.provider !== "unknown" ? ` · ${m.provider}` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Breakdown</span>
          <Segmented label="Breakdown scope" value={scope} options={SCOPE_OPTIONS} onChange={setScope} />
        </div>
      </div>

      {/* Error banner */}
      {error ? (
        <div
          role="alert"
          className="mb-5 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger"
        >
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Could not load usage</div>
            <div className="text-danger/80">{error}</div>
          </div>
        </div>
      ) : null}

      {/* KPI cards */}
      <section
        aria-label="Key metrics"
        className={cn(
          "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4",
          loading && !data && "animate-pulse"
        )}
      >
        <KpiCard
          label="Requests"
          value={formatInt(overall?.requests ?? 0)}
          sub={`over the last ${rangeLabel}`}
          icon={<Activity size={16} />}
        />
        <KpiCard
          label="Input tokens"
          value={formatTokens(overall?.inputTokens ?? 0)}
          sub={`${formatInt(overall?.inputTokens ?? 0)} total`}
          icon={<ArrowDownToLine size={16} />}
        />
        <KpiCard
          label="Output tokens"
          value={formatTokens(overall?.outputTokens ?? 0)}
          sub={`${formatInt(overall?.outputTokens ?? 0)} total`}
          icon={<ArrowUpFromLine size={16} />}
        />
        <KpiCard
          label="Total cost"
          value={formatMoney(overall?.costUsd ?? 0)}
          sub="estimated (USD)"
          icon={<CircleDollarSign size={16} />}
        />
      </section>

      {/* Time-series chart */}
      <section className="mt-5 rounded-xl border border-border bg-surface p-4 shadow-soft">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Tokens &amp; cost over time</h2>
          <span className="text-xs text-muted-foreground">Daily · last {rangeLabel}</span>
        </div>
        <div className="h-72 w-full">
          {mounted && data && hasData ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={data.timeseries}
                margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDayShort}
                  tick={{ fill: chartColors.axis, fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: chartColors.grid }}
                  minTickGap={24}
                />
                <YAxis
                  yAxisId="tokens"
                  tickFormatter={(v: number) => formatTokens(v)}
                  tick={{ fill: chartColors.axis, fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                />
                <YAxis
                  yAxisId="cost"
                  orientation="right"
                  tickFormatter={(v: number) => formatMoney(v)}
                  tick={{ fill: chartColors.axis, fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={64}
                />
                <Tooltip
                  contentStyle={{
                    background: chartColors.tooltipBg,
                    border: `1px solid ${chartColors.tooltipBorder}`,
                    borderRadius: 10,
                    color: chartColors.tooltipText,
                    fontSize: 12,
                    boxShadow: "0 4px 16px rgb(16 24 27 / 0.12)",
                  }}
                  labelStyle={{ color: chartColors.tooltipText, fontWeight: 600, marginBottom: 4 }}
                  labelFormatter={(d: string) => formatDayLong(d)}
                  formatter={(value: unknown, name: unknown, item: unknown) => {
                    const key = (item as { dataKey?: unknown } | undefined)?.dataKey;
                    const v =
                      key === "costUsd"
                        ? formatMoney(Number(value))
                        : formatTokens(Number(value));
                    // recharts' Formatter expects [ReactNode, NameType]; keep the
                    // series name as a string so the tuple type matches.
                    return [v, name as string] as [string, string];
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 12, color: chartColors.axis, paddingTop: 8 }}
                  iconType="circle"
                />
                <Bar
                  yAxisId="tokens"
                  dataKey="inputTokens"
                  stackId="tok"
                  name="Input tokens"
                  fill={chartColors.input}
                  maxBarSize={28}
                />
                <Bar
                  yAxisId="tokens"
                  dataKey="outputTokens"
                  stackId="tok"
                  name="Output tokens"
                  fill={chartColors.output}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={28}
                />
                <Line
                  yAxisId="cost"
                  type="monotone"
                  dataKey="costUsd"
                  name="Cost (USD)"
                  stroke={chartColors.cost}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {loading && !data
                ? "Loading chart…"
                : "No usage recorded in this range."}
            </div>
          )}
        </div>
      </section>

      {/* Scope-driven breakdown */}
      <section className="mt-5 rounded-xl border border-border bg-surface shadow-soft">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">
            {scope === "overall"
              ? "By model & provider"
              : scope === "user"
                ? "By user"
                : "By team"}
          </h2>
          <span className="text-xs text-muted-foreground">
            {scope === "overall"
              ? `${data?.byModel.length ?? 0} models`
              : scope === "user"
                ? `${data?.byUser.length ?? 0} users`
                : `${data?.byTeam.length ?? 0} teams`}
          </span>
        </div>

        <div className="overflow-x-auto">
          {scope === "overall" ? (
            <ModelTable rows={data?.byModel ?? []} loading={loading && !data} />
          ) : scope === "user" ? (
            <UserTable rows={data?.byUser ?? []} loading={loading && !data} />
          ) : (
            <TeamTable rows={data?.byTeam ?? []} loading={loading && !data} />
          )}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

const TH = "px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground";
const THR = "px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground";
const TD = "px-4 py-2.5 text-sm text-foreground";
const TDR = "px-4 py-2.5 text-right text-sm tabular-nums text-foreground";

function EmptyRow({ colSpan, loading }: { colSpan: number; loading: boolean }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-muted-foreground">
        {loading ? "Loading…" : "No usage in this range."}
      </td>
    </tr>
  );
}

function ModelTable({ rows, loading }: { rows: ByModel[]; loading: boolean }) {
  return (
    <table className="w-full min-w-[640px] border-collapse">
      <caption className="sr-only">Usage by model and provider</caption>
      <thead>
        <tr className="border-b border-border">
          <th scope="col" className={TH}>Model</th>
          <th scope="col" className={TH}>Provider</th>
          <th scope="col" className={THR}>Requests</th>
          <th scope="col" className={THR}>Input</th>
          <th scope="col" className={THR}>Output</th>
          <th scope="col" className={THR}>Total tokens</th>
          <th scope="col" className={THR}>Cost</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <EmptyRow colSpan={7} loading={loading} />
        ) : (
          rows.map((r) => (
            <tr key={r.model} className="border-b border-border/60 last:border-0 hover:bg-surface-muted/50">
              <td className={cn(TD, "font-medium")}>{r.model}</td>
              <td className={TD}><ProviderBadge provider={r.provider} /></td>
              <td className={TDR}>{formatInt(r.requests)}</td>
              <td className={TDR} title={formatInt(r.inputTokens)}>{formatTokens(r.inputTokens)}</td>
              <td className={TDR} title={formatInt(r.outputTokens)}>{formatTokens(r.outputTokens)}</td>
              <td className={TDR} title={formatInt(r.totalTokens)}>{formatTokens(r.totalTokens)}</td>
              <td className={cn(TDR, "font-medium")}>{formatMoney(r.costUsd)}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

function UserTable({ rows, loading }: { rows: ByUser[]; loading: boolean }) {
  return (
    <table className="w-full min-w-[640px] border-collapse">
      <caption className="sr-only">Usage by user</caption>
      <thead>
        <tr className="border-b border-border">
          <th scope="col" className={TH}>User</th>
          <th scope="col" className={THR}>Requests</th>
          <th scope="col" className={THR}>Input</th>
          <th scope="col" className={THR}>Output</th>
          <th scope="col" className={THR}>Total tokens</th>
          <th scope="col" className={THR}>Cost</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <EmptyRow colSpan={6} loading={loading} />
        ) : (
          rows.map((r) => (
            <tr key={r.userId} className="border-b border-border/60 last:border-0 hover:bg-surface-muted/50">
              <td className={TD}>
                <div className="font-medium">{r.label}</div>
                {r.email && r.email !== r.label ? (
                  <div className="text-xs text-muted-foreground">{r.email}</div>
                ) : null}
              </td>
              <td className={TDR}>{formatInt(r.requests)}</td>
              <td className={TDR} title={formatInt(r.inputTokens)}>{formatTokens(r.inputTokens)}</td>
              <td className={TDR} title={formatInt(r.outputTokens)}>{formatTokens(r.outputTokens)}</td>
              <td className={TDR} title={formatInt(r.totalTokens)}>{formatTokens(r.totalTokens)}</td>
              <td className={cn(TDR, "font-medium")}>{formatMoney(r.costUsd)}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

function TeamTable({ rows, loading }: { rows: ByTeam[]; loading: boolean }) {
  return (
    <table className="w-full min-w-[720px] border-collapse">
      <caption className="sr-only">Usage by team with budget</caption>
      <thead>
        <tr className="border-b border-border">
          <th scope="col" className={TH}>Team</th>
          <th scope="col" className={THR}>Requests</th>
          <th scope="col" className={THR}>Total tokens</th>
          <th scope="col" className={THR}>Cost</th>
          <th scope="col" className={THR}>Budget / mo</th>
          <th scope="col" className={THR}>Over / under</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <EmptyRow colSpan={6} loading={loading} />
        ) : (
          rows.map((r) => (
            <tr
              key={r.teamId ?? "__none__"}
              className="border-b border-border/60 last:border-0 hover:bg-surface-muted/50"
            >
              <td className={cn(TD, "font-medium")}>{r.name}</td>
              <td className={TDR}>{formatInt(r.requests)}</td>
              <td className={TDR} title={formatInt(r.totalTokens)}>{formatTokens(r.totalTokens)}</td>
              <td className={cn(TDR, "font-medium")}>{formatMoney(r.costUsd)}</td>
              <td className={TDR}>{r.budgetUsd == null ? "—" : formatMoney(r.budgetUsd)}</td>
              <td className={TDR}>
                {r.budgetUsd == null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                      r.overBudget
                        ? "bg-danger/10 text-danger"
                        : "bg-success/10 text-success"
                    )}
                  >
                    {r.overBudget ? "Over " : "Under "}
                    {formatMoney(Math.abs(r.remainingUsd ?? 0))}
                  </span>
                )}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
