// /api/admin/users — admin user management + access control (the chatbot's OWN
// Supabase project). This is the fleet-wide view: every route here is gated by
// requireChatbotAdmin() and does its cross-user reads/writes through the
// SERVICE-ROLE client (bypasses RLS). The caller's role is resolved server-side
// from profiles — never trusted from a client claim (see lib/admin.ts).
//
//   GET  — list all users (profiles + auth email/timestamps + a best-effort
//          usage roll-up) plus the reference data the editor needs (teams,
//          model catalog, feature keys, tiers).
//   POST — create a user: provision a Supabase Auth user (service-role
//          auth.admin) with an initial password OR an email invite, then upsert
//          the profile row (role / permissions / team / activation).
//
// Escalation rule: only a super_admin may grant the super_admin role.
//
// Shared building blocks (schemas, types, the payload builder, the admin
// resolver, team-membership sync) live in lib/admin-users.ts so the sibling
// [id]/route.ts (PATCH/DELETE) and the server page.tsx can reuse them without
// this route re-exporting non-handler symbols.

import { NextResponse } from "next/server";
import { z } from "zod";
import type { ProfileRole } from "@/lib/admin";
import { createSupabaseServiceClient } from "@/lib/supabase-server";
import {
  resolveAdmin,
  getAuthAdmin,
  syncPrimaryTeam,
  buildAdminUsersPayload,
  permissionsSchema,
  roleSchema,
} from "@/lib/admin-users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Validation (create — the update schema lives in [id]/route.ts)
// ---------------------------------------------------------------------------

const createSchema = z
  .object({
    email: z.string().trim().email().max(320),
    displayName: z.string().trim().max(120).optional(),
    role: roleSchema.optional(),
    teamId: z.string().uuid().nullish(),
    // "password" sets an initial password (email pre-confirmed); "invite" sends
    // a Supabase invite email so the user sets their own password.
    mode: z.enum(["password", "invite"]).default("password"),
    password: z.string().min(8).max(200).optional(),
    permissions: permissionsSchema.optional(),
    canUseAllModels: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => v.mode !== "password" || (!!v.password && v.password.length >= 8), {
    message: "An initial password of at least 8 characters is required.",
    path: ["password"],
  });

// ---------------------------------------------------------------------------
// GET /api/admin/users — list users + reference data
// ---------------------------------------------------------------------------
export async function GET() {
  const gate = await resolveAdmin();
  if ("error" in gate) return gate.error;

  try {
    const payload = await buildAdminUsersPayload(gate.admin);
    return NextResponse.json(payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not load users";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/admin/users — create an auth user + profile
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  const gate = await resolveAdmin();
  if ("error" in gate) return gate.error;
  const { admin } = gate;

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const body = parsed.data;

  const role: ProfileRole = body.role ?? "user";
  // Escalation guard: only a super_admin may mint another super_admin.
  if (role === "super_admin" && !admin.isSuperAdmin) {
    return NextResponse.json(
      { error: "Only a super admin can grant the super admin role." },
      { status: 403 }
    );
  }

  const service = createSupabaseServiceClient();
  const authAdmin = getAuthAdmin(service);
  if (!authAdmin) {
    return NextResponse.json(
      { error: "User provisioning is unavailable in this environment." },
      { status: 503 }
    );
  }

  const displayMeta = body.displayName ? { display_name: body.displayName } : undefined;

  // --- Provision the Supabase Auth user -----------------------------------
  let newUserId: string | null = null;
  let provisionError: { message?: string } | null = null;

  if (body.mode === "invite") {
    if (typeof authAdmin.inviteUserByEmail !== "function") {
      return NextResponse.json(
        { error: "Email invites are not configured in this environment." },
        { status: 503 }
      );
    }
    const { data, error } = await authAdmin.inviteUserByEmail(body.email, {
      data: displayMeta,
    });
    provisionError = error;
    newUserId = data?.user?.id ?? null;
  } else {
    const { data, error } = await authAdmin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true, // admin-set password: skip the confirmation email
      user_metadata: displayMeta,
    });
    provisionError = error;
    newUserId = data?.user?.id ?? null;
  }

  if (provisionError || !newUserId) {
    return NextResponse.json(
      { error: provisionError?.message ?? "Could not create the user." },
      { status: 400 }
    );
  }

  // --- Upsert the profile --------------------------------------------------
  // handle_new_user() likely inserted a base row already; upsert layers the
  // admin-chosen role / permissions / team / activation on top of it. We only
  // write display_name when the admin supplied one, so an empty field keeps the
  // trigger's friendly default (the email local-part) rather than nulling it.
  const profilePatch: Record<string, unknown> = {
    id: newUserId,
    email: body.email,
    role,
    is_active: body.isActive ?? true,
    team_id: body.teamId ?? null,
    permissions: body.permissions ?? {},
    can_use_all_models: body.canUseAllModels ?? false,
  };
  if (body.displayName) profilePatch.display_name = body.displayName;

  const { error: upErr } = await service
    .from("profiles")
    .upsert(profilePatch, { onConflict: "id" });
  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  if (body.teamId) {
    await syncPrimaryTeam(service, newUserId, null, body.teamId);
  }

  return NextResponse.json(
    { ok: true, id: newUserId, invited: body.mode === "invite" },
    { status: 201 }
  );
}
