import { notFound, redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/admin";
import { isDemo } from "@/lib/demo/mode";
import { lastCompletedMonday } from "@/lib/weekly-sales-review";
import { canOpenWeeklySalesReview } from "@/lib/weekly-sales-review-access";
import { WeeklySalesReviewClient } from "./WeeklySalesReviewClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Weekly Sales Review · PractiScale" };

export default async function WeeklySalesReviewPage() {
  const profile = await getSessionProfile();
  if (!profile) redirect("/login");
  if (!canOpenWeeklySalesReview(profile.role)) notFound();
  return <WeeklySalesReviewClient initialMonday={lastCompletedMonday()} demo={isDemo()} />;
}
