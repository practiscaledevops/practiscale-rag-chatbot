import { Fragment, memo, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  LIST_ITEM_RE,
  TASK_RE,
  parseListRun,
  parseTableAlign,
  splitTableRow,
  type MdList,
} from "@/lib/copy-format";
import { CopyCodeButton } from "./CopyCodeButton";
import { TableBlock } from "./TableBlock";

// No "use client": this is a pure, hook-free renderer, so it stays a shared
// component (rendered inside the client ChatView today, reusable server-side).

/**
 * A small, dependency-free Markdown renderer for assistant messages.
 *
 * Supports the subset a grounded chat needs: fenced code blocks (with a language
 * label + copy), headings (semantic h1-h6), nested ordered/unordered/task lists,
 * blockquotes, pipe tables (GFM alignment), horizontal rules, paragraphs, and
 * inline `code` / **bold** / *italic* / ~~strike~~ / links / [id] citation chips.
 * Everything renders as React elements (never dangerouslySetInnerHTML), so text
 * is always escaped: retrieved/model content is data, never markup. Links are
 * restricted to http(s)/mailto by the matching regex.
 *
 * Typography: font family, size and line-height are INHERITED from the
 * container (the chat wraps answers in font-serif or font-sans with its own
 * size/leading); headings and block rhythm are in em (the .md-flow rules in
 * globals.css), so everything scales with whatever the container sets. Code
 * stays mono and tables stay sans at a fixed size whatever the answer font.
 *
 * Citations: the Brain tags supporting chunks as [chunk-uuid]. We map each unique
 * id to a small ordinal ([1], [2], …) so answers read cleanly instead of showing
 * raw 36-char UUIDs; the full id stays in the chip's tooltip.
 *
 * Streaming cost: the content is split into top-level blocks (blank-line
 * separated, fenced code kept whole) and each block is a memoized component.
 * While an answer streams only the LAST block's text changes, so only that block
 * re-parses per update; every settled block is reused as-is. Without this a long
 * answer (a full training with tables) re-parsed all of its Markdown on every
 * frame — quadratic work that froze the tab and crashed it out of memory.
 */
export function Markdown({ content }: { content: string }) {
  const text = content.includes("\r") ? content.replace(/\r\n?/g, "\n") : content;
  // Citation ordinals are global to the answer (the first-seen id is [1], …).
  // They are passed to blocks as one string so memoized blocks compare cheaply.
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(CITE_RE)) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      ids.push(m[1]);
    }
  }
  const citeKey = ids.join(",");
  const blocks = splitBlocks(text);

  return (
    <div className="md-flow">
      {blocks.map((block, i) => (
        <MarkdownBlock key={i} text={block} citeKey={citeKey} />
      ))}
    </div>
  );
}

/** One top-level block, parsed once per distinct (text, citations) pair. */
const MarkdownBlock = memo(function MarkdownBlock({
  text,
  citeKey,
}: {
  text: string;
  citeKey: string;
}) {
  const citeMap = new Map<string, number>();
  if (citeKey) citeKey.split(",").forEach((id, i) => citeMap.set(id, i + 1));
  return <>{renderContent(text, citeMap)}</>;
});

/**
 * Split Markdown into top-level blocks on blank lines, never inside a fenced
 * code block. Every construct the parser knows (table, list, quote, paragraph,
 * heading, rule) is made of consecutive non-blank lines, so parsing the blocks
 * independently renders exactly what parsing the whole text would. An unclosed
 * fence (still streaming) keeps the rest of the text in one block.
 */
function splitBlocks(content: string): string[] {
  const lines = content.split("\n");
  const blocks: string[] = [];
  let cur: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      cur.push(line);
      continue;
    }
    if (!inFence && line.trim() === "") {
      if (cur.length > 0) {
        blocks.push(cur.join("\n"));
        cur = [];
      }
      continue;
    }
    cur.push(line);
  }
  if (cur.length > 0) blocks.push(cur.join("\n"));
  return blocks;
}

/** Parse a Markdown fragment (fenced code + everything the line parser knows) to nodes. */
function renderContent(content: string, citeMap: Map<string, number>): ReactNode[] {
  const blocks: ReactNode[] = [];
  let key = 0;

  // Split fenced code blocks out first so their contents are never parsed as
  // Markdown. Everything between fences goes through the line-based parser.
  const fence = /```(\w*)\n?([\s\S]*?)```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(content)) !== null) {
    if (match.index > cursor) {
      renderTextBlocks(content.slice(cursor, match.index), `b${key++}`, blocks, citeMap);
    }
    blocks.push(
      <CodeBlock key={`code-${key++}`} lang={match[1]} code={match[2].replace(/\n$/, "")} />
    );
    cursor = match.index + match[0].length;
  }
  if (cursor < content.length) {
    const rest = content.slice(cursor);
    // A fence whose closing ``` hasn't streamed in yet: show the code as a code
    // block while it arrives, instead of a paragraph of raw ``` text.
    const open = /(^|\n)[ \t]*```(\w*)[^\n`]*(?:\n|$)/.exec(rest);
    if (open) {
      if (open.index > 0) renderTextBlocks(rest.slice(0, open.index), `b${key++}`, blocks, citeMap);
      blocks.push(
        <CodeBlock key={`code-${key++}`} lang={open[2]} code={rest.slice(open.index + open[0].length)} />
      );
    } else {
      renderTextBlocks(rest, `b${key++}`, blocks, citeMap);
    }
  }
  return blocks;
}

// Sized relative to the answer body (em), so they follow the container's font
// size: clear steps for h1-h3, body-size semibold from h4 down.
const HEADING_CLS: Record<number, string> = {
  1: "text-[1.35em] font-semibold leading-[1.3] tracking-[-0.01em] text-foreground",
  2: "text-[1.2em] font-semibold leading-[1.3] tracking-[-0.005em] text-foreground",
  3: "text-[1.07em] font-semibold leading-[1.35] text-foreground",
  4: "text-[1em] font-semibold leading-[1.4] text-foreground",
  5: "text-[1em] font-semibold leading-[1.4] text-foreground/85",
  6: "text-[1em] font-semibold leading-[1.4] text-muted-foreground",
};

// Marker styles per nesting depth (cycled).
const BULLET_STYLE = ["list-disc", "list-[circle]", "list-[square]"];
const ORDERED_STYLE = ["list-decimal", "list-[lower-alpha]", "list-[lower-roman]"];

const isHeading = (l: string) => /^(#{1,6})\s+/.test(l);
const isListItem = (l: string) => LIST_ITEM_RE.test(l);
const isQuote = (l: string) => /^\s*>\s?/.test(l);
const isRule = (l: string) => /^\s*([-*_])(\s*\1){2,}\s*$/.test(l);
const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isTableSep = (l: string) => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(l) && l.includes("-");
// Lines that end a list run (anything else non-blank + indented continues it).
const breaksList = (l: string) => isHeading(l) || isQuote(l) || isRule(l) || isTableRow(l);

/** Parse a non-code chunk into headings, lists, tables, quotes, rules, paragraphs. */
function renderTextBlocks(
  text: string,
  keyBase: string,
  out: ReactNode[],
  citeMap: Map<string, number>,
  depth = 0
) {
  const lines = text.split("\n");
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    // Horizontal rule
    if (isRule(line)) {
      out.push(<hr key={`${keyBase}-hr${k++}`} className="border-border" />);
      i++;
      continue;
    }

    // Heading (# through ######) -> semantic h1-h6 (optional closing #s dropped)
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const key = `${keyBase}-h${k++}`;
      const Tag = `h${level}` as keyof React.JSX.IntrinsicElements;
      out.push(
        <Tag key={key} className={HEADING_CLS[level]}>
          {renderInline(h[2].replace(/\s+#+\s*$/, ""), key, citeMap)}
        </Tag>
      );
      i++;
      continue;
    }

    // Table: a header row, a separator row (with optional :alignment), then body rows.
    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = splitTableRow(line);
      const align = parseTableAlign(lines[i + 1]);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      // A body row still streaming in (no closing pipe yet) already renders in
      // the table rather than flashing underneath it as a paragraph.
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const cells = splitTableRow(lines[i]);
        const partial = !isTableRow(lines[i]);
        i++;
        if (partial && cells.every((c) => c === "")) continue;
        // Raw (unformatted) cell strings, for charting / copying the exact values shown.
        rows.push(header.map((_, ci) => cells[ci] ?? ""));
      }
      const key = `${keyBase}-t${k++}`;
      out.push(
        <TableBlock
          key={key}
          headers={header}
          rows={rows}
          align={align}
          headerCells={header.map((c, ci) => renderInline(c, `${key}-h${ci}`, citeMap))}
          bodyCells={rows.map((r, ri) =>
            r.map((c, ci) => renderInline(c, `${key}-${ri}-${ci}`, citeMap))
          )}
        />
      );
      continue;
    }

    // List (- * + bullets, 1. / 1) ordered, [ ] tasks), nested by indentation.
    if (isListItem(line)) {
      const { list, end } = parseListRun(lines, i, breaksList);
      i = end;
      out.push(renderList(list, `${keyBase}-l${k++}`, citeMap, 0));
      continue;
    }

    // Blockquote (its content is parsed as Markdown: paragraphs, lists, …)
    if (isQuote(line)) {
      const quote: string[] = [];
      while (i < lines.length && isQuote(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      const key = `${keyBase}-q${k++}`;
      const inner: ReactNode[] = [];
      if (depth < 6) renderTextBlocks(quote.join("\n"), key, inner, citeMap, depth + 1);
      else inner.push(<p key={`${key}-p`}>{renderLines(quote.join("\n"), key, citeMap)}</p>);
      out.push(
        <blockquote
          key={key}
          className="md-flow border-l-[3px] border-accent/70 pl-[0.9em] text-foreground/80"
        >
          {inner}
        </blockquote>
      );
      continue;
    }

    // Paragraph: gather consecutive non-blank, non-block lines. The current line
    // is ALWAYS consumed, even when it looks like a table row: a row-shaped line
    // that isn't a table (its `|---|` separator hasn't streamed in yet, or the
    // model wrote pipes without one) is plain text. Refusing it here consumed
    // nothing and spun this loop forever, pushing empty paragraphs until the tab
    // ran out of memory — every streamed table froze the chat at its header row.
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !isHeading(lines[i]) &&
      !isListItem(lines[i]) &&
      !isQuote(lines[i]) &&
      !isRule(lines[i]) &&
      !isTableRow(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    const key = `${keyBase}-p${k++}`;
    // An indented paragraph is a list item's continuation that a blank line
    // split off: keep it aligned with the item text above.
    out.push(
      /^(?: {2,}|\t)\S/.test(line) ? (
        <p key={key} className="pl-[1.5em]">
          {renderLines(para.join("\n"), key, citeMap)}
        </p>
      ) : (
        <p key={key}>{renderLines(para.join("\n"), key, citeMap)}</p>
      )
    );
  }
}

/** Render lines of inline Markdown, keeping the author's line breaks. */
function renderLines(text: string, key: string, citeMap: Map<string, number>): ReactNode[] {
  return text.split("\n").map((l, idx) => (
    <Fragment key={`${key}-${idx}`}>
      {idx > 0 && <br />}
      {renderInline(l.trim(), `${key}-${idx}`, citeMap)}
    </Fragment>
  ));
}

/** A (nested) list. All-task lists render as a checklist. */
function renderList(
  list: MdList,
  key: string,
  citeMap: Map<string, number>,
  depth: number
): ReactNode {
  const nested = depth > 0 && "mt-[0.3em]";
  const children = (items: MdList[], itemKey: string) =>
    items.map((child, ci) => renderList(child, `${itemKey}-c${ci}`, citeMap, depth + 1));

  // GFM task list: every item is "[ ] …" or "[x] …" → render as a checklist.
  const tasks = list.items.map((it) => TASK_RE.exec(it.text));
  if (tasks.every(Boolean)) {
    return (
      <ul key={key} className={cn("space-y-[0.3em]", nested)}>
        {list.items.map((it, idx) => {
          const m = tasks[idx]!;
          const checked = m[1].toLowerCase() === "x";
          const itemKey = `${key}-${idx}`;
          return (
            <li key={itemKey} className="flex items-start gap-[0.55em]">
              <span
                aria-hidden
                className={cn(
                  "mt-[0.5em] grid h-[1.45em] w-[1.45em] shrink-0 place-items-center rounded-[0.3em] border font-sans text-[0.7em] leading-none",
                  checked
                    ? "border-accent bg-accent-soft text-accent-strong"
                    : "border-border text-transparent"
                )}
              >
                ✓
              </span>
              <div className="min-w-0 flex-1">
                <span className={checked ? "text-muted-foreground line-through" : undefined}>
                  {renderLines(it.text.slice(m[0].length), itemKey, citeMap)}
                </span>
                {children(it.children, itemKey)}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  const cls = cn(
    "space-y-[0.3em] pl-[1.5em] marker:text-muted-foreground",
    (list.ordered ? ORDERED_STYLE : BULLET_STYLE)[depth % 3],
    nested
  );
  const items = list.items.map((it, idx) => {
    const itemKey = `${key}-${idx}`;
    return (
      <li key={itemKey} className="pl-[0.2em]">
        {renderLines(it.text, itemKey, citeMap)}
        {children(it.children, itemKey)}
      </li>
    );
  });
  // A loose ordered list arrives as separate blocks ("1." … blank … "2."): keep
  // the author's numbering instead of restarting every block at 1.
  return list.ordered ? (
    <ol key={key} start={list.start !== 1 ? list.start : undefined} className={cls}>
      {items}
    </ol>
  ) : (
    <ul key={key} className={cls}>
      {items}
    </ul>
  );
}

// A citation id: a chunk UUID, or a short ordinal number. Kept strict so stray
// bracketed text (e.g. [TODO], [x], [0-9] array indices in prose) is NOT chipped.
// A full chunk uuid, the model's 8-char shortening of one ([018d99c0]), or a
// short ordinal. Long answers routinely shorten ids, and an un-chipped
// "[018d99c0] [7e7f59f1]" tail reads as noise.
const CITE_RE =
  /\[([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{8}|\d{1,3})\]/g;

// Inline token patterns, checked at each position; the earliest match wins.
// Emphasis must hug its text ("a * b * c" is arithmetic, not italics) and
// underscores inside words (snake_case_names) are never emphasis.
const INLINE_PATTERNS = [
  { type: "code", re: /`([^`]+)`/g },
  { type: "br", re: /<br\s*\/?>/gi },
  { type: "bold", re: /\*\*(?!\s)(.+?)(?<!\s)\*\*(?!\*)|(?<![\w_])__(?!\s)(.+?)(?<!\s)__(?![\w_])/g },
  { type: "strike", re: /~~(?!\s)(.+?)(?<!\s)~~/g },
  {
    type: "italic",
    re: /(?<!\*)\*(?![\s*])([^*\n]+?)(?<![\s*])\*(?!\*)|(?<![\w_])_(?![\s_])([^_\n]+?)(?<![\s_])_(?![\w_])/g,
  },
  { type: "link", re: /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g },
  { type: "cite", re: new RegExp(CITE_RE.source, "g") },
] as const;

/** Render inline formatting within a single line/segment of text. */
function renderInline(
  text: string,
  keyPrefix: string,
  citeMap: Map<string, number>
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let i = 0;
  let k = 0;

  while (i < text.length) {
    let best: { type: string; m: RegExpExecArray } | null = null;
    for (const p of INLINE_PATTERNS) {
      p.re.lastIndex = i;
      const m = p.re.exec(text);
      if (m && (best === null || m.index < best.m.index)) {
        best = { type: p.type, m };
      }
    }

    if (!best) {
      nodes.push(text.slice(i));
      break;
    }
    if (best.m.index > i) nodes.push(text.slice(i, best.m.index));

    const key = `${keyPrefix}-i${k++}`;
    if (best.type === "code") {
      nodes.push(
        <code
          key={key}
          className="rounded-[0.3em] border border-border/70 bg-surface-muted px-[0.3em] py-[0.05em] font-mono text-[0.87em]"
        >
          {best.m[1]}
        </code>
      );
    } else if (best.type === "br") {
      nodes.push(<br key={key} />);
    } else if (best.type === "bold") {
      nodes.push(
        <strong key={key} className="font-semibold">
          {renderInline(best.m[1] ?? best.m[2], key, citeMap)}
        </strong>
      );
    } else if (best.type === "strike") {
      nodes.push(<del key={key}>{renderInline(best.m[1], key, citeMap)}</del>);
    } else if (best.type === "italic") {
      nodes.push(<em key={key}>{renderInline(best.m[1] ?? best.m[2], key, citeMap)}</em>);
    } else if (best.type === "link") {
      nodes.push(
        <a
          key={key}
          href={best.m[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-accent-strong underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
        >
          {best.m[1]}
        </a>
      );
    } else {
      nodes.push(<CitationChip key={key} id={best.m[1]} ordinal={citeMap.get(best.m[1])} />);
    }

    i = best.m.index + best.m[0].length;
  }

  return nodes;
}

/**
 * A compact inline source chip for a `[id]` citation. Shows a small ordinal
 * ([1], [2], …) with the full chunk id in the tooltip, so answers read cleanly.
 * Non-interactive for now (the Brain does not yet return per-citation source
 * metadata to link to); the ordinal + tooltip already make sources traceable.
 */
function CitationChip({ id, ordinal }: { id: string; ordinal?: number }) {
  const label = ordinal ?? id.slice(0, 4);
  return (
    <sup className="mx-0.5">
      <span
        className="inline-flex h-4 items-center rounded-full bg-accent-soft px-1.5 font-sans text-[10px] font-semibold leading-none text-accent-strong ring-1 ring-inset ring-accent/20"
        title={`Source ${id}`}
        aria-label={`Source ${ordinal ? `${ordinal}` : id}`}
      >
        {label}
      </span>
    </sup>
  );
}

/** A fenced code block with a language label and a copy button (mono, 13px). */
function CodeBlock({ lang, code }: { lang?: string; code: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface-muted font-sans">
      <div className="flex h-8 items-center justify-between border-b border-border/70 pl-3 pr-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {lang || "code"}
        </span>
        <CopyCodeButton code={code} />
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[13px] leading-[1.6] text-foreground">
        <code>{code}</code>
      </pre>
    </div>
  );
}
