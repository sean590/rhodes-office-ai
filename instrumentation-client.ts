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
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
