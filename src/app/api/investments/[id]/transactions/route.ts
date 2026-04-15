import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError, validateInvestmentOrg } from "@/lib/utils/org-context";
import { logAuditEvent, getRequestContext, formatCurrency, humanizeField, buildChanges } from "@/lib/utils/audit";
import { invalidateOrgCaches } from "@/lib/utils/chat-context";
import {
  createInvestmentTransactionSchema,
  validateInvestmentTransactionLineItems,
  coerceLineItemCategories,
  type TransactionLineItemInput,
} from "@/lib/validations";

/**
 * GET /api/investments/[id]/transactions
 *
 * Returns transactions for an investment.
 * Query params:
 *   - investor_id (optional): filter by investment_investor_id
 *   - type (optional): filter by transaction_type
 *   - parent_only (optional): only return parent transactions (member_directory_id is null)
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

    const isValid = await validateInvestmentOrg(id, orgId);
    if (!isValid) return NextResponse.json({ error: "Investment not found" }, { status: 404 });

    const supabase = createAdminClient();
    const url = new URL(request.url);
    const investorId = url.searchParams.get("investor_id");
    const txnType = url.searchParams.get("type");
    const parentOnly = url.searchParams.get("parent_only") === "true";

    let query = supabase
      .from("investment_transactions")
      .select("*, directory_entries:member_directory_id(name), documents:document_id(name)")
      .eq("investment_id", id)
      .eq("organization_id", orgId)
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (investorId) {
      query = query.eq("investment_investor_id", investorId);
    }
    if (txnType) {
      query = query.eq("transaction_type", txnType);
    }
    if (parentOnly) {
      query = query.is("parent_transaction_id", null);
    }

    const { data, error } = await query;

    if (error) {
      console.error("GET investment transactions error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    // If investor_id was provided, fetch the investor entity name for enrichment
    let investorEntityName: string | null = null;
    if (investorId) {
      const { data: investorRow } = await supabase
        .from("investment_investors")
        .select("entities:entity_id(name)")
        .eq("id", investorId)
        .single();

      if (investorRow) {
        const entity = (investorRow as Record<string, unknown>).entities as { name: string } | null;
        investorEntityName = entity?.name ?? null;
      }
    }

    const transactions = (data || []).map((row: Record<string, unknown>) => {
      const dirEntry = row.directory_entries as { name: string } | null;
      const doc = row.documents as { name: string } | null;
      const { directory_entries: _, documents: _d, ...rest } = row;
      return {
        ...rest,
        member_name: dirEntry?.name ?? null,
        document_name: doc?.name ?? null,
        ...(investorEntityName ? { investor_entity_name: investorEntityName } : {}),
      };
    });

    return NextResponse.json(transactions);
  } catch (err) {
    console.error("GET /api/investments/[id]/transactions error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/investments/[id]/transactions
 *
 * Creates a transaction for a specific investor with optional auto-split by allocation.
 * Body: {
 *   investment_investor_id: string,
 *   transaction_type: string,
 *   amount: number,
 *   transaction_date: string,
 *   description?: string,
 *   document_id?: string,
 *   split_by_allocation?: boolean,
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

    const body = await request.json();

    // Auto-coerce common AI category mistakes (audit_tax_expense ↔
    // compliance_holdback) BEFORE Zod runs, so the superRefine sees the
    // corrected categories. Skipping coercion when transaction_type is
    // missing — Zod will reject that case anyway.
    if (
      body &&
      typeof body === "object" &&
      Array.isArray((body as Record<string, unknown>).line_items) &&
      typeof (body as Record<string, unknown>).transaction_type === "string"
    ) {
      const t = (body as Record<string, unknown>).transaction_type as string;
      if (t === "contribution" || t === "distribution" || t === "return_of_capital") {
        const rawLines = (body as { line_items: Array<Record<string, unknown>> }).line_items;
        const normalized: TransactionLineItemInput[] = rawLines.map((li) => ({
          category: li.category as TransactionLineItemInput["category"],
          amount: Number(li.amount),
          description: (li.description as string) ?? null,
        }));
        (body as Record<string, unknown>).line_items = coerceLineItemCategories(t, normalized);
      }
    }

    const parsed = createInvestmentTransactionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid request" }, { status: 400 });
    }
    const {
      investment_investor_id,
      transaction_type,
      amount,
      transaction_date,
      description,
      document_id,
      line_items,
      adjusts_transaction_id,
      adjustment_reason,
    } = parsed.data;

    const supabase = createAdminClient();

    // If this is an adjustment, verify the referenced row belongs to the same
    // org and the same investor position. The Zod schema can't see the DB.
    if (adjusts_transaction_id) {
      const { data: original } = await supabase
        .from("investment_transactions")
        .select("id, organization_id, investment_investor_id")
        .eq("id", adjusts_transaction_id)
        .maybeSingle();
      if (!original) {
        return NextResponse.json({ error: "adjusts_transaction_id does not reference an existing transaction" }, { status: 400 });
      }
      if (original.organization_id !== orgId) {
        return NextResponse.json({ error: "adjustment must belong to the same organization" }, { status: 403 });
      }
      if (original.investment_investor_id !== investment_investor_id) {
        return NextResponse.json({ error: "adjustment must reference the same investor position as the original" }, { status: 400 });
      }
    }

    // Create the parent (investor-level) transaction — no member_directory_id.
    // Spec 036: line_items and adjustment fields live on the parent row.
    const { data: parentTxn, error: parentErr } = await supabase
      .from("investment_transactions")
      .insert({
        organization_id: orgId,
        investment_id: id,
        investment_investor_id,
        member_directory_id: null,
        transaction_type,
        amount,
        transaction_date,
        description: description || null,
        document_id: document_id || null,
        parent_transaction_id: null,
        line_items: line_items ?? [],
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

    // Fetch investment name for audit description
    const { data: investmentRecord } = await supabase
      .from("investments")
      .select("name")
      .eq("id", id)
      .single();
    const investmentName = investmentRecord?.name ?? id;

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "create",
      resourceType: "investment_transaction",
      resourceId: id,
      investmentId: id,
      metadata: {
        description: `Recorded ${transaction_type} of $${formatCurrency(amount)} for ${investmentName}`,
        investment_name: investmentName,
        transaction_type,
        amount,
        investment_investor_id,
        transaction_date,
        parent_transaction_id: parentTxn.id,
      },
      ...reqCtx,
    });

    await invalidateOrgCaches(orgId);

    return NextResponse.json(
      { parent_transaction: parentTxn },
      { status: 201 }
    );
  } catch (err) {
    console.error("POST /api/investments/[id]/transactions error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/investments/[id]/transactions
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

    const isValid = await validateInvestmentOrg(id, orgId);
    if (!isValid) return NextResponse.json({ error: "Investment not found" }, { status: 404 });

    const supabase = createAdminClient();
    const body = await request.json();
    const { transaction_id } = body;

    if (!transaction_id) {
      return NextResponse.json({ error: "transaction_id is required" }, { status: 400 });
    }

    // Delete child transactions first
    await supabase
      .from("investment_transactions")
      .delete()
      .eq("parent_transaction_id", transaction_id)
      .eq("investment_id", id);

    // Delete the parent transaction
    const { error } = await supabase
      .from("investment_transactions")
      .delete()
      .eq("id", transaction_id)
      .eq("investment_id", id);

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
      investmentId: id,
      metadata: { transaction_id },
      ...reqCtx,
    });

    await invalidateOrgCaches(orgId);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/investments/[id]/transactions error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/investments/[id]/transactions
 *
 * Edit an existing transaction in place. This is the right path for fixing
 * typos (wrong date, wrong amount, missing line items) — it mutates the
 * original row and writes a full audit log entry capturing the before/after.
 *
 * Use POST with `adjusts_transaction_id` set when you want to record an
 * after-the-fact financial amendment instead (e.g., a sponsor recall). PATCH
 * never creates new rows.
 *
 * Editable fields: amount, transaction_date, description, line_items,
 * document_id. Non-editable: investment_investor_id, transaction_type,
 * adjusts_transaction_id, adjustment_reason. To change those, delete and
 * re-create the row.
 *
 * Body: {
 *   transaction_id: string,
 *   amount?: number,
 *   transaction_date?: string,
 *   description?: string | null,
 *   document_id?: string | null,
 *   line_items?: TransactionLineItem[],
 * }
 */
export async function PATCH(
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

    const supabase = createAdminClient();
    const body = await request.json();
    const { transaction_id, ...updates } = body as Record<string, unknown>;

    if (!transaction_id || typeof transaction_id !== "string") {
      return NextResponse.json({ error: "transaction_id is required" }, { status: 400 });
    }

    // Fetch the existing row so we can (a) authorize on org, (b) validate
    // line_items against the existing transaction_type and adjustment status,
    // (c) feed buildChanges() for the audit log.
    const { data: existing, error: fetchErr } = await supabase
      .from("investment_transactions")
      .select("*")
      .eq("id", transaction_id)
      .eq("investment_id", id)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (fetchErr || !existing) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    // Strip out fields that are not editable via PATCH. The user can change
    // these by deleting + recreating.
    const FORBIDDEN = new Set([
      "investment_investor_id",
      "transaction_type",
      "adjusts_transaction_id",
      "adjustment_reason",
      "investment_id",
      "organization_id",
      "created_by",
      "created_at",
      "id",
      "parent_transaction_id",
      "member_directory_id",
    ]);
    for (const key of Object.keys(updates)) {
      if (FORBIDDEN.has(key)) {
        return NextResponse.json(
          { error: `Field "${key}" cannot be edited. Delete and recreate the transaction to change it.` },
          { status: 400 }
        );
      }
    }

    // Validate line_items if present, against the EXISTING transaction_type
    // and adjustment status (since neither is being changed). Also auto-coerce
    // common AI category mistakes (audit_tax_expense ↔ compliance_holdback)
    // before validation so the model can never trip the validator on this
    // particular naming confusion.
    if (updates.line_items !== undefined) {
      const rawLineItems = Array.isArray(updates.line_items)
        ? (updates.line_items as Array<Record<string, unknown>>).map((li) => ({
            category: li.category as TransactionLineItemInput["category"],
            amount: Number(li.amount),
            description: (li.description as string) ?? null,
          }))
        : [];
      const coercedLineItems = coerceLineItemCategories(
        existing.transaction_type as "contribution" | "distribution" | "return_of_capital",
        rawLineItems,
      );
      const newAmount = updates.amount !== undefined ? Number(updates.amount) : Number(existing.amount);
      const lineItemCheck = validateInvestmentTransactionLineItems({
        transaction_type: existing.transaction_type as "contribution" | "distribution" | "return_of_capital",
        amount: newAmount,
        line_items: coercedLineItems,
        adjusts_transaction_id: existing.adjusts_transaction_id,
      });
      if (!lineItemCheck.ok) {
        return NextResponse.json({ error: lineItemCheck.error }, { status: 400 });
      }
      updates.line_items = coercedLineItems;
    }

    // Amount sign rule: non-adjustment rows must be positive.
    if (updates.amount !== undefined) {
      const newAmount = Number(updates.amount);
      if (!Number.isFinite(newAmount)) {
        return NextResponse.json({ error: "amount must be a number" }, { status: 400 });
      }
      if (!existing.adjusts_transaction_id && newAmount <= 0) {
        return NextResponse.json({ error: "amount must be positive on non-adjustment rows" }, { status: 400 });
      }
      updates.amount = newAmount;
    }

    if (updates.transaction_date !== undefined && typeof updates.transaction_date !== "string") {
      return NextResponse.json({ error: "transaction_date must be a string" }, { status: 400 });
    }

    // Apply the update.
    const updatePayload: Record<string, unknown> = { ...updates, updated_at: new Date().toISOString() };
    const { data: updated, error: updateErr } = await supabase
      .from("investment_transactions")
      .update(updatePayload)
      .eq("id", transaction_id)
      .select()
      .single();

    if (updateErr) {
      console.error("PATCH transaction update error:", updateErr);
      return NextResponse.json({ error: updateErr.message || "Internal server error" }, { status: 500 });
    }

    // Audit log — same shape as the investment PATCH route, with full
    // before/after diff via buildChanges.
    const changedFields = Object.keys(updates).map((f) => humanizeField(f)).join(", ");
    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "edit",
      resourceType: "investment_transaction",
      resourceId: transaction_id,
      investmentId: id,
      metadata: {
        description: `Edited ${existing.transaction_type} of $${formatCurrency(Number(existing.amount))} on ${existing.transaction_date}: ${changedFields}`,
        transaction_type: existing.transaction_type,
        original_amount: Number(existing.amount),
        original_date: existing.transaction_date,
        fields_updated: Object.keys(updates),
        changes: buildChanges(existing as Record<string, unknown>, updates as Record<string, unknown>),
      },
      ...reqCtx,
    });

    await invalidateOrgCaches(orgId);

    return NextResponse.json(updated);
  } catch (err) {
    console.error("PATCH /api/investments/[id]/transactions error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
