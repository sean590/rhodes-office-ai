/**
 * Shared action-application logic — used by both the pipeline approve endpoint
 * and the existing /api/documents/[id]/apply route.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { getRuleById, calculateNextDueDateAfterCompletion } from "@/lib/utils/compliance-engine";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ApplyResult {
  action: string;
  success: boolean;
  error?: string;
  data?: unknown;
}

export interface ApplyOptions {
  documentId?: string;  // For linking compliance obligations
  existingEntityId?: string;  // Document's current entity_id
  orgId?: string;  // Organization ID for new root-table records
}

/**
 * Apply a set of proposed actions to the database.
 * Returns results for each action.
 */
export async function applyActions(
  actions: Array<{ action: string; data: Record<string, unknown> }>,
  options: ApplyOptions = {}
): Promise<{ results: ApplyResult[]; firstCreatedEntityId: string | null }> {
  const supabase = createAdminClient();
  const results: ApplyResult[] = [];
  let firstCreatedEntityId: string | null = null;
  const createdTrustDetailIds = new Map<string, string>();

  const resolveEntityId = (value: unknown): string | null => {
    if (typeof value === "string" && UUID_REGEX.test(value)) return value;
    return firstCreatedEntityId || options.existingEntityId || null;
  };

  for (const item of actions) {
    // Fix non-UUID entity_id placeholders
    if (item.data?.entity_id && !UUID_REGEX.test(item.data.entity_id as string)) {
      item.data.entity_id = resolveEntityId(item.data.entity_id);
    }

    try {
      switch (item.action) {
        case "create_entity": {
          const { data, error } = await supabase
            .from("entities")
            .insert({
              name: item.data.name,
              type: item.data.type || "other",
              status: "active",
              ein: item.data.ein || null,
              formation_state: item.data.formation_state || "DE",
              formed_date: item.data.formed_date || null,
              address: item.data.address || null,
              registered_agent: item.data.registered_agent || null,
              notes: item.data.notes || null,
              business_purpose: item.data.business_purpose || null,
              organization_id: options.orgId,
            })
            .select()
            .single();

          if (error) throw error;

          if (item.data.formation_state) {
            await supabase.from("entity_registrations").insert({
              entity_id: data.id,
              jurisdiction: item.data.formation_state,
            });
          }

          if ((item.data.type || "other") === "trust") {
            const { data: trustDetail } = await supabase
              .from("trust_details")
              .insert({
                entity_id: data.id,
                trust_type: "revocable",
                situs_state: item.data.formation_state || "DE",
              })
              .select("id")
              .single();
            if (trustDetail) {
              createdTrustDetailIds.set(data.id, trustDetail.id);
            }
          }

          if (!firstCreatedEntityId) {
            firstCreatedEntityId = data.id;
          }

          results.push({ action: "create_entity", success: true, data });
          break;
        }

        case "update_entity": {
          const allowedFields = [
            "name", "type", "status", "ein", "formation_state", "formed_date",
            "address", "registered_agent", "notes", "business_purpose",
          ];
          const updates: Record<string, unknown> = {};
          for (const field of allowedFields) {
            if (field in (item.data.fields as Record<string, unknown> || {})) {
              updates[field] = (item.data.fields as Record<string, unknown>)[field];
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
          results.push({ action: "update_entity", success: true, data });
          break;
        }

        case "create_relationship": {
          // Normalize AI-generated frequency values to valid enum values
          const VALID_FREQUENCIES = ["one_time", "monthly", "quarterly", "semi_annual", "annual", "upon_event", "na"];
          const FREQUENCY_ALIASES: Record<string, string> = {
            annually: "annual",
            yearly: "annual",
            "semi-annual": "semi_annual",
            semiannual: "semi_annual",
            "semi-annually": "semi_annual",
            biannual: "semi_annual",
            "one-time": "one_time",
            onetime: "one_time",
            once: "one_time",
            "per event": "upon_event",
          };
          let freq = (item.data.frequency as string) || "na";
          freq = FREQUENCY_ALIASES[freq.toLowerCase()] || freq;
          if (!VALID_FREQUENCIES.includes(freq)) freq = "na";

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
              frequency: freq,
              annual_estimate: item.data.annual_estimate ?? null,
              status: "active",
              organization_id: options.orgId,
            })
            .select()
            .single();

          if (error) throw error;
          results.push({ action: "create_relationship", success: true, data });
          break;
        }

        case "add_member": {
          const { data, error } = await supabase
            .from("entity_members")
            .insert({ entity_id: item.data.entity_id, name: item.data.name })
            .select()
            .single();
          if (error) throw error;
          results.push({ action: "add_member", success: true, data });
          break;
        }

        case "add_manager": {
          const { data, error } = await supabase
            .from("entity_managers")
            .insert({ entity_id: item.data.entity_id, name: item.data.name })
            .select()
            .single();
          if (error) throw error;
          results.push({ action: "add_manager", success: true, data });
          break;
        }

        case "add_registration": {
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
          results.push({ action: "add_registration", success: true, data });
          break;
        }

        case "update_registration": {
          const regUpdates: Record<string, unknown> = {};
          if (item.data.qualification_date !== undefined) regUpdates.qualification_date = item.data.qualification_date || null;
          if (item.data.state_id !== undefined) regUpdates.state_id = item.data.state_id || null;

          // For last_filing_date, only update if the new date is more recent than the existing one
          if (item.data.last_filing_date) {
            const { data: currentReg } = await supabase
              .from("entity_registrations")
              .select("last_filing_date")
              .eq("id", item.data.registration_id)
              .single();

            const existingDate = currentReg?.last_filing_date;
            const proposedDate = item.data.last_filing_date as string;
            if (!existingDate || proposedDate > existingDate) {
              regUpdates.last_filing_date = proposedDate;
            }
          }

          if (Object.keys(regUpdates).length === 0) {
            results.push({ action: "update_registration", success: true, data: { id: item.data.registration_id } });
            break;
          }

          const { data, error } = await supabase
            .from("entity_registrations")
            .update(regUpdates)
            .eq("id", item.data.registration_id)
            .select()
            .single();
          if (error) throw error;
          results.push({ action: "update_registration", success: true, data });
          break;
        }

        case "add_trust_role": {
          let trustDetailId = item.data.trust_detail_id as string | undefined;
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
          if (!trustDetailId) throw new Error("Could not resolve trust_detail_id");

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
          results.push({ action: "add_trust_role", success: true, data });
          break;
        }

        case "update_trust_details": {
          const { data: existingTrust, error: findErr } = await supabase
            .from("trust_details")
            .select("id")
            .eq("entity_id", item.data.entity_id)
            .maybeSingle();
          if (findErr) throw findErr;

          let trustDetailId: string;
          if (!existingTrust) {
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
            results.push({ action: "update_trust_details", success: true, data });
          } else {
            results.push({ action: "update_trust_details", success: true, data: { id: trustDetailId } });
          }
          break;
        }

        case "update_cap_table": {
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
              investor_type: item.data.investor_type || "other",
              units: item.data.units ?? null,
              ownership_pct: item.data.ownership_pct || 0,
              capital_contributed: item.data.capital_contributed ?? 0,
            })
            .select()
            .single();
          if (error) throw error;
          results.push({ action: "update_cap_table", success: true, data });
          break;
        }

        case "create_directory_entry": {
          // Skip if a directory entry with this name already exists
          const { data: existing } = await supabase
            .from("directory_entries")
            .select("id, name")
            .ilike("name", item.data.name as string)
            .maybeSingle();

          if (existing) {
            results.push({ action: "create_directory_entry", success: true, data: existing });
            break;
          }

          const { data, error } = await supabase
            .from("directory_entries")
            .insert({
              name: item.data.name,
              type: item.data.type || "individual",
              email: item.data.email || null,
              organization_id: options.orgId,
            })
            .select()
            .single();
          if (error) throw error;
          results.push({ action: "create_directory_entry", success: true, data });
          break;
        }

        case "add_custom_field": {
          const { data: fieldDef, error: defError } = await supabase
            .from("custom_field_definitions")
            .insert({
              label: item.data.label,
              field_type: "text",
              entity_id: item.data.entity_id,
              is_global: false,
              sort_order: 0,
              organization_id: options.orgId,
            })
            .select()
            .single();
          if (defError) throw defError;

          const { error: valError } = await supabase
            .from("custom_field_values")
            .insert({
              entity_id: item.data.entity_id,
              field_def_id: fieldDef.id,
              value_text: item.data.value,
            });
          if (valError) throw valError;
          results.push({ action: "add_custom_field", success: true, data: fieldDef });
          break;
        }

        case "add_partnership_rep": {
          const { data, error } = await supabase
            .from("entity_partnership_reps")
            .upsert(
              { entity_id: item.data.entity_id, name: item.data.name },
              { onConflict: "entity_id,name" }
            )
            .select()
            .single();
          if (error) throw error;
          results.push({ action: "add_partnership_rep", success: true, data });
          break;
        }

        case "add_role": {
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
          results.push({ action: "add_role", success: true, data });
          break;
        }

        case "complete_obligation": {
          const obligationId = item.data.obligation_id as string;
          if (!obligationId) throw new Error("obligation_id is required");

          // Fetch current obligation state before updating
          const { data: currentObligation, error: fetchError } = await supabase
            .from("compliance_obligations")
            .select("*")
            .eq("id", obligationId)
            .single();
          if (fetchError) throw fetchError;

          const proposedCompletedAt = (item.data.completed_at || new Date().toISOString().split("T")[0]) as string;

          // If obligation is already completed with a more recent date, skip
          if (
            currentObligation.status === "completed" &&
            currentObligation.completed_at &&
            currentObligation.completed_at >= proposedCompletedAt
          ) {
            results.push({
              action: "complete_obligation",
              success: true,
              data: { ...currentObligation, skipped: true, reason: "Already completed with a more recent date" },
            });
            break;
          }

          const completionUpdates: Record<string, unknown> = {
            status: "completed",
            completed_at: proposedCompletedAt,
            updated_at: new Date().toISOString(),
          };
          if (item.data.payment_amount != null) completionUpdates.payment_amount = item.data.payment_amount;
          if (item.data.confirmation) completionUpdates.confirmation = item.data.confirmation;
          if (item.data.notes) completionUpdates.notes = item.data.notes;
          if (options.documentId) completionUpdates.document_id = options.documentId;

          const { data: updatedObligation, error: obligationError } = await supabase
            .from("compliance_obligations")
            .update(completionUpdates)
            .eq("id", obligationId)
            .select()
            .single();
          if (obligationError) throw obligationError;

          // Create next cycle obligation if rule exists
          if (updatedObligation.rule_id) {
            const rule = getRuleById(updatedObligation.rule_id);
            if (rule && rule.frequency !== "one_time") {
              const { data: entity } = await supabase
                .from("entities")
                .select("formed_date")
                .eq("id", updatedObligation.entity_id)
                .single();

              const nextDueDate = calculateNextDueDateAfterCompletion(
                rule,
                proposedCompletedAt,
                entity?.formed_date || null
              );

              if (nextDueDate) {
                // Don't create a next-cycle obligation if a newer one already exists and is completed
                const { data: existingNewer } = await supabase
                  .from("compliance_obligations")
                  .select("id, status, next_due_date")
                  .eq("entity_id", updatedObligation.entity_id)
                  .eq("rule_id", rule.id)
                  .gte("next_due_date", nextDueDate)
                  .limit(1)
                  .maybeSingle();

                if (!existingNewer) {
                  await supabase
                    .from("compliance_obligations")
                    .upsert(
                      {
                        entity_id: updatedObligation.entity_id,
                        rule_id: rule.id,
                        jurisdiction: updatedObligation.jurisdiction,
                        obligation_type: rule.obligation_type,
                        name: rule.name,
                        description: rule.description,
                        frequency: rule.frequency,
                        next_due_date: nextDueDate,
                        status: "pending",
                        fee_description: rule.fee,
                        form_number: rule.form_number || null,
                        portal_url: rule.portal_url || null,
                        filed_with: rule.filed_with,
                        penalty_description: rule.penalty_description || null,
                      },
                      { onConflict: "entity_id,rule_id,next_due_date" }
                    );
                }
              }
            }
          }

          results.push({ action: "complete_obligation", success: true, data: updatedObligation });
          break;
        }

        default:
          results.push({ action: item.action, success: false, error: `Unknown action: ${item.action}` });
      }
    } catch (err: unknown) {
      const errObj = err as Record<string, unknown>;
      const message =
        errObj?.message ?? errObj?.details ?? errObj?.code ?? JSON.stringify(err) ?? "Unknown error";
      results.push({ action: item.action, success: false, error: String(message) });
    }
  }

  return { results, firstCreatedEntityId };
}
