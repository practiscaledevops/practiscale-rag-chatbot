import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireChatbotAdmin, AdminError } from "@/lib/admin";
import { UsageClient } from "./UsageClient";

export const metadata: Metadata = {
  title: "Usage & cost",
};

// Reads the session cookie for admin gating, so never statically rendered.
export const dynamic = "force-dynamic";

/**
 * /admin/usage — the money + tokens dashboard.
 *
 * Server-side admin gate (HARD RULE: identity from the session, role read via
 * the service-role client — never a client claim). This is defense-in-depth
 * alongside the admin route group's own gating: an unauthenticated caller is
 * sent to /login, a signed-in non-admin is sent home. The interactive dashboard
 * and its data both live behind /api/admin/usage, which re-checks the same gate.
 *
 * The AdminShell chrome is provided by the admin route-group layout — this page
 * only renders its own content.
 */
export default async function AdminUsagePage() {
  try {
    await requireChatbotAdmin();
  } catch (err) {
    if (err instanceof AdminError && err.status === 401) redirect("/login");
    redirect("/");
  }

  return <UsageClient />;
}
