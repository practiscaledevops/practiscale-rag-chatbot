"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, LogOut, Pencil, X } from "lucide-react";
import { Button } from "@/components/Button";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { cn } from "@/lib/utils";
import { updateDisplayName } from "./actions";

/** First two initials for the avatar, from the display name or email. */
function initialsOf(name: string, email: string | null): string {
  const source = name.trim() || email?.split("@")[0] || "?";
  const parts = source.split(/\s+/).filter(Boolean);
  const chars =
    parts.length >= 2 ? parts[0][0] + parts[1][0] : source.slice(0, 2);
  return chars.toUpperCase();
}

export interface AccountClientProps {
  displayName: string;
  email: string | null;
  roleLabel: string;
}

/**
 * The interactive identity card for the account page: an avatar, an inline
 * display-name editor (saved via the updateDisplayName server action), and the
 * sign-out control. The heavier, read-only cards (access, usage) are rendered
 * server-side by the page.
 */
export function AccountClient({ displayName, email, roleLabel }: AccountClientProps) {
  const router = useRouter();

  const [name, setName] = useState(displayName);
  const [draft, setDraft] = useState(displayName);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [signingOut, setSigningOut] = useState(false);

  function startEdit() {
    setDraft(name);
    setError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setError(null);
  }

  function save() {
    const trimmed = draft.trim();
    if (!trimmed) {
      setError("Enter a name");
      return;
    }
    if (trimmed === name) {
      setEditing(false);
      return;
    }
    setError(null);
    startSaving(async () => {
      const result = await updateDisplayName({ displayName: trimmed });
      if (result.ok) {
        setName(result.displayName);
        setEditing(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  async function signOut() {
    setSigningOut(true);
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
    } catch {
      /* fall through to the login redirect even if the network call fails */
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-5 shadow-soft sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden
            className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-brand-gradient text-lg font-semibold text-white shadow-soft"
          >
            {initialsOf(name, email)}
          </span>

          <div className="min-w-0">
            {editing ? (
              <div className="space-y-2">
                <label htmlFor="display-name" className="sr-only">
                  Display name
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="display-name"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        save();
                      } else if (e.key === "Escape") {
                        cancelEdit();
                      }
                    }}
                    autoFocus
                    maxLength={120}
                    disabled={saving}
                    className="w-full max-w-xs rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-ring/40 disabled:opacity-60"
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={save}
                    disabled={saving || !draft.trim()}
                    aria-label="Save name"
                  >
                    {saving ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Check size={14} />
                    )}
                    Save
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={cancelEdit}
                    disabled={saving}
                    aria-label="Cancel"
                  >
                    <X size={14} />
                  </Button>
                </div>
                {error && (
                  <p role="alert" className="text-xs text-danger">
                    {error}
                  </p>
                )}
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-lg font-semibold tracking-tight">
                    {name}
                  </h2>
                  <button
                    type="button"
                    onClick={startEdit}
                    aria-label="Edit display name"
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Pencil size={14} />
                  </button>
                </div>
                <p className="truncate text-sm text-muted-foreground">{email}</p>
                <span
                  className={cn(
                    "mt-2 inline-flex items-center rounded-full border border-border bg-surface-muted px-2 py-0.5 text-xs font-medium",
                    "text-accent"
                  )}
                >
                  {roleLabel}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="shrink-0">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={signOut}
            disabled={signingOut}
          >
            {signingOut ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <LogOut size={14} />
            )}
            Sign out
          </Button>
        </div>
      </div>
    </section>
  );
}
