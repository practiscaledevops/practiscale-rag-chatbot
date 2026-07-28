// DEMO MODE flag for the chatbot.
//
// When on, the app runs with NO Supabase and NO Brain key: auth is bypassed with
// a demo user, chat history/projects come from in-memory fixtures, and the
// assistant streams a canned grounded answer. Turn on with DEMO_MODE=1 (server)
// / NEXT_PUBLIC_DEMO_MODE=1 (client).

export function isDemo(): boolean {
  return process.env.DEMO_MODE === "1" || process.env.NEXT_PUBLIC_DEMO_MODE === "1";
}
