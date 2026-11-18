export const ghlOpportunityCitationPattern = /ghl-opportunity:[A-Za-z0-9_-]{15,100}/;
const citationId = new RegExp(`^${ghlOpportunityCitationPattern.source}$`);

export function ghlOpportunityId(reference: string): string | undefined {
  return citationId.test(reference) ? reference.slice("ghl-opportunity:".length) : undefined;
}

const reportHeader = "| Opportunity | CRM ID | Recorded value | Last status change | Period treatment |";
const reportRow = /^(\| [^|]* \| )([A-Za-z0-9_-]{15,100})( \| [^|]* \| [^|]* \| (?:In status-change period|Date unknown; excluded from period count) \|)$/;

/** Restore links in the known CRM answer formats saved before citations were emitted. */
export function withGhlOpportunityCitations(text: string): string {
  if (!text.includes("Source: GoHighLevel")) return text;
  if (text.startsWith("**Current CRM status:") && text.includes("\n\nSource: GoHighLevel, checked at ")) {
    return text.replace(/(^Opportunity: )([A-Za-z0-9_-]{15,100})(?=\nPipeline: [^\n]+\nStage: [^\n]+)/m,
      "$1$2 [ghl-opportunity:$2]");
  }
  if (!text.startsWith("**GHL / CRM — ") || !text.includes("\n\nSource: GoHighLevel live opportunity search. Checked ")) return text;
  const lines = text.split("\n");
  const header = lines.indexOf(reportHeader);
  if (header === -1 || lines[header + 1] !== "| --- | --- | --- | --- | --- |") return text;
  for (let i = header + 2; lines[i]?.startsWith("|"); i++) {
    lines[i] = lines[i].replace(reportRow, "$1$2 [ghl-opportunity:$2]$3");
  }
  return lines.join("\n");
}
