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

// Series palette: PractiScale greens first, then the kit's accent colors (no
// violet/indigo — the brand swaps those for green). Theme tokens (globals.css
// --chart-1…8), so the dark theme lifts the deep ones to stay ≥ 3:1 on the card.
const SERIES_COLORS = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `rgb(var(--chart-${n}))`);

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
  // Same light green-gray as the table grid, so both views read as one block.
  const grid = "rgb(var(--table-grid))";

  const kinds: { id: ChartKind; label: string; icon: typeof BarChart3 }[] = [
    { id: "bar", label: "Bar", icon: BarChart3 },
    { id: "line", label: "Line", icon: LineIcon },
    { id: "area", label: "Area", icon: AreaIcon },
    { id: "pie", label: "Pie", icon: PieIcon },
  ];

  return (
    // Sans + the table toolbar's pill buttons, whatever the answer font.
    <div className="rounded-xl border border-border bg-surface p-3 font-sans">
      <div className="mb-2 flex h-7 items-center gap-1">
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
                "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
                active
                  ? "bg-accent-soft text-accent-strong"
                  : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"
              )}
            >
              <Icon size={14} className="shrink-0" aria-hidden />
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
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              itemStyle={TOOLTIP_ITEM_STYLE}
              cursor={{ fill: "rgb(var(--muted-foreground) / 0.08)" }}
            />
            {valueCols.length > 1 && <Legend wrapperStyle={LEGEND_STYLE} formatter={legendLabel} />}
            {valueCols.map((c, i) => (
              <Bar key={headers[c]} dataKey={headers[c]} fill={SERIES_COLORS[i % SERIES_COLORS.length]} radius={[3, 3, 0, 0]} />
            ))}
          </BarChart>
        ) : effectiveKind === "line" ? (
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
            <XAxis dataKey="__cat" tick={axisTick} tickLine={false} axisLine={{ stroke: grid }} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} />
            <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} />
            {valueCols.length > 1 && <Legend wrapperStyle={LEGEND_STYLE} formatter={legendLabel} />}
            {valueCols.map((c, i) => (
              <Line
                key={headers[c]}
                type="monotone"
                dataKey={headers[c]}
                stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                strokeWidth={2}
                dot={false}
                activeDot={ACTIVE_DOT}
              />
            ))}
          </LineChart>
        ) : effectiveKind === "area" ? (
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
            <XAxis dataKey="__cat" tick={axisTick} tickLine={false} axisLine={{ stroke: grid }} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} />
            <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} />
            {valueCols.length > 1 && <Legend wrapperStyle={LEGEND_STYLE} formatter={legendLabel} />}
            {valueCols.map((c, i) => (
              <Area
                key={headers[c]}
                type="monotone"
                dataKey={headers[c]}
                stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                fillOpacity={0.18}
                strokeWidth={2}
                activeDot={ACTIVE_DOT}
              />
            ))}
          </AreaChart>
        ) : (
          <PieChart>
            <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} />
            <Pie
              data={data}
              dataKey={headers[valueCols[0]]}
              nameKey="__cat"
              cx="50%"
              cy="50%"
              outerRadius={95}
              // Seams in the card colour (recharts defaults to white), and
              // labels in the text colour rather than each slice's fill.
              stroke="rgb(var(--surface))"
              labelLine={{ stroke: "rgb(var(--muted-foreground))" }}
              label={renderPieLabel}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        )}
      </ResponsiveContainer>

      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Charted from this answer&apos;s table — no data added.
      </p>
    </div>
  );
}

const TOOLTIP_STYLE: React.CSSProperties = {
  background: "rgb(var(--surface))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 12,
  fontSize: 12,
  color: "rgb(var(--foreground))",
};

const LEGEND_STYLE: React.CSSProperties = { fontSize: 11 };

/** Tooltip rows in the text colour (recharts colours them with the series). */
const TOOLTIP_ITEM_STYLE: React.CSSProperties = { color: "rgb(var(--foreground))" };

/** Hover dots ringed in the card colour (recharts' default ring is white). */
const ACTIVE_DOT = { r: 4, stroke: "rgb(var(--surface))", strokeWidth: 2 };

/** Legend labels in the text colour; the swatch keeps the series colour. */
function legendLabel(value: unknown) {
  return <span style={{ color: "rgb(var(--foreground))" }}>{String(value)}</span>;
}

/** A pie slice label in the text colour (a string label would take the slice fill). */
function renderPieLabel(p: { x?: number; y?: number; textAnchor?: string; __cat?: string }) {
  const anchor = p.textAnchor === "start" || p.textAnchor === "end" ? p.textAnchor : "middle";
  return (
    <text
      x={p.x}
      y={p.y}
      textAnchor={anchor}
      dominantBaseline="central"
      fill="rgb(var(--foreground))"
      fontSize={11}
    >
      {p.__cat ?? ""}
    </text>
  );
}
