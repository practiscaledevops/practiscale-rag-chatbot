// POST /api/admin/retrieve — the RAG debugger's backend.
//
// Admin-gated. Runs a raw retrieval against the Brain (no generation) and returns
// the retrieved chunks with their reranker scores + the overall confidence, so an
// admin can see EXACTLY what the knowledge base surfaces for a query. The scoped
// Brain key stays server-side inside brainRetrieveDebug.

import { NextResponse } from "next/server";
import { requireChatbotAdmin, AdminError } from "@/lib/admin";
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

  const result = await brainRetrieveDebug(query.slice(0, 2000));
  return NextResponse.json(result, { status: result.ok ? 200 : result.status || 502 });
}
