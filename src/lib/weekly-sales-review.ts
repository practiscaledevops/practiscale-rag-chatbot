export type ReviewSection<T> = { status: "ready"; data: T } | { status: "unavailable"; message: string };

export interface WeeklySalesReview {
  week: { from: string; through: string; timeZone: string };
  payroll: ReviewSection<{
    closings: number; usdMinor: number;
    high: { count: number; usdMinor: number }; low: { count: number; usdMinor: number };
    assumedTickets: number; undatedEntries: number; checkedAt: string; dateBasis: string;
    reviewed: { showed: number; elapsed: number; noShow: number; unclassified: number; showRate: number | null } | null;
    reviewWarning: string | null;
  }>;
  ghl: ReviewSection<{
    total: number; showed: number; noshow: number; cancelled: number; invalid: number;
    calendars: number; verifiedAt: string; scanStartedAt: string; lastFailureAt: string | null;
  }>;
  scoring: ReviewSection<{
    calls: number; scoredCalls: number; averageScore: number | null;
    pendingTranscripts: number; sampledCalls: number; failedSamples: number;
    coachingStatus: "ready" | "empty" | "unavailable"; checkedAt: string;
    examples: { documentId: string; recordId: string | null; consultant: string; date: string; timestamp: string; quote: string; observation: string; action: string }[];
  }>;
}

export const reviewTimeZone = "Asia/Karachi";
const dayMs = 86_400_000;

export function weekEnd(from: string): string {
  return new Date(Date.parse(from + "T00:00:00Z") + 6 * dayMs).toISOString().slice(0, 10);
}

export function lastCompletedMonday(now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: reviewTimeZone,
  }).format(now);
  const date = new Date(today + "T00:00:00Z");
  return new Date(+date - (((date.getUTCDay() + 6) % 7) + 7) * dayMs).toISOString().slice(0, 10);
}

export const reviewMoney = (minor: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", currencyDisplay: "code",
}).format(minor / 100);

export const reviewTimestamp = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(+date)
    ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: reviewTimeZone }).format(date) + " PKT"
    : "Unknown time";
};
