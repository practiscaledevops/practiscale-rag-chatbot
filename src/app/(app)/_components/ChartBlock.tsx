"use client";

// ChartBlock — visualize a data table the assistant already produced.
//
// VALIDATED DATA ONLY: this never invents or re-derives numbers. It charts the
// EXACT cells of a grounded, cited Markdown table from the answer. If a column
// isn't numeric it simply isn't offered as a series. No table ⇒ no chart.

import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { BarChart3, LineChart as LineIcon, PieChart as PieIcon, AreaChart as AreaIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { toNumber, chartModel } from "@/lib/chart-data";

type ChartKind = "bar" | "line" | "area" | "pie";

// A palette that reads well in both light and dark themes.
const SERIES_COLORS = [
  "#14b8a6", // teal (brand accent)
  "#6366f1", // indigo
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#10b981", // emerald
  "#ec4899", // pink
  "#0ea5e9", // sky
];

export interface ChartBlockProps {
  headers: string[];
  rows: string[][];
}

export function ChartBlock({ headers, rows }: ChartBlockProps) {
  const { valueCols, catCol } = useMemo(() => chartModel(headers, rows), [headers, rows]);

  // Build recharts data: one object per row keyed by header name.
  const data = useMemo(
    () =>
      rows.map((r) => {
        const o: Record<string, string | number> = { __cat: (r[catCol] ?? "").trim() || "—" };
        for (const c of valueCols) o[headers[c]] = toNumber(r[c] ?? "") ?? 0;
        return o;
      }),
    [rows, headers, valueCols, catCol]
  );

  const [kind, setKind] = useState<ChartKind>("bar");

  if (valueCols.length === 0 || data.length === 0) return null;

  // Pie only makes sense for a single series; fall back to bar if pie is picked
  // with multiple series.
  const effectiveKind = kind === "pie" && valueCols.length > 1 ? "bar" : kind;

  const axisTick = { fill: "rgb(var(--muted-foreground))", fontSize: 11 };
  const grid = "rgb(var(--border))";

  const kinds: { id: ChartKind; label: string; icon: typeof BarChart3 }[] = [
    { id: "bar", label: "Bar", icon: BarChart3 },
    { id: "line", label: "Line", icon: LineIcon },
    { id: "area", label: "Area", icon: AreaIcon },
    { id: "pie", label: "Pie", icon: PieIcon },
  ];

  return (
    <div className="rounded-xl border border-border bg-surface/60 p-3">
      <div className="mb-2 flex items-center gap-1">
        {kinds.map((k) => {
          const Icon = k.icon;
          const disabled = k.id === "pie" && valueCols.length > 1;
          const active = effectiveKind === k.id;
          return (
            <button
              key={k.id}
              type="button"
              disabled={disabled}
              onClick={() => setKind(k.id)}
              title={disabled ? "Pie needs a single value column" : `${k.label} chart`}
              aria-pressed={active}
              className={cn(
                "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
                active
                  ? "bg-accent/10 text-accent"
                  : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"
              )}
            >
              <Icon size={13} aria-hidden />
              <span className="hidden sm:inline">{k.label}</span>
            </button>
          );
        })}
      </div>

      <ResponsiveContainer width="100%" height={280}>
        {effectiveKind === "bar" ? (
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
            <XAxis dataKey="__cat" tick={axisTick} tickLine={false} axisLine={{ stroke: grid }} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} />
            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgb(var(--muted-foreground) / 0.08)" }} />
            {valueCols.length > 1 && <Legend wrapperStyle={LEGEND_STYLE} />}
            {valueCols.map((c, i) => (
              <Bar key={headers[c]} dataKey={headers[c]} fill={SERIES_COLORS[i % SERIES_COLORS.length]} radius={[3, 3, 0, 0]} />
            ))}
          </BarChart>
        ) : effectiveKind === "line" ? (
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
            <XAxis dataKey="__cat" tick={axisTick} tickLine={false} axisLine={{ stroke: grid }} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            {valueCols.length > 1 && <Legend wrapperStyle={LEGEND_STYLE} />}
            {valueCols.map((c, i) => (
              <Line
                key={headers[c]}
                type="monotone"
                dataKey={headers[c]}
                stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        ) : effectiveKind === "area" ? (
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
            <XAxis dataKey="__cat" tick={axisTick} tickLine={false} axisLine={{ stroke: grid }} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            {valueCols.length > 1 && <Legend wrapperStyle={LEGEND_STYLE} />}
            {valueCols.map((c, i) => (
              <Area
                key={headers[c]}
                type="monotone"
                dataKey={headers[c]}
                stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                fillOpacity={0.18}
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        ) : (
          <PieChart>
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Pie
              data={data}
              dataKey={headers[valueCols[0]]}
              nameKey="__cat"
              cx="50%"
              cy="50%"
              outerRadius={95}
              label={(e: { __cat?: string }) => e.__cat ?? ""}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        )}
      </ResponsiveContainer>

      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Chart built from the table above — no data added.
      </p>
    </div>
  );
}

const TOOLTIP_STYLE: React.CSSProperties = {
  background: "rgb(var(--surface))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 10,
  fontSize: 12,
  color: "rgb(var(--foreground))",
};

const LEGEND_STYLE: React.CSSProperties = { fontSize: 11 };
