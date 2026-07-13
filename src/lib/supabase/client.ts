import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      realtime: {
        // Drop the Realtime heartbeat from the Supabase default 30s to
        // 10s. A WebSocket that has silently died is detected 3x faster,
        // which means the client kicks its reconnect logic — and our
        // SUBSCRIBED-state refetch handler in chat-drawer — sooner.
        //
        // Cost: a tiny heartbeat frame every 10s instead of every 30s
        // per open WebSocket. Negligible at our user counts; Supabase
        // bills connections, not heartbeat frames.
        //
        // Tradeoff to be aware of: shorter heartbeats can produce more
        // false-positive disconnects on flaky networks. If we see
        // chat-drawer reconnect-thrashing in logs, walk this back to
        // 15-20s.
        heartbeatIntervalMs: 10_000,
      },
    },
  );
}
