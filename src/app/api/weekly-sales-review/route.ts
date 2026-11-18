import { z } from "zod";
import { getSessionProfile } from "@/lib/admin";
import { accessFromProfile, allowedSourceTypes, effectiveCapabilities } from "@/lib/access";
import { brainWeeklySalesReview } from "@/lib/brain";
import { isDemo } from "@/lib/demo/mode";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { lastCompletedMonday, reviewTimeZone, weekEnd, type WeeklySalesReview } from "@/lib/weekly-sales-review";
import { canOpenWeeklySalesReview, weeklySalesReviewEnabled } from "@/lib/weekly-sales-review-access";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const maxDuration = 120;

const headers = { "Cache-Control": "private, no-store" };
const schema = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), refreshGhl: z.boolean().optional() }).strict();

export async function POST(req: Request) {
  if (!weeklySalesReviewEnabled()) return Response.json({ error: "Weekly Sales Review is unavailable." }, { status: 404, headers });
  const profile = await getSessionProfile();
  if (!profile) return Response.json({ error: "Sign in to run a report." }, { status: 401, headers });
  if (!canOpenWeeklySalesReview(profile.role)) return Response.json({ error: "Weekly Sales Review requires admin access." }, { status: 403, headers });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  const from = parsed.success ? parsed.data.from : "";
  const date = new Date(from + "T00:00:00Z");
  if (!parsed.success || !Number.isFinite(+date) || date.toISOString().slice(0, 10) !== from ||
    date.getUTCDay() !== 1 || from > lastCompletedMonday()) {
    return Response.json({ error: "Choose a Monday from a completed week." }, { status: 400, headers });
  }
  if (isDemo()) {
    const checkedAt = new Date().toISOString();
    const report: WeeklySalesReview = {
      week: { from, through: weekEnd(from), timeZone: reviewTimeZone },
      payroll: { status: "ready", data: {
        closings: 3, usdMinor: 22500, high: { count: 2, usdMinor: 20000 }, low: { count: 1, usdMinor: 2500 },
        assumedTickets: 0, undatedEntries: 1, checkedAt, dateBasis: "Sample Payroll reporting dates (UTC)",
        reviewed: { showed: 16, elapsed: 24, noShow: 5, unclassified: 3, showRate: 16 / 24 }, reviewWarning: null,
      } },
      ghl: { status: "ready", data: {
        total: 28, showed: 17, noshow: 6, cancelled: 3, invalid: 0, calendars: 3,
        verifiedAt: checkedAt, scanStartedAt: checkedAt, lastFailureAt: null,
      } },
      scoring: { status: "ready", data: {
        calls: 19, scoredCalls: 18, averageScore: 76.5, pendingTranscripts: 1, sampledCalls: 5,
        failedSamples: 0, coachingStatus: "ready", checkedAt, examples: [{
          documentId: "demo-call", recordId: "sample-call-01", consultant: "Sample consultant",
          date: from, timestamp: "12:18", quote: "Before we finish, would Tuesday or Thursday work for the next conversation?",
          observation: "The consultant offered two concrete times for a follow-up.",
          action: "Confirm the agreed time and who will send the invitation before ending the call.",
        }],
      } },
    };
    return Response.json(parsed.data.refreshGhl ? { week: report.week, ghl: report.ghl } : report, { headers });
  }

  const limited = rateLimit(`weekly-sales-review:${profile.userId}`, 6, 60_000);
  if (limited) return limited;
  const access = accessFromProfile(profile);
  const capabilities = effectiveCapabilities(access);
  const types = allowedSourceTypes(access);
  const canReviewCalls = capabilities.includes("chat.call_review") && (!types || types.includes("transcript"));

  try {
    const sb = await createSupabaseServerClient();
    const { data, error } = await sb.auth.getSession();
    if (error || !data.session?.access_token) {
      return Response.json({ error: "Sign in again to run the report." }, { status: 401, headers });
    }
    const upstream = await brainWeeklySalesReview({ ...parsed.data, canReviewCalls }, data.session.access_token, req.signal);
    if (!upstream.ok) {
      const status = upstream.status;
      const message = status === 401 || status === 403
        ? "Weekly Sales Review requires chatbot admin and Payroll reporting access."
        : status === 429 ? "Too many report requests. Try again shortly." : "The report could not be loaded. Try again.";
      return Response.json({ error: message }, { status: status >= 500 ? 502 : status, headers });
    }
    return new Response(upstream.body, { headers: { ...headers, "Content-Type": "application/json" } });
  } catch {
    if (req.signal.aborted) return new Response(null, { status: 499, headers });
    return Response.json({ error: "The report could not be loaded. Try again." }, { status: 503, headers });
  }
}
