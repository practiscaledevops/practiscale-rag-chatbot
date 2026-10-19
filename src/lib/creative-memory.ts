import type { SupabaseClient } from "@supabase/supabase-js";
import { selectDraftMemory, type DraftMemory } from "@/lib/creative";

/** Session RLS plus an explicit owner predicate. Never a service-role read. */
export async function loadDraftMemory(sb: SupabaseClient, userId: string, query: string, conversationId: string | null, scope: "account" | "thread" | "off") {
  if (scope === "off" || (scope === "thread" && !conversationId)) return { drafts: [], warning: null };
  let request = sb.from("messages").select("id, content, conversation_id, created_at, citations")
    .eq("user_id", userId).eq("role", "assistant").order("created_at", { ascending: false }).limit(120);
  if (scope === "thread") request = request.eq("conversation_id", conversationId!);
  const { data, error } = await request;
  if (error) return { drafts: [], warning: "Saved history could not be checked for this turn." };
  // Creative drafts, not prior factual reports; those must come from live Brain evidence.
  const rows = ((data ?? []) as DraftMemory[]).filter(r => r.content.length >= 200 && !/^\s*\|/.test(r.content));
  const drafts = selectDraftMemory(rows, query);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const priorSourceIds = [...new Set(drafts.flatMap(d => [
    ...[...d.content.matchAll(/\[([0-9a-f-]{36})\]/gi)].map(m => m[1]),
    ...(Array.isArray(d.citations) ? d.citations.flatMap(c => c && typeof c.id === "string" ? [c.id] : []) : []),
  ]).filter(id => uuid.test(id)))].slice(0, 80);
  return { drafts: drafts.map(({ id, content }) => ({ id, content })), priorSourceIds, warning: (data ?? []).length >= 120 ? "History check is bounded to the 120 most recent saved answers." : null };
}
