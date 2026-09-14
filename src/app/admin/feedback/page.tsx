import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireChatbotAdmin, AdminError } from "@/lib/admin";
import { FeedbackClient } from "./FeedbackClient";

export const metadata: Metadata = {
  title: "Feedback & QA",
};

export const dynamic = "force-dynamic";

/**
 * /admin/feedback — QA review of thumbs up/down on answers. Server-side admin
 * gate (identity from the session, role via the service-role client); the data
 * lives behind /api/admin/feedback, which re-checks the same gate.
 */
export default async function AdminFeedbackPage() {
  try {
    await requireChatbotAdmin();
  } catch (err) {
    if (err instanceof AdminError && err.status === 401) redirect("/login");
    redirect("/");
  }

  return <FeedbackClient />;
}
