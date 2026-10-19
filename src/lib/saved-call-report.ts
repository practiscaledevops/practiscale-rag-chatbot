/** A saved answer is historical. Refresh its original date, not a newly shifted "yesterday". */
export function savedCallReportQuery(messages: { role: string; content: string; createdAt?: unknown }[], index: number, timeZone?: string): string | null {
  const answer = messages[index];
  if (answer?.role !== "assistant" || !/\b(call report|calls|consultant.wise summary)\b/i.test(answer.content)) return null;
  let user: typeof messages[number] | undefined;
  for (let i = index - 1; i >= 0; i--) if (messages[i].role === "user") { user = messages[i]; break; }
  if (!user || /\b(write|draft|create|generate|coach|analy[sz]e|audit|why)\b/i.test(user.content)) return null;
  let query = user.content.replace(/\b(today|yesterday)(?:['’]?s)?(calls?)\b/gi, "$1 $2");
  if (!/\b(calls?|report|summary)\b/i.test(query) || !/\b(check|list|show|give|report|summary|today|yesterday|yesterdays)\b/i.test(query)) return null;
  if (/\b(?:today|yesterday)(?:['’]?s)?\b/i.test(query)) {
    const timestamp = user.createdAt instanceof Date ? user.createdAt : typeof user.createdAt === "string" ? new Date(user.createdAt) : null;
    // No timestamp means the original relative date cannot be recovered safely.
    if (!timestamp || !Number.isFinite(timestamp.getTime())) return null;
    try {
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(timestamp);
      query = query.replace(/\b(today|yesterday)(?:['’]?s)?\b/gi, (_, relative: string) => relative.toLowerCase() === "today" ? day : new Date(Date.parse(`${day}T12:00:00Z`) - 86400_000).toISOString().slice(0, 10));
    } catch { return null; }
  }
  return query;
}
