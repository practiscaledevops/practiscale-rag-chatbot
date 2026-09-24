import { describe, it, expect, vi, afterEach } from "vitest";
import {
  markdownToPlainText,
  markdownToHtml,
  copyMarkdown,
  copyTable,
  writeRichClipboard,
  tableToTsv,
  tableToHtml,
  splitTableRow,
  parseTableAlign,
  isNumericCell,
  resolveColumnAlign,
  parseListRun,
} from "@/lib/copy-format";

const UUID = "11111111-1111-1111-1111-111111111111";

// ---------------------------------------------------------------------------
// markdownToPlainText
// ---------------------------------------------------------------------------

describe("markdownToPlainText", () => {
  it("strips bold, italics and strikethrough markers", () => {
    expect(
      markdownToPlainText("This is **bold**, *italic*, __strong__, _em_, ***both*** and ~~old~~.")
    ).toBe("This is bold, italic, strong, em, both and old.");
  });

  it("keeps nested emphasis text and leaves snake_case and arithmetic alone", () => {
    expect(markdownToPlainText("**a *b* c**")).toBe("a b c");
    expect(markdownToPlainText("Use snake_case_names here")).toBe("Use snake_case_names here");
    expect(markdownToPlainText("2 * 3 * 4 = 24")).toBe("2 * 3 * 4 = 24");
  });

  it("renders headings as plain lines (closing #s dropped)", () => {
    expect(markdownToPlainText("# Title\n\nIntro text.\n\n## Section ##\n\n### Sub")).toBe(
      "Title\n\nIntro text.\n\nSection\n\nSub"
    );
  });

  it("renders bullet lists as • items, nested lists indented under their parent", () => {
    expect(markdownToPlainText("- one\n* two\n  - nested **bold**\n+ three")).toBe(
      "• one\n• two\n  • nested bold\n• three"
    );
  });

  it("renders ordered lists with their numbers (start preserved, 1) style normalised)", () => {
    expect(markdownToPlainText("1. first\n2. second")).toBe("1. first\n2. second");
    expect(markdownToPlainText("3. third\n4. fourth")).toBe("3. third\n4. fourth");
    expect(markdownToPlainText("1) alpha\n2) beta")).toBe("1. alpha\n2. beta");
    expect(markdownToPlainText("1. Step\n   - detail\n2. Next")).toBe("1. Step\n   • detail\n2. Next");
  });

  it("renders task lists as checkboxes", () => {
    expect(markdownToPlainText("- [ ] todo\n- [x] done")).toBe("☐ todo\n☑ done");
  });

  it("keeps a list item's indented continuation line", () => {
    expect(markdownToPlainText("- item\n  continued here")).toBe("• item\n  continued here");
  });

  it("renders tables as TSV: header first, cells stripped of formatting and citations", () => {
    const md = [
      "| Name | Price |",
      "|---|---:|",
      "| **Alpha** | $10 [a1b2c3d4] |",
      "| `Beta` | $20 |",
    ].join("\n");
    expect(markdownToPlainText(md)).toBe("Name\tPrice\nAlpha\t$10\nBeta\t$20");
  });

  it("fills ragged table rows and flattens <br> / escaped pipes inside cells", () => {
    const md = "| A | B | C |\n|---|---|---|\n| 1<br>2 | x \\| y |";
    expect(markdownToPlainText(md)).toBe("A\tB\tC\n1 2\tx | y\t");
  });

  it("renders links as text (url) and autolinks as the url", () => {
    expect(
      markdownToPlainText("See [the docs](https://example.com/a) or <https://x.co>. Mail [us](mailto:hi@x.co).")
    ).toBe("See the docs (https://example.com/a) or https://x.co. Mail us (hi@x.co).");
    expect(markdownToPlainText("[https://a.co](https://a.co)")).toBe("https://a.co");
  });

  it("drops the target of non-http links, keeping only their text", () => {
    expect(markdownToPlainText("[click me](javascript:alert)")).toBe("click me");
  });

  it("removes citation markers (uuid, 8-hex, ordinal, runs) but not link text", () => {
    expect(
      markdownToPlainText(
        `Revenue grew 12% [a1b2c3d4] in Q1 [12].\nChurn fell [${UUID}][2], [3]; margins held.`
      )
    ).toBe("Revenue grew 12% in Q1.\nChurn fell; margins held.");
    expect(markdownToPlainText("[1] Leading citation")).toBe("Leading citation");
    expect(markdownToPlainText("[12](https://a.co)")).toBe("12 (https://a.co)");
    // Not citation-shaped: kept.
    expect(markdownToPlainText("Mark [TODO] later")).toBe("Mark [TODO] later");
  });

  it("strips inline code backticks and fences, keeping code verbatim", () => {
    expect(markdownToPlainText("Run `npm i` then ``a`b``.")).toBe("Run npm i then a`b.");
    expect(markdownToPlainText("Before\n\n```ts\nconst a = 1;\n\n\nconst b = **2**;\n```\n\nAfter")).toBe(
      "Before\n\nconst a = 1;\n\n\nconst b = **2**;\n\nAfter"
    );
  });

  it("removes the trailing ```options block, closed or still streaming", () => {
    expect(markdownToPlainText("Who is this for?\n\n```options\nOwners\nManagers\n```")).toBe(
      "Who is this for?"
    );
    expect(markdownToPlainText("Pick one:\n```options\nA\nB")).toBe("Pick one:");
  });

  it("normalises blank lines, CRLF and surrounding whitespace", () => {
    expect(markdownToPlainText("\n\n  First para  \r\n\r\n\r\n\r\nSecond\n\n\n")).toBe(
      "First para\n\nSecond"
    );
  });

  it("flattens blockquotes and rules, and unescapes backslash escapes", () => {
    expect(markdownToPlainText("> quoted **text**\n> more\n\n---\n\n2 \\* 3 \\# not a heading")).toBe(
      "quoted text\nmore\n\n2 * 3 # not a heading"
    );
  });

  it("leaves no markdown syntax in a realistic answer", () => {
    const md = [
      "## Plan",
      "",
      "Here is **the plan** for _Q3_ [a1b2c3d4]:",
      "",
      "1. **Open** the call",
      "2. Close with `next steps`",
      "",
      "| Phase | Goal |",
      "|---|---|",
      "| Open | Frame the call [3] |",
      "",
      "```options",
      "Shorter",
      "Longer",
      "```",
    ].join("\n");
    const out = markdownToPlainText(md);
    for (const token of ["**", "__", "#", "`", "|", "[3]", "[a1b2c3d4]", "options"]) {
      expect(out).not.toContain(token);
    }
    expect(out).toBe(
      "Plan\n\nHere is the plan for Q3:\n\n1. Open the call\n2. Close with next steps\n\nPhase\tGoal\nOpen\tFrame the call"
    );
  });

  it("returns an empty string for empty input", () => {
    expect(markdownToPlainText("")).toBe("");
    expect(markdownToPlainText("```options\nA\n```")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// markdownToHtml
// ---------------------------------------------------------------------------

describe("markdownToHtml", () => {
  it("renders paragraphs with strong / em / del / inline code", () => {
    expect(markdownToHtml("A **b** *c* ~~d~~ `e`")).toMatch(
      /^<p>A <strong>b<\/strong> <em>c<\/em> <del>d<\/del> <code[^>]*>e<\/code><\/p>$/
    );
  });

  it("renders headings h1-h4 (deeper levels capped at h4)", () => {
    const html = markdownToHtml("# One\n\n## Two\n\n### Three\n\n#### Four\n\n###### Six");
    expect(html).toBe("<h1>One</h1><h2>Two</h2><h3>Three</h3><h4>Four</h4><h4>Six</h4>");
  });

  it("renders nested lists and keeps an ordered list's start number", () => {
    expect(markdownToHtml("- a\n  - b\n- c")).toBe("<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>");
    expect(markdownToHtml("3. x\n4. y")).toBe('<ol start="3"><li>x</li><li>y</li></ol>');
    expect(markdownToHtml("1. x")).toBe("<ol><li>x</li></ol>");
  });

  it("renders a table with thead/tbody and visible inline borders", () => {
    const html = markdownToHtml("| Item | Cost |\n|---|---|\n| **Pen** | $1,200 |\n| Ink | 15% |");
    expect(html).toMatch(/^<table style="[^"]*border-collapse:collapse[^"]*">/);
    expect(html).toContain("<thead><tr><th");
    expect(html).toContain("<tbody><tr><td");
    expect(html).toContain("border:1px solid");
    expect(html).toContain("<strong>Pen</strong>");
    // The numeric column (header included) is right-aligned; the label column is not.
    expect(html).toMatch(/<th style="[^"]*text-align:right">Cost<\/th>/);
    expect(html).toMatch(/<td style="[^"]*text-align:right">\$1,200<\/td>/);
    expect(html).toMatch(/<th style="[^"]*text-align:left">Item<\/th>/);
  });

  it("renders blockquotes, code blocks and rules", () => {
    expect(markdownToHtml("> hi")).toMatch(/^<blockquote style="[^"]*border-left[^"]*"><p>hi<\/p><\/blockquote>$/);
    expect(markdownToHtml("```html\n<div>&</div>\n```")).toMatch(
      /^<pre style="[^"]*"><code>&lt;div&gt;&amp;&lt;\/div&gt;<\/code><\/pre>$/
    );
    expect(markdownToHtml("a\n\n---\n\nb")).toBe("<p>a</p><hr><p>b</p>");
  });

  it("links only http(s) and mailto URLs", () => {
    expect(markdownToHtml("[site](https://a.co/x?y=1&z=2)")).toBe(
      '<p><a href="https://a.co/x?y=1&amp;z=2">site</a></p>'
    );
    expect(markdownToHtml("[mail](mailto:hi@a.co)")).toBe('<p><a href="mailto:hi@a.co">mail</a></p>');
    const js = markdownToHtml("[click](javascript:alert)");
    expect(js).toBe("<p>click</p>");
    expect(markdownToHtml("[x](data:text/html;base64,AAAA)")).not.toContain("<a");
    expect(markdownToHtml("![pic](https://a.co/p.png)")).toBe('<p><a href="https://a.co/p.png">pic</a></p>');
  });

  it("escapes all text and never passes raw HTML through", () => {
    const html = markdownToHtml(
      `<script>alert(1)</script> <img src=x onerror="alert(2)"> & "quotes" 'apos'`
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&amp; &quot;quotes&quot; &#39;apos&#39;");
  });

  it("cannot break out of an href attribute", () => {
    const html = markdownToHtml(`[x](https://a.co/"onmouseover="alert(1))`);
    expect(html).not.toMatch(/<a [^>]*onmouseover/);
    expect(html).not.toContain('"onmouseover="');
  });

  it("escapes HTML inside table cells and headings", () => {
    const html = markdownToHtml("# <b>Hi</b>\n\n| <i>h</i> |\n|---|\n| <svg onload=x> |");
    expect(html).not.toMatch(/<(b|i|svg)[ >]/);
    expect(html).toContain("&lt;svg onload=x&gt;");
  });

  it("turns <br> into a real line break (the only tag recognised)", () => {
    expect(markdownToHtml("a<br>b<br/>c")).toBe("<p>a<br>b<br>c</p>");
  });

  it("removes citations and the options block", () => {
    const html = markdownToHtml(`Fact [${UUID}] and [7].\n\n\`\`\`options\nYes\nNo\n\`\`\``);
    expect(html).toBe("<p>Fact and.</p>");
  });
});

// ---------------------------------------------------------------------------
// Table helpers
// ---------------------------------------------------------------------------

describe("table helpers", () => {
  it("splitTableRow trims cells and honours escaped pipes", () => {
    expect(splitTableRow("| a | b \\| c |  d |")).toEqual(["a", "b | c", "d"]);
    expect(splitTableRow("| Close | Ne")).toEqual(["Close", "Ne"]);
  });

  it("parseTableAlign reads GFM alignment markers", () => {
    expect(parseTableAlign("|:---|:---:|---:|---|")).toEqual(["left", "center", "right", null]);
  });

  it("isNumericCell recognises amounts, percentages and units", () => {
    for (const v of ["12", "1,200", "$1,200.50", "-3.5%", "12k", "1.2M", "3x", "(1,234)", "PKR 50,000", "**42**", "7% [3]", "10+"]) {
      expect(isNumericCell(v), v).toBe(true);
    }
    for (const v of ["Q1", "abc", "10 users", "4.5/5", "2024-01-01", ""]) {
      expect(isNumericCell(v), v).toBe(false);
    }
  });

  it("resolveColumnAlign right-aligns numeric columns, honours explicit alignment, keeps column 0 left", () => {
    const rows = [
      ["2023", "Alpha", "$10", "5%"],
      ["2024", "Beta", "—", "7%"],
    ];
    expect(resolveColumnAlign(rows, 4)).toEqual(["left", "left", "right", "right"]);
    expect(resolveColumnAlign(rows, 4, [null, "center", "left", null])).toEqual([
      "left",
      "center",
      "left",
      "right",
    ]);
    expect(resolveColumnAlign([], 2)).toEqual(["left", "left"]);
  });

  it("tableToTsv and tableToHtml share the same cells", () => {
    const headers = ["Name", "Score"];
    const rows = [["**Ann**", "9"], ["Bo\tb", ""]];
    expect(tableToTsv(headers, rows)).toBe("Name\tScore\nAnn\t9\nBo b\t");
    const html = tableToHtml(headers, rows);
    expect(html).toContain("<strong>Ann</strong>");
    expect((html.match(/<tr>/g) ?? []).length).toBe(3);
  });
});

describe("parseListRun", () => {
  it("nests by indentation, keeps ordered starts and stops at a block break", () => {
    const lines = ["2. Two", "   - a", "     - deep", "   - b", "3. Three", "## Next"];
    const { list, end } = parseListRun(lines, 0, (l) => l.startsWith("#"));
    expect(end).toBe(5);
    expect(list.ordered).toBe(true);
    expect(list.start).toBe(2);
    expect(list.items.map((i) => i.text)).toEqual(["Two", "Three"]);
    const sub = list.items[0].children[0];
    expect(sub.ordered).toBe(false);
    expect(sub.items.map((i) => i.text)).toEqual(["a", "b"]);
    expect(sub.items[0].children[0].items[0].text).toBe("deep");
  });

  it("always consumes at least the first line", () => {
    expect(parseListRun(["- only"], 0).end).toBe(1);
    expect(parseListRun(["- a", "plain"], 0).end).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

class FakeClipboardItem {
  constructor(public readonly items: Record<string, Blob>) {}
}

function stubClipboard(opts: { write?: () => Promise<void>; writeText?: () => Promise<void>; item?: boolean }) {
  const write = vi.fn(opts.write ?? (async () => {}));
  const writeText = vi.fn(opts.writeText ?? (async () => {}));
  vi.stubGlobal("navigator", { clipboard: { write, writeText } });
  vi.stubGlobal("ClipboardItem", opts.item === false ? undefined : FakeClipboardItem);
  return { write, writeText };
}

describe("copyMarkdown / copyTable", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes both text/html and text/plain in one ClipboardItem", async () => {
    const { write, writeText } = stubClipboard({});
    await expect(copyMarkdown("**Hi** [1]\n\n| a | b |\n|---|---|\n| 1 | 2 |")).resolves.toBe(true);
    expect(writeText).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);
    const calls = write.mock.calls as unknown as [FakeClipboardItem[]][];
    const [items] = calls[0];
    expect(items).toHaveLength(1);
    const { items: blobs } = items[0];
    expect(Object.keys(blobs).sort()).toEqual(["text/html", "text/plain"]);
    expect(await blobs["text/plain"].text()).toBe("Hi\n\na\tb\n1\t2");
    const html = await blobs["text/html"].text();
    expect(html).toContain("<strong>Hi</strong>");
    expect(html).toContain("<table");
  });

  it("falls back to writeText(plain text) when ClipboardItem is unavailable", async () => {
    const { write, writeText } = stubClipboard({ item: false });
    await expect(copyMarkdown("# Title\n\n- **x**")).resolves.toBe(true);
    expect(write).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith("Title\n\n• x");
  });

  it("falls back to writeText when the rich write is rejected", async () => {
    const { writeText } = stubClipboard({
      write: async () => {
        throw new Error("NotAllowedError");
      },
    });
    await expect(copyMarkdown("*a*")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("a");
  });

  it("returns false (never throws) when the clipboard fails or is missing", async () => {
    stubClipboard({
      item: false,
      writeText: async () => {
        throw new Error("denied");
      },
    });
    await expect(copyMarkdown("a")).resolves.toBe(false);

    vi.stubGlobal("navigator", {});
    await expect(copyMarkdown("a")).resolves.toBe(false);
    await expect(writeRichClipboard("<p>a</p>", "a")).resolves.toBe(false);

    vi.stubGlobal("navigator", undefined);
    await expect(copyMarkdown("a")).resolves.toBe(false);
  });

  it("copyTable writes the table as HTML + TSV", async () => {
    const { write } = stubClipboard({});
    await expect(copyTable(["Metric", "Q1"], [["Leads [2]", "1,200"]])).resolves.toBe(true);
    const calls = write.mock.calls as unknown as [FakeClipboardItem[]][];
    const blobs = calls[0][0][0].items;
    expect(await blobs["text/plain"].text()).toBe("Metric\tQ1\nLeads\t1,200");
    const html = await blobs["text/html"].text();
    expect(html).toMatch(/^<table/);
    expect(html).toMatch(/<td style="[^"]*text-align:right">1,200<\/td>/);
  });
});
