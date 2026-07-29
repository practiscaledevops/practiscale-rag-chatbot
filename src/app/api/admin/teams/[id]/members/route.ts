// /api/admin/teams/[id]/members — manage a team's roster. Admin-only, via the
// service-role client. team_members is the source of truth for membership;
// profiles.team_id is a user's PRIMARY team pointer that we keep in sync here.
//
//   POST   — add a user to the team (by email or userId), or update their
//            team-scoped role (member | manager | owner). Idempotent: re-adding
//            or re-roling the same user upserts the (team_id, user_id) row.
//            Setting role = "owner" makes them the team's PRIMARY OWNER —
//            any existing owner is demoted to "manager" so there is exactly one.
//            On add, profiles.team_id is set to this team (keeps the primary
//            team in sync when a user is added).
//   DELETE — remove a user from the team. If this was the user's primary team,
//            profiles.team_id is reassigned to another team they still belong
//            to, or cleared to null.
//
// requireChatbotAdmin() gates every verb; the caller's role is resolved
// server-side and never trusted from the client.

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

const idSchema = z.string().uuid();
const teamRole = z.enum(["member", "manager", "owner"]);

// Add/role-set: identify the user by email OR userId, with an optional role.
const postSchema = z
  .object({
    userId: z.string().uuid().optional(),
    email: z.string().trim().email().optional(),
    role: teamRole.default("member"),
  })
  .refine((v) => v.userId !== undefined || v.email !== undefined, {
    message: "Provide a userId or an email",
  });

const deleteSchema = z.object({ userId: z.string().uuid() });

/** Escape LIKE wildcards so an email matches literally (case-insensitively). */
function likeLiteral(s: string): string {
  return s.replace(/([%_])/g, "\\$1");
}

// POST /api/admin/teams/[id]/members — add a member / set role.
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = await guard();
  if (denied) return denied;

  const { id: rawId } = await ctx.params;
  const teamId = idSchema.safeParse(rawId);
  if (!teamId.success) {
    return NextResponse.json({ error: "Invalid team id" }, { status: 400 });
  }

  const parsed = postSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { userId: bodyUserId, email, role } = parsed.data;

  const service = createSupabaseServiceClient();

  // Confirm the team exists (clean 404 rather than an FK error on insert).
  const { data: team, error: teamErr } = await service
    .from("teams")
    .select("id")
    .eq("id", teamId.data)
    .maybeSingle();
  if (teamErr) {
    return NextResponse.json({ error: teamErr.message }, { status: 500 });
  }
  if (!team) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  // Resolve the target user's profile (for the id when given an email, and to
  // return display fields to the client).
  let profileQuery = service.from("profiles").select("id, email, display_name");
  profileQuery = bodyUserId
    ? profileQuery.eq("id", bodyUserId)
    : profileQuery.ilike("email", likeLiteral(email!));
  const { data: profile, error: profErr } = await profileQuery.maybeSingle();
  if (profErr) {
    return NextResponse.json({ error: profErr.message }, { status: 500 });
  }
  if (!profile) {
    return NextResponse.json(
      { error: bodyUserId ? "User not found" : "No user with that email" },
      { status: 404 }
    );
  }
  const userId = profile.id as string;

  // Exactly one primary owner: demote any current owner before promoting.
  if (role === "owner") {
    const { error: demoteErr } = await service
      .from("team_members")
      .update({ role: "manager" })
      .eq("team_id", teamId.data)
      .eq("role", "owner")
      .neq("user_id", userId);
    if (demoteErr) {
      return NextResponse.json({ error: demoteErr.message }, { status: 500 });
    }
  }

  // Upsert membership so add + re-role share one path (PK: team_id, user_id).
  const { data: member, error: upsertErr } = await service
    .from("team_members")
    .upsert(
      { team_id: teamId.data, user_id: userId, role },
      { onConflict: "team_id,user_id" }
    )
    .select("team_id, user_id, role, created_at")
    .single();
  if (upsertErr || !member) {
    return NextResponse.json(
      { error: upsertErr?.message ?? "Could not add member" },
      { status: 500 }
    );
  }

  // Keep the user's PRIMARY team pointer in sync with the newly added team.
  const { error: syncErr } = await service
    .from("profiles")
    .update({ team_id: teamId.data })
    .eq("id", userId);
  if (syncErr) {
    return NextResponse.json({ error: syncErr.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      member: {
        userId,
        email: (profile.email as string | null) ?? null,
        displayName: (profile.display_name as string | null) ?? null,
        role: member.role as string,
        createdAt: member.created_at as string,
      },
    },
    { status: 201 }
  );
}

// DELETE /api/admin/teams/[id]/members — remove a member.
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = await guard();
  if (denied) return denied;

  const { id: rawId } = await ctx.params;
  const teamId = idSchema.safeParse(rawId);
  if (!teamId.success) {
    return NextResponse.json({ error: "Invalid team id" }, { status: 400 });
  }

  // Accept the userId from the body or, as a convenience, the query string.
  const body = await req.json().catch(() => ({}));
  const userId = body?.userId ?? new URL(req.url).searchParams.get("userId");
  const parsed = deleteSchema.safeParse({ userId });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const service = createSupabaseServiceClient();
  const { error: delErr } = await service
    .from("team_members")
    .delete()
    .eq("team_id", teamId.data)
    .eq("user_id", parsed.data.userId);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  // Keep the primary team in sync: if this was the user's primary team, move
  // the pointer to another team they still belong to, else clear it.
  const { data: prof } = await service
    .from("profiles")
    .select("team_id")
    .eq("id", parsed.data.userId)
    .maybeSingle();

  if (prof && (prof.team_id as string | null) === teamId.data) {
    const { data: remaining } = await service
      .from("team_members")
      .select("team_id")
      .eq("user_id", parsed.data.userId)
      .order("created_at", { ascending: true })
      .limit(1);
    const next = (remaining?.[0]?.team_id as string | undefined) ?? null;
    const { error: syncErr } = await service
      .from("profiles")
      .update({ team_id: next })
      .eq("id", parsed.data.userId);
    if (syncErr) {
      return NextResponse.json({ error: syncErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
