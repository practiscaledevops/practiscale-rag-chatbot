// Server-only: best-effort governance audit log (see migration 0008). Writes via
// the service-role client; never throws and never blocks the request. Degrades
// silently (skips) if the table doesn't exist yet. Never import into a client.

import { createSupabaseServiceClient } from "@/lib/supabase-server";

export async function audit(
  userId: string | null,
  action: string,
  detail: Record<string, unknown> = {}
): Promise<void> {
  try {
    const service = createSupabaseServiceClient();
    await service
      .from("audit_log")
      .insert({ user_id: userId, action, detail })
      .then(
        ({ error }) => {
          if (error && !/audit_log/i.test(error.message)) {
            console.error("[audit] insert failed:", error.message);
          }
        },
        (e) => console.error("[audit] error:", e)
      );
  } catch {
    /* best-effort */
  }
}
