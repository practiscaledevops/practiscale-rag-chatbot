// GET/PUT /api/ceo/memory — the executive's private memory (see migration 0007).
//
// Gated to super_admins only (the executive). Read/written through the
// service-role client so the row is never exposed to a normal user. All access
// is audited.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireChatbotAdmin, AdminError } from "@/lib/admin";
import { getCeoMemory, setCeoMemory } from "@/lib/ceo-memory";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";

async function requireCeo() {
  const admin = await requireChatbotAdmin(); // 401/403 if not an admin
  if (!admin.isSuperAdmin) throw new AdminError(403, "Executive workspace is restricted");
  return admin;
}

export async function GET() {
  try {
    const admin = await requireCeo();
    const content = await getCeoMemory(admin.userId);
    void audit(admin.userId, "ceo_memory_read");
    return NextResponse.json({ content });
  } catch (e) {
    const err = e as AdminError;
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }
}

export async function PUT(req: Request) {
  try {
    const admin = await requireCeo();
    const parsed = z.object({ content: z.string().max(8000) }).safeParse(
      await req.json().catch(() => ({}))
    );
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const res = await setCeoMemory(admin.userId, parsed.data.content);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 });
    void audit(admin.userId, "ceo_memory_write", { length: parsed.data.content.length });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const err = e as AdminError;
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }
}
