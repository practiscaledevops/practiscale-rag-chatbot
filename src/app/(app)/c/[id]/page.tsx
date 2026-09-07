import { notFound } from "next/navigation";
import type { Message } from "@ai-sdk/react";
import type { ModelTier } from "@/lib/brain";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { ChatView } from "../../_components/ChatView";

/**
 * An existing conversation, loaded server-side. Both queries run through the
 * session-bound Supabase client, so row-level security scopes them to the
 * signed-in user — a missing or someone-else's conversation resolves to 404.
 */
export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  // Both queries key off the same `id` and don't depend on each other, so fetch
  // them together. RLS scopes both to the caller; a missing/foreign conversation
  // resolves to 404 (the parallel messages read just comes back empty).
  const [{ data: convo }, { data: rows }] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, title, model_tier")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("messages")
      .select("id, role, content")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true }),
  ]);
  if (!convo) notFound();

  const initialMessages: Message[] = (rows ?? []).map((r) => ({
    id: r.id as string,
    role: r.role as Message["role"],
    content: (r.content as string) ?? "",
  }));

  return (
    <ChatView
      conversationId={convo.id as string}
      title={(convo.title as string | null) ?? null}
      initialTier={convo.model_tier as ModelTier}
      initialMessages={initialMessages}
    />
  );
}
