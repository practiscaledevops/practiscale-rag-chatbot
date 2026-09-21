-- 0011_profiles_lock_writes.sql — close the profiles delete/re-insert
-- privilege escalation, and column-scope user writes on notifications/approvals.
--
-- MIGRATIONS TO APPLY (in order): 0001 … 0010, then this file. It must run AFTER
-- 0009_notifications.sql and 0010_approvals.sql — the notifications/approvals
-- blocks below are no-ops on a database where those tables don't exist yet, so
-- re-run this file once they do.
--
-- BACKGROUND / THREAT (profiles)
-- 0001 / chatbot_full.sql grant `authenticated` INSERT + DELETE on public.profiles
-- and ship the matching profiles_insert_own / profiles_delete_own RLS policies.
-- Migration 0003 only revoked UPDATE (column-scoping it to display_name), so a
-- signed-in user could still, with the PUBLIC anon key + their own session JWT
-- via PostgREST:
--
--     DELETE /rest/v1/profiles?id=eq.<their-uid>
--     POST   /rest/v1/profiles   { "id": "<their-uid>", "role": "super_admin",
--                                  "can_use_all_models": true, ... }
--
-- i.e. delete their own row, then re-insert it with any privileged column set.
-- The server-side admin gate (lib/admin.ts) reads `role` back from that row
-- and would treat the attacker as a super admin.
--
-- FIX
-- Revoke INSERT + DELETE from `authenticated` and drop the two policies. Signup
-- keeps working: profiles are provisioned by the SECURITY DEFINER
-- handle_new_user() trigger (owner context, unaffected by these grants), and
-- every legitimate privileged write goes through the service-role client.
--
-- ALSO
--   • notifications: users could UPDATE every column of their own rows (the
--     policy only checks ownership). Column-scope UPDATE to read_at, which is
--     the only field the app lets a user change ("mark read").
--   • approvals: users could INSERT reviewer_id / review_note / reviewed_at on
--     their own pending request. Column-scope INSERT to the submitter fields.
--
-- Idempotent: safe to re-run.

-- ---- profiles: no user-side INSERT / DELETE -------------------------------
revoke insert, delete on public.profiles from authenticated;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_delete_own on public.profiles;

-- ---- notifications: UPDATE only read_at (no-op before migration 0009) ------
do $$
begin
  revoke update on public.notifications from authenticated;
  grant  update (read_at) on public.notifications to authenticated;
exception when undefined_table then null;
end $$;

-- ---- approvals: INSERT only the submitter fields (no-op before 0010) --------
do $$
begin
  revoke insert on public.approvals from authenticated;
  grant  insert (user_id, title, content, prompt, mode, model, conversation_id, status)
    on public.approvals to authenticated;
exception when undefined_table then null;
end $$;
