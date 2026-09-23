// Server-only: resolve the project context for a conversation so /api/chat can
// inject it — the project's instructions (as trusted directives) and its files'
// text (as data-only attachments), just like Claude Projects' shared knowledge.

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadProjectFilesText } from "@/lib/project-files";

export interface ProjectContext {
  projectId: string;
  name: string;
  /** The project's instructions (system_prompt), if any. */
  instructions: string | null;
  /** Extracted text of the project's files, bounded, in upload order. */
  files: { name: string; text: string }[];
}

/**
 * Load the project a conversation belongs to (its name, instructions, and file
 * text). Returns null when the conversation has no project, the project is gone,
 * or anything fails — chat must never break because a project lookup did.
 * `supabase` must be the RLS-scoped client for the signed-in user.
 */
export async function loadProjectContextForConversation(
  supabase: SupabaseClient,
  conversationId: string,
  opts?: { filesMaxChars?: number }
): Promise<ProjectContext | null> {
  try {
    const { data: convo } = await supabase
      .from("conversations")
      .select("project_id")
      .eq("id", conversationId)
      .maybeSingle();
    const projectId = (convo as { project_id?: string | null } | null)?.project_id;
    if (!projectId) return null;

    const [{ data: project }, files] = await Promise.all([
      supabase.from("projects").select("id, name, system_prompt").eq("id", projectId).maybeSingle(),
      loadProjectFilesText(supabase, projectId, opts?.filesMaxChars ?? 60_000),
    ]);
    if (!project) return null;

    const p = project as { id: string; name: string; system_prompt: string | null };
    const instructions = p.system_prompt && p.system_prompt.trim() ? p.system_prompt.trim() : null;
    if (!instructions && files.length === 0) return null;

    return { projectId: p.id, name: p.name, instructions, files };
  } catch {
    return null;
  }
}
