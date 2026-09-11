-- 0005_conversation_archive.sql — archive affordance for the sidebar.
-- Adds a boolean `archived` flag so a user can tuck a thread out of the main
-- history list without deleting it. Purely additive; RLS from 0001 already
-- covers the new column. The app is written to work with OR without this column
-- (it falls back to "nothing archived" until this runs), so applying it is safe
-- at any time and simply switches the feature on.

alter table public.conversations
  add column if not exists archived boolean not null default false;

-- The history list reads a user's non-archived threads, pinned first, most
-- recently touched first; this partial index matches that access pattern.
create index if not exists conversations_user_active_idx
  on public.conversations (user_id, pinned desc, updated_at desc)
  where archived = false;
