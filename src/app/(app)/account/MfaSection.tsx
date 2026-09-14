"use client";

// Account › Security — two-factor authentication (TOTP authenticator app).
//
// Uses Supabase Auth's native MFA (supabase.auth.mfa.*): enroll a TOTP factor
// (QR + secret), verify it with a 6-digit code, list verified factors, and
// remove one. No external identity provider needed. The login page enforces the
// second factor at sign-in for anyone who has enrolled (see AAL2 challenge).
//
// SECURITY NOTE: this never handles the user's password or a recovery code. It
// only manages the user's OWN authenticator factors against their own session.

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, ShieldPlus, Loader2, Trash2, Smartphone, Check } from "lucide-react";
import { Button } from "@/components/Button";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { isDemo } from "@/lib/demo/mode";
import { cn } from "@/lib/utils";

interface Factor {
  id: string;
  friendlyName: string | null;
  status: string;
  createdAt: string;
}

interface Enrolling {
  factorId: string;
  qr: string; // SVG data URL
  secret: string;
}

export function MfaSection() {
  const supabase = createSupabaseBrowserClient();
  // The demo fake client has no real MFA — hide the section there.
  const supported = !isDemo() && typeof supabase.auth?.mfa?.listFactors === "function";

  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [enrolling, setEnrolling] = useState<Enrolling | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) {
        setFactors([]);
        return;
      }
      const totp = (data?.totp ?? []).map((f) => ({
        id: f.id,
        friendlyName: f.friendly_name ?? null,
        status: f.status,
        createdAt: f.created_at ?? "",
      }));
      setFactors(totp);
    } catch {
      setFactors([]);
    }
  }, [supabase]);

  useEffect(() => {
    if (supported) void refresh();
  }, [supported, refresh]);

  const startEnroll = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Authenticator ${new Date().toLocaleDateString()}`,
      });
      if (error || !data) {
        setError(error?.message || "Couldn't start enrollment.");
        return;
      }
      setCode("");
      setEnrolling({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    } finally {
      setBusy(false);
    }
  }, [supabase]);

  const cancelEnroll = useCallback(async () => {
    const pending = enrolling;
    setEnrolling(null);
    setCode("");
    setError(null);
    // Clean up the unverified factor so it doesn't linger.
    if (pending) {
      try {
        await supabase.auth.mfa.unenroll({ factorId: pending.factorId });
      } catch {
        /* best-effort */
      }
    }
  }, [enrolling, supabase]);

  const verify = useCallback(async () => {
    if (!enrolling || code.trim().length < 6) return;
    setBusy(true);
    setError(null);
    try {
      const challenge = await supabase.auth.mfa.challenge({ factorId: enrolling.factorId });
      if (challenge.error || !challenge.data) {
        setError(challenge.error?.message || "Couldn't verify the code.");
        return;
      }
      const { error } = await supabase.auth.mfa.verify({
        factorId: enrolling.factorId,
        challengeId: challenge.data.id,
        code: code.trim(),
      });
      if (error) {
        setError(error.message || "That code didn't match. Try again.");
        return;
      }
      setEnrolling(null);
      setCode("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [enrolling, code, supabase, refresh]);

  const remove = useCallback(
    async (factorId: string) => {
      setRemoving(factorId);
      setError(null);
      try {
        const { error } = await supabase.auth.mfa.unenroll({ factorId });
        if (error) {
          setError(error.message || "Couldn't remove that factor.");
          return;
        }
        await refresh();
      } finally {
        setRemoving(null);
      }
    },
    [supabase, refresh]
  );

  if (!supported) return null;

  const verified = (factors ?? []).filter((f) => f.status === "verified");
  const hasMfa = verified.length > 0;

  return (
    <section
      aria-labelledby="mfa-heading"
      className="rounded-xl border border-border bg-surface p-5 shadow-soft sm:p-6"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="mfa-heading" className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck size={16} className={hasMfa ? "text-emerald-500" : "text-muted-foreground"} />
            Two-factor authentication
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Add a second step at sign-in with an authenticator app (Google
            Authenticator, 1Password, Authy…).
          </p>
        </div>
        {hasMfa && !enrolling && (
          <span className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
            On
          </span>
        )}
      </div>

      {/* Enrolled factors */}
      {factors === null ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : (
        verified.length > 0 && (
          <ul className="mt-4 space-y-2">
            {verified.map((f) => (
              <li
                key={f.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2"
              >
                <Smartphone size={16} className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{f.friendlyName || "Authenticator app"}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    Added {f.createdAt ? new Date(f.createdAt).toLocaleDateString() : "recently"}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => remove(f.id)}
                  disabled={removing === f.id}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
                >
                  {removing === f.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      {/* Enrollment flow */}
      {enrolling ? (
        <div className="mt-4 rounded-xl border border-border bg-background p-4">
          <p className="text-sm font-medium">Scan this with your authenticator app</p>
          <div className="mt-3 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={enrolling.qr}
              alt="Two-factor QR code"
              className="h-40 w-40 shrink-0 rounded-lg border border-border bg-white p-1"
            />
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Or enter this key manually:</p>
              <code className="mt-1 block break-all rounded-md bg-surface-muted px-2 py-1 font-mono text-xs">
                {enrolling.secret}
              </code>
              <label className="mt-3 block text-xs font-medium text-muted-foreground">
                Enter the 6-digit code
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  className="mt-1 w-36 rounded-lg border border-border bg-surface px-2.5 py-2 text-center font-mono text-lg tracking-widest outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
            </div>
          </div>
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={verify} disabled={busy || code.length < 6}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Verify & turn on
            </Button>
            <Button variant="ghost" size="sm" onClick={cancelEnroll} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          {error && <p className="mb-2 text-xs text-danger">{error}</p>}
          <Button variant="secondary" size="sm" onClick={startEnroll} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldPlus size={14} />}
            {hasMfa ? "Add another authenticator" : "Add authenticator app"}
          </Button>
        </div>
      )}
    </section>
  );
}
