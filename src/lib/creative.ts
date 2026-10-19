import { z } from "zod";

export const creativeSettingsSchema = z.object({
  audience: z.string().max(300).default(""), goal: z.string().max(500).default(""),
  voice: z.string().max(1000).default(""),
  angle: z.enum(["auto", "practical", "contrarian", "story", "diagnostic", "comparison"]).default("auto"),
  targetWords: z.number().int().min(50).max(3000).optional(), avoid: z.string().max(500).default(""),
  freshness: z.enum(["fresh", "preserve"]).default("fresh"),
  memoryScope: z.enum(["account", "thread", "off"]).default("account"),
  promptIds: z.array(z.string().uuid()).max(3).default([]),
  messageInstructions: z.string().max(2000).default(""),
});
export type CreativeSettings = z.infer<typeof creativeSettingsSchema>;
export const DEFAULT_CREATIVE = creativeSettingsSchema.parse({});
export function isCreativeRequest(query: string): boolean {
  return /\b(write|draft|create|generate|compose|brainstorm|fresh take|another version|new angle)\b/i.test(query) &&
    /\b(post|content|copy|email|article|campaign|script|newsletter|case stud(?:y|ies)|headline|hook|caption|landing page|story|ad|ads)\b/i.test(query) &&
    !/\b(call report|calls report|report of calls|report on calls)\b/i.test(query);
}
export interface DraftMemory { id: string; content: string; conversation_id?: string; created_at?: string; citations?: unknown }
export function selectDraftMemory(rows: DraftMemory[], query: string): DraftMemory[] {
  const words = new Set((query.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter(w => !["write", "draft", "create", "generate", "please", "content", "about", "with", "from", "that", "this"].includes(w)));
  return rows.map((r, i) => ({ r, score: [...words].filter(w => r.content.toLowerCase().includes(w)).length * 10 - i / 100 }))
    .sort((a, b) => b.score - a.score).slice(0, 12).map(({ r }) => ({ id: r.id, content: r.content.slice(0, 2400), citations: r.citations }));
}
export function composePromptLayers(base: string | undefined, layers: { title: string; body: string }[], message: string) {
  const blocks = [base ?? "", ...layers.map(l => `Saved instruction layer ${JSON.stringify(l.title)}:\n${l.body}`), message ? `Per-message instructions:\n${message}` : ""].filter(Boolean);
  const text = blocks.join("\n\n");
  if (text.length > 8000) throw new Error("Instruction layers exceed 8,000 characters. Shorten the selected prompts or per-message instructions.");
  return text || undefined;
}
