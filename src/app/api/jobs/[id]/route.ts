// GET /api/jobs/[id] — a job's live progress (proxies to the Brain). Polled by
// the on-chat progress card. Demo returns a synthetic run that advances.
// A deep audit's result carries per-call findings from transcripts, so reading
// one needs the "jobs.deep_audit" capability (sensitive; off for members).

import { getSessionProfile } from "@/lib/admin";
import { accessFromProfile, hasCapability } from "@/lib/access";
import { brainJobProgress, BrainRequestError } from "@/lib/brain";
import { isDemo } from "@/lib/demo/mode";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  if (isDemo()) {
    // Advance ~1 task every 3s so the demo card visibly progresses, then finishes.
    const elapsed = Math.floor(Date.now() / 3000) % 6;
    const done = Math.min(4, elapsed);
    const status = done >= 4 ? "completed" : "running";
    return Response.json({
      job: {
        id,
        title: "Deep audit — demo",
        status,
        total_tasks: 4,
        completed_tasks: done,
        failed_tasks: 0,
        result: status === "completed" ? { totalCalls: 32, consultants: [{ name: "James Ephrim", calls: 12, avgScore: 21 }] } : null,
        finished_at: status === "completed" ? new Date().toISOString() : null,
      },
      tasks: Array.from({ length: 4 }, (_, i) => ({ idx: i, label: `Batch ${i + 1}: 8 calls`, status: i < done ? "completed" : i === done ? "running" : "queued" })),
    });
  }

  const profile = await getSessionProfile();
  if (!profile) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasCapability(accessFromProfile(profile), "jobs.deep_audit")) {
    return Response.json({ error: "Deep audits aren't enabled for your account." }, { status: 403 });
  }
  try {
    return Response.json(await brainJobProgress(id));
  } catch (e) {
    if (e instanceof BrainRequestError) {
      return Response.json({ error: e.message }, { status: e.status >= 500 ? 502 : e.status });
    }
    return Response.json({ error: "Could not read job progress." }, { status: 502 });
  }
}
