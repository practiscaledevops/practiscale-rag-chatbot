import { fitMessagesForBrain, isConversationSummary, type BrainMessage } from "@/lib/brain";
import { clipSummary } from "@/lib/compaction";

const RECENT_TURNS = 12;
const MAX_OLDER_STEPS = 200;
const MAX_OLDER_CHARS = 16_000;
const MAX_EXCERPTS = 6;
const MAX_EXCERPT_CHARS = 700;
const broadHistory = /\b(?:entire|whole|full) (?:chat|conversation|thread|history)\b|\beverything (?:we|in this)\b|\b(?:summari[sz]e|recap|review) (?:our|this) (?:chat|conversation|thread|history)\b/i;
const reportRequest = /\b(?:payroll|ghl|crm|go high level|calls?|consultants?|scor(?:e|ing|ed)|show[- ]?rate|closings?|sales|deals?|commissions?|earn(?:ed|ings)?|report|reporting source|(?:our|my|same|earlier|previous) scope|compare|audit|dates?|teams?|week|month|today|yesterday|last \d+ days?)\b|\b\d{4}-\d{2}-\d{2}\b|\b(?:details?|breakdown) (?:of |for )?(?:these|those|them)\b|^(?:and|what about|how about)\b/i;
const comparisonFollowUp = /\b(?:difference|gap)\b|\b(?:they|the totals) match\b/i;
const recallLabel = /^(?:what|which)\s+(?:exact\s+)?([\p{L}\p{N}][\p{L}\p{N} '’-]{0,55}?)\s+did i\s+(?:give|tell|share|mention|provide|specify|say)(?:\s+(?:with you|to you|you))?(?:\s+(?:earlier|before|in this (?:chat|thread|conversation)))?[?.! ]*$/iu;
const repeatPrompt = /^(?:repeat|quote|show) my (?:previous|last) (?:message|prompt)[?.! ]*$/i;
const ignored = new Set(["about", "after", "answer", "before", "could", "earlier", "explain", "have", "said", "should", "that", "their", "them", "this", "what", "which", "with", "would", "your"]);

type UserContext = { content: string; createdAt?: string };
type Excerpt = UserContext & { role: "user" | "assistant"; citationIds?: string[] };
export type EarlierChatContext = { userTurns?: UserContext[]; excerpts?: Excerpt[]; citationIds?: string[] };

const citationPattern = /\[([a-f0-9]{8}(?:-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})?)\](?!\()/gi;

function citationIds(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(citationPattern), match => match[1].toLowerCase()))].slice(0, 3);
}

function words(content: string): Set<string> {
  const tokens = content.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu) ?? [];
  return new Set(tokens.filter(token => !ignored.has(token)));
}

function dated(content: string, message: BrainMessage): UserContext {
  return { content, ...(message.createdAt ? { createdAt: message.createdAt } : {}) };
}

function reportHistory(messages: BrainMessage[]): UserContext[] {
  const turns: UserContext[] = [];
  let length = 0;
  for (let i = messages.length - 1; i >= 0 && turns.length < MAX_OLDER_STEPS; i--) {
    const message = messages[i];
    if (message.role !== "user") continue;
    const text = message.content.trim();
    // A long unrelated prompt still marks a change of topic. Never cut one
    // down into what might look like a different, valid report command.
    const content = text.length <= 900 ? text : "";
    if (!content && turns.at(-1)?.content === "") continue;
    const cost = content.length + 48;
    if (length + cost > MAX_OLDER_CHARS) break;
    turns.push(dated(content, message));
    length += cost;
  }
  return turns.reverse();
}

function recallHistory(messages: BrainMessage[], label: string | undefined): UserContext[] {
  const subject = label?.replace(/^(my|our|the) /i, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const statement = subject
    ? new RegExp(String.raw`^(?:(?:actually|update)[,:]?\s+)?(?:(?:my|our|the)\s+)?${subject}\b(?:\s+(?:in|for|of)\s+[^.!?:=]{1,65}?)?\s*(?:(?:is|was|are|were)\s+|[:=]\s*)\S`, "i")
    : undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "user") continue;
    if (!statement) return [dated(message.content.slice(0, 4_000), message)];
    const excerpt = message.content.split(/\r?\n|(?<=[.!?])\s+/u).reverse().map(line => line.trim())
      .find(line => line.length <= MAX_EXCERPT_CHARS && !line.endsWith("?") && statement.test(line));
    if (excerpt) return [dated(excerpt, message)];
  }
  return [];
}

function relevantExcerpts(messages: BrainMessage[], query: string): Excerpt[] {
  const terms = words(query.slice(0, 2_000));
  if (!terms.size) return [];
  const scored: { index: number; overlap: number; excerpt: Excerpt }[] = [];
  for (const [index, message] of messages.entries()) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    let best: { overlap: number; content: string; citationIds?: string[] } | undefined;
    for (const paragraph of message.content.split(/\r?\n[ \t]*\r?\n/)) {
      for (const line of paragraph.split(/\r?\n|(?<=[.!?])\s+(?![\s\[])/u)) {
        const content = line.trim();
        if (content.length < 16 || content.length > MAX_EXCERPT_CHARS) continue;
        const overlap = [...words(content)].filter(word => terms.has(word)).length;
        if (overlap <= (best?.overlap ?? 0)) continue;
        const ids = message.role === "assistant" && !citationIds(content).length ? citationIds(paragraph) : [];
        best = { overlap, content, ...(ids.length ? { citationIds: ids } : {}) };
      }
    }
    if (best) {
      const excerpt: Excerpt = { ...dated(best.content, message), role: message.role };
      if (best.citationIds) excerpt.citationIds = best.citationIds;
      scored.push({ index, overlap: best.overlap, excerpt });
    }
  }
  const unique = new Map<string, (typeof scored)[number]>();
  for (const item of scored.sort((a, b) => b.overlap - a.overlap || b.index - a.index)) {
    const key = item.excerpt.role + ":" + item.excerpt.content + ":" + (item.excerpt.citationIds?.join(",") ?? "");
    if (!unique.has(key)) unique.set(key, item);
    if (unique.size >= MAX_EXCERPTS) break;
  }
  return [...unique.values()].sort((a, b) => a.index - b.index).map(item => item.excerpt);
}

/** Request-only window. The chat's full transcript remains the save input. */
export function fitChatContext(transcript: BrainMessage[]): { messages: BrainMessage[]; earlierContext?: EarlierChatContext } {
  const turns = transcript.filter(message => message.role === "user" || message.role === "assistant");
  const latest = [...turns].reverse().find(message => message.role === "user")?.content.trim() ?? "";
  const legacy = fitMessagesForBrain(transcript);
  const hasSummary = !!legacy[0] && isConversationSummary(legacy[0]);
  const messages = !broadHistory.test(latest) && legacy.length > RECENT_TURNS + Number(hasSummary)
    ? fitMessagesForBrain(transcript, RECENT_TURNS + Number(hasSummary))
    : legacy;
  if (hasSummary) messages[0] = { ...messages[0], content: clipSummary(messages[0].content, 12_000) };

  const older = turns.slice(0, turns.length - messages.length + Number(hasSummary));
  const label = recallLabel.exec(latest)?.[1];
  const exactRecall = !!label || repeatPrompt.test(latest);
  const earlierComparison = comparisonFollowUp.test(latest) && older.some(message =>
    message.role === "user" && /\bpayroll\b/i.test(message.content) && /\bcall[ -]scoring\b/i.test(message.content));
  const userTurns = exactRecall ? recallHistory(older, label)
    : reportRequest.test(latest) || earlierComparison ? reportHistory(older) : [];
  const excerpts = exactRecall ? [] : relevantExcerpts(older, latest);
  const assistantCitations = (excerpts: Excerpt[]) => excerpts.filter(excerpt => excerpt.role === "assistant")
    .flatMap(excerpt => excerpt.citationIds ?? citationIds(excerpt.content));
  const recentCitations = !exactRecall && /\b(?:earlier|previous(?:ly)?|before|discussed|recap|remind me|what did (?:we|i) decide)\b/i.test(latest) &&
    !assistantCitations(excerpts).length
    ? [...new Set(assistantCitations(relevantExcerpts(turns.slice(older.length, -1), latest)))].slice(0, 3)
    : [];
  return {
    messages,
    ...(userTurns.length || excerpts.length || recentCitations.length ? {
      earlierContext: {
        ...(userTurns.length ? { userTurns } : {}),
        ...(excerpts.length ? { excerpts } : {}),
        ...(recentCitations.length ? { citationIds: recentCitations } : {}),
      },
    } : {}),
  };
}
