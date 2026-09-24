// POST /api/jobs — start a deep-audit background job (proxies to the Brain with
// the scoped key). The chat screen then shows its live progress. Auth'd to the
// signed-in user; demo returns a fake running job so the card is visible.

import { getSessionProfile } from "@/lib/admin";
import { brainStartAudit, BrainRequestError } from "@/lib/brain";
import { rateLimit } from "@/lib/ratelimit";
import { isDemo } from "@/lib/demo/mode";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const maxDuration = 120;

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
  const limited = rateLimit(`jobs:${profile.userId}`, 10, 60_000);
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as { query?: string };
  if (!body.query?.trim()) return Response.json({ error: "Provide a query." }, { status: 400 });

  try {
    const job = await brainStartAudit(body.query.trim());
    return Response.json({ job }, { status: 201 });
  } catch (e) {
    if (e instanceof BrainRequestError) {
      return Response.json({ error: e.message }, { status: e.status >= 500 ? 502 : e.status });
    }
    return Response.json({ error: "Could not start the audit." }, { status: 502 });
  }
}
