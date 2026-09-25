-- 0014_replace_conversation_messages.sql — atomic thread saves.
--
-- Every save replaces a conversation's messages (delete its rows, insert the
-- new list). Done as two separate statements, two saves of one thread at once
-- — /api/chat's server-side save of a finished turn and the client's own save,
-- or two turns finishing in the background — can interleave as delete, delete,
-- insert, insert and leave the thread duplicated. This function does the
-- replace in ONE transaction, serialized per conversation by an advisory lock
-- (under READ COMMITTED the second DELETE would otherwise miss the first's
-- freshly inserted rows), so concurrent saves end as last writer wins.
--
-- SECURITY
--   • SECURITY INVOKER: runs as the caller, so RLS on public.messages still
--     applies — the delete only reaches the caller's own rows, and the insert's
--     WITH CHECK requires the conversation to be the caller's (otherwise the
--     whole call fails and rolls back). user_id is always auth.uid(); the rows'
--     own conversation_id / user_id keys, if any, are ignored.
--   • search_path pinned to ''. Executable by `authenticated` only (it needs
--     auth.uid(); `anon` gets nothing).
--
-- Before this runs the app keeps working: saves fall back to the separate
-- delete + insert (src/lib/replace-messages.ts).
--
-- Idempotent: safe to re-run.

create or replace function public.replace_conversation_messages(p_conversation_id uuid, p_rows jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_conversation_id::text, 0));
  delete from public.messages where conversation_id = p_conversation_id;
  insert into public.messages
    (conversation_id, user_id, role, content, citations, input_tokens, output_tokens, created_at)
  select p_conversation_id,
         auth.uid(),
         r.role,
         coalesce(r.content, ''),
         coalesce(r.citations, '[]'::jsonb),
         coalesce(r.input_tokens, 0),
         coalesce(r.output_tokens, 0),
         coalesce(r.created_at, now())
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
      as r(role text, content text, citations jsonb, input_tokens int, output_tokens int, created_at timestamptz);
end;
$$;

revoke all on function public.replace_conversation_messages(uuid, jsonb) from public, anon;
grant execute on function public.replace_conversation_messages(uuid, jsonb) to authenticated;

comment on function public.replace_conversation_messages(uuid, jsonb) is
  'SECURITY INVOKER: replace a conversation''s messages with p_rows in one transaction, serialized per conversation (advisory lock). RLS applies; user_id = auth.uid().';
