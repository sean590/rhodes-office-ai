import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createOrgClient } from "@/lib/supabase/org-client";
import {
  getRuleById,
  calculateNextDueDateAfterCompletion,
} from "@/lib/utils/compliance-engine";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { requireOrg, isError, validateEntityOrg } from "@/lib/utils/org-context";
import { headers } from "next/headers";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; obligationId: string }> }
) {
  try {
    const { id, obligationId } = await params;
    const orgCtx = await requireOrg();
    if (isError(orgCtx)) return orgCtx;
    const { orgId } = orgCtx;

    const isValid = await validateEntityOrg(id, orgId);
    if (!isValid) return NextResponse.json({ error: "Entity not found" }, { status: 404 });

    const supabase = await createClient();
    const db = createOrgClient(orgId);
    const body = await request.json();

    // Fetch the existing obligation
    const { data: obligation, error: oblError } = await supabase
      .from("compliance_obligations")
      .select("*")
      .eq("id", obligationId)
      .eq("entity_id", id)
      .single();

    if (oblError) {
      if (oblError.code === "PGRST116") {
        return NextResponse.json(
          { error: "Obligation not found" },
          { status: 404 }
        );
      }
      console.error("PUT /api/entities/[id]/compliance/[obligationId] obligation fetch:", oblError);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    // Handle status changes
    if (body.status) {
      // Default: write whatever status the caller asked for. For
      // completion, we may override below based on whether a next cycle
      // exists (rolling obligation goes back to 'pending', one_time stays
      // 'completed').
      updates.status = body.status;

      if (body.status === "completed") {
        const proposedCompletedAt = body.completed_at || new Date().toISOString();
        updates.completed_at = proposedCompletedAt;
        if (body.completed_by) updates.completed_by = body.completed_by;
        if (body.payment_amount !== undefined)
          updates.payment_amount = body.payment_amount;
        if (body.confirmation !== undefined)
          updates.confirmation = body.confirmation;
        if (body.document_id) updates.document_id = body.document_id;
        if (body.notes !== undefined) updates.notes = body.notes;

        // Append a history row so we keep the audit trail of every
        // completion. The cycle_due_date is captured BEFORE we advance
        // next_due_date on the parent row below.
        const cycleDueDate = obligation.next_due_date as string | null;
        const completedDate = proposedCompletedAt.split("T")[0];
        if (cycleDueDate) {
          const { error: cycleErr } = await db.raw
            .from("compliance_obligation_cycles")
            .insert({
              obligation_id: obligationId,
              cycle_due_date: cycleDueDate,
              completed_at: proposedCompletedAt,
              completed_by: body.completed_by ?? orgCtx.user?.id ?? null,
              document_id: body.document_id ?? null,
              payment_amount:
                body.payment_amount !== undefined ? body.payment_amount : null,
              confirmation:
                body.confirmation !== undefined ? body.confirmation : null,
              notes: body.notes !== undefined ? body.notes : null,
            });
          if (cycleErr) {
            console.error(
              `[compliance] failed to append cycle history for obligation ${obligationId}:`,
              cycleErr.message,
            );
            // Non-fatal — the parent row update is the user-visible part.
          }
        }

        // Determine next cycle's due date. Rule-driven obligations use
        // the rule's frequency; ad-hoc obligations use their own
        // frequency column. one_time / continuous don't advance.
        let nextDue: string | null = null;
        const rule = obligation.rule_id ? getRuleById(obligation.rule_id) : null;
        const obligationFrequency = (obligation.frequency as string) || "one_time";

        if (rule && rule.frequency !== "one_time" && rule.frequency !== "continuous") {
          const { data: entity } = await supabase
            .from("entities")
            .select("formed_date")
            .eq("id", id)
            .single();
          nextDue = calculateNextDueDateAfterCompletion(
            rule,
            completedDate,
            entity?.formed_date || null,
          );
        } else if (
          !rule &&
          obligationFrequency !== "one_time" &&
          obligationFrequency !== "continuous"
        ) {
          // Ad-hoc obligation: synthesize a minimal rule for the
          // next-due calculation. Same math, no rule_id required.
          const synthesizedRule = {
            id: `ad_hoc_${obligationId}`,
            frequency: obligationFrequency,
            jurisdiction: obligation.jurisdiction,
            obligation_type: obligation.obligation_type,
            name: obligation.name,
            description: obligation.description,
            fee: obligation.fee_description,
            form_number: obligation.form_number,
            portal_url: obligation.portal_url,
            filed_with: obligation.filed_with,
            penalty_description: obligation.penalty_description,
          };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          nextDue = calculateNextDueDateAfterCompletion(synthesizedRule as any, completedDate, null);
        }

        // Advance the existing row in place: if there's a next cycle,
        // status returns to pending with the new due date. If not
        // (one_time / continuous), the row stays 'completed' so the
        // completion record is preserved.
        if (nextDue) {
          updates.next_due_date = nextDue;
          updates.status = "pending";
        }
      }
    }

    // Handle individual field updates
    if (body.notes !== undefined && !updates.notes) updates.notes = body.notes;

    const { data: updated, error: updateError } = await db
      .from("compliance_obligations")
      .update(updates)
      .eq("id", obligationId)
      .select()
      .single();

    if (updateError) {
      console.error("PUT /api/entities/[id]/compliance/[obligationId] update:", updateError);
      return NextResponse.json({ error: "Failed to update obligation" }, { status: 500 });
    }

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: orgCtx.user?.id ?? null,
      action: "update_obligation",
      resourceType: "compliance",
      resourceId: obligationId,
      entityId: id,
      metadata: { entity_id: id, status: body.status },
      ...reqCtx,
    });

    return NextResponse.json(updated);
  } catch (err) {
    console.error("PUT /api/entities/[id]/compliance/[obligationId] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
