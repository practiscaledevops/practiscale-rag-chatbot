// Pure helpers for turning a Markdown data table into chart series.
//
// IMPORTANT: this module must NOT import recharts (or anything heavy). It is
// imported STATICALLY by TableBlock to decide whether to offer a chart toggle;
// the actual chart (ChartBlock, which pulls in recharts) is loaded lazily only
// when a user opens it. Keeping these helpers here is what keeps recharts out of
// the chat route's first-load bundle.
//
// Validated-data-only: these functions read the EXACT cell strings of a grounded
// table and never synthesise values.

/** Parse a table cell into a number, tolerating $, %, commas and spaces. */
export function toNumber(cell: string): number | null {
  if (cell == null) return null;
  const cleaned = cell.replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Whether a column is numeric: most of its non-empty cells parse as numbers. */
export function isNumericColumn(rows: string[][], col: number): boolean {
  let total = 0;
  let numeric = 0;
  for (const r of rows) {
    const v = (r[col] ?? "").trim();
    if (v === "") continue;
    total++;
    if (toNumber(v) !== null) numeric++;
  }
  return total > 0 && numeric / total >= 0.6;
}

export interface ChartModel {
  /** Indices of the numeric columns to plot. */
  valueCols: number[];
  /** Index of the category (x-axis / label) column. */
  catCol: number;
}

/** Decide which columns are the category vs the numeric series. */
export function chartModel(headers: string[], rows: string[][]): ChartModel {
  const numericCols = headers.map((_, i) => i).filter((i) => isNumericColumn(rows, i));
  const categoryCol = headers.findIndex((_, i) => !numericCols.includes(i));
  const catCol = categoryCol === -1 ? 0 : categoryCol;
  const valueCols = numericCols.filter((i) => i !== catCol);
  return { valueCols, catCol };
}

/**
 * Whether a table can be charted at all: at least one numeric column that isn't
 * the category column, and at least one data row.
 */
export function hasChartableData(headers: string[], rows: string[][]): boolean {
  if (rows.length === 0 || headers.length < 2) return false;
  return chartModel(headers, rows).valueCols.length > 0;
}
