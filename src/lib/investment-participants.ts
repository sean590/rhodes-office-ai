/**
 * Participant resolution for an investment — the single place that decides where
 * an investment's owners come from.
 *
 *  - **Cap-table-tied** (909 Park: a directly-owned managed entity IS the
 *    investment): participants ARE the linked entity's cap-table members. One
 *    owner list, shared with the entity record, so the two can't drift.
 *    Transactions attribute via `investment_transactions.cap_table_entry_id`.
 *  - **Standalone** (external vehicles; holding-company investors with per-deal
 *    internal allocations): participants are `investment_investors` rows, keyed
 *    by `investment_investor_id`. Unchanged.
 *
 * Returns a uniform shape + the transaction grouping key so the detail route and
 * the investors route compute metrics the same way regardless of source.
 */
import type { OrgClient } from "@/lib/supabase/org-client";

export interface ResolvedParticipant {
  /** cap_table_entry_id (tied) or investment_investor_id (standalone). */
  id: string;
  /** Display name the UI renders (the investor badge / participant row). */
  entity_name: string;
  committed_capital: number | null;
  capital_pct: number | null;
  /** The internal managed entity behind this participant, if any. */
  entity_id: string | null;
  kind: "cap_table_member" | "investor";
  /** Standalone path spreads the full investment_investors row through here so
   *  existing investment UIs keep every field they read today. */
  [key: string]: unknown;
}

export interface ResolvedParticipants {
  participants: ResolvedParticipant[];
  /** Column on investment_transactions to group by for per-participant metrics. */
  txnKey: "cap_table_entry_id" | "investment_investor_id";
  tied: boolean;
}

type Investment = { id: string; entity_id: string | null; cap_table_tied?: boolean | null };

export async function resolveParticipants(
  db: OrgClient,
  investment: Investment,
): Promise<ResolvedParticipants> {
  if (investment.cap_table_tied && investment.entity_id) {
    // cap_table_entries is entity-scoped (no organization_id), so it isn't an
    // org-scoped table on the OrgClient — go through `raw` and confine to the
    // investment's own (org-validated) entity_id.
    const { data } = await db.raw
      .from("cap_table_entries")
      .select("id, investor_name, ownership_pct, capital_contributed, investor_entity_id, investor_directory_id, entities:investor_entity_id(name), directory_entries:investor_directory_id(name)")
      .eq("entity_id", investment.entity_id);
    const participants: ResolvedParticipant[] = (data ?? []).map((r: Record<string, unknown>) => {
      const ent = r.entities as { name: string } | null;
      const dir = r.directory_entries as { name: string } | null;
      return {
        id: r.id as string,
        entity_id: (r.investor_entity_id as string) ?? null,
        entity_name: (r.investor_name as string) || ent?.name || dir?.name || "Unknown",
        entity_short_name: null,
        committed_capital: r.capital_contributed != null ? Number(r.capital_contributed) : null,
        capital_pct: r.ownership_pct != null ? Number(r.ownership_pct) : null,
        profit_pct: r.ownership_pct != null ? Number(r.ownership_pct) : null,
        kind: "cap_table_member",
      };
    });
    return { participants, txnKey: "cap_table_entry_id", tied: true };
  }

  const { data } = await db
    .from("investment_investors")
    .select("*, entities:entity_id(name, short_name)")
    .eq("investment_id", investment.id)
    .eq("is_active", true);
  const participants: ResolvedParticipant[] = (data ?? []).map((r: Record<string, unknown>) => {
    const ent = r.entities as { name: string; short_name: string | null } | null;
    const { entities: _entities, ...rest } = r;
    return {
      ...rest, // preserve every investment_investors field the UI reads today
      id: r.id as string,
      entity_id: (r.entity_id as string) ?? null,
      entity_name: ent?.name ?? "Unknown",
      entity_short_name: ent?.short_name ?? null,
      committed_capital: r.committed_capital != null ? Number(r.committed_capital) : null,
      capital_pct: r.capital_pct != null ? Number(r.capital_pct) : null,
      kind: "investor",
    };
  });
  return { participants, txnKey: "investment_investor_id", tied: false };
}
