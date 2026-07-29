"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, LogIn } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { Button } from "@/components/Button";
import { Logo } from "@/components/Brand";

// PUBLIC route. Email + password sign-in against the chatbot's own Supabase
// project. On success we route to wherever the middleware bounced us from
// (or / by default). The middleware sends already-signed-in users away.
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectedFrom = searchParams.get("redirectedFrom") || "/";

  const demo = process.env.NEXT_PUBLIC_DEMO_MODE === "1";
  const [email, setEmail] = useState(demo ? "demo@practiscale.co" : "");
  const [password, setPassword] = useState(demo ? "demo" : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    // In demo mode any credentials work — go straight to the workspace.
    if (demo) {
      router.replace(redirectedFrom);
      router.refresh();
      return;
    }

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setPending(false);
      return;
    }

    // Full navigation so Server Components re-read the fresh session cookie.
    router.replace(redirectedFrom);
    router.refresh();
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
              {demo
                ? "Demo mode — any credentials work. Just press Sign in."
                : "Sign in to continue to your workspace."}
            </p>
          </div>

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
