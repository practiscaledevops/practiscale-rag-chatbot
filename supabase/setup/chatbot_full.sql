-- ===========================================================================
-- ===========================================================================
--  chatbot_full.sql
--  Consolidated, idempotent, enterprise setup for the CHATBOT's OWN database.
--  Target: Supabase Postgres 15 (region: Singapore / ap-southeast-1).
--
--  This is the Practiscale RAG Chatbot's private Supabase project — auth users,
--  profiles, projects, conversations and messages. It is SEPARATE from the
--  Brain (the RAG back-office). No knowledge/vectors live here; the Brain is
--  only ever reached server-side through /api/chat. This file NEVER touches the
--  Brain's data.
--
--  WHAT THIS FILE IS
--  -----------------
--  A single, self-contained superset of the two historical migrations:
--     • 0001_chat.sql               (profiles, projects, conversations, messages,
--                                    RLS, handle_new_user)
--     • 0002_conversation_history.sql (conversations.pinned, .updated_at, touch
--                                    trigger, sidebar sort index)
--  plus enterprise hardening (indexes for scale, force-RLS, per-command
--  policies, autovacuum tuning, observability, comments). It is a STRICT,
--  NON-BREAKING SUPERSET: every table name, column name, type, default and the
--  ordering contract the live Next.js app depends on is preserved exactly.
--
--  HOW TO RUN  (Supabase SQL editor)
--  ---------------------------------
--    1. Open the CHATBOT project (not the Brain) → SQL Editor → New query.
--    2. Paste this ENTIRE file and click "Run".
--    3. It is SAFE TO RE-RUN. The script is idempotent, re-runnable and
--       NON-DESTRUCTIVE: it never drops a table, drops a column, or truncates.
--       Running it on a brand-new project or on an existing (0001/0002-migrated)
--       project both converge to the same hardened state without data loss.
--
--  RUN ORDER inside the file (top → bottom, do not reorder):
--    0. Extensions & schemas        6. Grants / role hardening
--    1. Tables (create + add col)   7. Autovacuum tuning
--    2. Constraints (checks)        8. Comments (docs)
--    3. Indexes                     9. ANALYZE + scaling notes
--    4. Functions & triggers
--    5. Row-Level Security
--
--  MANUAL / OUT-OF-BAND POST-STEPS
--  -------------------------------
--    • Auth hook: the on_auth_user_created trigger on auth.users auto-provisions
--      a profiles row. It is created below. If your project instead uses a
--      GoTrue "before/after user created" Auth Hook, you may disable the trigger
--      — but keep ONE of the two so profiles are always provisioned.
--    • pg_cron / scheduled VACUUM is not required; per-table autovacuum tuning
--      (Section 7) handles the high-churn messages table.
--    • For a large existing messages table, see the CONCURRENT-INDEX note in
--      Section 3 before creating indexes under load.
--    • ANALYZE runs at the end; re-run manually after any bulk import.
--
--  SUPABASE NOTES
--  --------------
--    • Roles: anon, authenticated, service_role. App queries run as
--      `authenticated` and are row-scoped by RLS (auth.uid()). Server-side
--      ingestion uses `service_role`, which has BYPASSRLS and is intentionally
--      not row-scoped.
--    • This script is normally run as the `postgres` role (the SQL editor's
--      role), which on Supabase carries BYPASSRLS. profiles keeps plain RLS
--      ENABLE (not FORCE), so the SECURITY DEFINER handle_new_user() insert
--      succeeds via the table-owner RLS bypass for ANY runner — bypassrls or not
--      (see Section 4 / Section 5 comments).
-- ===========================================================================
-- ===========================================================================


-- ===========================================================================
-- SECTION 0 — EXTENSIONS & SCHEMAS  (observability + crypto)
-- ---------------------------------------------------------------------------
-- On Supabase, extensions live in the dedicated `extensions` schema, never in
-- `public`. gen_random_uuid() (used as a PK default below) is a core function
-- on PG13+, so it works regardless; pgcrypto is enabled for parity/other uses.
-- pg_stat_statements powers query observability (slow-query / hot-path review).
-- All are "if not exists" and therefore idempotent.
-- ===========================================================================
create schema if not exists extensions;

create extension if not exists pgcrypto           with schema extensions;
create extension if not exists pg_stat_statements with schema extensions;


-- ===========================================================================
-- SECTION 1 — TABLES  (superset of 0001 + 0002; exact contract preserved)
-- ---------------------------------------------------------------------------
-- Strategy for idempotency across fresh AND already-migrated projects:
--   (a) `create table if not exists` builds the full superset on a fresh DB;
--   (b) `alter table ... add column if not exists` back-fills any column that a
--       partially-migrated DB might be missing (e.g. 0002's pinned/updated_at),
--       so an existing table is upgraded in place — never dropped/recreated.
-- Foreign keys are declared inline (idempotent via create-table-if-not-exists)
-- and all reference auth.users with ON DELETE CASCADE. CHECK constraints are
-- added separately in Section 2 with catalog guards.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- profiles — one row per auth user; id mirrors auth.users.id.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text,
  display_name text,
  created_at   timestamptz not null default now()
);

alter table public.profiles add column if not exists email        text;
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists created_at   timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- projects — grouped context: a name + optional system_prompt.
-- ---------------------------------------------------------------------------
create table if not exists public.projects (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  name          text not null,
  system_prompt text,
  created_at    timestamptz not null default now()
);

alter table public.projects add column if not exists name          text;
alter table public.projects add column if not exists system_prompt text;
alter table public.projects add column if not exists created_at    timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- conversations — a chat thread, optionally attached to a project.
--   model_tier: fast | recommended | max  (forwarded to the Brain)
--   pinned    : user pins a thread to the top of history        (from 0002)
--   updated_at: last-touched, drives the "most recent" sort      (from 0002)
-- ON DELETE SET NULL on project_id: deleting a project detaches, not deletes,
-- its conversations (the app relies on this).
-- ---------------------------------------------------------------------------
create table if not exists public.conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  title      text,
  model_tier text not null default 'recommended',
  pinned     boolean     not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Back-fill columns onto a pre-0002 conversations table, if needed.
alter table public.conversations add column if not exists project_id uuid references public.projects (id) on delete set null;
alter table public.conversations add column if not exists title      text;
alter table public.conversations add column if not exists model_tier text        not null default 'recommended';
alter table public.conversations add column if not exists pinned     boolean     not null default false;
alter table public.conversations add column if not exists created_at timestamptz not null default now();
alter table public.conversations add column if not exists updated_at timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- messages — individual turns; citations + token counts feed the usage meter.
--   role         : user | assistant | system
--   citations    : jsonb array of { id } markers extracted from assistant text
--   input_tokens / output_tokens : estimated usage until the Brain reports exact
-- HIGH-CHURN: the app replaces (delete + insert) a thread's rows on every save,
-- so messages is the busiest table — tuned for autovacuum in Section 7.
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  role            text not null,
  content         text not null default '',
  citations       jsonb not null default '[]'::jsonb,
  input_tokens    integer not null default 0,
  output_tokens   integer not null default 0,
  created_at      timestamptz not null default now()
);

alter table public.messages add column if not exists content       text    not null default '';
alter table public.messages add column if not exists citations     jsonb   not null default '[]'::jsonb;
alter table public.messages add column if not exists input_tokens  integer not null default 0;
alter table public.messages add column if not exists output_tokens integer not null default 0;
alter table public.messages add column if not exists created_at    timestamptz not null default now();


-- ===========================================================================
-- SECTION 2 — CONSTRAINTS  (CHECKs, added with catalog guards)
-- ---------------------------------------------------------------------------
-- Added via DO-block guards on pg_constraint so the script is re-runnable and
-- also repairs an existing table that somehow lacks them. The role/model_tier
-- constraint NAMES match what 0001's inline CHECKs auto-generate
-- (<table>_<column>_check), so on a 0001-migrated DB these are detected and
-- skipped — no duplication, no error.
--
-- The non-negative token CHECKs are NEW (not in 0001). They are added validated
-- in one statement. Existing data always satisfies them (defaults + app write
-- >= 0), so on a fresh/empty project or a normal re-run the validating scan is
-- trivial. NOTE: adding a validated CHECK takes a brief ACCESS EXCLUSIVE lock and
-- scans the table. If you must add these to an ALREADY-LARGE, live messages table,
-- do NOT rely on this in-script single-transaction add; instead run each as a
-- separate `ADD CONSTRAINT ... NOT VALID` followed by a `VALIDATE CONSTRAINT` in
-- its OWN transaction, outside any surrounding transaction, e.g.:
--     alter table public.messages
--       add constraint messages_input_tokens_nonneg check (input_tokens >= 0) not valid;
--     -- then, separately:
--     alter table public.messages validate constraint messages_input_tokens_nonneg;
-- ===========================================================================
do $$
begin
  -- messages.role ∈ {user, assistant, system}
  if not exists (
    select 1 from pg_constraint
    where conname = 'messages_role_check'
      and conrelid = 'public.messages'::regclass
  ) then
    alter table public.messages
      add constraint messages_role_check
      check (role in ('user', 'assistant', 'system'));
  end if;

  -- conversations.model_tier ∈ {fast, recommended, max}
  if not exists (
    select 1 from pg_constraint
    where conname = 'conversations_model_tier_check'
      and conrelid = 'public.conversations'::regclass
  ) then
    alter table public.conversations
      add constraint conversations_model_tier_check
      check (model_tier in ('fast', 'recommended', 'max'));
  end if;

  -- messages.input_tokens >= 0   (new; validated in one statement)
  if not exists (
    select 1 from pg_constraint
    where conname = 'messages_input_tokens_nonneg'
      and conrelid = 'public.messages'::regclass
  ) then
    alter table public.messages
      add constraint messages_input_tokens_nonneg check (input_tokens >= 0);
  end if;

  -- messages.output_tokens >= 0  (new; validated in one statement)
  if not exists (
    select 1 from pg_constraint
    where conname = 'messages_output_tokens_nonneg'
      and conrelid = 'public.messages'::regclass
  ) then
    alter table public.messages
      add constraint messages_output_tokens_nonneg check (output_tokens >= 0);
  end if;
end $$;


-- ===========================================================================
-- SECTION 3 — INDEXES  (matched to the app's exact hot query paths)
-- ---------------------------------------------------------------------------
-- Query contract locked from src/ (Supabase JS builders):
--   • Sidebar / history list  (layout.tsx, /api/conversations GET):
--       from("conversations").eq(user_id).order(pinned desc).order(updated_at desc)
--       optionally .eq(project_id)
--       →  composite (user_id, pinned desc, updated_at desc)  matches WHERE+ORDER
--       →  partial (project_id) covers the project-filtered variant + the FK
--   • Thread loader           (c/[id]/page.tsx, replaceMessages):
--       from("messages").eq(conversation_id).order(created_at asc)
--       →  composite (conversation_id, created_at)
--   • messages by user        (RLS user_id predicate + delete .eq(user_id)):
--       →  (user_id)
--   • projects list           (/api/projects GET):
--       from("projects").eq(user_id).order(created_at desc)
--       →  composite (user_id, created_at desc)
-- Every FOREIGN KEY is covered by a btree (as an index prefix or its own index),
-- so parent deletes/cascades never trigger a sequential scan.
--
-- LOCK-SAFETY NOTE (large existing tables):
--   These use plain `create index if not exists` because the Supabase SQL editor
--   may run the script in a single transaction, and CREATE INDEX CONCURRENTLY
--   cannot run inside a transaction block (nor inside a DO block). On a fresh
--   project the tables are empty, so a normal build takes no meaningful lock.
--   If you must add an index to an ALREADY-LARGE messages table under live
--   traffic, run the concurrent form MANUALLY, one statement per editor
--   execution, OUTSIDE any transaction, e.g.:
--       create index concurrently if not exists messages_conversation_id_created_at_idx
--         on public.messages (conversation_id, created_at);
--   then re-run this file to reconcile the rest.
-- ===========================================================================

-- Sidebar: a user's threads, pinned first, most-recently-touched first.
-- (Same name as 0002 so a migrated DB keeps its existing index.)
create index if not exists conversations_user_pinned_updated_idx
  on public.conversations (user_id, pinned desc, updated_at desc);

-- Project filter + FK btree. Partial (project_id is not null) keeps it small;
-- non-null is exactly the set the FK/join and project filter touch.
-- (Same name as 0001. If 0001 created a non-partial index of this name, it is
--  kept as-is — functionally equivalent, just larger — never dropped.)
create index if not exists conversations_project_id_idx
  on public.conversations (project_id)
  where project_id is not null;

-- Ordered thread fetch + conversation_id FK btree.
create index if not exists messages_conversation_id_created_at_idx
  on public.messages (conversation_id, created_at);

-- messages.user_id FK btree + RLS user predicate + delete-by-user path.
create index if not exists messages_user_id_idx
  on public.messages (user_id);

-- projects list (newest first) + user_id FK btree (as prefix).
create index if not exists projects_user_id_created_at_idx
  on public.projects (user_id, created_at desc);


-- ===========================================================================
-- SECTION 4 — FUNCTIONS & TRIGGERS
-- ---------------------------------------------------------------------------
-- All are `create or replace` / `drop trigger if exists` + `create trigger`,
-- so they are idempotent. Every function pins `search_path = ''` and
-- fully-qualifies object names to prevent search_path injection (built-ins
-- resolve via pg_catalog, which is always implicitly first).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- handle_new_user — auto-provision a profiles row when an auth user is created.
-- SECURITY DEFINER so it runs as the function owner. profiles uses plain RLS
-- ENABLE (NOT FORCE, see Section 5), so the function owner keeps the table-owner
-- RLS bypass and this insert always succeeds — even though it fires during the
-- auth.users insert when there is no auth.uid() to satisfy a user-scoped policy,
-- and regardless of whether the owner carries BYPASSRLS.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
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

-- ---------------------------------------------------------------------------
-- touch_conversation_updated_at — keep updated_at current on every UPDATE.
-- (from 0002; search_path pinned as hardening.)
-- ---------------------------------------------------------------------------
create or replace function public.touch_conversation_updated_at()
returns trigger
language plpgsql
set search_path = ''
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

-- ---------------------------------------------------------------------------
-- touch_conversations_on_message — when messages are INSERTed, bump the parent
-- conversation's updated_at so the sidebar re-sorts (active threads rise).
-- STATEMENT-LEVEL with a transition table so a multi-row insert (the app writes
-- a whole thread at once) bumps each affected conversation ONCE — not per row.
-- The bump UPDATE fires the BEFORE-UPDATE touch above (harmless, no recursion:
-- updating conversations never inserts messages). Under RLS this runs as the
-- caller: `authenticated` bumps only their own conversation (policy passes);
-- `service_role` bypasses RLS. Idempotent via drop-if-exists + create.
-- ---------------------------------------------------------------------------
create or replace function public.touch_conversations_on_message()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.conversations c
     set updated_at = now()
    from (select distinct conversation_id from new_messages) s
   where c.id = s.conversation_id;
  return null;
end;
$$;

drop trigger if exists messages_bump_conversation on public.messages;
create trigger messages_bump_conversation
  after insert on public.messages
  referencing new table as new_messages
  for each statement execute function public.touch_conversations_on_message();


-- ===========================================================================
-- SECTION 5 — ROW-LEVEL SECURITY  (enable + FORCE + per-command policies)
-- ---------------------------------------------------------------------------
-- Every tenant table gets RLS ENABLED. FORCE makes even the table owner
-- row-scoped, closing the gap where owner-context queries (SQL editor,
-- SECURITY DEFINER functions) would otherwise bypass policies. On Supabase the
-- app roles (`authenticated`, `anon`) are never the owner, so RLS already
-- applies to them; FORCE hardens the owner path too. `service_role` has
-- BYPASSRLS and is intentionally exempt (server ingestion).
--
-- EXCEPTION — profiles is NOT forced (see the per-table note below): its sole
-- owner-context writer is the trusted handle_new_user() provisioner, which runs
-- before auth.uid() exists and so cannot satisfy any user-scoped policy. Leaving
-- the owner-bypass intact keeps signup working for ANY script runner, not only a
-- BYPASSRLS one, while ENABLE still fully scopes anon/authenticated.
--
-- Policies are per-command (select / insert / update / delete) and EVERY write
-- policy carries WITH CHECK, so a row can never be written outside the caller's
-- scope. profiles are scoped by their own id; all other tables by user_id.
-- Policies are (re)created with drop-if-exists so the script is idempotent.
-- ===========================================================================
alter table public.profiles      enable row level security;
alter table public.projects      enable row level security;
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;

-- profiles is deliberately NOT forced: its only owner-context writer is the
-- trusted SECURITY DEFINER handle_new_user() (fired during the auth.users insert,
-- when there is no auth.uid(), so profiles_insert_own's `auth.uid() = id` would
-- evaluate false). Plain RLS ENABLE keeps the owner-bypass intact so that
-- provisioning insert always succeeds regardless of whether the script's runner
-- carries BYPASSRLS. anon/authenticated are never the table owner, so ENABLE
-- still fully scopes them. The other tables have no owner-context writer, so
-- FORCE is safe there and hardens the SQL-editor/owner path.
alter table public.profiles      no force row level security;
alter table public.projects      force row level security;
alter table public.conversations force row level security;
alter table public.messages      force row level security;

-- ---- profiles (owner = row id) --------------------------------------------
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Delete policy included for a complete per-command set. The app never deletes
-- profiles directly; the real lifecycle is ON DELETE CASCADE from auth.users
-- (which runs system-side, unaffected by this policy).
drop policy if exists profiles_delete_own on public.profiles;
create policy profiles_delete_own on public.profiles
  for delete using (auth.uid() = id);

-- ---- projects (owner = user_id) -------------------------------------------
drop policy if exists projects_select_own on public.projects;
create policy projects_select_own on public.projects
  for select using (auth.uid() = user_id);

drop policy if exists projects_insert_own on public.projects;
create policy projects_insert_own on public.projects
  for insert with check (auth.uid() = user_id);

drop policy if exists projects_update_own on public.projects;
create policy projects_update_own on public.projects
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists projects_delete_own on public.projects;
create policy projects_delete_own on public.projects
  for delete using (auth.uid() = user_id);

-- ---- conversations (owner = user_id) --------------------------------------
drop policy if exists conversations_select_own on public.conversations;
create policy conversations_select_own on public.conversations
  for select using (auth.uid() = user_id);

drop policy if exists conversations_insert_own on public.conversations;
create policy conversations_insert_own on public.conversations
  for insert with check (auth.uid() = user_id);

drop policy if exists conversations_update_own on public.conversations;
create policy conversations_update_own on public.conversations
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists conversations_delete_own on public.conversations;
create policy conversations_delete_own on public.conversations
  for delete using (auth.uid() = user_id);

-- ---- messages (owner = user_id) -------------------------------------------
drop policy if exists messages_select_own on public.messages;
create policy messages_select_own on public.messages
  for select using (auth.uid() = user_id);

-- WITH CHECK also verifies the target conversation is owned by the caller, so a
-- user cannot attach a message (even one with their own user_id) to another
-- user's conversation. This is defense-in-depth / referential integrity on top
-- of the user_id scope. Applied to the two write paths that set conversation_id
-- (insert + update). service_role bypasses RLS, so server ingestion is
-- unaffected.
drop policy if exists messages_insert_own on public.messages;
create policy messages_insert_own on public.messages
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

drop policy if exists messages_update_own on public.messages;
create policy messages_update_own on public.messages
  for update using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

drop policy if exists messages_delete_own on public.messages;
create policy messages_delete_own on public.messages
  for delete using (auth.uid() = user_id);


-- ===========================================================================
-- SECTION 6 — GRANTS / ROLE HARDENING
-- ---------------------------------------------------------------------------
-- These are user-owned tables reached only by a signed-in session. We grant
-- table DML to `authenticated` (row-scoped by RLS) and full access to
-- `service_role` (BYPASSRLS, server ingestion), and REVOKE `anon` — anonymous
-- visitors must never touch chat/user data. (Supabase's default privileges can
-- auto-grant `anon` on tables created in `public`; the explicit revoke below
-- overrides that and is defense-in-depth on top of RLS returning zero rows for
-- a null auth.uid().) All statements are idempotent.
-- ===========================================================================
grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on public.profiles      to authenticated;
grant select, insert, update, delete on public.projects      to authenticated;
grant select, insert, update, delete on public.conversations to authenticated;
grant select, insert, update, delete on public.messages      to authenticated;

grant all on public.profiles      to service_role;
grant all on public.projects      to service_role;
grant all on public.conversations to service_role;
grant all on public.messages      to service_role;

revoke all on public.profiles      from anon;
revoke all on public.projects      from anon;
revoke all on public.conversations from anon;
revoke all on public.messages      from anon;


-- ===========================================================================
-- SECTION 7 — AUTOVACUUM TUNING  (high-churn tables)
-- ---------------------------------------------------------------------------
-- `messages` is delete+insert-heavy: the app replaces a thread's rows on every
-- save, generating dead tuples fast. Tighter thresholds keep bloat and index
-- fragmentation in check and keep the planner's stats fresh for the hot
-- (conversation_id, created_at) path. `conversations` is update-heavy
-- (updated_at bumps on every activity) and gets lighter tuning. Storage params
-- are declarative — re-running just re-asserts them.
-- ===========================================================================
alter table public.messages set (
  autovacuum_vacuum_scale_factor        = 0.05,   -- vacuum at ~5% dead rows
  autovacuum_analyze_scale_factor       = 0.02,   -- re-analyze at ~2% churn
  autovacuum_vacuum_insert_scale_factor = 0.05,   -- PG13+: vacuum on inserts too
  autovacuum_vacuum_cost_limit          = 2000    -- let autovacuum do more work per round
);

alter table public.conversations set (
  autovacuum_vacuum_scale_factor  = 0.10,
  autovacuum_analyze_scale_factor = 0.05
);


-- ===========================================================================
-- SECTION 8 — COMMENTS  (self-documenting catalog)
-- ===========================================================================
comment on table public.profiles      is 'One row per auth user; id mirrors auth.users.id. Auto-provisioned by handle_new_user(). Owner-scoped by id (RLS enabled, NOT forced so the definer provisioner keeps owner-bypass).';
comment on table public.projects      is 'Grouped context (name + optional system_prompt) that scopes new chats. Owner-scoped by user_id (RLS forced).';
comment on table public.conversations is 'A chat thread, optionally attached to a project. Sorted in the sidebar by (pinned desc, updated_at desc). Owner-scoped by user_id (RLS forced).';
comment on table public.messages      is 'Individual turns within a conversation, with citations + token counts for the usage meter. High-churn (replaced per save); autovacuum-tuned. Owner-scoped by user_id (RLS forced).';

comment on column public.profiles.display_name        is 'Human-friendly name; defaults to the email local-part at signup.';
comment on column public.projects.system_prompt       is 'Optional extra context forwarded to the Brain; stored as data, never executed as instructions.';
comment on column public.conversations.model_tier     is 'Model/tier switch forwarded to the Brain: fast | recommended | max.';
comment on column public.conversations.pinned         is 'User-pinned threads sort to the top of the history list.';
comment on column public.conversations.updated_at     is 'Last-touched timestamp; bumped by the touch trigger and by message inserts so the sidebar re-sorts.';
comment on column public.messages.citations           is 'jsonb array of { id } markers extracted from assistant text; resolved to full source metadata by a later feature.';
comment on column public.messages.input_tokens        is 'Estimated prompt tokens for this turn (~len/4) until the Brain reports exact usage.';
comment on column public.messages.output_tokens       is 'Estimated completion tokens for this turn (~len/4) until the Brain reports exact usage.';

comment on function public.handle_new_user()               is 'SECURITY DEFINER: auto-provision a profiles row on auth.users insert. search_path pinned; profiles keeps RLS ENABLE (not FORCE) so the definer owner writes via owner-bypass, independent of BYPASSRLS.';
comment on function public.touch_conversation_updated_at() is 'BEFORE UPDATE on conversations: set updated_at = now().';
comment on function public.touch_conversations_on_message() is 'AFTER INSERT (statement-level) on messages: bump parent conversation.updated_at once per affected conversation so the sidebar re-sorts.';


-- ===========================================================================
-- SECTION 9 — STATS REFRESH + SCALING NOTES
-- ---------------------------------------------------------------------------
-- Refresh planner statistics so the new indexes are costed correctly right
-- away. Cheap on empty/small tables; re-run manually after any bulk import.
-- ===========================================================================
analyze public.profiles;
analyze public.projects;
analyze public.conversations;
analyze public.messages;

-- ---------------------------------------------------------------------------
-- SCALING PATH FOR `messages` (read before reaching for partitioning)
-- ---------------------------------------------------------------------------
-- The access pattern is almost entirely "fetch one thread": WHERE conversation_id
-- = $1 ORDER BY created_at. The composite index
-- (conversation_id, created_at) turns that into a single tight index range scan,
-- which stays fast into the hundreds of millions of rows on a single table.
--
-- If/when messages grows very large, in order of preference:
--   1. Keep the row lean. Token counts are ints; citations is small jsonb. Push
--      any future large blobs (raw model traces, attachments) to a side table
--      or object storage, not into `messages`.
--   2. Index for the query, not the clock. The hot path never filters by a time
--      RANGE across the whole table, so a global time index is not needed. If a
--      per-conversation analytics query emerges, extend the existing composite;
--      for whole-table time-range reporting only, a BRIN index on created_at is
--      far cheaper than a btree.
--   3. Move aggregates out. If usage-meter roll-ups get heavy, maintain a small
--      per-conversation or per-user summary table rather than scanning messages.
--
-- WHY NOT TIME-PARTITION messages:
--   Range-partitioning by created_at does NOT help this workload. A conversation
--   fetch keys on conversation_id, which is uncorrelated with time, so the
--   planner CANNOT prune partitions — every thread read would touch every
--   partition (scatter-gather), making the hot path SLOWER, not faster, plus the
--   operational overhead of partition maintenance. If the table ever truly must
--   be partitioned, HASH-partition by conversation_id (co-locating a thread in
--   one partition and preserving single-partition thread reads) — but only past
--   the point where a single tuned table with the composite btree can't keep up,
--   which is well beyond typical chat volumes.
-- ===========================================================================
-- END chatbot_full.sql
-- ===========================================================================
