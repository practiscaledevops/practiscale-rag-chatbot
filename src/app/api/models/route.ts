// GET /api/models — the model switcher's catalog for the signed-in user.
//
// Resolves the session server-side, fetches the Brain's model catalog (with the
// scoped BRAIN_API_KEY, which stays in lib/models on the server), then returns
// only the models this user is permitted to select AND that the Brain reports as
// available — so the client dropdown can never offer a model the user may not
// use or that is currently down.
//
// The catalog fetch and the BRAIN_API_KEY live entirely server-side; the browser
// only ever sees this filtered, safe list.

import { NextResponse } from "next/server";
import { getSessionProfile } from "@/lib/admin";
import { fetchBrainModels, filterModelsByPermissions } from "@/lib/models";
import { isDemo } from "@/lib/demo/mode";

export const runtime = "nodejs";
// Reads the session cookie, so this route is always dynamic.
export const dynamic = "force-dynamic";

export async function GET() {
  // Fetch the catalog once (server-side, cached by lib/models via revalidate).
  const catalog = await fetchBrainModels();

  // DEMO MODE: no real session/permissions — offer the whole available catalog.
  if (isDemo()) {
    return NextResponse.json({ models: catalog.filter((m) => m.available) });
  }

  // Identity + permissions resolved SERVER-SIDE from the session.
  const profile = await getSessionProfile();
  if (!profile) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Filter by the user's permissions, then to models the Brain reports available.
  const permitted = filterModelsByPermissions(
    catalog,
    profile.permissions,
    profile.canUseAllModels
  );
  const models = permitted.filter((m) => m.available);

  return NextResponse.json({ models });
}
