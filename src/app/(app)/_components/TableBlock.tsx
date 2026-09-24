"use client";

// TableBlock — how every Markdown table in an answer is presented.
//
// A bordered, horizontally scrollable grid in the SANS font at 13.5px whatever
// the answer font: soft green header row that sticks while a tall table scrolls
// (capped at 480px), a light green-gray grid between all cells, faint zebra
// rows with a hover highlight, and numeric columns right-aligned in tabular
// figures. A small toolbar offers the Table / Chart toggle (when the data is
// chartable) and "Copy table" — HTML + TSV, so it pastes as a real table into
// Word / Google Docs and straight into Excel / Sheets cells.
//
// Cells arrive pre-rendered from Markdown (citations and inline formatting
// preserved) alongside their raw strings, which drive the alignment, the chart
// and the clipboard. The chart is drawn from the SAME cells (validated-data-
// only), and ChartBlock (with recharts) is lazy so the library loads only when a
// user actually opens a chart.

import { useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Table2, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { hasChartableData } from "@/lib/chart-data";
import { copyTable, resolveColumnAlign, type TableAlign } from "@/lib/copy-format";
import { CopyButton } from "./CopyCodeButton";

const ChartBlock = dynamic(() => import("./ChartBlock").then((m) => m.ChartBlock), {
  ssr: false,
  loading: () => (
    <div className="grid h-[364px] place-items-center rounded-xl border border-border bg-surface text-xs text-muted-foreground">
      Loading chart…
    </div>
  ),
});

const ALIGN_CLS: Record<TableAlign, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

// Every cell draws its bottom + right edge; the wrapper draws the outer frame.
// (border-separate, not collapse, so the sticky header keeps its borders.)
const CELL = "border-b border-r border-table-grid px-3 py-2 last:border-r-0";

export interface TableBlockProps {
  /** Raw header strings (inline Markdown), one per column. */
  headers: string[];
  /** Raw body cells, each row normalised to the header width. */
  rows: string[][];
  /** GFM alignment from the separator row; null = auto (numeric → right). */
  align?: (TableAlign | null)[];
  /** Rendered header cells (same order as `headers`). */
  headerCells: ReactNode[];
  /** Rendered body cells (same shape as `rows`). */
  bodyCells: ReactNode[][];
}

export function TableBlock({ headers, rows, align, headerCells, bodyCells }: TableBlockProps) {
  const chartable = hasChartableData(headers, rows);
  const [view, setView] = useState<"table" | "chart">("table");
  const cols = resolveColumnAlign(rows, headers.length, align);
  const showChart = chartable && view === "chart";

  return (
    <div className="font-sans text-[13.5px] leading-[1.45]">
      <div className="mb-1.5 flex h-7 items-center gap-1">
        {chartable && (
          <>
            <ToolbarToggle active={!showChart} onClick={() => setView("table")} icon={Table2} label="Table" />
            <ToolbarToggle active={showChart} onClick={() => setView("chart")} icon={BarChart3} label="Chart" />
          </>
        )}
        <CopyButton
          onCopy={() => copyTable(headers, rows, align)}
          label="Copy table"
          className="ml-auto"
        />
      </div>

      {showChart ? (
        <ChartBlock headers={headers} rows={rows} />
      ) : (
        <div className="max-h-[480px] overflow-auto rounded-xl border border-border bg-surface">
          <table className="w-full border-separate border-spacing-0 tabular-nums">
            <thead>
              <tr>
                {headerCells.map((cell, ci) => (
                  <th
                    key={ci}
                    scope="col"
                    className={cn(
                      CELL,
                      "sticky top-0 z-[1] bg-accent-soft align-bottom font-semibold text-foreground",
                      ALIGN_CLS[cols[ci] ?? "left"],
                      bodyCells.length === 0 && "border-b-0"
                    )}
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyCells.map((row, ri) => (
                <tr
                  key={ri}
                  className="transition-colors even:bg-table-stripe hover:bg-accent-soft/60 [&:last-child>td]:border-b-0"
                >
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className={cn(
                        CELL,
                        "align-top text-foreground/90",
                        ALIGN_CLS[cols[ci] ?? "left"],
                        cols[ci] === "right" && "whitespace-nowrap"
                      )}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Toolbar pill toggle — shared look with ChartBlock's chart-type buttons. */
function ToolbarToggle({
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
        "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-accent-soft text-accent-strong"
          : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"
      )}
    >
      <Icon size={14} className="shrink-0" aria-hidden />
      {label}
    </button>
  );
}
