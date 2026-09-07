// /api/admin/settings — workspace settings (the chatbot's OWN Supabase project).
//
// Reads and writes the single-row public.app_settings table (see
// supabase/setup/settings.sql). This is APP-WIDE configuration, not user data:
//   • disabledModels    — a DENYLIST of concrete model ids turned OFF workspace-
//                          wide (empty ⇒ every Brain-catalog model is enabled;
//                          models the Brain adds later are enabled by default).
//   • defaultModel/Kind — the default selection for a NEW chat: a tier alias
//                          ("fast"|"recommended"|"max") or a concrete model id,
//                          forwarded verbatim as the Brain `model` field.
//   • ragDefaultOn      — whether RAG grounding is ON by default for new chats.
//   • pricingOverrides  — optional per-model $/1M in+out overrides the cost calc
//                          can read (fall back to lib/pricing.ts when absent).
//
// SECURITY / HARD RULE: every request is gated by requireChatbotAdmin() — the
// caller is resolved server-side and their role is read from profiles via the
// SERVICE-ROLE client, never trusted from a client claim (see lib/admin.ts).
// Both `admin` and `super_admin` may save. The row itself is service-role only
// (RLS forced, no user policies), so reads/writes use the service-role client.
//
// The pure settings shape + DEFAULT_SETTINGS + mergeSettings + the payload
// builder live in lib/settings.ts so server consumers (the chat pipeline / server
// components / the settings page) can reuse the exact same defaults and merge
// semantics without this route re-exporting non-handler symbols.

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requireChatbotAdmin,
  AdminError,
  type ChatbotAdmin,
} from "@/lib/admin";
import { createSupabaseServiceClient } from "@/lib/supabase-server";
import {
  buildSettingsPayload,
  loadWorkspaceSettings,
  mergeSettings,
} from "@/lib/settings";

export const runtime = "nodejs";
// Reads the session cookie (for gating) and always reflects live settings.
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Admin gate helper (maps AdminError → JSON response)
// ---------------------------------------------------------------------------
async function resolveAdmin(): Promise<
  { admin: ChatbotAdmin } | { error: NextResponse }
> {
  try {
    return { admin: await requireChatbotAdmin() };
  } catch (e) {
    if (e instanceof AdminError) {
      return { error: NextResponse.json({ error: e.message }, { status: e.status }) };
    }
    return { error: NextResponse.json({ error: "Server error" }, { status: 500 }) };
  }
}

// ---------------------------------------------------------------------------
// GET /api/admin/settings — current settings merged with defaults + reference data
// ---------------------------------------------------------------------------
export async function GET() {
  const gate = await resolveAdmin();
  if ("error" in gate) return gate.error;

  try {
    const payload = await buildSettingsPayload(gate.admin);
    return NextResponse.json(payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not load settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PUT /api/admin/settings — save workspace settings (admin or super_admin)
// ---------------------------------------------------------------------------

// Every field is optional: the handler merges the provided fields over the
// CURRENT saved settings, so the client may send a partial patch or the whole
// object. Bounds mirror the normalize helpers in lib/settings.ts.
const rateField = z.number().nonnegative().max(1_000_000).nullable();

const putSchema = z
  .object({
    disabledModels: z.array(z.string().trim().min(1).max(200)).max(500).optional(),
    defaultModel: z.string().trim().min(1).max(200).optional(),
    defaultModelKind: z.enum(["tier", "model"]).optional(),
    ragDefaultOn: z.boolean().optional(),
    pricingOverrides: z
      .record(
        z.string().trim().min(1).max(200),
        z.object({ inputPerMTok: rateField, outputPerMTok: rateField })
      )
      .optional(),
  })
  .strict();

export async function PUT(req: Request) {
  const gate = await resolveAdmin();
  if ("error" in gate) return gate.error;
  const { admin } = gate;

  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const patch = parsed.data;

  const service = createSupabaseServiceClient();

  // Start from the current saved settings so a partial PUT never clobbers fields
  // the client didn't send, then overlay the incoming patch and re-normalize.
  const { settings: current } = await loadWorkspaceSettings(service);
  const merged = mergeSettings({
    ...current,
    ...patch,
    // records/arrays: prefer the patch when present, else keep current.
    disabledModels: patch.disabledModels ?? current.disabledModels,
    pricingOverrides: patch.pricingOverrides ?? current.pricingOverrides,
  });

  const updatedAt = new Date().toISOString();
  const { error } = await service.from("app_settings").upsert(
    { id: 1, data: merged, updated_at: updatedAt },
    { onConflict: "id" }
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    settings: merged,
    updatedAt,
    savedBy: admin.email,
  });
}
