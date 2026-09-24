// GET  /api/admin/approvals — the review queue (pending first, then recent).
// POST /api/admin/approvals — review one request: { id, action, note? }.
//
// Admin-gated. Reads + writes via the SERVICE-ROLE client (a user can never
// approve their own content). Reviewing notifies the submitter through the
// notifications center. Degrades gracefully before migration 0010.
//
// Intentionally NOT narrowed by the admin's own data.* capabilities: reviewing a
// submission means reading it. The queue holds user-submitted answers, never raw
// knowledge chunks (unlike /api/admin/retrieve, which is narrowed).

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireChatbotAdmin, AdminError } from "@/lib/admin";
import { createSupabaseServiceClient } from "@/lib/supabase-server";
import { notify } from "@/lib/notifications";
import { REVIEW_ACTIONS, APPROVAL_STATUS_LABEL, type ApprovalItem, type ApprovalStatus } from "@/lib/approvals";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";

const notEnabled = (msg: string) => /approvals/i.test(msg);

async function gate() {
  await requireChatbotAdmin();
}

export async function GET(req: Request) {
  try {
    await gate();
  } catch (e) {
    const err = e as AdminError;
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }

  const status = new URL(req.url).searchParams.get("status");
  const service = createSupabaseServiceClient();

  let q = service
    .from("approvals")
    .select("id, user_id, title, content, prompt, mode, model, status, review_note, reviewed_at, created_at")
    // Pending first (a is null false→true), then newest.
    .order("reviewed_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: false })
    .limit(100);
  if (status) q = q.eq("status", status);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ items: [], enabled: !notEnabled(error.message) });
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  const submitterIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as string[];
  const names: Record<string, string> = {};
  if (submitterIds.length) {
    const { data: profs } = await service
      .from("profiles")
      .select("id, email, display_name")
      .in("id", submitterIds);
    for (const p of (profs ?? []) as { id: string; email: string | null; display_name: string | null }[]) {
      names[p.id] = p.display_name || p.email || "";
    }
  }

  const items: ApprovalItem[] = rows.map((r) => ({
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
    submitter: r.user_id ? names[r.user_id as string] ?? null : null,
  }));
  return NextResponse.json({ items, enabled: true });
}

const reviewSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["approve", "reject", "request_changes"]),
  note: z.string().max(2000).optional(),
});

export async function POST(req: Request) {
  let admin;
  try {
    admin = await requireChatbotAdmin();
  } catch (e) {
    const err = e as AdminError;
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }

  const parsed = reviewSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { id, action, note } = parsed.data;
  const newStatus = REVIEW_ACTIONS[action];

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("approvals")
    .update({
      status: newStatus,
      reviewer_id: admin.userId,
      review_note: note ?? null,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("user_id, title")
    .single();

  if (error) {
    const enabled = !notEnabled(error.message);
    return NextResponse.json(
      { error: enabled ? error.message : "Approvals aren't enabled yet (run migration 0010).", enabled },
      { status: 500 }
    );
  }

  // Notify the submitter of the outcome.
  const submitterId = (data as { user_id?: string })?.user_id;
  const title = (data as { title?: string })?.title ?? "your submission";
  if (submitterId) {
    const approved = newStatus === "approved";
    void notify(submitterId, {
      category: approved ? "success" : "warning",
      title: `${APPROVAL_STATUS_LABEL[newStatus]}: ${title}`.slice(0, 200),
      body: note || undefined,
      href: "/approvals",
    });
  }

  return NextResponse.json({ ok: true, status: newStatus });
}
