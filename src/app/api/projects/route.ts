// /api/projects — the chatbot's own projects (grouped context), owned by the
// history/projects agent. A project is a name plus an optional system_prompt
// that scopes new chats: when a conversation belongs to a project, the chat
// route forwards that prompt to the Brain as extra context / prompt selection.
//
//   GET    — list the user's projects
//   POST   — create a project (name + optional system_prompt)
//   PATCH  — rename a project / edit its system_prompt
//   DELETE — remove a project (its conversations are detached, not deleted:
//            conversations.project_id has ON DELETE SET NULL in 0001)
//
// Every request is scoped to the signed-in user via the server session, with
// row-level security (user_id = auth.uid()) enforcing ownership underneath.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROJECT_COLUMNS = "id, name, system_prompt, created_at";

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  // Treated as data, never as instructions to this app; the Brain decides how
  // to use it. Allow clearing with null/empty.
  systemPrompt: z.string().max(8000).nullish(),
});

const patchSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(120).optional(),
    systemPrompt: z.string().max(8000).nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.systemPrompt !== undefined, {
    message: "No fields to update",
  });

const deleteSchema = z.object({ id: z.string().uuid() });

/** Resolve the authed user + an RLS-scoped Supabase client, or a 401 response. */
async function requireUser() {
  const user = await getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const supabase = await createSupabaseServerClient();
  return { user, supabase };
}

// GET /api/projects — list the user's projects (newest first).
export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { user, supabase } = auth;

  const { data, error } = await supabase
    .from("projects")
    .select(PROJECT_COLUMNS)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ projects: data ?? [] });
}

// POST /api/projects — create a project.
export async function POST(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { user, supabase } = auth;

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { name, systemPrompt } = parsed.data;

  const { data, error } = await supabase
    .from("projects")
    .insert({
      user_id: user.id, // RLS insert policy requires user_id = auth.uid()
      name,
      system_prompt: systemPrompt ?? null,
    })
    .select(PROJECT_COLUMNS)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Could not create project" },
      { status: 500 }
    );
  }
  return NextResponse.json({ project: data }, { status: 201 });
}

// PATCH /api/projects — rename / edit the system prompt.
export async function PATCH(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { user, supabase } = auth;

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { id, name, systemPrompt } = parsed.data;

  const patch: Record<string, unknown> = {};
  if (name !== undefined) patch.name = name;
  if (systemPrompt !== undefined) patch.system_prompt = systemPrompt;

  const { data, error } = await supabase
    .from("projects")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select(PROJECT_COLUMNS)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ project: data });
}

// DELETE /api/projects — remove a project (conversations are detached).
export async function DELETE(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { user, supabase } = auth;

  const body = await req.json().catch(() => ({}));
  const id = body?.id ?? new URL(req.url).searchParams.get("id");

  const parsed = deleteSchema.safeParse({ id });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", parsed.data.id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
