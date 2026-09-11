// Server-only: load a user's conversations, tolerating the `archived` column not
// existing yet (before migration 0005 is applied). Returns rows with `archived`
// ALWAYS present (false when the column is absent), so the app can ship the
// archive UI before/after the migration without a broken window.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModelTier } from "@/lib/brain";

const BASE_COLS = "id, title, pinned, project_id, model_tier, created_at, updated_at";

export interface ConversationRow {
  id: string;
  title: string | null;
  pinned: boolean;
  project_id: string | null;
  model_tier: ModelTier;
  created_at: string;
  updated_at: string;
  archived: boolean;
}

/**
 * Load a user's conversations (pinned first, most-recently-touched next),
 * including `archived`. Falls back to a select without `archived` if that column
 * does not exist yet, so history never breaks pre-migration.
 */
export async function loadConversations(
  supabase: SupabaseClient,
  userId: string,
  opts?: { projectId?: string | null }
): Promise<ConversationRow[]> {
  for (const cols of [`${BASE_COLS}, archived`, BASE_COLS]) {
    let q = supabase
      .from("conversations")
      .select(cols)
      .eq("user_id", userId)
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false });
    if (opts?.projectId) q = q.eq("project_id", opts.projectId);

    const { data, error } = await q;
    if (!error) {
      const rows = (data ?? []) as unknown as Record<string, unknown>[];
      return rows.map((row) => ({
        ...(row as unknown as ConversationRow),
        archived: Boolean(row.archived),
      }));
    }
    // Only retry without `archived` when THAT is the problem; otherwise give up.
    if (!/archived/i.test(error.message)) return [];
  }
  return [];
}
