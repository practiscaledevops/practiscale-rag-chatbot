// Server-only helpers for project files (project "knowledge"). Tolerates the
// `project_files` table not existing yet (before migration 0012): reads return
// `available:false` instead of throwing, so the project page renders and the
// panel explains how to enable it.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface ProjectFile {
  id: string;
  name: string;
  mime: string | null;
  size: number | null;
  /** Character count of the extracted text (the UI shows this, not the text). */
  chars: number;
  created_at: string;
}

const LIST_COLUMNS = "id, name, mime, size, content, created_at";

/** True when the error is "relation project_files does not exist" (pre-0012). */
export function isMissingProjectFilesTable(
  err: { code?: string; message?: string } | null | undefined
): boolean {
  if (!err) return false;
  return (
    err.code === "42P01" ||
    /relation .*project_files.* does not exist|could not find the table .*project_files/i.test(
      err.message ?? ""
    )
  );
}

/**
 * A project's files as metadata + a char count (never the full text) for the
 * UI. Never throws: returns `available:false` when migration 0012 hasn't run.
 */
export async function loadProjectFiles(
  supabase: SupabaseClient,
  projectId: string
): Promise<{ files: ProjectFile[]; available: boolean }> {
  const { data, error } = await supabase
    .from("project_files")
    .select(LIST_COLUMNS)
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (error) {
    if (isMissingProjectFilesTable(error)) return { files: [], available: false };
    return { files: [], available: true };
  }

  const files: ProjectFile[] = (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    name: String(r.name ?? "file"),
    mime: (r.mime as string) ?? null,
    size: typeof r.size === "number" ? r.size : null,
    chars: typeof r.content === "string" ? r.content.length : 0,
    created_at: String(r.created_at ?? ""),
  }));
  return { files, available: true };
}

/**
 * The concatenated text of a project's files, for injecting as chat context.
 * Bounded to `maxChars` total across all files (fair, in upload order). Returns
 * [] when there are none or the table is missing.
 */
export async function loadProjectFilesText(
  supabase: SupabaseClient,
  projectId: string,
  maxChars = 60_000
): Promise<{ name: string; text: string }[]> {
  const { data, error } = await supabase
    .from("project_files")
    .select("name, content")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error || !data) return [];

  const out: { name: string; text: string }[] = [];
  let used = 0;
  for (const r of data as Record<string, unknown>[]) {
    const text = typeof r.content === "string" ? r.content : "";
    if (!text.trim()) continue;
    const remaining = maxChars - used;
    if (remaining <= 0) break;
    const slice = text.length > remaining ? text.slice(0, remaining) : text;
    out.push({ name: String(r.name ?? "file"), text: slice });
    used += slice.length;
  }
  return out;
}
