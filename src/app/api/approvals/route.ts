// GET  /api/approvals — the signed-in user's own approval requests + statuses.
// POST /api/approvals — submit an answer for approval (creates a pending request).
//
// Scoped to the user by RLS (user_id = auth.uid()). Submitting also notifies
// admins so a reviewer sees the new item. Degrades gracefully before migration
// 0010 (returns enabled:false so the UI can disable the submit action).

import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { notifyAdmins } from "@/lib/notifications";
import type { ApprovalItem, ApprovalStatus } from "@/lib/approvals";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";

const notEnabled = (msg: string) => /approvals/i.test(msg);

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("approvals")
    .select("id, title, content, prompt, mode, model, status, review_note, reviewed_at, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ items: [], enabled: !notEnabled(error.message) });
  }

  const items: ApprovalItem[] = (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    title: String(r.title ?? ""),
    content: String(r.content ?? ""),
    prompt: (r.prompt as string) ?? null,
    mode: (r.mode as string) ?? null,
    model: (r.model as string) ?? null,
    status: (r.status as ApprovalStatus) ?? "pending",
    reviewNote: (r.review_note as string) ?? null,
    reviewedAt: (r.reviewed_at as string) ?? null,
    createdAt: String(r.created_at ?? ""),
  }));
  return NextResponse.json({ items, enabled: true });
}

const schema = z.object({
  content: z.string().trim().min(1).max(50_000),
  title: z.string().trim().max(200).optional(),
  prompt: z.string().max(20_000).optional(),
  mode: z.string().max(32).optional(),
  model: z.string().max(200).optional(),
  conversationId: z.string().uuid().nullish(),
});

/** A short title from the first meaningful line of the content. */
function deriveTitle(content: string): string {
  const line = content.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "Untitled";
  return line.replace(/^#+\s*/, "").slice(0, 120);
}

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const d = parsed.data;
  const title = (d.title && d.title.trim()) || deriveTitle(d.content);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("approvals")
    .insert({
      user_id: user.id,
      title,
      content: d.content,
      prompt: d.prompt ?? null,
      mode: d.mode ?? null,
      model: d.model ?? null,
      conversation_id: d.conversationId ?? null,
      status: "pending",
    })
    .select("id")
    .single();

  if (error) {
    const enabled = !notEnabled(error.message);
    return NextResponse.json(
      { error: enabled ? error.message : "Approvals aren't enabled yet (run migration 0010).", enabled },
      { status: 500 }
    );
  }

  // Let reviewers know something is waiting. Best-effort, never the submitter.
  void notifyAdmins(
    {
      category: "action",
      title: "New content awaiting approval",
      body: title,
      href: "/admin/approvals",
    },
    user.id
  );

  return NextResponse.json({ ok: true, id: data?.id });
}
