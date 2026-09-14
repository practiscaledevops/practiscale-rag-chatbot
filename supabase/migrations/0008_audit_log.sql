-- 0008_audit_log.sql — governance audit trail.
-- Records sensitive events (chat requests with their mode + whether sensitive
-- knowledge was in scope, CEO-memory reads/writes) for review. Admins can read
-- their org's log; rows are written only by the SERVICE-ROLE client server-side.
-- The app degrades gracefully (skips logging) until this table exists.

create table if not exists public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid,
  action     text not null,        -- e.g. 'chat', 'ceo_memory_read', 'ceo_memory_write'
  detail     jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists audit_log_created_idx on public.audit_log (created_at desc);
create index if not exists audit_log_user_idx on public.audit_log (user_id, created_at desc);

alter table public.audit_log enable row level security;

-- Admins/super-admins may READ the log; there is no client INSERT policy, so
-- rows are written only by the service-role client (server-side).
drop policy if exists "audit read admins" on public.audit_log;
create policy "audit read admins" on public.audit_log
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'super_admin')
    )
  );
