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
import { previousTurnIndex, storedAnswerIndex, storedLeadsTo, turnAlreadySaved, type StoredTurnRow } from "@/lib/turn-capture";
import { replaceConversationMessages } from "@/lib/replace-messages";
import { DEMO_USER_ID } from "@/lib/demo/fixtures";
import { timeZoneOrUndefined } from "@/lib/timezone";

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
  // The asker's IANA time zone ("today" / call dates resolve in it); an invalid
  // value is dropped (never a 400) and the Brain's default applies.
  timeZone: z.unknown().optional().transform(timeZoneOrUndefined),
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
 * The caller's conversation this turn belongs to, and its updated_at as this
 * request starts: the version captureAndSaveTurn writes against (every save of
 * the thread changes it).
 */
interface OwnedConversation {
  id: string;
  version: string;
}

function toOwned(data: { id?: unknown; updated_at?: unknown } | null): OwnedConversation | null {
  return data?.id ? { id: String(data.id), version: data.updated_at ? String(data.updated_at) : "" } : null;
}

/**
 * The conversation to attribute this turn to — only if it belongs to the
 * caller. The RLS client returns solely the user's own rows, so a foreign or
 * fabricated id (the body is client-controlled) resolves to null rather than
 * being written into usage_events / the audit log.
 */
async function ownedConversation(id: string | null): Promise<OwnedConversation | null> {
  if (!id) return null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("conversations")
      .select("id, updated_at")
      .eq("id", id)
      .maybeSingle();
    return toOwned(data);
  } catch {
    return null;
  }
}

/** DEMO MODE: the demo user's conversation (demo rows aren't all UUIDs), or null. */
async function ownedDemoConversation(id: unknown): Promise<OwnedConversation | null> {
  if (typeof id !== "string" || id.length === 0 || id.length > 64) return null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("conversations")
      .select("id, updated_at")
      .eq("id", id)
      .eq("user_id", DEMO_USER_ID)
      .maybeSingle();
    return toOwned(data);
  } catch {
    return null;
  }
}

type ServerSupabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Claim the thread for this save: bump updated_at only while it still equals
 * `version`. One conditional UPDATE checks and claims at once, so of two late
 * copies holding the same version only one can pass.
 */
async function claimThread(supabase: ServerSupabase, conversationId: string, version: string): Promise<boolean> {
  if (!version) return false;
  const { data } = await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("updated_at", version)
    .select("id");
  return Array.isArray(data) && data.length > 0;
}

/**
 * Persist the COMPLETED assistant turn server-side, so an answer is not lost
 * when no chat view is left to save it: the user navigated away mid-stream, or
 * a queued turn was sent and finished in the background. This after() reads its
 * own tee of the upstream to completion and writes the turn — after a short
 * grace for the client's own onFinish save, and only when the stored thread
 * doesn't already hold THIS turn and hasn't moved on since the request started
 * (lib/turn-capture). Reads the rows' roles, then the content of just the
 * answer's row and the message before it.
 */
async function captureAndSaveTurn(
  stream: ReadableStream<Uint8Array>,
  conversation: OwnedConversation,
  priorMessages: { role: string; content: string; createdAt?: string }[],
  userId: string
): Promise<void> {
  const conversationId = conversation.id;
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
    const { data: roleRows, error: rolesErr } = await supabase
      .from("messages")
      .select("id, role")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    if (rolesErr) return;
    const stored = (Array.isArray(roleRows) ? roleRows : []) as { id: string; role: string }[];
    // Already stored (the client saved this turn, or later turns on top of it):
    // leave the thread alone. Anything else — nothing saved yet, or an older
    // answer / another branch where this one belongs — is written from the
    // posted history, if the thread hasn't moved on since (below). Only the
    // answer's row and the one before it are read here.
    const roles = stored.map((r) => r.role);
    const idx = storedAnswerIndex(
      roles,
      priorMessages.map((m) => m.role)
    );
    if (idx >= 0) {
      const prev = previousTurnIndex(roles, idx);
      const ids = prev >= 0 ? [stored[idx].id, stored[prev].id] : [stored[idx].id];
      const { data: contentRows } = await supabase.from("messages").select("id, content").in("id", ids);
      const content = new Map(
        ((contentRows ?? []) as { id: string; content: string | null }[]).map((r) => [r.id, r.content])
      );
      const rows: StoredTurnRow[] = stored.map((r) => ({ role: r.role, content: content.get(r.id) ?? null }));
      if (turnAlreadySaved(rows, priorMessages, text)) return;
    }
    // Write only if nothing was saved to this thread since this request
    // started. A later save means someone else owns the thread: the client's
    // save of this turn or of a Stop's partial answer, a newer regenerate, edit
    // or turn, or another tab — this copy (which reads on after Stop) is older.
    if (!(await claimThread(supabase, conversationId, conversation.version))) {
      // …unless that save only brought the thread up to (a start of) the
      // history this request was built on: the previous turn's own save
      // landing after this one was sent (queued turns answered back to back).
      // Writing then only adds to it. Claimed against the version read here,
      // so a save landing in between still wins.
      const { data: conv } = await supabase
        .from("conversations")
        .select("updated_at")
        .eq("id", conversationId)
        .maybeSingle();
      const version = conv?.updated_at ? String(conv.updated_at) : "";
      const { data: current, error: currentErr } = await supabase
        .from("messages")
        .select("role, content")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
      if (!version || currentErr || !storedLeadsTo((current ?? []) as StoredTurnRow[], priorMessages)) return;
      if (!(await claimThread(supabase, conversationId, version))) return;
    }
    const all = [...priorMessages, { role: "assistant", content: text }];
    const times = rowTimestamps(all as { createdAt?: unknown }[]);
    const rows = all.map((m, i) => ({
      role: m.role,
      content: m.content,
      citations: [],
      input_tokens: 0,
      output_tokens: 0,
      created_at: times[i],
    }));
    // One step (lib/replace-messages): a concurrent client save can't interleave.
    if (await replaceConversationMessages(supabase, conversationId, userId, rows)) return;
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
    const demo = demoChatStreamResponse(last?.content ?? "", attachmentNames);
    // Save the finished answer server-side like the real path does, so a chat
    // that finishes in the background (navigated away, queued turns) is kept.
    const demoConversation = await ownedDemoConversation(body?.conversationId);
    const prior = z.array(chatMessageSchema).max(2000).safeParse(demoMessages);
    if (!demoConversation || !prior.success || !demo.body) return demo;
    const [demoClient, demoText] = demo.body.tee();
    after(() => captureAndSaveTurn(demoText, demoConversation, prior.data, DEMO_USER_ID));
    return new Response(demoClient, { status: demo.status, headers: demo.headers });
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
  //    pricing overrides; the conversation id is verified as the caller's own
  //    (and its version as of now kept for the server-side save).
  const [catalog, { settings }, owned] = await Promise.all([
    fetchBrainModels(),
    loadWorkspaceSettings(),
    ownedConversation(asUuid(parsed.data.conversationId ?? parsed.data.conversation_id)),
  ]);
  const conversationId = owned?.id ?? null;
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
    capabilities,
    parsed.data.timeZone
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
  if (owned) after(() => captureAndSaveTurn(textStream, owned, safeMessages, profile.userId));
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
