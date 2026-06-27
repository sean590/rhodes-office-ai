import { Redis } from "@upstash/redis";
import * as Sentry from "@sentry/nextjs";

// Abuse alarm for document uploads.
//
// Rhodes counts upload activity per user in Upstash Redis over rolling windows
// and raises a Sentry alarm the first time a window exceeds its threshold. The
// app does the rate detection; Sentry is purely the notification surface (set
// up an Issue Alert filtered on tag `alarm = document_upload_abuse`).
//
// Fails OPEN: if Redis or Sentry is unavailable, uploads are never blocked —
// an infra problem must not take down the product.
//
// Tuning (all optional; sensible defaults below):
//   ABUSE_ALARM_MODE      'block' (prod default) = also 429 · 'alert' = notify only
//   ABUSE_DOCS_PER_10MIN  per-user docs allowed in 10 minutes (default 300)
//   ABUSE_DOCS_PER_HOUR   per-user docs allowed in 60 minutes (default 1500)
// Reuses the same KV_REST_API_URL / KV_REST_API_TOKEN as the rate limiter.
//
// NOTE (stopgap): block mode is on in prod, but thresholds are set HIGH so legit
// bulk uploads / onboarding backfills aren't blocked — which means the runaway-cost
// ceiling is still ~1500 docs/hr/user. The proper fix (Phase 3) is PER-ORG +
// cost-based limits with a separate, higher allowance for the explicit backfill path.

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
  if (!redis) {
    redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
  }
  return redis;
}

function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

type Mode = "alert" | "block";
// Explicit env wins; otherwise BLOCK in production (don't ship an alert-only door),
// alert in dev. Set ABUSE_ALARM_MODE=alert to override in prod if ever needed.
const MODE: Mode = process.env.ABUSE_ALARM_MODE === "block" ? "block"
  : process.env.ABUSE_ALARM_MODE === "alert" ? "alert"
  : process.env.NODE_ENV === "production" ? "block" : "alert";

// Trips if EITHER window is exceeded — catches short bursts and sustained floods.
const WINDOWS = [
  { key: "10m", windowMs: 10 * 60_000, limit: () => envInt("ABUSE_DOCS_PER_10MIN", 300) },
  { key: "1h", windowMs: 60 * 60_000, limit: () => envInt("ABUSE_DOCS_PER_HOUR", 1500) },
];

export interface AbuseCheckResult {
  /** false only when MODE === 'block' AND a window is over its threshold. */
  allowed: boolean;
  /** true if any window crossed its threshold on this call (alarm fired). */
  tripped: boolean;
}

/**
 * Record `count` document-upload events for a user and raise an abuse alarm the
 * first time a rolling window exceeds its threshold.
 *
 * @returns allowed=false only in block mode when over the limit; tripped=true
 *          when an alarm fired on this call.
 */
export async function checkDocumentUploadAbuse(params: {
  orgId: string;
  userId: string;
  /** Number of documents in this request (uploads arrive in batches). */
  count: number;
  /** Extra detail attached to the Sentry event for triage. */
  context?: Record<string, unknown>;
}): Promise<AbuseCheckResult> {
  const { orgId, userId, count, context } = params;
  const client = getRedis();
  if (!client || count <= 0) return { allowed: true, tripped: false };

  let tripped = false;
  let blocked = false;

  for (const w of WINDOWS) {
    const limit = w.limit();
    const windowSec = Math.ceil(w.windowMs / 1000);
    const counterKey = `abuse:docupload:${userId}:${w.key}`;

    try {
      const total = await client.incrby(counterKey, count);
      // First write into a fresh window — start its expiry clock.
      if (total === count) {
        await client.expire(counterKey, windowSec);
      }

      if (total > limit) {
        if (MODE === "block") blocked = true;

        // Fire the Sentry alarm at most once per window per user, so a user who
        // keeps uploading after crossing doesn't spam the alert channel.
        const alarmKey = `abuse:docupload:alarm:${userId}:${w.key}`;
        const firstAlarm = await client.set(alarmKey, "1", { nx: true, ex: windowSec });

        if (firstAlarm) {
          tripped = true;
          Sentry.withScope((scope) => {
            scope.setLevel("warning");
            scope.setTag("alarm", "document_upload_abuse");
            scope.setTag("org_id", orgId);
            scope.setTag("user_id", userId);
            scope.setTag("window", w.key);
            scope.setTag("alarm_mode", MODE);
            scope.setContext("abuse_alarm", {
              window: w.key,
              count_in_window: total,
              threshold: limit,
              docs_this_request: count,
              mode: MODE,
              ...context,
            });
            // Group every alarm into ONE Sentry issue so a single alert rule covers it.
            scope.setFingerprint(["document-upload-abuse"]);
            Sentry.captureMessage(
              `Document upload abuse alarm: user uploaded ${total} docs in ${w.key} (limit ${limit})`,
              "warning"
            );
          });
        }
      }
    } catch (err) {
      // Fail open — never block an upload because the alarm path errored.
      console.error("[ABUSE-ALARM] error, allowing upload:", err);
    }
  }

  return { allowed: !blocked, tripped };
}
