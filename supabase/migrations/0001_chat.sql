-- 0001_chat.sql — chatbot's OWN database schema (separate from the Brain).
-- Tables: profiles, projects, conversations, messages.
-- Every table is guarded by row-level security scoped to the signed-in user
-- (user_id = auth.uid()); profiles are scoped by their own id.

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user, id mirrors auth.users.id.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text,
  display_name text,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- projects: grouped context (a name + optional system prompt).
-- ---------------------------------------------------------------------------
create table if not exists public.projects (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  name          text not null,
  system_prompt text,
  created_at    timestamptz not null default now()
);

create index if not exists projects_user_id_idx on public.projects (user_id);

-- ---------------------------------------------------------------------------
-- conversations: a chat thread, optionally attached to a project.
-- ---------------------------------------------------------------------------
create table if not exists public.conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  title      text,
  model_tier text not null default 'recommended'
             check (model_tier in ('fast', 'recommended', 'max')),
  created_at timestamptz not null default now()
);

create index if not exists conversations_user_id_idx on public.conversations (user_id);
create index if not exists conversations_project_id_idx on public.conversations (project_id);

-- ---------------------------------------------------------------------------
-- messages: individual turns within a conversation, with citations + token
-- counts for the usage meter.
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  role            text not null check (role in ('user', 'assistant', 'system')),
  content         text not null default '',
  citations       jsonb not null default '[]'::jsonb,
  input_tokens    integer not null default 0,
  output_tokens   integer not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists messages_conversation_id_idx on public.messages (conversation_id);
create index if not exists messages_user_id_idx on public.messages (user_id);

-- ===========================================================================
-- Row-level security. Enable on every table and scope rows to the owner.
-- ===========================================================================
alter table public.profiles      enable row level security;
alter table public.projects      enable row level security;
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;

-- profiles: owner is the row id itself.
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- projects
create policy "projects_select_own" on public.projects
  for select using (auth.uid() = user_id);
create policy "projects_insert_own" on public.projects
  for insert with check (auth.uid() = user_id);
create policy "projects_update_own" on public.projects
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "projects_delete_own" on public.projects
  for delete using (auth.uid() = user_id);

-- conversations
create policy "conversations_select_own" on public.conversations
  for select using (auth.uid() = user_id);
create policy "conversations_insert_own" on public.conversations
  for insert with check (auth.uid() = user_id);
create policy "conversations_update_own" on public.conversations
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "conversations_delete_own" on public.conversations
  for delete using (auth.uid() = user_id);

-- messages
create policy "messages_select_own" on public.messages
  for select using (auth.uid() = user_id);
create policy "messages_insert_own" on public.messages
  for insert with check (auth.uid() = user_id);
create policy "messages_update_own" on public.messages
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "messages_delete_own" on public.messages
  for delete using (auth.uid() = user_id);

-- ===========================================================================
-- Auto-provision a profile row when a new auth user is created.
-- ===========================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
