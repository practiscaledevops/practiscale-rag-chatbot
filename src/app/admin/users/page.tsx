// Admin › Users — server component. Gates the page to admins server-side
// (defense in depth: middleware + the AdminShell layout also gate), then builds
// the full users payload with the service-role client for a fast first paint
// and hands it to the client editor. The AdminShell (owned elsewhere) provides
// the surrounding nav/chrome.

import { redirect } from "next/navigation";
import { requireChatbotAdmin, AdminError } from "@/lib/admin";
import { buildAdminUsersPayload } from "@/app/api/admin/users/route";
import { UsersClient } from "./UsersClient";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  try {
    // Authoritative, service-role role check — never a client claim.
    const admin = await requireChatbotAdmin();
    const payload = await buildAdminUsersPayload(admin);
    return <UsersClient initial={payload} />;
  } catch (e) {
    if (e instanceof AdminError) {
      // Unauthenticated → sign in; authenticated-but-not-admin → back to the app.
      redirect(e.status === 401 ? "/login" : "/");
    }
    throw e;
  }
}
