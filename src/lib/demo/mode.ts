// DEMO MODE flag for the chatbot.
//
// When on, the app runs with NO Supabase and NO Brain key: auth is bypassed with
// a demo user, chat history/projects come from in-memory fixtures, and the
// assistant streams a canned grounded answer. Turn on with DEMO_MODE=1 (server)
// / NEXT_PUBLIC_DEMO_MODE=1 (client, for the login page's demo hints).
//
// SECURITY: demo mode disables authentication, so the SERVER decides it from
// the server-only DEMO_MODE variable alone — NEXT_PUBLIC_DEMO_MODE is a client
// convenience and is ignored server-side. In production it is OFF regardless,
// unless ALLOW_DEMO_IN_PRODUCTION=1 is set deliberately (a public demo host).

let warnedIgnored = false;

export function isDemo(): boolean {
  // Browser bundle: NEXT_PUBLIC_DEMO_MODE is inlined at build time; DEMO_MODE
  // never reaches the client. Keeps local demos working as before.
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_DEMO_MODE === "1";
  }

  if (process.env.DEMO_MODE !== "1") return false;

  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_DEMO_IN_PRODUCTION !== "1"
  ) {
    if (!warnedIgnored) {
      warnedIgnored = true;
      console.warn(
        "[demo] DEMO_MODE=1 is ignored in production (auth would be bypassed). " +
          "Set ALLOW_DEMO_IN_PRODUCTION=1 to run a deliberate public demo."
      );
    }
    return false;
  }
  return true;
}
