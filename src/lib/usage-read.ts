// Server-only: read a user's own token usage for the persisted usage meter.
//
// usage_events has no user-facing SELECT policy (writes go through the
// service-role client in lib/usage.ts), so this reads via the service-role
// client with an EXPLICIT user_id filter — the user only ever sees their own
// totals. Never import into a client component.

import { createSupabaseServiceClient } from "@/lib/supabase-server";

/** First day of the current month at 00:00 UTC, as an ISO string. */
function startOfMonthISO(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * Total tokens (prompt + completion) the user has spent so far this calendar
 * month. Best-effort: any error resolves to 0 so the meter degrades gracefully
 * to "session only" rather than breaking the shell.
 */
export async function getMonthlyUsageTokens(userId: string): Promise<number> {
  try {
    const service = createSupabaseServiceClient();
    const { data, error } = await service
      .from("usage_events")
      .select("input_tokens, output_tokens")
      .eq("user_id", userId)
      .gte("created_at", startOfMonthISO())
      .limit(20_000);
    if (error || !data) return 0;
    let total = 0;
    for (const r of data as { input_tokens: number | null; output_tokens: number | null }[]) {
      total += (r.input_tokens ?? 0) + (r.output_tokens ?? 0);
    }
    return total;
  } catch {
    return 0;
  }
}
