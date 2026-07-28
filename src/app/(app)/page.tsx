import { ChatView } from "./_components/ChatView";

/**
 * New-chat root ("/"). Renders an empty chat surface; the first completed turn
 * creates a conversation and swaps the URL to /c/[id] without a full reload.
 * Auth is enforced by (app)/layout.tsx and the middleware.
 */
export default function NewChatPage() {
  return <ChatView />;
}
