// GET /api/admin/capabilities — the capability manifest the permission editor
// renders: the Brain's GET /api/v1/capabilities (fetched server-side with the
// scoped BRAIN_API_KEY, which never reaches the browser) merged with this app's
// own capabilities, or the built-in list when the Brain is unreachable
// (`source: "fallback"`). Admin-gated.
//
//   ?refresh=1  bypass the ~5-minute cache (the editor's "Retry" after a fallback)

import { NextResponse } from "next/server";
import { resolveAdmin } from "@/lib/admin-users";
import { fetchCapabilityManifest } from "@/lib/capabilities";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const gate = await resolveAdmin();
  if ("error" in gate) return gate.error;

  const force = new URL(req.url).searchParams.get("refresh") === "1";
  const manifest = await fetchCapabilityManifest({ force });
  return NextResponse.json(manifest, { headers: { "cache-control": "private, no-store" } });
}
