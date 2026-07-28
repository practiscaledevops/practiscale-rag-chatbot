import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { AppChrome, type Conversation, type Project } from "@/components/AppChrome";

/**
 * Authenticated shell for every route in the (app) group. Enforces auth
 * server-side (defense in depth alongside middleware), fetches the signed-in
 * user's chat history + projects (row-level-security scoped to them), and hands
 * them to the client {@link AppChrome}, which wires the Sidebar and renders the
 * AppShell chrome (Sidebar + TopBar) around the page.
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
  const user = await getUser();
  if (!user) redirect("/login");

  const supabase = await createSupabaseServerClient();

  // Fetch both lists in parallel. RLS scopes every row to the signed-in user;
  // ordering mirrors the /api/conversations list (pinned first, most recent).
  const [conversationsRes, projectsRes] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, title, pinned, project_id, model_tier, created_at, updated_at")
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false }),
    supabase
      .from("projects")
      .select("id, name, system_prompt, created_at")
      .order("created_at", { ascending: false }),
  ]);

  return (
    <AppChrome
      initialConversations={(conversationsRes.data ?? []) as Conversation[]}
      initialProjects={(projectsRes.data ?? []) as Project[]}
    >
      {children}
    </AppChrome>
  );
}
