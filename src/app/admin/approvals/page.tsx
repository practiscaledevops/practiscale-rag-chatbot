import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireChatbotAdmin, AdminError } from "@/lib/admin";
import { ApprovalsClient } from "./ApprovalsClient";

export const metadata: Metadata = {
  title: "Approvals",
};

export const dynamic = "force-dynamic";

/**
 * /admin/approvals — the content review queue. Reviewers approve, reject, or
 * request changes; the submitter is notified. Server-side admin gate; data lives
 * behind /api/admin/approvals, which re-checks the same gate.
 */
export default async function AdminApprovalsPage() {
  try {
    await requireChatbotAdmin();
  } catch (err) {
    if (err instanceof AdminError && err.status === 401) redirect("/login");
    redirect("/");
  }

  return <ApprovalsClient />;
}
