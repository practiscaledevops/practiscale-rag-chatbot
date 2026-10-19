import { z } from "zod";
import { getSessionProfile } from "@/lib/admin";
import { brainImprovePrompt } from "@/lib/brain";
import { rateLimit } from "@/lib/ratelimit";
import { after } from "next/server";
import { recordUsageEvent } from "@/lib/usage";
import { loadWorkspaceSettings } from "@/lib/settings";
export const maxDuration = 120;
export const preferredRegion = ["sin1"];
const schema = z.object({ prompt: z.string().trim().min(3).max(6000) });
export async function POST(req: Request) {
  const p = await getSessionProfile();
  if (!p) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!p.capabilities.includes("chat.knowledge")) return Response.json({ error: "Chat is not enabled." }, { status: 403 });
  const limited = rateLimit(`prompt-improve:${p.userId}`, 8, 60_000); if (limited) return limited;
  const body = schema.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Enter a prompt between 3 and 6,000 characters." }, { status: 400 });
  try {
    const startedAt = Date.now();
    const res = await brainImprovePrompt(body.data.prompt);
    if (!res.ok) return Response.json({ error: "Prompt improvement is unavailable. Your draft has been kept." }, { status: 502 });
    const json = await res.json();
    if (json.usage && typeof json.model === "string") after(async () => {
      const { settings } = await loadWorkspaceSettings();
      await recordUsageEvent({ userId: p.userId, teamId: p.team?.id ?? null, conversationId: null, model: json.model, provider: json.model.startsWith("claude") ? "anthropic" : "openai", tier: "fast", startedAt, pricingOverrides: settings.pricingOverrides }, json.usage);
    });
    return Response.json({ improvedPrompt: json.improvedPrompt, changes: json.changes, questions: json.questions }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return Response.json({ error: "Prompt improvement timed out. Your draft has been kept." }, { status: 504 }); }
}
