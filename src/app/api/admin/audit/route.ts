// GET /api/admin/audit — recent governance audit events.
//
// Admin-gated. Reads audit_log via the service-role client (the table's RLS
// allows admins to read, but the service client is consistent with the other
// admin routes and independent of the JWT claim). Optional ?action= filter.
// Degrades to empty + enabled:false before migration 0008.

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

  const action = new URL(req.url).searchParams.get("action");
  const service = createSupabaseServiceClient();

  let q = service
    .from("audit_log")
    .select("id, user_id, action, detail, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (action) q = q.eq("action", action);

  const { data, error } = await q;
  if (error) {
    const enabled = !/audit_log/i.test(error.message);
    return NextResponse.json({ items: [], enabled });
  }

  const rows = (data ?? []) as {
    id: string;
    user_id: string | null;
    action: string;
    detail: Record<string, unknown> | null;
    created_at: string;
  }[];

  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as string[];
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

  const items = rows.map((r) => ({
    id: r.id,
    action: r.action,
    detail: r.detail ?? {},
    createdAt: r.created_at,
    user: r.user_id ? names[r.user_id] ?? null : null,
  }));

  return NextResponse.json({ items, enabled: true });
}
