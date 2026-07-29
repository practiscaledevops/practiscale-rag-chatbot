"use client";

// Client surface for /admin/teams. Lists every team with its member count,
// monthly budget, and current-month spend (a small budget bar with an
// over-budget warning tone); lets an admin create / rename / delete a team, set
// its budget, add or remove members, and designate a team's primary owner.
//
// This component is purely a client for the admin API — it holds NO authority.
// Every mutation calls /api/admin/teams*, which re-checks the admin role
// server-side via requireChatbotAdmin(). We refetch after each change so the
// list (and the derived spend) always reflects the server's truth.

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Crown,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/Button";
import { IconButton } from "@/components/IconButton";
import { Modal } from "@/components/Modal";

// ---------------------------------------------------------------------------
// Types — mirror the /api/admin/teams response shapes.
// ---------------------------------------------------------------------------
type TeamRole = "member" | "manager" | "owner";

interface TeamMember {
  userId: string;
  email: string | null;
  displayName: string | null;
  role: TeamRole;
  createdAt: string;
}

interface Team {
  id: string;
  name: string;
  description: string | null;
  monthlyBudgetUsd: number | null;
  createdAt: string;
  memberCount: number;
  spendUsd: number;
  members: TeamMember[];
}

interface TeamFormValues {
  name: string;
  description: string | null;
  monthlyBudgetUsd: number | null;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Format USD; show more precision for sub-dollar spend so it never reads $0.00. */
function formatUsd(n: number): string {
  const abs = Math.abs(n);
  const digits = abs > 0 && abs < 1 ? 4 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

/** Up-to-two-letter initials for a member avatar. */
function initials(name: string | null | undefined): string {
  const s = (name ?? "").trim();
  if (!s) return "?";
  const parts = s.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Extract a human message from an error JSON body (string or zod flatten). */
async function readError(res: Response): Promise<string> {
  try {
    const j = await res.json();
    if (typeof j?.error === "string") return j.error;
    if (Array.isArray(j?.error?.formErrors) && j.error.formErrors.length) {
      return j.error.formErrors.join(" ");
    }
    if (j?.error?.fieldErrors) {
      const first = Object.values(j.error.fieldErrors).flat()[0];
      if (typeof first === "string") return first;
    }
  } catch {
    /* non-JSON body */
  }
  return `Request failed (${res.status})`;
}

const JSON_HEADERS = { "content-type": "application/json" };

// ===========================================================================
// Budget bar — spend vs budget, with a warning tone as it fills / overflows.
// ===========================================================================
function BudgetBar({ spend, budget }: { spend: number; budget: number | null }) {
  const hasBudget = budget != null && budget > 0;
  const pct = hasBudget ? Math.min(100, (spend / budget) * 100) : 0;
  const over = hasBudget && spend > budget;
  const near = hasBudget && !over && pct >= 80;

  const barClass = over ? "bg-danger" : near ? "bg-warning" : "bg-accent";
  const pctClass = over
    ? "text-danger"
    : near
      ? "text-warning"
      : "text-muted-foreground";

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">
          <span className="font-medium text-foreground">{formatUsd(spend)}</span>{" "}
          {hasBudget ? (
            <span className="text-muted-foreground/80">of {formatUsd(budget)}</span>
          ) : (
            <span className="text-muted-foreground/80">this month</span>
          )}
        </span>
        {hasBudget && (
          <span className={cn("shrink-0 tabular-nums font-medium", pctClass)}>
            {Math.round(pct)}%
          </span>
        )}
      </div>

      {hasBudget ? (
        <div
          className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-surface-muted"
          role="progressbar"
          aria-label="Monthly budget used"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={cn("h-full rounded-full transition-[width]", barClass)}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : (
        <div className="mt-1.5 text-xs text-muted-foreground/70">
          No monthly budget set
        </div>
      )}

      {over && (
        <div className="mt-2 inline-flex items-center gap-1 rounded-md bg-danger/10 px-1.5 py-0.5 text-[11px] font-medium text-danger">
          <AlertTriangle size={12} aria-hidden />
          Over budget by {formatUsd(spend - budget)}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Role badge
// ===========================================================================
function RoleBadge({ role }: { role: TeamRole }) {
  const styles: Record<TeamRole, string> = {
    owner: "bg-accent/12 text-accent",
    manager: "bg-surface-muted text-muted-foreground",
    member: "bg-surface-muted text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        styles[role]
      )}
    >
      {role === "owner" && <Crown size={10} aria-hidden />}
      {role}
    </span>
  );
}

// ===========================================================================
// Member row — avatar, name/email, role, and owner/remove actions.
// ===========================================================================
function MemberRow({
  member,
  onSetOwner,
  onRemove,
}: {
  member: TeamMember;
  onSetOwner: () => void;
  onRemove: () => void;
}) {
  const name = member.displayName || member.email || "Unknown user";
  const isOwner = member.role === "owner";

  return (
    <li className="flex items-center gap-3 py-2">
      <div
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-muted-foreground"
      >
        {initials(member.displayName || member.email)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{name}</span>
          <RoleBadge role={member.role} />
        </div>
        {member.displayName && member.email && (
          <div className="truncate text-xs text-muted-foreground">
            {member.email}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {!isOwner && (
          <IconButton
            aria-label={`Make ${name} the team owner`}
            title="Make primary owner"
            size="sm"
            onClick={onSetOwner}
            className="hover:text-accent"
          >
            <Crown size={15} />
          </IconButton>
        )}
        <IconButton
          aria-label={`Remove ${name} from the team`}
          title="Remove from team"
          size="sm"
          onClick={onRemove}
          className="hover:text-danger"
        >
          <UserMinus size={15} />
        </IconButton>
      </div>
    </li>
  );
}

// ===========================================================================
// Create / edit modal — shared by "New team" and per-card "Edit".
// ===========================================================================
function TeamFormModal({
  open,
  onClose,
  title,
  submitLabel,
  initial,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  submitLabel: string;
  initial: Partial<TeamFormValues>;
  onSubmit: (values: TeamFormValues) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [budget, setBudget] = useState("");
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reseed the form each time it opens so it reflects the current team.
  useEffect(() => {
    if (!open) return;
    setName(initial.name ?? "");
    setDescription(initial.description ?? "");
    setBudget(
      initial.monthlyBudgetUsd != null ? String(initial.monthlyBudgetUsd) : ""
    );
    setErr(null);
    setPending(false);
  }, [open, initial.name, initial.description, initial.monthlyBudgetUsd]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    const trimmed = name.trim();
    if (!trimmed) {
      setErr("Team name is required.");
      return;
    }

    let monthlyBudgetUsd: number | null = null;
    const b = budget.trim();
    if (b !== "") {
      const parsed = Number(b);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setErr("Budget must be a positive dollar amount, or left blank.");
        return;
      }
      monthlyBudgetUsd = Math.round(parsed * 100) / 100;
    }

    setPending(true);
    try {
      await onSubmit({
        name: trimmed,
        description: description.trim() || null,
        monthlyBudgetUsd,
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-ring/40";

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <label htmlFor="team-name" className="block text-sm font-medium">
            Name
          </label>
          <input
            id="team-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            required
            autoComplete="off"
            className={inputClass}
            placeholder="e.g. Engineering"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="team-desc" className="block text-sm font-medium">
            Description <span className="text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id="team-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            rows={2}
            className={cn(inputClass, "resize-none")}
            placeholder="What this team is for"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="team-budget" className="block text-sm font-medium">
            Monthly budget{" "}
            <span className="text-muted-foreground">(USD, optional)</span>
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              $
            </span>
            <input
              id="team-budget"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              className={cn(inputClass, "pl-7")}
              placeholder="500.00"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Leave blank for no budget. Budgets are a soft cap — spend is tracked,
            not blocked.
          </p>
        </div>

        {err && (
          <p
            role="alert"
            className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {err}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={pending}
            className="bg-accent text-accent-foreground hover:bg-accent-hover dark:bg-accent dark:text-accent-foreground dark:hover:bg-accent-hover"
          >
            {pending && <Loader2 size={16} className="animate-spin" />}
            {submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ===========================================================================
// Team card
// ===========================================================================
function TeamCard({
  team,
  onReload,
  onError,
}: {
  team: Team;
  onReload: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [addingMember, setAddingMember] = useState(false);

  async function saveEdit(values: TeamFormValues) {
    const res = await fetch(`/api/admin/teams/${team.id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify(values),
    });
    if (!res.ok) throw new Error(await readError(res));
    await onReload();
  }

  async function del() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/teams/${team.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await readError(res));
      setConfirmDelete(false);
      await onReload();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not delete team.");
    } finally {
      setDeleting(false);
    }
  }

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    const email = newEmail.trim();
    if (!email) return;
    setAddingMember(true);
    try {
      const res = await fetch(`/api/admin/teams/${team.id}/members`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error(await readError(res));
      setNewEmail("");
      await onReload();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not add member.");
    } finally {
      setAddingMember(false);
    }
  }

  async function setOwner(userId: string) {
    try {
      const res = await fetch(`/api/admin/teams/${team.id}/members`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ userId, role: "owner" }),
      });
      if (!res.ok) throw new Error(await readError(res));
      await onReload();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not set owner.");
    }
  }

  async function removeMember(userId: string) {
    try {
      const res = await fetch(`/api/admin/teams/${team.id}/members`, {
        method: "DELETE",
        headers: JSON_HEADERS,
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) throw new Error(await readError(res));
      await onReload();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not remove member.");
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface shadow-soft">
      {/* Header: name + description, member count, actions */}
      <div className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{team.name}</h3>
          {team.description ? (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {team.description}
            </p>
          ) : null}
          <p className="mt-1.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Users size={13} aria-hidden />
            {team.memberCount} {team.memberCount === 1 ? "member" : "members"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton
            aria-label={`Edit ${team.name}`}
            title="Edit team"
            size="sm"
            onClick={() => setEditOpen(true)}
          >
            <Pencil size={15} />
          </IconButton>
          <IconButton
            aria-label={`Delete ${team.name}`}
            title="Delete team"
            size="sm"
            onClick={() => setConfirmDelete(true)}
            className="hover:text-danger"
          >
            <Trash2 size={15} />
          </IconButton>
        </div>
      </div>

      {/* Budget bar */}
      <div className="p-4">
        <BudgetBar spend={team.spendUsd} budget={team.monthlyBudgetUsd} />
      </div>

      {/* Roster */}
      <div className="border-t border-border p-4 pt-3">
        {team.members.length > 0 ? (
          <ul className="divide-y divide-border">
            {team.members.map((m) => (
              <MemberRow
                key={m.userId}
                member={m}
                onSetOwner={() => setOwner(m.userId)}
                onRemove={() => removeMember(m.userId)}
              />
            ))}
          </ul>
        ) : (
          <p className="py-2 text-xs text-muted-foreground">No members yet.</p>
        )}

        {/* Add member by email */}
        <form onSubmit={addMember} className="mt-3 flex items-center gap-2">
          <label htmlFor={`add-${team.id}`} className="sr-only">
            Add member by email to {team.name}
          </label>
          <input
            id={`add-${team.id}`}
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="member@practiscale.co"
            autoComplete="off"
            className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-ring/40"
          />
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            disabled={addingMember || !newEmail.trim()}
          >
            {addingMember ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <UserPlus size={14} />
            )}
            Add
          </Button>
        </form>
      </div>

      {/* Edit modal */}
      <TeamFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit team"
        submitLabel="Save changes"
        initial={{
          name: team.name,
          description: team.description,
          monthlyBudgetUsd: team.monthlyBudgetUsd,
        }}
        onSubmit={saveEdit}
      />

      {/* Delete confirm */}
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete team"
      >
        <p className="text-sm text-muted-foreground">
          Delete <span className="font-medium text-foreground">{team.name}</span>?
          Its members are removed from the team and usage history is preserved
          (detached from the team). This can’t be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setConfirmDelete(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={del}
            disabled={deleting}
            className="bg-danger text-white hover:bg-danger/90 dark:bg-danger dark:text-white dark:hover:bg-danger/90"
          >
            {deleting && <Loader2 size={16} className="animate-spin" />}
            Delete team
          </Button>
        </div>
      </Modal>
    </div>
  );
}

// ===========================================================================
// Top-level: header + create + grid of team cards
// ===========================================================================
export function TeamsClient() {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [monthStart, setMonthStart] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/teams", { cache: "no-store" });
      if (!res.ok) {
        setLoadError(await readError(res));
        return;
      }
      const json = await res.json();
      setTeams((json.teams as Team[]) ?? []);
      setMonthStart((json.monthStart as string) ?? null);
      setLoadError(null);
    } catch {
      setLoadError("Could not load teams. Check your connection and retry.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createTeam(values: TeamFormValues) {
    const res = await fetch("/api/admin/teams", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(values),
    });
    if (!res.ok) throw new Error(await readError(res));
    await load();
  }

  const monthLabel = monthStart
    ? new Date(monthStart).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })
    : null;

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Teams &amp; budgets</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Organize users into teams, set a monthly spend budget, and track
            usage{monthLabel ? ` for ${monthLabel}` : ""}.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="bg-accent text-accent-foreground hover:bg-accent-hover dark:bg-accent dark:text-accent-foreground dark:hover:bg-accent-hover"
        >
          <Plus size={16} />
          New team
        </Button>
      </div>

      {/* Action error banner (mutation failures) */}
      {actionError && (
        <p
          role="alert"
          className="mt-4 flex items-start justify-between gap-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="shrink-0 font-medium underline underline-offset-2"
          >
            Dismiss
          </button>
        </p>
      )}

      {/* Body */}
      <div className="mt-6">
        {loadError ? (
          <div className="rounded-xl border border-border bg-surface p-8 text-center">
            <p className="text-sm text-danger">{loadError}</p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={() => void load()}
            >
              Retry
            </Button>
          </div>
        ) : teams === null ? (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-surface p-12 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" aria-hidden />
            Loading teams…
          </div>
        ) : teams.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface p-12 text-center">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-surface-muted text-muted-foreground">
              <Users size={20} aria-hidden />
            </div>
            <h2 className="mt-3 text-sm font-semibold">No teams yet</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Create your first team to group users and set a monthly budget.
            </p>
            <Button
              type="button"
              className="mt-4 bg-accent text-accent-foreground hover:bg-accent-hover dark:bg-accent dark:text-accent-foreground dark:hover:bg-accent-hover"
              onClick={() => setCreateOpen(true)}
            >
              <Plus size={16} />
              New team
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {teams.map((team) => (
              <TeamCard
                key={team.id}
                team={team}
                onReload={load}
                onError={setActionError}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create modal */}
      <TeamFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New team"
        submitLabel="Create team"
        initial={{ name: "", description: null, monthlyBudgetUsd: null }}
        onSubmit={createTeam}
      />
    </div>
  );
}
