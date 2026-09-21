import { ChatView } from "./_components/ChatView";

/** Longest prompt the URL may seed into the composer (keeps the URL sane). */
const MAX_SEEDED_PROMPT = 4000;

/**
 * New-chat root ("/"). Renders an empty chat surface; the first completed turn
 * creates a conversation and swaps the URL to /c/[id] without a full reload.
 * Auth is enforced by (app)/layout.tsx and the middleware.
 *
 * `/?prompt=<text>` pre-fills the composer (used by "Ask about this" on the
 * Brain map / object drawer); the user still presses Send.
 */
export default async function NewChatPage({
  searchParams,
}: {
  searchParams: Promise<{ prompt?: string | string[] }>;
}) {
  const { prompt } = await searchParams;
  const raw = Array.isArray(prompt) ? prompt[0] : prompt;
  const initialInput = typeof raw === "string" && raw.trim() ? raw.slice(0, MAX_SEEDED_PROMPT) : undefined;
  return <ChatView initialInput={initialInput} />;
}
