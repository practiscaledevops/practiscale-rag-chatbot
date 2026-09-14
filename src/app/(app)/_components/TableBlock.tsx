"use client";

// TableBlock — a rendered Markdown table plus an optional "Chart" toggle.
//
// The table itself is rendered upstream (in Markdown) so citations and inline
// formatting are preserved; this only adds a table/chart switch when the data is
// chartable. The chart is drawn from the SAME cells (validated-data-only), and
// the ChartBlock (with recharts) is lazy so the library loads only when a user
// actually opens a chart.

import { useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Table2, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { hasChartableData } from "@/lib/chart-data";

const ChartBlock = dynamic(() => import("./ChartBlock").then((m) => m.ChartBlock), {
  ssr: false,
  loading: () => (
    <div className="grid h-[280px] place-items-center rounded-xl border border-border bg-surface/60 text-xs text-muted-foreground">
      Loading chart…
    </div>
  ),
});

export function TableBlock({
  table,
  headers,
  rows,
}: {
  table: ReactNode;
  headers: string[];
  rows: string[][];
}) {
  const chartable = hasChartableData(headers, rows);
  const [view, setView] = useState<"table" | "chart">("table");

  if (!chartable) return <>{table}</>;

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1">
        <ToggleButton active={view === "table"} onClick={() => setView("table")} icon={Table2} label="Table" />
        <ToggleButton active={view === "chart"} onClick={() => setView("chart")} icon={BarChart3} label="Chart" />
      </div>
      {view === "table" ? table : <ChartBlock headers={headers} rows={rows} />}
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Table2;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-accent/10 text-accent"
          : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"
      )}
    >
      <Icon size={13} aria-hidden />
      {label}
    </button>
  );
}
