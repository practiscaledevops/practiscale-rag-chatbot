// POST /api/compact — summarize a long conversation so the chat can carry it
// forward as one "[Conversation summary]" system turn instead of every message.
//
// Body:     { messages: { role: "user" | "assistant" | "system", content }[],
//             timeZone?: string }
//           (1–200 turns, each ≤ 40,000 characters; `timeZone` is the user's
//           IANA zone from lib/timezone effectiveTimeZone, so dates in the recap
//           are read in the user's day; an unusable zone is dropped)
// Response: { summary: string }
//
// Signed-in users holding the "chat.compaction" capability only (else 403);
// the Brain's POST /api/v1/compact is called server-side
// with the scoped key (lib/brain → brainCompact). Message content is untrusted
// user data — forwarded as data to summarize, never as instructions. Demo mode
// returns a summary built locally from the messages (no Brain call).

import { z } from "zod";
import { getSessionProfile } from "@/lib/admin";
import { accessFromProfile, hasCapability } from "@/lib/access";
import { brainCompact, BrainRequestError, safeBrainError } from "@/lib/brain";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/ratelimit";
import { isDemo } from "@/lib/demo/mode";
import { timeZoneOrUndefined } from "@/lib/timezone";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
// Must cover brainCompact's timeout (110s): summarizing is one model call.
export const maxDuration = 120;

/** Per-user ceiling on compactions (per instance — see lib/ratelimit). */
const COMPACT_LIMIT = { limit: 10, windowMs: 60_000 };

const compactBodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string().max(40_000),
      })
    )
    .min(1)
    .max(200),
  // A valid IANA zone (canonical casing), else undefined: never a 400.
  timeZone: z.unknown().optional().transform(timeZoneOrUndefined),
});

type CompactMessage = z.infer<typeof compactBodySchema>["messages"][number];

/** Collapse whitespace and clip to `max` characters (with an ellipsis). */
function oneLine(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** Demo: a readable recap built locally from the turns (no model call). */
function demoSummary(messages: CompactMessage[]): string {
  const turns = messages.filter((m) => m.role !== "system" && m.content.trim());
  const asked = turns.filter((m) => m.role === "user").slice(-6);
  const lastAnswer = [...turns].reverse().find((m) => m.role === "assistant");
  const lines = [
    `Recap of the earlier conversation (${turns.length} message${turns.length === 1 ? "" : "s"}, demo summary).`,
  ];
  if (asked.length) {
    lines.push("", "Questions and requests so far:");
    for (const m of asked) lines.push(`- ${oneLine(m.content, 160)}`);
  }
  if (lastAnswer) {
    lines.push("", `Latest answer, in short: ${oneLine(lastAnswer.content, 280)}`);
  }
  return lines.join("\n");
}

export async function POST(req: Request) {
  // DEMO MODE: no session or Brain — return a locally built summary.
  if (isDemo()) {
    const parsed = compactBodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ error: "Provide 1–200 messages to compact." }, { status: 400 });
    }
    return Response.json({ summary: demoSummary(parsed.data.messages) });
  }

  // Identity resolved SERVER-SIDE before the (untrusted) body is read.
  const profile = await getSessionProfile();
  if (!profile) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasCapability(accessFromProfile(profile), "chat.compaction")) {
    return Response.json({ error: "Long-chat compaction isn't enabled for your account." }, { status: 403 });
  }

  const limited = rateLimit(`compact:${profile.userId}`, COMPACT_LIMIT.limit, COMPACT_LIMIT.windowMs);
  if (limited) return limited;

  const parsed = compactBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request: send 1–200 messages of up to 40,000 characters each." },
      { status: 400 }
    );
  }
  // Only { role, content } goes upstream; empty turns carry nothing to summarize.
  const messages = parsed.data.messages.filter((m) => m.content.trim());
  if (!messages.length) {
    return Response.json({ error: "There's nothing to compact yet." }, { status: 400 });
  }

  void audit(profile.userId, "compact", { messages: messages.length });

  try {
    const summary = await brainCompact(messages, parsed.data.timeZone);
    return Response.json({ summary });
  } catch (e) {
    if (e instanceof BrainRequestError) {
      // Upstream detail is logged here only; the browser gets a safe message.
      console.error(`[compact] Brain request failed (${e.status}):`, e.message.slice(0, 500));
      // A Brain-side 401/403 is about THIS APP's key, not the user's session —
      // answer 502 so the browser never mistakes it for being signed out.
      const status = e.status === 429 ? 429 : 502;
      const error =
        e.status === 401 || e.status === 403 || e.status === 429
          ? safeBrainError(e.status)
          : "Couldn't compact this conversation right now. Try again shortly.";
      return Response.json({ error }, { status });
    }
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    if (!timedOut) console.error("[compact] failed:", e instanceof Error ? e.message : e);
    return Response.json(
      {
        error: timedOut
          ? "Compacting took too long. Try again in a moment."
          : "Couldn't compact this conversation right now. Try again shortly.",
      },
      { status: timedOut ? 504 : 502 }
    );
  }
}
