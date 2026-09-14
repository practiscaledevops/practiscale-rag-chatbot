-- 0009_notifications.sql — in-app notifications center.
-- Per-user notifications with a priority category, an optional deep link, and a
-- read timestamp. Users read + mark their OWN notifications (RLS); rows are
-- written only by the SERVICE-ROLE client server-side (a notify() helper), so a
-- user can never fabricate a notification for someone else. The app degrades
-- gracefully (bell shows empty, producers skip) until this table exists.

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  category   text not null default 'info',   -- info | success | warning | action
  title      text not null,
  body       text,
  href       text,                            -- optional in-app link (relative)
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);

-- Fast unread lookups for the badge count.
create index if not exists notifications_unread_idx
  on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;

-- Users may READ their own notifications.
drop policy if exists "notifications read own" on public.notifications;
create policy "notifications read own" on public.notifications
  for select using (auth.uid() = user_id);

-- Users may UPDATE their own (only to mark them read). No INSERT/DELETE policy,
-- so creation is service-role only.
drop policy if exists "notifications update own" on public.notifications;
create policy "notifications update own" on public.notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
