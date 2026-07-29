-- ===========================================================================
-- ===========================================================================
--  settings.sql
--  Idempotent, NON-DESTRUCTIVE workspace-settings store for the CHATBOT's OWN
--  Supabase project. It ADDS a single-row `app_settings` table used by the
--  /admin/settings panel — it never drops, truncates, or rewrites anything.
--
--  This holds ORG / APP-WIDE configuration (NOT per-user data):
--    • which models are enabled workspace-wide (a denylist of disabled ids)
--    • the default model / tier for new chats
--    • whether RAG grounding is on by default
--    • optional per-model price overrides ($/1M in + out) the cost calc can read
--
--  It is intentionally SEPARATE from admin.sql (owned by schema-foundation),
--  which does NOT create this table. No knowledge/vectors live here; the Brain
--  is only ever reached server-side through /api/chat.
--
--  STORAGE MODEL
--  -------------
--  A classic single-row "settings" table: `id` is pinned to 1 (a CHECK enforces
--  the singleton), and the actual config lives in a flexible `data` jsonb column
--  so the shape can evolve without a migration. The application merges the
--  stored jsonb over code-side defaults (see app/api/admin/settings/route.ts →
--  DEFAULT_SETTINGS / mergeSettings), so a missing key is never an error.
--
--  SECURITY: SERVICE-ROLE ONLY
--  ---------------------------
--  RLS is enabled AND forced with NO user-facing policies, so anon/authenticated
--  cannot read or write this table. Every access goes through the service-role
--  client (BYPASSRLS) in trusted server code:
--    • the admin panel reads/writes it after requireChatbotAdmin() (role check);
--    • server-side consumers (the chat route, server components) read it via the
--      service-role client to resolve the default model/tier, the RAG default,
--      the enabled-model set, and pricing overrides.
--  These are APP settings, not user rows — there is no per-user scoping to apply.
--
--  HOW TO RUN  (Supabase SQL editor)
--  ---------------------------------
--    1. Open the CHATBOT project (not the Brain) → SQL Editor → New query.
--    2. Paste this ENTIRE file and click "Run".
--    3. SAFE TO RE-RUN — every statement is idempotent and non-destructive.
-- ===========================================================================
-- ===========================================================================


-- ===========================================================================
-- SECTION 1 — TABLE  (single-row app_settings)
-- ---------------------------------------------------------------------------
-- `id` defaults to 1 and a CHECK pins it there, so the table can only ever hold
-- ONE row (the workspace's settings). `data` is the jsonb config blob; the app
-- overlays it on DEFAULT_SETTINGS, so an empty '{}' means "all defaults".
-- ===========================================================================
create table if not exists public.app_settings (
  id         integer primary key default 1,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint app_settings_singleton check (id = 1)
);

-- Seed the singleton row so the app always has a row to read/upsert. Idempotent:
-- a re-run leaves an existing row (and its saved settings) untouched.
insert into public.app_settings (id, data)
values (1, '{}'::jsonb)
on conflict (id) do nothing;


-- ===========================================================================
-- SECTION 2 — ROW-LEVEL SECURITY  (enable + FORCE, service-role only)
-- ---------------------------------------------------------------------------
-- Enable and FORCE RLS with NO permissive policies. With RLS forced and no
-- policy present, every anon/authenticated read AND write is denied; only
-- `service_role` (BYPASSRLS) can touch the table. Workspace settings are global
-- config, so there is no own-row policy to grant — the admin panel and the
-- server-side consumers both use the service-role client after a code-side check.
-- ===========================================================================
alter table public.app_settings enable row level security;
alter table public.app_settings force  row level security;


-- ===========================================================================
-- SECTION 3 — GRANTS / ROLE HARDENING
-- ---------------------------------------------------------------------------
-- service_role gets full access (server-side admin reads/writes); anon and
-- authenticated are explicitly revoked. Idempotent — re-running re-asserts.
-- ===========================================================================
grant usage on schema public to service_role;
grant all   on public.app_settings to service_role;
revoke all  on public.app_settings from anon, authenticated;


-- ===========================================================================
-- SECTION 4 — COMMENTS  (self-documenting catalog)
-- ===========================================================================
comment on table public.app_settings is
  'Single-row (id = 1) workspace/app settings for the chatbot. jsonb `data` holds enabled-model denylist, default model/tier, RAG default, and per-model price overrides. Service-role only (RLS forced, no user policies); the app merges `data` over code-side DEFAULT_SETTINGS (app/api/admin/settings/route.ts).';
comment on column public.app_settings.id is
  'Always 1 — a CHECK enforces the singleton so the table holds exactly one settings row.';
comment on column public.app_settings.data is
  'jsonb settings blob (default {}). Shape: { disabledModels: string[], defaultModel: string, defaultModelKind: "tier"|"model", ragDefaultOn: boolean, pricingOverrides: { [modelId]: { inputPerMTok: number|null, outputPerMTok: number|null } } }. Missing keys fall back to DEFAULT_SETTINGS in code.';
comment on column public.app_settings.updated_at is
  'When the settings row was last written by the admin panel (set server-side on every PUT).';

-- Refresh planner stats (cheap on a one-row table).
analyze public.app_settings;

-- ===========================================================================
-- END settings.sql
-- ===========================================================================
