"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, LogIn, ShieldCheck } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { Button } from "@/components/Button";
import { Logo } from "@/components/Brand";

/**
 * Constrain the post-login redirect to a SAME-ORIGIN path. `redirectedFrom`
 * comes from the query string (attacker-controllable via a crafted /login link),
 * so an unchecked value would be an open redirect — signing in could bounce the
 * user to an external phishing page. Only accept a path that starts with a single
 * "/" and is not protocol-relative ("//host") or a backslash trick ("/\\host");
 * anything else falls back to the app root.
 */
function safeInternalPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/")) return "/";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  return raw;
}

// PUBLIC route. Email + password sign-in against the chatbot's own Supabase
// project. On success we route to wherever the middleware bounced us from
// (or / by default). The middleware sends already-signed-in users away.
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectedFrom = safeInternalPath(searchParams.get("redirectedFrom"));

  const demo = process.env.NEXT_PUBLIC_DEMO_MODE === "1";
  const [email, setEmail] = useState(demo ? "demo@practiscale.co" : "");
  const [password, setPassword] = useState(demo ? "demo" : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Second-factor step: set once a password sign-in needs an authenticator code.
  const [mfa, setMfa] = useState<{ factorId: string } | null>(null);
  const [mfaCode, setMfaCode] = useState("");

  function complete() {
    // Full navigation so Server Components re-read the fresh session cookie.
    router.replace(redirectedFrom);
    router.refresh();
  }

  // If the user arrives with a session that has a SECOND factor still pending
  // (e.g. the middleware bounced them here from a protected route, or they
  // reloaded mid-challenge), jump straight to the code step.
  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (!aal || aal.currentLevel !== "aal1" || aal.nextLevel !== "aal2") return;
        const { data: factors } = await supabase.auth.mfa.listFactors();
        const totp = factors?.totp?.[0];
        if (totp && !cancelled) {
          setMfa({ factorId: totp.id });
          setMfaCode("");
        }
      } catch {
        /* no pending step-up, or MFA unavailable — show the password form */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [demo]);

  // Escape hatch from the code step: drop the half-authenticated (aal1) session
  // and return to the password form, so a user is never trapped on this screen.
  async function cancelMfa() {
    setPending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
    } catch {
      /* ignore — we still reset the UI below */
    }
    setMfa(null);
    setMfaCode("");
    setError(null);
    setPending(false);
    router.refresh();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    // In demo mode any credentials work — go straight to the workspace.
    if (demo) {
      complete();
      return;
    }

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setPending(false);
      return;
    }

    // If the account has a verified authenticator, Supabase raises the required
    // assurance level to aal2 — collect the second factor before proceeding.
    try {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal && aal.nextLevel === "aal2" && aal.nextLevel !== aal.currentLevel) {
        const { data: factors } = await supabase.auth.mfa.listFactors();
        const totp = factors?.totp?.[0];
        if (totp) {
          setMfa({ factorId: totp.id });
          setMfaCode("");
          setPending(false);
          return;
        }
      }
    } catch {
      /* if the AAL check fails, fall through — the session is already aal1 */
    }

    complete();
  }

  async function onSubmitMfa(e: React.FormEvent) {
    e.preventDefault();
    if (!mfa || mfaCode.trim().length < 6) return;
    setError(null);
    setPending(true);

    const supabase = createSupabaseBrowserClient();
    try {
      const challenge = await supabase.auth.mfa.challenge({ factorId: mfa.factorId });
      if (challenge.error || !challenge.data) {
        setError(challenge.error?.message || "Couldn't verify the code. Try again.");
        setPending(false);
        return;
      }
      const { error } = await supabase.auth.mfa.verify({
        factorId: mfa.factorId,
        challengeId: challenge.data.id,
        code: mfaCode.trim(),
      });
      if (error) {
        setError(error.message || "That code didn't match. Try again.");
        setPending(false);
        return;
      }
      complete();
    } catch {
      setError("Couldn't verify the code. Try again.");
      setPending(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      {/* Soft ambient brand wash behind the card — decorative, non-interactive. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="bg-brand-gradient absolute -top-32 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full opacity-[0.12] blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="rounded-2xl border border-border bg-surface p-8 shadow-soft-lg">
          <div className="mb-8 flex flex-col items-center text-center">
            {/* Dark wordmark on the light surface; white wordmark in dark mode. */}
            <Logo variant="light" className="h-8 dark:hidden" />
            <Logo variant="dark" className="hidden h-8 dark:block" />
            <p className="mt-4 text-sm text-muted-foreground">
              {mfa
                ? "Enter the 6-digit code from your authenticator app."
                : demo
                  ? "Demo mode — any credentials work. Just press Sign in."
                  : "Sign in to continue to your workspace."}
            </p>
          </div>

          {mfa ? (
            <form onSubmit={onSubmitMfa} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <label htmlFor="mfa-code" className="flex items-center gap-1.5 text-sm font-medium">
                  <ShieldCheck size={14} className="text-accent" />
                  Verification code
                </label>
                <input
                  id="mfa-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  required
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="123456"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-center font-mono text-lg tracking-[0.4em] outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-ring/40"
                />
              </div>

              {error && (
                <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                disabled={pending || mfaCode.length < 6}
                className="w-full bg-accent text-accent-foreground hover:bg-accent-hover dark:bg-accent dark:text-accent-foreground dark:hover:bg-accent-hover"
              >
                {pending ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Verifying…
                  </>
                ) : (
                  <>
                    <ShieldCheck size={16} />
                    Verify
                  </>
                )}
              </Button>

              <button
                type="button"
                onClick={cancelMfa}
                disabled={pending}
                className="w-full text-center text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline disabled:opacity-50"
              >
                Use a different account
              </button>
            </form>
          ) : (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-sm font-medium">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-ring/40"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="block text-sm font-medium">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-ring/40"
              />
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger"
              >
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={pending}
              className="w-full bg-accent text-accent-foreground hover:bg-accent-hover dark:bg-accent dark:text-accent-foreground dark:hover:bg-accent-hover"
            >
              {pending ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Signing in…
                </>
              ) : (
                <>
                  <LogIn size={16} />
                  Sign in
                </>
              )}
            </Button>
          </form>
          )}
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  // useSearchParams() must be inside a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
