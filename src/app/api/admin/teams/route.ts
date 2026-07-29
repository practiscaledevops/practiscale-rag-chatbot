// /api/admin/teams — admin team management for the chatbot's OWN Supabase
// project (auth + chat history + projects + admin/usage). It NEVER touches the
// Brain; no knowledge/vectors live here.
//
//   GET  — list every team with member count, monthly budget, current-month
//          spend (sum of its MEMBERS' usage_events.cost_usd), and the roster.
//   POST — create a team (name + optional description + optional monthly budget).
//
// SECURITY MODEL (see lib/admin.ts + supabase/setup/admin.sql):
//   • requireChatbotAdmin() resolves the caller from the Supabase session
//     (server-side) and reads their app-wide role via the SERVICE-ROLE client —
//     an admin/super_admin is required. A client-supplied role is never trusted.
//   • All reads/writes use the SERVICE-ROLE client, which bypasses RLS so an
//     admin can see and manage every team/member/usage row. That key is
//     server-only (SUPABASE_SERVICE_ROLE_KEY) and never reaches the browser.

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireChatbotAdmin, AdminError } from "@/lib/admin";
import { createSupabaseServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Shared admin gate. Returns a NextResponse to short-circuit on denial, or null
// when the caller is an authorized admin. (Inlined per-route since these route
// files are the only ones this feature owns.)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Spend helpers
// ---------------------------------------------------------------------------

/** First instant of the current month in UTC, as an ISO string. */
function currentMonthStartISO(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** Coerce a possibly-stringy numeric column to a finite number (0 on failure). */
function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Round a USD amount to whole micro-dollars, matching usage_events(12,6). */
function roundUsd(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * Sum usage_events.cost_usd per user for the current month, across the given
 * users. Paginated so the total stays correct beyond PostgREST's default row
 * cap (a busy month can exceed 1,000 metered calls). Returns a Map user_id→USD.
 */
async function costByUserForMonth(
  service: SupabaseClient,
  userIds: string[],
  monthStartISO: string
): Promise<Map<string, number>> {
  const costs = new Map<string, number>();
  if (userIds.length === 0) return costs;

  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await service
      .from("usage_events")
      .select("user_id, cost_usd")
      .gte("created_at", monthStartISO)
      .in("user_id", userIds)
      .order("id", { ascending: true }) // stable order for correct paging
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const row of data as { user_id: string; cost_usd: unknown }[]) {
      costs.set(row.user_id, (costs.get(row.user_id) ?? 0) + num(row.cost_usd));
    }
    if (data.length < PAGE) break; // last page
  }
  return costs;
}

// Team-role ordering for a stable, readable roster (owner → manager → member).
const ROLE_WEIGHT: Record<string, number> = { owner: 0, manager: 1, member: 2 };

// ---------------------------------------------------------------------------
// GET /api/admin/teams
// ---------------------------------------------------------------------------
export async function GET() {
  const denied = await guard();
  if (denied) return denied;

  const service = createSupabaseServiceClient();

  // 1. All teams (newest first).
  const { data: teams, error: teamsErr } = await service
    .from("teams")
    .select("id, name, description, monthly_budget_usd, created_at")
    .order("created_at", { ascending: false });
  if (teamsErr) {
    return NextResponse.json({ error: teamsErr.message }, { status: 500 });
  }

  // 2. Full membership across all teams (admin/service-role view).
  const { data: members, error: membersErr } = await service
    .from("team_members")
    .select("team_id, user_id, role, created_at");
  if (membersErr) {
    return NextResponse.json({ error: membersErr.message }, { status: 500 });
  }

  const memberRows = members ?? [];
  const userIds = [...new Set(memberRows.map((m) => m.user_id as string))];

  // 3. Profile display fields for the roster (no FK team_members→profiles, so
  //    we join in JS by user id).
  const profileById = new Map<
    string,
    { email: string | null; displayName: string | null }
  >();
  if (userIds.length > 0) {
    const { data: profiles, error: profErr } = await service
      .from("profiles")
      .select("id, email, display_name")
      .in("id", userIds);
    if (profErr) {
      return NextResponse.json({ error: profErr.message }, { status: 500 });
    }
    for (const p of profiles ?? []) {
      profileById.set(p.id as string, {
        email: (p.email as string | null) ?? null,
        displayName: (p.display_name as string | null) ?? null,
      });
    }
  }

  // 4. Current-month spend per member user.
  const monthStart = currentMonthStartISO();
  let costByUser: Map<string, number>;
  try {
    costByUser = await costByUserForMonth(service, userIds, monthStart);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not compute spend";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // 5. Group members by team and assemble each team's shape.
  const rosterByTeam = new Map<string, typeof memberRows>();
  for (const m of memberRows) {
    const key = m.team_id as string;
    const list = rosterByTeam.get(key) ?? [];
    list.push(m);
    rosterByTeam.set(key, list);
  }

  const shaped = (teams ?? []).map((t) => {
    const roster = rosterByTeam.get(t.id as string) ?? [];
    // Team spend = sum of its members' current-month cost (member attribution,
    // robust to whether the event's team_id was tagged at write time).
    const spendUsd = roundUsd(
      roster.reduce((sum, m) => sum + (costByUser.get(m.user_id as string) ?? 0), 0)
    );

    const rosterShaped = roster
      .map((m) => {
        const prof = profileById.get(m.user_id as string);
        return {
          userId: m.user_id as string,
          email: prof?.email ?? null,
          displayName: prof?.displayName ?? null,
          role: (m.role as string) ?? "member",
          createdAt: m.created_at as string,
        };
      })
      .sort((a, b) => {
        const wa = ROLE_WEIGHT[a.role] ?? 3;
        const wb = ROLE_WEIGHT[b.role] ?? 3;
        if (wa !== wb) return wa - wb;
        return (a.displayName ?? a.email ?? "").localeCompare(
          b.displayName ?? b.email ?? ""
        );
      });

    return {
      id: t.id as string,
      name: t.name as string,
      description: (t.description as string | null) ?? null,
      monthlyBudgetUsd:
        t.monthly_budget_usd == null ? null : num(t.monthly_budget_usd),
      createdAt: t.created_at as string,
      memberCount: roster.length,
      spendUsd,
      members: rosterShaped,
    };
  });

  return NextResponse.json({ teams: shaped, monthStart });
}

// ---------------------------------------------------------------------------
// POST /api/admin/teams — create a team.
// ---------------------------------------------------------------------------
const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullish(),
  // Optional soft monthly budget in USD (numeric(12,2)); null clears it.
  monthlyBudgetUsd: z.number().nonnegative().max(9_999_999_999.99).nullish(),
});

export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { name, description, monthlyBudgetUsd } = parsed.data;

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("teams")
    .insert({
      name,
      description: description ?? null,
      monthly_budget_usd: monthlyBudgetUsd ?? null,
    })
    .select("id, name, description, monthly_budget_usd, created_at")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Could not create team" },
      { status: 500 }
    );
  }

  // Return the same enriched shape as GET so the client can insert without a
  // refetch (a fresh team has no members and no spend yet).
  return NextResponse.json(
    {
      team: {
        id: data.id as string,
        name: data.name as string,
        description: (data.description as string | null) ?? null,
        monthlyBudgetUsd:
          data.monthly_budget_usd == null ? null : num(data.monthly_budget_usd),
        createdAt: data.created_at as string,
        memberCount: 0,
        spendUsd: 0,
        members: [],
      },
    },
    { status: 201 }
  );
}
