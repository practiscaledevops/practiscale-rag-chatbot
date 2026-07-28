// /api/conversations — the chatbot's own conversation history, owned by the
// history agent. Every request is scoped to the signed-in user: we resolve the
// session server-side (never from client input) and let row-level security
// (user_id = auth.uid()) enforce ownership on top of that.
//
//   GET    — list the user's conversations (pinned first, most recent next)
//   POST   — create a conversation and/or persist its turns. Serves two callers:
//              • the history "New chat" action (no messages → an empty thread),
//              • the chat view, which on every settled turn re-sends the whole
//                thread (create-on-first-message when conversationId is null).
//            Always replies with { conversationId, conversation }.
//   PATCH  — rename / pin / re-tier / re-parent a conversation
//   DELETE — remove a conversation (its messages cascade)
//
// This lives in the chatbot's OWN Supabase project (auth + history + projects),
// never the Brain. The Brain is only ever reached through /api/chat. Message
// content is user/assistant data and is only ever stored — never interpreted as
// instructions by this route.

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
// Reads/writes the session cookie, so this route is always dynamic.
export const dynamic = "force-dynamic";

// Columns returned to the client. Kept in one place so every verb agrees.
const CONVERSATION_COLUMNS =
  "id, title, pinned, project_id, model_tier, created_at, updated_at";

const modelTier = z.enum(["fast", "recommended", "max"]);

const messageInput = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().max(100_000),
});

const postSchema = z.object({
  conversationId: z.string().uuid().nullish(),
  title: z.string().trim().min(1).max(200).optional(),
  projectId: z.string().uuid().nullish(),
  // The chat view sends `tier`; accept `modelTier` too for symmetry with PATCH.
  tier: modelTier.optional(),
  modelTier: modelTier.optional(),
  messages: z.array(messageInput).max(2000).optional(),
});

const patchSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(200).optional(),
    pinned: z.boolean().optional(),
    projectId: z.string().uuid().nullable().optional(),
    modelTier: modelTier.optional(),
  })
  // At least one mutable field must be present alongside the id.
  .refine(
    (v) =>
      v.title !== undefined ||
      v.pinned !== undefined ||
      v.projectId !== undefined ||
      v.modelTier !== undefined,
    { message: "No fields to update" }
  );

const deleteSchema = z.object({ id: z.string().uuid() });

type MessageInput = z.infer<typeof messageInput>;

/** Resolve the authed user + an RLS-scoped Supabase client, or a 401 response. */
async function requireUser() {
  const user = await getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const supabase = await createSupabaseServerClient();
  return { user, supabase };
}

/** A friendly title from the first user turn, else a neutral default. */
function deriveTitle(messages: MessageInput[] | undefined): string {
  const firstUser = messages?.find((m) => m.role === "user");
  const text = firstUser?.content.replace(/\s+/g, " ").trim() ?? "";
  if (!text) return "New chat";
  return text.length > 80 ? `${text.slice(0, 79).trimEnd()}…` : text;
}

// ~4 characters per token — a rough estimate until the Brain returns exact usage.
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Pull inline `[id]` citation markers out of assistant text, skipping
 * `[label](url)` links. Stored so a later feature can resolve them to full
 * source metadata returned by the Brain.
 */
function extractCitations(text: string): { id: string }[] {
  const ids = new Set<string>();
  const re = /\[([^\]\s]{1,40})\](?!\()/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) ids.add(m[1]);
  return [...ids].map((id) => ({ id }));
}

/**
 * Sync a conversation's stored turns to exactly the provided list. The chat view
 * re-sends the full thread on every save, so we replace rather than append. Rows
 * get strictly increasing timestamps so the /c/[id] loader (ordered by
 * created_at) always reconstructs them in order.
 */
async function replaceMessages(
  supabase: SupabaseClient,
  conversationId: string,
  userId: string,
  messages: MessageInput[]
) {
  const del = await supabase
    .from("messages")
    .delete()
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);
  if (del.error) return del.error;

  if (messages.length === 0) return null;

  const base = Date.now();
  const rows = messages.map((m, i) => ({
    conversation_id: conversationId,
    user_id: userId,
    role: m.role,
    content: m.content,
    // Citations are only meaningful on assistant turns; tokens are estimated
    // per role until the Brain reports exact usage.
    citations: m.role === "assistant" ? extractCitations(m.content) : [],
    input_tokens: m.role === "user" ? estimateTokens(m.content) : 0,
    output_tokens: m.role === "assistant" ? estimateTokens(m.content) : 0,
    created_at: new Date(base + i).toISOString(),
  }));
  const ins = await supabase.from("messages").insert(rows);
  return ins.error ?? null;
}

// GET /api/conversations?projectId=… — list the user's conversations.
export async function GET(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { user, supabase } = auth;

  const projectId = new URL(req.url).searchParams.get("projectId");

  let query = supabase
    .from("conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("user_id", user.id)
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false });

  if (projectId) query = query.eq("project_id", projectId);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ conversations: data ?? [] });
}

// POST /api/conversations — create a conversation and/or persist its turns.
export async function POST(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { user, supabase } = auth;

  const parsed = postSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { conversationId, title, projectId, messages } = parsed.data;
  const tier = parsed.data.modelTier ?? parsed.data.tier;

  // --- Persist into an existing conversation ------------------------------
  if (conversationId) {
    // Verify ownership (RLS would also block, but we want a clean 404).
    const { data: convo, error: findErr } = await supabase
      .from("conversations")
      .select("id, title")
      .eq("id", conversationId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (findErr) {
      return NextResponse.json({ error: findErr.message }, { status: 500 });
    }
    if (!convo) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Update tier when supplied, and give a still-placeholder thread a real
    // title from its first turn. Touching the row bumps updated_at (trigger).
    const patch: Record<string, unknown> = {};
    if (tier) patch.model_tier = tier;
    if (title) patch.title = title;
    const placeholder = !convo.title || convo.title === "New chat";
    if (!title && placeholder && messages?.length) {
      patch.title = deriveTitle(messages);
    }

    if (messages) {
      const msgErr = await replaceMessages(supabase, conversationId, user.id, messages);
      if (msgErr) {
        return NextResponse.json({ error: msgErr.message }, { status: 500 });
      }
      // Bump recency on new activity so the thread rises in the history list.
      // (The BEFORE UPDATE trigger also sets updated_at; this guarantees the
      // UPDATE actually runs even when no other field changed.)
      patch.updated_at = new Date().toISOString();
    }

    let row = null;
    if (Object.keys(patch).length > 0) {
      const { data, error } = await supabase
        .from("conversations")
        .update(patch)
        .eq("id", conversationId)
        .eq("user_id", user.id)
        .select(CONVERSATION_COLUMNS)
        .maybeSingle();
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      row = data;
    }

    return NextResponse.json({ conversationId, conversation: row });
  }

  // --- Create a fresh conversation ----------------------------------------
  const { data: created, error: createErr } = await supabase
    .from("conversations")
    .insert({
      user_id: user.id, // RLS insert policy requires user_id = auth.uid()
      title: title ?? deriveTitle(messages),
      project_id: projectId ?? null,
      ...(tier ? { model_tier: tier } : {}),
    })
    .select(CONVERSATION_COLUMNS)
    .single();

  if (createErr || !created) {
    return NextResponse.json(
      { error: createErr?.message ?? "Could not create conversation" },
      { status: 500 }
    );
  }

  if (messages?.length) {
    const msgErr = await replaceMessages(supabase, created.id, user.id, messages);
    if (msgErr) {
      return NextResponse.json({ error: msgErr.message }, { status: 500 });
    }
  }

  return NextResponse.json(
    { conversationId: created.id, conversation: created },
    { status: 201 }
  );
}

// PATCH /api/conversations — rename / pin / re-tier / re-parent.
export async function PATCH(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { user, supabase } = auth;

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { id, title, pinned, projectId, modelTier: tier } = parsed.data;

  // Only the fields that were actually provided get written.
  const patch: Record<string, unknown> = {};
  if (title !== undefined) patch.title = title;
  if (pinned !== undefined) patch.pinned = pinned;
  if (projectId !== undefined) patch.project_id = projectId;
  if (tier !== undefined) patch.model_tier = tier;

  const { data, error } = await supabase
    .from("conversations")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id) // belt-and-braces alongside RLS
    .select(CONVERSATION_COLUMNS)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ conversation: data });
}

// DELETE /api/conversations — remove a conversation (messages cascade).
export async function DELETE(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { user, supabase } = auth;

  // Accept the id from the body or, as a convenience, the query string.
  const body = await req.json().catch(() => ({}));
  const id = body?.id ?? new URL(req.url).searchParams.get("id");

  const parsed = deleteSchema.safeParse({ id });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { error } = await supabase
    .from("conversations")
    .delete()
    .eq("id", parsed.data.id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
