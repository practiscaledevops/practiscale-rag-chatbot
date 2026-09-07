import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getSessionProfile } from "@/lib/admin";
import { fetchBrainModels, filterModelsByPermissions } from "@/lib/models";
import { AppChrome, type Conversation, type Project } from "@/components/AppChrome";

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

  // Resolve identity in parallel with the history/projects/catalog fetches.
  // RLS scopes history + projects to the signed-in user (empty for a signed-out
  // caller), and the catalog needs no session — so all four can race, and we
  // gate on the profile right after. Ordering mirrors /api/conversations.
  const [profile, conversationsRes, projectsRes, catalog] = await Promise.all([
    getSessionProfile(),
    supabase
      .from("conversations")
      .select("id, title, pinned, project_id, model_tier, created_at, updated_at")
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false }),
    supabase
      .from("projects")
      .select("id, name, system_prompt, created_at")
      .order("created_at", { ascending: false }),
    fetchBrainModels(),
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
      initialConversations={(conversationsRes.data ?? []) as Conversation[]}
      initialProjects={(projectsRes.data ?? []) as Project[]}
      models={models}
      firstName={firstName}
      isAdmin={isAdmin}
    >
      {children}
    </AppChrome>
  );
}
