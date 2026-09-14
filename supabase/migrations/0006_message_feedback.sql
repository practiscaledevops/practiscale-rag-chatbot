-- 0006_message_feedback.sql — thumbs up/down feedback on assistant answers.
-- Feeds a QA loop: which answers were rated helpful vs inaccurate, with a
-- content snapshot so reviewers don't need to reconstruct the thread. RLS scopes
-- rows to their owner. The app is written to work with OR without this table (it
-- degrades to "feedback unavailable" until this runs), so applying it is safe at
-- any time and simply switches the feature on.

create table if not exists public.message_feedback (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid,
  rating          text not null check (rating in ('up', 'down')),
  content         text,            -- snapshot of the rated assistant answer (capped by the app)
  prompt          text,            -- the user turn it answered (capped by the app)
  mode            text,            -- work mode active for the turn, if any
  model           text,            -- model/tier used, if known
  comment         text,
  created_at      timestamptz not null default now()
);

create index if not exists message_feedback_user_created_idx
  on public.message_feedback (user_id, created_at desc);
create index if not exists message_feedback_rating_idx
  on public.message_feedback (rating, created_at desc);

alter table public.message_feedback enable row level security;

drop policy if exists "own feedback select" on public.message_feedback;
create policy "own feedback select" on public.message_feedback
  for select using (user_id = auth.uid());

drop policy if exists "own feedback insert" on public.message_feedback;
create policy "own feedback insert" on public.message_feedback
  for insert with check (user_id = auth.uid());
