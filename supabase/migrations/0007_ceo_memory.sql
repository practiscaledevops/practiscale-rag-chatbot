-- 0007_ceo_memory.sql — private, per-user CEO/executive memory.
-- Holds the executive's private priorities, principles, and preferences, injected
-- into CEO mode so answers are tailored — kept in the CHATBOT db, never in the
-- shared Brain knowledge, so it can never surface in team retrieval or citations.
--
-- ISOLATION: RLS is enabled but NO policies are created, which means the
-- anon/authenticated client can NEVER read or write this table directly. Only the
-- SERVICE-ROLE client (server-side, after a super_admin identity check in
-- /api/ceo/memory and /api/chat) touches it. This is the hard boundary that keeps
-- private CEO context out of normal user mode. The app is written to work with OR
-- without this table (CEO memory is simply empty until it exists).

create table if not exists public.ceo_memory (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  content    text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.ceo_memory enable row level security;
-- Intentionally NO policies: locked to the service-role client only.
