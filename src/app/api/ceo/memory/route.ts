// GET/PUT /api/ceo/memory — the executive's private memory (see migration 0007).
//
// Gated to users holding the "app.executive_memory" capability (admins by
// default, members only when granted). Read/written through the
// service-role client so the row is never exposed to a normal user. All access
// is audited.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionProfile, AdminError } from "@/lib/admin";
import { canUseExecutive } from "@/lib/work-modes";
import { accessFromProfile } from "@/lib/access";
import { getCeoMemory, setCeoMemory } from "@/lib/ceo-memory";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";

/** The signed-in user, if they hold "app.executive_memory" (+ a CEO mode). */
async function requireExecutive() {
  const profile = await getSessionProfile();
  if (!profile) throw new AdminError(401, "Unauthorized");
  if (!canUseExecutive(accessFromProfile(profile))) {
    throw new AdminError(403, "Executive workspace is restricted");
  }
  return profile;
}

export async function GET() {
  try {
    const me = await requireExecutive();
    const content = await getCeoMemory(me.userId);
    void audit(me.userId, "ceo_memory_read");
    return NextResponse.json({ content });
  } catch (e) {
    const err = e as AdminError;
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }
}

export async function PUT(req: Request) {
  try {
    const me = await requireExecutive();
    const parsed = z.object({ content: z.string().max(8000) }).safeParse(
      await req.json().catch(() => ({}))
    );
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const res = await setCeoMemory(me.userId, parsed.data.content);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 });
    void audit(me.userId, "ceo_memory_write", { length: parsed.data.content.length });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const err = e as AdminError;
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }
}
