// GET /api/admin/feedback — QA review of thumbs up/down on answers.
//
// Admin-gated (service-role read; message_feedback RLS only lets a user read
// their OWN rows, so admins review via the service client after the role check).
// Returns recent feedback (optionally filtered by rating) with the rater's name
// and up/down counts. Degrades to empty + enabled:false before migration 0006.

import { NextResponse } from "next/server";
import { requireChatbotAdmin, AdminError } from "@/lib/admin";
import { createSupabaseServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireChatbotAdmin();
  } catch (e) {
    const err = e as AdminError;
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }

  const rating = new URL(req.url).searchParams.get("rating");
  const service = createSupabaseServiceClient();

  let q = service
    .from("message_feedback")
    .select("id, user_id, rating, content, prompt, mode, model, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (rating === "up" || rating === "down") q = q.eq("rating", rating);

  const { data, error } = await q;
  if (error) {
    // Table missing (pre-migration 0006) — tell the client to show the hint.
    const enabled = !/message_feedback/i.test(error.message);
    return NextResponse.json({ items: [], counts: { up: 0, down: 0 }, enabled });
  }

  const rows = (data ?? []) as {
    id: string;
    user_id: string;
    rating: string;
    content: string | null;
    prompt: string | null;
    mode: string | null;
    model: string | null;
    created_at: string;
  }[];

  // Resolve rater names.
  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
  const names: Record<string, string> = {};
  if (userIds.length) {
    const { data: profs } = await service
      .from("profiles")
      .select("id, email, display_name")
      .in("id", userIds);
    for (const p of (profs ?? []) as { id: string; email: string | null; display_name: string | null }[]) {
      names[p.id] = p.display_name || p.email || "";
    }
  }

  const [{ count: up }, { count: down }] = await Promise.all([
    service.from("message_feedback").select("id", { count: "exact", head: true }).eq("rating", "up"),
    service.from("message_feedback").select("id", { count: "exact", head: true }).eq("rating", "down"),
  ]);

  const items = rows.map((r) => ({
    id: r.id,
    rating: r.rating,
    content: r.content,
    prompt: r.prompt,
    mode: r.mode,
    model: r.model,
    createdAt: r.created_at,
    user: names[r.user_id] ?? null,
  }));

  return NextResponse.json({ items, counts: { up: up ?? 0, down: down ?? 0 }, enabled: true });
}
