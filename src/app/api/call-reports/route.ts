import { z } from "zod";
import { getSessionProfile } from "@/lib/admin";
import { accessFromProfile, effectiveCapabilities, allowedSourceTypes, SENSITIVE_SOURCE_TYPES } from "@/lib/access";
import { brainCallReport, safeBrainError, fetchBrainKnowledgeScopes } from "@/lib/brain";
import { isKnownKnowledgeScope, KNOWLEDGE_SCOPE_ID_RE, resolveKnowledgeScope } from "@/lib/knowledge-scopes";
import { timeZoneOrUndefined } from "@/lib/timezone";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const maxDuration = 30;
const schema = z.object({
  query: z.string().trim().min(1).max(8000), version: z.string().max(128).optional(),
  waitMs: z.number().int().min(0).max(20_000).default(0),
  timeZone: z.unknown().optional().transform(timeZoneOrUndefined),
  knowledgeScope: z.string().trim().regex(KNOWLEDGE_SCOPE_ID_RE).optional(),
  collectionIds: z.array(z.string().uuid()).max(50).optional(),
});
const headers = { "cache-control": "private, no-store" };

export async function POST(req: Request) {
  const profile = await getSessionProfile();
  if (!profile) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const access = accessFromProfile(profile);
  const capabilities = effectiveCapabilities(access);
  const sourceTypes = allowedSourceTypes(access);
  if (!capabilities.includes("chat.knowledge") || !capabilities.includes("chat.call_review") || (sourceTypes && !sourceTypes.includes("transcript"))) {
    return Response.json({ error: "Live call reports are not enabled for your account." }, { status: 403, headers });
  }
  const limited = rateLimit(`call-reports:${profile.userId}`, 60, 60_000);
  if (limited) return limited;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid live report request" }, { status: 400, headers });
  const body = parsed.data;
  const canScope = capabilities.includes("chat.source_scope");
  const requestedScope = canScope ? body.knowledgeScope : undefined;
  const knowledgeScope = resolveKnowledgeScope(requestedScope, { allowedSourceTypes: sourceTypes, sensitiveSourceTypes: SENSITIVE_SOURCE_TYPES,
    available: requestedScope && !isKnownKnowledgeScope(requestedScope) ? await fetchBrainKnowledgeScopes() : null });
  try {
    const response = await brainCallReport({ query: body.query, version: body.version, waitMs: body.waitMs, timeZone: body.timeZone,
      capabilities, sourceTypes, knowledgeScope, collectionIds: canScope ? body.collectionIds : undefined }, req.signal);
    if (!response.ok) return Response.json({ error: safeBrainError(response.status) }, { status: response.status, headers });
    return new Response(response.body, { headers: { ...headers, "content-type": "application/json" } });
  } catch {
    if (req.signal.aborted) return new Response(null, { status: 499, headers });
    return Response.json({ error: "Live updates are reconnecting. The saved report is historical." }, { status: 503, headers });
  }
}
