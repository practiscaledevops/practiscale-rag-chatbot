// GET /api/search?q=… — search the signed-in user's message history by content.
//
// The sidebar's search box filters loaded titles instantly; this route adds
// full-text-ish matching over message BODIES so you can find a thread by what
// was said in it. RLS scopes messages to the user (user_id = auth.uid()); we add
// an explicit user_id filter as belt-and-braces. Returns up to 20 conversations
// with a short snippet around the match.

import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";

/** A short snippet of `content` centered on the first match of `needle`. */
function snippet(content: string, needle: string): string {
  const text = content.replace(/\s+/g, " ").trim();
  const i = text.toLowerCase().indexOf(needle);
  if (i === -1) return text.slice(0, 100);
  const start = Math.max(0, i - 30);
  const end = Math.min(text.length, i + needle.length + 60);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const raw = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (raw.length < 2) return NextResponse.json({ results: [] });
  // Sanitize for an ILIKE pattern: cap length, neutralize wildcards/escape.
  const q = raw.slice(0, 100).replace(/[%_\\]/g, " ").trim();
  if (q.length < 2) return NextResponse.json({ results: [] });

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("messages")
    .select("conversation_id, content, created_at")
    .eq("user_id", user.id)
    .ilike("content", `%${q}%`)
    .order("created_at", { ascending: false })
    .limit(80);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Dedupe by conversation, keeping the most recent matching snippet.
  const byConvo = new Map<string, string>();
  const needle = q.toLowerCase();
  for (const row of (data ?? []) as { conversation_id: string; content: string }[]) {
    if (!row.conversation_id || byConvo.has(row.conversation_id)) continue;
    byConvo.set(row.conversation_id, snippet(row.content, needle));
    if (byConvo.size >= 20) break;
  }

  const results = [...byConvo.entries()].map(([conversationId, snippet]) => ({
    conversationId,
    snippet,
  }));
  return NextResponse.json({ results });
}
