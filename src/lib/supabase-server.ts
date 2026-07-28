// Server-only module: it imports `next/headers` (request cookies), which Next
// forbids in client components, and the service client reads a secret env var
// that is never NEXT_PUBLIC. Do not import this from a client component.
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client for the chatbot's OWN project, bound to the
 * request's cookies so the signed-in session flows through Server Components,
 * Route Handlers, and Server Actions. Reads/writes go through row-level security
 * (user_id = auth.uid()), so this is safe to use for user-scoped data.
 *
 * `cookies()` is async in Next 15, hence the await.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[]
        ) {
          // In a Server Component the cookie store is read-only; the middleware
          // is what actually refreshes the session cookie. Swallow the throw so
          // read-only render paths don't crash.
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            /* called from a Server Component — safe to ignore */
          }
        },
      },
    }
  );
}

/**
 * SERVER-ONLY service-role client. Bypasses row-level security, so it must be
 * used only in trusted server code for operations the user's own session cannot
 * perform (e.g. system writes). NEVER expose this to the browser and NEVER build
 * it from client-supplied input. It reads SUPABASE_SERVICE_ROLE_KEY, which is
 * not a NEXT_PUBLIC var and so is never bundled for the client.
 */
export function createSupabaseServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
