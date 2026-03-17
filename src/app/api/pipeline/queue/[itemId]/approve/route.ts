import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { ingestQueueItem } from "@/lib/pipeline/ingest";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";

function describeAction(action: Record<string, unknown>): string {
  const a = action.action as string;
  const d = (action.data || {}) as Record<string, unknown>;
  switch (a) {
    case "create_entity": return `Create entity: ${d.name || "unknown"}`;
    case "update_entity": {
      const fields = d.fields as Record<string, unknown> | undefined;
      return fields ? `Update entity: ${Object.keys(fields).join(", ")}` : "Update entity";
    }
    case "create_relationship": return `Create relationship: ${d.description || d.type || "relationship"}`;
    case "add_member": return `Add member: ${d.name || "unknown"}`;
    case "add_manager": return `Add manager: ${d.name || "unknown"}`;
    case "add_registration": return `Add registration: ${d.jurisdiction || "unknown"}`;
    case "update_registration": return `Update registration: ${d.jurisdiction || d.registration_id || "unknown"}`;
    case "add_trust_role": return `Add trust role: ${d.role || "role"} = ${d.name || "unknown"}`;
    case "update_trust_details": {
      const keys = Object.keys(d).filter((k) => k !== "entity_id");
      return `Update trust details: ${keys.join(", ")}`;
    }
    case "update_cap_table": return `Update cap table: ${d.investor_name || "unknown"}`;
    case "create_directory_entry": return `Create directory entry: ${d.name || "unknown"}`;
    case "add_custom_field": return `Add field: ${d.label || "unknown"} = ${d.value || ""}`;
    case "add_partnership_rep": return `Add partnership rep: ${d.name || "unknown"}`;
    case "add_role": return `Add role: ${d.role_title || "role"} = ${d.name || "unknown"}`;
    case "complete_obligation": return `Complete obligation${d.payment_amount ? ` ($${(d.payment_amount as number) / 100})` : ""}`;
    default: return a.replace(/_/g, " ");
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const { itemId } = await params;
    const admin = createAdminClient();

    // Parse optional excluded_actions from request body
    let excludedActionIndices: number[] = [];
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      try {
        const body = await request.json();
        if (Array.isArray(body?.excluded_actions)) {
          excludedActionIndices = body.excluded_actions.filter((i: unknown) => typeof i === "number");
        }
      } catch { /* empty body is fine */ }
    }

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

    // Handle multi_entity_creation: replace create_entity actions for entities that already exist
    if (item.approval_reason === "multi_entity_creation" && Array.isArray(item.ai_proposed_actions)) {
      const proposedEntities = (item.ai_proposed_entities || []) as Array<Record<string, unknown>>;
      const actions = item.ai_proposed_actions as Array<{ action: string; data: Record<string, unknown> }>;

      // Fuzzy name matching — handles "Gift Trust" vs "Trust", punctuation diffs
      const fuzzyMatch = (a: string, b: string): boolean => {
        const normalize = (s: string) => s.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "").replace(/\s+/g, " ").trim();
        const na = normalize(a);
        const nb = normalize(b);
        if (na === nb) return true;
        const wordsA = new Set(na.split(" "));
        const wordsB = new Set(nb.split(" "));
        const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
        const smaller = Math.min(wordsA.size, wordsB.size);
        return smaller > 0 && intersection / smaller >= 0.8;
      };

      // Build a map of proposed entity names to existing entity IDs
      const existingMap = new Map<string, string>();
      if (proposedEntities.length > 0) {
        const { data: orgEntities } = await admin
          .from("entities")
          .select("id, name")
          .eq("organization_id", orgId);

        for (const pe of proposedEntities) {
          const peName = String(pe.name || "");
          const match = (orgEntities || []).find((e) => fuzzyMatch(e.name, peName));
          if (match) {
            existingMap.set(peName.toLowerCase(), match.id);
          }
        }
      }

      // Replace create_entity actions with placeholder resolutions for existing entities
      if (existingMap.size > 0) {
        let createIdx = 0;
        const placeholderToExisting = new Map<string, string>();
        const filteredActions: typeof actions = [];

        for (const action of actions) {
          if (action.action === "create_entity") {
            const name = String(action.data.name || "").toLowerCase();
            const existingId = existingMap.get(name);
            if (existingId) {
              // Map the placeholder to existing entity ID — skip the create
              placeholderToExisting.set(`new_entity_${createIdx}`, existingId);
              placeholderToExisting.set("new_entity", placeholderToExisting.get("new_entity") || existingId);
            } else {
              filteredActions.push(action);
            }
            createIdx++;
          } else {
            filteredActions.push(action);
          }
        }

        // Resolve placeholders in remaining actions
        for (const action of filteredActions) {
          for (const [key, value] of Object.entries(action.data)) {
            if (typeof value === "string" && placeholderToExisting.has(value)) {
              action.data[key] = placeholderToExisting.get(value)!;
            }
          }
        }

        item.ai_proposed_actions = filteredActions;

        // Set the first existing entity as the primary entity if none set
        if (!item.ai_entity_id && !item.staged_entity_id) {
          const firstExisting = Array.from(existingMap.values())[0];
          if (firstExisting) {
            item.ai_entity_id = firstExisting;
          }
        }

        // Store existing entity IDs for linking later (via ai_related_entities)
        const existingRelated = (item.ai_related_entities || []) as Array<Record<string, unknown>>;
        for (const [, existingId] of existingMap) {
          if (existingId !== item.ai_entity_id && !existingRelated.some((r) => r.entity_id === existingId)) {
            existingRelated.push({
              entity_id: existingId,
              role: "related",
              confidence: "high",
              reason: "Entity referenced in umbrella document",
            });
          }
        }
        item.ai_related_entities = existingRelated;
      }
    }

    // Handle new_entity approval: create the entity first
    // Skip if user already assigned an existing entity (user_corrected = true means PATCH was called)
    if (item.approval_reason === "new_entity" && item.ai_proposed_entity && !item.user_corrected) {
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
            orgId,
            applyMutations: false,
            finalStatus: "approved",
          });
          if (!childResult.success) {
            console.error(`Auto-approve child ${child.id} failed:`, childResult.error);
          }
        }
      }
    }

    // Filter out excluded actions before ingesting
    if (excludedActionIndices.length > 0 && Array.isArray(item.ai_proposed_actions)) {
      const excludedSet = new Set(excludedActionIndices);
      item.ai_proposed_actions = (item.ai_proposed_actions as unknown[]).filter(
        (_: unknown, i: number) => !excludedSet.has(i)
      );
    }

    const result = await ingestQueueItem({
      item,
      userId,
      orgId,
      applyMutations: true,
      finalStatus: "approved",
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "approve",
      resourceType: "pipeline_item",
      resourceId: itemId,
      entityId: item.ai_entity_id || newEntityId,
      metadata: {
        batch_id: item.batch_id,
        new_entity_id: newEntityId,
        actions_applied: result.actions_applied,
        document_name: item.ai_suggested_name || item.original_filename,
        document_id: result.document?.id,
        document_type: item.ai_document_type || item.staged_doc_type,
        changes: Array.isArray(item.ai_proposed_actions)
          ? (item.ai_proposed_actions as Record<string, unknown>[]).map(describeAction)
          : [],
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
