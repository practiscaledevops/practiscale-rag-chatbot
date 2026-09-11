import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getUser } from "@/lib/auth";
import { getSessionProfile } from "@/lib/admin";
import { getMonthlyUsageTokens } from "@/lib/usage-read";
import { loadConversations } from "@/lib/conversations-read";
import { fetchBrainModels, filterModelsByPermissions } from "@/lib/models";
import { AppChrome, type Project } from "@/components/AppChrome";
// Pin this route group to Singapore (co-located with Supabase + the Brain).
export const preferredRegion = ["sin1"];

/**
 * Authenticated shell for every route in the (app) group. Enforces auth
 * server-side (defense in depth alongside middleware), then fetches everything
 * the chrome needs — the user's chat history + projects (row-level-security
 * scoped to them), the permitted model catalog (Brain catalog filtered by the
 * user's permissions, all with the scoped BRAIN_API_KEY kept server-side), and
 * the identity bits (first name for the greeting, admin flag for the Admin link)
 * — and hands them to the client {@link AppChrome}.
 *
 * NOTE: the (app) route group does not affect URLs. Page agents place their
 * routes under src/app/(app)/ (e.g. the chat page at (app)/page.tsx) to inherit
 * this shell.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();

  // Resolve the user id first (cached for the rest of the request) so the
  // monthly-usage read can race with everything else.
  const user = await getUser();
  if (!user) redirect("/login");

  // Resolve identity in parallel with the history/projects/catalog/usage fetches.
  // RLS scopes history + projects to the signed-in user (empty for a signed-out
  // caller), and the catalog needs no session — so all can race, and we gate on
  // the profile right after. Ordering mirrors /api/conversations.
  const [profile, conversations, projectsRes, catalog, monthTokens] = await Promise.all([
    getSessionProfile(),
    loadConversations(supabase, user.id),
    supabase
      .from("projects")
      .select("id, name, system_prompt, created_at")
      .order("created_at", { ascending: false }),
    fetchBrainModels(),
    getMonthlyUsageTokens(user.id),
  ]);

  // Auth gate (defense in depth alongside middleware): no profile → /login.
  if (!profile) redirect("/login");

  // Hide models the user isn't permitted to select; unavailable ones stay in the
  // list (the switcher renders them disabled).
  const models = filterModelsByPermissions(
    catalog,
    profile.permissions,
    profile.canUseAllModels
  );

  const firstName =
    profile.displayName?.trim().split(/\s+/)[0] ||
    profile.email?.split("@")[0] ||
    "there";
  const isAdmin = profile.role === "admin" || profile.role === "super_admin";

  return (
    <AppChrome
      initialConversations={conversations}
      initialProjects={(projectsRes.data ?? []) as Project[]}
      models={models}
      firstName={firstName}
      isAdmin={isAdmin}
      initialTokens={monthTokens}
    >
      {children}
    </AppChrome>
  );
}
