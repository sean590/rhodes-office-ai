import { Redis } from "@upstash/redis";
import { KV_REST_API_URL, KV_REST_API_TOKEN } from "@/lib/utils/kv-env";

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (!KV_REST_API_URL || !KV_REST_API_TOKEN) return null;
  if (!redis) {
    redis = new Redis({
      url: KV_REST_API_URL,
      token: KV_REST_API_TOKEN,
      retry: false, // fail fast on unreachable Redis (default retries 5x w/ ~5s backoff); caller fails open
    });
  }
  return redis;
}

/**
 * Distributed rate limiter backed by Upstash Redis.
 * Returns true if allowed, false if rate limited.
 *
 * Fail behavior when Redis is unavailable/errors is controlled by `failClosed`:
 *  - default (false): fail OPEN — allow the request (availability over strictness).
 *  - failClosed: true: fail CLOSED — DENY the request. Use for public/unauthenticated
 *    and auth-sensitive endpoints (share/download, login), where a Redis outage must
 *    not become an open door.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  opts: { failClosed?: boolean } = {}
): Promise<boolean> {
  const client = getRedis();
  if (!client) return !opts.failClosed;

  try {
    const windowSec = Math.ceil(windowMs / 1000);
    const redisKey = `rl:${key}`;
    const count = await client.incr(redisKey);

    if (count === 1) {
      await client.expire(redisKey, windowSec);
    }

    return count <= limit;
  } catch (err) {
    console.error(`[RATE-LIMIT] Redis error, ${opts.failClosed ? "DENYING" : "allowing"} request:`, err);
    return !opts.failClosed;
  }
}
