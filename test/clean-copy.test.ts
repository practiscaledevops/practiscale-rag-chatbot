import { describe, it, expect } from "vitest";
import { cleanClipboard, type CopyNode } from "@/lib/clean-copy";

// Tiny DOM stand-ins (the test runner has no DOM).
function el(name: string, attrs: Record<string, string> = {}, ...children: (CopyNode | string)[]): CopyNode {
  const nodes = children.map((c) => (typeof c === "string" ? text(c) : c));
  return {
    nodeType: 1,
    nodeName: name.toUpperCase(),
    textContent: nodes.map((n) => n.textContent ?? "").join(""),
    childNodes: nodes,
    getAttribute: (k: string) => (k in attrs ? attrs[k] : null),
    className: attrs.class ?? "",
  };
}
function text(s: string): CopyNode {
  return { nodeType: 3, nodeName: "#text", textContent: s, childNodes: [] };
}
function frag(...children: (CopyNode | string)[]): CopyNode {
  const nodes = children.map((c) => (typeof c === "string" ? text(c) : c));
  return { nodeType: 11, nodeName: "#document-fragment", textContent: null, childNodes: nodes };
}

describe("cleanClipboard", () => {
  it("drops theme styling: no class/style attributes survive, only structure", () => {
    const f = frag(
      el("div", { class: "md-flow text-foreground", style: "color: rgb(236,236,232)" },
        el("h2", { class: "text-[1.2em]" }, "Close rates"),
        el("p", { style: "background: #1a1a19" }, "From the ", el("strong", {}, "latest"), " sync."))
    );
    const { html, text: plain } = cleanClipboard(f);
    expect(html).toBe("<h2>Close rates</h2><p>From the <strong>latest</strong> sync.</p>");
    expect(html).not.toMatch(/class=|rgb\(|#1a1a19/);
    expect(plain).toBe("Close rates\n\nFrom the latest sync.");
  });

  it("turns tables into bordered HTML and TSV text, keeping right alignment", () => {
    const table = el("table", { class: "w-full" },
      el("thead", {}, el("tr", {}, el("th", {}, "Consultant"), el("th", { class: "text-right" }, "Calls"))),
      el("tbody", {}, el("tr", {}, el("td", {}, "Alex"), el("td", { class: "px-3 text-right" }, "42"))));
    const { html, text: plain } = cleanClipboard(frag(table));
    expect(html).toContain('<table style="border-collapse:collapse');
    expect(html).toContain("background:#E6F7F1");
    expect(html).toMatch(/<td style="[^"]*text-align:right">42<\/td>/);
    expect(plain).toBe("Consultant\tCalls\nAlex\t42");
  });

  it("leaves out buttons, icons, citation chips and aria-hidden chrome", () => {
    const f = frag(
      el("div", {}, el("button", {}, "Table"), el("button", {}, "Copy table")),
      el("p", {}, "Discovery lags", el("sup", {}, el("span", {}, "1")), " behind closing."),
      el("span", { "aria-hidden": "true" }, "✓"),
      el("svg", {}, el("path", {}))
    );
    const { html, text: plain } = cleanClipboard(f);
    expect(plain).toBe("Discovery lags behind closing.");
    expect(html).not.toMatch(/Table|Copy|✓|<svg|<sup/);
  });

  it("formats lists as bullets / numbers in plain text", () => {
    const f = frag(
      el("ul", {}, el("li", {}, "First"), el("li", {}, "Second")),
      el("ol", { start: "3" }, el("li", {}, "Third"), el("li", {}, "Fourth"))
    );
    const { html, text: plain } = cleanClipboard(f);
    expect(plain).toBe("• First\n• Second\n\n3. Third\n4. Fourth");
    expect(html).toContain('<ol start="3">');
  });

  it("keeps only safe links", () => {
    const f = frag(el("p", {}, el("a", { href: "https://practiscale.co" }, "site"), " ", el("a", { href: "javascript:alert(1)" }, "bad")));
    const { html } = cleanClipboard(f);
    expect(html).toContain('<a href="https://practiscale.co">site</a>');
    expect(html).not.toContain("javascript:");
    expect(html).toContain("bad");
  });

  it("escapes text content", () => {
    const { html } = cleanClipboard(frag(el("p", {}, "<script>x</script> & more")));
    expect(html).toBe("<p>&lt;script&gt;x&lt;/script&gt; &amp; more</p>");
  });

  it("wraps partial table selections so they still paste as a table", () => {
    const row = cleanClipboard(frag(el("td", {}, "Alex"), el("td", {}, "42")), "table-row");
    expect(row.html).toMatch(/^<table[^>]*><tr><td[^>]*>Alex<\/td><td[^>]*>42<\/td><\/tr><\/table>$/);
    expect(row.text).toBe("Alex\t42");

    const rows = cleanClipboard(frag(el("tr", {}, el("td", {}, "A"), el("td", {}, "1")), el("tr", {}, el("td", {}, "B"), el("td", {}, "2"))), "table");
    expect(rows.html.startsWith("<table")).toBe(true);
    expect(rows.text).toBe("A\t1\nB\t2");
  });

  it("wraps partial list selections in their list", () => {
    const { html, text: plain } = cleanClipboard(frag(el("li", {}, "One"), el("li", {}, "Two")), "ol");
    expect(html).toBe("<ol><li>One</li><li>Two</li></ol>");
    expect(plain).toBe("1. One\n2. Two");
  });

  it("returns plain text for a selection inside one paragraph", () => {
    expect(cleanClipboard(frag("just some words")).text).toBe("just some words");
  });
});

describe("cleanClipboard — whitespace-significant content", () => {
  const code = "def f(x):\n    if x:\n        return 1";

  it("a selection inside a code block keeps its newlines and indentation", () => {
    const { html, text: plain } = cleanClipboard(frag(text(code)), "pre");
    expect(plain).toBe(code);
    expect(html).toContain("<pre");
    expect(html).toContain("    if x:\n        return 1");
  });

  it("a whole code block (header + pre) keeps indentation and drops the Copy button", () => {
    const block = el("div", {},
      el("div", {}, el("span", {}, "python"), el("button", {}, "Copy")),
      el("pre", {}, el("code", {}, code)));
    const { html, text: plain } = cleanClipboard(frag(block));
    expect(plain).toBe(`python\n\n${code}`);
    expect(html).toMatch(/<pre style="[^"]*white-space:pre-wrap"><code[^>]*>def f\(x\):\n {4}if x:/);
    expect(html).not.toContain("Copy");
  });

  it("keeps YAML indentation and blank lines inside code", () => {
    const yaml = "a:\n  b: 1\n\n\n  c:\n    - 2";
    expect(cleanClipboard(frag(el("pre", {}, el("code", {}, yaml)))).text).toBe(yaml);
  });

  it("an indented first code line after prose keeps its indent", () => {
    const f = frag(el("p", {}, "Run this:"), el("pre", {}, el("code", {}, "  indented()\nnext()")));
    expect(cleanClipboard(f).text).toBe("Run this:\n\n  indented()\nnext()");
  });

  it("a multi-line user prompt keeps its line breaks (pre-wrap context)", () => {
    const prompt = "line one\nline two\n\nline four";
    const { html, text: plain } = cleanClipboard(frag(text(prompt)), "pre-wrap");
    expect(plain).toBe(prompt);
    expect(html).toBe("<p>line one<br>line two<br><br>line four</p>");
  });

  it("a user bubble inside a larger selection keeps its line breaks", () => {
    const f = frag(
      el("div", { class: "whitespace-pre-wrap break-words" }, "first\nsecond"),
      el("p", {}, "The answer.")
    );
    const { html, text: plain } = cleanClipboard(f);
    expect(plain).toBe("first\nsecond\n\nThe answer.");
    expect(html).toContain("<p>first<br>second</p>");
  });

  it("prose outside code is still collapsed and tidied", () => {
    const f = frag(el("p", {}, "  lots   of\n  space  "), el("pre", {}, el("code", {}, "x = 1")));
    expect(cleanClipboard(f).text).toBe("lots of space\n\nx = 1");
  });
});
