import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  serverExternalPackages: [],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // script-src keeps 'unsafe-inline': Next.js bakes inline hydration
              // scripts (self.__next_f.push) into STATICALLY-prerendered pages at
              // build time, so they can't carry a per-request nonce. Dropping
              // 'unsafe-inline' would need the whole app forced to dynamic
              // rendering (a real perf/arch tradeoff) — tracked as a follow-up.
              // The other directives below give defense-in-depth in the meantime.
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://*.supabase.co https://*.rhodesoffice.ai",
              "font-src 'self' https://fonts.gstatic.com",
              // wss://*.supabase.co is REQUIRED for Supabase Realtime — CSP connect-src
              // matches by scheme, so https://*.supabase.co does NOT cover the realtime
              // WebSocket. Without it the browser blocks the socket ("The operation is
              // insecure"), which crashed the authenticated shell on subscribe.
              // Supabase now serves on the custom domain auth.rhodesoffice.ai
              // (same-site with app.rhodesoffice.ai → fixes iOS realtime). Keep
              // *.supabase.co for any direct/fallback use; add wss for the
              // realtime socket on the custom domain.
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.rhodesoffice.ai wss://*.rhodesoffice.ai https://api.anthropic.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io",
              // Hardening the audit called out explicitly (#13):
              "object-src 'none'", // block <object>/<embed> plugin vectors
              "base-uri 'self'", // stop <base> tag hijacking of relative URLs
              "frame-ancestors 'none'", // no embedding (clickjacking)
              "form-action 'self'", // forms can only submit same-origin
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: "rhodes-office",
  project: "rhodesoffice",
  silent: !process.env.CI,
  widenClientFileUpload: true,
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
});
