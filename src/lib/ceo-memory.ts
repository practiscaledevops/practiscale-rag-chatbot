// Server-only: private CEO/executive memory (see migration 0007). Read + written
// ONLY through the service-role client, gated by a super_admin check at every
// call site, so it can never reach a normal user. Never import into a client
// component. Degrades to empty/clear message if the table doesn't exist yet.

import { createSupabaseServiceClient } from "@/lib/supabase-server";

const MAX = 8000;

export async function getCeoMemory(userId: string): Promise<string> {
  try {
    const service = createSupabaseServiceClient();
    const { data } = await service
      .from("ceo_memory")
      .select("content")
      .eq("user_id", userId)
      .maybeSingle();
    return ((data as { content?: string } | null)?.content ?? "").slice(0, MAX);
  } catch {
    return "";
  }
}

export async function setCeoMemory(
  userId: string,
  content: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const service = createSupabaseServiceClient();
    const { error } = await service.from("ceo_memory").upsert(
      { user_id: userId, content: content.slice(0, MAX), updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
    if (error) {
      return {
        ok: false,
        error: /ceo_memory/i.test(error.message)
          ? "Executive memory isn't enabled yet (run migration 0007)."
          : error.message,
      };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "failed" };
  }
}
