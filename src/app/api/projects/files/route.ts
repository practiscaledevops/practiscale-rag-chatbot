// /api/projects/files — a project's files ("project knowledge"). Owned by the
// signed-in user; RLS (user_id = auth.uid()) enforces ownership underneath.
//
//   GET    ?projectId=…  — list a project's files (metadata + char count)
//   POST   multipart {projectId, file} — extract text via the Brain and store it
//   DELETE {id}          — remove one file
//
// The uploaded file is forwarded to the Brain's /api/v1/extract (server-side,
// scoped key) to get plain text; the text is DATA, never instructions. Before
// migration 0012 the table doesn't exist — reads degrade to available:false and
// writes return a clear 503 telling the admin to run the migration.

import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { brainExtract, BrainRequestError } from "@/lib/brain";
import { loadProjectFiles, isMissingProjectFilesTable } from "@/lib/project-files";
import { rateLimit } from "@/lib/ratelimit";
import { isDemo } from "@/lib/demo/mode";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MB = 1024 * 1024;
/** Platform rejects bodies over ~4.5 MB first; this is the logical ceiling. */
const MAX_FILE_BYTES = 25 * MB;
const MAX_TEXT_CHARS = 200_000;
const MAX_FILES = 25;
const UPLOAD_LIMIT = { limit: 30, windowMs: 60_000 };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireUser() {
  const user = await getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const supabase = await createSupabaseServerClient();
  return { user, supabase };
}

async function ownsProject(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
  projectId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean((data as { id?: string } | null)?.id);
}

// GET /api/projects/files?projectId=…
export async function GET(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { supabase } = auth;

  const projectId = new URL(req.url).searchParams.get("projectId") ?? "";
  if (!UUID_RE.test(projectId)) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }
  const { files, available } = await loadProjectFiles(supabase, projectId);
  return NextResponse.json({ files, available });
}

// POST /api/projects/files — multipart { projectId, file }
export async function POST(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { user, supabase } = auth;

  const limited = rateLimit(`project-files:${user.id}`, UPLOAD_LIMIT.limit, UPLOAD_LIMIT.windowMs);
  if (limited) return limited;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart upload." }, { status: 400 });
  }

  const projectId = String(form.get("projectId") ?? "");
  if (!UUID_RE.test(projectId)) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }
  if (!(await ownsProject(supabase, user.id, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "The file is empty." }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: "File too large — keep it under a few MB, or paste large documents as text." },
      { status: 413 }
    );
  }

  // Enforce the per-project cap and surface the pre-migration state clearly.
  const { files: existing, available } = await loadProjectFiles(supabase, projectId);
  if (!available) {
    return NextResponse.json(
      {
        error:
          "Project files aren't enabled yet — run the one-time migration 0012_project_files in Supabase, then try again.",
      },
      { status: 503 }
    );
  }
  if (existing.length >= MAX_FILES) {
    return NextResponse.json(
      { error: `A project can hold up to ${MAX_FILES} files.` },
      { status: 409 }
    );
  }

  const name = (file.name || "file").slice(0, 200);

  let text = "";
  if (isDemo()) {
    text = `[demo] extracted contents of ${name}. This project file would be added as shared context to every chat in the project.`;
  } else {
    try {
      const extracted = await brainExtract(file, name);
      text = (extracted.text ?? "").slice(0, MAX_TEXT_CHARS);
    } catch (e) {
      if (e instanceof BrainRequestError) {
        return NextResponse.json({ error: e.message }, { status: e.status >= 500 ? 502 : e.status });
      }
      return NextResponse.json({ error: "Could not read that file." }, { status: 502 });
    }
  }
  if (!text.trim()) {
    return NextResponse.json({ error: "No readable text found in that file." }, { status: 422 });
  }

  const { data, error } = await supabase
    .from("project_files")
    .insert({
      project_id: projectId,
      user_id: user.id, // RLS insert policy requires user_id = auth.uid()
      name,
      mime: file.type || null,
      size: file.size,
      content: text,
    })
    .select("id, name, mime, size, created_at")
    .single();

  if (error || !data) {
    if (isMissingProjectFilesTable(error)) {
      return NextResponse.json(
        { error: "Project files aren't enabled yet — run migration 0012_project_files in Supabase." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: error?.message ?? "Could not save the file." }, { status: 500 });
  }

  return NextResponse.json(
    { file: { ...(data as Record<string, unknown>), chars: text.length } },
    { status: 201 }
  );
}

// DELETE /api/projects/files — { id }
export async function DELETE(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { user, supabase } = auth;

  const body = await req.json().catch(() => ({}));
  const id = String(body?.id ?? new URL(req.url).searchParams.get("id") ?? "");
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("project_files")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
