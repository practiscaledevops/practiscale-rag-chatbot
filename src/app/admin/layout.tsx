import { redirect } from "next/navigation";
import { AdminError, requireChatbotAdmin, type ChatbotAdmin } from "@/lib/admin";
import { AdminShell } from "@/components/AdminShell";

/**
 * Server layout for the /admin control panel. The single authorization boundary
 * for every admin section: it resolves the caller server-side and reads their
 * app-wide role from profiles via the service-role client (requireChatbotAdmin),
 * never trusting a client claim.
 *
 *   • 401 (unauthenticated) → /login
 *   • 403 (not an active admin) → /  (bounce back to the chat product)
 *
 * Only a verified admin reaches AdminShell, which then renders the section page
 * as {children}. Every /api/admin/* route re-checks independently (defense in
 * depth) — this layout guards the UI, the routes guard the data.
 */
export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let admin: ChatbotAdmin;
  try {
    admin = await requireChatbotAdmin();
  } catch (e) {
    if (e instanceof AdminError) {
      // redirect() throws NEXT_REDIRECT to abort rendering — propagates cleanly.
      redirect(e.status === 401 ? "/login" : "/");
    }
    throw e;
  }

  return (
    <AdminShell email={admin.email} role={admin.role}>
      {children}
    </AdminShell>
  );
}
