// Canned grounded answer for DEMO MODE, in the Vercel AI SDK v4 data-stream
// protocol so useChat() renders it token-by-token with a citation chip.

function pickAnswer(query: string): string {
  const q = (query || "").toLowerCase();
  if (q.includes("discovery") || q.includes("improve") || q.includes("weak")) {
    return "Based on the call-scoring data, reps score highest on closing (avg 84/100) and lowest on discovery (avg 61/100). The coaching notes suggest mirroring the customer's stated priority early, which correlates with a 23% higher close rate. Recommendation: tighten discovery questioning before pitching. [demo-chunk-1] [demo-chunk-2]";
  }
  if (q.includes("nemt") || q.includes("email") || q.includes("pitch")) {
    return "For NEMT accounts, lead with reliability and on-time performance — facility coordinators treat price as secondary. Open with a proof point on on-time rate, then address the reliability objection directly. [demo-chunk-3]";
  }
  return "Here's what the knowledge base shows: reps close best when they lead with the customer's stated priority and keep discovery tight. Closing scores average 84/100 while discovery lags at 61/100, so stronger discovery questioning is the biggest lever. [demo-chunk-1] [demo-chunk-2]";
}

export function demoChatStreamResponse(query: string): Response {
  const text = pickAnswer(query);
  const tokens = text.match(/\S+\s*/g) ?? [text];
  const enc = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const tok of tokens) {
        controller.enqueue(enc.encode(`0:${JSON.stringify(tok)}\n`));
        await new Promise((r) => setTimeout(r, 22));
      }
      controller.enqueue(
        enc.encode(`d:${JSON.stringify({ finishReason: "stop", usage: { promptTokens: 1180, completionTokens: tokens.length } })}\n`)
      );
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8", "x-vercel-ai-data-stream": "v1" },
  });
}
