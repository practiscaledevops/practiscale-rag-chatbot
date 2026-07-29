"use client";

// Admin › Users — client surface. Renders the fleet table and the create/edit
// editor with layman-friendly access controls (role, activation, team, model
// access, features, tiers). All authority lives server-side: this component only
// reads/writes through the admin API, which re-checks the caller's role and
// enforces every guardrail (see /api/admin/users). Reference data (teams, model
// catalog, feature keys, tiers, and the current admin's role) arrives in the
// initial payload.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  UserPlus,
  Users as UsersIcon,
  Pencil,
  Trash2,
  AlertTriangle,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import type { ProfileRole } from "@/lib/admin";
import type {
  AdminUsersPayload,
  AdminUser,
  AdminModelOption,
  AdminFeature,
  PermissionsShape,
} from "@/app/api/admin/users/route";

type Tier = "fast" | "recommended" | "max";

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

// ---------------------------------------------------------------------------
// Presentational atoms
// ---------------------------------------------------------------------------

function RoleBadge({ role }: { role: ProfileRole }) {
  const styles: Record<ProfileRole, string> = {
    user: "bg-surface-muted text-muted-foreground",
    admin: "bg-accent/10 text-accent",
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
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
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
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
        checked ? "bg-accent" : "bg-neutral-300 dark:bg-neutral-700",
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60";

const labelClass = "block text-sm font-medium";
const hintClass = "text-xs text-muted-foreground";

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
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <UsersIcon size={20} className="text-accent" />
            Users
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage accounts, roles, and what each person can access.
          </p>
        </div>
        <Button
          onClick={() => setCreating(true)}
          className="bg-accent text-accent-foreground hover:bg-accent-hover dark:bg-accent dark:text-accent-foreground dark:hover:bg-accent-hover"
        >
          <UserPlus size={16} />
          Add user
        </Button>
      </div>

      {/* Success notice */}
      {notice && (
        <div
          role="status"
          className="mt-4 flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-foreground"
        >
          <Check size={15} className="text-success" />
          {notice}
        </div>
      )}

      {/* Toolbar */}
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, email, or team…"
            aria-label="Search users"
            className={cn(inputClass, "pl-9")}
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as typeof roleFilter)}
          aria-label="Filter by role"
          className={cn(inputClass, "sm:w-44")}
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
          className={cn(inputClass, "sm:w-40")}
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* Table */}
      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface shadow-soft">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-4 py-3 font-medium">User</th>
                <th scope="col" className="px-4 py-3 font-medium">Role</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 font-medium">Team</th>
                <th scope="col" className="px-4 py-3 font-medium">Access</th>
                <th scope="col" className="px-4 py-3 font-medium">Usage</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  isCurrent={u.id === data.currentUserId}
                  onEdit={() => setEditing(u)}
                />
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    No users match your filters.
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
  isCurrent,
  onEdit,
}: {
  user: AdminUser;
  isCurrent: boolean;
  onEdit: () => void;
}) {
  const initial = (user.displayName || user.email || "?").charAt(0).toUpperCase();
  const featureCount = user.permissions.features?.length ?? 0;
  const tierList = user.permissions.allowed_tiers ?? [];
  const lastActive = user.usage?.lastUsedAt ?? user.lastSignInAt;

  return (
    <tr className="border-b border-border last:border-0 hover:bg-surface-muted/60">
      {/* User */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-gradient text-xs font-semibold text-white"
          >
            {initial}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">
                {user.displayName || user.email || "Unknown"}
              </span>
              {isCurrent && (
                <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
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
      <td className="px-4 py-3">
        <RoleBadge role={user.role} />
      </td>

      {/* Status */}
      <td className="px-4 py-3">
        <StatusPill active={user.isActive} />
      </td>

      {/* Team */}
      <td className="px-4 py-3">
        {user.team ? (
          <span className="text-sm">{user.team.name}</span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </td>

      {/* Access */}
      <td className="px-4 py-3">
        <div className="text-sm">{modelSummary(user)}</div>
        <div className="text-xs text-muted-foreground">
          Features: {featureCount === 0 ? "all" : featureCount} · Tiers:{" "}
          {tierList.length === 0 ? "all" : tierList.join(", ")}
        </div>
      </td>

      {/* Usage */}
      <td className="px-4 py-3">
        {user.usage ? (
          <div>
            <div className="text-sm">
              {formatTokens(user.usage.totalTokens)} tok ·{" "}
              <span className="text-muted-foreground">{formatUsd(user.usage.costUsd)}</span>
            </div>
            <div className="text-xs text-muted-foreground">{relativeTime(lastActive)}</div>
          </div>
        ) : (
          <div>
            <div className="text-sm text-muted-foreground">No usage</div>
            <div className="text-xs text-muted-foreground">{relativeTime(lastActive)}</div>
          </div>
        )}
      </td>

      {/* Actions */}
      <td className="px-4 py-3 text-right">
        <Button variant="secondary" size="sm" onClick={onEdit}>
          <Pencil size={13} />
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
}: {
  mode: "create" | "edit";
  data: AdminUsersPayload;
  user?: AdminUser;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isEdit = mode === "edit";
  const isSelf = isEdit && user?.id === data.currentUserId;
  const canGrantSuper = data.currentUserRole === "super_admin";

  // A plain admin may not modify a super_admin — mirror the server guard so the
  // controls read as read-only rather than failing on save.
  const locked = isEdit && user?.role === "super_admin" && !canGrantSuper;

  // Form state
  const [email, setEmail] = useState(user?.email ?? "");
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [role, setRole] = useState<ProfileRole>(user?.role ?? "user");
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const [teamId, setTeamId] = useState<string>(user?.team?.id ?? "");
  const [canAll, setCanAll] = useState(user?.canUseAllModels ?? false);
  const [models, setModels] = useState<string[]>(user?.permissions.models ?? []);
  const [features, setFeatures] = useState<string[]>(user?.permissions.features ?? []);
  const [tiers, setTiers] = useState<Tier[]>(user?.permissions.allowed_tiers ?? []);

  // Create-only credential choice
  const [credMode, setCredMode] = useState<"password" | "invite">("password");
  const [password, setPassword] = useState("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const toggle = <T,>(list: T[], set: (v: T[]) => void, value: T) =>
    set(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

  // Group the model catalog by provider for the checklist.
  const grouped = useMemo(() => {
    const map = new Map<string, AdminModelOption[]>();
    for (const m of data.models) {
      const arr = map.get(m.provider) ?? [];
      arr.push(m);
      map.set(m.provider, arr);
    }
    const order = (p: string) =>
      p.toLowerCase() === "anthropic" ? 0 : p.toLowerCase() === "openai" ? 1 : 2;
    return [...map.entries()].sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]));
  }, [data.models]);

  const buildPermissions = (): PermissionsShape => {
    const p: PermissionsShape = {};
    if (models.length) p.models = models;
    if (features.length) p.features = features;
    if (tiers.length) p.allowed_tiers = tiers;
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
            canUseAllModels: canAll,
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
            canUseAllModels: canAll,
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

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === "create" ? "Add user" : "Edit user"}
      className="max-w-2xl"
    >
      <form onSubmit={submit}>
        <div className="max-h-[65vh] space-y-6 overflow-y-auto pr-1">
          {locked && (
            <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground">
              <AlertTriangle size={14} className="mt-px shrink-0 text-warning" />
              This is a super admin account. Only another super admin can change it.
            </p>
          )}

          {/* --- Identity --- */}
          <section className="space-y-4">
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
                <div className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-muted-foreground">
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
                      "flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm transition-colors",
                      credMode === "password"
                        ? "border-accent bg-accent/5"
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
                      "flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm transition-colors",
                      credMode === "invite"
                        ? "border-accent bg-accent/5"
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
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="ue-role" className={labelClass}>
                Role
              </label>
              <select
                id="ue-role"
                value={role}
                onChange={(e) => setRole(e.target.value as ProfileRole)}
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

            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 sm:col-span-2">
              <div>
                <div className="text-sm font-medium">Account active</div>
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

          {/* --- Model access --- */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Model access</h3>
                <p className={hintClass}>Which AI models this person can choose.</p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <span>Full access</span>
                <Switch
                  checked={canAll}
                  onChange={setCanAll}
                  disabled={disabled}
                  label="Full model access"
                />
              </label>
            </div>

            <div
              className={cn(
                "rounded-lg border border-border p-3",
                canAll && "pointer-events-none opacity-50"
              )}
              aria-disabled={canAll}
            >
              {canAll ? (
                <p className="text-sm text-muted-foreground">
                  This user can select any model the Brain offers.
                </p>
              ) : (
                <div className="space-y-4">
                  {grouped.map(([provider, list]) => {
                    const ids = list.map((m) => m.id);
                    const allOn = ids.every((id) => models.includes(id));
                    return (
                      <div key={provider}>
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {providerLabel(provider)}
                          </span>
                          <button
                            type="button"
                            className="text-xs text-accent hover:underline"
                            onClick={() =>
                              setModels((prev) =>
                                allOn
                                  ? prev.filter((id) => !ids.includes(id))
                                  : [...new Set([...prev, ...ids])]
                              )
                            }
                          >
                            {allOn ? "Clear" : "Select all"}
                          </button>
                        </div>
                        <div className="grid gap-1.5 sm:grid-cols-2">
                          {list.map((m) => (
                            <label
                              key={m.id}
                              className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-surface-muted"
                            >
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-border accent-accent"
                                checked={models.includes(m.id)}
                                onChange={() => toggle(models, setModels, m.id)}
                              />
                              <span className="truncate">{m.label}</span>
                              {m.tier && (
                                <span className="ml-auto rounded bg-surface-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                                  {m.tier}
                                </span>
                              )}
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  <p className={hintClass}>
                    Tip: with none selected, no model restriction applies. Pick specific
                    models to limit this person to just those.
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* --- Features --- */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Features</h3>
            <div className="grid gap-1.5 rounded-lg border border-border p-3 sm:grid-cols-2">
              {data.features.map((f: AdminFeature) => (
                <label
                  key={f.key}
                  className="flex items-start gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-surface-muted"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-border accent-accent"
                    checked={features.includes(f.key)}
                    onChange={() => toggle(features, setFeatures, f.key)}
                    disabled={disabled}
                  />
                  <span>
                    <span className="font-medium">{f.label}</span>
                    <span className="block text-xs text-muted-foreground">{f.description}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className={hintClass}>If none are selected, no feature restriction applies.</p>
          </section>

          {/* --- Tiers --- */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Allowed speed tiers</h3>
            <div className="flex flex-wrap gap-2">
              {data.tiers.map((t) => {
                const on = tiers.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={on}
                    disabled={disabled}
                    onClick={() => toggle(tiers, setTiers, t)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-sm capitalize transition-colors",
                      on
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border text-muted-foreground hover:bg-surface-muted",
                      disabled && "cursor-not-allowed opacity-60"
                    )}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
            <p className={hintClass}>If none are selected, all tiers are allowed.</p>
          </section>

          {/* --- Danger zone (super admin, editing someone else) --- */}
          {isEdit && canGrantSuper && !isSelf && (
            <section className="space-y-2 rounded-lg border border-danger/30 bg-danger/5 p-3">
              <h3 className="text-sm font-semibold text-danger">Danger zone</h3>
              <p className={hintClass}>
                To temporarily disable access, turn off “Account active” above. Deleting is
                permanent and removes the account and its history.
              </p>
              {confirmDelete ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm">Permanently delete this user?</span>
                  <Button
                    type="button"
                    size="sm"
                    onClick={remove}
                    disabled={busy}
                    className="bg-danger text-white hover:bg-danger/90"
                  >
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
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
                  className="border-danger/40 text-danger hover:bg-danger/10"
                >
                  <Trash2 size={13} />
                  Delete permanently
                </Button>
              )}
            </section>
          )}

          {err && (
            <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
              {err}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="mt-5 flex items-center justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={disabled}
            className="bg-accent text-accent-foreground hover:bg-accent-hover dark:bg-accent dark:text-accent-foreground dark:hover:bg-accent-hover"
          >
            {busy ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                Saving…
              </>
            ) : (
              <>
                {mode === "create" ? <Plus size={15} /> : <Check size={15} />}
                {mode === "create" ? "Create user" : "Save changes"}
              </>
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
