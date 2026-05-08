import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Inactivity timeout: 30 minutes.
// Keep in sync with INACTIVITY_TIMEOUT_MS in src/components/session-timeout-manager.tsx.
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

const ACTIVITY_COOKIE = "rhodes_last_activity";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: Do not run code between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to
  // debug issues with users being randomly logged out.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicRoute =
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/auth") ||
    request.nextUrl.pathname.startsWith("/invite") ||
    request.nextUrl.pathname.startsWith("/access-restricted") ||
    request.nextUrl.pathname.startsWith("/api/invites") ||
    request.nextUrl.pathname.startsWith("/api/waitlist") ||
    request.nextUrl.pathname.startsWith("/api/health") ||
    request.nextUrl.pathname.startsWith("/api/cron") ||
    request.nextUrl.pathname === "/monitoring";

  // API requests get a 401 JSON; page requests get a redirect. Treating /api/*
  // identically to page nav (sending a 307 to /login) made expirations look
  // like silent successes from a fetch caller's perspective: the browser
  // followed the redirect, the response was the /login HTML at 200, the
  // SessionGuard's "status === 401" check never tripped, and the upload
  // pipeline read HTML as JSON and failed inside try/catch with no UI signal.
  // Returning 401 lets SessionGuard fire its overlay + redirect cleanly.
  const isApiRequest = request.nextUrl.pathname.startsWith("/api/");

  // Protect all routes except public ones
  if (!user && !isPublicRoute) {
    if (isApiRequest) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: { "X-Auth-Reason": "no-user" } },
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Inactivity timeout check (only for authenticated users on non-public routes).
  // No absolute session cap — users stay signed in indefinitely as long as they
  // keep interacting with the app.
  if (user && !isPublicRoute) {
    const now = Date.now();
    const lastActivity = request.cookies.get(ACTIVITY_COOKIE)?.value;

    if (lastActivity) {
      const elapsed = now - parseInt(lastActivity, 10);
      if (elapsed > INACTIVITY_TIMEOUT_MS) {
        await supabase.auth.signOut();
        if (isApiRequest) {
          const res = NextResponse.json(
            { error: "Session expired due to inactivity" },
            { status: 401, headers: { "X-Auth-Reason": "inactive" } },
          );
          res.cookies.delete(ACTIVITY_COOKIE);
          return res;
        }
        const url = request.nextUrl.clone();
        url.pathname = "/login";
        url.searchParams.set("reason", "inactive");
        const redirect = NextResponse.redirect(url);
        redirect.cookies.delete(ACTIVITY_COOKIE);
        return redirect;
      }
    }

    // Update activity timestamp on every middleware-handled request.
    supabaseResponse.cookies.set(ACTIVITY_COOKIE, now.toString(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24, // 24 hours (cookie lifetime, not timeout)
    });
  }

  return supabaseResponse;
}
