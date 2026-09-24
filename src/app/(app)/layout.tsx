import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getUser } from "@/lib/auth";
import { getSessionProfile } from "@/lib/admin";
import type { ModelTier } from "@/lib/brain";
import { getMonthlyUsageTokens } from "@/lib/usage-read";
import { loadConversations } from "@/lib/conversations-read";
import {
  applyDisabledModels,
  fetchBrainModels,
  filterModelsByPermissions,
  TIER_ALIASES,
} from "@/lib/models";
import { loadWorkspaceSettings } from "@/lib/settings";
import { AppChrome, type Project } from "@/components/AppChrome";
// Pin this route group to Singapore (co-located with Supabase + the Brain).
export const preferredRegion = ["sin1"];

/**
 * Authenticated shell for every route in the (app) group. Enforces auth
 * server-side (defense in depth alongside middleware), then fetches everything
 * the chrome needs — the user's chat history + projects (row-level-security
 * scoped to them), the permitted model catalog (Brain catalog filtered by the
 * user's permissions, all with the scoped BRAIN_API_KEY kept server-side), and
 * the identity bits (first name for the greeting, admin flag for the Admin link)
 * — and hands them to the client {@link AppChrome}.
 *
 * NOTE: the (app) route group does not affect URLs. Page agents place their
 * routes under src/app/(app)/ (e.g. the chat page at (app)/page.tsx) to inherit
 * this shell.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();

  // Resolve the user id first (cached for the rest of the request) so the
  // monthly-usage read can race with everything else.
  const user = await getUser();
  if (!user) redirect("/login");

  // Resolve identity in parallel with the history/projects/catalog/usage/settings
  // fetches. RLS scopes history + projects to the signed-in user (empty for a
  // signed-out caller), and the catalog needs no session — so all can race, and
  // we gate on the profile right after. Ordering mirrors /api/conversations.
  const [profile, conversations, projectsRes, catalog, monthTokens, { settings }] =
    await Promise.all([
      getSessionProfile(user),
      loadConversations(supabase, user.id),
      supabase
        .from("projects")
        .select("id, name, system_prompt, created_at")
        .order("created_at", { ascending: false }),
      fetchBrainModels(),
      getMonthlyUsageTokens(user.id),
      loadWorkspaceSettings(),
    ]);

  // Auth gate (defense in depth alongside middleware): no profile → /login.
  // getSessionProfile also returns null for a DEACTIVATED account; tell that
  // user why (and drop their session — best-effort, the login page also signs
  // out client-side) instead of bouncing them to a silent login form.
  if (!profile) {
    const { data: row } = await supabase
      .from("profiles")
      .select("is_active")
      .eq("id", user.id)
      .maybeSingle();
    if (row?.is_active === false) {
      await supabase.auth.signOut().catch(() => undefined);
      redirect("/login?deactivated=1");
    }
    redirect("/login");
  }

  // Hide models the user isn't permitted to select; unavailable ones (Brain
  // down, or disabled by an admin in workspace settings) stay in the list —
  // the switcher renders them disabled with the reason.
  const models = applyDisabledModels(
    filterModelsByPermissions(catalog, profile.permissions, profile.canUseAllModels),
    settings.disabledModels
  );

  // A user confined to a model allowlist gets no tier presets: the Brain resolves
  // an alias to whichever model backs that tier, which may sit outside their
  // allowlist (and /api/chat rejects it) — they pick a concrete model instead.
  const restrictedToModels =
    !profile.canUseAllModels && (profile.permissions?.models?.length ?? 0) > 0;

  // Workspace default (admin settings) seeds the switcher for a new chat. An
  // open conversation's own saved tier still wins (c/[id] syncs it in ChatView).
  const { defaultModel, defaultModelKind } = settings;
  const isTier = (v: string): v is ModelTier => (TIER_ALIASES as readonly string[]).includes(v);
  const defaultModelTier = catalog.find((m) => m.id === defaultModel)?.tier;
  const initialTier: ModelTier =
    defaultModelKind === "tier" && isTier(defaultModel)
      ? defaultModel
      : defaultModelTier && isTier(defaultModelTier)
        ? defaultModelTier
        : "recommended";
  const initialModel = defaultModelKind === "model" ? defaultModel : null;

  const firstName =
    profile.displayName?.trim().split(/\s+/)[0] ||
    profile.email?.split("@")[0] ||
    "there";
  const isAdmin = profile.role === "admin" || profile.role === "super_admin";

  return (
    <AppChrome
      initialConversations={conversations}
      initialProjects={(projectsRes.data ?? []) as Project[]}
      models={models}
      restrictedToModels={restrictedToModels}
      initialTier={initialTier}
      initialModel={initialModel}
      firstName={firstName}
      fullName={profile.displayName?.trim() || firstName}
      email={profile.email ?? ""}
      isAdmin={isAdmin}
      features={profile.permissions?.features ?? []}
      initialTokens={monthTokens}
    >
      {children}
    </AppChrome>
  );
}
