-- 0013_profile_avatars.sql — self-service profile pictures.
--
-- One small, already-cropped image per user (the browser crops + re-encodes it
-- to a ~384px WebP/JPEG before upload), stored base64 in its own table and
-- served by GET /api/account/avatar to its OWNER only. No Storage bucket.
--
-- WHY A SEPARATE TABLE (not a profiles column)
-- public.profiles is column-locked for end users: 0003 grants `authenticated`
-- UPDATE on display_name ONLY, and 0011 revokes INSERT/DELETE, so users can
-- never touch role / permissions / team / is_active. Adding an avatar column
-- there would mean widening those grants. This table holds nothing privileged,
-- so the owner can freely insert/update/delete their own row without loosening
-- anything on profiles.
--
-- SECURITY
--   • RLS: the owner can select/insert/update/delete ONLY their row
--     (user_id = auth.uid()). `anon` gets nothing.
--   • mime is whitelisted and data is size-capped here as well as in the app
--     (the route sniffs magic bytes and caps decoded size at 512 KB; base64 of
--     512 KB is ~699 KB, hence the 700000-char cap).
--   • Deleting the auth user cascades the avatar away.
--
-- Before this runs the app keeps working: avatars fall back to initials and the
-- upload route answers 503 "run migration 0013_profile_avatars".
--
-- Idempotent: safe to re-run.

create table if not exists public.profile_avatars (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  mime       text not null
             check (mime in ('image/webp', 'image/jpeg', 'image/png')),
  data       text not null
             check (length(data) <= 700000),
  updated_at timestamptz not null default now()
);

alter table public.profile_avatars enable row level security;

-- ---- privileges -------------------------------------------------------------
-- Nothing for anonymous callers; the signed-in owner gets full CRUD (RLS below
-- confines every statement to their own row). Table-wide UPDATE is deliberate:
-- the upsert rewrites every column, and none of them is privileged.
revoke all on public.profile_avatars from anon;
grant select, insert, update, delete on public.profile_avatars to authenticated;

-- ---- policies: owner-only -----------------------------------------------------
drop policy if exists "profile_avatars_select_own" on public.profile_avatars;
create policy "profile_avatars_select_own" on public.profile_avatars
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "profile_avatars_insert_own" on public.profile_avatars;
create policy "profile_avatars_insert_own" on public.profile_avatars
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "profile_avatars_update_own" on public.profile_avatars;
create policy "profile_avatars_update_own" on public.profile_avatars
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "profile_avatars_delete_own" on public.profile_avatars;
create policy "profile_avatars_delete_own" on public.profile_avatars
  for delete to authenticated using (user_id = auth.uid());
