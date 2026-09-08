// /api/prompts — the signed-in user's personal prompt library.
//
// Every request is scoped to the authenticated user: the session is resolved
// server-side (never from client input) and row-level security (user_id =
// auth.uid()) enforces ownership. Prompt text is user data — only ever stored,
// never interpreted as instructions by this route.
//
//   GET    — list the user's prompts (pinned first, most recent next)
//   POST   — create a prompt { title, body, isPinned? }
//   PATCH  — update a prompt { id, title?, body?, isPinned? }
//   DELETE — remove a prompt (?id= or { id })
//
// Lives in the chatbot's OWN Supabase project, never the Brain.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";

const COLUMNS = "id, title, body, is_pinned, created_at, updated_at";

const createSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(20_000),
  isPinned: z.boolean().optional(),
});

const patchSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(120).optional(),
    body: z.string().trim().min(1).max(20_000).optional(),
    isPinned: z.boolean().optional(),
  })
  .refine((v) => v.title !== undefined || v.body !== undefined || v.isPinned !== undefined, {
    message: "Nothing to update",
  });

async function requireUser() {
  const user = await getUser();
  return user?.id ?? null;
}

export async function GET() {
  const userId = await requireUser();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("user_prompts")
    .select(COLUMNS)
    .order("is_pinned", { ascending: false })
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ prompts: data ?? [] });
}

export async function POST(req: Request) {
  const userId = await requireUser();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", detail: parsed.error.flatten() }, { status: 400 });
  }

  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("user_prompts")
    .insert({
      user_id: userId,
      title: parsed.data.title,
      body: parsed.data.body,
      is_pinned: parsed.data.isPinned ?? false,
    })
    .select(COLUMNS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ prompt: data }, { status: 201 });
}

export async function PATCH(req: Request) {
  const userId = await requireUser();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", detail: parsed.error.flatten() }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.body !== undefined) patch.body = parsed.data.body;
  if (parsed.data.isPinned !== undefined) patch.is_pinned = parsed.data.isPinned;

  const sb = await createSupabaseServerClient();
  // RLS scopes the update to the owner; the explicit id targets the row.
  const { data, error } = await sb
    .from("user_prompts")
    .update(patch)
    .eq("id", parsed.data.id)
    .select(COLUMNS)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ prompt: data });
}

export async function DELETE(req: Request) {
  const userId = await requireUser();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  let id = url.searchParams.get("id");
  if (!id) {
    const body = await req.json().catch(() => ({}));
    id = typeof body?.id === "string" ? body.id : null;
  }
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const sb = await createSupabaseServerClient();
  const { error } = await sb.from("user_prompts").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
