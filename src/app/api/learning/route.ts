// POST /api/learning — the user confirmed a "Save as Organizational Learning?"
// card (or recorded a learning by hand). Forwards to the Brain's
// /api/v1/learning with the scoped key (server-side only) and returns the ref.

import { z } from "zod";
import { brainSaveLearning, safeBrainError } from "@/lib/brain";
import { getSessionProfile } from "@/lib/admin";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/ratelimit";
import { isDemo } from "@/lib/demo/mode";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const maxDuration = 60;

/** Per-user ceiling on learning saves (per instance — see lib/ratelimit). */
const LEARNING_LIMIT = { limit: 10, windowMs: 60_000 };

const schema = z.object({
  kind: z.enum(["decision", "implementation", "experiment", "result", "learning"]).default("learning"),
  title: z.string().trim().max(200).default(""),
  change: z.string().trim().max(4000).default(""),
  observedResult: z.string().trim().max(4000).optional().nullable(),
  department: z.string().trim().max(120).optional().nullable(),
  relatedRefs: z.array(z.string().trim().max(32)).max(10).default([]),
  missingEvidence: z.array(z.string().trim().max(300)).max(10).default([]),
  notes: z.string().trim().max(8000).optional().nullable(),
  conversationId: z.string().uuid().nullish(),
});

export async function POST(req: Request) {
  if (isDemo()) {
    return Response.json({ ref: "LRN-000", id: "demo", name: "Demo learning", recordType: "learning", status: "demo" });
  }
  const profile = await getSessionProfile();
  if (!profile) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const limited = rateLimit(`learning:${profile.userId}`, LEARNING_LIMIT.limit, LEARNING_LIMIT.windowMs);
  if (limited) return limited;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid request", detail: parsed.error.flatten() }, { status: 400 });
  const d = parsed.data;
  if (!d.title && !d.change) return Response.json({ error: "Nothing to save." }, { status: 400 });

  const upstream = await brainSaveLearning({
    kind: d.kind,
    title: d.title,
    change: d.change,
    observedResult: d.observedResult ?? undefined,
    department: d.department ?? undefined,
    relatedRefs: d.relatedRefs,
    missingEvidence: d.missingEvidence,
    notes: d.notes ?? undefined,
    createdBy: profile.email ?? profile.userId,
    source: "chat",
  });
  const json = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
  if (!upstream.ok) {
    // Upstream detail stays in the server log; the browser gets a safe message.
    console.error(`[learning] Brain request failed (${upstream.status}):`, json.error ?? json);
    return Response.json({ error: safeBrainError(upstream.status) }, { status: upstream.status || 502 });
  }
  void audit(profile.userId, "learning_saved", { kind: d.kind, ref: json.ref ?? null, conversationId: d.conversationId ?? null });
  return Response.json(json);
}
