// POST /api/chat — the chatbot's own endpoint.
//
// Forwards the conversation to the Brain's grounded, scoped /api/v1/chat and
// streams the answer back. The scoped Brain key stays server-side (see
// lib/brain). This route also:
//   1. resolves the signed-in user server-side and enforces their model/tier
//      permission BEFORE calling the Brain (a disallowed selection → 403), and
//   2. TEEs the upstream data stream — one branch goes to the browser UNCHANGED
//      (so useChat keeps working), the other is drained server-side to capture
//      finish-part token usage, which is written to usage_events (metering).
//
// Metering is best-effort: it is scheduled with `after()` and never blocks or
// breaks the response.

import { after } from "next/server";
import { brainChat, brainModelHeaders, type ModelSelection } from "@/lib/brain";
import { getSessionProfile } from "@/lib/admin";
import {
  fetchBrainModels,
  filterModelsByPermissions,
  type UserPermissions,
} from "@/lib/models";
import { meterStreamAndRecord, type UsageContext } from "@/lib/usage";
import { isDemo } from "@/lib/demo/mode";
import { demoChatStreamResponse } from "@/lib/demo/stream";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Tier aliases the Brain accepts in addition to concrete model ids. */
const TIER_WORDS = new Set(["fast", "recommended", "max"]);

/** A UUID (with a light shape check) or null — for the optional conversation id. */
function asUuid(v: unknown): string | null {
  return typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
    ? v
    : null;
}

/**
 * Decide whether `selection` (a tier alias or a concrete model id) is permitted
 * for a user with these permissions. Mirrors lib/models filterModelsByPermissions
 * semantics: an absent allowlist is NOT a lockout.
 *
 * Fast paths avoid a catalog fetch (and so never delay the common request):
 * unrestricted users and tier requests are decided from permissions alone; only
 * a concrete model id from a restricted user consults the catalog.
 */
async function isSelectionAllowed(
  selection: string,
  perms: UserPermissions,
  canUseAllModels: boolean
): Promise<boolean> {
  if (canUseAllModels) return true;

  const sel = selection.toLowerCase();

  // Tier alias → gated only by allowed_tiers (absent = unrestricted).
  if (TIER_WORDS.has(sel)) {
    const tiers = perms.allowed_tiers;
    if (!Array.isArray(tiers) || tiers.length === 0) return true;
    return (tiers as readonly string[]).includes(sel);
  }

  // Concrete model id. With no model/tier restriction, any id the Brain accepts
  // is allowed; otherwise the id must survive the permission filter.
  const hasModelAllow = Array.isArray(perms.models) && perms.models.length > 0;
  const hasTierAllow = Array.isArray(perms.allowed_tiers) && perms.allowed_tiers.length > 0;
  if (!hasModelAllow && !hasTierAllow) return true;

  const catalog = await fetchBrainModels();
  const allowed = filterModelsByPermissions(catalog, perms, canUseAllModels);
  return allowed.some((m) => m.id.toLowerCase() === sel);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { messages, tier, model } = body ?? {};

  // DEMO MODE: don't call the Brain or meter — stream a canned grounded answer.
  if (isDemo()) {
    const last = [...(messages ?? [])].reverse().find((m: any) => m.role === "user");
    return demoChatStreamResponse(last?.content ?? "");
  }

  // 1. Identity + permissions, resolved SERVER-SIDE from the session.
  const profile = await getSessionProfile();
  if (!profile) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The client requests a tier ("fast"|"recommended"|"max") or a concrete model
  // id; prefer an explicit model, else the tier, else the default tier.
  const selection: ModelSelection =
    (typeof model === "string" && model.trim()) ||
    (typeof tier === "string" && tier.trim()) ||
    "recommended";

  // 2. Enforce the user's model/tier permission BEFORE hitting the Brain.
  const allowed = await isSelectionAllowed(
    selection,
    profile.permissions,
    profile.canUseAllModels
  );
  if (!allowed) {
    return Response.json(
      { error: `"${selection}" is not permitted for your account.` },
      { status: 403 }
    );
  }

  // 3. Call the Brain (scoped key stays server-side inside brainChat).
  const startedAt = Date.now();
  const upstream = await brainChat(messages ?? [], selection);

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return Response.json(
      { error: "Brain request failed", status: upstream.status, detail },
      { status: upstream.status || 502 }
    );
  }

  // 4. TEE the upstream stream: `clientStream` is returned to the browser
  //    UNCHANGED (so useChat parses it normally and time-to-first-token is not
  //    delayed by metering); `meterStream` is a fully independent copy we drain
  //    server-side to read the finish-part token usage. Reading one branch never
  //    blocks the other, so the client is never held up.
  const [clientStream, meterStream] = upstream.body.tee();

  const { model: resolvedModel, provider } = brainModelHeaders(upstream);
  const ctx: UsageContext = {
    userId: profile.userId,
    teamId: profile.team?.id ?? null,
    conversationId: asUuid(body?.conversationId ?? body?.conversation_id),
    provider,
    model: resolvedModel,
    tier: String(selection),
    startedAt,
  };

  // Write exactly one usage_events row after the response has streamed out.
  // `after()` keeps the function alive for this best-effort work without
  // delaying the response; meterStreamAndRecord never throws.
  after(() => meterStreamAndRecord(meterStream, ctx));

  // Pass the Brain's data-stream response straight through to the client.
  return new Response(clientStream, {
    status: 200,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ?? "text/plain; charset=utf-8",
      "x-vercel-ai-data-stream": upstream.headers.get("x-vercel-ai-data-stream") ?? "v1",
    },
  });
}
