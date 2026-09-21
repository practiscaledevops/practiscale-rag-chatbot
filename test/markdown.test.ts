import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "@/app/(app)/_components/Markdown";

const render = (content: string) => renderToStaticMarkup(createElement(Markdown, { content }));

// A streamed answer is rendered at every prefix, so the parser must terminate
// and produce sane output for EVERY partial state — in particular a table whose
// separator / rows haven't arrived yet (this once looped forever and crashed the
// tab out of memory at the first table of every long answer).
const TABLE = "## Plan\n\nIntro line.\n\n| Phase | Goal |\n|---|---|\n| Open | Frame the call |\n| Close | Next step |\n\nAfter.";

describe("Markdown streaming safety", () => {
  it("renders every prefix of a document with a table without hanging", () => {
    for (let n = 1; n <= TABLE.length; n++) {
      const html = render(TABLE.slice(0, n));
      expect(html.length).toBeGreaterThan(0);
      // Never an unbounded pile of empty paragraphs.
      expect((html.match(/<p><\/p>/g) ?? []).length).toBeLessThan(3);
    }
  });

  it("treats a header row without its separator as text, then as a table once complete", () => {
    expect(render("| Phase | Goal |")).toContain("| Phase | Goal |");
    expect(render("| Phase | Goal |")).not.toContain("<table");
    expect(render("| Phase | Goal |\n|")).not.toContain("<table");
    const full = render("| Phase | Goal |\n|---|---|\n| Open | Frame |");
    expect(full).toContain("<table");
    expect(full).toContain("<th");
    expect(full).toContain("Frame");
  });

  it("renders pipe-delimited lines that never get a separator as plain paragraphs", () => {
    const html = render("| a | b |\n| c | d |");
    expect(html).not.toContain("<table");
    expect(html).toContain("| a | b |");
    expect(html).toContain("| c | d |");
  });

  it("keeps citation ordinals global across blocks", () => {
    const id1 = "11111111-1111-1111-1111-111111111111";
    const id2 = "22222222-2222-2222-2222-222222222222";
    const html = render(`First [${id1}].\n\nSecond [${id2}] and again [${id1}].`);
    // id1 → [1] wherever it appears; id2 → [2].
    expect(html).toContain(`title="Source ${id1}"`);
    expect(html.indexOf(">1<")).toBeGreaterThan(-1);
    expect(html.indexOf(">2<")).toBeGreaterThan(-1);
    expect(html.match(/>1</g)?.length).toBe(2);
  });

  it("keeps fenced code (even with blank lines inside) as one code block", () => {
    const html = render("Before\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter");
    expect(html.match(/<pre/g)?.length).toBe(1);
    expect(html).toContain("const b = 2;");
  });
});
