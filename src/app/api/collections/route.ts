// GET /api/collections: what the "Search in" picker can offer.
//   { collections: [{ id, name }], scopes: [{ id, label, description, sensitive }] }
//
// Auth: the signed-in (active) user holding the "chat.source_scope" capability.
// A user without it gets nothing to pick ({ collections: [], scopes: [] }; the
// picker is hidden and /api/chat ignores any scope they send). The scoped
// BRAIN_API_KEY stays server-side. The Brain returns only the collections and
// scopes the key may search, and later intersects any chosen ids with the key
// scope, so narrowing is always safe.
// Scopes are filtered per USER here: a sensitive scope ("Consultant calls") is only
// listed when the user may retrieve its call data (lib/access allowedSourceTypes).
// /api/chat enforces the same rule on send.

import { NextResponse } from "next/server";
import { getSessionProfile } from "@/lib/admin";
import { fetchBrainSearchOptions } from "@/lib/brain";
import { accessFromProfile, allowedSourceTypes, hasCapability, SENSITIVE_SOURCE_TYPES } from "@/lib/access";
import { scopesForAccess } from "@/lib/knowledge-scopes";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";

export async function GET() {
  const profile = await getSessionProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = accessFromProfile(profile);
  // No source scoping for this user: nothing to offer (and no Brain call).
  if (!hasCapability(access, "chat.source_scope")) return NextResponse.json({ collections: [], scopes: [] });

  const { collections, scopes } = await fetchBrainSearchOptions();
  const sourceTypes = allowedSourceTypes(access);
  return NextResponse.json({ collections, scopes: scopesForAccess(scopes, sourceTypes, SENSITIVE_SOURCE_TYPES) });
}
