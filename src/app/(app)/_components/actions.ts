"use server";

// Server action that persists a completed chat turn to the chatbot's OWN
// database (auth + history + projects), separate from the Brain.
//
// SECURITY: the user is resolved from the verified Supabase session, never from
// the argument. Every read/write goes through the session-bound client, so
// row-level security scopes rows to the signed-in user; we also verify ownership
// of an existing conversation before writing to it. Message content is stored as
// data — never executed or trusted as instructions.
//
// NOTE: conversation CRUD (list / rename / pin / delete) lives in the
// history agent's /api/conversations route. This action only saves the turns of
// the *active* conversation, creating the conversation row on the first save.

import { z } from "zod";
import { getUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { rowTimestamps } from "@/lib/message-times";
import { replaceConversationMessages } from "@/lib/replace-messages";
import type { ModelTier } from "@/lib/brain";

const TIERS = ["fast", "recommended", "max"] as const;

// Bounds mirror /api/chat and /api/conversations (2000 turns of ≤ 100,000
// chars), so a thread that can still be chatted in can still be saved.
const InputSchema = z.object({
  conversationId: z.string().uuid().nullable(),
  tier: z.enum(TIERS),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string().max(100_000),
        // When the message was sent (ISO); kept as its created_at.
        createdAt: z.string().max(64).optional(),
      })
    )
    .max(2000),
});

export type SaveTurnInput = z.infer<typeof InputSchema>;
export type SaveTurnResult =
  | { ok: true; conversationId: string; created: boolean; title: string }
  | { ok: false; error: string };

// ~4 characters per token — a rough estimate until the Brain returns exact usage.
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Pull inline `[id]` citation markers out of assistant text, skipping
 * `[label](url)` links. Stored so a later feature can resolve them to full
 * source metadata (title/url) returned by the Brain.
 */
function extractCitations(text: string): { id: string }[] {
  const ids = new Set<string>();
  const re = /\[([^\]\s]{1,40})\](?!\()/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) ids.add(m[1]);
  return [...ids].map((id) => ({ id }));
}

/** Derive a short conversation title from the first user turn. */
function deriveTitle(messages: SaveTurnInput["messages"]): string {
  const first = messages.find((m) => m.role === "user")?.content.trim();
  if (!first) return "New chat";
  const oneLine = first.replace(/\s+/g, " ");
  return oneLine.length > 60 ? `${oneLine.slice(0, 60).trimEnd()}…` : oneLine;
}

/**
 * Save the current turns of a conversation. On the first call for a new chat
 * (conversationId === null) a conversation row is created and its id returned;
 * subsequent calls replace the stored turns idempotently. Updating the row bumps
 * `updated_at` (via DB trigger) so active threads sort to the top of history.
 */
export async function saveConversationTurn(
  raw: SaveTurnInput
): Promise<SaveTurnResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const parsed = InputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { messages, tier } = parsed.data;

  const supabase = await createSupabaseServerClient();
  let conversationId = parsed.data.conversationId;
  let created = false;
  let title = deriveTitle(messages);

  if (conversationId) {
    // Confirm ownership: RLS returns null for an absent or someone-else's row.
    const { data: existing } = await supabase
      .from("conversations")
      .select("id, title")
      .eq("id", conversationId)
      .maybeSingle();
    if (!existing) return { ok: false, error: "not_found" };

    // Re-title a still-placeholder thread (e.g. one pre-created from a project
    // page) from its first user turn; otherwise keep the existing title.
    const patch: Record<string, unknown> = { model_tier: tier as ModelTier };
    const placeholder = !existing.title || existing.title === "New chat";
    if (placeholder && title && title !== "New chat") patch.title = title;
    else title = (existing.title as string | null) ?? title;
    await supabase.from("conversations").update(patch).eq("id", conversationId);
  } else {
    const { data, error } = await supabase
      .from("conversations")
      .insert({ user_id: user.id, title, model_tier: tier })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: "create_failed" };
    conversationId = data.id as string;
    created = true;
  }

  // Replace stored turns with the current client state (idempotent per save),
  // in one step: a concurrent server-side save can't interleave with it.
  // Each row keeps the time its message was sent, strictly increasing: a
  // multi-row insert would otherwise stamp every row with the same now(), and
  // the /c/[id] loader (ordered by created_at) could rebuild the thread — and
  // the summary's position in it — out of order. The real send times also let
  // the Brain resolve "yesterday" in a reopened chat (lib/message-times).
  const times = rowTimestamps(messages);
  const rows = messages.map((m, i) => ({
    role: m.role,
    content: m.content,
    citations: m.role === "assistant" ? extractCitations(m.content) : [],
    input_tokens: m.role === "user" ? estimateTokens(m.content) : 0,
    output_tokens: m.role === "assistant" ? estimateTokens(m.content) : 0,
    created_at: times[i],
  }));
  const error = await replaceConversationMessages(supabase, conversationId, user.id, rows);
  if (error) return { ok: false, error: "save_failed" };

  return { ok: true, conversationId, created, title };
}
