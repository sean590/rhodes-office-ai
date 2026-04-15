import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError, validateEntityOrg } from "@/lib/utils/org-context";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { invalidateOrgCaches } from "@/lib/utils/chat-context";
import {
  validateInvestmentTransactionLineItems,
  coerceLineItemCategories,
  type TransactionLineItemInput,
} from "@/lib/validations";

/**
 * GET /api/entities/[id]/investment-transactions
 *
 * Returns investment transactions for a deal entity (id = deal_entity_id).
 * Query params:
 *   - parent_entity_id (optional): filter by parent entity
 *   - type (optional): filter by transaction_type
 *   - parent_only (optional): only return entity-level parent transactions (member_directory_id IS NULL)
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;

    const isValid = await validateEntityOrg(id, orgId);
    if (!isValid) return NextResponse.json({ error: "Entity not found" }, { status: 404 });

    const supabase = createAdminClient();
    const url = new URL(request.url);
    const parentEntityId = url.searchParams.get("parent_entity_id");
    const txnType = url.searchParams.get("type");
    const parentOnly = url.searchParams.get("parent_only") === "true";

    let query = supabase
      .from("investment_transactions")
      .select("*, directory_entries:member_directory_id(name), documents:document_id(name)")
      .eq("deal_entity_id", id)
      .eq("organization_id", orgId)
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (parentEntityId) {
      query = query.eq("parent_entity_id", parentEntityId);
    }

    if (txnType) {
      query = query.eq("transaction_type", txnType);
    }

    if (parentOnly) {
      query = query.is("member_directory_id", null);
    }

    const { data, error } = await query;

    if (error) {
      console.error("GET investment-transactions error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    // Flatten joined names
    const transactions = (data || []).map((row: Record<string, unknown>) => {
      const dirEntry = row.directory_entries as { name: string } | null;
      const doc = row.documents as { name: string } | null;
      const { directory_entries: _, documents: _d, ...rest } = row;
      return {
        ...rest,
        member_name: dirEntry?.name ?? null,
        document_name: doc?.name ?? null,
      };
    });

    return NextResponse.json(transactions);
  } catch (err) {
    console.error("GET /api/entities/[id]/investment-transactions error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/entities/[id]/investment-transactions
 *
 * Creates a transaction for a deal entity. Supports auto-split by allocation percentages.
 *
 * Body: {
 *   parent_entity_id: string,
 *   transaction_type: 'contribution' | 'distribution' | 'return_of_capital',
 *   amount: number,           // total amount
 *   transaction_date: string, // ISO date
 *   description?: string,
 *   document_id?: string,
 *   split_by_allocation?: boolean,  // auto-split among members based on current allocations
 *   member_amounts?: Array<{        // custom per-member amounts (used when split_by_allocation is false)
 *     member_directory_id: string,
 *     amount: number,
 *   }>,
 * }
 *
 * Creates one parent row (member_directory_id = null) + one row per member.
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

    const isValid = await validateEntityOrg(id, orgId);
    if (!isValid) return NextResponse.json({ error: "Entity not found" }, { status: 404 });

    const supabase = createAdminClient();
    const body = await request.json();

    const {
      parent_entity_id,
      transaction_type,
      amount,
      transaction_date,
      description,
      document_id,
      split_by_allocation,
      member_amounts,
      line_items,
      adjusts_transaction_id,
      adjustment_reason,
    } = body;

    // Validation
    if (!parent_entity_id) {
      return NextResponse.json({ error: "parent_entity_id is required" }, { status: 400 });
    }
    if (!["contribution", "distribution", "return_of_capital"].includes(transaction_type)) {
      return NextResponse.json({ error: "Invalid transaction_type" }, { status: 400 });
    }
    if (typeof amount !== "number" || !Number.isFinite(amount)) {
      return NextResponse.json({ error: "amount must be a number" }, { status: 400 });
    }
    if (!adjusts_transaction_id && amount <= 0) {
      return NextResponse.json({ error: "amount must be positive on non-adjustment rows" }, { status: 400 });
    }
    if (!transaction_date) {
      return NextResponse.json({ error: "transaction_date is required" }, { status: 400 });
    }

    // Spec 036: normalize, auto-coerce common AI category mistakes, then
    // validate line_items via the shared helper used by every entry point so
    // the chat-apply path and HTTP routes can never disagree.
    const normalizedLineItemsRaw: TransactionLineItemInput[] = Array.isArray(line_items)
      ? (line_items as Array<Record<string, unknown>>).map((li) => ({
          category: li.category as TransactionLineItemInput["category"],
          amount: Number(li.amount),
          description: (li.description as string) ?? null,
        }))
      : [];
    const normalizedLineItems = coerceLineItemCategories(transaction_type, normalizedLineItemsRaw);

    const lineItemCheck = validateInvestmentTransactionLineItems({
      transaction_type,
      amount,
      line_items: normalizedLineItems,
      adjusts_transaction_id: adjusts_transaction_id ?? null,
    });
    if (!lineItemCheck.ok) {
      return NextResponse.json({ error: lineItemCheck.error }, { status: 400 });
    }

    // Validate parent entity belongs to org
    const parentValid = await validateEntityOrg(parent_entity_id, orgId);
    if (!parentValid) {
      return NextResponse.json({ error: "Parent entity not found" }, { status: 404 });
    }

    // If this is an adjustment, verify the referenced row exists and is on the
    // same parent entity / deal. Spec 036.
    if (adjusts_transaction_id) {
      const { data: original } = await supabase
        .from("investment_transactions")
        .select("id, organization_id, parent_entity_id, deal_entity_id")
        .eq("id", adjusts_transaction_id)
        .maybeSingle();
      if (!original) {
        return NextResponse.json({ error: "adjusts_transaction_id does not reference an existing transaction" }, { status: 400 });
      }
      if (original.organization_id !== orgId) {
        return NextResponse.json({ error: "adjustment must belong to the same organization" }, { status: 403 });
      }
      if (original.parent_entity_id !== parent_entity_id || original.deal_entity_id !== id) {
        return NextResponse.json({ error: "adjustment must reference the same investor + deal as the original" }, { status: 400 });
      }
    }

    // Create the parent (entity-level) transaction
    const { data: parentTxn, error: parentErr } = await supabase
      .from("investment_transactions")
      .insert({
        organization_id: orgId,
        parent_entity_id,
        deal_entity_id: id,
        member_directory_id: null,
        transaction_type,
        amount,
        transaction_date,
        description: description || null,
        document_id: document_id || null,
        parent_transaction_id: null,
        line_items: normalizedLineItems,
        adjusts_transaction_id: adjusts_transaction_id ?? null,
        adjustment_reason: adjustment_reason ?? null,
        created_by: user.id,
      })
      .select()
      .single();

    if (parentErr) {
      console.error("Insert parent transaction error:", parentErr);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    // Determine per-member splits
    let splits: Array<{ member_directory_id: string; amount: number }> = [];

    if (split_by_allocation !== false && !member_amounts) {
      // Default: auto-split by allocation percentages
      const { data: allocations } = await supabase
        .from("investment_allocations")
        .select("member_directory_id, allocation_pct")
        .eq("deal_entity_id", id)
        .eq("parent_entity_id", parent_entity_id)
        .eq("is_active", true);

      if (allocations && allocations.length > 0) {
        splits = allocations.map((a: { member_directory_id: string; allocation_pct: number }) => ({
          member_directory_id: a.member_directory_id,
          amount: Math.round((Number(a.allocation_pct) / 100) * amount * 100) / 100,
        }));

        // Adjust rounding: give any remainder to the first member
        const splitTotal = splits.reduce((sum, s) => sum + s.amount, 0);
        const diff = Math.round((amount - splitTotal) * 100) / 100;
        if (diff !== 0 && splits.length > 0) {
          splits[0].amount = Math.round((splits[0].amount + diff) * 100) / 100;
        }
      }
    } else if (Array.isArray(member_amounts)) {
      // Custom per-member amounts
      splits = member_amounts;
    }

    // Insert per-member transactions
    const memberTxns = [];
    for (const split of splits) {
      const { data, error } = await supabase
        .from("investment_transactions")
        .insert({
          organization_id: orgId,
          parent_entity_id,
          deal_entity_id: id,
          member_directory_id: split.member_directory_id,
          transaction_type,
          amount: split.amount,
          transaction_date,
          description: description || null,
          document_id: document_id || null,
          parent_transaction_id: parentTxn.id,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) {
        console.error("Insert member transaction error:", error);
        // Continue — don't fail the whole operation for one member
      } else {
        memberTxns.push(data);
      }
    }

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "create",
      resourceType: "investment_transaction",
      resourceId: id,
      entityId: id,
      metadata: {
        parent_entity_id,
        transaction_type,
        amount,
        transaction_date,
        member_count: splits.length,
        parent_transaction_id: parentTxn.id,
      },
      ...reqCtx,
    });

    await invalidateOrgCaches(orgId);

    return NextResponse.json(
      {
        parent_transaction: parentTxn,
        member_transactions: memberTxns,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("POST /api/entities/[id]/investment-transactions error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/entities/[id]/investment-transactions
 *
 * Deletes a transaction and its child member transactions.
 * Body: { transaction_id: string }
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const isValid = await validateEntityOrg(id, orgId);
    if (!isValid) return NextResponse.json({ error: "Entity not found" }, { status: 404 });

    const supabase = createAdminClient();
    const body = await request.json();
    const { transaction_id } = body;

    if (!transaction_id) {
      return NextResponse.json({ error: "transaction_id is required" }, { status: 400 });
    }

    // Delete child transactions first (member splits)
    await supabase
      .from("investment_transactions")
      .delete()
      .eq("parent_transaction_id", transaction_id)
      .eq("deal_entity_id", id);

    // Delete the parent transaction
    const { error } = await supabase
      .from("investment_transactions")
      .delete()
      .eq("id", transaction_id)
      .eq("deal_entity_id", id);

    if (error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "delete",
      resourceType: "investment_transaction",
      resourceId: id,
      entityId: id,
      metadata: { transaction_id },
      ...reqCtx,
    });

    await invalidateOrgCaches(orgId);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/entities/[id]/investment-transactions error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
