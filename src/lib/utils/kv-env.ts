/**
 * Resolves the Upstash/Vercel-KV REST credentials from the environment.
 *
 * The KV store was re-provisioned (the old one was archived for inactivity).
 * The new Upstash↔Vercel integration injects PREFIXED env vars
 * (`rhodes_rate_limit_2_KV_REST_API_URL` / `..._TOKEN`) rather than the bare
 * `KV_REST_API_URL` / `KV_REST_API_TOKEN` our code used to read. We prefer the
 * prefixed names and fall back to the bare ones (local .env.local / older
 * setups). Read once at module load — server-only utils, runtime process.env.
 *
 * NOTE: the prefixed vars only exist once the Upstash store is "Connect to
 * Project"-ed to the Vercel project. Until then both are undefined and every
 * Redis consumer fails open (getRedis() returns null → no cache/rate-limit).
 */
export const KV_REST_API_URL: string | undefined =
  process.env["rhodes_rate_limit_2_KV_REST_API_URL"] ?? process.env.KV_REST_API_URL;

export const KV_REST_API_TOKEN: string | undefined =
  process.env["rhodes_rate_limit_2_KV_REST_API_TOKEN"] ?? process.env.KV_REST_API_TOKEN;
