"use client";

// Admin › Users — client surface. Renders the fleet table and the create/edit
// editor with layman-friendly access controls (role, activation, team, and the
// permissions). Permissions are rendered FROM THE BRAIN'S CAPABILITY MANIFEST
// (grouped switches, sensitive badges, dependencies, role presets), so a
// capability the Brain gains shows up here without a code change; model access
// is the manifest's model tiers plus the Brain's model catalog. All authority
// lives server-side: this component only reads/writes through the admin API,
// which re-checks the caller's role, validates every capability id against the
// manifest and refuses grants beyond the caller's own (see /api/admin/users).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  UserPlus,
  Pencil,
  Trash2,
  AlertTriangle,
  Check,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { onRadioGroupKeyDown, radioTabIndex } from "@/lib/a11y";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import type { ProfileRole } from "@/lib/admin";
import type {
  AdminUsersPayload,
  AdminUser,
  AdminModelOption,
  PermissionsShape,
} from "@/lib/admin-users";
import {
  CAPABILITY_PRESETS,
  TIER_CAPABILITY,
  closeGrantSet,
  prerequisitesOf,
  presetCapabilities,
  presetForRole,
  toggleCapability,
  dependentsOf,
  type Capability,
  type CapabilityPresetId,
  type ResolvedCapabilityManifest,
} from "@/lib/capabilities-shared";

// ---------------------------------------------------------------------------
// Small formatting helpers
// ---------------------------------------------------------------------------

/** Compact token count: 1,234 → "1.2k", 2,500,000 → "2.5M". */
function formatTokens(n: number): string {
  if (!n) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

/** USD with a sensible floor so tiny costs don't render as "$0.00". */
function formatUsd(n: number): string {
  if (!n) return "$0.00";
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

/** Coarse relative time; falls back to a locale date for anything older. */
function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Friendly provider heading for the grouped model checklist. */
function providerLabel(p: string): string {
  const key = p.toLowerCase();
  if (key === "anthropic") return "Anthropic";
  if (key === "openai") return "OpenAI";
  return p ? p.charAt(0).toUpperCase() + p.slice(1) : "Other";
}

/** One-line summary of a user's model access for the table. */
function modelSummary(u: AdminUser): string {
  if (u.canUseAllModels) return "All models";
  const n = u.permissions.models?.length ?? 0;
  return n === 0 ? "All models" : `${n} model${n === 1 ? "" : "s"}`;
}

/** One-line summary of a user's capabilities for the table. */
function accessSummary(u: AdminUser, manifest: ResolvedCapabilityManifest): string {
  if (u.role === "super_admin") return "Every permission";
  const on = new Set(u.capabilities);
  const total = manifest.capabilities.length;
  const sensitive = manifest.capabilities.filter((c) => c.sensitive && on.has(c.id)).length;
  const tiers = (Object.keys(TIER_CAPABILITY) as Array<keyof typeof TIER_CAPABILITY>).filter((t) =>
    manifest.capabilities.some((c) => c.id === TIER_CAPABILITY[t])
  );
  const onTiers = tiers.filter((t) => on.has(TIER_CAPABILITY[t]));
  const tierText = onTiers.length === tiers.length ? "" : ` · Tiers: ${onTiers.join(", ") || "none"}`;
  return `${Math.min(on.size, total)} of ${total} permissions${sensitive ? ` · ${sensitive} sensitive` : ""}${tierText}`;
}

/** Read a server error response into a display string. */
async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.error === "string") return body.error;
  } catch {
    /* non-JSON */
  }
  return "Something went wrong. Please try again.";
}

/** Whether a capability was added recently enough to badge as new. */
function isRecent(since: string | undefined): boolean {
  if (!since) return false;
  const t = Date.parse(since);
  return Number.isFinite(t) && Date.now() - t < 21 * 86_400_000;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

// ---------------------------------------------------------------------------
// Presentational atoms
// ---------------------------------------------------------------------------

function RoleBadge({ role }: { role: ProfileRole }) {
  const styles: Record<ProfileRole, string> = {
    user: "bg-surface-muted text-muted-foreground",
    admin: "bg-accent-soft text-accent-strong",
    super_admin: "bg-brand-gradient text-white",
  };
  const label: Record<ProfileRole, string> = {
    user: "User",
    admin: "Admin",
    super_admin: "Super admin",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        styles[role]
      )}
    >
      {role === "super_admin" && <ShieldCheck size={11} />}
      {label[role]}
    </span>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span
        aria-hidden
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          active ? "bg-success" : "bg-muted-foreground/50"
        )}
      />
      <span className={active ? "text-foreground" : "text-muted-foreground"}>
        {active ? "Active" : "Inactive"}
      </span>
    </span>
  );
}

/** Accessible on/off switch built on a role="switch" button. */
function Switch({
  checked,
  onChange,
  disabled,
  focusableWhenDisabled,
  label,
  describedBy,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  /**
   * Keep a disabled switch in the Tab order (aria-disabled instead of the
   * native attribute), so its described reason can still be reached.
   */
  focusableWhenDisabled?: boolean;
  label: string;
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled && !focusableWhenDisabled}
      aria-disabled={disabled || undefined}
      onClick={() => !disabled && onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
        checked ? "bg-accent" : "bg-surface-sunken",
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white shadow-soft transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

/** Small status pill used on permission rows. */
function Pill({ tone, children }: { tone: "warning" | "accent"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-[18px] shrink-0 items-center rounded-full border px-1.5 text-[11px] font-medium leading-none",
        tone === "warning"
          ? "border-warning/30 bg-warning/10 text-warning"
          : "border-accent/25 bg-accent-soft text-accent-strong"
      )}
    >
      {children}
    </span>
  );
}

const inputClass =
  "h-9 w-full rounded-xl border border-border bg-surface px-3 text-sm outline-none transition-colors placeholder:text-subtle-foreground focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60";

/** Dense toolbar filter controls (search + selects above the table): 32px. */
const filterClass = "h-8 text-[13px]";

const labelClass = "block text-xs font-medium text-muted-foreground";
const hintClass = "text-xs text-muted-foreground";
const linkButtonClass =
  "rounded-md px-1.5 text-xs font-medium text-accent-strong hover:underline disabled:pointer-events-none disabled:opacity-40";

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export function UsersClient({ initial }: { initial: AdminUsersPayload }) {
  const [data, setData] = useState<AdminUsersPayload>(initial);
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | ProfileRole>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Re-pull the list from the API after any mutation so usage / team names /
  // ordering all reconcile against the server (the single source of truth).
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      if (res.ok) setData((await res.json()) as AdminUsersPayload);
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Retry the Brain after a fallback: force a fresh manifest server-side, then
  // reload the payload so every user's permissions resolve against it.
  const retryManifest = useCallback(async () => {
    await fetch("/api/admin/capabilities?refresh=1", { cache: "no-store" }).catch(() => undefined);
    await refresh();
  }, [refresh]);

  // Auto-dismiss the success notice.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const onSaved = useCallback(
    async (message: string) => {
      setCreating(false);
      setEditing(null);
      setNotice(message);
      await refresh();
    },
    [refresh]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.users.filter((u) => {
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (statusFilter === "active" && !u.isActive) return false;
      if (statusFilter === "inactive" && u.isActive) return false;
      if (!needle) return true;
      return (
        (u.email ?? "").toLowerCase().includes(needle) ||
        (u.displayName ?? "").toLowerCase().includes(needle) ||
        (u.team?.name ?? "").toLowerCase().includes(needle)
      );
    });
  }, [data.users, q, roleFilter, statusFilter]);

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">Users</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Manage accounts, roles, and what each person can access.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setCreating(true)}
          className="h-8 shrink-0 self-start text-[13px] sm:self-auto"
        >
          <UserPlus size={14} />
          Add user
        </Button>
      </div>

      {/* Success notice */}
      {notice && (
        <div
          role="status"
          className="mt-4 flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 px-3.5 py-2.5 text-[13px] text-foreground"
        >
          <Check size={14} className="shrink-0 text-success" />
          {notice}
        </div>
      )}

      {/* Toolbar */}
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, email, or team…"
            aria-label="Search users"
            className={cn(inputClass, filterClass, "pl-8")}
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as typeof roleFilter)}
          aria-label="Filter by role"
          className={cn(inputClass, filterClass, "sm:w-40")}
        >
          <option value="all">All roles</option>
          <option value="user">Users</option>
          <option value="admin">Admins</option>
          <option value="super_admin">Super admins</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          aria-label="Filter by status"
          className={cn(inputClass, filterClass, "sm:w-36")}
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* Table */}
      <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-surface shadow-soft">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-border text-xs font-medium text-muted-foreground">
                <th scope="col" className="px-4 py-2 font-medium">User</th>
                <th scope="col" className="px-4 py-2 font-medium">Role</th>
                <th scope="col" className="px-4 py-2 font-medium">Status</th>
                <th scope="col" className="px-4 py-2 font-medium">Team</th>
                <th scope="col" className="px-4 py-2 font-medium">Access</th>
                <th scope="col" className="px-4 py-2 font-medium">Usage</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  manifest={data.manifest}
                  isCurrent={u.id === data.currentUserId}
                  onEdit={() => setEditing(u)}
                />
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-5">
                    <div className="flex flex-col items-center gap-2.5 text-center">
                      <span
                        aria-hidden
                        className="grid h-10 w-10 place-items-center rounded-full bg-accent-soft text-accent"
                      >
                        <Search size={16} />
                      </span>
                      <p className="text-[13px] text-muted-foreground">No users match your filters.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footnotes */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          {filtered.length} of {data.users.length} user{data.users.length === 1 ? "" : "s"}
        </span>
        {refreshing && (
          <span className="inline-flex items-center gap-1">
            <Loader2 size={12} className="animate-spin" /> Refreshing…
          </span>
        )}
        {data.usagePartial && (
          <span>Usage totals are a recent estimate and may be a lower bound.</span>
        )}
      </div>

      {/* Create */}
      {creating && (
        <UserEditor
          mode="create"
          data={data}
          onClose={() => setCreating(false)}
          onSaved={onSaved}
          onRetryManifest={retryManifest}
        />
      )}

      {/* Edit */}
      {editing && (
        <UserEditor
          mode="edit"
          data={data}
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
          onRetryManifest={retryManifest}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table row
// ---------------------------------------------------------------------------

function UserRow({
  user,
  manifest,
  isCurrent,
  onEdit,
}: {
  user: AdminUser;
  manifest: ResolvedCapabilityManifest;
  isCurrent: boolean;
  onEdit: () => void;
}) {
  const initial = (user.displayName || user.email || "?").charAt(0).toUpperCase();
  const lastActive = user.usage?.lastUsedAt ?? user.lastSignInAt;

  return (
    <tr className="border-b border-border transition-colors last:border-0 hover:bg-surface-muted/60">
      {/* User */}
      <td className="px-4 py-2">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-gradient text-[11px] font-semibold text-white"
          >
            {initial}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium">
                {user.displayName || user.email || "Unknown"}
              </span>
              {isCurrent && (
                <span className="shrink-0 rounded-full bg-surface-muted px-1.5 py-px text-[11px] font-medium text-muted-foreground">
                  You
                </span>
              )}
            </div>
            {user.displayName && (
              <div className="truncate text-xs text-muted-foreground">{user.email}</div>
            )}
          </div>
        </div>
      </td>

      {/* Role */}
      <td className="px-4 py-2">
        <RoleBadge role={user.role} />
      </td>

      {/* Status */}
      <td className="px-4 py-2">
        <StatusPill active={user.isActive} />
      </td>

      {/* Team */}
      <td className="px-4 py-2">
        {user.team ? (
          <span>{user.team.name}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>

      {/* Access */}
      <td className="px-4 py-2">
        <div>{modelSummary(user)}</div>
        <div className="text-xs text-muted-foreground">{accessSummary(user, manifest)}</div>
      </td>

      {/* Usage */}
      <td className="px-4 py-2">
        {user.usage ? (
          <div>
            <div>
              {formatTokens(user.usage.totalTokens)} tok ·{" "}
              <span className="text-muted-foreground">{formatUsd(user.usage.costUsd)}</span>
            </div>
            <div className="text-xs text-muted-foreground">{relativeTime(lastActive)}</div>
          </div>
        ) : (
          <div>
            <div className="text-muted-foreground">No usage</div>
            <div className="text-xs text-muted-foreground">{relativeTime(lastActive)}</div>
          </div>
        )}
      </td>

      {/* Actions */}
      <td className="px-4 py-2 text-right">
        <Button variant="secondary" size="sm" onClick={onEdit}>
          <Pencil size={14} />
          Edit
        </Button>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Create / Edit editor
// ---------------------------------------------------------------------------

function UserEditor({
  mode,
  data,
  user,
  onClose,
  onSaved,
  onRetryManifest,
}: {
  mode: "create" | "edit";
  data: AdminUsersPayload;
  user?: AdminUser;
  onClose: () => void;
  onSaved: (message: string) => void;
  onRetryManifest: () => Promise<void>;
}) {
  const isEdit = mode === "edit";
  const isSelf = isEdit && user?.id === data.currentUserId;
  const canGrantSuper = data.currentUserRole === "super_admin";
  const manifest = data.manifest;

  // A plain admin may not modify a super_admin — mirror the server guard so the
  // controls read as read-only rather than failing on save.
  const locked = isEdit && user?.role === "super_admin" && !canGrantSuper;

  // Form state
  const [email, setEmail] = useState(user?.email ?? "");
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [role, setRole] = useState<ProfileRole>(user?.role ?? "user");
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const [teamId, setTeamId] = useState<string>(user?.team?.id ?? "");
  const [modelMode, setModelMode] = useState<"all" | "some">(
    user && !user.canUseAllModels && (user.permissions.models?.length ?? 0) > 0 ? "some" : "all"
  );
  const [models, setModels] = useState<string[]>(user?.permissions.models ?? []);

  // Grant-what-you-have: a plain admin can only switch ON what they hold
  // themselves, or what an existing user already had (they may keep or remove
  // that, not re-grant it once removed). The server enforces the same rule; a
  // new user holds nothing yet.
  const actorCaps = useMemo(() => new Set(data.actorCapabilities), [data.actorCapabilities]);
  const [initialCaps] = useState<string[]>(() =>
    user
      ? user.capabilities
      : closeGrantSet(
          presetCapabilities(presetForRole("user"), manifest).filter((id) => canGrantSuper || actorCaps.has(id)),
          manifest
        )
  );
  const [caps, setCaps] = useState<string[]>(initialCaps);
  const heldBefore = useMemo(() => new Set(user ? initialCaps : []), [user, initialCaps]);
  const canEnable = useCallback(
    (id: string) => canGrantSuper || actorCaps.has(id) || heldBefore.has(id),
    [canGrantSuper, actorCaps, heldBefore]
  );

  // Create-only credential choice
  const [credMode, setCredMode] = useState<"password" | "invite">("password");
  const [password, setPassword] = useState("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // A retried manifest may bring capabilities this editor hasn't seen: give each
  // its resolved value for this user (edit) or the role preset's (create).
  const knownIds = useRef(new Set(manifest.capabilities.map((c) => c.id)));
  useEffect(() => {
    const fresh = manifest.capabilities.map((c) => c.id).filter((id) => !knownIds.current.has(id));
    if (fresh.length === 0) return;
    knownIds.current = new Set(manifest.capabilities.map((c) => c.id));
    const baseline = new Set(
      user
        ? data.users.find((u) => u.id === user.id)?.capabilities ?? []
        : presetCapabilities(presetForRole(role), manifest).filter(canEnable)
    );
    const add = fresh.filter((id) => baseline.has(id));
    if (add.length) setCaps((prev) => closeGrantSet([...prev, ...add], manifest));
  }, [manifest, data.users, user, role, canEnable]);

  const isSuperTarget = role === "super_admin";
  const allIds = useMemo(() => manifest.capabilities.map((c) => c.id), [manifest]);
  const shownCaps = isSuperTarget ? allIds : caps;

  const toggleModel = (id: string) =>
    setModels((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  function changeRole(next: ProfileRole) {
    // Untouched switches follow the role's preset; hand-edited ones stay.
    const presetFor = (r: ProfileRole) =>
      closeGrantSet(presetCapabilities(presetForRole(r), manifest).filter(canEnable), manifest);
    if (!isSuperTarget && next !== "super_admin" && sameSet(caps, presetFor(role))) {
      setCaps(presetFor(next));
    }
    setRole(next);
  }

  const buildPermissions = (): PermissionsShape & { offered: string[] } => {
    // `offered`: the ids this editor rendered — the server decides only those
    // (a fallback-manifest render must not deny the live-only capabilities).
    const p: PermissionsShape & { offered: string[] } = {
      capabilities: closeGrantSet(shownCaps, manifest),
      offered: allIds,
    };
    if (modelMode === "some" && models.length) p.models = models;
    return p;
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    if (mode === "create") {
      if (!email.trim()) return setErr("An email address is required.");
      if (credMode === "password" && password.length < 8) {
        return setErr("Set an initial password of at least 8 characters, or switch to an invite.");
      }
    }
    const tierIds = Object.values(TIER_CAPABILITY).filter((id) => allIds.includes(id));
    if (tierIds.length && !tierIds.some((id) => shownCaps.includes(id))) {
      return setErr("Turn on at least one model tier.");
    }
    if (modelMode === "some" && models.length === 0) {
      return setErr("Pick at least one model, or choose “All models”.");
    }

    setBusy(true);
    try {
      if (mode === "create") {
        const res = await fetch("/api/admin/users", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: email.trim(),
            displayName: displayName.trim() || undefined,
            role,
            teamId: teamId || null,
            mode: credMode,
            password: credMode === "password" ? password : undefined,
            permissions: buildPermissions(),
            canUseAllModels: false,
            isActive,
          }),
        });
        if (!res.ok) return setErr(await readError(res));
        const body = await res.json().catch(() => ({}));
        onSaved(
          body?.invited
            ? `Invitation sent to ${email.trim()}.`
            : `${email.trim()} was added.`
        );
      } else if (user) {
        const res = await fetch(`/api/admin/users/${user.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            displayName: displayName.trim() || null,
            role,
            isActive,
            teamId: teamId || null,
            permissions: buildPermissions(),
            // The editor has no "full access" switch: leave a stored
            // can_use_all_models as it is unless the admin restricts to
            // "Only selected" (a true flag would override that allowlist).
            ...(modelMode === "some" ? { canUseAllModels: false } : {}),
          }),
        });
        if (!res.ok) return setErr(await readError(res));
        onSaved(`Changes saved for ${user.email ?? "user"}.`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!user) return;
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}?hard=true`, { method: "DELETE" });
      if (!res.ok) return setErr(await readError(res));
      onSaved(`${user.email ?? "User"} was permanently deleted.`);
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || locked;
  const onCount = shownCaps.length;
  const sensitiveOn = manifest.capabilities.filter((c) => c.sensitive && shownCaps.includes(c.id)).length;

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === "create" ? "Add user" : "Edit user"}
      className="max-w-3xl"
    >
      <form onSubmit={submit} className="flex flex-col">
        <div className="-mx-5 max-h-[min(72vh,calc(100dvh_-_11rem))] space-y-5 overflow-y-auto px-5 pb-4">
          {locked && (
            <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground">
              <AlertTriangle size={14} className="mt-px shrink-0 text-warning" />
              This is a super admin account. Only another super admin can change it.
            </p>
          )}

          {/* --- Identity --- */}
          <section className="space-y-3.5">
            {mode === "create" ? (
              <div className="space-y-1.5">
                <label htmlFor="ue-email" className={labelClass}>
                  Email
                </label>
                <input
                  id="ue-email"
                  type="email"
                  required
                  autoComplete="off"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <span className={labelClass}>Email</span>
                <div className="flex h-9 items-center rounded-xl border border-border bg-surface-muted px-3 text-sm text-muted-foreground">
                  {user?.email ?? "—"}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="ue-name" className={labelClass}>
                Display name
              </label>
              <input
                id="ue-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Optional"
                disabled={disabled}
                className={inputClass}
              />
            </div>

            {/* Credentials (create only) */}
            {mode === "create" && (
              <fieldset className="space-y-2">
                <legend className={labelClass}>How should they sign in?</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-[13px] transition-colors",
                      credMode === "password"
                        ? "border-accent bg-accent-softer"
                        : "border-border hover:bg-surface-muted"
                    )}
                  >
                    <input
                      type="radio"
                      name="credMode"
                      checked={credMode === "password"}
                      onChange={() => setCredMode("password")}
                      className="mt-0.5 accent-accent"
                    />
                    <span>
                      <span className="font-medium">Set a password</span>
                      <span className="block text-xs text-muted-foreground">
                        You choose an initial password.
                      </span>
                    </span>
                  </label>
                  <label
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-[13px] transition-colors",
                      credMode === "invite"
                        ? "border-accent bg-accent-softer"
                        : "border-border hover:bg-surface-muted"
                    )}
                  >
                    <input
                      type="radio"
                      name="credMode"
                      checked={credMode === "invite"}
                      onChange={() => setCredMode("invite")}
                      className="mt-0.5 accent-accent"
                    />
                    <span>
                      <span className="font-medium">Send an invite</span>
                      <span className="block text-xs text-muted-foreground">
                        They set their own password by email.
                      </span>
                    </span>
                  </label>
                </div>
                {credMode === "password" && (
                  <div className="space-y-1.5 pt-1">
                    <label htmlFor="ue-pass" className={labelClass}>
                      Initial password
                    </label>
                    <input
                      id="ue-pass"
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={inputClass}
                    />
                    <p className={hintClass}>At least 8 characters.</p>
                  </div>
                )}
              </fieldset>
            )}
          </section>

          {/* --- Role, status, team --- */}
          <section className="grid gap-3.5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="ue-role" className={labelClass}>
                Role
              </label>
              <select
                id="ue-role"
                value={role}
                onChange={(e) => changeRole(e.target.value as ProfileRole)}
                disabled={disabled || isSelf}
                className={inputClass}
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
                <option value="super_admin" disabled={!canGrantSuper}>
                  Super admin{!canGrantSuper ? " (super admin only)" : ""}
                </option>
              </select>
              <p className={hintClass}>
                {isSelf
                  ? "You can't change your own role."
                  : "Admins manage users; super admins can grant the super admin role."}
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="ue-team" className={labelClass}>
                Team
              </label>
              <select
                id="ue-team"
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                disabled={disabled}
                className={inputClass}
              >
                <option value="">No team</option>
                {data.teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-xl border border-border px-3 py-2.5 sm:col-span-2">
              <div>
                <div className="text-[13px] font-medium">Account active</div>
                <p className={hintClass}>
                  {isSelf
                    ? "You can't deactivate your own account."
                    : "Inactive users can't sign in or use the app."}
                </p>
              </div>
              <Switch
                checked={isActive}
                onChange={setIsActive}
                disabled={disabled || isSelf}
                label="Account active"
              />
            </div>
          </section>

          {/* --- Permissions (from the Brain's capability manifest) --- */}
          <PermissionsPanel
            manifest={manifest}
            caps={shownCaps}
            setCaps={setCaps}
            canEnable={canEnable}
            disabled={disabled || isSuperTarget}
            superTarget={isSuperTarget}
            onRetryManifest={onRetryManifest}
            modelAccess={
              <ModelAllowlist
                models={data.models}
                mode={modelMode}
                setMode={setModelMode}
                selected={models}
                toggle={toggleModel}
                setSelected={setModels}
                disabled={disabled}
              />
            }
          />

          {/* --- Danger zone (super admin, editing someone else) --- */}
          {isEdit && canGrantSuper && !isSelf && (
            <section className="space-y-2.5 rounded-2xl border border-danger/30 bg-danger/5 p-4">
              <h3 className="text-sm font-semibold text-danger">Danger zone</h3>
              <p className={hintClass}>
                To temporarily disable access, turn off “Account active” above. Deleting is
                permanent and removes the account and its history.
              </p>
              {confirmDelete ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px]">Permanently delete this user?</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    onClick={remove}
                    disabled={busy}
                  >
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    Yes, delete
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmDelete(false)}
                    disabled={busy}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setConfirmDelete(true)}
                  className="border-danger/30 text-danger hover:bg-danger/10"
                >
                  <Trash2 size={14} />
                  Delete permanently
                </Button>
              )}
            </section>
          )}

          {err && (
            <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
              {err}
            </p>
          )}
        </div>

        {/* Footer — outside the scroll area, so it stays in view */}
        <div className="-mx-5 -mb-5 flex items-center justify-between gap-3 rounded-b-2xl border-t border-border bg-surface px-5 py-3">
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {onCount} of {allIds.length} permissions on{sensitiveOn ? ` · ${sensitiveOn} sensitive` : ""}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy} className="h-8 text-[13px]">
              Cancel
            </Button>
            <Button type="submit" disabled={disabled} className="h-8 text-[13px]">
              {busy ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  {mode === "create" ? <Plus size={14} /> : <Check size={14} />}
                  {mode === "create" ? "Create user" : "Save changes"}
                </>
              )}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Permissions panel: presets, sync note, filter, grouped switches
// ---------------------------------------------------------------------------

function PermissionsPanel({
  manifest,
  caps,
  setCaps,
  canEnable,
  disabled,
  superTarget,
  onRetryManifest,
  modelAccess,
}: {
  manifest: ResolvedCapabilityManifest;
  caps: string[];
  setCaps: (next: string[]) => void;
  canEnable: (id: string) => boolean;
  disabled: boolean;
  superTarget: boolean;
  onRetryManifest: () => Promise<void>;
  modelAccess: React.ReactNode;
}) {
  const [filter, setFilter] = useState("");
  const on = useMemo(() => new Set(caps), [caps]);
  const byId = useMemo(() => new Map(manifest.capabilities.map((c) => [c.id, c])), [manifest]);

  // A capability can be switched on when it and every prerequisite it would
  // pull in are grantable (or already on).
  const enableBlocked = useCallback(
    (id: string) => [id, ...prerequisitesOf(id, manifest)].some((x) => !on.has(x) && !canEnable(x)),
    [manifest, on, canEnable]
  );

  // Presets only fill switches the actor may grant (a plain admin's own set).
  const presets = useMemo(
    () =>
      CAPABILITY_PRESETS.map((p) => ({
        ...p,
        ids: closeGrantSet(presetCapabilities(p.id, manifest).filter(canEnable), manifest),
      })),
    [manifest, canEnable]
  );
  const activePreset: CapabilityPresetId | null = presets.find((p) => sameSet(p.ids, caps))?.id ?? null;

  const needle = filter.trim().toLowerCase();
  const matches = (c: Capability) =>
    !needle ||
    c.label.toLowerCase().includes(needle) ||
    c.description.toLowerCase().includes(needle) ||
    c.id.includes(needle) ||
    (c.sensitive === true && "sensitive".includes(needle));

  const groups = manifest.groups
    .map((g) => ({ group: g, items: manifest.capabilities.filter((c) => c.group === g.id && matches(c)) }))
    .filter((g) => g.items.length > 0 || (g.group.id === "models" && !needle));

  function setGroup(ids: string[], value: boolean) {
    let next = caps;
    for (const id of ids) {
      if (value && (on.has(id) || enableBlocked(id))) continue;
      if (!value && !next.includes(id)) continue;
      next = toggleCapability(next, id, value, manifest);
    }
    setCaps(next);
  }

  const hasModelsGroup = manifest.groups.some((g) => g.id === "models");

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Permissions</h3>
          <p className={hintClass}>What this person can use. Sensitive items expose call data or private executive context.</p>
        </div>
        <SyncNote manifest={manifest} onRetry={onRetryManifest} />
      </div>

      {superTarget ? (
        <p className="flex items-start gap-2 rounded-xl border border-border bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
          <ShieldCheck size={14} className="mt-px shrink-0 text-accent" />
          Super admins always have every permission.
        </p>
      ) : (
        <div className="space-y-2">
          <div role="group" aria-label="Role presets" className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-medium text-muted-foreground">Start from</span>
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                title={p.description}
                aria-pressed={activePreset === p.id}
                disabled={disabled}
                onClick={() => setCaps(p.ids)}
                className={cn(
                  "inline-flex h-8 items-center rounded-full border px-3 text-[13px] font-medium transition-colors",
                  activePreset === p.id
                    ? "border-accent/30 bg-accent-soft text-accent-strong"
                    : "border-border bg-surface text-muted-foreground hover:bg-surface-muted hover:text-foreground",
                  "disabled:cursor-not-allowed disabled:opacity-60"
                )}
              >
                {p.label}
              </button>
            ))}
            {!activePreset && <span className="ml-1 text-xs text-muted-foreground">Custom</span>}
          </div>
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter permissions…"
              aria-label="Filter permissions"
              className={cn(inputClass, "h-8 pl-8 text-[13px]")}
            />
          </div>
        </div>
      )}

      {groups.map(({ group, items }) => {
        const all = manifest.capabilities.filter((c) => c.group === group.id);
        const onInGroup = all.filter((c) => on.has(c.id)).length;
        return (
          <div key={group.id} className="overflow-hidden rounded-2xl border border-border bg-surface">
            <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-muted/60 px-3 py-1.5">
              <div className="flex min-w-0 items-baseline gap-2">
                <h4 className="truncate text-[13px] font-semibold">{group.label}</h4>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {onInGroup}/{all.length}
                </span>
              </div>
              {!disabled && all.length > 0 && (
                <div className="flex shrink-0 items-center">
                  <button type="button" className={linkButtonClass} onClick={() => setGroup(all.map((c) => c.id), true)}>
                    All
                  </button>
                  <span aria-hidden className="text-xs text-subtle-foreground">/</span>
                  <button type="button" className={linkButtonClass} onClick={() => setGroup(all.map((c) => c.id), false)}>
                    None
                  </button>
                </div>
              )}
            </div>
            {items.length > 0 && (
              <div className="grid gap-x-2 p-1.5 sm:grid-cols-2">
                {items.map((c, i) => {
                  const sectionStart = c.section && c.section !== items[i - 1]?.section;
                  const checked = on.has(c.id);
                  const blocked = !checked && enableBlocked(c.id);
                  const missing = checked ? [] : (c.requires ?? []).filter((r) => !on.has(r));
                  const dependents = checked ? dependentsOf(c.id, manifest).filter((d) => on.has(d)) : [];
                  return (
                    <CapabilityRowWithSection key={c.id} section={sectionStart ? c.section : undefined}>
                      <CapabilityRow
                        cap={c}
                        checked={checked}
                        disabled={disabled || blocked}
                        blockedReason={blocked ? "You can only grant permissions you have yourself." : undefined}
                        hint={
                          missing.length
                            ? `Also turns on ${missing.map((r) => byId.get(r)?.label ?? r).join(", ")}`
                            : dependents.length
                              ? `Turning off also turns off ${dependents.length === 1 ? byId.get(dependents[0])?.label ?? dependents[0] : `${dependents.length} others`}`
                              : undefined
                        }
                        onChange={(v) => setCaps(toggleCapability(caps, c.id, v, manifest))}
                      />
                    </CapabilityRowWithSection>
                  );
                })}
              </div>
            )}
            {group.id === "models" && !needle && modelAccess}
          </div>
        );
      })}

      {!hasModelsGroup && !needle && (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">{modelAccess}</div>
      )}

      {needle && groups.length === 0 && (
        <p className="px-1 text-[13px] text-muted-foreground">No permissions match “{filter.trim()}”.</p>
      )}
    </section>
  );
}

/** Renders an optional full-width sub-heading before a row (work-mode families). */
function CapabilityRowWithSection({ section, children }: { section?: string; children: React.ReactNode }) {
  return (
    <>
      {section && (
        <div className="px-2.5 pb-0.5 pt-2 text-[11px] font-semibold text-muted-foreground sm:col-span-2">{section}</div>
      )}
      {children}
    </>
  );
}

function CapabilityRow({
  cap,
  checked,
  disabled,
  blockedReason,
  hint,
  onChange,
}: {
  cap: Capability;
  checked: boolean;
  disabled: boolean;
  blockedReason?: string;
  hint?: string;
  onChange: (v: boolean) => void;
}) {
  const baseId = `cap-${cap.id.replace(/[^a-z0-9]/gi, "-")}`;
  const descId = `${baseId}-desc`;
  const hintId = `${baseId}-hint`;
  const reasonId = `${baseId}-reason`;
  // Everything a sighted admin sees on the row reaches the switch's name /
  // description: the Sensitive / New pills, the dependency hint, and why a
  // switch is blocked (a hover title alone never reaches assistive tech).
  const describedBy = [descId, hint && hintId, blockedReason && reasonId].filter(Boolean).join(" ");
  const srLabel = cap.label + (cap.sensitive ? " (sensitive)" : "") + (isRecent(cap.since) ? " (new)" : "");
  return (
    <label
      title={blockedReason}
      className={cn(
        "flex min-h-[52px] items-center gap-3 rounded-xl px-2.5 py-1.5 transition-colors",
        disabled ? "cursor-not-allowed" : "cursor-pointer hover:bg-surface-muted"
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={cn("truncate text-[13px] font-medium", disabled && !checked && "text-muted-foreground")}>
            {cap.label}
          </span>
          {cap.sensitive && <Pill tone="warning">Sensitive</Pill>}
          {isRecent(cap.since) && <Pill tone="accent">New</Pill>}
        </span>
        {/* Wraps to two lines (not truncated): readable on touch, where a hover title isn't. */}
        <span id={descId} className="line-clamp-2 text-xs text-muted-foreground" title={cap.description}>
          {cap.description}
        </span>
        {hint && (
          <span id={hintId} className="line-clamp-2 text-[11px] text-subtle-foreground">
            {hint}
          </span>
        )}
        {blockedReason && (
          <span id={reasonId} className="sr-only">
            {blockedReason}
          </span>
        )}
      </span>
      <Switch
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        focusableWhenDisabled={!!blockedReason}
        label={srLabel}
        describedBy={describedBy}
      />
    </label>
  );
}

/** "Synced with Brain · vN" or the fallback warning with a retry. */
function SyncNote({ manifest, onRetry }: { manifest: ResolvedCapabilityManifest; onRetry: () => Promise<void> }) {
  const [retrying, setRetrying] = useState(false);
  if (manifest.source === "brain") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={`Fetched ${manifest.fetchedAt}`}>
        <CheckCircle2 size={12} className="text-success" />
        Synced with Brain · v{manifest.version}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-warning" title={manifest.reason}>
      <AlertTriangle size={12} />
      {manifest.reason === "demo mode" ? "Demo mode — showing built-in list" : "Brain unreachable — showing built-in list"}
      <button
        type="button"
        disabled={retrying}
        onClick={async () => {
          setRetrying(true);
          try {
            await onRetry();
          } finally {
            setRetrying(false);
          }
        }}
        className="inline-flex items-center gap-1 rounded-md px-1 font-medium text-accent-strong hover:underline disabled:opacity-50"
      >
        <RefreshCw size={11} className={cn(retrying && "animate-spin")} />
        Retry
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Model allowlist (the Brain's model catalog)
// ---------------------------------------------------------------------------

function ModelAllowlist({
  models,
  mode,
  setMode,
  selected,
  toggle,
  setSelected,
  disabled,
}: {
  models: AdminModelOption[];
  mode: "all" | "some";
  setMode: (m: "all" | "some") => void;
  selected: string[];
  toggle: (id: string) => void;
  setSelected: (fn: (prev: string[]) => string[]) => void;
  disabled: boolean;
}) {
  // Group the model catalog by provider for the checklist.
  const grouped = useMemo(() => {
    const map = new Map<string, AdminModelOption[]>();
    for (const m of models) {
      const arr = map.get(m.provider) ?? [];
      arr.push(m);
      map.set(m.provider, arr);
    }
    const order = (p: string) =>
      p.toLowerCase() === "anthropic" ? 0 : p.toLowerCase() === "openai" ? 1 : 2;
    return [...map.entries()].sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]));
  }, [models]);

  return (
    <div className="space-y-2 border-t border-border px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[13px] font-medium">Specific models</div>
          <p className={hintClass}>Within the tiers above, which of the Brain&apos;s models this person can pick.</p>
        </div>
        <div
          role="radiogroup"
          aria-label="Model access"
          onKeyDown={onRadioGroupKeyDown}
          className="inline-flex shrink-0 rounded-full border border-border bg-surface-muted p-0.5"
        >
          {(["all", "some"] as const).map((m, i) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              tabIndex={radioTabIndex(mode === m, i, true)}
              disabled={disabled}
              onClick={() => setMode(m)}
              className={cn(
                "h-7 rounded-full px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                mode === m ? "bg-surface text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {m === "all" ? "All models" : "Only selected"}
            </button>
          ))}
        </div>
      </div>

      {mode === "some" && (
        <div className="space-y-2.5">
          {grouped.map(([provider, list]) => {
            const ids = list.map((m) => m.id);
            const allOn = ids.every((id) => selected.includes(id));
            return (
              <div key={provider}>
                <div className="mb-0.5 flex h-6 items-center justify-between">
                  <span className="px-1 text-[11px] font-semibold text-muted-foreground">
                    {providerLabel(provider)}
                  </span>
                  <button
                    type="button"
                    className={linkButtonClass}
                    disabled={disabled}
                    onClick={() =>
                      setSelected((prev) =>
                        allOn ? prev.filter((id) => !ids.includes(id)) : [...new Set([...prev, ...ids])]
                      )
                    }
                  >
                    {allOn ? "Clear" : "Select all"}
                  </button>
                </div>
                <div className="grid gap-0.5 sm:grid-cols-2 sm:gap-x-1.5">
                  {list.map((m) => (
                    <label
                      key={m.id}
                      className="flex h-8 items-center gap-2 rounded-lg px-1 text-[13px] transition-colors hover:bg-surface-muted"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0 rounded border-border accent-accent"
                        checked={selected.includes(m.id)}
                        onChange={() => toggle(m.id)}
                        disabled={disabled}
                      />
                      <span className="truncate">{m.label}</span>
                      {m.tier && (
                        <span className="ml-auto shrink-0 rounded-full bg-surface-muted px-1.5 py-px text-[11px] font-medium capitalize text-muted-foreground">
                          {m.tier}
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
