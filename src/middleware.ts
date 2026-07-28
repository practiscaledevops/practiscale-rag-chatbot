import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

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
  // the demo user via the fake client).
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "1" || process.env.DEMO_MODE === "1") {
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

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );

  // Unauthenticated + protected route -> send to /login (remember where we came
  // from so the login page can bounce back after success).
  if (!user && !isPublic) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("redirectedFrom", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated user hitting the login page -> send them into the app.
  if (user && pathname === "/login") {
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
