import { createAdminClient } from "@/lib/supabase/admin";
import { Redis } from "@upstash/redis";
import { KV_REST_API_URL, KV_REST_API_TOKEN } from "@/lib/utils/kv-env";

export async function GET() {
  const checks: Record<string, "ok" | "error" | "not_configured"> = {};

  // Database (Supabase, via the service-role client).
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("users").select("id").limit(1);
    checks.database = error ? "error" : "ok";
  } catch {
    checks.database = "error";
  }

  // Redis (Upstash/KV). Optional — "not_configured" is a healthy state (the app
  // fails open without it); only a reachable-but-failing ping counts as degraded.
  if (!KV_REST_API_URL || !KV_REST_API_TOKEN) {
    checks.redis = "not_configured";
  } else {
    try {
      const redis = new Redis({
        url: KV_REST_API_URL,
        token: KV_REST_API_TOKEN,
        retry: false,
      });
      const pong = await redis.ping();
      checks.redis = pong === "PONG" ? "ok" : "error";
    } catch {
      checks.redis = "error";
    }
  }

  const allOk = checks.database === "ok" && checks.redis !== "error";

  return Response.json(
    { status: allOk ? "healthy" : "degraded", checks, timestamp: new Date().toISOString() },
    { status: allOk ? 200 : 503 }
  );
}
