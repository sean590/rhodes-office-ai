import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Inactivity timeout: 30 minutes
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;
// Maximum session length: 8 hours
const MAX_SESSION_MS = 8 * 60 * 60 * 1000;

const ACTIVITY_COOKIE = "rhodes_last_activity";
const SESSION_START_COOKIE = "rhodes_session_start";

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
    request.nextUrl.pathname.startsWith("/api/invites") ||
    request.nextUrl.pathname.startsWith("/api/health") ||
    request.nextUrl.pathname.startsWith("/api/cron") ||
    request.nextUrl.pathname === "/monitoring";

  // Protect all routes except public ones
  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Session timeout checks (only for authenticated users on non-public routes)
  if (user && !isPublicRoute) {
    const now = Date.now();
    const lastActivity = request.cookies.get(ACTIVITY_COOKIE)?.value;
    const sessionStart = request.cookies.get(SESSION_START_COOKIE)?.value;

    // Check inactivity timeout
    if (lastActivity) {
      const elapsed = now - parseInt(lastActivity, 10);
      if (elapsed > INACTIVITY_TIMEOUT_MS) {
        await supabase.auth.signOut();
        const url = request.nextUrl.clone();
        url.pathname = "/login";
        url.searchParams.set("reason", "inactive");
        const redirect = NextResponse.redirect(url);
        redirect.cookies.delete(ACTIVITY_COOKIE);
        redirect.cookies.delete(SESSION_START_COOKIE);
        return redirect;
      }
    }

    // Check maximum session length
    if (sessionStart) {
      const elapsed = now - parseInt(sessionStart, 10);
      if (elapsed > MAX_SESSION_MS) {
        await supabase.auth.signOut();
        const url = request.nextUrl.clone();
        url.pathname = "/login";
        url.searchParams.set("reason", "expired");
        const redirect = NextResponse.redirect(url);
        redirect.cookies.delete(ACTIVITY_COOKIE);
        redirect.cookies.delete(SESSION_START_COOKIE);
        return redirect;
      }
    }

    // Update activity timestamp and set session start if missing
    supabaseResponse.cookies.set(ACTIVITY_COOKIE, now.toString(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24, // 24 hours (cookie lifetime, not timeout)
    });

    if (!sessionStart) {
      supabaseResponse.cookies.set(SESSION_START_COOKIE, now.toString(), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24,
      });
    }
  }

  return supabaseResponse;
}
