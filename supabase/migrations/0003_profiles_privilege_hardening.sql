-- 0003_profiles_privilege_hardening.sql — close a privilege-escalation hole.
--
-- BACKGROUND / THREAT
-- 0001 grants `authenticated` table-wide UPDATE on public.profiles, and the
-- profiles_update_own RLS policy only checks row ownership (auth.uid() = id) —
-- it does NOT restrict WHICH columns may change. Once admin.sql adds the
-- privileged columns (role, is_active, permissions, can_use_all_models,
-- team_id), any signed-in user could UPDATE their OWN profile row's `role` to
-- 'super_admin' — not through this app, but by calling Supabase/PostgREST
-- directly with the PUBLIC anon key (NEXT_PUBLIC_SUPABASE_ANON_KEY, shipped to
-- every browser) plus their own session JWT:
--
--     PATCH /rest/v1/profiles?id=eq.<their-uid>   { "role": "super_admin" }
--
-- The server-side admin gate (lib/admin.ts requireChatbotAdmin) then reads
-- `role` back from this very row via the service-role client and treats the
-- attacker as a super admin. Reading the role server-side does NOT help when the
-- underlying row is attacker-writable.
--
-- FIX
-- Postgres column-level privileges: revoke table-wide UPDATE from `authenticated`
-- and grant UPDATE on ONLY the self-service `display_name` column. RLS still
-- scopes the row to its owner; the column grant additionally makes every
-- privileged column read-only to end users. All legitimate privileged writes go
-- through the service-role client (BYPASSRLS + full grants) in the admin routes,
-- so this is transparent to admin functionality and to the account page's
-- display-name edit.
--
-- Idempotent: safe to re-run.

revoke update on public.profiles from authenticated;
grant  update (display_name) on public.profiles to authenticated;

-- Note: `email` is intentionally NOT user-writable here. profiles.email is a
-- backfill of the authoritative auth.users email (which admin code reads via the
-- GoTrue admin API); letting users rewrite it would only desync the two.
