// Canned grounded answer for DEMO MODE, in the Vercel AI SDK v4 data-stream
// protocol so useChat() renders it token-by-token with a citation chip.

function pickAnswer(query: string): string {
  const q = (query || "").toLowerCase();
  if (q.includes("table") || q.includes("compare")) {
    return [
      "## Close rates by consultant",
      "",
      "From the latest call-scoring sync (sample data):",
      "",
      "| Consultant | Calls | Close rate | Avg score |",
      "|---|---:|---:|---:|",
      "| Alex Carter | 42 | 9.5% | 34.1 |",
      "| Priya Shah | 38 | 7.9% | 31.6 |",
      "| Sam Lee | 29 | 6.9% | 28.4 |",
      "| Maria Gomez | 25 | 4.0% | 26.2 |",
      "",
      "**Takeaway:** discovery is the weakest phase across the team; the top closer mirrors the customer's stated priority early. [demo-chunk-1]",
    ].join("\n");
  }
  if (q.includes("discovery") || q.includes("improve") || q.includes("weak")) {
    return "Based on the call-scoring data, reps score highest on closing (avg 84/100) and lowest on discovery (avg 61/100). The coaching notes suggest mirroring the customer's stated priority early, which correlates with a 23% higher close rate. Recommendation: tighten discovery questioning before pitching. [demo-chunk-1] [demo-chunk-2]";
  }
  if (q.includes("nemt") || q.includes("email") || q.includes("pitch")) {
    return "For NEMT accounts, lead with reliability and on-time performance — facility coordinators treat price as secondary. Open with a proof point on on-time rate, then address the reliability objection directly. [demo-chunk-3]";
  }
  return "Here's what the knowledge base shows: reps close best when they lead with the customer's stated priority and keep discovery tight. Closing scores average 84/100 while discovery lags at 61/100, so stronger discovery questioning is the biggest lever. [demo-chunk-1] [demo-chunk-2]";
}

export function demoChatStreamResponse(query: string, attachmentNames: string[] = []): Response {
  const names = attachmentNames.filter((n) => typeof n === "string" && n.trim());
  const text = names.length
    ? `Reading ${names.length === 1 ? "your attached file" : `your ${names.length} attached files`} (${names.join(", ")}). ` +
      `In demo mode I can't extract the file, but connected to the Brain I'd answer from its contents alongside the company knowledge base. ` +
      pickAnswer(query)
    : pickAnswer(query);
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
