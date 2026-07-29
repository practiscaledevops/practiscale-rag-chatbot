"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  Building2,
  Coins,
  DollarSign,
  RefreshCw,
  UserCheck,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Admin Overview — the landing page of the control panel. Reads fleet-wide 30d
 * summary numbers from /api/admin/overview (which enforces the admin gate and
 * aggregates via the service-role client) and renders them as summary cards plus
 * a top-models breakdown. Client-side fetch keeps the loading/refresh UX simple;
 * the parent layout has already gated the route, and the API re-checks the role.
 */

// Mirrors the /api/admin/overview response shape.
interface OverviewResponse {
  range: { days: number; since: string; until: string };
  totals: {
    users: number;
    activeUsers: number;
    teams: number;
    tokens: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    events: number;
  };
  topModels: Array<{
    model: string;
    provider: string | null;
    tokens: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    events: number;
  }>;
  truncated: boolean;
}

const numberFmt = new Intl.NumberFormat("en-US");
const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

/** Compact large token counts (12.3k / 4.5M) while keeping the exact value in a title. */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return numberFmt.format(n);
}

export default function AdminOverviewPage() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/overview", { cache: "no-store" });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail?.error ?? `Request failed (${res.status})`);
      }
      setData((await res.json()) as OverviewResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load overview");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Overview</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Fleet activity for the last {data?.range.days ?? 30} days.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-surface-muted disabled:pointer-events-none disabled:opacity-60"
        >
          <RefreshCw size={14} className={cn(loading && "animate-spin")} aria-hidden />
          Refresh
        </button>
      </div>

      {error ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger"
        >
          <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">Couldn&apos;t load the overview</p>
            <p className="mt-0.5 text-danger/80">{error}</p>
          </div>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <section aria-label="Summary" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard
              icon={Users}
              label="Total users"
              value={loading ? null : numberFmt.format(data!.totals.users)}
            />
            <StatCard
              icon={UserCheck}
              label="Active users (30d)"
              value={loading ? null : numberFmt.format(data!.totals.activeUsers)}
              hint="Distinct users with a metered call"
            />
            <StatCard
              icon={Building2}
              label="Teams"
              value={loading ? null : numberFmt.format(data!.totals.teams)}
            />
            <StatCard
              icon={Coins}
              label="Tokens (30d)"
              value={loading ? null : compact(data!.totals.tokens)}
              title={loading ? undefined : `${numberFmt.format(data!.totals.tokens)} tokens`}
              hint={
                loading
                  ? undefined
                  : `${compact(data!.totals.inputTokens)} in · ${compact(
                      data!.totals.outputTokens
                    )} out`
              }
            />
            <StatCard
              icon={DollarSign}
              label="Est. cost (30d)"
              value={loading ? null : currencyFmt.format(data!.totals.costUsd)}
              hint="Estimated from token pricing"
            />
            <StatCard
              icon={BarChart3}
              label="Metered calls (30d)"
              value={loading ? null : numberFmt.format(data!.totals.events)}
            />
          </section>

          {data?.truncated && (
            <p className="text-xs text-warning">
              High volume: totals reflect the most recent {numberFmt.format(data.totals.events)}{" "}
              calls in the window.
            </p>
          )}

          {/* Top models */}
          <TopModels loading={loading} models={data?.topModels ?? []} />
        </>
      )}
    </div>
  );
}

/** A single summary metric. Renders a shimmer when `value` is null (loading). */
function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  title,
}: {
  icon: typeof Users;
  label: string;
  value: string | null;
  hint?: string;
  title?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-soft">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/10 text-accent">
          <Icon size={16} aria-hidden />
        </span>
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="mt-3">
        {value === null ? (
          <div className="h-8 w-24 animate-pulse rounded-md bg-surface-muted" aria-hidden />
        ) : (
          <p className="text-2xl font-semibold tabular-nums tracking-tight" title={title}>
            {value}
          </p>
        )}
        {hint && !(value === null) && (
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        )}
      </div>
    </div>
  );
}

/** Top models by token volume over the window. */
function TopModels({
  loading,
  models,
}: {
  loading: boolean;
  models: OverviewResponse["topModels"];
}) {
  return (
    <section
      aria-label="Top models"
      className="rounded-xl border border-border bg-surface shadow-soft"
    >
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Top models (30d)</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">By token volume.</p>
      </div>

      {loading ? (
        <div className="divide-y divide-border">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="h-4 w-40 animate-pulse rounded bg-surface-muted" aria-hidden />
              <div className="h-4 w-16 animate-pulse rounded bg-surface-muted" aria-hidden />
            </div>
          ))}
        </div>
      ) : models.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          No usage recorded in this window yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-4 py-2 font-medium">
                  Model
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Tokens
                </th>
                <th scope="col" className="hidden px-4 py-2 text-right font-medium sm:table-cell">
                  Calls
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Est. cost
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {models.map((m) => (
                <tr key={m.model} className="hover:bg-surface-muted/60">
                  <td className="px-4 py-3">
                    <span className="font-medium">{m.model}</span>
                    {m.provider && (
                      <span className="ml-2 rounded-md bg-surface-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {m.provider}
                      </span>
                    )}
                  </td>
                  <td
                    className="px-4 py-3 text-right tabular-nums"
                    title={`${numberFmt.format(m.tokens)} tokens`}
                  >
                    {compact(m.tokens)}
                  </td>
                  <td className="hidden px-4 py-3 text-right tabular-nums text-muted-foreground sm:table-cell">
                    {numberFmt.format(m.events)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {currencyFmt.format(m.costUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
