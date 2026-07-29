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
  // Resolve identity + role server-side (never a client claim). Doubles as the
  // auth gate: a signed-out user has no profile.
  const profile = await getSessionProfile();
  if (!profile) redirect("/login");

  const supabase = await createSupabaseServerClient();

  // Fetch history, projects, and the model catalog in parallel. RLS scopes the
  // first two to the signed-in user; ordering mirrors /api/conversations.
  const [conversationsRes, projectsRes, catalog] = await Promise.all([
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
