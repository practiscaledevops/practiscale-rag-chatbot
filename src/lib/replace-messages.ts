// Replace a conversation's stored messages in one step (server-side only).
//
// Every save writes the whole thread: delete its rows, insert the new list. Two
// saves of one thread at once — /api/chat's server-side save of a finished turn
// and the client's own save, or two background turns — could otherwise
// interleave as delete, delete, insert, insert and leave the thread duplicated
// for good. public.replace_conversation_messages (migration 0014) does both in
// one transaction, serialized per conversation, so concurrent saves end as last
// writer wins. It runs as the caller (security invoker): RLS still scopes the
// delete and the insert to the signed-in user's own conversation.
//
// Until migration 0014 runs, this falls back to the two separate statements
// (the previous behaviour), re-checking for the function once a minute.

import type { SupabaseClient } from "@supabase/supabase-js";

/** One message row to store (the conversation and owner are added here). */
export interface MessageRowInput {
  role: string;
  content: string;
  citations: unknown;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
}

type DbError = { message: string; code?: string };

const RECHECK_MS = 60_000;
/** When the function was last found missing (pre-0014). */
let missingAt = Number.NEGATIVE_INFINITY;

/** True when the error means "replace_conversation_messages doesn't exist" (pre-0014). */
export function isMissingReplaceFunction(err: DbError | null | undefined): boolean {
  if (!err) return false;
  // PostgREST: not in its schema cache; Postgres: undefined_function.
  if (err.code === "PGRST202" || err.code === "42883") return true;
  const msg = err.message ?? "";
  return /replace_conversation_messages/i.test(msg) && /could not find|does not exist|schema cache/i.test(msg);
}

/**
 * Replace every stored message of `conversationId` with `rows` (in order; an
 * empty list clears the thread). Returns the database error, or null.
 */
export async function replaceConversationMessages(
  supabase: SupabaseClient,
  conversationId: string,
  userId: string,
  rows: readonly MessageRowInput[]
): Promise<DbError | null> {
  if (Date.now() - missingAt >= RECHECK_MS) {
    const { error } = await supabase.rpc("replace_conversation_messages", {
      p_conversation_id: conversationId,
      p_rows: rows,
    });
    if (!isMissingReplaceFunction(error)) return error ?? null;
    missingAt = Date.now();
  }
  const del = await supabase.from("messages").delete().eq("conversation_id", conversationId).eq("user_id", userId);
  if (del.error) return del.error;
  if (rows.length === 0) return null;
  const ins = await supabase
    .from("messages")
    .insert(rows.map((r) => ({ conversation_id: conversationId, user_id: userId, ...r })));
  return ins.error ?? null;
}
