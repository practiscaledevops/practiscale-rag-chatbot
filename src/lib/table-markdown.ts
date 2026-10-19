import { splitTableRow } from "@/lib/copy-format";
/** Repair only unambiguous pipe tables. Never infer missing data or touch code. */
export function normalizeTableMarkdown(content: string): string {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(?:```|~~~)/.test(line)) { fenced = !fenced; out.push(line); continue; }
    if (fenced || !/^\s*\|.*\|\s*$/.test(line)) { out.push(line); continue; }
    const cells = splitTableRow(line);
    const run = [line];
    let last = i;
    while (last + 1 < lines.length) {
      let next = last + 1;
      while (next < lines.length && !lines[next].trim()) next++;
      if (!/^\s*\|.*\|\s*$/.test(lines[next] ?? "") || splitTableRow(lines[next]).length !== cells.length) break;
      run.push(lines[next]); last = next;
    }
    const hasSeparator = run.length > 1 && splitTableRow(run[1]).every(c => /^:?-{3,}:?$/.test(c.trim()));
    if (run.length >= 2 && cells.length >= 3 && cells.every(c => /[a-z]/i.test(c)) && !hasSeparator) run.splice(1, 0, `|${cells.map(() => "---").join("|")}|`);
    out.push(...run); i = last;
  }
  return out.join("\n");
}
