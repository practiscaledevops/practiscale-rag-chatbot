// Canned grounded answer for DEMO MODE, in the Vercel AI SDK v4 data-stream
// protocol so useChat() renders it token-by-token with a citation chip.
//
// A query containing "long" streams a slow, long answer (~210 tokens at 40 ms
// each, about 9 s), so background generation and queued follow-ups can be
// tried locally: ask it, switch chats or queue another message, come back.

/** Delay between streamed tokens: the normal answers vs the slow "long" one. */
const TOKEN_MS = 22;
const LONG_TOKEN_MS = 40;

const demoSources = [
  {
    id: "6fbfcee0-7fa4-430c-bff4-10de7081bf01",
    source_type: "call_scorecard",
    name: "Discovery and closing scorecard",
    snippet: "In this sample, discovery averages 61/100 and closing averages 84/100 across the reviewed calls.",
  },
  {
    id: "bea901c1-0b3a-4263-ab32-a3dd72e45ef3",
    source_type: "coaching_note",
    name: "Discovery coaching notes",
    snippet: "Restate the buyer’s priority early and ask follow-up questions before switching to the pitch.",
  },
  {
    id: "0ca489f4-94b0-40bc-897f-848d95256981",
    source_type: "playbook",
    name: "Sample NEMT sales playbook",
    snippet: "Open with a proof point about reliability and on-time performance, then address the facility coordinator’s concern directly.",
  },
] as const;

export function demoCitation(id: string) {
  const matches = demoSources.filter(source => source.id === id || source.id.startsWith(id + "-"));
  return matches.length === 1 ? matches[0] : undefined;
}

function isLongQuery(query: string): boolean {
  return /\blong\b/i.test(query || "");
}

const LONG_ANSWER = [
  "## Where the team loses deals, and what to change",
  "",
  "Across the latest scored calls the pattern is consistent: reps are strong at the end of the call and weak at the start. Closing averages 84/100 while discovery sits at 61/100, and the gap is widest on first calls with new facility coordinators. [demo-chunk-1]",
  "",
  "### What the top closers do differently",
  "",
  "- They restate the customer's stated priority in the first five minutes, in the customer's own words, before any pitch.",
  "- They ask two follow-up questions per answer instead of moving straight to the next item on the script.",
  "- They quantify the cost of the current problem (missed rides, late pickups, rebooked appointments) with the customer. [demo-chunk-2]",
  "",
  "### A four-week plan",
  "",
  "1. **Week 1:** run a 45-minute discovery workshop using two recorded calls, one strong and one weak.",
  "2. **Week 2:** every rep role-plays the opening ten minutes with a manager, twice.",
  "3. **Week 3:** managers score discovery only, with one written comment per call.",
  "4. **Week 4:** compare discovery scores and close rates against the baseline and keep what moved.",
  "",
  "**Bottom line:** tightening discovery is the single biggest lever. The data suggests roughly a 23% higher close rate when the priority is mirrored early, so start there before changing pricing or the pitch deck. [demo-chunk-3]",
].join("\n");

function pickAnswer(query: string): string {
  const q = (query || "").toLowerCase();
  if (isLongQuery(q)) return LONG_ANSWER;
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
    return [
      "## Coach discovery first",
      "",
      "In the sample scorecards, discovery averages **61/100** and closing averages **84/100**. [demo-chunk-1]",
      "",
      "**What to practice**",
      "",
      "1. **Restate the buyer’s priority** in their own words before introducing the offer. [demo-chunk-2]",
      "2. **Ask a follow-up question.** Find out what they’ve tried and what the problem is costing them.",
      "",
      "**Next coaching session:** review one call together and replay the first five minutes. Have the rep try a different follow-up question.",
    ].join("\n");
  }
  if (q.includes("nemt") || q.includes("email") || q.includes("pitch")) {
    return "For NEMT accounts, lead with reliability and on-time performance — facility coordinators treat price as secondary. Open with a proof point on on-time rate, then address the reliability objection directly. [demo-chunk-3]";
  }
  return "Here's what the knowledge base shows: reps close best when they lead with the customer's stated priority and keep discovery tight. Closing scores average 84/100 while discovery lags at 61/100, so stronger discovery questioning is the biggest lever. [demo-chunk-1] [demo-chunk-2]";
}

export function demoChatStreamResponse(query: string, attachmentNames: string[] = []): Response {
  const names = attachmentNames.filter((n) => typeof n === "string" && n.trim());
  const answer = pickAnswer(query);
  const sources = demoSources.filter((_, index) => answer.includes(`[demo-chunk-${index + 1}]`));
  const citedAnswer = answer.replace(/\[demo-chunk-([1-3])\]/g, (_, index: string) => `[${demoSources[Number(index) - 1].id}]`);
  const text = names.length
    ? `Reading ${names.length === 1 ? "your attached file" : `your ${names.length} attached files`} (${names.join(", ")}). ` +
      `In demo mode I can't extract the file, but connected to the Brain I'd answer from its contents alongside the company knowledge base. ` +
      citedAnswer
    : citedAnswer;
  const tokens = text.match(/\S+\s*/g) ?? [text];
  const delay = isLongQuery(query) ? LONG_TOKEN_MS : TOKEN_MS;
  const enc = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(enc.encode(`2:${JSON.stringify([{ type: "sources", sources }])}\n`));
      for (const tok of tokens) {
        controller.enqueue(enc.encode(`0:${JSON.stringify(tok)}\n`));
        await new Promise((r) => setTimeout(r, delay));
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
