import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Coins, Gauge, ShieldCheck, Sparkles, Users } from "lucide-react";
import { getUser } from "@/lib/auth";
import { getSessionProfile } from "@/lib/admin";
import { accessFromProfile, effectiveCapabilities } from "@/lib/access";
import { peekCapabilityManifest, type CapabilityManifest } from "@/lib/capabilities";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { loadAvatarUrl } from "@/lib/avatar";
import { AccountClient } from "./AccountClient";
import { MfaSection } from "./MfaSection";

export const metadata: Metadata = { title: "Account · Practiscale" };

// Reads the session cookie, so never statically rendered.
export const dynamic = "force-dynamic";

const numberFmt = new Intl.NumberFormat("en-US");
const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  user: "Member",
};

/** One manifest group of the capabilities a user holds, as the access card lists it. */
interface CapabilityGroupView {
  id: string;
  label: string;
  items: string[];
}

/** A readable fallback label for a capability id the manifest doesn't describe. */
function labelFromId(id: string): string {
  const s = id.split(".").slice(1).join(" ").replace(/[_-]+/g, " ").trim() || id;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The held capability ids grouped by the manifest's groups (manifest order,
 * manifest labels). Ids the manifest doesn't carry, or whose group it doesn't
 * list, go under "Other". Empty groups are dropped.
 */
function groupCapabilities(ids: readonly string[], manifest: CapabilityManifest): CapabilityGroupView[] {
  const held = new Set(ids);
  const known = new Set(manifest.capabilities.map((c) => c.id));
  const groupIds = new Set(manifest.groups.map((g) => g.id));
  const groups: CapabilityGroupView[] = manifest.groups.map((g) => ({
    id: g.id,
    label: g.label,
    items: manifest.capabilities.filter((c) => c.group === g.id && held.has(c.id)).map((c) => c.label),
  }));
  const other = [
    ...manifest.capabilities.filter((c) => held.has(c.id) && !groupIds.has(c.group)).map((c) => c.label),
    ...ids.filter((id) => !known.has(id)).map(labelFromId),
  ];
  if (other.length > 0) groups.push({ id: "__other", label: "Other", items: other });
  return groups.filter((g) => g.items.length > 0);
}

/** First instant of the current month, UTC, as an ISO string. */
function monthStartISO(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * /account — the signed-in user's profile + access summary + this-month usage.
 * Lives in the (app) route group so it inherits the chat chrome (sidebar / top
 * bar). Auth is enforced by the group layout and re-checked here (a signed-out
 * user has no profile → /login). All reads are row-scoped to the caller by RLS.
 */
export default async function AccountPage() {
  const supabase = await createSupabaseServerClient();

  // Profile, auth user, and this-month usage are independent reads — run them
  // together. RLS scopes usage_events to the signed-in user, so no user_id
  // filter is needed (and none would widen the result). The avatar read chains
  // off getUser (request-cached, so no extra verification) and never throws.
  const [profile, user, usageRes, avatarUrl] = await Promise.all([
    getSessionProfile(),
    getUser(),
    supabase
      .from("usage_events")
      .select("input_tokens, output_tokens, cost_usd")
      .gte("created_at", monthStartISO()),
    getUser().then((u) => (u ? loadAvatarUrl(supabase, u.id) : null)),
  ]);
  if (!profile) redirect("/login");

  const usageRows = usageRes.data;

  const usage = (usageRows ?? []).reduce(
    (acc, r) => {
      acc.inputTokens += Number(r.input_tokens ?? 0);
      acc.outputTokens += Number(r.output_tokens ?? 0);
      acc.costUsd += Number(r.cost_usd ?? 0);
      acc.calls += 1;
      return acc;
    },
    { inputTokens: 0, outputTokens: 0, costUsd: 0, calls: 0 }
  );
  const totalTokens = usage.inputTokens + usage.outputTokens;

  const displayName =
    profile.displayName?.trim() || profile.email?.split("@")[0] || "there";
  const roleLabel = ROLE_LABEL[profile.role] ?? "Member";
  const isAdmin = profile.role === "admin" || profile.role === "super_admin";

  const modelAllowlist =
    !profile.canUseAllModels &&
    Array.isArray(profile.permissions.models) &&
    profile.permissions.models.length > 0
      ? profile.permissions.models
      : null;

  // What this user may use: their resolved capability set (the same set every
  // route gates on), labelled + grouped by the capability manifest it was
  // resolved against. Model tiers are capabilities too ("Models" group).
  const manifest = peekCapabilityManifest();
  const capabilityGroups = groupCapabilities(
    effectiveCapabilities(accessFromProfile(profile), manifest),
    manifest
  );

  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <header className="mb-5">
          <h1 className="text-xl font-semibold tracking-tight">Account</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Manage your profile and review your access and usage.
          </p>
        </header>

        <div className="space-y-4">
          {/* Identity + sign out (interactive) */}
          <AccountClient
            displayName={displayName}
            email={profile.email}
            roleLabel={roleLabel}
            avatarUrl={avatarUrl}
          />

          {/* This-month usage */}
          <section
            aria-labelledby="usage-heading"
            className="rounded-2xl border border-border bg-surface p-4 shadow-soft"
          >
            <h2 id="usage-heading" className="text-sm font-semibold">
              Usage this month
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Estimated from token pricing; resets at the start of each month.
            </p>
            <div className="mt-3.5 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat
                icon={Coins}
                label="Tokens"
                value={numberFmt.format(totalTokens)}
                hint={`${numberFmt.format(usage.inputTokens)} in · ${numberFmt.format(
                  usage.outputTokens
                )} out`}
              />
              <Stat
                icon={Gauge}
                label="Messages"
                value={numberFmt.format(usage.calls)}
              />
              <Stat
                icon={Sparkles}
                label="Est. cost"
                value={currencyFmt.format(usage.costUsd)}
              />
            </div>
          </section>

          {/* Access summary */}
          <section
            aria-labelledby="access-heading"
            className="rounded-2xl border border-border bg-surface p-4 shadow-soft"
          >
            <h2 id="access-heading" className="text-sm font-semibold">
              Your access
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Set by your workspace administrator.
            </p>

            <dl className="mt-3.5 space-y-2.5">
              <Row label="Allowed models">
                {modelAllowlist ? (
                  <ChipList items={modelAllowlist} />
                ) : (
                  <span className="text-[13px] leading-6 text-foreground">All available models</span>
                )}
              </Row>

              {profile.team && (
                <Row label="Team">
                  <span className="inline-flex items-center gap-1.5 text-[13px] leading-6 text-foreground">
                    <Users size={14} className="shrink-0 text-muted-foreground" />
                    {profile.team.name}
                  </span>
                </Row>
              )}

              {memberSince && (
                <Row label="Member since">
                  <span className="text-[13px] leading-6 text-foreground">{memberSince}</span>
                </Row>
              )}
            </dl>

            {/* Capabilities: what this account may use, grouped as the admin editor groups them. */}
            <div className="mt-4 border-t border-border pt-3.5">
              <h3 className="text-[13px] font-semibold">What you can use</h3>
              {capabilityGroups.length > 0 ? (
                <dl className="mt-2.5 space-y-2.5">
                  {capabilityGroups.map((g) => (
                    <Row key={g.id} label={g.label}>
                      <ChipList items={g.items} />
                    </Row>
                  ))}
                </dl>
              ) : (
                <p className="mt-1 text-[13px] leading-6 text-muted-foreground">
                  Nothing is enabled for your account yet. Ask your administrator for access.
                </p>
              )}
            </div>
          </section>

          {/* Security: two-factor authentication (self-managed). */}
          <MfaSection />

          {/* Admin shortcut (only for admins) */}
          {isAdmin && (
            <a
              href="/admin"
              className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3.5 shadow-soft transition-colors hover:bg-surface-muted"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                  <ShieldCheck size={16} />
                </span>
                <span>
                  <span className="block text-sm font-medium">Control panel</span>
                  <span className="block text-xs text-muted-foreground">
                    Manage users, teams, usage, and workspace settings.
                  </span>
                </span>
              </span>
              <span aria-hidden className="text-muted-foreground">
                →
              </span>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/** A labelled metric tile for the usage card. */
function Stat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Coins;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl bg-surface-muted px-3.5 py-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon size={14} className="shrink-0" aria-hidden />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight">
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A label / value row inside the access card. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <dt className="text-[13px] font-medium leading-6 text-muted-foreground sm:w-32 sm:shrink-0">
        {label}
      </dt>
      <dd className="min-w-0 sm:flex-1">{children}</dd>
    </div>
  );
}

/** A wrapping row of neutral chips. */
function ChipList({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, i) => (
        <span
          key={`${i}:${item}`}
          className="inline-flex h-6 items-center rounded-full bg-surface-muted px-2.5 text-xs font-medium text-foreground"
        >
          {item}
        </span>
      ))}
    </div>
  );
}
