import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getRuleById,
  calculateNextDueDateAfterCompletion,
} from "@/lib/utils/compliance-engine";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; obligationId: string }> }
) {
  try {
    const { id, obligationId } = await params;
    const supabase = await createClient();
    const admin = createAdminClient();
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
      return NextResponse.json({ error: oblError.message }, { status: 500 });
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    // Handle status changes
    if (body.status) {
      updates.status = body.status;

      if (body.status === "completed") {
        updates.completed_at = body.completed_at || new Date().toISOString();
        if (body.completed_by) updates.completed_by = body.completed_by;
        if (body.payment_amount !== undefined)
          updates.payment_amount = body.payment_amount;
        if (body.confirmation !== undefined)
          updates.confirmation = body.confirmation;
        if (body.document_id) updates.document_id = body.document_id;
        if (body.notes !== undefined) updates.notes = body.notes;

        // After completion, create the next cycle's obligation
        const rule = getRuleById(obligation.rule_id);
        if (rule && rule.frequency !== "one_time" && rule.frequency !== "continuous") {
          // Fetch entity for formed_date
          const { data: entity } = await supabase
            .from("entities")
            .select("formed_date")
            .eq("id", id)
            .single();

          const completedDate =
            (body.completed_at || new Date().toISOString()).split("T")[0];
          const nextDue = calculateNextDueDateAfterCompletion(
            rule,
            completedDate,
            entity?.formed_date || null
          );

          if (nextDue) {
            // Upsert next cycle obligation
            await admin.from("compliance_obligations").upsert(
              {
                entity_id: id,
                rule_id: obligation.rule_id,
                jurisdiction: obligation.jurisdiction,
                obligation_type: obligation.obligation_type,
                name: obligation.name,
                description: obligation.description,
                frequency: obligation.frequency,
                next_due_date: nextDue,
                fee_description: obligation.fee_description,
                form_number: obligation.form_number,
                portal_url: obligation.portal_url,
                filed_with: obligation.filed_with,
                penalty_description: obligation.penalty_description,
                status: "pending",
              },
              { onConflict: "entity_id,rule_id,next_due_date" }
            );
          }
        }
      }
    }

    // Handle individual field updates
    if (body.notes !== undefined && !updates.notes) updates.notes = body.notes;

    const { data: updated, error: updateError } = await admin
      .from("compliance_obligations")
      .update(updates)
      .eq("id", obligationId)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json(updated);
  } catch (err) {
    console.error("PUT /api/entities/[id]/compliance/[obligationId] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
