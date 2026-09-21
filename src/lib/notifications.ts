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

/** Admin pings of one kind from one actor are collapsed to one per this window. */
const ADMIN_NOTIFY_DEDUPE_MS = 10 * 60_000;

/** `${kind}:${userId}` → epoch ms of the last admin notification sent. Per-instance. */
const lastAdminNotify = new Map<string, number>();

/**
 * Whether an admin notification of `kind` from `userId` may go out now (and
 * record it if so). Bounded: entries older than the window are swept once the
 * map grows past a few thousand keys.
 */
function shouldNotifyAdmins(kind: string, userId: string, now = Date.now()): boolean {
  if (lastAdminNotify.size > 5_000) {
    for (const [k, t] of lastAdminNotify) {
      if (now - t >= ADMIN_NOTIFY_DEDUPE_MS) lastAdminNotify.delete(k);
    }
  }
  const key = `${kind}:${userId}`;
  const last = lastAdminNotify.get(key);
  if (last !== undefined && now - last < ADMIN_NOTIFY_DEDUPE_MS) return false;
  lastAdminNotify.set(key, now);
  return true;
}

/**
 * Notify every admin / super-admin (e.g. a QA event worth their attention).
 * Resolves the recipient ids via the service-role client, then inserts one row
 * each. Excludes `exceptUserId` (usually the actor) so people don't ping
 * themselves. Best-effort.
 *
 * @param dedupeKind  when set (with `exceptUserId` as the actor), at most ONE
 *                    notification of this kind per actor is sent every 10
 *                    minutes — so a user hammering thumbs-down / submit can't
 *                    flood every admin's inbox. In-memory, per instance.
 */
export async function notifyAdmins(
  input: NotifyInput,
  exceptUserId?: string | null,
  dedupeKind?: string
): Promise<void> {
  if (dedupeKind && exceptUserId && !shouldNotifyAdmins(dedupeKind, exceptUserId)) return;
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
