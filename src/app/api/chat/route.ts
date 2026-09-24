// POST /api/chat — the chatbot's own endpoint.
//
// Forwards the conversation to the Brain's grounded, scoped /api/v1/chat and
// streams the answer back. The scoped Brain key stays server-side (see
// lib/brain). This route also:
//   1. resolves the signed-in user server-side and enforces their capabilities
//      ("chat.knowledge" to chat at all; "chat.source_scope" for the Search-in
//      picker; "app.projects" for project context) and model/tier permission
//      BEFORE calling the Brain (a disallowed selection → 403), and
//   2. TEEs the upstream data stream — one branch goes to the browser UNCHANGED
//      (so useChat keeps working), the other is drained server-side to capture
//      finish-part token usage, which is written to usage_events (metering).
//
// Metering is best-effort: it is scheduled with `after()` and never blocks or
// breaks the response.
//
// Long-chat safety net: the Brain keeps only the last 40 user/assistant turns
// (each ≤ 40,000 chars) within 120,000 chars for the model. Before forwarding,
// the conversation is fitted (lib/brain → fitMessagesForBrain): the latest
// "[Conversation summary]" system turn (from /api/compact) leads and the turns
// it already folds in are dropped, then the most recent turns are kept so the
// total is ≤ 41 (summary + 40); other system turns are dropped (the Brain
// discards them anyway) and each turn is clipped to 40,000 chars. Only the
// UPSTREAM copy is fitted — persistence keeps the full history.
//
// Attachments: at most BRAIN_MAX_ATTACHMENTS entries reach the Brain (its
// ChatBodySchema cap). The user's own files go first; every project file is
// folded into ONE "Project files" entry that fills the remaining slot, and the
// attachment text is budgeted so message + attachments + directives + summary
// stay under the Brain's per-turn char cap (else it answers 413).

import { after } from "next/server";
import { z } from "zod";
import {
  attachmentCharBudget,
  brainChat,
  brainModelHeaders,
  fetchBrainKnowledgeScopes,
  fitAttachmentsForBrain,
  fitMessagesForBrain,
  safeBrainChatError,
  type ModelSelection,
} from "@/lib/brain";
import { BRAIN_TURN_CHARS } from "@/lib/compaction";
import { DEFAULT_KNOWLEDGE_SCOPE, KNOWLEDGE_SCOPE_ID_RE, isKnownKnowledgeScope, resolveKnowledgeScope } from "@/lib/knowledge-scopes";
import { getSessionProfile } from "@/lib/admin";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { resolveMode, canUseExecutive, allowedModes, isExecutiveMode } from "@/lib/work-modes";
import { accessFromProfile, allowedSourceTypes, effectiveCapabilities, SENSITIVE_SOURCE_TYPES } from "@/lib/access";
import { getCeoMemory } from "@/lib/ceo-memory";
import { loadProjectContextForConversation } from "@/lib/project-context";
import { audit } from "@/lib/audit";
import { fetchBrainModels, isSelectionAllowed } from "@/lib/models";
import { CHAT_LIMIT_BOUNDS, loadWorkspaceSettings } from "@/lib/settings";
import { OUTPUT_TYPES, type OutputType } from "@/lib/output-types";
import { meterStreamAndRecord, type UsageContext } from "@/lib/usage";
import { rateLimit } from "@/lib/ratelimit";
import { isDemo } from "@/lib/demo/mode";
import { demoChatStreamResponse } from "@/lib/demo/stream";
import { isoOrUndefined, rowTimestamps } from "@/lib/message-times";

export const runtime = "nodejs";
// Co-locate with the Brain + this app's Supabase (all Singapore) so auth, the
// profile read, and the Brain call don't pay cross-region round trips.
export const preferredRegion = ["sin1"];
// Must be >= the Brain's /api/v1/chat maxDuration: this route tees the upstream
// stream, so if it dies first it cuts a still-streaming long answer mid-table.
export const maxDuration = 300;

/** Per-user ceiling on chat turns (per instance — see lib/ratelimit). */
const CHAT_LIMIT = { limit: 30, windowMs: 60_000 };

/** The response formats the composer offers — the only values forwarded upstream. */
const OUTPUT_TYPE_IDS = OUTPUT_TYPES.map((o) => o.id) as [OutputType, ...OutputType[]];

// Bounds mirror /api/conversations and the saveConversationTurn action so the
// same conversation payload validates identically wherever it enters the app.
// This is an authenticated-but-untrusted body: without these caps a client could
// forward an unbounded messages array (and arbitrarily large content) straight to
// the Brain on the scoped key. Unknown per-message fields (id, createdAt, parts…)
// are stripped — only { role, content } is forwarded upstream.
const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().max(100_000),
  // When the message was sent (useChat's createdAt, ISO). Kept as the row's
  // created_at and forwarded so the Brain anchors "yesterday" to the send day.
  createdAt: z.unknown().optional().transform(isoOrUndefined),
});

const chatBodySchema = z.object({
  messages: z.array(chatMessageSchema).min(1).max(2000),
  tier: z.string().trim().max(64).optional(),
  model: z.string().trim().max(200).optional(),
  // Persona/work mode — validated + role-gated server-side below.
  mode: z.string().trim().max(32).optional(),
  // Response format (table/memo/email/…) — one of lib/output-types, else 400.
  outputType: z.enum(OUTPUT_TYPE_IDS).optional(),
  // Source scope: collections the user narrowed to (the Brain intersects with the
  // key scope, so this can only ever restrict, never widen).
  collectionIds: z.array(z.string().uuid()).max(50).optional(),
  // "Search in" knowledge scope (lib/knowledge-scopes): a known id or a safe-shaped
  // future id. Access-checked below; a scope the user can't use falls back to "auto".
  knowledgeScope: z.string().trim().regex(KNOWLEDGE_SCOPE_ID_RE).optional(),
  // Per-message attached files, already extracted to plain text by /api/attachments.
  // Bounded so a client can't forward an unbounded payload on the scoped key; the
  // Brain treats the text as data-only source material for this turn. The outer
  // cap is the highest "Max attachments per message" an admin can set — the
  // Brain's own per-request cap (BRAIN_MAX_ATTACHMENTS, 5); the workspace's own
  // setting is enforced below once settings are loaded.
  attachments: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        text: z.string().min(1).max(40_000),
      })
    )
    .max(CHAT_LIMIT_BOUNDS.maxFiles.max)
    .optional(),
  conversationId: z.string().uuid().nullish(),
  conversation_id: z.string().uuid().nullish(),
});

/** A UUID (with a light shape check) or null — for the optional conversation id. */
function asUuid(v: unknown): string | null {
  return typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
    ? v
    : null;
}

/**
 * The conversation id to attribute this turn to — only if it belongs to the
 * caller. The RLS client returns solely the user's own rows, so a foreign or
 * fabricated id (the body is client-controlled) resolves to null rather than
 * being written into usage_events / the audit log.
 */
async function ownedConversationId(id: string | null): Promise<string | null> {
  if (!id) return null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    return data?.id ? String(data.id) : null;
  } catch {
    return null;
  }
}

/**
 * Persist the COMPLETED assistant turn server-side, so a long answer is not
 * lost when the user navigates away mid-stream: the browser aborts the client
 * stream, but this after() keeps reading the upstream (an independent tee) to
 * completion and writes the turn. Guarded by a short delay + a stored-count and
 * last-message check so it doesn't double-write the client's own onFinish save,
 * yet still recovers a turn the client failed to save.
 */
async function captureAndSaveTurn(
  stream: ReadableStream<Uint8Array>,
  conversationId: string,
  priorMessages: { role: string; content: string }[],
  userId: string
): Promise<void> {
  let text = "";
  try {
    const reader = stream.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.startsWith("0:")) {
          try { const d = JSON.parse(line.slice(2)); if (typeof d === "string") text += d; } catch { /* skip */ }
        }
        nl = buf.indexOf("\n");
      }
    }
  } catch {
    return;
  }
  if (!text.trim()) return;
  // Let the client's own save (onFinish) land first in the normal case.
  await new Promise((r) => setTimeout(r, 2500));
  try {
    const supabase = await createSupabaseServerClient();
    const { data: lastRows, count } = await supabase
      .from("messages")
      .select("role, content", { count: "exact" })
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(1);
    const lastRow = (Array.isArray(lastRows) ? lastRows[0] : null) as { role?: string; content?: string } | null;
    // The client already saved THIS turn: every posted message + the answer is
    // stored and ends on an answer. Anything less (the client save failed, or
    // the user navigated away mid-stream) is written from the posted history.
    const clientSaved =
      (count ?? 0) >= priorMessages.length + 1 &&
      lastRow?.role === "assistant" &&
      !!(lastRow.content ?? "").trim();
    if (clientSaved) return;
    const all = [...priorMessages, { role: "assistant", content: text }];
    await supabase.from("messages").delete().eq("conversation_id", conversationId).eq("user_id", userId);
    const times = rowTimestamps(all as { createdAt?: unknown }[]);
    const rows = all.map((m, i) => ({
      conversation_id: conversationId,
      user_id: userId,
      role: m.role,
      content: m.content,
      citations: [],
      input_tokens: 0,
      output_tokens: 0,
      created_at: times[i],
    }));
    await supabase.from("messages").insert(rows);
    await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
  } catch {
    /* best-effort */
  }
}

export async function POST(req: Request) {
  // DEMO MODE: don't call the Brain or meter — stream a canned grounded answer.
  if (isDemo()) {
    const body = await req.json().catch(() => ({}));
    const demoMessages = Array.isArray(body?.messages) ? body.messages : [];
    const last = [...demoMessages].reverse().find((m: any) => m?.role === "user");
    const attachmentNames = Array.isArray(body?.attachments)
      ? body.attachments
          .map((a: any) => (typeof a?.name === "string" ? a.name : ""))
          .filter(Boolean)
      : [];
    return demoChatStreamResponse(last?.content ?? "", attachmentNames);
  }

  // 1. Identity + permissions, resolved SERVER-SIDE from the session — BEFORE
  //    the (untrusted) body is even read, so an anonymous caller costs nothing.
  const profile = await getSessionProfile();
  if (!profile) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Capability gate (lib/access): the user's resolved capability set decides
  // what this turn may use. Asking the Brain at all needs "chat.knowledge".
  // The same set is forwarded to the Brain below, which can only NARROW with it.
  const access = accessFromProfile(profile);
  const capabilities = effectiveCapabilities(access);
  if (!capabilities.includes("chat.knowledge")) {
    return Response.json({ error: "Chat with the Brain isn't enabled for your account." }, { status: 403 });
  }

  const limited = rateLimit(`chat:${profile.userId}`, CHAT_LIMIT.limit, CHAT_LIMIT.windowMs);
  if (limited) return limited;

  // Validate + bound the (authenticated-but-untrusted) body before we do any
  // work or touch the Brain. Rejects an unbounded/malformed payload cleanly.
  const body = await req.json().catch(() => ({}));
  const parsed = chatBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request", detail: parsed.error.flatten() },
      { status: 400 }
    );
  }
  // Forward only the sanitized { role, content } turns upstream.
  const safeMessages = parsed.data.messages;
  // The copy the Brain sees: ≤ 60 turns (latest summary first), each ≤ 40,000 chars.
  // `safeMessages` stays untouched for persistence (captureAndSaveTurn).
  const brainMessages = fitMessagesForBrain(safeMessages);
  if (brainMessages.length === 0) {
    return Response.json({ error: "Invalid request", detail: "No messages to send." }, { status: 400 });
  }

  // The client requests a tier ("fast"|"recommended"|"max") or a concrete model
  // id; prefer an explicit model, else the tier, else the default tier.
  const selection: ModelSelection =
    (parsed.data.model && parsed.data.model.trim()) ||
    (parsed.data.tier && parsed.data.tier.trim()) ||
    "recommended";

  // 2. Enforce the user's model/tier permission BEFORE hitting the Brain. The
  //    catalog resolves tier aliases (so an alias can't bypass a model
  //    allowlist) and the workspace settings supply the admin denylist +
  //    pricing overrides; the conversation id is verified as the caller's own.
  const [catalog, { settings }, conversationId] = await Promise.all([
    fetchBrainModels(),
    loadWorkspaceSettings(),
    ownedConversationId(asUuid(parsed.data.conversationId ?? parsed.data.conversation_id)),
  ]);
  const allowed = isSelectionAllowed(
    selection,
    profile.permissions,
    profile.canUseAllModels,
    catalog,
    settings.disabledModels
  );
  if (!allowed) {
    return Response.json(
      { error: `"${selection}" is not permitted for your account.` },
      { status: 403 }
    );
  }

  // The workspace's "Max attachments per message" (admin settings).
  if ((parsed.data.attachments?.length ?? 0) > settings.chat.maxFiles) {
    return Response.json(
      { error: `Too many attachments — up to ${settings.chat.maxFiles} files per message.` },
      { status: 400 }
    );
  }

  // 3. Resolve the work mode against the user's ROLE (restricted personas need
  //    an admin/super_admin; a disallowed request silently downgrades to General
  //    — the persona is enforced here, never trusted from the client alone).
  // Access = the user's resolved capabilities (role defaults + the per-user
  // grants set in the admin Users editor). Modes and data access gate on this.
  const mode = resolveMode(parsed.data.mode, access);

  // 3b. Knowledge partitioning by capability: each "data.<source_type>" the user
  //     holds (members: general company knowledge; the call material only when
  //     granted). Enforced here AND re-narrowed by the Brain.
  const sourceTypes = allowedSourceTypes(access);

  // The "Search in" picker (collections + knowledge scope) needs the
  // "chat.source_scope" capability. Without it both are ignored: the turn
  // searches the default scope ("auto") over every collection the key allows.
  const canScopeSources = capabilities.includes("chat.source_scope");

  // 3b-ii. Source scope: the collections the user narrowed to (optional). Only
  //        ever restricts — the Brain intersects with the key's collection scope.
  const collectionIds =
    canScopeSources && Array.isArray(parsed.data.collectionIds) && parsed.data.collectionIds.length > 0
      ? parsed.data.collectionIds
      : undefined;

  // 3b-iii. "Search in" knowledge scope: which of the Brain's intelligence lanes
  //         to search (collections above stay an ADDITIONAL narrowing filter). A
  //         sensitive scope ("Consultant calls") needs the user to be able to
  //         retrieve its call data (the same source types sent as `sourceTypes`);
  //         otherwise, or for an id the Brain doesn't advertise, it silently
  //         becomes "auto". The Brain re-intersects with the key scope.
  const requestedScope = canScopeSources ? parsed.data.knowledgeScope : undefined;
  const knowledgeScope = resolveKnowledgeScope(requestedScope, {
    allowedSourceTypes: sourceTypes,
    sensitiveSourceTypes: SENSITIVE_SOURCE_TYPES,
    // Only an id this app doesn't know yet needs the Brain's (cached) catalogue.
    available: requestedScope && !isKnownKnowledgeScope(requestedScope) ? await fetchBrainKnowledgeScopes() : null,
  });

  // 3b-iv. Per-message attachments (extracted text). Drop any empty ones; the
  //         Brain caps + frames them as data-only source material for this turn.
  const attachments =
    Array.isArray(parsed.data.attachments) && parsed.data.attachments.length > 0
      ? parsed.data.attachments.filter((a) => a.text.trim())
      : undefined;

  // 3c. Executive mode: inject the user's OWN private memory as trusted
  //     directives — only when they may use Executive mode (super_admin or the
  //     "executive" feature). Never reaches anyone else.
  let directives: string | undefined;
  if (isExecutiveMode(mode) && canUseExecutive(access)) {
    const mem = await getCeoMemory(profile.userId);
    if (mem.trim()) directives = mem;
  }

  // 3c-ii. Project context: if this conversation belongs to a project, fold in
  //        its instructions (as trusted directives) and its files (as data-only
  //        attachments) — Claude Projects' shared knowledge. Only for users
  //        holding "app.projects". Best-effort: a project lookup never breaks
  //        the chat.
  let projectFiles: { name: string; text: string }[] = [];
  if (conversationId && capabilities.includes("app.projects")) {
    try {
      const supabase = await createSupabaseServerClient();
      const pctx = await loadProjectContextForConversation(supabase, conversationId);
      if (pctx) {
        if (pctx.instructions) {
          const nl = String.fromCharCode(10);
          const label = `Project "${pctx.name}" instructions:`;
          const block = label + nl + pctx.instructions;
          directives = directives ? directives + nl + nl + block : block;
        }
        projectFiles = pctx.files.map((f) => ({ name: f.name, text: f.text }));
      }
    } catch {
      /* project context is best-effort */
    }
  }

  // Fit the attachments to the Brain's contract (count + per-turn characters):
  // the user's own files first, all project files folded into one entry that
  // fills the remaining slot. A turn the Brain would reject anyway (its 400 /
  // 413) is answered here with a message the user can act on.
  const fitted = fitAttachmentsForBrain(
    attachments ?? [],
    projectFiles,
    attachmentCharBudget(brainMessages, directives, BRAIN_TURN_CHARS)
  );
  if (fitted.tooLarge) {
    return Response.json(
      { error: "Attachments are too large for one message — attach fewer or smaller files." },
      { status: 413 }
    );
  }
  const combinedAttachments = fitted.attachments;

  // Governance: audit the request (best-effort; never blocks).
  void audit(profile.userId, "chat", {
    mode,
    model: String(selection),
    sensitiveAccess: sourceTypes === undefined, // true = call_score was in scope
    knowledgeScope,
    attachments: attachments?.length ?? 0,
    conversationId,
  });

  // 4. Call the Brain (scoped key stays server-side inside brainChat).
  const startedAt = Date.now();
  const scope =
    sourceTypes || collectionIds || knowledgeScope !== DEFAULT_KNOWLEDGE_SCOPE
      ? {
          ...(sourceTypes ? { sourceTypes } : {}),
          ...(collectionIds ? { collectionIds } : {}),
          ...(knowledgeScope !== DEFAULT_KNOWLEDGE_SCOPE ? { knowledgeScope } : {}),
        }
      : undefined;
  // The modes this user may use: constrains the Brain's Auto detection so a
  // restricted expert (executive, decision memo) is never auto-selected for a
  // user who cannot pick it. The capability set lets the Brain skip what the
  // user may not see (call reviews, performance numbers, learning detection,
  // source conflicts); it can only narrow the key's scope, never widen it.
  const upstream = await brainChat(
    brainMessages,
    selection,
    mode,
    scope,
    directives,
    parsed.data.outputType,
    combinedAttachments.length ? combinedAttachments : undefined,
    allowedModes(access),
    capabilities
  );

  if (!upstream.ok || !upstream.body) {
    // Log the upstream body server-side only; the browser gets a generic,
    // status-appropriate message (never the Brain's internal detail).
    const detail = await upstream.text().catch(() => "");
    console.error(`[chat] Brain request failed (${upstream.status}):`, detail.slice(0, 2_000));
    return Response.json(
      { error: safeBrainChatError(upstream.status), status: upstream.status },
      { status: upstream.status || 502 }
    );
  }

  // 4. TEE the upstream stream: `clientStream` is returned to the browser
  //    UNCHANGED (so useChat parses it normally and time-to-first-token is not
  //    delayed by metering); `meterStream` is a fully independent copy we drain
  //    server-side to read the finish-part token usage. Reading one branch never
  //    blocks the other, so the client is never held up.
  const [clientStream, forServer] = upstream.body.tee();
  const [meterStream, textStream] = forServer.tee();

  const { model: resolvedModel, provider } = brainModelHeaders(upstream);
  const ctx: UsageContext = {
    userId: profile.userId,
    teamId: profile.team?.id ?? null,
    conversationId,
    provider,
    model: resolvedModel,
    tier: String(selection),
    startedAt,
    pricingOverrides: settings.pricingOverrides,
  };

  // Write exactly one usage_events row after the response has streamed out.
  // `after()` keeps the function alive for this best-effort work without
  // delaying the response; meterStreamAndRecord never throws.
  after(() => meterStreamAndRecord(meterStream, ctx));
  // Persist the completed answer server-side so it survives client navigation.
  if (conversationId) after(() => captureAndSaveTurn(textStream, conversationId, safeMessages, profile.userId));
  else after(() => { void textStream.cancel().catch(() => {}); });

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
