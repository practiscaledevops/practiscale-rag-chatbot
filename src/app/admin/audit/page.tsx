import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireChatbotAdmin, AdminError } from "@/lib/admin";
import { AuditClient } from "./AuditClient";

export const metadata: Metadata = {
  title: "Audit log",
};

export const dynamic = "force-dynamic";

/**
 * /admin/audit — governance audit trail. Server-side admin gate; the data lives
 * behind /api/admin/audit, which re-checks the same gate.
 */
export default async function AdminAuditPage() {
  try {
    await requireChatbotAdmin();
  } catch (err) {
    if (err instanceof AdminError && err.status === 401) redirect("/login");
    redirect("/");
  }

  return <AuditClient />;
}
