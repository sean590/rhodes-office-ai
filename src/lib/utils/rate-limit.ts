import { Redis } from "@upstash/redis";

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

/**
 * Distributed rate limiter backed by Upstash Redis.
 * Falls back to allowing requests if Redis is unavailable.
 * Returns true if allowed, false if rate limited.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<boolean> {
  const client = getRedis();
  if (!client) return true;

  try {
    const windowSec = Math.ceil(windowMs / 1000);
    const redisKey = `rl:${key}`;
    const count = await client.incr(redisKey);

    if (count === 1) {
      await client.expire(redisKey, windowSec);
    }

    return count <= limit;
  } catch (err) {
    console.error("[RATE-LIMIT] Redis error, allowing request:", err);
    return true;
  }
}
