-- 0010_approvals.sql — content approval workflow.
-- A user submits a generated answer for review; an admin approves, rejects, or
-- requests changes. Submitters read + create their OWN requests (RLS). Reviews
-- (status changes) are performed only by the SERVICE-ROLE client behind an
-- admin-gated route, so a user can never approve their own content. The app
-- degrades gracefully (submit action + queue hidden/disabled) until this exists.

create table if not exists public.approvals (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade, -- submitter
  title           text not null,
  content         text not null,
  prompt          text,
  mode            text,
  model           text,
  conversation_id uuid,
  status          text not null default 'pending', -- pending | approved | rejected | changes_requested
  reviewer_id     uuid,
  review_note     text,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists approvals_status_idx on public.approvals (status, created_at desc);
create index if not exists approvals_user_idx on public.approvals (user_id, created_at desc);

alter table public.approvals enable row level security;

-- Submitters may READ their own requests (to see the outcome).
drop policy if exists "approvals read own" on public.approvals;
create policy "approvals read own" on public.approvals
  for select using (auth.uid() = user_id);

-- Submitters may CREATE their own requests, and only in the pending state.
drop policy if exists "approvals insert own" on public.approvals;
create policy "approvals insert own" on public.approvals
  for insert with check (auth.uid() = user_id and status = 'pending');

-- No client UPDATE/DELETE policy: reviews (approve/reject) happen only through the
-- service-role client in the admin-gated review route.
