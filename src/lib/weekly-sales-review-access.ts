import { isDemo } from "@/lib/demo/mode";

export function weeklySalesReviewEnabled() {
  return isDemo() || (process.env.SOURCE_REPORTS_ENABLED === "true" && process.env.WEEKLY_SALES_REVIEW_ENABLED === "true");
}

export function canOpenWeeklySalesReview(role: string | undefined) {
  return isDemo() || (weeklySalesReviewEnabled() && (role === "admin" || role === "super_admin"));
}
