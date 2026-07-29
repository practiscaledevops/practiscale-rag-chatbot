// /api/admin/overview — fleet-wide summary for the admin Overview page.
//
// SECURITY: gated by requireChatbotAdmin() (lib/admin.ts), which resolves the
// caller's identity from the session and reads their app-wide role from
// profiles via the SERVICE-ROLE client — never a client claim. Only after that
// check passes do we aggregate across ALL users/teams with the service-role
// client (which bypasses RLS by design; that is exactly why the role check
// above is mandatory). This route lives in the chatbot's OWN Supabase project;
// it never touches the Brain.
//
// Returns 30-day totals (users, active users, teams, tokens, cost) plus a
// top-models breakdown. See the response shape at the bottom of GET().

import { NextResponse } from "next/server";
import { AdminError, requireChatbotAdmin } from "@/lib/admin";
import { createSupabaseServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
// Reads the session cookie (via requireChatbotAdmin) and live aggregates, so
// this route is always dynamic and must never be cached.
export const dynamic = "force-dynamic";

// Reporting window and pagination bounds. Supabase caps a single response at
// 1000 rows, so we range-paginate usage_events; MAX_PAGES bounds the work (and
// flags truncation) so an unexpectedly huge window can never run away.
const WINDOW_DAYS = 30;
const PAGE_SIZE = 1000;
const MAX_PAGES = 50; // aggregate up to 50k events per request

/** One metered-call row, as selected below. */
interface UsageRow {
  user_id: string;
  model: string | null;
  provider: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  // numeric(12,6) can arrive as number or string depending on magnitude.
  cost_usd: number | string | null;
}

/** Running per-model roll-up. */
interface ModelAgg {
  model: string;
  provider: string | null;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  events: number;
}

/** Coerce an unknown (number | numeric-string | null) to a finite number. */
function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : 0;
  return Number.isFinite(n) ? n : 0;
}

/** Round to 6 dp to line up with usage_events.cost_usd numeric(12,6). */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export async function GET() {
  // --- Admin gate (401 unauth / 403 not-admin) ------------------------------
  try {
    await requireChatbotAdmin();
  } catch (e) {
    if (e instanceof AdminError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const service = createSupabaseServiceClient();

  const until = new Date();
  const since = new Date(until.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const sinceIso = since.toISOString();

  // --- Fleet-wide counts ----------------------------------------------------
  // head:true transfers no rows — just the exact count from the planner.
  const [usersCount, teamsCount] = await Promise.all([
    service.from("profiles").select("id", { count: "exact", head: true }),
    service.from("teams").select("id", { count: "exact", head: true }),
  ]);

  if (usersCount.error) {
    return NextResponse.json({ error: usersCount.error.message }, { status: 500 });
  }
  if (teamsCount.error) {
    return NextResponse.json({ error: teamsCount.error.message }, { status: 500 });
  }

  // --- 30-day usage aggregation --------------------------------------------
  // Supabase has no ergonomic GROUP BY, so we page through the window and
  // aggregate in JS. "activeUsers" = distinct users with a metered call in the
  // window (an MAU-style signal that pairs with the token/cost totals).
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let events = 0;
  const activeUsers = new Set<string>();
  const byModel = new Map<string, ModelAgg>();
  let truncated = false;

  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, error } = await service
      .from("usage_events")
      .select("user_id, model, provider, input_tokens, output_tokens, cost_usd")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as UsageRow[];

    for (const r of rows) {
      const inTok = num(r.input_tokens);
      const outTok = num(r.output_tokens);
      const cost = num(r.cost_usd);

      inputTokens += inTok;
      outputTokens += outTok;
      costUsd += cost;
      events += 1;
      if (r.user_id) activeUsers.add(r.user_id);

      const model = (r.model ?? "").trim() || "unknown";
      const agg =
        byModel.get(model) ??
        {
          model,
          provider: r.provider ?? null,
          tokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          events: 0,
        };
      agg.tokens += inTok + outTok;
      agg.inputTokens += inTok;
      agg.outputTokens += outTok;
      agg.costUsd += cost;
      agg.events += 1;
      if (!agg.provider && r.provider) agg.provider = r.provider;
      byModel.set(model, agg);
    }

    // Last page reached, or we hit the safety cap with a full page remaining.
    if (rows.length < PAGE_SIZE) break;
    if (page === MAX_PAGES - 1) truncated = true;
  }

  const topModels = [...byModel.values()]
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 5)
    .map((m) => ({
      model: m.model,
      provider: m.provider,
      tokens: m.tokens,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      costUsd: round6(m.costUsd),
      events: m.events,
    }));

  return NextResponse.json({
    range: { days: WINDOW_DAYS, since: sinceIso, until: until.toISOString() },
    totals: {
      users: usersCount.count ?? 0,
      // Distinct users with a metered call in the last 30d (lower bound if
      // `truncated`).
      activeUsers: activeUsers.size,
      teams: teamsCount.count ?? 0,
      tokens: inputTokens + outputTokens,
      inputTokens,
      outputTokens,
      costUsd: round6(costUsd),
      events,
    },
    topModels,
    // True when the 30d window exceeded MAX_PAGES*PAGE_SIZE events; totals then
    // reflect the most-recent slice rather than the full window.
    truncated,
  });
}
