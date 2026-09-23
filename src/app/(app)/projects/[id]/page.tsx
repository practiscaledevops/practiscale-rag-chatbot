import { notFound } from "next/navigation";
import { getUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { loadConversations } from "@/lib/conversations-read";
import { loadProjectFiles } from "@/lib/project-files";
import { ProjectClient } from "./ProjectClient";

export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";

/**
 * A project's workspace: its instructions, its files ("project knowledge"), and
 * the chats that belong to it — with a "New chat" that starts a thread scoped to
 * the project. Rendered inside the shared (app) shell (sidebar + top bar).
 */
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const user = await getUser();
  if (!user) notFound();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, system_prompt, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!project) notFound();

  const [chats, filesRes] = await Promise.all([
    loadConversations(supabase, user.id, { projectId: id }),
    loadProjectFiles(supabase, id),
  ]);

  return (
    <ProjectClient
      project={project as { id: string; name: string; system_prompt: string | null }}
      initialChats={chats.map((c) => ({
        id: c.id,
        title: c.title ?? "New chat",
        updatedAt: c.updated_at,
      }))}
      initialFiles={filesRes.files}
      filesAvailable={filesRes.available}
    />
  );
}
