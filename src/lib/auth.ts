// Server-only: depends on the request-cookie-bound Supabase server client.
import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase-server";

/**
 * Resolve the currently signed-in user from the request's Supabase session,
 * or `null` when unauthenticated. Uses `getUser()` (not `getSession()`) so the
 * token is verified against Supabase rather than trusted from the cookie.
 *
 * Wrapped in React `cache` so the layout, page and helpers that all need the
 * user in one request share a single verification round-trip (the cache is
 * per request; outside a request scope it simply calls through).
 *
 * Server-only: call from Server Components, Route Handlers, and Server Actions.
 */
export const getUser = cache(async (): Promise<User | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ?? null;
});
