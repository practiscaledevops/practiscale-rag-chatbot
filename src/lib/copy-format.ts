// Copy-friendly answers: turn an assistant's Markdown into clean plain text (for
// chat apps, plain editors and spreadsheet cells) and into safe, lightly styled
// HTML (so tables, lists and emphasis survive a paste into Word, Google Docs or
// Gmail), and put BOTH flavours on the clipboard in a single write.
//
// Pure string functions with no React and no DOM access at import time, so they
// are unit-tested in node (test/copy-format.test.ts) and shared with the chat's
// Markdown renderer (the list / table helpers at the bottom), which keeps what a
// user copies structurally identical to what they see.
//
// SECURITY: answer text is data, never markup. Every piece of text is
// HTML-escaped, raw HTML in the Markdown is NOT passed through (it comes out as
// visible, escaped text), and links are only emitted for http(s) / mailto URLs.

export type TableAlign = "left" | "center" | "right";

/** One list item: inline Markdown (continuation lines joined by "\n") plus nested lists. */
export interface MdListItem {
  text: string;
  children: MdList[];
}

/** A (possibly nested) Markdown list. `start` is the first number of an ordered list. */
export interface MdList {
  ordered: boolean;
  start: number;
  items: MdListItem[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Markdown → readable plain text with no Markdown syntax left: headings become
 * plain lines, bullets "• ", ordered items "1. ", tables tab-separated rows
 * (header first) so they paste into spreadsheet cells, links "text (url)".
 * Citation markers ([a1b2c3d4], [12]) and the ```options choice block are
 * removed; blank lines are normalised.
 */
export function markdownToPlainText(md: string): string {
  // Blocks are already trimmed; only drop blank lines at the edges, so a code
  // block's leading indent and a table's trailing empty cell (tab) survive.
  return parseBlocks(prepare(md))
    .map(blockToPlain)
    .filter((s) => s.trim() !== "")
    .join("\n\n")
    .replace(/^(?:[ \t]*\n)+/, "")
    .replace(/(?:\n[ \t]*)+$/, "");
}

/**
 * Markdown → a safe HTML fragment (<p>, <strong>, <em>, <code>, <pre>, lists,
 * <h1>-<h4>, <blockquote>, <a href>, <table>) with simple inline styles so a
 * pasted table keeps visible borders in Word / Google Docs / Gmail. All text is
 * escaped; raw HTML is never passed through.
 */
export function markdownToHtml(md: string): string {
  return parseBlocks(prepare(md)).map(blockToHtml).join("");
}

/**
 * Copy an answer to the clipboard as rich HTML + plain text. Resolves true on
 * success, false otherwise; never throws.
 */
export async function copyMarkdown(md: string): Promise<boolean> {
  try {
    // Build both flavours synchronously, before the first await, so the write
    // still happens inside the click's user activation (Safari requires it).
    return await writeRichClipboard(markdownToHtml(md), markdownToPlainText(md));
  } catch {
    return false;
  }
}

/**
 * Copy one table: HTML (pastes as a real table into Word / Docs) plus TSV (pastes
 * into Excel / Sheets cells). Cells are the raw Markdown cell strings. Never throws.
 */
export async function copyTable(
  headers: string[],
  rows: string[][],
  align?: (TableAlign | null)[]
): Promise<boolean> {
  try {
    return await writeRichClipboard(tableToHtml(headers, rows, align), tableToTsv(headers, rows));
  } catch {
    return false;
  }
}

/**
 * Write text/html + text/plain in one clipboard item, falling back to
 * writeText(text) when ClipboardItem / clipboard.write is unavailable or the
 * rich write is refused. Resolves true on success; never throws.
 */
export async function writeRichClipboard(html: string, text: string): Promise<boolean> {
  try {
    const clip = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
    if (!clip) return false;
    if (typeof ClipboardItem !== "undefined" && typeof clip.write === "function") {
      try {
        await clip.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([text], { type: "text/plain" }),
          }),
        ]);
        return true;
      } catch {
        // e.g. a browser that refuses text/html items: plain text still helps.
      }
    }
    if (typeof clip.writeText !== "function") return false;
    await clip.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** A table as TSV: header row first, cells as plain text (no tabs / newlines inside). */
export function tableToTsv(headers: string[], rows: string[][]): string {
  const cell = (c: string) => inlineToPlain(c).replace(/[\t\r\n]+/g, " ").replace(/ {2,}/g, " ").trim();
  return [headers, ...rows.map((r) => headers.map((_, i) => r[i] ?? ""))]
    .map((r) => r.map(cell).join("\t"))
    .join("\n");
}

/** A table as a bordered HTML <table> (header row shaded, numeric columns right-aligned). */
export function tableToHtml(
  headers: string[],
  rows: string[][],
  align?: (TableAlign | null)[]
): string {
  const cols = resolveColumnAlign(rows, headers.length, align);
  const cell = (tag: "th" | "td", text: string, i: number) => {
    const a = cols[i] ?? "left";
    const style = `${tag === "th" ? TH_STYLE : TD_STYLE};text-align:${a}`;
    return `<${tag} style="${style}">${inlineToHtml(text)}</${tag}>`;
  };
  const head = `<thead><tr>${headers.map((h, i) => cell("th", h, i)).join("")}</tr></thead>`;
  const body = rows
    .map((r) => `<tr>${headers.map((_, i) => cell("td", r[i] ?? "", i)).join("")}</tr>`)
    .join("");
  return `<table style="${TABLE_STYLE}">${head}<tbody>${body}</tbody></table>`;
}

// ---------------------------------------------------------------------------
// Table helpers (shared with the chat's table renderer)
// ---------------------------------------------------------------------------

/** Split a `| a | b |` row into trimmed cells; `\|` is a literal pipe inside a cell. */
export function splitTableRow(line: string): string[] {
  let l = line.trim();
  if (l.startsWith("|")) l = l.slice(1);
  if (l.endsWith("|") && !l.endsWith("\\|")) l = l.slice(0, -1);
  return l.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

/** Column alignment from a GFM separator row (`:--`, `:-:`, `--:`); null = unspecified. */
export function parseTableAlign(separator: string): (TableAlign | null)[] {
  return splitTableRow(separator).map((c) => {
    const s = c.replace(/\s+/g, "");
    const left = s.startsWith(":");
    const right = s.endsWith(":") && s.length > 1;
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return null;
  });
}

// Placeholders that shouldn't stop a column from reading as numeric.
const PLACEHOLDER_RE = /^(?:[-–—?]|n\/?a|tbd|none|nil)$/i;
// A single number, optionally with sign, currency, thousands separators,
// decimals, unit suffix (%, k, M, bn, x) or accounting parentheses.
const NUMERIC_CELL_RE =
  /^[~≈<>≤≥]?\s?(?:[A-Z]{3}\s?|Rs\.?\s?)?\(?[+\-−]?\s?[$€£¥₹]?\s?[+\-−]?\d[\d,]*(?:\.\d+)?\s?(?:%|‰|[kKmMbB]|bn|mn|x|×)?\+?\)?(?:\s?[A-Z]{3})?$/;

/** Strip inline Markdown / citation markers from a cell, for classifying its value. */
function bareCell(cell: string): string {
  return cell
    .replace(CITE_RUN_RE_SINGLE, "")
    .replace(/\*\*|__|`|~~/g, "")
    .replace(/^[*_](.*)[*_]$/, "$1")
    .trim();
}

/** Whether a table cell holds a single number / amount / percentage (e.g. "$1,200", "-3.5%", "12k"). */
export function isNumericCell(cell: string): boolean {
  return NUMERIC_CELL_RE.test(bareCell(cell));
}

/**
 * Final alignment per column: an explicit GFM alignment wins; otherwise a column
 * whose every non-empty body cell is numeric is right-aligned. The first column
 * (usually the row label, e.g. a year or rank) stays left unless explicit.
 */
export function resolveColumnAlign(
  rows: string[][],
  columnCount: number,
  explicit?: (TableAlign | null)[]
): TableAlign[] {
  return Array.from({ length: columnCount }, (_, c) => {
    const e = explicit?.[c];
    if (e) return e;
    if (c === 0) return "left";
    let numeric = 0;
    for (const r of rows) {
      const v = bareCell(r[c] ?? "");
      if (v === "" || PLACEHOLDER_RE.test(v)) continue;
      if (!NUMERIC_CELL_RE.test(v)) return "left";
      numeric++;
    }
    return numeric > 0 ? "right" : "left";
  });
}

// ---------------------------------------------------------------------------
// List helpers (shared with the chat's Markdown renderer)
// ---------------------------------------------------------------------------

/** A list item line: indent, marker (-, *, +, 1., 1)) and the item text. */
export const LIST_ITEM_RE = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;

const indentWidth = (s: string) => s.replace(/\t/g, "    ").length;

function newList(marker: string): MdList {
  const ordered = /^\d/.test(marker);
  return { ordered, start: ordered ? parseInt(marker, 10) : 1, items: [] };
}

/**
 * Parse a run of list lines beginning at `start` (which must be a list item)
 * into a nested list: an item indented 2+ spaces deeper than its predecessor
 * nests under it, and indented non-item lines continue the previous item.
 * Stops at a blank line, an unindented non-item line, or any line `breaks`
 * reports as the start of another block (heading, quote, rule, table).
 * Always consumes at least the first line, so a caller's loop always progresses.
 */
export function parseListRun(
  lines: string[],
  start: number,
  breaks: (line: string) => boolean = () => false
): { list: MdList; end: number } {
  const first = LIST_ITEM_RE.exec(lines[start]) ?? ["", "", "-", lines[start].trim()];
  const root = newList(first[2]);
  root.items.push({ text: first[3], children: [] });
  const stack: { indent: number; list: MdList }[] = [{ indent: indentWidth(first[1]), list: root }];

  let i = start + 1;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "" || breaks(line)) break;
    const m = LIST_ITEM_RE.exec(line);
    if (m) {
      const indent = indentWidth(m[1]);
      const top = stack[stack.length - 1];
      if (indent >= top.indent + 2) {
        const child = newList(m[2]);
        top.list.items[top.list.items.length - 1].children.push(child);
        stack.push({ indent, list: child });
      } else {
        while (stack.length > 1 && indent < stack[stack.length - 1].indent - 1) stack.pop();
      }
      stack[stack.length - 1].list.items.push({ text: m[3], children: [] });
      i++;
      continue;
    }
    if (/^(?: {2,}|\t)\S/.test(line)) {
      // Continuation of the most recent item (always the last item of the top list).
      const items = stack[stack.length - 1].list.items;
      items[items.length - 1].text += `\n${line.trim()}`;
      i++;
      continue;
    }
    break;
  }
  return { list: root, end: i };
}

/** A GFM task item ("[ ] …" / "[x] …"): [whole marker, check char]. */
export const TASK_RE = /^\[( |x|X)\]\s+/;

// ---------------------------------------------------------------------------
// Block parsing
// ---------------------------------------------------------------------------

type Block =
  | { k: "h"; level: number; text: string }
  | { k: "p"; lines: string[] }
  | { k: "list"; list: MdList }
  | { k: "quote"; blocks: Block[] }
  | { k: "code"; code: string }
  | { k: "table"; header: string[]; align: (TableAlign | null)[]; rows: string[][] }
  | { k: "hr" };

const isRule = (l: string) => /^\s*([-*_])(\s*\1){2,}\s*$/.test(l);
const isHeading = (l: string) => /^#{1,6}\s+/.test(l);
const isQuote = (l: string) => /^\s*>/.test(l);
const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isTableSep = (l: string) => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(l) && l.includes("-");
const FENCE_RE = /^\s*(`{3,}|~{3,})([^`]*)$/;

/** Normalise newlines and drop the ```options choice block (closed or still open). */
function prepare(md: string): string {
  return (md ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/(^|\n)[ \t]*```options[^\n]*\n[\s\S]*?```[ \t]*(?=\n|$)/g, "$1")
    .replace(/(^|\n)[ \t]*```options[\s\S]*$/, "$1");
}

function parseBlocks(md: string, depth = 0): Block[] {
  const lines = md.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Fenced code (an unclosed fence runs to the end, like the renderer).
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const close = new RegExp(`^\\s*${fence[1][0] === "`" ? "`" : "~"}{${fence[1].length},}\\s*$`);
      const body: string[] = [];
      i++;
      while (i < lines.length && !close.test(lines[i])) body.push(lines[i++]);
      i++; // the closing fence (or past the end)
      blocks.push({ k: "code", code: body.join("\n") });
      continue;
    }

    if (isRule(line)) {
      blocks.push({ k: "hr" });
      i++;
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ k: "h", level: h[1].length, text: h[2].replace(/\s+#+\s*$/, "").trim() });
      i++;
      continue;
    }

    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = splitTableRow(line);
      const align = parseTableAlign(lines[i + 1]);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const cells = splitTableRow(lines[i]);
        rows.push(header.map((_, c) => cells[c] ?? ""));
        i++;
      }
      blocks.push({ k: "table", header, align, rows });
      continue;
    }

    if (LIST_ITEM_RE.test(line)) {
      const { list, end } = parseListRun(lines, i, (l) => isHeading(l) || isQuote(l) || isRule(l) || isTableRow(l) || FENCE_RE.test(l));
      blocks.push({ k: "list", list });
      i = end;
      continue;
    }

    if (isQuote(line)) {
      const inner: string[] = [];
      while (i < lines.length && isQuote(lines[i])) inner.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push(
        depth < 8
          ? { k: "quote", blocks: parseBlocks(inner.join("\n"), depth + 1) }
          : { k: "p", lines: inner }
      );
      continue;
    }

    // Paragraph: consecutive lines until a blank line or another block starts.
    const para = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !isHeading(lines[i]) &&
      !LIST_ITEM_RE.test(lines[i]) &&
      !isQuote(lines[i]) &&
      !isRule(lines[i]) &&
      !isTableRow(lines[i]) &&
      !FENCE_RE.test(lines[i])
    ) {
      para.push(lines[i++]);
    }
    blocks.push({ k: "p", lines: para });
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Inline parsing
// ---------------------------------------------------------------------------

type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "br" }
  | { t: "strong" | "em" | "del"; c: Inline[] }
  | { t: "link"; href: string | null; c: Inline[] };

// A citation id: a chunk uuid, the model's 8-hex shortening of one, or a short
// ordinal — the same ids the chat renders as source chips.
const CITE_ID =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{8}|\\d{1,3}";
// A run of citations ("[1]", "[1][2]", "[1], [2]") with the whitespace before it,
// never a link's text ("[12](https://…)").
const CITE_RUN = `\\s*\\[(?:${CITE_ID})\\](?:\\s*[,;]?\\s*\\[(?:${CITE_ID})\\])*(?!\\()`;
const CITE_RUN_RE_SINGLE = new RegExp(CITE_RUN, "g");

type RuleName =
  | "escape"
  | "code"
  | "br"
  | "image"
  | "link"
  | "autolink"
  | "cite"
  | "strongem"
  | "strong"
  | "del"
  | "em";

// Checked at each position; the earliest match wins, ties go to the earlier rule.
const INLINE_RULES: { name: RuleName; re: RegExp }[] = [
  { name: "escape", re: /\\([!-/:-@[-`{-~])/g },
  { name: "code", re: /(?<!`)(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g },
  { name: "br", re: /<br\s*\/?>/gi },
  { name: "image", re: /!\[([^\]\n]*)\]\(\s*<?([^\s)>]*)>?(?:\s+"[^"\n]*")?\s*\)/g },
  { name: "link", re: /\[([^\]\n]+)\]\(\s*<?([^\s)>]*)>?(?:\s+"[^"\n]*")?\s*\)/g },
  { name: "autolink", re: /<((?:https?:\/\/|mailto:)[^\s<>]+)>/gi },
  { name: "cite", re: new RegExp(CITE_RUN, "g") },
  { name: "strongem", re: /\*\*\*(?!\s)(.+?)(?<!\s)\*\*\*/g },
  { name: "strong", re: /\*\*(?!\s)(.+?)(?<!\s)\*\*(?!\*)|(?<![\w_])__(?!\s)(.+?)(?<!\s)__(?![\w_])/g },
  { name: "del", re: /~~(?!\s)(.+?)(?<!\s)~~/g },
  {
    name: "em",
    re: /(?<![*\\])\*(?![\s*])(.+?)(?<![\s*\\])\*(?!\*)|(?<![\w_\\])_(?![\s_])(.+?)(?<![\s_])_(?![\w_])/g,
  },
];

/** Only http(s) and mailto links survive; anything else (javascript:, data:, relative) is dropped. */
function safeUrl(url: string): string | null {
  const u = url.trim();
  return /^(?:https?:\/\/|mailto:)[^\s"'<>`\\]+$/i.test(u) ? u : null;
}

function parseInline(src: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  const text = (v: string) => {
    if (!v) return;
    const last = out[out.length - 1];
    if (last && last.t === "text") last.v += v;
    else out.push({ t: "text", v });
  };
  if (depth > 10) {
    text(src);
    return out;
  }

  // Cache each rule's next match: the leftmost match found from an earlier
  // position is still the leftmost from any later position up to its index.
  const next: (RegExpExecArray | null | undefined)[] = INLINE_RULES.map(() => undefined);
  let i = 0;
  while (i < src.length) {
    let best = -1;
    let bm: RegExpExecArray | null = null;
    for (let r = 0; r < INLINE_RULES.length; r++) {
      let m = next[r];
      if (m === undefined || (m !== null && m.index < i)) {
        const re = INLINE_RULES[r].re;
        re.lastIndex = i;
        m = re.exec(src);
        next[r] = m;
      }
      if (m && (bm === null || m.index < bm.index)) {
        best = r;
        bm = m;
      }
    }
    if (!bm || bm[0].length === 0) {
      text(src.slice(i));
      break;
    }
    text(src.slice(i, bm.index));

    switch (INLINE_RULES[best].name) {
      case "escape":
        text(bm[1]);
        break;
      case "code": {
        let v = bm[2];
        if (v.length > 2 && v.startsWith(" ") && v.endsWith(" ") && v.trim()) v = v.slice(1, -1);
        out.push({ t: "code", v });
        break;
      }
      case "br":
        out.push({ t: "br" });
        break;
      case "image":
        out.push({ t: "link", href: safeUrl(bm[2]), c: bm[1] ? [{ t: "text", v: bm[1] }] : [] });
        break;
      case "link":
        out.push({ t: "link", href: safeUrl(bm[2]), c: parseInline(bm[1], depth + 1) });
        break;
      case "autolink":
        out.push({
          t: "link",
          href: safeUrl(bm[1]),
          c: [{ t: "text", v: bm[1].replace(/^mailto:/i, "") }],
        });
        break;
      case "cite":
        break; // citation chips mean nothing outside the app
      case "strongem":
        out.push({ t: "strong", c: [{ t: "em", c: parseInline(bm[1], depth + 1) }] });
        break;
      case "strong":
        out.push({ t: "strong", c: parseInline(bm[1] ?? bm[2], depth + 1) });
        break;
      case "del":
        out.push({ t: "del", c: parseInline(bm[1], depth + 1) });
        break;
      case "em":
        out.push({ t: "em", c: parseInline(bm[1] ?? bm[2], depth + 1) });
        break;
    }
    i = bm.index + bm[0].length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Plain-text output
// ---------------------------------------------------------------------------

function nodesToPlain(nodes: Inline[]): string {
  let s = "";
  for (const n of nodes) {
    switch (n.t) {
      case "text":
      case "code":
        s += n.v;
        break;
      case "br":
        s += "\n";
        break;
      case "strong":
      case "em":
      case "del":
        s += nodesToPlain(n.c);
        break;
      case "link": {
        const label = nodesToPlain(n.c).trim();
        if (!n.href) {
          s += label;
          break;
        }
        const shown = n.href.replace(/^mailto:/i, "");
        s += !label || label === shown || label === n.href ? shown : `${label} (${shown})`;
        break;
      }
    }
  }
  return s;
}

/** One line (or cell) of inline Markdown → plain text. */
function inlineToPlain(src: string): string {
  return nodesToPlain(parseInline(src));
}

/** Plain-text lines: inline-converted, trimmed, with doubled spaces collapsed. */
function plainLines(lines: string[]): string {
  return lines
    .map((l) => inlineToPlain(l.trim()))
    .join("\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]{2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function listToPlain(list: MdList, indent: string): string[] {
  const out: string[] = [];
  let n = list.start;
  for (const item of list.items) {
    let marker = list.ordered ? `${n}. ` : "• ";
    n++;
    let text = item.text;
    const task = TASK_RE.exec(text);
    if (task) {
      marker = task[1] === " " ? "☐ " : "☑ ";
      text = text.slice(task[0].length);
    }
    const hang = indent + " ".repeat(marker.length);
    const body = plainLines(text.split("\n")).split("\n").filter((l) => l !== "");
    out.push(indent + marker + (body[0] ?? ""));
    for (const extra of body.slice(1)) out.push(hang + extra);
    for (const child of item.children) out.push(...listToPlain(child, hang));
  }
  return out;
}

function blockToPlain(b: Block): string {
  switch (b.k) {
    case "h":
      return plainLines([b.text]);
    case "p":
      return plainLines(b.lines);
    case "list":
      return listToPlain(b.list, "").join("\n");
    case "quote":
      return b.blocks.map(blockToPlain).filter((s) => s !== "").join("\n\n");
    case "code":
      return b.code.replace(/[ \t]+$/gm, "");
    case "table":
      return tableToTsv(b.header, b.rows);
    case "hr":
      return "";
  }
}

// ---------------------------------------------------------------------------
// HTML output
// ---------------------------------------------------------------------------

const MONO = "Consolas,Menlo,'Courier New',monospace";
const GRID = "#C9D8D2";
const TABLE_STYLE = `border-collapse:collapse;border:1px solid ${GRID}`;
const TH_STYLE = `border:1px solid ${GRID};background:#E6F7F1;color:#111315;font-weight:600;padding:6px 10px;vertical-align:bottom`;
const TD_STYLE = `border:1px solid ${GRID};padding:6px 10px;vertical-align:top`;
const CODE_STYLE = `font-family:${MONO};font-size:0.92em;background:#F5F6F6;padding:1px 4px;border-radius:4px`;
const PRE_STYLE = `font-family:${MONO};font-size:13px;line-height:1.5;background:#F5F6F6;border:1px solid #EAECEC;border-radius:8px;padding:10px 12px;white-space:pre-wrap`;
const QUOTE_STYLE = "margin:0;padding:0 0 0 12px;border-left:3px solid #10A388;color:#3F4447";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function nodesToHtml(nodes: Inline[]): string {
  let s = "";
  for (const n of nodes) {
    switch (n.t) {
      case "text":
        s += escapeHtml(n.v);
        break;
      case "code":
        s += `<code style="${CODE_STYLE}">${escapeHtml(n.v)}</code>`;
        break;
      case "br":
        s += "<br>";
        break;
      case "strong":
      case "em":
      case "del":
        s += `<${n.t}>${nodesToHtml(n.c)}</${n.t}>`;
        break;
      case "link": {
        const inner = nodesToHtml(n.c) || (n.href ? escapeHtml(n.href.replace(/^mailto:/i, "")) : "");
        s += n.href ? `<a href="${escapeHtml(n.href)}">${inner}</a>` : inner;
        break;
      }
    }
  }
  return s;
}

/** Inline Markdown (may span lines) → escaped HTML; line breaks become <br>. */
function inlineToHtml(src: string): string {
  return src
    .split("\n")
    .map((l) => nodesToHtml(parseInline(l.trim())).replace(/\s{2,}/g, " ").trim())
    .join("<br>");
}

function listToHtml(list: MdList): string {
  const tag = list.ordered ? "ol" : "ul";
  const start = list.ordered && list.start !== 1 ? ` start="${list.start}"` : "";
  const items = list.items
    .map((item) => {
      let text = item.text;
      let box = "";
      const task = TASK_RE.exec(text);
      if (task) {
        box = task[1] === " " ? "☐ " : "☑ ";
        text = text.slice(task[0].length);
      }
      return `<li>${box}${inlineToHtml(text)}${item.children.map(listToHtml).join("")}</li>`;
    })
    .join("");
  return `<${tag}${start}>${items}</${tag}>`;
}

function blockToHtml(b: Block): string {
  switch (b.k) {
    case "h": {
      const level = Math.min(b.level, 4);
      return `<h${level}>${inlineToHtml(b.text)}</h${level}>`;
    }
    case "p":
      return `<p>${inlineToHtml(b.lines.join("\n"))}</p>`;
    case "list":
      return listToHtml(b.list);
    case "quote":
      return `<blockquote style="${QUOTE_STYLE}">${b.blocks.map(blockToHtml).join("")}</blockquote>`;
    case "code":
      return `<pre style="${PRE_STYLE}"><code>${escapeHtml(b.code)}</code></pre>`;
    case "table":
      return tableToHtml(b.header, b.rows, b.align);
    case "hr":
      return "<hr>";
  }
}
