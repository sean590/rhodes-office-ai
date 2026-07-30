/**
 * Provider discovery from inbound mail (rhodes-inbound-v1-ui-spec.md §1c).
 *
 * Unrecognized-but-delivery-looking senders that repeat become "Add {Firm} as
 * a provider?" suggestions on Home's Suggested lane. Accepting creates the
 * service provider (domain lands in `service_providers.domains`, which
 * `inferProviderFromSender` already matches on) and retroactively attributes
 * that domain's unowned ledger rows. Declining writes an
 * `inbound_delivery_senders` kind='not_provider' row, which mutes the domain
 * here forever (077).
 *
 * Shared by the /api/inbound/provider-suggestions routes and the MCP inbound
 * tools (CLAUDE.md rule #2 — route/tool parity). All queries run on the
 * service-role client with an explicit orgId filter.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { logAuditEvent } from "@/lib/utils/audit";

export interface ProviderSuggestion {
  domain: string;
  count: number;
  latest_subject: string | null;
  suggested_name: string;
}

/** How many distinct deliveries a domain needs before we suggest it. */
const MIN_DELIVERIES = 2;
/** Look-back window for counting deliveries. */
const WINDOW_DAYS = 90;

// Personal-mail domains are never a firm — "Add Gmail as a provider?" is
// nonsense. A provider using a personal address can still be added by hand.
const FREEMAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com",
  "live.com", "msn.com", "icloud.com", "me.com", "mac.com", "aol.com",
  "protonmail.com", "proton.me", "comcast.net", "att.net", "verizon.net",
]);

/** "Jane Doe <jane@willkie.com>" → "willkie.com" (lowercased). */
export function domainFromSender(sender: string | null): string | null {
  const m = sender?.match(/@([A-Za-z0-9.-]+)/);
  return m ? m[1].toLowerCase().replace(/\.+$/, "") : null;
}

// ccTLD second-level suffixes where the registrable label is one level deeper
// ("smith.co.uk" → "smith", not "co").
const SECOND_LEVEL_TLDS = new Set(["co", "com", "org", "net", "ac", "gov", "edu"]);

/**
 * "bpwcpa.com" → "Bpwcpa", "smith-jones.co.uk" → "Smith Jones". Strip the TLD,
 * take the registrable label, split hyphens/dots, capitalize each word. Only a
 * starting point — the user can rename the provider after accepting.
 */
export function suggestNameFromDomain(domain: string): string {
  const parts = domain.split(".").filter(Boolean);
  let label = parts.length >= 2 ? parts[parts.length - 2] : parts[0] ?? domain;
  if (parts.length >= 3 && SECOND_LEVEL_TLDS.has(label)) label = parts[parts.length - 3];
  const words = label.split(/[-_]+/).filter(Boolean);
  const cased = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return cased.join(" ") || domain;
}

/**
 * Delivery-looking senders with no matched provider, grouped by domain,
 * repeated >= MIN_DELIVERIES times in the window, minus domains the user said
 * are not a provider and domains already on a provider record.
 */
export async function listProviderSuggestions(
  admin: SupabaseClient,
  orgId: string,
): Promise<ProviderSuggestion[]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();

  const [deliveriesRes, mutedRes, providersRes] = await Promise.all([
    admin
      .from("inbound_deliveries")
      .select("sender, subject, received_at")
      .eq("organization_id", orgId)
      .is("provider_id", null)
      .not("sender", "is", null)
      // Delivery-looking only — 'ignored' (newsletters, receipts, spam) never
      // suggests a provider, no matter how often it repeats.
      .in("classification", ["attachment", "safesend", "needs_user"])
      .gte("received_at", since)
      .order("received_at", { ascending: false })
      .limit(1000),
    admin
      .from("inbound_delivery_senders")
      .select("domain")
      .eq("organization_id", orgId)
      .eq("kind", "not_provider"),
    admin
      .from("service_providers")
      .select("domains")
      .eq("organization_id", orgId)
      .is("deleted_at", null),
  ]);
  if (deliveriesRes.error) throw deliveriesRes.error;

  const excluded = new Set<string>();
  for (const row of mutedRes.data ?? []) excluded.add((row.domain as string).toLowerCase());
  for (const p of providersRes.data ?? [])
    for (const d of (p.domains as string[]) ?? []) excluded.add(d.toLowerCase());

  // Rows arrive newest-first, so the first subject seen per domain is the latest.
  const byDomain = new Map<string, ProviderSuggestion>();
  for (const row of deliveriesRes.data ?? []) {
    const domain = domainFromSender(row.sender as string | null);
    if (!domain || excluded.has(domain) || FREEMAIL.has(domain)) continue;
    const existing = byDomain.get(domain);
    if (existing) existing.count += 1;
    else byDomain.set(domain, {
      domain,
      count: 1,
      latest_subject: (row.subject as string | null) ?? null,
      suggested_name: suggestNameFromDomain(domain),
    });
  }

  return [...byDomain.values()]
    .filter((s) => s.count >= MIN_DELIVERIES)
    .sort((a, b) => b.count - a.count);
}

export interface AcceptResult {
  provider: { id: string; name: string; domains: string[] };
  /** How many unowned ledger rows were retroactively attributed. */
  reattributed: number;
}

/**
 * Accept a suggestion: create the provider (minimal record — name + domain;
 * everything else has a sane default and is editable in People) and
 * retroactively attribute the domain's unowned inbound rows. Audit-logged as
 * `provider_discovered`.
 */
export async function acceptProviderSuggestion(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  domainRaw: string,
  name: string,
  requestContext?: { ipAddress?: string | null; userAgent?: string | null },
): Promise<AcceptResult> {
  const domain = domainRaw.trim().toLowerCase();

  // A provider already owning the domain means this suggestion is stale.
  const { data: existing } = await admin
    .from("service_providers")
    .select("id, name, domains")
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .contains("domains", [domain])
    .maybeSingle();

  let provider = existing as AcceptResult["provider"] | null;
  if (!provider) {
    const { data, error } = await admin
      .from("service_providers")
      .insert({
        organization_id: orgId,
        name: name.trim(),
        domains: [domain],
        created_by: userId,
      })
      .select("id, name, domains")
      .single();
    if (error) throw error;
    provider = data as AcceptResult["provider"];
  }

  // Retroactive attribution: match on the parsed sender domain (not a bare
  // LIKE) so "…@notbpwcpa.com" never rides along with "bpwcpa.com".
  const { data: unowned, error: fetchErr } = await admin
    .from("inbound_deliveries")
    .select("id, sender")
    .eq("organization_id", orgId)
    .is("provider_id", null)
    .ilike("sender", `%@%${domain}%`)
    .limit(2000);
  if (fetchErr) throw fetchErr;
  const ids = (unowned ?? [])
    .filter((r) => domainFromSender(r.sender as string | null) === domain)
    .map((r) => r.id as string);

  if (ids.length > 0) {
    const { error: updErr } = await admin
      .from("inbound_deliveries")
      .update({ provider_id: provider.id, updated_at: new Date().toISOString() })
      .eq("organization_id", orgId)
      .is("provider_id", null)
      .in("id", ids);
    if (updErr) throw updErr;
  }

  await logAuditEvent({
    userId,
    action: "provider_discovered",
    resourceType: "service_provider",
    resourceId: provider.id,
    organizationId: orgId,
    metadata: { name: provider.name, domain, reattributed: ids.length },
    ...requestContext,
  });

  return { provider, reattributed: ids.length };
}

/**
 * Dismiss a suggestion: kind='not_provider' mutes the domain for good. Upsert
 * on (organization_id, domain) — an explicit "not a provider" also overrides a
 * previously learned kind='delivery' row for the domain.
 */
export async function dismissProviderSuggestion(
  admin: SupabaseClient,
  orgId: string,
  domainRaw: string,
): Promise<void> {
  const domain = domainRaw.trim().toLowerCase();
  const { error } = await admin
    .from("inbound_delivery_senders")
    .upsert(
      { organization_id: orgId, domain, kind: "not_provider" },
      { onConflict: "organization_id,domain" },
    );
  if (error) throw error;
}
