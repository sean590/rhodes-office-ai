import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { ingestQueueItem } from "@/lib/pipeline/ingest";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const { itemId } = await params;
    const admin = createAdminClient();

    const { data: userRow } = await admin
      .from("users")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();
    const userId = userRow ? user.id : null;

    const { data: item, error: itemError } = await admin
      .from("document_queue")
      .select("*")
      .eq("id", itemId)
      .single();

    if (itemError || !item) {
      return NextResponse.json({ error: "Queue item not found" }, { status: 404 });
    }

    if (item.status !== "review_ready") {
      return NextResponse.json({ error: `Cannot approve item in status: ${item.status}` }, { status: 400 });
    }

    let newEntityId: string | null = null;

    // Handle new_entity approval: create the entity first
    if (item.approval_reason === "new_entity" && item.ai_proposed_entity) {
      const proposed = item.ai_proposed_entity as Record<string, unknown>;
      const { data: newEntity, error: entityError } = await admin
        .from("entities")
        .insert({
          name: proposed.name || "Unknown Entity",
          type: proposed.type || "other",
          status: "active",
          ein: proposed.ein || null,
          formation_state: proposed.formation_state || "DE",
          formed_date: proposed.formed_date || null,
          address: proposed.address || null,
          registered_agent: proposed.registered_agent || null,
          business_purpose: proposed.business_purpose || null,
          organization_id: orgId,
        })
        .select()
        .single();

      if (entityError || !newEntity) {
        return NextResponse.json(
          { error: `Failed to create entity: ${entityError?.message}` },
          { status: 500 }
        );
      }

      newEntityId = newEntity.id;

      // Persist the entity ID to the parent queue item so the batch summary can find it
      await admin
        .from("document_queue")
        .update({
          ai_entity_id: newEntity.id,
          staged_entity_name: newEntity.name,
          updated_at: new Date().toISOString(),
        })
        .eq("id", itemId);

      // If trust type, create trust_details
      if (proposed.type === "trust") {
        await admin.from("trust_details").insert({
          entity_id: newEntity.id,
          trust_type: (proposed.trust_type as string) || "revocable",
          situs_state: proposed.formation_state || "DE",
          trust_date: proposed.trust_date || null,
          grantor_name: proposed.grantor_name || null,
        });
      }

      // Assign the new entity to this queue item
      item.ai_entity_id = newEntity.id;

      // Update all sibling items in the same batch that have no entity
      // so they auto-populate with the new entity
      await admin
        .from("document_queue")
        .update({
          staged_entity_id: newEntity.id,
          staged_entity_name: newEntity.name,
          updated_at: new Date().toISOString(),
        })
        .eq("batch_id", item.batch_id)
        .is("ai_entity_id", null)
        .in("status", ["review_ready"])
        .neq("id", itemId);

      // Auto-approve child items that have create_entity actions for THIS entity
      // (the entity already exists now, so those actions are redundant)
      const { data: childItems } = await admin
        .from("document_queue")
        .select("*")
        .eq("batch_id", item.batch_id)
        .eq("parent_queue_id", itemId)
        .eq("status", "review_ready");

      for (const child of childItems || []) {
        // Strip create_entity actions since entity already exists, set the entity_id
        const childActions = (child.ai_proposed_actions || []) as Array<{ action: string; data: Record<string, unknown> }>;
        const filteredActions = childActions.filter((a) => a.action !== "create_entity");

        // Update the child with the new entity and filtered actions
        child.ai_entity_id = newEntity.id;
        child.ai_proposed_actions = filteredActions;

        await admin
          .from("document_queue")
          .update({
            ai_entity_id: newEntity.id,
            staged_entity_name: newEntity.name,
            ai_proposed_actions: filteredActions,
            updated_at: new Date().toISOString(),
          })
          .eq("id", child.id);

        // Auto-approve if only action was create_entity (now empty)
        if (filteredActions.length === 0) {
          const childResult = await ingestQueueItem({
            item: child,
            userId,
            applyMutations: false,
            finalStatus: "approved",
          });
          if (!childResult.success) {
            console.error(`Auto-approve child ${child.id} failed:`, childResult.error);
          }
        }
      }
    }

    const result = await ingestQueueItem({
      item,
      userId,
      applyMutations: true,
      finalStatus: "approved",
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders);
    await logAuditEvent({
      userId: user.id,
      action: "approve",
      resourceType: "pipeline_item",
      resourceId: itemId,
      metadata: {
        batch_id: item.batch_id,
        new_entity_id: newEntityId,
        actions_applied: result.actions_applied,
      },
      ...reqCtx,
    });

    return NextResponse.json({
      status: "approved",
      document: result.document,
      actions_applied: result.actions_applied,
      actions_failed: result.actions_failed,
      new_entity_id: newEntityId,
    });
  } catch (err) {
    console.error("POST /api/pipeline/queue/[itemId]/approve error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
