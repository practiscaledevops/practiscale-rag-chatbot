import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Coins, Gauge, ShieldCheck, Sparkles, Users } from "lucide-react";
import { getUser } from "@/lib/auth";
import { getSessionProfile } from "@/lib/admin";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { AccountClient } from "./AccountClient";

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

const TIER_LABEL: Record<string, string> = {
  fast: "Fast",
  recommended: "Recommended",
  max: "Max",
};

const FEATURE_LABEL: Record<string, string> = {
  rag: "Knowledge (RAG)",
  projects: "Projects",
  attachments: "Attachments",
  connectors: "Connectors",
};

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
  // filter is needed (and none would widen the result).
  const [profile, user, usageRes] = await Promise.all([
    getSessionProfile(),
    getUser(),
    supabase
      .from("usage_events")
      .select("input_tokens, output_tokens, cost_usd")
      .gte("created_at", monthStartISO()),
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

  const allowedTiers =
    Array.isArray(profile.permissions.allowed_tiers) &&
    profile.permissions.allowed_tiers.length > 0
      ? profile.permissions.allowed_tiers
      : (["fast", "recommended", "max"] as const);

  const enabledFeatures = Array.isArray(profile.permissions.features)
    ? profile.permissions.features
    : [];

  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your profile and review your access and usage.
          </p>
        </header>

        <div className="space-y-6">
          {/* Identity + sign out (interactive) */}
          <AccountClient
            displayName={displayName}
            email={profile.email}
            roleLabel={roleLabel}
          />

          {/* This-month usage */}
          <section
            aria-labelledby="usage-heading"
            className="rounded-xl border border-border bg-surface p-5 shadow-soft sm:p-6"
          >
            <h2 id="usage-heading" className="text-sm font-semibold">
              Usage this month
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Estimated from token pricing; resets at the start of each month.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
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
            className="rounded-xl border border-border bg-surface p-5 shadow-soft sm:p-6"
          >
            <h2 id="access-heading" className="text-sm font-semibold">
              Your access
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Set by your workspace administrator.
            </p>

            <dl className="mt-4 space-y-4">
              <Row label="Models">
                {modelAllowlist ? (
                  <ChipList items={modelAllowlist} />
                ) : (
                  <span className="text-sm text-foreground">All available models</span>
                )}
              </Row>

              <Row label="Tiers">
                <ChipList items={allowedTiers.map((t) => TIER_LABEL[t] ?? t)} />
              </Row>

              <Row label="Features">
                {enabledFeatures.length > 0 ? (
                  <ChipList
                    items={enabledFeatures.map((f) => FEATURE_LABEL[f] ?? f)}
                  />
                ) : (
                  <span className="text-sm text-muted-foreground">
                    Standard access
                  </span>
                )}
              </Row>

              {profile.team && (
                <Row label="Team">
                  <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
                    <Users size={14} className="text-muted-foreground" />
                    {profile.team.name}
                  </span>
                </Row>
              )}

              {memberSince && (
                <Row label="Member since">
                  <span className="text-sm text-foreground">{memberSince}</span>
                </Row>
              )}
            </dl>
          </section>

          {/* Admin shortcut (only for admins) */}
          {isAdmin && (
            <a
              href="/admin"
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-5 shadow-soft transition-colors hover:bg-surface-muted"
            >
              <span className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent/10 text-accent">
                  <ShieldCheck size={18} />
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
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon size={14} aria-hidden />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-1.5 text-xl font-semibold tabular-nums tracking-tight">
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A label / value row inside the access card. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <dt className="text-sm font-medium text-muted-foreground sm:w-32 sm:shrink-0">
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
      {items.map((item) => (
        <span
          key={item}
          className="inline-flex items-center rounded-md border border-border bg-surface-muted px-2 py-0.5 text-xs font-medium text-foreground"
        >
          {item}
        </span>
      ))}
    </div>
  );
}
