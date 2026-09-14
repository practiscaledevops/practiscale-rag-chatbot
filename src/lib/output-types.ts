// Output types — the RESPONSE FORMAT the user picks above the message box.
// Forwarded to the Brain as `outputType`; the Brain maps it to a grounded format
// overlay (never invents data to fill a shape). "answer" is the free-form default.
// Kept in sync with the Brain's OutputType union in lib/prompts.ts.

export type OutputType =
  | "answer"
  | "table"
  | "chart"
  | "memo"
  | "email"
  | "checklist"
  | "summary"
  | "steps";

export interface OutputTypeDef {
  id: OutputType;
  label: string;
  hint: string;
}

export const OUTPUT_TYPES: OutputTypeDef[] = [
  { id: "answer", label: "Answer", hint: "Free-form response" },
  { id: "table", label: "Table", hint: "Rows & columns" },
  { id: "chart", label: "Chart", hint: "Chart-ready data table" },
  { id: "summary", label: "Summary", hint: "Headline + tight bullets" },
  { id: "checklist", label: "Checklist", hint: "Actionable items" },
  { id: "steps", label: "Steps", hint: "Numbered how-to" },
  { id: "memo", label: "Memo", hint: "Professional memo" },
  { id: "email", label: "Email", hint: "Ready-to-send email" },
];

export const DEFAULT_OUTPUT_TYPE: OutputType = "answer";

export function isOutputType(v: unknown): v is OutputType {
  return typeof v === "string" && OUTPUT_TYPES.some((o) => o.id === v);
}
