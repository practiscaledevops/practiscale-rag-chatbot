// Server-only: load the context for a verified project so /api/chat can
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
 * Load a project's name, instructions and file text. The caller supplies the
 * project id from the conversation it already verified. Missing context is
 * best-effort so a project lookup cannot break the chat.
 * `supabase` must be the RLS-scoped client for the signed-in user.
 */
export async function loadProjectContext(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ProjectContext | null> {
  try {
    const [{ data: project }, files] = await Promise.all([
      supabase.from("projects").select("id, name, system_prompt").eq("id", projectId).maybeSingle(),
      loadProjectFilesText(supabase, projectId, 60_000),
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
