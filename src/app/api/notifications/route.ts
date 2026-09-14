// GET  /api/notifications        — the signed-in user's recent notifications + unread count.
// POST /api/notifications        — mark notifications read: { id } or { all: true }.
//
// Scoped to the user by RLS (user_id = auth.uid()). Reads/updates use the user's
// own session client, never the service role. Degrades gracefully to an empty,
// disabled state before migration 0009.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";

const notEnabled = (msg: string) => /notifications/i.test(msg);

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("id, category, title, body, href, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    // Before migration 0009 the table doesn't exist — quietly disable the bell.
    return NextResponse.json({ items: [], unread: 0, enabled: !notEnabled(error.message) });
  }

  const items = (data ?? []) as {
    id: string;
    category: string;
    title: string;
    body: string | null;
    href: string | null;
    read_at: string | null;
    created_at: string;
  }[];
  const unread = items.filter((n) => !n.read_at).length;
  return NextResponse.json({ items, unread, enabled: true });
}

const postSchema = z.union([
  z.object({ id: z.string().uuid() }),
  z.object({ all: z.literal(true) }),
]);

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = postSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const nowIso = new Date().toISOString();
  // RLS constrains the update to the user's own rows; the explicit user_id filter
  // is defence in depth.
  let q = supabase.from("notifications").update({ read_at: nowIso }).is("read_at", null).eq("user_id", user.id);
  if ("id" in parsed.data) q = q.eq("id", parsed.data.id);

  const { error } = await q;
  if (error) {
    return NextResponse.json(
      { ok: false, enabled: !notEnabled(error.message) },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
