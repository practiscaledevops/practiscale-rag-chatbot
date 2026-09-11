// Pure formatting helpers for the chat surface (no React, unit-testable).

/**
 * Turn a useChat error into a readable, non-alarming sentence. The upstream
 * /api/chat returns JSON like {error, status, detail} on a non-200, and a plain
 * string on a mid-stream failure; extract the most useful human part of either.
 */
export function friendlyError(err: { message?: string } | undefined): string {
  const fallback = "Something went wrong reaching the assistant. Please try again.";
  const raw = err?.message?.trim();
  if (!raw) return fallback;
  let msg = raw;
  try {
    const parsed = JSON.parse(raw) as { error?: unknown; detail?: unknown };
    const detail =
      typeof parsed.detail === "string" && parsed.detail.trim() ? parsed.detail.trim() : "";
    const error =
      typeof parsed.error === "string" && parsed.error.trim() ? parsed.error.trim() : "";
    msg = detail || error || raw;
  } catch {
    // Not JSON — use the string as-is.
  }
  if (!msg) return fallback;
  return msg.length > 280 ? `${msg.slice(0, 280)}…` : msg;
}

/**
 * Split an assistant message into display text + selectable options. The Brain
 * emits choices as a fenced ```options block (see the chat prompt); we lift them
 * out so the UI can render clickable chips instead of a code block. Handles an
 * unclosed block mid-stream by hiding the partial block until it completes.
 */
export function parseOptions(content: string): { text: string; options: string[] } {
  const closed = content.match(/```options[^\n]*\r?\n([\s\S]*?)```/);
  if (closed) {
    const options = closed[1]
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*[-*\d.]+\s*/, "").trim())
      .filter(Boolean)
      .slice(0, 8);
    return { text: content.replace(closed[0], "").trimEnd(), options };
  }
  // Unclosed block while streaming: hide it until the closing fence arrives.
  const open = content.match(/```options[\s\S]*$/);
  if (open && open.index !== undefined) {
    return { text: content.slice(0, open.index).trimEnd(), options: [] };
  }
  return { text: content, options: [] };
}
