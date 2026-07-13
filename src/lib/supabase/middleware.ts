import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { MFA_STATE_COOKIE } from "@/lib/utils/mfa-state";

/**
 * Decode the `aal` claim from a session access token. No network, no signature
 * verify — getUser() has already validated this token upstream, so its claims
 * are trustworthy; this is only a UX redirect signal (the real boundary is the
 * server-side requireAal2). Returns null if the claim can't be read.
 */
function readAalClaim(accessToken: string): "aal1" | "aal2" | null {
  try {
    const part = accessToken.split(".")[1];
    if (!part) return null;
    // base64url → base64, then decode as UTF-8. atob + TextDecoder are available
    // in both the Edge and Node middleware runtimes (Buffer is not, on Edge).
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const json = JSON.parse(new TextDecoder().decode(bytes)) as { aal?: string };
    return json.aal === "aal2" ? "aal2" : json.aal === "aal1" ? "aal1" : null;
  } catch {
    return null;
  }
}

// Inactivity timeout: 30 minutes.
// Keep in sync with INACTIVITY_TIMEOUT_MS in src/components/session-timeout-manager.tsx.
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

// Absolute session cap: 12 hours from login, enforced even on an active session.
// Backstop to the native Supabase session timebox (Auth > Sessions). The
// `rhodes_session_start` cookie is set once at /auth/callback and never refreshed,
// so this is a hard ceiling. Keep in sync with session-timeout-manager.tsx.
const ABSOLUTE_SESSION_CAP_MS = 12 * 60 * 60 * 1000;

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
    request.nextUrl.pathname.startsWith("/access-restricted") ||
    request.nextUrl.pathname.startsWith("/api/invites") ||
    request.nextUrl.pathname.startsWith("/api/waitlist") ||
    request.nextUrl.pathname.startsWith("/api/health") ||
    request.nextUrl.pathname.startsWith("/api/cron") ||
    // Secure document share links: providers are NOT Rhodes users. Access is
    // gated by the unguessable token + server-side expiry/revocation checks.
    request.nextUrl.pathname.startsWith("/share") ||
    request.nextUrl.pathname.startsWith("/api/share") ||
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

  // Session-expiry checks (authenticated users on non-public routes): an absolute
  // 12h cap from login AND a 30-min inactivity timeout. Either one signs the user
  // out. The absolute cap bounds a hijacked session even if it's kept "active".
  if (user && !isPublicRoute) {
    const now = Date.now();

    // Build the sign-out response (401 JSON for API, redirect for pages) and
    // clear the session cookies. `reason` distinguishes inactive vs expired.
    const expireSession = async (reason: "inactive" | "expired", message: string) => {
      await supabase.auth.signOut();
      if (isApiRequest) {
        const res = NextResponse.json(
          { error: message },
          { status: 401, headers: { "X-Auth-Reason": reason } },
        );
        res.cookies.delete(ACTIVITY_COOKIE);
        res.cookies.delete(SESSION_START_COOKIE);
        res.cookies.delete(MFA_STATE_COOKIE);
        return res;
      }
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("reason", reason);
      const redirect = NextResponse.redirect(url);
      redirect.cookies.delete(ACTIVITY_COOKIE);
      redirect.cookies.delete(SESSION_START_COOKIE);
      redirect.cookies.delete(MFA_STATE_COOKIE);
      return redirect;
    };

    // Absolute cap: 12h from login, regardless of activity. (Cookie absent for
    // sessions started before this shipped → cap applies from their next login.)
    const sessionStart = request.cookies.get(SESSION_START_COOKIE)?.value;
    if (sessionStart) {
      const age = now - parseInt(sessionStart, 10);
      if (age > ABSOLUTE_SESSION_CAP_MS) {
        return expireSession("expired", "Session expired");
      }
    }

    // Inactivity: 30 min since last interaction.
    const lastActivity = request.cookies.get(ACTIVITY_COOKIE)?.value;
    if (lastActivity) {
      const elapsed = now - parseInt(lastActivity, 10);
      if (elapsed > INACTIVITY_TIMEOUT_MS) {
        return expireSession("inactive", "Session expired due to inactivity");
      }
    }

    // MFA / AAL2 enforcement (server-side, before the app renders). The client
    // MfaGate is a backstop; doing it here means the authenticated app never
    // flashes before the challenge/enrollment redirect. Page navigations only —
    // API routes enforce via requireAal2 (a 403 the client handles; a redirect
    // would corrupt a fetch). Reads the login-set rhodes_mfa_state cookie so
    // there's no listFactors round-trip; an ABSENT cookie (session predating
    // this rollout) is skipped so nobody gets locked out of an active session.
    if (!isApiRequest) {
      const path = request.nextUrl.pathname;
      // /auth/* (incl. the challenge) and the security settings page must stay
      // reachable so enrollment/step-up can't be redirect-looped.
      const mfaExempt = path.startsWith("/auth") || path.startsWith("/settings/security");
      const mfaState = request.cookies.get(MFA_STATE_COOKIE)?.value;
      if (!mfaExempt && mfaState) {
        const { data: { session } } = await supabase.auth.getSession();
        const aal = session?.access_token ? readAalClaim(session.access_token) : null;

        // Enrolled, but this session hasn't completed the challenge → step up.
        if (mfaState === "enrolled" && aal === "aal1") {
          const url = request.nextUrl.clone();
          url.pathname = "/auth/mfa";
          url.searchParams.set("next", path + request.nextUrl.search);
          return NextResponse.redirect(url);
        }
        // Not enrolled and past the grace deadline → force enrollment.
        if (mfaState.startsWith("grace:")) {
          const deadline = parseInt(mfaState.slice(6), 10);
          if (Number.isFinite(deadline) && now >= deadline) {
            const url = request.nextUrl.clone();
            url.pathname = "/settings/security";
            url.searchParams.set("reason", "mfa_required");
            return NextResponse.redirect(url);
          }
        }
      }
    }

    // Update activity timestamp on every middleware-handled request. (Do NOT
    // touch SESSION_START_COOKIE — the absolute cap must measure from login.)
    supabaseResponse.cookies.set(ACTIVITY_COOKIE, now.toString(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24, // 24 hours (cookie lifetime, not timeout)
    });
  }

  return supabaseResponse;
}
