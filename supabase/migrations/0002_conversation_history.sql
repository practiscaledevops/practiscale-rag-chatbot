-- 0002_conversation_history.sql — history affordances for the sidebar.
-- Adds the columns the Chat History list needs beyond 0001: a pin flag and a
-- last-touched timestamp used to order threads (pinned first, then most recent).
-- Purely additive; RLS from 0001 already covers these columns.

-- ---------------------------------------------------------------------------
-- conversations.pinned  — user can pin a thread to the top of the history list.
-- conversations.updated_at — bumped whenever the row changes (rename, pin, …)
--   so the list can sort by recent activity.
-- ---------------------------------------------------------------------------
alter table public.conversations
  add column if not exists pinned     boolean     not null default false;

alter table public.conversations
  add column if not exists updated_at timestamptz not null default now();

-- Keep updated_at current on every UPDATE to a conversation row.
create or replace function public.touch_conversation_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists conversations_set_updated_at on public.conversations;
create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function public.touch_conversation_updated_at();

-- Composite index matching the history list's ordering:
-- a user's threads, pinned first, most-recently-touched first.
create index if not exists conversations_user_pinned_updated_idx
  on public.conversations (user_id, pinned desc, updated_at desc);
