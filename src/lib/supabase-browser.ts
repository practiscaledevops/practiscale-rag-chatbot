"use client";

import { createBrowserClient } from "@supabase/ssr";
import { isDemo } from "@/lib/demo/mode";
import { fakeSupabase } from "@/lib/demo/client";

/**
 * Browser-side Supabase client for the chatbot's OWN project (auth + history +
 * projects). Uses the public anon key — safe to ship to the browser; row-level
 * security scopes every row to the signed-in user. This talks to the chatbot's
 * database, NOT the Brain (the Brain is reached only through /api/chat).
 */
export function createSupabaseBrowserClient() {
  if (isDemo()) return fakeSupabase() as ReturnType<typeof createBrowserClient>;
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
