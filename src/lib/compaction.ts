// Conversation compaction, shared by the browser (ChatView) and /api/chat.
//
// A long chat folds its earlier turns into ONE summary message — a `system`
// turn whose content starts with SUMMARY_PREFIX — inserted at the point the
// conversation was compacted. The thread keeps showing (and persisting) every
// message; only the latest summary plus the turns after it are sent to the
// model. The Brain treats that summary as conversation context (never as
// instructions) and also reads it to carry filters such as "yesterday's calls"
// into follow-up questions.
//
// Dependency-free so it can be imported on both sides.

export const SUMMARY_PREFIX = "[Conversation summary]";

/** Most recent turns kept verbatim when compacting (two question/answer pairs). */
export const KEEP_RECENT = 4;

// The window the Brain's /api/v1/chat ACTUALLY keeps for the model (brain
// src/app/api/v1/chat/route.ts MAX_MODEL_TURNS / MAX_TURN_CHARS): the last 40
// user/assistant turns, then the oldest are dropped until messages +
// attachments + directives + summary fit in 120,000 chars — silently. The
// meter and auto-compaction measure against this so compaction runs BEFORE the
// Brain starts dropping context.
/** Most user/assistant turns the Brain keeps for the model. */
export const BRAIN_MODEL_TURNS = 40;
/** Most characters in one Brain turn (messages + attachments + directives + summary). */
export const BRAIN_TURN_CHARS = 120_000;
/** The Brain's char cap as a token budget (~4 chars/token): 30,000. */
export const BRAIN_WINDOW_TOKENS = Math.floor(BRAIN_TURN_CHARS / 4);

/** Share of the window folding must free for AUTO-compaction to be worth a model call. */
export const AUTO_COMPACT_MIN_FREED = 0.25;

export interface TurnLike {
  role: string;
  content: string;
  /** When the message was sent (Date from useChat, or ISO). */
  createdAt?: unknown;
}

/** ISO string for a Date / timestamp string, else undefined. */
function iso(v: unknown): string | undefined {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v.toISOString();
  if (typeof v === "string" && v.length <= 64 && !Number.isNaN(Date.parse(v))) return new Date(Date.parse(v)).toISOString();
  return undefined;
}

export function isSummaryMessage(m: TurnLike | null | undefined): boolean {
  return !!m && m.role === "system" && typeof m.content === "string" && m.content.startsWith(SUMMARY_PREFIX);
}

/** The summary body without its marker line. */
export function summaryBody(m: TurnLike): string {
  return m.content.slice(SUMMARY_PREFIX.length).trim();
}

export function makeSummaryContent(summary: string): string {
  return `${SUMMARY_PREFIX}\n${summary.trim()}`;
}

/** Index of the latest summary message, or -1 when the chat was never compacted. */
export function lastSummaryIndex(messages: readonly TurnLike[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isSummaryMessage(messages[i])) return i;
  }
  return -1;
}

/** What the model sees: the latest summary (if any) followed by every later turn. */
export function effectiveMessages<T extends TurnLike>(messages: readonly T[]): T[] {
  const i = lastSummaryIndex(messages);
  return i < 0 ? messages.slice() : messages.slice(i);
}

/** Rough token count (~4 characters per token, plus per-message overhead). */
export function estimateTokens(messages: readonly TurnLike[]): number {
  let chars = 0;
  for (const m of messages) chars += (m.content?.length ?? 0) + 16;
  return Math.ceil(chars / 4);
}

/** Number of user/assistant turns (summaries and other system turns don't count). */
export function turnCount(messages: readonly TurnLike[]): number {
  let n = 0;
  for (const m of messages) if (m.role === "user" || m.role === "assistant") n++;
  return n;
}

/** The token budget the meter uses: the workspace setting, never above what the Brain keeps. */
export function windowBudget(budgetTokens: number): number {
  const b = Number.isFinite(budgetTokens) ? budgetTokens : BRAIN_WINDOW_TOKENS;
  return Math.max(1, Math.min(b, BRAIN_WINDOW_TOKENS));
}

/**
 * Share (0-100) of the window the model will actually see: the worse of the
 * estimated tokens vs the budget and the turns vs the Brain's turn cap, over
 * the effective history (latest summary + later turns).
 */
export function contextUsagePct(messages: readonly TurnLike[], budgetTokens: number): number {
  const eff = effectiveMessages(messages);
  const byTokens = estimateTokens(eff) / windowBudget(budgetTokens);
  const byTurns = turnCount(eff) / BRAIN_MODEL_TURNS;
  return Math.min(100, Math.round(Math.max(byTokens, byTurns) * 100));
}

/**
 * Whether auto-compaction should run now: usage is at the threshold AND
 * folding frees a meaningful share of the window (tokens or turns). Without
 * the second check a kept tail that is over the threshold on its own would
 * re-trigger a summary of the summary after every answer.
 */
export function shouldAutoCompact(
  messages: readonly TurnLike[],
  budgetTokens: number,
  compactAtPct: number
): boolean {
  if (contextUsagePct(messages, budgetTokens) < compactAtPct) return false;
  const plan = planCompaction(messages);
  if (!plan) return false;
  const folded = plan.summarize.filter((m) => !isSummaryMessage(m));
  return (
    estimateTokens(folded) >= windowBudget(budgetTokens) * AUTO_COMPACT_MIN_FREED ||
    turnCount(folded) >= BRAIN_MODEL_TURNS * AUTO_COMPACT_MIN_FREED
  );
}

/**
 * Which messages to fold into a new summary, and where the summary goes.
 * Everything from the previous summary (inclusive, so it is re-summarized into
 * the new one) up to the kept tail is summarized; the tail starts at a user
 * turn so the kept context reads naturally. Returns null when there is too
 * little to be worth compacting.
 */
export function planCompaction<T extends TurnLike>(
  messages: readonly T[],
  keepRecent = KEEP_RECENT
): { summarize: T[]; insertAt: number } | null {
  const start = Math.max(0, lastSummaryIndex(messages));
  let insertAt = Math.max(start, messages.length - keepRecent);
  // Start the kept tail on a user turn (never split a question from its answer).
  while (insertAt < messages.length && messages[insertAt].role !== "user") insertAt++;
  if (insertAt <= start) return null;
  const summarize = messages
    .slice(start, insertAt)
    .filter((m) => m.role === "user" || m.role === "assistant" || isSummaryMessage(m));
  const turns = summarize.filter((m) => !isSummaryMessage(m));
  if (turns.length < 2) return null;
  return { summarize, insertAt };
}

/** The summary's explicit call-review filter line (the Brain's compact prompt puts it LAST). */
const FILTER_LINE_RE = /active call[- ]?review filter\s*[:=\-–—]/i;

/**
 * Clip a summary turn to `max` chars, keeping its head (the SUMMARY_PREFIX
 * marker the Brain checks) AND its trailing "Active call-review filter:" line,
 * which the Brain reads to resolve "audit them" after a compaction. Without an
 * explicit line, head + tail are kept (the most recent facts come last).
 */
export function clipSummary(content: string, max: number): string {
  if (content.length <= max) return content;
  const lines = content.split(/\r?\n/);
  let filterLine = "";
  for (let i = lines.length - 1; i >= 0; i--) {
    if (FILTER_LINE_RE.test(lines[i])) {
      filterLine = lines[i].trim().slice(0, 500);
      break;
    }
  }
  const suffix = filterLine
    ? `\n[…]\n${filterLine}`
    : `\n[…]\n${content.slice(content.length - Math.floor(max * 0.3))}`;
  return content.slice(0, Math.max(0, max - suffix.length)) + suffix;
}

/**
 * Recent history for a background job (deep audit): the latest summary, if
 * any, plus the last few user/assistant turns, each clipped. Lets the Brain
 * resolve "audit them" against what was discussed (a clipped summary keeps
 * its call-review filter line — see clipSummary).
 */
export function recentHistory(
  messages: readonly TurnLike[],
  max = 12,
  clip = 4000
): { role: "user" | "assistant" | "system"; content: string; createdAt?: string }[] {
  const eff = effectiveMessages(messages);
  const summary = isSummaryMessage(eff[0]) ? eff[0] : null;
  const turns = eff.filter((m) => m.role === "user" || m.role === "assistant");
  const room = summary ? max - 1 : max;
  const out: { role: "user" | "assistant" | "system"; content: string; createdAt?: string }[] = [];
  const at = (m: TurnLike) => {
    const t = iso(m.createdAt);
    return t ? { createdAt: t } : {};
  };
  if (summary) out.push({ role: "system", content: clipSummary(summary.content, clip), ...at(summary) });
  for (const m of turns.slice(-room)) {
    out.push({ role: m.role as "user" | "assistant", content: m.content.slice(0, clip), ...at(m) });
  }
  return out;
}
