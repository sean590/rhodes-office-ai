/**
 * Ownership transfer events (migration 083). Records a stake moving between two
 * internal entities on an investment — a gift, sale, or other — and applies the
 * ownership change to `investment_investors` in one place.
 *
 * Used by both the API route (RLS user client) and the chat apply pipeline
 * (admin client), same as notes.ts. All org scoping is explicit (organization_id
 * filters + name resolution), so it's correct on the admin path too.
 *
 * Percentage model: `transferredPct` is ownership POINTS of the whole
 * investment. capital_pct moves by exactly that many points (keeps the cap
 * table summing to 100); profit_pct and committed_capital move PRO-RATA to the
 * capital slice (fraction = transferredPct / from.capital_pct_before) so the
 * economics travel with the stake.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAuditEvent } from "@/lib/utils/audit";

export type OwnershipTransferType = "gift" | "sale" | "other";

export interface OwnershipTransferInput {
  investmentId: string;
  fromEntityId: string;
  toEntityId: string;
  transferType: OwnershipTransferType;
  transferredPct: number;
  fairMarketValue?: number | null;
  costBasis?: number | null;
  transferDate?: string | null;
  documentId?: string | null;
  notes?: string | null;
}

export interface OwnershipTransferRecord {
  id: string;
  investment_id: string;
  from_entity_id: string | null;
  to_entity_id: string | null;
  from_entity_name: string;
  to_entity_name: string;
  transfer_type: OwnershipTransferType;
  transferred_pct: number;
  fair_market_value: number | null;
  cost_basis: number | null;
  transfer_date: string;
  document_id: string | null;
  notes: string | null;
  created_at: string;
}

/** Numeric epsilon for "effectively zero" capital after a full exit. */
const EPSILON = 0.0001;

function round(n: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

type InvestorRow = {
  id: string;
  investment_id: string;
  entity_id: string;
  capital_pct: number | null;
  profit_pct: number | null;
  committed_capital: number | null;
  is_active: boolean;
};

/**
 * Create an ownership transfer and apply it to the two investors' stakes.
 * Returns the created transfer row, or an error string for any validation or
 * write failure (nothing partial is left behind on the validation failures —
 * the transfer row is written last, after the investor updates succeed).
 */
export async function createOwnershipTransfer(
  db: SupabaseClient,
  orgId: string,
  userId: string | null,
  input: OwnershipTransferInput,
): Promise<{ transfer: OwnershipTransferRecord | null; error?: string }> {
  const { investmentId, fromEntityId, toEntityId, transferType } = input;
  const transferredPct = Number(input.transferredPct);

  if (!investmentId) return { transfer: null, error: "investment_id is required" };
  if (!fromEntityId) return { transfer: null, error: "from_entity_id is required" };
  if (!toEntityId) return { transfer: null, error: "to_entity_id is required" };
  if (fromEntityId === toEntityId) {
    return { transfer: null, error: "The giving and receiving entity must be different" };
  }
  if (!["gift", "sale", "other"].includes(transferType)) {
    return { transfer: null, error: "transfer_type must be gift, sale, or other" };
  }
  if (!Number.isFinite(transferredPct) || transferredPct <= 0 || transferredPct > 100) {
    return { transfer: null, error: "transferred_pct must be between 0 and 100" };
  }

  // Investment must be in this org.
  const { data: investment } = await db
    .from("investments")
    .select("id, name")
    .eq("id", investmentId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!investment) return { transfer: null, error: "Investment not found" };

  // Both entities must be in this org; capture name snapshots.
  const { data: entities } = await db
    .from("entities")
    .select("id, name")
    .eq("organization_id", orgId)
    .in("id", [fromEntityId, toEntityId]);
  const nameById = new Map<string, string>((entities ?? []).map((e) => [e.id as string, e.name as string]));
  const fromName = nameById.get(fromEntityId);
  const toName = nameById.get(toEntityId);
  if (!fromName) return { transfer: null, error: "Giving entity not found" };
  if (!toName) return { transfer: null, error: "Receiving entity not found" };

  // FROM must be an active investor with enough capital to give.
  const { data: fromInvestor } = await db
    .from("investment_investors")
    .select("id, investment_id, entity_id, capital_pct, profit_pct, committed_capital, is_active")
    .eq("investment_id", investmentId)
    .eq("entity_id", fromEntityId)
    .eq("is_active", true)
    .maybeSingle();
  if (!fromInvestor) {
    return { transfer: null, error: `${fromName} is not an active investor on this investment` };
  }
  const from = fromInvestor as InvestorRow;
  const fromCapBefore = Number(from.capital_pct ?? 0);
  if (fromCapBefore + EPSILON < transferredPct) {
    return {
      transfer: null,
      error: `${fromName} only owns ${fromCapBefore}% — cannot transfer ${transferredPct}%`,
    };
  }

  // Pro-rata slice of the FROM position (fraction of its stake being moved).
  const fraction = fromCapBefore > 0 ? transferredPct / fromCapBefore : 0;
  const movedProfit = from.profit_pct != null ? round(Number(from.profit_pct) * fraction, 4) : null;
  const movedCommitted =
    from.committed_capital != null ? round(Number(from.committed_capital) * fraction, 2) : null;

  // FROM after.
  const fromCapAfter = round(fromCapBefore - transferredPct, 4);
  const fromAfter = {
    capital_pct: fromCapAfter,
    profit_pct: from.profit_pct != null ? round(Number(from.profit_pct) - (movedProfit ?? 0), 4) : null,
    committed_capital:
      from.committed_capital != null ? round(Number(from.committed_capital) - (movedCommitted ?? 0), 2) : null,
    // A full transfer of the whole stake exits the investor.
    is_active: fromCapAfter > EPSILON,
    updated_at: new Date().toISOString(),
  };

  const { error: fromErr } = await db
    .from("investment_investors")
    .update(fromAfter)
    .eq("id", from.id);
  if (fromErr) return { transfer: null, error: `Failed to update giving investor: ${fromErr.message}` };

  // TO — reuse any existing row (active or inactive) to preserve downstream
  // allocations/transactions; otherwise insert a fresh investor.
  const { data: toExisting } = await db
    .from("investment_investors")
    .select("id, investment_id, entity_id, capital_pct, profit_pct, committed_capital, is_active")
    .eq("investment_id", investmentId)
    .eq("entity_id", toEntityId)
    .maybeSingle();

  let toBefore: Partial<InvestorRow> | null = null;
  let toAfterRow: Record<string, unknown>;
  if (toExisting) {
    const to = toExisting as InvestorRow;
    toBefore = to;
    toAfterRow = {
      capital_pct: round(Number(to.capital_pct ?? 0) + transferredPct, 4),
      profit_pct:
        movedProfit != null ? round(Number(to.profit_pct ?? 0) + movedProfit, 4) : to.profit_pct,
      committed_capital:
        movedCommitted != null
          ? round(Number(to.committed_capital ?? 0) + movedCommitted, 2)
          : to.committed_capital,
      is_active: true,
      updated_at: new Date().toISOString(),
    };
    const { error: toErr } = await db
      .from("investment_investors")
      .update(toAfterRow)
      .eq("id", to.id);
    if (toErr) return { transfer: null, error: `Failed to update receiving investor: ${toErr.message}` };
  } else {
    toAfterRow = {
      investment_id: investmentId,
      entity_id: toEntityId,
      organization_id: orgId,
      capital_pct: transferredPct,
      profit_pct: movedProfit,
      committed_capital: movedCommitted,
      is_active: true,
      created_by: userId,
      updated_at: new Date().toISOString(),
    };
    const { error: toErr } = await db.from("investment_investors").insert(toAfterRow);
    if (toErr) return { transfer: null, error: `Failed to add receiving investor: ${toErr.message}` };
  }

  // Record the event (written last — investor updates already succeeded).
  const { data: transfer, error: insErr } = await db
    .from("investment_ownership_transfers")
    .insert({
      organization_id: orgId,
      investment_id: investmentId,
      from_entity_id: fromEntityId,
      to_entity_id: toEntityId,
      from_entity_name: fromName,
      to_entity_name: toName,
      transfer_type: transferType,
      transferred_pct: transferredPct,
      fair_market_value: input.fairMarketValue ?? null,
      cost_basis: input.costBasis ?? null,
      transfer_date: input.transferDate || undefined,
      document_id: input.documentId ?? null,
      notes: input.notes ?? null,
      applied_snapshot: {
        from: { before: from, after: fromAfter },
        to: { before: toBefore, after: toAfterRow },
      },
      created_by: userId,
    })
    .select(
      "id, investment_id, from_entity_id, to_entity_id, from_entity_name, to_entity_name, transfer_type, transferred_pct, fair_market_value, cost_basis, transfer_date, document_id, notes, created_at",
    )
    .single();
  if (insErr || !transfer) {
    return { transfer: null, error: insErr?.message || "Failed to record transfer" };
  }

  await logAuditEvent({
    userId,
    action: "transfer",
    resourceType: "ownership_transfer",
    resourceId: transfer.id as string,
    investmentId,
    entityId: fromEntityId,
    organizationId: orgId,
    metadata: {
      transfer_id: transfer.id,
      from_entity_name: fromName,
      to_entity_name: toName,
      transferred_pct: transferredPct,
      transfer_type: transferType,
      fair_market_value: input.fairMarketValue ?? null,
      investment_name: investment.name,
    },
  }).catch(() => {});

  return { transfer: transfer as OwnershipTransferRecord };
}

/** List ownership transfers for an investment (most recent first). */
export async function listOwnershipTransfers(
  db: SupabaseClient,
  orgId: string,
  investmentId: string,
): Promise<OwnershipTransferRecord[]> {
  const { data } = await db
    .from("investment_ownership_transfers")
    .select(
      "id, investment_id, from_entity_id, to_entity_id, from_entity_name, to_entity_name, transfer_type, transferred_pct, fair_market_value, cost_basis, transfer_date, document_id, notes, created_at",
    )
    .eq("organization_id", orgId)
    .eq("investment_id", investmentId)
    .order("transfer_date", { ascending: false })
    .order("created_at", { ascending: false });
  return (data ?? []) as OwnershipTransferRecord[];
}
