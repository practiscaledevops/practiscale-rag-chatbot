# CLAUDE.md — Practiscale RAG Chatbot

Read this before making changes.

## What this is

This is a **consumer app (spoke)** in the Practiscale platform. It is a full,
Claude-like conversational product. It does **not** hold any knowledge itself —
it reads everything from **the Brain** (the RAG back-office) through the Brain's
public API, authenticated with a **scoped secret key**.

- The Brain repo: `practsicale-rag-backend-` (the hub). Its blueprint is
  `docs/00-master-plan.md` in that repo.
- This chatbot has its **own separate database** (Supabase) for users, chat
  history, chatrooms, and projects — never mixed with the Brain's data.

## Golden security rule

`BRAIN_API_KEY` is a scoped secret. It is used **server-side only** (in
`src/lib/brain.ts` and `src/app/api/chat`). It must **never** be imported into a
client component or shipped to the browser. The browser calls this app's
`/api/chat`, which forwards to the Brain with the key.

## Tech stack

- Next.js 15 (App Router) + React 19 + TypeScript on Vercel (region `sin1`)
- Vercel AI SDK (`ai`, `@ai-sdk/react`) for streaming chat
- Tailwind CSS, lucide-react
- Supabase (own project) for auth + chat history + projects

## Planned features (the full product)

Logins & user accounts · thread history (rename, search, pin, archive) ·
chatrooms · projects (grouped context) · **model/tier switcher** (fast /
recommended / max, forwarded to the Brain) · **token/usage meter** ·
**connectors** (MCP + third-party integrations the Brain exposes) · streamed,
grounded, cited responses · fastest possible time-to-first-token.

## Layout

```
src/
  app/page.tsx            Chat UI (starter; grows into the full product)
  app/api/chat/route.ts   Forwards to the Brain, streams back (holds the key)
  lib/brain.ts            Server-side Brain client (scoped key lives here)
```

## Commands

```bash
npm install
npm run dev         # http://localhost:3001  (Brain runs on :3000)
npm run typecheck
```

Run the Brain locally on port 3000 and set `BRAIN_API_URL=http://localhost:3000`
plus a scoped `BRAIN_API_KEY` in `.env.local`.
