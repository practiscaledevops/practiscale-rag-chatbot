"use client";

import { Fragment, type ReactNode } from "react";

/**
 * A tiny, dependency-free Markdown renderer for assistant messages.
 *
 * It intentionally supports only the subset a grounded chat needs — fenced code
 * blocks, headings, lists, blockquotes, paragraphs, and inline `code` / **bold**
 * / links / [id] citation chips. Everything renders as React elements (never
 * dangerouslySetInnerHTML), so message text is always escaped: retrieved/model
 * content is treated as data, never markup. Links are restricted to
 * http(s)/mailto by the matching regex, so `javascript:` URLs can't slip in.
 */
export function Markdown({ content }: { content: string }) {
  const blocks: ReactNode[] = [];
  let key = 0;

  // Split fenced code blocks out first so their contents are never parsed as
  // Markdown. Everything between fences goes through the line-based parser.
  const fence = /```(\w*)\n?([\s\S]*?)```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(content)) !== null) {
    if (match.index > cursor) {
      renderTextBlocks(content.slice(cursor, match.index), `b${key++}`, blocks);
    }
    blocks.push(
      <pre
        key={`code-${key++}`}
        className="overflow-x-auto rounded-xl border border-border bg-surface-muted p-3 font-mono text-[13px] leading-relaxed"
      >
        <code>{match[2].replace(/\n$/, "")}</code>
      </pre>
    );
    cursor = match.index + match[0].length;
  }
  if (cursor < content.length) {
    renderTextBlocks(content.slice(cursor), `b${key++}`, blocks);
  }

  return <div className="space-y-3 leading-relaxed">{blocks}</div>;
}

/** Parse a non-code chunk into headings, lists, blockquotes, and paragraphs. */
function renderTextBlocks(text: string, keyBase: string, out: ReactNode[]) {
  const lines = text.split("\n");
  let i = 0;
  let k = 0;

  const isHeading = (l: string) => /^(#{1,3})\s+/.test(l);
  const isListItem = (l: string) => /^\s*([-*]|\d+\.)\s+/.test(l);
  const isQuote = (l: string) => /^\s*>\s?/.test(l);

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    // Heading (#, ##, ###)
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const key = `${keyBase}-h${k++}`;
      const cls =
        level === 1
          ? "text-lg font-semibold"
          : level === 2
            ? "text-base font-semibold"
            : "text-sm font-semibold";
      out.push(
        <p key={key} className={cls}>
          {renderInline(h[2], key)}
        </p>
      );
      i++;
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
      const inner = items.map((it, idx) => (
        <li key={`${key}-${idx}`}>{renderInline(it, `${key}-${idx}`)}</li>
      ));
      out.push(
        ordered ? (
          <ol key={key} className="list-decimal space-y-1 pl-5">
            {inner}
          </ol>
        ) : (
          <ul key={key} className="list-disc space-y-1 pl-5">
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
          className="border-l-2 border-accent/40 pl-3 text-muted-foreground"
        >
          {renderInline(quote.join("\n"), key)}
        </blockquote>
      );
      continue;
    }

    // Paragraph: gather consecutive non-blank, non-block lines.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !isHeading(lines[i]) &&
      !isListItem(lines[i]) &&
      !isQuote(lines[i])
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
            {renderInline(pl, `${key}-${idx}`)}
          </Fragment>
        ))}
      </p>
    );
  }
}

// Inline token patterns, checked at each position; the earliest match wins.
// Links are matched before bare `[id]` citations, so `[text](url)` is a link and
// a lone `[3]` is a citation chip. Link URLs are constrained to http(s)/mailto.
const INLINE_PATTERNS = [
  { type: "code", re: /`([^`]+)`/g },
  { type: "bold", re: /\*\*([^*]+?)\*\*/g },
  {
    type: "link",
    re: /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
  },
  { type: "cite", re: /\[([^\]\s]{1,40})\]/g },
] as const;

/** Render inline formatting within a single line/segment of text. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
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
      nodes.push(<strong key={key}>{renderInline(best.m[1], key)}</strong>);
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
      nodes.push(<CitationChip key={key} id={best.m[1]} />);
    }

    i = best.m.index + best.m[0].length;
  }

  return nodes;
}

/**
 * A small inline source chip for a `[id]` citation marker. Non-interactive for
 * now — TODO: link it to the full source once the Brain returns citation
 * metadata (title/url) alongside the streamed answer.
 */
function CitationChip({ id }: { id: string }) {
  return (
    <sup className="mx-0.5">
      <span
        className="inline-flex items-center rounded-md bg-accent/10 px-1.5 text-[10px] font-semibold text-accent ring-1 ring-inset ring-accent/20"
        title={`Source ${id}`}
        aria-label={`Source ${id}`}
      >
        {id}
      </span>
    </sup>
  );
}
