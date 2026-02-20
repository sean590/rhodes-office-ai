import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createAdminClient();
    const body = await request.json();
    const { actions, action_indices } = body;

    if (!Array.isArray(actions)) {
      return NextResponse.json({ error: "actions must be an array" }, { status: 400 });
    }

    // Get current document to preserve existing ai_extraction data
    const { data: doc, error: docError } = await supabase
      .from("documents")
      .select("ai_extraction, entity_id")
      .eq("id", id)
      .single();

    if (docError) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const results: { action: string; success: boolean; error?: string; data?: unknown }[] = [];
    let firstCreatedEntityId: string | null = null;
    // Track entity_id → trust_detail_id for entities created in this batch
    const createdTrustDetailIds = new Map<string, string>();

    for (const item of actions) {
      try {
        switch (item.action) {
          case 'create_entity': {
            const { data, error } = await supabase
              .from("entities")
              .insert({
                name: item.data.name,
                type: item.data.type || 'other',
                status: 'active',
                ein: item.data.ein || null,
                formation_state: item.data.formation_state || 'DE',
                formed_date: item.data.formed_date || null,
                address: item.data.address || null,
                registered_agent: item.data.registered_agent || null,
                notes: item.data.notes || null,
                business_purpose: item.data.business_purpose || null,
              })
              .select()
              .single();

            if (error) throw error;

            // Auto-create registration for formation state
            if (item.data.formation_state) {
              await supabase.from("entity_registrations").insert({
                entity_id: data.id,
                jurisdiction: item.data.formation_state,
              });
            }

            // Auto-create trust_details for trust entities
            if ((item.data.type || 'other') === 'trust') {
              const { data: trustDetail } = await supabase.from("trust_details").insert({
                entity_id: data.id,
                trust_type: "revocable",
                situs_state: item.data.formation_state || 'DE',
              }).select("id").single();
              if (trustDetail) {
                createdTrustDetailIds.set(data.id, trustDetail.id);
              }
            }

            // Track first created entity for document association
            if (!firstCreatedEntityId) {
              firstCreatedEntityId = data.id;
            }

            results.push({ action: 'create_entity', success: true, data });
            break;
          }

          case 'update_entity': {
            const allowedFields = ['name', 'type', 'status', 'ein', 'formation_state', 'formed_date', 'address', 'registered_agent', 'notes', 'business_purpose'];
            const updates: Record<string, unknown> = {};
            for (const field of allowedFields) {
              if (field in (item.data.fields || {})) {
                updates[field] = item.data.fields[field];
              }
            }
            updates.updated_at = new Date().toISOString();

            const { data, error } = await supabase
              .from("entities")
              .update(updates)
              .eq("id", item.data.entity_id)
              .select()
              .single();

            if (error) throw error;
            results.push({ action: 'update_entity', success: true, data });
            break;
          }

          case 'create_relationship': {
            const { data, error } = await supabase
              .from("relationships")
              .insert({
                type: item.data.type,
                description: item.data.description || null,
                terms: item.data.terms || null,
                from_entity_id: item.data.from_entity_id || null,
                from_directory_id: item.data.from_directory_id || null,
                to_entity_id: item.data.to_entity_id || null,
                to_directory_id: item.data.to_directory_id || null,
                frequency: item.data.frequency || null,
                annual_estimate: item.data.annual_estimate ?? null,
                status: 'active',
              })
              .select()
              .single();

            if (error) throw error;
            results.push({ action: 'create_relationship', success: true, data });
            break;
          }

          case 'add_member': {
            const { data, error } = await supabase
              .from("entity_members")
              .insert({
                entity_id: item.data.entity_id,
                name: item.data.name,
              })
              .select()
              .single();

            if (error) throw error;
            results.push({ action: 'add_member', success: true, data });
            break;
          }

          case 'add_manager': {
            const { data, error } = await supabase
              .from("entity_managers")
              .insert({
                entity_id: item.data.entity_id,
                name: item.data.name,
              })
              .select()
              .single();

            if (error) throw error;
            results.push({ action: 'add_manager', success: true, data });
            break;
          }

          case 'add_registration': {
            const regInsert: Record<string, unknown> = {
              entity_id: item.data.entity_id,
              jurisdiction: item.data.jurisdiction,
            };
            if (item.data.qualification_date) regInsert.qualification_date = item.data.qualification_date;
            if (item.data.last_filing_date) regInsert.last_filing_date = item.data.last_filing_date;
            if (item.data.state_id) regInsert.state_id = item.data.state_id;

            const { data, error } = await supabase
              .from("entity_registrations")
              .insert(regInsert)
              .select()
              .single();

            if (error) throw error;
            results.push({ action: 'add_registration', success: true, data });
            break;
          }

          case 'update_registration': {
            const regUpdates: Record<string, unknown> = {};
            if (item.data.qualification_date !== undefined) regUpdates.qualification_date = item.data.qualification_date || null;
            if (item.data.last_filing_date !== undefined) regUpdates.last_filing_date = item.data.last_filing_date || null;
            if (item.data.state_id !== undefined) regUpdates.state_id = item.data.state_id || null;

            if (Object.keys(regUpdates).length === 0) {
              results.push({ action: 'update_registration', success: true, data: { id: item.data.registration_id } });
              break;
            }

            const { data, error } = await supabase
              .from("entity_registrations")
              .update(regUpdates)
              .eq("id", item.data.registration_id)
              .select()
              .single();

            if (error) throw error;
            results.push({ action: 'update_registration', success: true, data });
            break;
          }

          case 'add_trust_role': {
            // Resolve trust_detail_id: use provided value, check batch-created map, or look up from DB
            let trustDetailId = item.data.trust_detail_id;
            if (!trustDetailId && item.data.entity_id) {
              trustDetailId = createdTrustDetailIds.get(item.data.entity_id as string);
            }
            if (!trustDetailId && item.data.entity_id) {
              const { data: found } = await supabase
                .from("trust_details")
                .select("id")
                .eq("entity_id", item.data.entity_id)
                .maybeSingle();
              if (found) trustDetailId = found.id;
            }
            if (!trustDetailId) {
              throw new Error("Could not resolve trust_detail_id for trust role");
            }

            const { data, error } = await supabase
              .from("trust_roles")
              .insert({
                trust_detail_id: trustDetailId,
                role: item.data.role,
                name: item.data.name,
              })
              .select()
              .single();

            if (error) throw error;
            results.push({ action: 'add_trust_role', success: true, data });
            break;
          }

          case 'update_trust_details': {
            // Find or create trust_details for this entity
            const { data: existingTrust, error: findErr } = await supabase
              .from("trust_details")
              .select("id")
              .eq("entity_id", item.data.entity_id)
              .maybeSingle();

            if (findErr) throw findErr;

            let trustDetailId: string;

            if (!existingTrust) {
              // Auto-create if missing
              const { data: created, error: createErr } = await supabase
                .from("trust_details")
                .insert({
                  entity_id: item.data.entity_id,
                  trust_type: item.data.trust_type || "revocable",
                  situs_state: item.data.situs_state || "DE",
                })
                .select("id")
                .single();
              if (createErr) throw createErr;
              trustDetailId = created.id;
            } else {
              trustDetailId = existingTrust.id;
            }

            const trustUpdates: Record<string, unknown> = {};
            if (item.data.trust_type !== undefined) trustUpdates.trust_type = item.data.trust_type;
            if (item.data.trust_date !== undefined) trustUpdates.trust_date = item.data.trust_date || null;
            if (item.data.grantor_name !== undefined) trustUpdates.grantor_name = item.data.grantor_name || null;
            if (item.data.situs_state !== undefined) trustUpdates.situs_state = item.data.situs_state || null;

            if (Object.keys(trustUpdates).length > 0) {
              const { data, error } = await supabase
                .from("trust_details")
                .update(trustUpdates)
                .eq("id", trustDetailId)
                .select()
                .single();

              if (error) throw error;
              results.push({ action: 'update_trust_details', success: true, data });
            } else {
              results.push({ action: 'update_trust_details', success: true, data: { id: trustDetailId } });
            }
            break;
          }

          case 'update_cap_table': {
            // If replacing an existing investor, delete the old entry first
            if (item.data.replaces_investor_name) {
              await supabase
                .from("cap_table_entries")
                .delete()
                .eq("entity_id", item.data.entity_id)
                .eq("investor_name", item.data.replaces_investor_name);
            }

            const { data, error } = await supabase
              .from("cap_table_entries")
              .insert({
                entity_id: item.data.entity_id,
                investor_name: item.data.investor_name,
                investor_type: item.data.investor_type || 'other',
                units: item.data.units ?? null,
                ownership_pct: item.data.ownership_pct || 0,
                capital_contributed: item.data.capital_contributed ?? 0,
              })
              .select()
              .single();

            if (error) throw error;
            results.push({ action: 'update_cap_table', success: true, data });
            break;
          }

          case 'create_directory_entry': {
            const { data, error } = await supabase
              .from("directory_entries")
              .insert({
                name: item.data.name,
                type: item.data.type || 'individual',
                email: item.data.email || null,
              })
              .select()
              .single();

            if (error) throw error;
            results.push({ action: 'create_directory_entry', success: true, data });
            break;
          }

          case 'add_custom_field': {
            // Create field definition first
            const { data: fieldDef, error: defError } = await supabase
              .from("custom_field_definitions")
              .insert({
                label: item.data.label,
                field_type: 'text',
                entity_id: item.data.entity_id,
                is_global: false,
                sort_order: 0,
              })
              .select()
              .single();

            if (defError) throw defError;

            // Then set the value
            const { error: valError } = await supabase
              .from("custom_field_values")
              .insert({
                entity_id: item.data.entity_id,
                field_def_id: fieldDef.id,
                value_text: item.data.value,
              });

            if (valError) throw valError;
            results.push({ action: 'add_custom_field', success: true, data: fieldDef });
            break;
          }

          case 'add_partnership_rep': {
            const { data, error } = await supabase
              .from("entity_partnership_reps")
              .insert({
                entity_id: item.data.entity_id,
                name: item.data.name,
              })
              .select()
              .single();

            if (error) throw error;
            results.push({ action: 'add_partnership_rep', success: true, data });
            break;
          }

          case 'add_role': {
            const { data, error } = await supabase
              .from("entity_roles")
              .insert({
                entity_id: item.data.entity_id,
                role_title: item.data.role_title,
                name: item.data.name,
              })
              .select()
              .single();

            if (error) throw error;
            results.push({ action: 'add_role', success: true, data });
            break;
          }

          default:
            results.push({ action: item.action, success: false, error: `Unknown action: ${item.action}` });
        }
      } catch (err: unknown) {
        const errObj = err as Record<string, unknown>;
        const message = errObj?.message ?? errObj?.details ?? errObj?.code ?? JSON.stringify(err) ?? 'Unknown error';
        results.push({
          action: item.action,
          success: false,
          error: String(message),
        });
      }
    }

    // If document has no entity and we created one, associate them
    const docUpdate: Record<string, unknown> = {};
    if (!doc.entity_id && firstCreatedEntityId) {
      docUpdate.entity_id = firstCreatedEntityId;
    }

    // Track which action indices were applied
    const existingExtraction = (doc.ai_extraction || {}) as Record<string, unknown>;
    const allActions = (existingExtraction.actions || []) as unknown[];
    const previouslyAppliedIndices = (existingExtraction.applied_indices || []) as number[];

    // Merge previous + new applied indices
    const newIndices: number[] = Array.isArray(action_indices) ? action_indices : [];
    const allAppliedIndices = [...new Set([...previouslyAppliedIndices, ...newIndices])];

    // All applied when every action index is accounted for
    const allApplied = allActions.length > 0 && allActions.every(
      (_, idx) => allAppliedIndices.includes(idx)
    );

    // Merge new results with any previous results
    const previousResults = (existingExtraction.applied_results || []) as unknown[];

    await supabase
      .from("documents")
      .update({
        ...docUpdate,
        ai_extraction: {
          ...existingExtraction,
          applied: allApplied,
          applied_at: new Date().toISOString(),
          applied_indices: allAppliedIndices,
          applied_results: [...previousResults, ...results],
        },
      })
      .eq("id", id);

    return NextResponse.json({
      applied: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    });
  } catch (err) {
    console.error("POST /api/documents/[id]/apply error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
