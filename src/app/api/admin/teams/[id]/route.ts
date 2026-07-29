// /api/admin/teams/[id] — mutate or remove a single team. Admin-only, via the
// service-role client (bypasses RLS after an explicit code-side role check).
//
//   PATCH  — rename a team, edit its description, and/or set its monthly budget.
//   DELETE — remove a team. Per the schema FKs (supabase/setup/admin.sql):
//              • team_members rows cascade away (ON DELETE CASCADE),
//              • usage_events.team_id and profiles.team_id are SET NULL —
//                so deleting a team never destroys usage history or profiles.
//
// requireChatbotAdmin() gates every verb; the caller's role is read server-side
// and never trusted from the client.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireChatbotAdmin, AdminError } from "@/lib/admin";
import { createSupabaseServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Shared admin gate: NextResponse to short-circuit on denial, else null. */
async function guard(): Promise<NextResponse | null> {
  try {
    await requireChatbotAdmin();
    return null;
  } catch (e) {
    if (e instanceof AdminError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/** Coerce a possibly-stringy numeric column to a finite number (0 on failure). */
function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

const idSchema = z.string().uuid();

// At least one mutable field must accompany the id. `monthlyBudgetUsd: null`
// explicitly clears the budget; omitting the key leaves it untouched.
const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    monthlyBudgetUsd: z
      .number()
      .nonnegative()
      .max(9_999_999_999.99)
      .nullable()
      .optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.description !== undefined ||
      v.monthlyBudgetUsd !== undefined,
    { message: "No fields to update" }
  );

// PATCH /api/admin/teams/[id]
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = await guard();
  if (denied) return denied;

  const { id: rawId } = await ctx.params;
  const id = idSchema.safeParse(rawId);
  if (!id.success) {
    return NextResponse.json({ error: "Invalid team id" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { name, description, monthlyBudgetUsd } = parsed.data;

  // Only write the fields that were actually provided.
  const patch: Record<string, unknown> = {};
  if (name !== undefined) patch.name = name;
  if (description !== undefined) patch.description = description;
  if (monthlyBudgetUsd !== undefined) patch.monthly_budget_usd = monthlyBudgetUsd;

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("teams")
    .update(patch)
    .eq("id", id.data)
    .select("id, name, description, monthly_budget_usd, created_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    team: {
      id: data.id as string,
      name: data.name as string,
      description: (data.description as string | null) ?? null,
      monthlyBudgetUsd:
        data.monthly_budget_usd == null ? null : num(data.monthly_budget_usd),
      createdAt: data.created_at as string,
    },
  });
}

// DELETE /api/admin/teams/[id]
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = await guard();
  if (denied) return denied;

  const { id: rawId } = await ctx.params;
  const id = idSchema.safeParse(rawId);
  if (!id.success) {
    return NextResponse.json({ error: "Invalid team id" }, { status: 400 });
  }

  const service = createSupabaseServiceClient();
  const { error } = await service.from("teams").delete().eq("id", id.data);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
