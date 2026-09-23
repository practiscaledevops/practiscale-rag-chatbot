-- Project files: documents attached to a project whose extracted text is
-- injected as shared context into every chat in that project (like Claude
-- Projects' "project knowledge"). Owned by the same user as the project;
-- deleting the project cascades its files away.
--
-- Run this once in the Supabase SQL editor (or via the CLI) to enable the
-- "Project knowledge" panel on the project page. Everything else in the
-- project system works without it.

create table if not exists public.project_files (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  mime        text,
  size        integer,
  -- The extracted plain text (the Brain's /api/v1/extract output). Capped in
  -- the application layer; stored verbatim here.
  content     text not null default '',
  created_at  timestamptz not null default now()
);

create index if not exists project_files_project_id_idx on public.project_files (project_id);
create index if not exists project_files_user_id_idx on public.project_files (user_id);

alter table public.project_files enable row level security;

-- A user can only ever see or change their own project files (user_id = auth.uid()).
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'project_files' and policyname = 'project_files_select_own') then
    create policy "project_files_select_own" on public.project_files for select using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'project_files' and policyname = 'project_files_insert_own') then
    create policy "project_files_insert_own" on public.project_files for insert with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'project_files' and policyname = 'project_files_update_own') then
    create policy "project_files_update_own" on public.project_files for update using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'project_files' and policyname = 'project_files_delete_own') then
    create policy "project_files_delete_own" on public.project_files for delete using (user_id = auth.uid());
  end if;
end $$;
