// POST /api/jobs — start a deep-audit background job (proxies to the Brain with
// the scoped key). The chat screen then shows its live progress. Auth'd to the
// signed-in user holding the "jobs.deep_audit" capability (else 403); demo
// returns a fake running job so the card is visible.
//
// Body: { query: string, history?: { role, content }[] }. `history` is the
// recent conversation (bounded below) so the Brain can resolve a follow-up like
// "audit those calls"; it is forwarded as data, never as instructions.

import { z } from "zod";
import { getSessionProfile } from "@/lib/admin";
import { accessFromProfile, hasCapability } from "@/lib/access";
import { brainStartAudit, BrainRequestError } from "@/lib/brain";
import { rateLimit } from "@/lib/ratelimit";
import { isDemo } from "@/lib/demo/mode";
import { isoOrUndefined } from "@/lib/message-times";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const maxDuration = 120;

/** Most recent turns a caller may send along with the audit request. */
const MAX_HISTORY = 12;
/** Longest single history turn (characters). */
const MAX_HISTORY_CHARS = 4000;

// Authenticated-but-untrusted body: bounded so a client can't forward an
// unbounded payload to the Brain on the scoped key. Unknown fields are stripped.
const jobBodySchema = z.object({
  query: z.string().trim().min(1).max(8000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string().max(MAX_HISTORY_CHARS),
        createdAt: z.unknown().optional().transform(isoOrUndefined),
      })
    )
    .max(MAX_HISTORY)
    .optional(),
});

export async function POST(req: Request) {
  if (isDemo()) {
    const body = (await req.json().catch(() => ({}))) as { query?: string };
    return Response.json(
      { job: { id: "demo-job", title: `Deep audit — ${body.query ?? "calls"}`, status: "running", total_tasks: 4 } },
      { status: 201 }
    );
  }
  const profile = await getSessionProfile();
  if (!profile) return Response.json({ error: "Unauthorized" }, { status: 401 });
  // A deep audit reads every matching call transcript: it needs the
  // "jobs.deep_audit" capability (sensitive; off for members unless granted).
  if (!hasCapability(accessFromProfile(profile), "jobs.deep_audit")) {
    return Response.json({ error: "Deep audits aren't enabled for your account." }, { status: 403 });
  }
  const limited = rateLimit(`jobs:${profile.userId}`, 10, 60_000);
  if (limited) return limited;

  const raw = (await req.json().catch(() => ({}))) as { query?: unknown };
  if (typeof raw?.query !== "string" || !raw.query.trim()) {
    return Response.json({ error: "Provide a query." }, { status: 400 });
  }
  const parsed = jobBodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      {
        error: `Invalid request: the query must be under 8,000 characters and history at most ${MAX_HISTORY} messages of up to ${MAX_HISTORY_CHARS.toLocaleString("en-US")} characters each.`,
      },
      { status: 400 }
    );
  }
  // Drop empty turns; forward only { role, content }.
  const history = (parsed.data.history ?? []).filter((m) => m.content.trim());

  try {
    const job = await brainStartAudit(parsed.data.query, history.length ? history : undefined);
    return Response.json({ job }, { status: 201 });
  } catch (e) {
    if (e instanceof BrainRequestError) {
      return Response.json({ error: e.message }, { status: e.status >= 500 ? 502 : e.status });
    }
    return Response.json({ error: "Could not start the audit." }, { status: 502 });
  }
}
