// Server-only: per-turn usage metering for chat.
//
// After a Brain chat settles we write ONE row to public.usage_events (the
// chatbot's OWN database) capturing tokens + estimated cost for the per-user
// usage meter and the admin/team analytics. This module owns:
//   • parsing the Vercel AI SDK v4 data-stream to recover the finish-part token
//     usage ({ promptTokens, completionTokens }),
//   • draining a TEE'd copy of the stream WITHOUT touching the client branch, and
//   • the service-role INSERT, which is best-effort and NEVER throws.
//
// It uses the SERVICE-ROLE client (usage_events has no user-facing INSERT policy
// — see supabase/setup/admin.sql), so this file must never be imported into a
// client component. cost_usd is an ESTIMATE from lib/pricing.ts.

import { createSupabaseServiceClient } from "@/lib/supabase-server";
import { costUsd } from "@/lib/pricing";

/** Token counts recovered from the stream's finish part. */
export interface FinishUsage {
  promptTokens: number;
  completionTokens: number;
}

/**
 * Everything needed to write one usage_events row, resolved by the route BEFORE
 * the stream is metered (identity, selection, provider/model headers, timing).
 * Token counts are filled in from the stream itself.
 */
export interface UsageContext {
  userId: string;
  /** the user's primary team, or null */
  teamId: string | null;
  /** conversation this turn belongs to, if the client supplied one */
  conversationId: string | null;
  /** resolved provider from the Brain's x-provider header, or null */
  provider: string | null;
  /** resolved model id from the Brain's x-model header; falls back to `tier` */
  model: string | null;
  /** the tier/model the client requested ("fast"|"recommended"|"max"|concrete id) */
  tier: string;
  /** wall-clock start of the Brain call (Date.now()), for latency_ms */
  startedAt: number;
}

// The finish parts of an AI SDK v4 data stream are tiny and always the LAST
// lines emitted, so we only need to inspect the tail. Cap the retained text so
// a long answer never grows this buffer without bound.
const TAIL_CAP = 32_768;

/** Coerce an unknown JSON number to a non-negative integer, or 0. */
function toCount(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Pull token usage out of AI SDK v4 data-stream text. The stream is newline-
 * delimited `<prefix>:<json>` parts; the finish-message part `d:` and the
 * finish-step part `e:` both carry `{ usage: { promptTokens, completionTokens } }`.
 * We prefer the LAST `d:` (aggregate finish message) and fall back to the last
 * `e:` (final step). Returns null if no usage is present (e.g. client aborted
 * before the stream finished).
 */
export function parseFinishUsage(streamText: string): FinishUsage | null {
  const lines = streamText.split("\n");
  let fromD: FinishUsage | null = null;
  let fromE: FinishUsage | null = null;

  for (const line of lines) {
    const prefix = line.slice(0, 2);
    if (prefix !== "d:" && prefix !== "e:") continue;
    try {
      const part = JSON.parse(line.slice(2));
      const usage = part?.usage;
      if (!usage) continue;
      const parsed: FinishUsage = {
        promptTokens: toCount(usage.promptTokens),
        completionTokens: toCount(usage.completionTokens),
      };
      // Keep the last occurrence of each kind (streams end with the final part).
      if (prefix === "d:") fromD = parsed;
      else fromE = parsed;
    } catch {
      /* not a JSON finish part — ignore */
    }
  }

  return fromD ?? fromE;
}

/**
 * Write ONE usage_events row via the service-role client. Best-effort and
 * fire-and-forget: any failure (missing service key, RLS, network) is swallowed
 * and logged so metering can NEVER block or break the chat response.
 */
export async function recordUsageEvent(
  ctx: UsageContext,
  usage: FinishUsage
): Promise<void> {
  try {
    // Cost is estimated against the RESOLVED model id when known, else the
    // requested tier/model string (pricing.ts falls back sensibly on unknowns).
    const model = ctx.model ?? ctx.tier;
    const inputTokens = usage.promptTokens;
    const outputTokens = usage.completionTokens;

    const service = createSupabaseServiceClient();
    const { error } = await service.from("usage_events").insert({
      user_id: ctx.userId,
      team_id: ctx.teamId,
      conversation_id: ctx.conversationId,
      provider: ctx.provider,
      model,
      tier: ctx.tier,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: costUsd(model, inputTokens, outputTokens),
      latency_ms: Math.max(0, Date.now() - ctx.startedAt),
    });
    if (error) {
      console.error("[usage] insert failed:", error.message);
    }
  } catch (err) {
    console.error("[usage] metering error:", err);
  }
}

/**
 * Drain a TEE'd copy of the Brain's data stream, recover the finish-part token
 * usage, and record the usage_events row. This reads a SEPARATE ReadableStream
 * branch, so it never delays or alters the branch piped to the browser. Meant to
 * be scheduled with next/server `after()` so it runs without blocking the
 * response. Always resolves (never throws).
 */
export async function meterStreamAndRecord(
  meterStream: ReadableStream<Uint8Array>,
  ctx: UsageContext
): Promise<void> {
  try {
    const reader = meterStream.getReader();
    const decoder = new TextDecoder();
    let tail = "";

    // Accumulate only the tail — the finish parts are always the final lines.
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      tail += decoder.decode(value, { stream: true });
      if (tail.length > TAIL_CAP) tail = tail.slice(-TAIL_CAP);
    }
    tail += decoder.decode();

    const usage = parseFinishUsage(tail);
    if (!usage) return; // aborted / no finish part — nothing to meter
    await recordUsageEvent(ctx, usage);
  } catch (err) {
    console.error("[usage] metering stream error:", err);
  }
}
