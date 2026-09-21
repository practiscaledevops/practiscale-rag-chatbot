import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { isDemo } from "@/lib/demo/mode";

// Paths that are reachable without a session. Everything else requires auth.
const PUBLIC_PATHS = ["/login"];

/**
 * Middleware runs on every matched request. It:
 *   1. Refreshes the Supabase session cookie (so it never silently expires), and
 *   2. Redirects unauthenticated users away from protected app routes to /login.
 *
 * The session is read via `getUser()` (verified), never trusted from the cookie.
 */
export async function middleware(request: NextRequest) {
  // DEMO MODE: no Supabase session — let every route through (getUser() returns
  // the demo user via the fake client). Decided server-side from DEMO_MODE only
  // (never the public flag), and off in production — see lib/demo/mode.
  if (isDemo()) {
    return NextResponse.next({ request });
  }

  // Start from a passthrough response we can attach refreshed cookies to.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[]
        ) {
          // Write refreshed cookies onto both the request (for downstream) and
          // the response (back to the browser).
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: getUser() refreshes the session as a side effect. Do not remove.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );

  // Where to send the user back to after sign-in: path + query, so a deep link
  // like /?prompt=… or /c/<id>?x=1 survives the round trip (the login page's
  // safeInternalPath only accepts a same-origin path, query included).
  const loginRedirect = () => {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("redirectedFrom", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  };

  // Unauthenticated + protected route -> send to /login (remember where we came
  // from so the login page can bounce back after success).
  if (!user && !isPublic) return loginRedirect();

  // MFA step-up: an authenticated user who has enrolled a second factor but has
  // only completed the first (aal1) must finish the challenge before reaching the
  // app. This ONLY affects users who chose to enroll MFA — anyone without a
  // verified factor stays at aal1==aal1 and is untouched. FAIL OPEN: any error in
  // the check is treated as "no step-up needed", so a hiccup can never lock users
  // out of the app.
  let needsMfa = false;
  if (user) {
    try {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      needsMfa = !!aal && aal.currentLevel === "aal1" && aal.nextLevel === "aal2";
    } catch {
      needsMfa = false;
    }
  }

  // Needs MFA + on a protected route -> bounce to /login to complete the second
  // factor (the login page detects the pending step-up and shows the code form).
  if (user && needsMfa && !isPublic) return loginRedirect();

  // Authenticated user hitting the login page -> send them into the app, UNLESS a
  // second factor is still pending (then let them stay on /login to complete it,
  // otherwise they'd bounce between /login and the app), or the app layout just
  // sent a DEACTIVATED account here (their session may still be valid for a
  // moment; bouncing them back to "/" would loop — the login page signs them out).
  const deactivated = request.nextUrl.searchParams.get("deactivated") === "1";
  if (user && !needsMfa && !deactivated && pathname === "/login") {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    homeUrl.search = "";
    return NextResponse.redirect(homeUrl);
  }

  return response;
}

export const config = {
  // Run on everything except Next internals and static assets. API routes are
  // intentionally excluded here — they enforce auth themselves and stream.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
