// Server-only: depends on the request-cookie-bound Supabase server client.
import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase-server";

/**
 * Resolve the currently signed-in user from the request's Supabase session,
 * or `null` when unauthenticated. Uses `getUser()` (not `getSession()`) so the
 * token is verified against Supabase rather than trusted from the cookie.
 *
 * Server-only: call from Server Components, Route Handlers, and Server Actions.
 */
export async function getUser(): Promise<User | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ?? null;
}

/**
 * Like {@link getUser} but returns the user's profile row (display name, email)
 * alongside the auth user. Returns `null` if unauthenticated. The profile may be
 * `null` if the row hasn't been provisioned yet.
 */
export async function getUserWithProfile() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, display_name")
    .eq("id", user.id)
    .maybeSingle();

  return { user, profile };
}
