# Practiscale RAG Chatbot

A full, Claude-like conversational assistant. It is a **consumer app** of the
**Practiscale Brain** (the RAG back-office): it holds no knowledge of its own and
reads everything from the Brain's public API using a **scoped secret key**.

## How it fits

```
Browser ──▶ this app /api/chat ──(scoped key, server-side)──▶ Brain /api/v1/chat ──▶ grounded, cited answer
```

- The scoped key stays on the server; the browser never sees it.
- This app has its **own database** (Supabase) for users, chat history, and projects.

## Quick start

1. Run the Brain locally (its repo) on `http://localhost:3000`, and mint a scoped
   key in its dashboard (or seed script).
2. Here:
   ```bash
   npm install
   cp .env.example .env.local     # set BRAIN_API_URL + BRAIN_API_KEY (+ Supabase)
   npm run dev                    # http://localhost:3001
   ```
3. Ask a question — the answer is grounded in whatever data the key is scoped to.

## Status

Starter scaffold: a working streaming chat UI + a secure server-side Brain proxy.
The full product (logins, history, chatrooms, projects, connectors, token meter)
is built out in the chatbot phase. See `CLAUDE.md`.
