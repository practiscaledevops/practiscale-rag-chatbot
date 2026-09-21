import { Fragment, memo, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CopyCodeButton } from "./CopyCodeButton";
import { TableBlock } from "./TableBlock";

// No "use client": this is a pure, hook-free renderer, so it stays a shared
// component (rendered inside the client ChatView today, reusable server-side).

/**
 * A small, dependency-free Markdown renderer for assistant messages.
 *
 * Supports the subset a grounded chat needs: fenced code blocks (with a language
 * label + copy), headings (semantic h1-h6), ordered/unordered lists, blockquotes,
 * pipe tables, horizontal rules, paragraphs, and inline `code` / **bold** / *italic*
 * / links / [id] citation chips. Everything renders as React elements (never
 * dangerouslySetInnerHTML), so text is always escaped: retrieved/model content is
 * data, never markup. Links are restricted to http(s)/mailto by the matching regex.
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
  // Citation ordinals are global to the answer (the first-seen id is [1], …).
  // They are passed to blocks as one string so memoized blocks compare cheaply.
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const m of content.matchAll(CITE_RE)) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      ids.push(m[1]);
    }
  }
  const citeKey = ids.join(",");
  const blocks = splitBlocks(content);

  return (
    <div className="space-y-3 leading-relaxed">
      {blocks.map((text, i) => (
        <MarkdownBlock key={i} text={text} citeKey={citeKey} />
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
    renderTextBlocks(content.slice(cursor), `b${key++}`, blocks, citeMap);
  }
  return blocks;
}

const HEADING_CLS: Record<number, string> = {
  1: "mt-1 text-lg font-semibold text-foreground",
  2: "mt-1 text-base font-semibold text-foreground",
  3: "text-[15px] font-semibold text-foreground",
  4: "text-sm font-semibold text-foreground/90",
  5: "text-sm font-semibold text-foreground/80",
  6: "text-xs font-semibold uppercase tracking-wide text-muted-foreground",
};

/** Parse a non-code chunk into headings, lists, tables, quotes, rules, paragraphs. */
function renderTextBlocks(
  text: string,
  keyBase: string,
  out: ReactNode[],
  citeMap: Map<string, number>
) {
  const lines = text.split("\n");
  let i = 0;
  let k = 0;

  const isHeading = (l: string) => /^(#{1,6})\s+/.test(l);
  const isListItem = (l: string) => /^\s*([-*]|\d+\.)\s+/.test(l);
  const isQuote = (l: string) => /^\s*>\s?/.test(l);
  const isRule = (l: string) => /^\s*([-*_])(\s*\1){2,}\s*$/.test(l);
  const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
  const isTableSep = (l: string) => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(l) && l.includes("-");

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

    // Heading (# through ######) -> semantic h1-h6
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const key = `${keyBase}-h${k++}`;
      const Tag = `h${level}` as keyof React.JSX.IntrinsicElements;
      out.push(
        <Tag key={key} className={HEADING_CLS[level]}>
          {renderInline(h[2], key, citeMap)}
        </Tag>
      );
      i++;
      continue;
    }

    // Table: a header row, a separator row, then body rows.
    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = splitTableRow(line);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      const key = `${keyBase}-t${k++}`;
      // Raw (unformatted) cell strings, for charting the exact values shown.
      const rawRows = rows.map((r) => header.map((_, ci) => (r[ci] ?? "").trim()));
      const tableNode = (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                {header.map((c, idx) => (
                  <th key={idx} className="px-2.5 py-1.5 text-left font-semibold text-foreground">
                    {renderInline(c, `${key}-h${idx}`, citeMap)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-b border-border/60">
                  {header.map((_, ci) => (
                    <td key={ci} className="px-2.5 py-1.5 align-top text-foreground/90">
                      {renderInline(r[ci] ?? "", `${key}-${ri}-${ci}`, citeMap)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      out.push(
        <TableBlock key={key} table={tableNode} headers={header.map((h) => h.trim())} rows={rawRows} />
      );
      continue;
    }

    // List (unordered - / * or ordered 1.)
    if (isListItem(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && isListItem(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""));
        i++;
      }
      const key = `${keyBase}-l${k++}`;
      // GFM task list: every item is "[ ] …" or "[x] …" → render as a checklist.
      const taskMatches = items.map((it) => /^\[( |x|X)\]\s+(.*)$/.exec(it));
      const isTaskList = items.length > 0 && taskMatches.every(Boolean);

      if (isTaskList) {
        out.push(
          <ul key={key} className="space-y-1.5">
            {taskMatches.map((m, idx) => {
              const checked = (m![1] ?? "").toLowerCase() === "x";
              return (
                <li key={`${key}-${idx}`} className="flex items-start gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px]",
                      checked
                        ? "border-accent bg-accent/15 text-accent"
                        : "border-border text-transparent"
                    )}
                  >
                    ✓
                  </span>
                  <span className={cn(checked && "text-muted-foreground line-through")}>
                    {renderInline(m![2], `${key}-${idx}`, citeMap)}
                  </span>
                </li>
              );
            })}
          </ul>
        );
        continue;
      }

      const inner = items.map((it, idx) => (
        <li key={`${key}-${idx}`}>{renderInline(it, `${key}-${idx}`, citeMap)}</li>
      ));
      out.push(
        ordered ? (
          <ol key={key} className="list-decimal space-y-1 pl-5 marker:text-muted-foreground">
            {inner}
          </ol>
        ) : (
          <ul key={key} className="list-disc space-y-1 pl-5 marker:text-muted-foreground">
            {inner}
          </ul>
        )
      );
      continue;
    }

    // Blockquote
    if (isQuote(line)) {
      const quote: string[] = [];
      while (i < lines.length && isQuote(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      const key = `${keyBase}-q${k++}`;
      out.push(
        <blockquote
          key={key}
          className="border-l-2 border-accent/40 pl-3 italic text-muted-foreground"
        >
          {renderInline(quote.join("\n"), key, citeMap)}
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
    out.push(
      <p key={key}>
        {para.map((pl, idx) => (
          <Fragment key={`${key}-${idx}`}>
            {idx > 0 && <br />}
            {renderInline(pl, `${key}-${idx}`, citeMap)}
          </Fragment>
        ))}
      </p>
    );
  }
}

/** Split a `| a | b |` table row into trimmed cells. */
function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

// A citation id: a chunk UUID, or a short ordinal number. Kept strict so stray
// bracketed text (e.g. [TODO], [x], [0-9] array indices in prose) is NOT chipped.
const CITE_RE =
  /\[([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|\d{1,3})\]/g;

// Inline token patterns, checked at each position; the earliest match wins.
const INLINE_PATTERNS = [
  { type: "code", re: /`([^`]+)`/g },
  { type: "bold", re: /\*\*([^*]+?)\*\*|__([^_]+?)__/g },
  { type: "italic", re: /(?<!\*)\*([^*\n]+?)\*(?!\*)|(?<!_)_([^_\n]+?)_(?!_)/g },
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
          className="rounded bg-surface-muted px-1 py-0.5 font-mono text-[0.85em]"
        >
          {best.m[1]}
        </code>
      );
    } else if (best.type === "bold") {
      nodes.push(<strong key={key}>{renderInline(best.m[1] ?? best.m[2], key, citeMap)}</strong>);
    } else if (best.type === "italic") {
      nodes.push(<em key={key}>{renderInline(best.m[1] ?? best.m[2], key, citeMap)}</em>);
    } else if (best.type === "link") {
      nodes.push(
        <a
          key={key}
          href={best.m[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-accent underline underline-offset-2 hover:text-accent-hover"
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
        className="inline-flex items-center rounded bg-accent/10 px-1 text-[10px] font-semibold text-accent ring-1 ring-inset ring-accent/20"
        title={`Source ${id}`}
        aria-label={`Source ${ordinal ? `${ordinal}` : id}`}
      >
        {label}
      </span>
    </sup>
  );
}

/** A fenced code block with a language label and a copy button. */
function CodeBlock({ lang, code }: { lang?: string; code: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface-muted">
      <div className="flex items-center justify-between border-b border-border/70 px-3 py-1">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {lang || "code"}
        </span>
        <CopyCodeButton code={code} />
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[13px] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}
