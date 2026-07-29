import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireChatbotAdmin, AdminError } from "@/lib/admin";
import { buildSettingsPayload, type SettingsPayload } from "@/app/api/admin/settings/route";
import { SettingsClient } from "./SettingsClient";

export const metadata: Metadata = {
  title: "Workspace settings",
};

// Reads the session cookie for admin gating, so never statically rendered.
export const dynamic = "force-dynamic";

/**
 * /admin/settings — workspace-wide configuration.
 *
 * Server-side admin gate (HARD RULE: identity from the session, role read via
 * the service-role client — never a client claim). Defense-in-depth alongside
 * the admin route-group layout: an unauthenticated caller goes to /login, a
 * signed-in non-admin goes home. /api/admin/settings re-checks the same gate.
 *
 * We build the initial payload server-side (current settings merged with
 * defaults + the Brain model catalog) so the panel paints without a loading
 * flash; the client still re-saves through the PUT route. The AdminShell chrome
 * comes from the admin route-group layout — this page renders only its content.
 */
export default async function AdminSettingsPage() {
  let payload: SettingsPayload;
  try {
    const admin = await requireChatbotAdmin();
    payload = await buildSettingsPayload(admin);
  } catch (err) {
    if (err instanceof AdminError && err.status === 401) redirect("/login");
    if (err instanceof AdminError) redirect("/");
    throw err;
  }

  return <SettingsClient initial={payload} />;
}
