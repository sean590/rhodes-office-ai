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
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ResolvedParticipant {
  /** cap_table_entry_id (tied) or investment_investor_id (standalone). */
  id: string;
  name: string;
  committed_capital: number | null;
  ownership_pct: number | null;
  /** Present for tied participants that reference an internal managed entity. */
  entity_id: string | null;
  kind: "cap_table_member" | "investor";
}

export interface ResolvedParticipants {
  participants: ResolvedParticipant[];
  /** Column on investment_transactions to group by for per-participant metrics. */
  txnKey: "cap_table_entry_id" | "investment_investor_id";
  tied: boolean;
}

type Investment = { id: string; entity_id: string | null; cap_table_tied?: boolean | null };

export async function resolveParticipants(
  db: SupabaseClient,
  investment: Investment,
): Promise<ResolvedParticipants> {
  if (investment.cap_table_tied && investment.entity_id) {
    const { data } = await db
      .from("cap_table_entries")
      .select("id, investor_name, ownership_pct, capital_contributed, investor_entity_id, investor_directory_id, entities:investor_entity_id(name), directory_entries:investor_directory_id(name)")
      .eq("entity_id", investment.entity_id);
    const participants: ResolvedParticipant[] = (data ?? []).map((r: Record<string, unknown>) => {
      const ent = r.entities as { name: string } | null;
      const dir = r.directory_entries as { name: string } | null;
      return {
        id: r.id as string,
        name: (r.investor_name as string) || ent?.name || dir?.name || "Unknown",
        committed_capital: r.capital_contributed != null ? Number(r.capital_contributed) : null,
        ownership_pct: r.ownership_pct != null ? Number(r.ownership_pct) : null,
        entity_id: (r.investor_entity_id as string) ?? null,
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
    return {
      id: r.id as string,
      name: ent?.name || "Unknown",
      committed_capital: r.committed_capital != null ? Number(r.committed_capital) : null,
      ownership_pct: r.capital_pct != null ? Number(r.capital_pct) : null,
      entity_id: (r.entity_id as string) ?? null,
      kind: "investor",
    };
  });
  return { participants, txnKey: "investment_investor_id", tied: false };
}
