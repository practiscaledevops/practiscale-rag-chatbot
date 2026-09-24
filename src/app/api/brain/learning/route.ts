// GET /api/brain/learning — the org's learning records (My learnings page).
//
// Proxies the Brain's /api/v1/learning with the scoped key server-side. Needs
// the "learning.read" capability (on for everyone by default — the records are
// the org's shared memory; the sensitive partition doesn't apply here).

import { z } from "zod";
import { getSessionProfile } from "@/lib/admin";
import { accessFromProfile, hasCapability } from "@/lib/access";
import { brainListLearning, BrainRequestError, safeBrainError } from "@/lib/brain";
import { rateLimit } from "@/lib/ratelimit";
import { isDemo } from "@/lib/demo/mode";
import { demoLearningList } from "@/lib/demo/brain";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";

const CACHE_HEADERS = { "cache-control": "private, max-age=15" };

/** Per-user ceiling across the /api/brain/* proxies (per instance — see lib/ratelimit). */
const BRAIN_PROXY_LIMIT = { limit: 60, windowMs: 60_000 };

const querySchema = z.object({
  status: z.string().trim().max(40).optional(),
  type: z.string().trim().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export async function GET(req: Request) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) {
    return Response.json({ error: "Invalid query", detail: parsed.error.flatten() }, { status: 400 });
  }
  const params = {
    status: parsed.data.status || undefined,
    type: parsed.data.type || undefined,
    limit: parsed.data.limit,
    offset: parsed.data.offset,
  };

  if (isDemo()) return Response.json(demoLearningList(params), { headers: CACHE_HEADERS });

  const profile = await getSessionProfile();
  if (!profile) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasCapability(accessFromProfile(profile), "learning.read")) {
    return Response.json({ error: "Learnings aren't enabled for your account." }, { status: 403 });
  }
  const limited = rateLimit(`brain:${profile.userId}`, BRAIN_PROXY_LIMIT.limit, BRAIN_PROXY_LIMIT.windowMs);
  if (limited) return limited;

  try {
    const data = await brainListLearning(params);
    return Response.json(data, { headers: CACHE_HEADERS });
  } catch (e) {
    // Upstream detail stays in the server log; the browser gets a safe message.
    const status = e instanceof BrainRequestError ? e.status : 502;
    console.error(`[brain/learning] request failed (${status}):`, e instanceof Error ? e.message : e);
    return Response.json({ error: safeBrainError(status) }, { status: status >= 500 ? 502 : status });
  }
}
