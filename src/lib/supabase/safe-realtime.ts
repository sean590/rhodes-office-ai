/**
 * safeSubscribe — build + subscribe to a Supabase Realtime channel without ever
 * throwing. Some contexts block WebSockets entirely (strict mobile / in-app
 * webviews, content blockers, private modes) and `.subscribe()` throws
 * synchronously ("The operation is insecure"). These calls run inside React
 * useEffects, so an uncaught throw tears down the component tree (it's what
 * broke login on mobile). Realtime is always a best-effort refresh trigger in
 * this app, so degrade to `null` and let the surface fall back to fetching.
 *
 * Usage:
 *   const channel = safeSubscribe(() => supabase.channel(...).on(...).subscribe());
 *   return () => { if (channel) supabase.removeChannel(channel); };
 */
export function safeSubscribe<T>(build: () => T): T | null {
  try {
    return build();
  } catch (err) {
    console.warn("Realtime unavailable — falling back to fetch-only", err);
    return null;
  }
}
