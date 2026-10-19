import type { SupabaseClient } from "@supabase/supabase-js";
import { selectDraftMemory, type DraftMemory } from "@/lib/creative";

/** Session RLS plus an explicit owner predicate. Never a service-role read. */
export async function loadDraftMemory(sb: SupabaseClient, userId: string, query: string, conversationId: string | null, scope: "account" | "thread" | "off") {
  if (scope === "off" || (scope === "thread" && !conversationId)) return { drafts: [], warning: null };
  const stop = new Set(["write", "draft", "create", "generate", "please", "content", "about", "with", "from", "that", "this", "your", "linkedin", "fresh", "owners", "based", "supported", "practiscale", "knowledge", "post", "words", "real", "only", "otherwise", "practical", "guidance", "result", "quote", "invent", "case", "study"]);
  // Safe letters only: these terms cannot inject PostgREST filter syntax.
  const terms = [...new Set((query.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter(w => !stop.has(w)))].slice(0, 3);
  const ownedAnswers = () => {
    let request = sb.from("messages").select("id, content, conversation_id, created_at, citations")
      .eq("user_id", userId).eq("role", "assistant").order("created_at", { ascending: false });
    if (scope === "thread") request = request.eq("conversation_id", conversationId!);
    return request;
  };
  // Search the entire owned history as well as its recent window. Context is
  // still bounded; an old relevant case is eligible even after hundreds of turns.
  const reads = await Promise.allSettled([
    ownedAnswers().limit(120),
    terms.length ? ownedAnswers().or(terms.map(t => `content.ilike.%${t}%`).join(",")).limit(60) : Promise.resolve({ data: [], error: null }),
  ]);
  const results = reads.map(r => r.status === "fulfilled" ? r.value : { data: [], error: true });
  const failed = results.some(r => r.error);
  const data = [...new Map(results.flatMap(r => r.error ? [] : (r.data ?? []) as DraftMemory[]).map(r => [r.id, r])).values()]
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  // Creative drafts, not prior factual reports; those must come from live Brain evidence.
  const rows = ((data ?? []) as DraftMemory[]).filter(r => r.content.length >= 200 && !/^\s*\||^\s*#{0,3}\s*call report\b|consultant.wise summary|per.call details/i.test(r.content));
  const drafts = selectDraftMemory(rows, query);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const priorSourceIds = [...new Set(drafts.flatMap(d => [
    ...[...d.content.matchAll(/\[([0-9a-f-]{36})\]/gi)].map(m => m[1]),
    ...(Array.isArray(d.citations) ? d.citations.flatMap(c => c && typeof c.id === "string" ? [c.id] : []) : []),
  ]).filter(id => uuid.test(id)))].slice(0, 80);
  return { drafts: drafts.map(({ id, content }) => ({ id, content })), priorSourceIds, warning: failed ? "Some saved history could not be checked for this turn." : null };
}
