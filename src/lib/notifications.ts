// Server-only: create in-app notifications (see migration 0009). Writes via the
// service-role client so a producer can notify ANY user (RLS lets users only read
// their own). Best-effort — never throws, never blocks the request, and degrades
// silently if the table doesn't exist yet. Never import into a client component.

import { createSupabaseServiceClient } from "@/lib/supabase-server";

/** Priority buckets, mirrored by the UI's colors/icons. */
export type NotificationCategory = "info" | "success" | "warning" | "action";

export interface NotifyInput {
  category?: NotificationCategory;
  title: string;
  body?: string;
  /** Optional relative in-app link the notification deep-links to. */
  href?: string;
}

/** Create a notification for one user. Best-effort. */
export async function notify(userId: string, input: NotifyInput): Promise<void> {
  if (!userId || !input.title) return;
  try {
    const service = createSupabaseServiceClient();
    await service
      .from("notifications")
      .insert({
        user_id: userId,
        category: input.category ?? "info",
        title: input.title.slice(0, 200),
        body: input.body?.slice(0, 2000) ?? null,
        href: input.href?.slice(0, 500) ?? null,
      })
      .then(
        ({ error }) => {
          if (error && !/notifications/i.test(error.message)) {
            console.error("[notify] insert failed:", error.message);
          }
        },
        (e) => console.error("[notify] error:", e)
      );
  } catch {
    /* best-effort */
  }
}

/**
 * Notify every admin / super-admin (e.g. a QA event worth their attention).
 * Resolves the recipient ids via the service-role client, then inserts one row
 * each. Excludes `exceptUserId` (usually the actor) so people don't ping
 * themselves. Best-effort.
 */
export async function notifyAdmins(
  input: NotifyInput,
  exceptUserId?: string | null
): Promise<void> {
  try {
    const service = createSupabaseServiceClient();
    const { data, error } = await service
      .from("profiles")
      .select("id")
      .in("role", ["admin", "super_admin"])
      .eq("is_active", true);
    if (error || !data) return;

    const recipients = (data as { id: string }[])
      .map((r) => r.id)
      .filter((id) => id && id !== exceptUserId);
    if (recipients.length === 0) return;

    const rows = recipients.map((id) => ({
      user_id: id,
      category: input.category ?? "info",
      title: input.title.slice(0, 200),
      body: input.body?.slice(0, 2000) ?? null,
      href: input.href?.slice(0, 500) ?? null,
    }));
    await service
      .from("notifications")
      .insert(rows)
      .then(
        ({ error: e }) => {
          if (e && !/notifications/i.test(e.message)) {
            console.error("[notify] admin insert failed:", e.message);
          }
        },
        (e) => console.error("[notify] admin error:", e)
      );
  } catch {
    /* best-effort */
  }
}
