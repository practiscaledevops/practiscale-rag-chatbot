// /api/admin/usage — the admin money + tokens aggregation endpoint.
//
// Powers the /admin/usage dashboard: KPI cards, a tokens+cost time series, and
// "by model & provider", "by user", and "by team" breakdowns. Every request is
// gated by requireChatbotAdmin() (session resolved server-side, role read via
// the SERVICE-ROLE client from profiles — NEVER a client claim). The read then
// uses the service-role client so it can roll up across ALL users/teams, which
// RLS would otherwise scope to the caller.
//
// Money is DERIVED FROM usage_events.cost_usd (already stored per event by the
// chat pipeline — see lib/pricing.ts). This route never re-prices; it only sums
// the stored estimates.
//
// FILTERS (query string)
//   range : "7d" | "30d" | "90d"                 (default "30d")
//   model : a concrete model id, or "all"        (default "all")
//   scope : "overall" | "user" | "team"          (default "overall")
// `scope` is echoed back so the client can remember which breakdown is in view;
// the response always carries every aggregate, so switching scope needs no
// refetch. `model` filters every card/table/point; the dropdown's option list
// (availableModels) is derived from the UNFILTERED range so it never collapses
// to the single selected model.

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireChatbotAdmin, AdminError } from "@/lib/admin";
import { createSupabaseServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
// Reads the session cookie (for gating) and always reflects live data.
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Query parsing
// ---------------------------------------------------------------------------

const RANGE_DAYS = { "7d": 7, "30d": 30, "90d": 90 } as const;

const querySchema = z.object({
  range: z.enum(["7d", "30d", "90d"]).default("30d"),
  // "all" (or empty) means no model filter. Any other string is a concrete id.
  model: z.string().trim().max(200).optional(),
  scope: z.enum(["overall", "user", "team"]).default("overall"),
});

// ---------------------------------------------------------------------------
// Row + aggregate shapes
// ---------------------------------------------------------------------------

/** The usage_events columns this route reads. */
interface UsageRow {
  user_id: string;
  team_id: string | null;
  provider: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  created_at: string;
}

/** A running tally reused by every grouping. */
interface Tally {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

const emptyTally = (): Tally => ({
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  costUsd: 0,
});

/** Fold one event into a tally (all values coerced to safe non-negative numbers). */
function add(t: Tally, row: UsageRow): void {
  const input = Math.max(0, Number(row.input_tokens) || 0);
  const output = Math.max(0, Number(row.output_tokens) || 0);
  const cost = Math.max(0, Number(row.cost_usd) || 0);
  t.requests += 1;
  t.inputTokens += input;
  t.outputTokens += output;
  t.totalTokens += input + output;
  t.costUsd += cost;
}

/** Round money to 6dp (matching numeric(12,6)) so JS float noise never leaks out. */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Serialize a tally, rounding the cost. */
function finishTally(t: Tally): Tally {
  return { ...t, costUsd: round6(t.costUsd) };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** UTC calendar-day key (YYYY-MM-DD) for an ISO timestamp. */
function dayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/** Ordered list of UTC day keys spanning [from, to] inclusive. */
function dayKeysBetween(from: Date, to: Date): string[] {
  const keys: string[] = [];
  const cursor = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  );
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  while (cursor.getTime() <= end) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

/**
 * Page through usage_events in [from, to) so a large fleet-wide range is never
 * silently truncated at PostgREST's default 1000-row cap. Ordered by created_at
 * to keep pagination stable. A safety cap bounds worst-case memory.
 */
async function fetchUsageRows(
  service: SupabaseClient,
  fromISO: string,
  toISO: string
): Promise<UsageRow[]> {
  const PAGE = 1000;
  const MAX_ROWS = 100_000; // hard stop; well past any realistic range at this stage
  const rows: UsageRow[] = [];

  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const { data, error } = await service
      .from("usage_events")
      .select(
        "user_id, team_id, provider, model, input_tokens, output_tokens, cost_usd, created_at"
      )
      .gte("created_at", fromISO)
      .lt("created_at", toISO)
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE - 1);

    if (error) throw new Error(error.message);
    const batch = (data ?? []) as UsageRow[];
    rows.push(...batch);
    if (batch.length < PAGE) break; // last page
  }

  return rows;
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  // 1) Admin gate — resolves the user server-side and checks role via service role.
  try {
    await requireChatbotAdmin();
  } catch (err) {
    if (err instanceof AdminError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  // 2) Parse + normalize filters.
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    range: url.searchParams.get("range") ?? undefined,
    model: url.searchParams.get("model") ?? undefined,
    scope: url.searchParams.get("scope") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { range, scope } = parsed.data;
  // Treat missing / "all" / empty as no model filter.
  const rawModel = (parsed.data.model ?? "").trim();
  const modelFilter = rawModel === "" || rawModel.toLowerCase() === "all" ? null : rawModel;

  const to = new Date();
  const from = new Date(to.getTime() - RANGE_DAYS[range] * 24 * 60 * 60 * 1000);

  // 3) Read the range once (unfiltered by model, so the dropdown stays populated).
  const service = createSupabaseServiceClient();
  let allRows: UsageRow[];
  try {
    allRows = await fetchUsageRows(service, from.toISOString(), to.toISOString());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Dropdown options: every model seen in the range, with its provider.
  const modelProviders = new Map<string, string>();
  for (const r of allRows) {
    const m = (r.model ?? "").trim();
    if (!m) continue;
    if (!modelProviders.has(m)) modelProviders.set(m, (r.provider ?? "").trim() || "unknown");
  }
  const availableModels = [...modelProviders.entries()]
    .map(([id, provider]) => ({ id, provider }))
    .sort((a, b) => a.id.localeCompare(b.id));

  // 4) Apply the optional model filter in JS (after the scoped range select).
  const rows = modelFilter
    ? allRows.filter((r) => (r.model ?? "") === modelFilter)
    : allRows;

  // 5) Aggregate: overall, byModel, byUser, byTeam, timeseries.
  const overall = emptyTally();
  const byModelMap = new Map<string, Tally & { provider: string }>();
  const byUserMap = new Map<string, Tally>();
  const byTeamMap = new Map<string, Tally>(); // key: team_id or "__none__"
  const byDayMap = new Map<string, Tally>();

  const NO_TEAM = "__none__";

  for (const r of rows) {
    add(overall, r);

    // by model & provider
    const model = (r.model ?? "unknown").trim() || "unknown";
    let mt = byModelMap.get(model);
    if (!mt) {
      mt = { ...emptyTally(), provider: (r.provider ?? "").trim() || "unknown" };
      byModelMap.set(model, mt);
    }
    add(mt, r);

    // by user
    let ut = byUserMap.get(r.user_id);
    if (!ut) {
      ut = emptyTally();
      byUserMap.set(r.user_id, ut);
    }
    add(ut, r);

    // by team (null team_id bucketed as "No team")
    const teamKey = r.team_id ?? NO_TEAM;
    let tt = byTeamMap.get(teamKey);
    if (!tt) {
      tt = emptyTally();
      byTeamMap.set(teamKey, tt);
    }
    add(tt, r);

    // timeseries (UTC day bucket)
    const day = dayKey(r.created_at);
    let dt = byDayMap.get(day);
    if (!dt) {
      dt = emptyTally();
      byDayMap.set(day, dt);
    }
    add(dt, r);
  }

  // 6) Resolve human labels: profiles (users) + teams (names + budgets).
  const userIds = [...byUserMap.keys()];
  const teamIds = [...byTeamMap.keys()].filter((k) => k !== NO_TEAM);

  const profileById = new Map<string, { email: string | null; displayName: string | null }>();
  if (userIds.length > 0) {
    const { data: profs } = await service
      .from("profiles")
      .select("id, email, display_name")
      .in("id", userIds);
    for (const p of profs ?? []) {
      profileById.set(p.id as string, {
        email: (p.email as string | null) ?? null,
        displayName: (p.display_name as string | null) ?? null,
      });
    }
  }

  const teamById = new Map<string, { name: string; budgetUsd: number | null }>();
  if (teamIds.length > 0) {
    const { data: teams } = await service
      .from("teams")
      .select("id, name, monthly_budget_usd")
      .in("id", teamIds);
    for (const t of teams ?? []) {
      teamById.set(t.id as string, {
        name: (t.name as string) ?? "Untitled team",
        budgetUsd:
          t.monthly_budget_usd == null ? null : Number(t.monthly_budget_usd),
      });
    }
  }

  // 7) Shape the breakdowns (sorted by cost desc — the money view leads).
  const byModel = [...byModelMap.entries()]
    .map(([model, t]) => ({ model, provider: t.provider, ...finishTally(t) }))
    .sort((a, b) => b.costUsd - a.costUsd);

  const byUser = [...byUserMap.entries()]
    .map(([userId, t]) => {
      const prof = profileById.get(userId);
      const label =
        prof?.displayName?.trim() ||
        prof?.email?.trim() ||
        `User ${userId.slice(0, 8)}`;
      return { userId, label, email: prof?.email ?? null, ...finishTally(t) };
    })
    .sort((a, b) => b.costUsd - a.costUsd);

  const byTeam = [...byTeamMap.entries()]
    .map(([teamKey, t]) => {
      const info = teamKey === NO_TEAM ? null : teamById.get(teamKey);
      const budgetUsd = info?.budgetUsd ?? null;
      const cost = round6(t.costUsd);
      return {
        teamId: teamKey === NO_TEAM ? null : teamKey,
        name: teamKey === NO_TEAM ? "No team" : info?.name ?? "Untitled team",
        ...finishTally(t),
        // Budget is a MONTHLY figure; over/under compares it to the current
        // filter's cost. remainingUsd is null when the team has no budget set.
        budgetUsd,
        remainingUsd: budgetUsd == null ? null : round6(budgetUsd - cost),
        overBudget: budgetUsd != null && cost > budgetUsd,
      };
    })
    .sort((a, b) => b.costUsd - a.costUsd);

  // Continuous daily series across the whole range (zero-filled gaps).
  const timeseries = dayKeysBetween(from, to).map((date) => {
    const t = byDayMap.get(date);
    return { date, ...finishTally(t ?? emptyTally()) };
  });

  return NextResponse.json({
    filters: {
      range,
      model: modelFilter ?? "all",
      scope,
      from: from.toISOString(),
      to: to.toISOString(),
    },
    availableModels,
    overall: finishTally(overall),
    byModel,
    byUser,
    byTeam,
    timeseries,
  });
}
