// POST /api/chat — the chatbot's own endpoint.
// Forwards the conversation to the Brain's grounded, scoped /api/v1/chat and
// streams the answer back. The scoped Brain key stays server-side (see lib/brain).
//
// TODO (chatbot phase): auth the user, load the active project's prompt/context,
// persist the turn to chat history, and meter tokens.

import { brainChat, type ModelTier } from "@/lib/brain";
import { isDemo } from "@/lib/demo/mode";
import { demoChatStreamResponse } from "@/lib/demo/stream";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { messages, tier } = await req.json();

  // DEMO MODE: don't call the Brain — stream a canned grounded answer.
  if (isDemo()) {
    const last = [...(messages ?? [])].reverse().find((m: any) => m.role === "user");
    return demoChatStreamResponse(last?.content ?? "");
  }

  const upstream = await brainChat(messages ?? [], tier as ModelTier | undefined);

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return Response.json(
      { error: "Brain request failed", status: upstream.status, detail },
      { status: upstream.status || 502 }
    );
  }

  // Pass the Brain's streamed data-stream response straight through to the client.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "text/plain; charset=utf-8",
      "x-vercel-ai-data-stream": upstream.headers.get("x-vercel-ai-data-stream") ?? "v1",
    },
  });
}
