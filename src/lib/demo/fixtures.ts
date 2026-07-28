// In-memory demo data for the chatbot (DEMO MODE). One demo user with a couple
// of projects, several conversations, and their messages. The store is a
// module-level singleton so new chats/renames persist for the dev-server life.

export const DEMO_USER_ID = "00000000-0000-0000-0000-0000000000b1";
export const DEMO_USER = { id: DEMO_USER_ID, email: "demo@practiscale.co" };

type Row = Record<string, any>;
export type Store = Record<string, Row[]>;

const iso = (daysAgo: number, hour = 12) => {
  const anchor = new Date("2026-07-29T00:00:00Z").getTime();
  return new Date(anchor - daysAgo * 86400000 + hour * 3600000).toISOString();
};

function seed(): Store {
  const uid = DEMO_USER_ID;

  const profiles: Row[] = [
    { id: uid, email: "demo@practiscale.co", display_name: "Demo User", created_at: iso(40) },
  ];

  const projects: Row[] = [
    { id: "proj-1", user_id: uid, name: "NEMT outreach", system_prompt: "You are helping the NEMT sales team. Prefer reliability-led messaging.", created_at: iso(10) },
    { id: "proj-2", user_id: uid, name: "Coaching drafts", system_prompt: null, created_at: iso(6) },
  ];

  const conversations: Row[] = [
    { id: "conv-1", user_id: uid, project_id: "proj-1", title: "Discovery weaknesses", model_tier: "recommended", pinned: true, created_at: iso(1, 9), updated_at: iso(0, 9) },
    { id: "conv-2", user_id: uid, project_id: "proj-1", title: "NEMT cold email angle", model_tier: "max", pinned: false, created_at: iso(2, 10), updated_at: iso(2, 11) },
    { id: "conv-3", user_id: uid, project_id: null, title: "Objection: price too high", model_tier: "fast", pinned: false, created_at: iso(4, 14), updated_at: iso(4, 14) },
    { id: "conv-4", user_id: uid, project_id: "proj-2", title: "Coaching summary — week 30", model_tier: "recommended", pinned: false, created_at: iso(5, 16), updated_at: iso(5, 16) },
  ];

  const messages: Row[] = [
    { id: "m-1", conversation_id: "conv-1", user_id: uid, role: "user", content: "Where are reps weakest and how do we improve?", citations: [], input_tokens: 0, output_tokens: 0, created_at: iso(1, 9) },
    { id: "m-2", conversation_id: "conv-1", user_id: uid, role: "assistant", content: "Based on the call-scoring data, reps score highest on closing (avg 84/100) and lowest on discovery (avg 61/100). Recommendation: tighten discovery questioning before pitching. [demo-chunk-1] [demo-chunk-2]", citations: [{ id: "demo-chunk-1" }, { id: "demo-chunk-2" }], input_tokens: 1180, output_tokens: 96, created_at: iso(1, 9) },
    { id: "m-3", conversation_id: "conv-2", user_id: uid, role: "user", content: "Give me a cold email angle for NEMT.", citations: [], input_tokens: 0, output_tokens: 0, created_at: iso(2, 10) },
    { id: "m-4", conversation_id: "conv-2", user_id: uid, role: "assistant", content: "Lead with reliability and on-time performance — facility coordinators treat price as secondary. [demo-chunk-3]", citations: [{ id: "demo-chunk-3" }], input_tokens: 900, output_tokens: 60, created_at: iso(2, 10) },
  ];

  return { profiles, projects, conversations, messages };
}

let _store: Store | null = null;
export function demoStore(): Store {
  if (!_store) _store = seed();
  return _store;
}
