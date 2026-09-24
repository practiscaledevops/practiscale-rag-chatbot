// Clean clipboard for text a user SELECTS and copies (Ctrl+C / right-click →
// Copy) in the chat thread.
//
// Browsers serialize a selection with its COMPUTED styles inlined, so a
// selection made in the dark theme pastes into Docs / Word / Gmail as light
// text on a near-black block (and in light mode drags along fonts, sizes and
// spacing). This rebuilds both clipboard flavours from the selected DOM:
//   • text/html  — structure only (headings, paragraphs, lists, emphasis, code,
//                  links, tables with light borders), no colours or fonts;
//   • text/plain — readable text, lists as "• " items, tables as TSV.
// UI chrome inside the selection (buttons, icons, citation chips, anything
// marked aria-hidden or data-copy-ignore) is left out.
//
// Whitespace-significant content — code blocks (<pre>) and the user's own
// multi-line prompts (Tailwind whitespace-pre-wrap) — is copied VERBATIM:
// newlines and indentation survive in both flavours.
//
// Written against a minimal node interface so it runs in unit tests without a
// DOM; the browser's Node satisfies it.

export interface CopyNode {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: ArrayLike<CopyNode>;
  getAttribute?: (name: string) => string | null;
  className?: unknown;
}

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
const FRAGMENT_NODE = 11;

/** Tags kept (attributes stripped except the few below). */
const KEEP = new Set([
  "P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "STRONG", "B", "EM", "I", "DEL", "S",
  "CODE", "PRE", "BLOCKQUOTE", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "A", "BR", "HR",
]);
/** Dropped with their contents: controls, icons, media, citation chips. */
const DROP = new Set([
  "BUTTON", "SVG", "PATH", "SCRIPT", "STYLE", "INPUT", "TEXTAREA", "SELECT", "OPTION", "CANVAS", "IMG",
  "VIDEO", "AUDIO", "SUP", "NOSCRIPT", "TEMPLATE", "LABEL",
]);
/** Elements that start a new line in the plain-text flavour. */
const BLOCK = new Set([
  "P", "DIV", "SECTION", "ARTICLE", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "PRE",
  "BLOCKQUOTE", "TABLE", "THEAD", "TBODY", "TR", "HR", "HEADER", "FOOTER", "FIGURE",
]);

const BORDER = "1px solid #C9D8D2";
const CELL = `border:${BORDER};padding:6px 10px;vertical-align:top`;
const MONO = "font-family:Consolas,Menlo,monospace";
const PRE_STYLE = `${MONO};white-space:pre-wrap`;

/** Private-use sentinels around verbatim text in the plain flavour, so tidy() leaves it alone. */
const PO = "";
const PC = "";

function tag(n: CopyNode): string {
  return n.nodeName.toUpperCase();
}

function attr(n: CopyNode, name: string): string | null {
  try {
    return n.getAttribute ? n.getAttribute(name) : null;
  } catch {
    return null;
  }
}

function classes(n: CopyNode): string {
  const c = n.className as unknown;
  if (typeof c === "string") return c;
  // SVG elements expose an SVGAnimatedString.
  if (c && typeof c === "object" && "baseVal" in (c as Record<string, unknown>)) {
    return String((c as { baseVal: unknown }).baseVal ?? "");
  }
  return "";
}

function ignored(n: CopyNode): boolean {
  if (n.nodeType !== ELEMENT_NODE) return false;
  return DROP.has(tag(n)) || attr(n, "aria-hidden") === "true" || attr(n, "data-copy-ignore") !== null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function safeHref(href: string | null): string | null {
  if (!href) return null;
  const h = href.trim();
  return /^(https?:|mailto:)/i.test(h) ? h : null;
}

function kids(n: CopyNode): CopyNode[] {
  return Array.from(n.childNodes ?? []);
}

/** Whether an element keeps its whitespace (Tailwind whitespace-pre / -pre-wrap / -pre-line). */
function preformattedClass(n: CopyNode): boolean {
  return n.nodeType === ELEMENT_NODE && /\bwhitespace-pre(?:-wrap|-line)?\b/.test(classes(n));
}

/** Text exactly as written (no whitespace collapsing), skipping UI chrome. */
function rawText(n: CopyNode): string {
  if (n.nodeType === TEXT_NODE) return n.textContent ?? "";
  if (n.nodeType !== ELEMENT_NODE && n.nodeType !== FRAGMENT_NODE) return "";
  if (ignored(n)) return "";
  if (n.nodeType === ELEMENT_NODE && tag(n) === "BR") return "\n";
  return kids(n).map(rawText).join("");
}

/** Leading/trailing blank lines off (never a first line's indentation). */
function trimLines(s: string): string {
  return s.replace(/^(?:[ \t]*\n)+/, "").replace(/\n[\s]*$/, "");
}

/** Multi-line prose as one HTML paragraph with explicit line breaks (Docs/Word ignore pre-wrap). */
function lineBrokenHtml(s: string): string {
  return `<p>${escapeHtml(s).replace(/\n/g, "<br>")}</p>`;
}

// ---------------------------------------------------------------- HTML

function toHtml(n: CopyNode): string {
  if (n.nodeType === TEXT_NODE) return escapeHtml(n.textContent ?? "");
  if (n.nodeType !== ELEMENT_NODE && n.nodeType !== FRAGMENT_NODE) return "";
  if (ignored(n)) return "";
  const inner = kids(n).map(toHtml).join("");
  if (n.nodeType === FRAGMENT_NODE) return inner;

  const t = tag(n);
  // A user's multi-line prompt (whitespace-pre-wrap): keep its line breaks.
  if (t !== "PRE" && preformattedClass(n)) return lineBrokenHtml(trimLines(rawText(n)));
  if (!KEEP.has(t)) return inner; // unwrap div/span/section…
  const name = t.toLowerCase();
  if (t === "BR") return "<br>";
  if (t === "HR") return `<hr style="border:none;border-top:${BORDER}">`;
  if (t === "A") {
    const href = safeHref(attr(n, "href"));
    return href ? `<a href="${escapeHtml(href)}">${inner}</a>` : inner;
  }
  if (t === "OL") {
    const start = Number(attr(n, "start"));
    return Number.isInteger(start) && start > 1 ? `<ol start="${start}">${inner}</ol>` : `<ol>${inner}</ol>`;
  }
  if (t === "TABLE") return `<table style="border-collapse:collapse;border:${BORDER}">${inner}</table>`;
  if (t === "TH" || t === "TD") {
    const right = /\btext-right\b/.test(classes(n)) || attr(n, "align") === "right";
    const head = t === "TH" ? ";background:#E6F7F1;font-weight:600" : "";
    return `<${name} style="${CELL}${head}${right ? ";text-align:right" : ""}">${inner}</${name}>`;
  }
  if (t === "BLOCKQUOTE") return `<blockquote style="border-left:3px solid #10A388;margin:0;padding-left:10px">${inner}</blockquote>`;
  if (t === "CODE") return `<code style="${MONO}">${inner}</code>`;
  if (t === "PRE") return `<pre style="${PRE_STYLE}">${inner}</pre>`;
  return `<${name}>${inner}</${name}>`;
}

// ---------------------------------------------------------------- plain text

function cellText(n: CopyNode): string {
  return toText(n).replace(/[]/g, "").replace(/\s+/g, " ").trim();
}

/** A verbatim block in the plain flavour, fenced by the sentinels tidy() skips. */
function verbatim(s: string): string {
  return `\n\n${PO}${trimLines(s)}${PC}\n\n`;
}

function toText(n: CopyNode, listDepth = 0): string {
  if (n.nodeType === TEXT_NODE) return (n.textContent ?? "").replace(/\s+/g, " ");
  if (n.nodeType !== ELEMENT_NODE && n.nodeType !== FRAGMENT_NODE) return "";
  if (ignored(n)) return "";
  const t = n.nodeType === FRAGMENT_NODE ? "#FRAGMENT" : tag(n);

  if (t === "BR") return "\n";
  if (t === "HR") return "\n\n";
  // Code blocks and whitespace-pre* text keep their newlines and indentation.
  if (t === "PRE" || preformattedClass(n)) return verbatim(rawText(n));
  if (t === "TABLE" || t === "THEAD" || t === "TBODY") {
    return `\n\n${rowsOf(n).join("\n")}\n\n`;
  }
  if (t === "TR") return `\n${rowCells(n).join("\t")}\n`;
  if (t === "UL" || t === "OL") {
    let i = Number(attr(n, "start"));
    if (!Number.isInteger(i) || i < 1) i = 1;
    const indent = "  ".repeat(listDepth);
    const items = kids(n)
      .filter((c) => c.nodeType === ELEMENT_NODE && tag(c) === "LI" && !ignored(c))
      .map((li) => {
        const marker = t === "OL" ? `${i++}. ` : "• ";
        const body = kids(li)
          .map((c) => toText(c, listDepth + 1))
          .join("")
          .replace(/\n{2,}/g, "\n")
          .trim();
        return `${indent}${marker}${body}`;
      });
    return `\n${items.join("\n")}\n`;
  }

  const inner = kids(n).map((c) => toText(c, listDepth)).join("");
  if (t === "LI") return `\n• ${inner.trim()}\n`;
  if (t === "TD" || t === "TH") return inner;
  if (BLOCK.has(t)) return `\n\n${inner.trim()}\n\n`;
  return inner;
}

function rowCells(tr: CopyNode): string[] {
  return kids(tr)
    .filter((c) => c.nodeType === ELEMENT_NODE && (tag(c) === "TD" || tag(c) === "TH") && !ignored(c))
    .map(cellText);
}

function rowsOf(n: CopyNode): string[] {
  const out: string[] = [];
  for (const c of kids(n)) {
    if (c.nodeType !== ELEMENT_NODE || ignored(c)) continue;
    const t = tag(c);
    if (t === "TR") out.push(rowCells(c).join("\t"));
    else if (t === "THEAD" || t === "TBODY" || t === "TFOOT") out.push(...rowsOf(c));
  }
  return out;
}

function tidyProse(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    // Drop stray leading spaces, but keep nested list indentation.
    .replace(/\n( +)(\S)/g, (_m, sp: string, ch: string) => (/[•\d]/.test(ch) ? `\n${sp}${ch}` : `\n${ch}`))
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * Normalize the prose between verbatim blocks; the verbatim blocks (sentinel-
 * fenced by verbatim()) pass through untouched. Only the outer ends of the
 * whole text are trimmed, never a code block's indentation.
 */
function tidy(text: string): string {
  const parts = text.split(/([\s\S]*?)/);
  const last = parts.length - 1;
  return parts
    .map((p, i) => {
      if (i % 2 === 1) return p.slice(1, -1);
      let s = tidyProse(p);
      if (i === 0) s = s.replace(/^\s+/, "");
      if (i === last) s = s.replace(/\s+$/, "");
      return s;
    })
    .join("")
    .replace(/[]/g, "");
}

// ---------------------------------------------------------------- entry point

/**
 * Clean HTML + plain text for a copied selection. `context` names the
 * structure the selection sits inside (so a few copied table cells or list
 * items still paste as a table / list): "table-row" when the selection lies
 * within one row, "table" within a table, "ul"/"ol" within a list, "pre"
 * inside a code block and "pre-wrap" inside whitespace-significant text (a
 * user's multi-line prompt) — those two are copied verbatim.
 */
export function cleanClipboard(
  fragment: CopyNode,
  context: "table-row" | "table" | "ul" | "ol" | "pre" | "pre-wrap" | null = null
): { html: string; text: string } {
  if (context === "pre") {
    const raw = trimLines(rawText(fragment));
    return { html: `<pre style="${PRE_STYLE}"><code>${escapeHtml(raw)}</code></pre>`, text: raw };
  }
  if (context === "pre-wrap") {
    const raw = trimLines(rawText(fragment));
    return { html: lineBrokenHtml(raw), text: raw };
  }
  let html = toHtml(fragment);
  let text = toText(fragment);
  const top = kids(fragment).filter((c) => c.nodeType === ELEMENT_NODE);
  const topTags = new Set(top.map(tag));

  if (context === "table-row" && (topTags.has("TD") || topTags.has("TH"))) {
    html = `<table style="border-collapse:collapse;border:${BORDER}"><tr>${html}</tr></table>`;
    text = top.filter((c) => tag(c) === "TD" || tag(c) === "TH").map(cellText).join("\t");
  } else if (context === "table" && (topTags.has("TR") || topTags.has("TBODY") || topTags.has("THEAD"))) {
    html = `<table style="border-collapse:collapse;border:${BORDER}">${html}</table>`;
    text = rowsOf(fragment).join("\n");
  } else if ((context === "ul" || context === "ol") && topTags.has("LI")) {
    html = `<${context}>${html}</${context}>`;
    text = toText({ nodeType: ELEMENT_NODE, nodeName: context.toUpperCase(), textContent: null, childNodes: kids(fragment) });
  }
  return { html, text: tidy(text) };
}
