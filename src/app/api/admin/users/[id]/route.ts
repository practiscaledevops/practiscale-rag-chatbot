// /api/admin/users/[id] — mutate a single user. Admin-gated; all writes go
// through the SERVICE-ROLE client after the code-side role check.
//
//   PATCH  — change role / activation / team / display name / permissions.
//   DELETE — deactivate (default, reversible) or hard-delete (?hard=true,
//            super_admin only — removes the auth user and cascades).
//
// Guardrails enforced here (never trusted from the client):
//   • Only a super_admin may grant OR modify the super_admin role.
//   • A plain admin cannot touch a super_admin account at all.
//   • You cannot change your own role or deactivate/delete yourself
//     (prevents an admin from locking themselves out).
//   • The last ACTIVE super_admin cannot be demoted, deactivated, or deleted.

import { NextResponse } from "next/server";
import { z } from "zod";
import type { ProfileRole } from "@/lib/admin";
import { createSupabaseServiceClient } from "@/lib/supabase-server";
import {
  resolveAdmin,
  getAuthAdmin,
  syncPrimaryTeam,
  countOtherActiveSuperAdmins,
  permissionsSchema,
  roleSchema,
} from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    displayName: z.string().trim().max(120).nullable().optional(),
    role: roleSchema.optional(),
    isActive: z.boolean().optional(),
    teamId: z.string().uuid().nullable().optional(),
    permissions: permissionsSchema.optional(),
    canUseAllModels: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

const idSchema = z.string().uuid();

/** Load the fields we need for the guard checks; null if the profile is gone. */
async function loadTarget(
  service: ReturnType<typeof createSupabaseServiceClient>,
  id: string
): Promise<{ role: ProfileRole; isActive: boolean; teamId: string | null } | null> {
  const { data } = await service
    .from("profiles")
    .select("id, role, is_active, team_id")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return {
    role: ((data.role as ProfileRole) ?? "user"),
    isActive: data.is_active !== false,
    teamId: (data.team_id as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// PATCH /api/admin/users/[id]
// ---------------------------------------------------------------------------
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await resolveAdmin();
  if ("error" in gate) return gate.error;
  const { admin } = gate;

  const { id: rawId } = await params;
  const idParsed = idSchema.safeParse(rawId);
  if (!idParsed.success) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }
  const id = idParsed.data;

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const body = parsed.data;

  const service = createSupabaseServiceClient();
  const target = await loadTarget(service, id);
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isSelf = id === admin.userId;

  // --- Self-lockout guards -------------------------------------------------
  if (isSelf && body.role !== undefined && body.role !== target.role) {
    return NextResponse.json(
      { error: "You cannot change your own role." },
      { status: 403 }
    );
  }
  if (isSelf && body.isActive === false) {
    return NextResponse.json(
      { error: "You cannot deactivate your own account." },
      { status: 403 }
    );
  }

  // --- super_admin protections --------------------------------------------
  // A plain admin may not modify a super_admin account in any way.
  if (target.role === "super_admin" && !admin.isSuperAdmin) {
    return NextResponse.json(
      { error: "Only a super admin can modify a super admin account." },
      { status: 403 }
    );
  }
  // Only a super_admin may grant the super_admin role.
  if (body.role === "super_admin" && !admin.isSuperAdmin) {
    return NextResponse.json(
      { error: "Only a super admin can grant the super admin role." },
      { status: 403 }
    );
  }

  // --- Last-super-admin guard ---------------------------------------------
  // Refuse a change that strips the last active super_admin of that status.
  const demotesSuper =
    target.role === "super_admin" &&
    ((body.role !== undefined && body.role !== "super_admin") || body.isActive === false);
  if (demotesSuper) {
    const others = await countOtherActiveSuperAdmins(service, id);
    if (others === 0) {
      return NextResponse.json(
        { error: "You cannot remove the last active super admin." },
        { status: 409 }
      );
    }
  }

  // --- Build the patch -----------------------------------------------------
  const patch: Record<string, unknown> = {};
  if (body.displayName !== undefined) patch.display_name = body.displayName;
  if (body.role !== undefined) patch.role = body.role;
  if (body.isActive !== undefined) patch.is_active = body.isActive;
  if (body.teamId !== undefined) patch.team_id = body.teamId;
  if (body.permissions !== undefined) patch.permissions = body.permissions;
  if (body.canUseAllModels !== undefined) patch.can_use_all_models = body.canUseAllModels;

  const { error: upErr } = await service.from("profiles").update(patch).eq("id", id);
  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  // Keep the team roster in sync when the primary team changed.
  if (body.teamId !== undefined && body.teamId !== target.teamId) {
    await syncPrimaryTeam(service, id, target.teamId, body.teamId ?? null);
  }

  return NextResponse.json({ ok: true });
}

// ---------------------------------------------------------------------------
// DELETE /api/admin/users/[id]?hard=true
// ---------------------------------------------------------------------------
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await resolveAdmin();
  if ("error" in gate) return gate.error;
  const { admin } = gate;

  const { id: rawId } = await params;
  const idParsed = idSchema.safeParse(rawId);
  if (!idParsed.success) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }
  const id = idParsed.data;
  const hard = new URL(req.url).searchParams.get("hard") === "true";

  if (id === admin.userId) {
    return NextResponse.json(
      { error: "You cannot delete or deactivate your own account." },
      { status: 403 }
    );
  }

  const service = createSupabaseServiceClient();
  const target = await loadTarget(service, id);
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // A super_admin target can only be removed by another super_admin, and never
  // if they are the last active one.
  if (target.role === "super_admin") {
    if (!admin.isSuperAdmin) {
      return NextResponse.json(
        { error: "Only a super admin can remove a super admin account." },
        { status: 403 }
      );
    }
    const others = await countOtherActiveSuperAdmins(service, id);
    if (others === 0) {
      return NextResponse.json(
        { error: "You cannot remove the last active super admin." },
        { status: 409 }
      );
    }
  }

  // --- Hard delete (permanent) --------------------------------------------
  if (hard) {
    if (!admin.isSuperAdmin) {
      return NextResponse.json(
        { error: "Only a super admin can permanently delete a user." },
        { status: 403 }
      );
    }
    const authAdmin = getAuthAdmin(service);
    if (!authAdmin || typeof authAdmin.deleteUser !== "function") {
      return NextResponse.json(
        { error: "Permanent deletion is unavailable in this environment." },
        { status: 503 }
      );
    }
    // Removing the auth user cascades to profiles / memberships / usage
    // (ON DELETE CASCADE from auth.users).
    const { error } = await authAdmin.deleteUser(id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, deleted: true });
  }

  // --- Soft delete (deactivate — reversible) ------------------------------
  const { error } = await service
    .from("profiles")
    .update({ is_active: false })
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, deactivated: true });
}
