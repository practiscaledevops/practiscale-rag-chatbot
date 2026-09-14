// Conversation / answer exporters — Markdown, PDF, Word (.docx), CSV, Excel (.xlsx).
//
// Everything runs in the BROWSER. The heavy libraries (docx, jspdf, xlsx) are
// pulled in with dynamic import() ONLY when the user actually exports, so they
// never weigh down the main bundle or time-to-first-token. CSV and Markdown are
// dependency-free. All exporters funnel through download().

export interface ExportMessage {
  role: "user" | "assistant" | "system" | "data";
  content: string;
}

export interface SimpleTable {
  headers: string[];
  rows: string[][];
}

/** Trigger a browser download of a Blob under `filename`. */
function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A filesystem-safe base name from a conversation title. */
export function safeName(title: string | null | undefined): string {
  return (title || "conversation").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "conversation";
}

/** Strip the machine-readable ```options block from an answer for clean export. */
function stripOptions(content: string): string {
  return content.replace(/```options[\s\S]*?```/g, "").trim();
}

const roleLabel = (r: ExportMessage["role"]) => (r === "user" ? "You" : "Assistant");

/** Keep only the user/assistant turns, options stripped. */
function cleanTurns(messages: ExportMessage[]): { role: string; text: string }[] {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: roleLabel(m.role), text: stripOptions(m.content) }));
}

// --- Markdown --------------------------------------------------------------

export function exportMarkdown(title: string | null, messages: ExportMessage[]): void {
  const body = cleanTurns(messages)
    .map((t) => `## ${t.role}\n\n${t.text}`)
    .join("\n\n---\n\n");
  const doc = `# ${title || "Conversation"}\n\n${body}\n`;
  download(new Blob([doc], { type: "text/markdown;charset=utf-8" }), `${safeName(title)}.md`);
}

// --- Table extraction (for CSV / Excel) ------------------------------------

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isTableSep = (l: string) => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(l) && l.includes("-");

function splitRow(line: string): string[] {
  let l = line.trim();
  if (l.startsWith("|")) l = l.slice(1);
  if (l.endsWith("|")) l = l.slice(0, -1);
  return l.split("|").map((c) => c.trim().replace(/\\\|/g, "|"));
}

/** Pull every GFM table out of a block of markdown text. */
export function extractTables(markdown: string): SimpleTable[] {
  const lines = stripOptions(markdown).split("\n");
  const tables: SimpleTable[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isTableRow(lines[i]) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const headers = splitRow(lines[i]);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) {
        const cells = splitRow(lines[i]);
        // Normalise ragged rows to the header width.
        rows.push(headers.map((_, ci) => cells[ci] ?? ""));
        i++;
      }
      i--;
      if (headers.length) tables.push({ headers, rows });
    }
  }
  return tables;
}

/** Every table across all assistant answers in the conversation. */
export function tablesFrom(messages: ExportMessage[]): SimpleTable[] {
  return messages
    .filter((m) => m.role === "assistant")
    .flatMap((m) => extractTables(m.content));
}

// --- CSV (dependency-free) -------------------------------------------------

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Export tabular data as CSV. Uses the conversation's tables when present;
 * otherwise falls back to a Role/Message transcript so the button always works.
 */
export function exportCsv(title: string | null, messages: ExportMessage[]): void {
  const tables = tablesFrom(messages);
  let csv: string;
  if (tables.length > 0) {
    csv = tables
      .map((t) =>
        [t.headers, ...t.rows].map((row) => row.map(csvCell).join(",")).join("\r\n")
      )
      .join("\r\n\r\n");
  } else {
    const turns = cleanTurns(messages);
    csv = [["Role", "Message"], ...turns.map((t) => [t.role, t.text])]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");
  }
  // BOM so Excel reads UTF-8 correctly.
  download(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), `${safeName(title)}.csv`);
}

// --- Excel (.xlsx via SheetJS, dynamic import) -----------------------------

export async function exportXlsx(title: string | null, messages: ExportMessage[]): Promise<void> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const tables = tablesFrom(messages);
  if (tables.length > 0) {
    tables.forEach((t, idx) => {
      const ws = XLSX.utils.aoa_to_sheet([t.headers, ...t.rows]);
      XLSX.utils.book_append_sheet(wb, ws, `Table ${idx + 1}`.slice(0, 31));
    });
  } else {
    const turns = cleanTurns(messages);
    const ws = XLSX.utils.aoa_to_sheet([["Role", "Message"], ...turns.map((t) => [t.role, t.text])]);
    XLSX.utils.book_append_sheet(wb, ws, "Conversation");
  }
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  download(
    new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${safeName(title)}.xlsx`
  );
}

// --- Word (.docx via the docx library, dynamic import) ---------------------

export async function exportDocx(title: string | null, messages: ExportMessage[]): Promise<void> {
  const docx = await import("docx");
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = docx;
  const turns = cleanTurns(messages);

  const children = [
    new Paragraph({ text: title || "Conversation", heading: HeadingLevel.TITLE }),
  ];
  for (const t of turns) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 60 },
        children: [new TextRun({ text: t.role, bold: true })],
      })
    );
    // One paragraph per non-empty line; keep it simple and readable.
    for (const line of t.text.split("\n")) {
      const trimmed = line.replace(/\s+$/, "");
      if (trimmed.trim() === "") continue;
      children.push(new Paragraph({ children: [new TextRun(trimmed)] }));
    }
  }

  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  download(blob, `${safeName(title)}.docx`);
}

// --- PDF (.pdf via jsPDF, dynamic import) ----------------------------------

export async function exportPdf(title: string | null, messages: ExportMessage[]): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 48;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = pageWidth - margin * 2;
  let y = margin;

  const addLines = (text: string, size: number, bold: boolean, gap: number) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(text, maxWidth) as string[];
    for (const ln of lines) {
      if (y > pageHeight - margin) {
        doc.addPage();
        y = margin;
      }
      doc.text(ln, margin, y);
      y += size * 1.35;
    }
    y += gap;
  };

  addLines(title || "Conversation", 18, true, 12);
  for (const t of cleanTurns(messages)) {
    addLines(t.role, 12, true, 4);
    // Strip heading/bullet markers for cleaner plain-text PDF flow.
    const clean = t.text.replace(/^#{1,6}\s+/gm, "").replace(/^\s*[-*]\s+/gm, "• ");
    addLines(clean, 11, false, 12);
  }

  doc.save(`${safeName(title)}.pdf`);
}
