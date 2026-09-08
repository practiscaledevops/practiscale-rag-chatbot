-- 0004_user_prompts.sql — per-user saved prompt library.
--
-- Lets every chatbot user create and store their own reusable prompts (personas,
-- instructions, frequently-used questions) and insert them into the composer for
-- best-practice reuse. Each prompt belongs to exactly one user; RLS scopes every
-- row to its owner, so a user can only ever see and manage their own prompts.
--
-- Idempotent: safe to re-run.

create table if not exists public.user_prompts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null,
  body       text not null,
  -- Optional: pin a favourite to the top of the list.
  is_pinned  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_prompts_user_idx
  on public.user_prompts (user_id, is_pinned desc, updated_at desc);

alter table public.user_prompts enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'user_prompts' and policyname = 'user_prompts_select_own') then
    create policy "user_prompts_select_own" on public.user_prompts
      for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'user_prompts' and policyname = 'user_prompts_insert_own') then
    create policy "user_prompts_insert_own" on public.user_prompts
      for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'user_prompts' and policyname = 'user_prompts_update_own') then
    create policy "user_prompts_update_own" on public.user_prompts
      for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'user_prompts' and policyname = 'user_prompts_delete_own') then
    create policy "user_prompts_delete_own" on public.user_prompts
      for delete using (auth.uid() = user_id);
  end if;
end $$;

-- Keep updated_at fresh on every edit. Define a dedicated trigger function
-- (independent of other tables' triggers) and attach it.
create or replace function public.touch_user_prompts_updated_at()
returns trigger as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$ language plpgsql;

drop trigger if exists user_prompts_touch_updated_at on public.user_prompts;
create trigger user_prompts_touch_updated_at
  before update on public.user_prompts
  for each row execute function public.touch_user_prompts_updated_at();
