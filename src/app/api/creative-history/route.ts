import { getSessionProfile } from "@/lib/admin";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { rateLimit } from "@/lib/ratelimit";
export const dynamic = "force-dynamic";
export async function GET() {
  const profile = await getSessionProfile();
  if (!profile) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!profile.capabilities.includes("chat.knowledge")) return Response.json({ error: "Chat is not enabled." }, { status: 403 });
  const limited = rateLimit(`draft-ledger:${profile.userId}`, 30, 60_000); if (limited) return limited;
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.from("messages").select("id, conversation_id, content, created_at").eq("user_id", profile.userId)
    .eq("role", "assistant").order("created_at", { ascending: false }).limit(30);
  if (error) return Response.json({ error: "Could not load saved answers." }, { status: 503 });
  return Response.json({ drafts: (data ?? []).map(d => ({ ...d, content: String(d.content).slice(0, 320) })), limit: 30 }, { headers: { "Cache-Control": "private, no-store" } });
}
