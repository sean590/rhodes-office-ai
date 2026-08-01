import { NextResponse } from "next/server";
import { createOrgClient } from "@/lib/supabase/org-client";
import { requireOrg, isError, validateInvestmentOrg } from "@/lib/utils/org-context";
import {
  createOwnershipTransfer,
  listOwnershipTransfers,
  type OwnershipTransferType,
} from "@/lib/investment-transfers";

/**
 * GET /api/investments/[id]/transfers
 *
 * Lists ownership transfer events for an investment (most recent first).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;

    const isValid = await validateInvestmentOrg(id, orgId);
    if (!isValid) return NextResponse.json({ error: "Investment not found" }, { status: 404 });

    // Shared service filters by organization_id explicitly on every read/write;
    // the .raw admin client is the sanctioned path (also used by the chat apply pipeline).
    const db = createOrgClient(orgId).raw;
    const transfers = await listOwnershipTransfers(db, orgId, id);
    return NextResponse.json(transfers);
  } catch (err) {
    console.error("GET /api/investments/[id]/transfers error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/investments/[id]/transfers
 *
 * Records an ownership transfer between two internal entities and applies the
 * stake change to investment_investors.
 * Body: {
 *   from_entity_id: string,
 *   to_entity_id: string,
 *   transfer_type: 'gift' | 'sale' | 'other',
 *   transferred_pct: number,          // ownership points of the investment
 *   fair_market_value?: number | null,
 *   cost_basis?: number | null,
 *   transfer_date?: string,           // ISO date
 *   document_id?: string | null,
 *   notes?: string | null,
 * }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const isValid = await validateInvestmentOrg(id, orgId);
    if (!isValid) return NextResponse.json({ error: "Investment not found" }, { status: 404 });

    // Shared service filters by organization_id explicitly on every read/write;
    // the .raw admin client is the sanctioned path (also used by the chat apply pipeline).
    const db = createOrgClient(orgId).raw;
    const body = await request.json();

    const { transfer, error } = await createOwnershipTransfer(db, orgId, user.id, {
      investmentId: id,
      fromEntityId: body.from_entity_id,
      toEntityId: body.to_entity_id,
      transferType: body.transfer_type as OwnershipTransferType,
      transferredPct: body.transferred_pct,
      fairMarketValue: body.fair_market_value ?? null,
      costBasis: body.cost_basis ?? null,
      transferDate: body.transfer_date ?? null,
      documentId: body.document_id ?? null,
      notes: body.notes ?? null,
    });

    if (error || !transfer) {
      return NextResponse.json({ error: error || "Failed to record transfer" }, { status: 400 });
    }

    return NextResponse.json(transfer, { status: 201 });
  } catch (err) {
    console.error("POST /api/investments/[id]/transfers error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
