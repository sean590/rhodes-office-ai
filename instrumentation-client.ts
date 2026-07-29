import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  enableLogs: true,
  integrations: [
    Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
  ],
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  // Third-party noise: errors thrown by code we don't ship. Browser
  // extensions / in-app webviews inject their own scripts (e.g. a
  // "tracking_script.js" that pulls apis.google.com/js/client.js, which our
  // CSP rightly blocks) and Sentry's global handler attributes the failure
  // to us. Filter by the injected frames' origins, not by message, so real
  // app errors are never hidden.
  denyUrls: [
    /^chrome-extension:\/\//,
    /^moz-extension:\/\//,
    /^safari-(web-)?extension:\/\//,
    /\/tracking_script\.js/,
    /apis\.google\.com\/js\//,
  ],
  ignoreErrors: [
    // gapi's loader wraps script-load failures in this prefix; only ever
    // produced by injected Google-API clients (we don't ship gapi).
    /^Jsloader error/,
  ],
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
