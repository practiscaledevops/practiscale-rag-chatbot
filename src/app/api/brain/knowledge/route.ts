// GET /api/brain/knowledge — browse the Brain's knowledge objects (Brain map).
//
// Proxies the Brain's public /api/v1/knowledge with the scoped key kept
// server-side. Needs the "knowledge.map" capability AND "data.document"
// (company knowledge — the same grant /api/chat retrieves by). The `sensitive` flag is
// decided HERE from the signed-in user's capabilities (every sensitive data.*
// source granted) — never from the browser — so a regular team member can't
// list the restricted objects by flipping a param.

import { z } from "zod";
import { getSessionProfile } from "@/lib/admin";
import { accessFromProfile, canAccessSensitive, hasCapability } from "@/lib/access";
import { brainListKnowledge, BrainRequestError, safeBrainError } from "@/lib/brain";
import { rateLimit } from "@/lib/ratelimit";
import { isDemo } from "@/lib/demo/mode";
import { demoKnowledgeList } from "@/lib/demo/brain";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";

/** Short private cache: the map is browsed interactively; the data changes slowly. */
const CACHE_HEADERS = { "cache-control": "private, max-age=15" };

/** Per-user ceiling across the /api/brain/* proxies (per instance — see lib/ratelimit). */
const BRAIN_PROXY_LIMIT = { limit: 60, windowMs: 60_000 };

// Bounded, authenticated-but-untrusted query. Filters are short ids; the free
// text search is capped; paging can't sweep the whole org in one call.
const querySchema = z.object({
  class: z.string().trim().max(40).optional(),
  domain: z.string().trim().max(40).optional(),
  type: z.string().trim().max(40).optional(),
  q: z.string().trim().max(200).optional(),
  includeArchive: z.enum(["0", "1"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export async function GET(req: Request) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) {
    return Response.json({ error: "Invalid query", detail: parsed.error.flatten() }, { status: 400 });
  }
  const params = {
    class: parsed.data.class || undefined,
    domain: parsed.data.domain || undefined,
    type: parsed.data.type || undefined,
    q: parsed.data.q || undefined,
    includeArchive: parsed.data.includeArchive === "1",
    limit: parsed.data.limit,
    offset: parsed.data.offset,
  };

  if (isDemo()) return Response.json(demoKnowledgeList(params), { headers: CACHE_HEADERS });

  const profile = await getSessionProfile();
  if (!profile) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const access = accessFromProfile(profile);
  if (!hasCapability(access, "knowledge.map")) {
    return Response.json({ error: "The Brain map isn't enabled for your account." }, { status: 403 });
  }
  // The map lists company-knowledge objects: an admin who switched off
  // "data.document" for this user (so /api/chat retrieves none of it) must not
  // have that content listed here either. The Brain can't filter objects by
  // source type yet, so the gate is here.
  if (!hasCapability(access, "data.document")) {
    return Response.json({ error: "Company knowledge isn't enabled for your account." }, { status: 403 });
  }
  const limited = rateLimit(`brain:${profile.userId}`, BRAIN_PROXY_LIMIT.limit, BRAIN_PROXY_LIMIT.windowMs);
  if (limited) return limited;
  const sensitive = canAccessSensitive(access);

  try {
    const data = await brainListKnowledge(params, sensitive);
    return Response.json(data, { headers: CACHE_HEADERS });
  } catch (e) {
    // Upstream detail stays in the server log; the browser gets a safe message.
    const status = e instanceof BrainRequestError ? e.status : 502;
    console.error(`[brain/knowledge] request failed (${status}):`, e instanceof Error ? e.message : e);
    return Response.json({ error: safeBrainError(status) }, { status: status >= 500 ? 502 : status });
  }
}
