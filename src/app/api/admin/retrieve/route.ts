// POST /api/admin/retrieve — the RAG debugger's backend.
//
// Admin-gated. Runs a raw retrieval against the Brain (no generation) and returns
// the retrieved chunks with their reranker scores + the overall confidence, so an
// admin can see EXACTLY what the knowledge base surfaces for a query. The scoped
// Brain key stays server-side inside brainRetrieveDebug.
//
// Capabilities: the admin's OWN data.* grants narrow the retrieval exactly like
// /api/chat does (allowedSourceTypes). A super_admin can switch off an admin's
// call material (data.transcript / data.call_score / data.coaching); the
// debugger must not hand those raw chunks back regardless.

import { NextResponse } from "next/server";
import { requireChatbotAdmin, AdminError, getSessionProfile } from "@/lib/admin";
import { accessFromProfile, allowedSourceTypes } from "@/lib/access";
import { brainRetrieveDebug } from "@/lib/brain";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await requireChatbotAdmin();
  } catch (e) {
    const err = e as AdminError;
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }

  const body = await req.json().catch(() => ({}));
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  if (!query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  // The caller's resolved capabilities (server-side, never the browser).
  // undefined = no narrowing; [NO_SOURCE_TYPES] = nothing.
  const profile = await getSessionProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sourceTypes = allowedSourceTypes(accessFromProfile(profile));

  const result = await brainRetrieveDebug(query.slice(0, 2000), 12, sourceTypes);
  return NextResponse.json(result, { status: result.ok ? 200 : result.status || 502 });
}
