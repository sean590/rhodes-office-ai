import { createClient } from "@supabase/supabase-js";

/**
 * Supabase admin client that bypasses Row Level Security (RLS).
 *
 * WARNING: This client uses the service role key and should ONLY be used
 * server-side (Server Components, Route Handlers, Server Actions).
 * Never expose this client or the service role key to the browser.
 */
export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables. " +
        "The admin client can only be used server-side."
    );
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
