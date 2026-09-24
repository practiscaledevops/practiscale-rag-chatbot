// GET /api/chat-limits — the workspace chat & context limits for the composer.
//
// Response: ChatLimits JSON (see lib/chat-limits) —
//   { contextWindowTokens, compactAtPct, autoCompact, maxImageMb, maxFileMb, maxFiles }
//
// Any signed-in user may read these (they tune the composer: the context meter,
// compaction prompts and upload checks). Values come from the workspace settings
// row admins edit in /admin/settings, already normalized + clamped by
// lib/settings. Demo mode (no Supabase) answers with the defaults.

import { NextResponse } from "next/server";
import { getSessionProfile } from "@/lib/admin";
import { DEFAULT_CHAT_LIMITS, loadWorkspaceSettings } from "@/lib/settings";
import { isDemo } from "@/lib/demo/mode";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
// Reads the session cookie and reflects live settings, so always dynamic.
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" };

export async function GET() {
  if (isDemo()) {
    return NextResponse.json({ ...DEFAULT_CHAT_LIMITS }, { headers: NO_STORE });
  }

  // Identity resolved SERVER-SIDE from the session.
  const profile = await getSessionProfile();
  if (!profile) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Never throws: a missing row / read error resolves to the defaults.
  const { settings } = await loadWorkspaceSettings();
  return NextResponse.json(settings.chat, { headers: NO_STORE });
}
