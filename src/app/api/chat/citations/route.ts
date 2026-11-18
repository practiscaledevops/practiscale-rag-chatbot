import { z } from "zod";
import { accessFromProfile, allowedSourceTypes, effectiveCapabilities } from "@/lib/access";
import { getSessionProfile } from "@/lib/admin";
import { brainGetCitation } from "@/lib/brain";
import { DEMO_USER_ID } from "@/lib/demo/fixtures";
import { isDemo } from "@/lib/demo/mode";
import { demoCitation } from "@/lib/demo/stream";
import { ghlOpportunityId, withGhlOpportunityCitations } from "@/lib/ghl-citations";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const citationId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})?$/i;
const headers = { "cache-control": "no-store" };
const unavailable = () => Response.json({ error: "Source unavailable" }, { status: 404, headers });

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const conversationId = params.get("conversationId");
  const requestedId = params.get("id") ?? "";
  const opportunityId = ghlOpportunityId(requestedId);
  const id = opportunityId ? requestedId : requestedId.toLowerCase();
  if ((!opportunityId && !citationId.test(id)) || !conversationId) return unavailable();

  const demo = isDemo();
  const profile = demo ? null : await getSessionProfile();
  if (!demo && !profile) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  if (demo ? !/^[a-z0-9-]{1,64}$/i.test(conversationId) : !z.string().uuid().safeParse(conversationId).success) return unavailable();
  const access = profile ? accessFromProfile(profile) : undefined;
  const capabilities = access ? effectiveCapabilities(access) : undefined;
  if (capabilities && !capabilities.includes("chat.knowledge")) return unavailable();
  const grantedSources = access ? allowedSourceTypes(access) : undefined;
  const sourceTypes = opportunityId ? grantedSources : grantedSources?.filter(type => type === "document" || type === "call_score");
  if (opportunityId) {
    if (!demo && (process.env.SOURCE_REPORTS_ENABLED !== "true" || !capabilities?.includes("chat.call_review") ||
      (sourceTypes && !sourceTypes.includes("transcript")))) return unavailable();
  } else if (sourceTypes?.length === 0) return unavailable();
  const userId = profile?.userId ?? DEMO_USER_ID;
  const limited = rateLimit(`chat-citations:${userId}`, 60, 60_000);
  if (limited) return limited;

  try {
    const db = await createSupabaseServerClient();
    const { data: conversation } = await db.from("conversations").select("id")
      .eq("id", conversationId).eq("user_id", userId).maybeSingle();
    if (!conversation) return unavailable();

    // Look at the saved answer text so older chats and server-saved turns
    // with no populated citations column work too.
    const query = db.from("messages").select("content").eq("conversation_id", conversationId).eq("role", "assistant");
    const marker = `[${id}]`;
    const { data: rows, error } = await (demo ? query : opportunityId
      ? query.like("content", `%${opportunityId.replaceAll("_", "\\_")}%`)
      : query.ilike("content", `%${marker}%`).limit(1));
    if (error || !rows?.some(row => row.content && (opportunityId
      ? withGhlOpportunityCitations(row.content).includes(marker)
      : row.content.toLowerCase().includes(marker)))) return unavailable();

    const demoUrl = process.env.LOCAL_BRAIN_REPORT_DEMO_URL;
    const loopbackUrl = demo && process.env.NODE_ENV !== "production" && /^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(demoUrl ?? "")
      ? demoUrl : undefined;
    if (demo && !loopbackUrl) {
      const source = demoCitation(id);
      return source ? Response.json(source, { headers }) : unavailable();
    }
    let sourceUserToken: string | undefined;
    if (opportunityId && !demo) {
      const { data: { session } } = await db.auth.getSession();
      if (!session?.access_token) return unavailable();
      sourceUserToken = session.access_token;
    }
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(opportunityId ? 12000 : 6000)]);
    const upstream = sourceUserToken
      ? await brainGetCitation(id, signal, sourceTypes, undefined, sourceUserToken)
      : await brainGetCitation(id, signal, sourceTypes, loopbackUrl);
    if (upstream.status === 404 || upstream.status === 403) return unavailable();
    if (upstream.ok) return Response.json(await upstream.json(), { headers });
  } catch {
    // Keep internal data and temporary upstream failures out of the preview.
  }
  return Response.json({ error: "Could not load the source" }, { status: 502, headers });
}
