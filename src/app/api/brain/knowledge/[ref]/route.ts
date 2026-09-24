// GET /api/brain/knowledge/[ref] — one knowledge object for the object drawer.
//
// Proxies the Brain's /api/v1/knowledge/{ref} (scoped key server-side). Opens
// objects from the Brain map ("knowledge.map") and the ones cited in an answer
// ("chat.knowledge"), so either capability suffices — plus "data.document"
// (company knowledge), the grant /api/chat retrieves this content by. The
// `sensitive` flag comes from the signed-in user's capabilities, never the
// browser; the Brain answers 404 for an object this user may not see, which we
// pass on.
//
// A chat-only caller (no "knowledge.map") gets the object itself but NOT its
// relationships, so the map can't be walked one object at a time around a
// denied map; linked learning records need "learning.read".

import { getSessionProfile } from "@/lib/admin";
import { accessFromProfile, canAccessSensitive, effectiveCapabilities } from "@/lib/access";
import { brainGetKnowledge, BrainRequestError, safeBrainError } from "@/lib/brain";
import { rateLimit } from "@/lib/ratelimit";
import { isDemo } from "@/lib/demo/mode";
import { demoKnowledgeDetail } from "@/lib/demo/brain";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";

const CACHE_HEADERS = { "cache-control": "private, max-age=15" };

/** Per-user ceiling across the /api/brain/* proxies (per instance — see lib/ratelimit). */
const BRAIN_PROXY_LIMIT = { limit: 60, windowMs: 60_000 };

/** Refs look like MG-001 / LRN-004; anything else is rejected before the Brain sees it. */
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ref: string }> }
) {
  const { ref } = await params;
  if (!REF_RE.test(ref)) return Response.json({ error: "Invalid ref" }, { status: 400 });

  if (isDemo()) {
    const data = demoKnowledgeDetail(ref);
    return data
      ? Response.json(data, { headers: CACHE_HEADERS })
      : Response.json({ error: "Not found" }, { status: 404 });
  }

  const profile = await getSessionProfile();
  if (!profile) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const access = accessFromProfile(profile);
  const caps = effectiveCapabilities(access);
  const viaMap = caps.includes("knowledge.map");
  const viaChat = caps.includes("chat.knowledge");
  if ((!viaMap && !viaChat) || !caps.includes("data.document")) {
    return Response.json({ error: "The Brain map isn't enabled for your account." }, { status: 403 });
  }
  const limited = rateLimit(`brain:${profile.userId}`, BRAIN_PROXY_LIMIT.limit, BRAIN_PROXY_LIMIT.windowMs);
  if (limited) return limited;
  const sensitive = canAccessSensitive(caps);

  try {
    const data = await brainGetKnowledge(ref, sensitive);
    if (!data) return Response.json({ error: "Not found" }, { status: 404 });
    // Strip what this caller's capabilities don't cover (see the header).
    const body = {
      ...data,
      relationships: viaMap ? data.relationships : [],
      learning: caps.includes("learning.read") ? data.learning : [],
    };
    return Response.json(body, { headers: CACHE_HEADERS });
  } catch (e) {
    // Upstream detail stays in the server log; the browser gets a safe message.
    const status = e instanceof BrainRequestError ? e.status : 502;
    console.error(`[brain/knowledge/ref] request failed (${status}):`, e instanceof Error ? e.message : e);
    return Response.json({ error: safeBrainError(status) }, { status: status >= 500 ? 502 : status });
  }
}
