-- ===========================================================================
-- ===========================================================================
--  admin.sql
--  Idempotent, NON-DESTRUCTIVE admin / teams / usage layer for the CHATBOT's
--  OWN Supabase project. It ADDS to the existing schema created by
--  supabase/setup/chatbot_full.sql (profiles, projects, conversations,
--  messages) — it never drops, truncates, or rewrites any of them.
--
--  This is the Practiscale RAG Chatbot's private database (auth + chat history
--  + projects + admin/usage). It is SEPARATE from the Brain (the RAG back
--  office). No knowledge/vectors live here; the Brain is only ever reached
--  server-side through /api/chat. This file NEVER touches the Brain's data.
--
--  WHAT THIS FILE ADDS
--  -------------------
--    • profiles          → role, is_active, team_id, permissions (jsonb),
--                          can_use_all_models  (+ email/display_name backfill)
--    • teams             → org units with an optional monthly budget
--    • team_members      → membership (team_id, user_id) with a member role
--    • usage_events      → one row per metered model call (tokens + cost)
--    • RLS + indexes + grants + comments for all of the above
--
--  HOW TO RUN  (Supabase SQL editor)
--  ---------------------------------
--    1. Run supabase/setup/chatbot_full.sql FIRST (this file assumes profiles,
--       projects, conversations, messages already exist).
--    2. Open the CHATBOT project (not the Brain) → SQL Editor → New query.
--    3. Paste this ENTIRE file and click "Run".
--    4. It is SAFE TO RE-RUN. Every statement is idempotent
--       ("if not exists" / "add column if not exists" / guarded DO blocks /
--       drop-then-create policies) and NON-DESTRUCTIVE.
--
--  ─────────────────────────────────────────────────────────────────────────
--  MANUAL POST-STEP (do this once, out of band, after the first run)
--  ─────────────────────────────────────────────────────────────────────────
--  Promote the super-admin. Run this ONE statement in the SQL editor, editing
--  the address to your real admin account if different:
--
--        update public.profiles set role = 'super_admin'
--        where email = 'admin@practiscale.co';
--
--  (No user should ever be able to grant themselves a role from the app: role
--  is written only by service-role code or by a human in the SQL editor. The
--  RLS profiles_update_own policy from chatbot_full.sql lets a user update
--  their own row, but the admin panel and gating logic read role via the
--  service-role client — never trusting a client-supplied claim.)
--
--  RUN ORDER inside the file (top → bottom, do not reorder):
--    1. Tables            4. Row-Level Security
--    2. profiles columns  5. Grants / role hardening
--    3. Indexes           6. Comments
-- ===========================================================================
-- ===========================================================================


-- ===========================================================================
-- SECTION 1 — TABLES  (teams + team_members + usage_events)
-- ---------------------------------------------------------------------------
-- Created BEFORE the profiles.team_id ALTER below, because that column carries
-- a foreign key to teams(id). All are `create table if not exists`, so a
-- re-run is a no-op. FKs to auth.users cascade on user delete (a removed user
-- takes their membership + usage with them); FKs to teams/conversations use
-- ON DELETE SET NULL so deleting a team or a thread never deletes usage rows.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- teams — an org unit / workspace with an optional monthly spend budget.
-- team_members is the source of truth for membership; profiles.team_id (added
-- in Section 2) is an OPTIONAL pointer to a user's PRIMARY team for convenience.
-- ---------------------------------------------------------------------------
create table if not exists public.teams (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  description       text,
  monthly_budget_usd numeric(12,2),
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- team_members — who belongs to which team, and their role within it.
--   role: member | manager | owner  (team-scoped; distinct from profiles.role,
--          which is the APP-wide privilege level user|admin|super_admin).
-- Composite PK (team_id, user_id) makes membership unique and indexes team_id.
-- ---------------------------------------------------------------------------
create table if not exists public.team_members (
  team_id    uuid not null references public.teams (id)   on delete cascade,
  user_id    uuid not null references auth.users (id)     on delete cascade,
  role       text not null default 'member',
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

-- team_members.role ∈ {member, manager, owner}  (guarded so re-runs skip it).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'team_members_role_check'
      and conrelid = 'public.team_members'::regclass
  ) then
    alter table public.team_members
      add constraint team_members_role_check
      check (role in ('member', 'manager', 'owner'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- usage_events — one row per metered model call, written server-side (service
-- role) after a Brain chat settles. Feeds the per-user usage meter and the
-- admin/team analytics. cost_usd is an ESTIMATE from lib/pricing.ts until the
-- Brain reports authoritative billing.
--   provider : "anthropic" | "openai" (from the Brain's x-provider header)
--   model    : resolved model id      (from the Brain's x-model header)
--   tier     : requested tier or model ("fast"|"recommended"|"max"|concrete id)
-- ---------------------------------------------------------------------------
create table if not exists public.usage_events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  team_id         uuid references public.teams (id) on delete set null,
  conversation_id uuid references public.conversations (id) on delete set null,
  provider        text,
  model           text,
  tier            text,
  input_tokens    integer not null default 0,
  output_tokens   integer not null default 0,
  cost_usd        numeric(12,6) not null default 0,
  latency_ms      integer,
  created_at      timestamptz not null default now()
);

-- Non-negative token / cost CHECKs (guarded; trivial validating scan on an
-- empty/new table). Same NOT VALID / VALIDATE split as chatbot_full.sql applies
-- if you ever add these to an already-large usage_events table under load.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'usage_events_input_tokens_nonneg'
      and conrelid = 'public.usage_events'::regclass
  ) then
    alter table public.usage_events
      add constraint usage_events_input_tokens_nonneg check (input_tokens >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'usage_events_output_tokens_nonneg'
      and conrelid = 'public.usage_events'::regclass
  ) then
    alter table public.usage_events
      add constraint usage_events_output_tokens_nonneg check (output_tokens >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'usage_events_cost_nonneg'
      and conrelid = 'public.usage_events'::regclass
  ) then
    alter table public.usage_events
      add constraint usage_events_cost_nonneg check (cost_usd >= 0);
  end if;
end $$;


-- ===========================================================================
-- SECTION 2 — PROFILES COLUMNS  (admin role, activation, team, permissions)
-- ---------------------------------------------------------------------------
-- Purely additive `add column if not exists` back-fills onto the existing
-- profiles table. Every column has a safe default so pre-existing rows become
-- valid immediately: role='user', is_active=true, permissions='{}',
-- can_use_all_models=false, team_id=null.
--
-- PERMISSIONS JSONB SHAPE  (profiles.permissions, default '{}')
-- -------------------------------------------------------------
-- Per-user feature/model access. All keys are OPTIONAL; an empty object '{}'
-- means "no explicit restriction" (the app treats an absent allowlist as
-- unrestricted — see lib/models.ts filterModelsByPermissions):
--   {
--     "models":        ["claude-*", "gpt-4o-mini"],  -- allowlist of model-id
--                                                     --   globs ("*" wildcard)
--                                                     --   or exact ids
--     "features":      ["rag", "projects", "attachments", "connectors"],
--     "allowed_tiers": ["fast", "recommended"]        -- subset of the tiers
--                                                     --   fast|recommended|max
--   }
-- The boolean profiles.can_use_all_models OVERRIDES the "models" allowlist:
-- when true the user may select any model the Brain exposes, regardless of the
-- allowlist above.
-- ===========================================================================
alter table public.profiles
  add column if not exists role text not null default 'user';

alter table public.profiles
  add column if not exists is_active boolean not null default true;

-- email / display_name already exist in chatbot_full.sql; re-asserted here so
-- admin.sql is safe to run even against an older profiles table.
alter table public.profiles add column if not exists email        text;
alter table public.profiles add column if not exists display_name text;

alter table public.profiles
  add column if not exists team_id uuid references public.teams (id) on delete set null;

alter table public.profiles
  add column if not exists permissions jsonb not null default '{}'::jsonb;

alter table public.profiles
  add column if not exists can_use_all_models boolean not null default false;

-- profiles.role ∈ {user, admin, super_admin}  (guarded so re-runs skip it).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_role_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_role_check
      check (role in ('user', 'admin', 'super_admin'));
  end if;
end $$;


-- ===========================================================================
-- SECTION 3 — INDEXES  (matched to the admin/usage query paths)
-- ---------------------------------------------------------------------------
-- Usage analytics read "a user's events over time" and "a team's events over
-- time"; the admin panel also slices by model. Every FK is covered by a btree.
-- Plain `create index if not exists` — the tables are new/empty, so no
-- meaningful lock. For an already-large usage_events table under live traffic,
-- build the concurrent form MANUALLY (one statement per editor run, outside any
-- transaction), then re-run this file to reconcile the rest.
-- ===========================================================================

-- Per-user usage meter: this user's events, newest first / time-ranged.
create index if not exists usage_events_user_created_idx
  on public.usage_events (user_id, created_at desc);

-- Per-team roll-ups: a team's events over time. Partial (non-null) keeps it
-- small — team_id is null for users with no primary team.
create index if not exists usage_events_team_created_idx
  on public.usage_events (team_id, created_at desc)
  where team_id is not null;

-- Admin "cost by model" breakdown.
create index if not exists usage_events_model_idx
  on public.usage_events (model);

-- Whole-fleet time-range reporting (admin dashboards).
create index if not exists usage_events_created_idx
  on public.usage_events (created_at desc);

-- conversation_id FK btree (covers the SET NULL cascade on thread delete).
create index if not exists usage_events_conversation_id_idx
  on public.usage_events (conversation_id)
  where conversation_id is not null;

-- team_members.user_id: powers "which teams am I in" (the teams RLS subquery)
-- and the FK cascade on user delete. (team_id is already the PK prefix.)
create index if not exists team_members_user_id_idx
  on public.team_members (user_id);

-- profiles.team_id FK btree (covers the SET NULL cascade on team delete).
create index if not exists profiles_team_id_idx
  on public.profiles (team_id)
  where team_id is not null;


-- ===========================================================================
-- SECTION 4 — ROW-LEVEL SECURITY  (enable + FORCE + least-privilege policies)
-- ---------------------------------------------------------------------------
-- Enable RLS on all three new tables and FORCE it (so even the table owner /
-- SQL-editor context is row-scoped). `service_role` has BYPASSRLS and is
-- intentionally exempt — the admin panel reads across all users/teams via the
-- service-role client with an explicit code-side role check (see lib/admin.ts).
--
-- Normal (anon-key / authenticated) users get READ-ONLY, own-scoped access:
--   • usage_events : SELECT own rows (user_id = auth.uid()). No client writes —
--                    events are inserted server-side via the service role.
--   • teams        : SELECT teams they belong to (via team_members).
--   • team_members : SELECT their OWN membership rows only. A full team roster
--                    is an admin view served by the service role. (Restricting
--                    to own rows also avoids same-table RLS recursion.)
-- No user-facing INSERT/UPDATE/DELETE policies are defined for these tables:
-- with RLS enabled + forced, the absence of a permissive write policy denies
-- those writes for every non-service role. Admin mutations go through the
-- service-role client after a code role-check.
-- ===========================================================================
alter table public.teams        enable row level security;
alter table public.team_members enable row level security;
alter table public.usage_events enable row level security;

alter table public.teams        force row level security;
alter table public.team_members force row level security;
alter table public.usage_events force row level security;

-- ---- usage_events (owner = user_id) ---------------------------------------
drop policy if exists usage_events_select_own on public.usage_events;
create policy usage_events_select_own on public.usage_events
  for select using (auth.uid() = user_id);

-- ---- teams (visible to members) -------------------------------------------
-- The EXISTS subquery reads team_members, whose own-rows RLS restricts it to
-- the caller's memberships — exactly the set we want, with no recursion.
drop policy if exists teams_select_member on public.teams;
create policy teams_select_member on public.teams
  for select using (
    exists (
      select 1 from public.team_members m
      where m.team_id = teams.id
        and m.user_id = auth.uid()
    )
  );

-- ---- team_members (owner = user_id) ---------------------------------------
drop policy if exists team_members_select_own on public.team_members;
create policy team_members_select_own on public.team_members
  for select using (auth.uid() = user_id);


-- ===========================================================================
-- SECTION 5 — GRANTS / ROLE HARDENING
-- ---------------------------------------------------------------------------
-- authenticated gets SELECT only (row-scoped by the policies above);
-- service_role gets full access (BYPASSRLS, server-side admin + ingestion);
-- anon is explicitly revoked. Idempotent — re-running just re-asserts.
-- ===========================================================================
grant usage on schema public to authenticated, service_role;

grant select on public.teams        to authenticated;
grant select on public.team_members to authenticated;
grant select on public.usage_events to authenticated;

grant all on public.teams        to service_role;
grant all on public.team_members to service_role;
grant all on public.usage_events to service_role;

revoke all on public.teams        from anon;
revoke all on public.team_members from anon;
revoke all on public.usage_events from anon;


-- ===========================================================================
-- SECTION 6 — COMMENTS  (self-documenting catalog)
-- ===========================================================================
comment on table public.teams        is 'Org unit / workspace with an optional monthly spend budget. Membership lives in team_members; profiles.team_id points to a user''s primary team. Visible (RLS) to its members; managed by service-role admin code.';
comment on table public.team_members is 'Team membership (team_id, user_id) with a team-scoped role (member|manager|owner). RLS: a user sees only their own membership rows; the full roster is an admin (service-role) view.';
comment on table public.usage_events is 'One row per metered model call (tokens + estimated cost_usd from lib/pricing.ts), written server-side via the service role. Feeds the per-user usage meter and admin/team analytics. RLS: a user sees only their own events.';

comment on column public.teams.monthly_budget_usd     is 'Optional soft monthly USD budget for the team; enforced/alerted in application code, not by the DB.';
comment on column public.team_members.role            is 'Team-scoped role: member | manager | owner. Distinct from profiles.role (the app-wide privilege level).';

comment on column public.profiles.role                is 'App-wide privilege level: user | admin | super_admin. Read SERVER-SIDE via the service-role client (lib/admin.ts requireChatbotAdmin) — never trusted from a client claim. Written only by service-role code or a human in the SQL editor.';
comment on column public.profiles.is_active           is 'Soft-disable flag. An inactive profile is treated as unauthorized by admin gating even if the auth session is still valid.';
comment on column public.profiles.team_id             is 'Optional pointer to the user''s PRIMARY team; team_members remains the source of truth for membership. ON DELETE SET NULL.';
comment on column public.profiles.permissions         is 'jsonb per-user access map (default {}). Optional keys: "models" (allowlist of model-id globs/exact ids, e.g. ["claude-*","gpt-4o-mini"]), "features" (e.g. ["rag","projects","attachments","connectors"]), "allowed_tiers" (subset of fast|recommended|max). Empty {} = no explicit restriction.';
comment on column public.profiles.can_use_all_models  is 'When true, OVERRIDES permissions.models: the user may select any model the Brain exposes regardless of the allowlist.';

comment on column public.usage_events.provider        is 'Model provider from the Brain''s x-provider header: anthropic | openai.';
comment on column public.usage_events.model           is 'Resolved model id from the Brain''s x-model header (e.g. claude-opus-4-8, gpt-4o).';
comment on column public.usage_events.tier            is 'Requested tier or model: fast | recommended | max, or a concrete model id.';
comment on column public.usage_events.cost_usd        is 'ESTIMATED cost for this call (lib/pricing.ts) until the Brain reports authoritative billing. numeric(12,6).';
comment on column public.usage_events.latency_ms      is 'Wall-clock latency of the Brain call in milliseconds (nullable).';

-- ===========================================================================
-- Refresh planner stats for the new tables/indexes. Cheap on empty tables.
-- ===========================================================================
analyze public.teams;
analyze public.team_members;
analyze public.usage_events;
analyze public.profiles;

-- ===========================================================================
-- END admin.sql
-- ===========================================================================
