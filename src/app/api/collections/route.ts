// GET /api/collections — the collections the source-scope selector can offer.
//
// Auth: the signed-in user (any authenticated user may narrow their own search
// scope). The scoped BRAIN_API_KEY stays server-side; the Brain returns only the
// collections the key may search, and later intersects any chosen ids with the
// key scope, so narrowing is always safe.

import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { fetchBrainCollections } from "@/lib/brain";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const collections = await fetchBrainCollections();
  return NextResponse.json({ collections });
}
