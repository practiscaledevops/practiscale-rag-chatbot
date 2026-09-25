// The idempotency decisions behind /api/chat's server-side save of a finished
// turn (captureAndSaveTurn). Pure, so they can be tested without a database.
//
// /api/chat drains its own copy of the answer and, after a short grace for the
// client's save, writes `prior + answer` unless:
//   - the stored thread already holds THIS turn (turnAlreadySaved): the stored
//     row where the answer belongs — the (n+1)-th user/assistant row, n = the
//     user/assistant turns that were posted — is an assistant row with this
//     text (or the start of it: the answer cut short by Stop, as the client
//     saved it), right after the message that asked for it. Counting only
//     user/assistant rows keeps a compaction summary (a system row) inserted
//     since from shifting the position; or
//   - the thread was saved since this request started, and that save is newer
//     than this answer. The route checks the conversation's updated_at against
//     the value read when the request started (one conditional UPDATE). A later
//     save is newer — the client's save of a Stop's partial answer, a
//     regenerate, an edit, a new turn, another tab — unless it only brought the
//     thread up to (a start of) the history this request was built on
//     (storedLeadsTo): the previous turn's own save landing after this one was
//     sent, e.g. queued turns answered back to back in the background.
//
// So: nothing saved yet (navigated away mid-stream, or a queued turn that
// finished in the background) → save; a regenerated answer or an edited
// message's new branch with nothing saved since it was sent (the tab closed
// mid-answer) → save, replacing the old one as the client itself would; a
// stopped request whose copy finishes after the user moved on → skip.

/** A stored message row (content optional: turnAlreadySaved reads just two rows' content). */
export interface StoredTurnRow {
  role: string;
  content?: string | null;
}

/** User/assistant turns (a system row is a compaction summary). */
function isTurn(role: string): boolean {
  return role !== "system";
}

function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim() === (b ?? "").trim();
}

/**
 * Index, in the stored rows (ordered by created_at), where the answer to
 * `prior` sits — or -1 when the stored thread doesn't reach that far.
 */
export function storedAnswerIndex(
  storedRoles: readonly string[],
  priorRoles: readonly string[]
): number {
  const target = priorRoles.filter(isTurn).length;
  let seen = 0;
  for (let i = 0; i < storedRoles.length; i++) {
    if (!isTurn(storedRoles[i])) continue;
    if (seen === target) return i;
    seen++;
  }
  return -1;
}

/** The user/assistant row just before `index` (the message the answer replies to), or -1. */
export function previousTurnIndex(storedRoles: readonly string[], index: number): number {
  for (let i = index - 1; i >= 0; i--) if (isTurn(storedRoles[i])) return i;
  return -1;
}

/**
 * Whether a stored row is this answer: an assistant row with the same text —
 * or the start of it (what the client saves when the user pressed Stop).
 */
export function isStoredAnswer(
  row: StoredTurnRow | null | undefined,
  answer: string
): boolean {
  if (!row || row.role !== "assistant") return false;
  const text = answer.trim();
  const stored = (row.content ?? "").trim();
  return text.length > 0 && stored.length > 0 && (stored === text || text.startsWith(stored));
}

/**
 * Whether the stored thread's user/assistant rows are the start of `prior`
 * (the history the request was built on): each matches the posted turn at its
 * position and none runs past it. Summaries (system rows) are left out on both
 * sides. Writing `prior + answer` over such a thread only adds to it.
 */
export function storedLeadsTo(
  stored: readonly StoredTurnRow[],
  prior: readonly { role: string; content: string }[]
): boolean {
  const saved = stored.filter((r) => isTurn(r.role));
  const posted = prior.filter((m) => isTurn(m.role));
  if (saved.length > posted.length) return false;
  return saved.every((r, i) => r.role === posted[i].role && sameText(r.content, posted[i].content));
}

/**
 * Whether the stored thread already contains this finished turn, so the
 * server-side save is skipped. `stored` is the thread in created_at order;
 * only the answer's row and the one before it need their content.
 */
export function turnAlreadySaved(
  stored: readonly StoredTurnRow[],
  prior: readonly { role: string; content: string }[],
  answer: string
): boolean {
  const roles = stored.map((r) => r.role);
  const idx = storedAnswerIndex(
    roles,
    prior.map((m) => m.role)
  );
  if (idx < 0 || !isStoredAnswer(stored[idx], answer)) return false;
  // …and it answers THIS message (not an edited-away one with a similar answer).
  const asked = [...prior].reverse().find((m) => isTurn(m.role));
  if (!asked) return true;
  const prev = stored[previousTurnIndex(roles, idx)];
  return !!prev && prev.role === asked.role && sameText(prev.content, asked.content);
}
