"use client";

import { useChat } from "@ai-sdk/react";
import { useState } from "react";
import { Send } from "lucide-react";

type Tier = "fast" | "recommended" | "max";

// Minimal starting UI. The full Claude-like product (auth, chat history,
// chatrooms, projects, connectors, token meter) is built in the chatbot phase.
export default function Home() {
  const [tier, setTier] = useState<Tier>("recommended");
  const { messages, input, handleInputChange, handleSubmit, status } = useChat({
    api: "/api/chat",
    body: { tier },
  });
  const busy = status === "submitted" || status === "streaming";

  return (
    <main className="mx-auto flex h-screen max-w-3xl flex-col">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <h1 className="text-sm font-semibold">Practiscale Assistant</h1>
        <label className="flex items-center gap-2 text-xs text-neutral-500">
          Model
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value as Tier)}
            className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700"
          >
            <option value="fast">Fast</option>
            <option value="recommended">Recommended</option>
            <option value="max">Max quality</option>
          </select>
        </label>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="mt-20 text-center text-sm text-neutral-400">
            Ask a question grounded in your Practiscale knowledge base.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "text-right" : "text-left"}>
            <div
              className={
                "inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm " +
                (m.role === "user"
                  ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                  : "bg-neutral-100 dark:bg-neutral-800")
              }
            >
              {m.content}
            </div>
          </div>
        ))}
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-t border-neutral-200 p-3 dark:border-neutral-800"
      >
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="Message the assistant…"
          className="flex-1 rounded-xl border border-neutral-300 bg-transparent px-4 py-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-xl bg-neutral-900 p-2 text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
          aria-label="Send"
        >
          <Send size={18} />
        </button>
      </form>
    </main>
  );
}
