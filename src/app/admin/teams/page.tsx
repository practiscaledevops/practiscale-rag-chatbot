// /admin/teams — team management + budgets (admin only).
//
// This page renders inside the admin section's layout (AdminShell chrome). It
// gates server-side with requireChatbotAdmin() as defense-in-depth: the section
// layout also gates, but a page must never render its admin UI for a non-admin,
// even briefly. The actual data + mutations flow through /api/admin/teams, which
// re-checks the admin role on every request (the client is never the authority).

import { redirect } from "next/navigation";
import { requireChatbotAdmin } from "@/lib/admin";
import { TeamsClient } from "./TeamsClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Teams · Admin · Practiscale",
};

export default async function TeamsPage() {
  try {
    await requireChatbotAdmin();
  } catch {
    // Unauthenticated or not an admin — bounce to the app root (middleware
    // handles sending signed-out users to /login).
    redirect("/");
  }

  return <TeamsClient />;
}
