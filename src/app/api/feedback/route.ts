// POST /api/feedback — record a thumbs up/down on an assistant answer.
//
// Scoped to the signed-in user (RLS: user_id = auth.uid()). Best-effort: if the
// message_feedback table doesn't exist yet (before migration 0006) it returns a
// clear, non-fatal message so the UI can quietly disable the control. Content
// snapshots are capped so a rating can't store an unbounded payload.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { notifyAdmins } from "@/lib/notifications";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";

const schema = z.object({
  rating: z.enum(["up", "down"]),
  conversationId: z.string().uuid().nullish(),
  content: z.string().max(20_000).optional(),
  prompt: z.string().max(20_000).optional(),
  mode: z.string().max(32).optional(),
  model: z.string().max(200).optional(),
  comment: z.string().max(2_000).optional(),
});

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const d = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("message_feedback").insert({
    user_id: user.id,
    conversation_id: d.conversationId ?? null,
    rating: d.rating,
    content: d.content ?? null,
    prompt: d.prompt ?? null,
    mode: d.mode ?? null,
    model: d.model ?? null,
    comment: d.comment ?? null,
  });

  if (error) {
    // Before migration 0006 the table doesn't exist — surface it clearly.
    const enabled = !/message_feedback/i.test(error.message);
    return NextResponse.json(
      { error: enabled ? error.message : "Feedback isn't enabled yet (run migration 0006).", enabled },
      { status: 500 }
    );
  }

  // QA loop: a thumbs-DOWN is worth an admin's attention. Notify admins (never
  // the rater themselves). Best-effort and non-blocking.
  if (d.rating === "down") {
    const snippet = d.prompt?.replace(/\s+/g, " ").trim().slice(0, 140);
    void notifyAdmins(
      {
        category: "action",
        title: "Answer rated not helpful",
        body: snippet ? `Prompt: “${snippet}”` : undefined,
        href: "/admin/feedback",
      },
      user.id
    );
  }

  return NextResponse.json({ ok: true });
}
