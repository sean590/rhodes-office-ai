/**
 * Shared action-application logic — used by both the pipeline approve endpoint
 * and the existing /api/documents/[id]/apply route.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { getRuleById, calculateNextDueDateAfterCompletion } from "@/lib/utils/compliance-engine";
import { findDirectoryMatch, normalizeName } from "@/lib/utils/name-matching";
import { invalidateOrgCaches } from "@/lib/utils/chat-context";
import {
  validateInvestmentTransactionLineItems,
  coerceLineItemCategories,
  type TransactionLineItemInput,
} from "@/lib/validations";

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
): Promise<{ results: ApplyResult[]; firstCreatedEntityId: string | null; createdEntityIds: string[] }> {
  const supabase = createAdminClient();
  const results: ApplyResult[] = [];
  let firstCreatedEntityId: string | null = null;
  const createdEntityIds: string[] = [];
  const createdTrustDetailIds = new Map<string, string>();
  // Map indexed placeholders (new_entity_0, new_entity_1, ...) to real entity IDs
  const placeholderMap: Record<string, string> = {};
  // Map investment placeholders (new_investment_0, new_investment_1, ...) to real investment IDs
  const investmentPlaceholderMap: Record<string, string> = {};

  const resolveEntityId = (value: unknown): string | null => {
    if (typeof value === "string" && UUID_REGEX.test(value)) return value;
    // Check indexed placeholder (new_entity_0, new_entity_1, ...)
    if (typeof value === "string" && placeholderMap[value]) return placeholderMap[value];
    return firstCreatedEntityId || options.existingEntityId || null;
  };

  const resolveInvestmentId = (value: unknown, fallbackName?: unknown): string | null => {
    if (typeof value === "string" && UUID_REGEX.test(value)) return value;
    if (typeof value === "string" && investmentPlaceholderMap[value]) return investmentPlaceholderMap[value];
    // Try fallback name (e.g., investment_name field)
    if (typeof fallbackName === "string" && investmentPlaceholderMap[fallbackName]) return investmentPlaceholderMap[fallbackName];
    return null;
  };

  for (const item of actions) {
    // Fix non-UUID entity_id placeholders
    if (item.data?.entity_id && !UUID_REGEX.test(item.data.entity_id as string)) {
      item.data.entity_id = resolveEntityId(item.data.entity_id);
    }
    // Fix non-UUID trust_detail_id placeholders (new_entity_N references)
    if (item.data?.trust_detail_id && !UUID_REGEX.test(item.data.trust_detail_id as string)) {
      const resolved = resolveEntityId(item.data.trust_detail_id);
      // trust_detail_id placeholder actually refers to an entity_id — resolve via createdTrustDetailIds
      if (resolved) {
        item.data.trust_detail_id = createdTrustDetailIds.get(resolved) || null;
        if (!item.data.trust_detail_id) {
          // Set entity_id so add_trust_role can look it up
          item.data.entity_id = resolved;
        }
      }
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

          // Track all created entity IDs and indexed placeholders
          placeholderMap[`new_entity_${createdEntityIds.length}`] = data.id;
          placeholderMap["new_entity"] = placeholderMap["new_entity"] || data.id;
          createdEntityIds.push(data.id);
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
          const memberName = item.data.name as string;
          const memberEntityId = item.data.entity_id as string;

          // Resolve directory entry by name + aliases (with punctuation normalization)
          let memberDirId = (item.data.directory_entry_id as string) || null;
          if (!memberDirId) {
            const { data: dirEntries } = await supabase
              .from("directory_entries")
              .select("id, name, aliases")
              .eq("organization_id", options.orgId);
            if (dirEntries) {
              const match = findDirectoryMatch(memberName, dirEntries);
              if (match) memberDirId = match.id;
            }
          }

          const { data, error } = await supabase
            .from("entity_members")
            .insert({
              entity_id: memberEntityId,
              name: memberName,
              directory_entry_id: memberDirId,
            })
            .select()
            .single();
          if (error) throw error;
          results.push({ action: "add_member", success: true, data });

          // Auto-create cap table entry if one doesn't exist for this person
          const { data: capEntries } = await supabase
            .from("cap_table_entries")
            .select("id, investor_name, investor_directory_id")
            .eq("entity_id", memberEntityId);

          const normalizedMember = normalizeName(memberName);
          const existingCap = (capEntries || []).find(
            (c) => normalizeName(c.investor_name || "") === normalizedMember
          );

          if (!existingCap) {
            await supabase
              .from("cap_table_entries")
              .insert({
                entity_id: memberEntityId,
                investor_name: memberName,
                investor_type: "individual",
                ownership_pct: 0,
                capital_contributed: 0,
                investor_directory_id: memberDirId,
              });
          } else if (memberDirId && !existingCap.investor_directory_id) {
            await supabase
              .from("cap_table_entries")
              .update({ investor_directory_id: memberDirId })
              .eq("id", existingCap.id);
          }

          break;
        }

        case "add_manager": {
          const managerName = item.data.name as string;
          const managerEntityId = item.data.entity_id as string;

          // Resolve directory entry by name + aliases
          let managerDirId: string | null = null;
          const { data: mgrDirEntries } = await supabase
            .from("directory_entries")
            .select("id, name, aliases")
            .eq("organization_id", options.orgId);
          if (mgrDirEntries) {
            const match = findDirectoryMatch(managerName, mgrDirEntries);
            if (match) managerDirId = match.id;
          }

          const { data, error } = await supabase
            .from("entity_managers")
            .insert({
              entity_id: managerEntityId,
              name: managerName,
              directory_entry_id: managerDirId,
            })
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

          // Resolve directory entry by name + aliases
          const trustRoleName = item.data.name as string;
          let trustRoleDirId: string | null = null;
          const { data: trDirEntries } = await supabase
            .from("directory_entries")
            .select("id, name, aliases")
            .eq("organization_id", options.orgId);
          if (trDirEntries) {
            const match = findDirectoryMatch(trustRoleName, trDirEntries);
            if (match) trustRoleDirId = match.id;
          }

          const { data, error } = await supabase
            .from("trust_roles")
            .insert({
              trust_detail_id: trustDetailId,
              role: item.data.role,
              name: trustRoleName,
              directory_entry_id: trustRoleDirId,
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
          const capEntityId = item.data.entity_id as string;
          const investorName = item.data.investor_name as string;

          if (item.data.replaces_investor_name) {
            await supabase
              .from("cap_table_entries")
              .delete()
              .eq("entity_id", capEntityId)
              .eq("investor_name", item.data.replaces_investor_name);
          }

          // Resolve directory entry by investor name + aliases (with punctuation normalization)
          let capDirId: string | null = null;
          const { data: capDirEntries } = await supabase
            .from("directory_entries")
            .select("id, name, aliases")
            .eq("organization_id", options.orgId);
          if (capDirEntries) {
            const dirMatch = findDirectoryMatch(investorName, capDirEntries);
            if (dirMatch) capDirId = dirMatch.id;
          }

          // Check for existing investor by normalized name to prevent duplicates
          const { data: allCapForEntity } = await supabase
            .from("cap_table_entries")
            .select("id, investor_name, investor_directory_id")
            .eq("entity_id", capEntityId);

          const normalizedInvestor = normalizeName(investorName);
          const existingInvestor = (allCapForEntity || []).find(
            (c) => normalizeName(c.investor_name || "") === normalizedInvestor
          );

          if (existingInvestor) {
            // Update existing entry instead of creating a duplicate
            const capUpdate: Record<string, unknown> = {
              investor_type: item.data.investor_type || undefined,
              units: item.data.units ?? undefined,
              ownership_pct: item.data.ownership_pct || undefined,
              capital_contributed: item.data.capital_contributed ?? undefined,
            };
            // Link to directory if not already linked
            if (capDirId && !existingInvestor.investor_directory_id) {
              capUpdate.investor_directory_id = capDirId;
            }
            const { data, error } = await supabase
              .from("cap_table_entries")
              .update(capUpdate)
              .eq("id", existingInvestor.id)
              .select()
              .single();
            if (error) throw error;
            results.push({ action: "update_cap_table", success: true, data });
          } else {
            const { data, error } = await supabase
              .from("cap_table_entries")
              .insert({
                entity_id: capEntityId,
                investor_name: investorName,
                investor_type: item.data.investor_type || "other",
                units: item.data.units ?? null,
                ownership_pct: item.data.ownership_pct || 0,
                capital_contributed: item.data.capital_contributed ?? 0,
                investor_directory_id: capDirId,
              })
              .select()
              .single();
            if (error) throw error;
            results.push({ action: "update_cap_table", success: true, data });
          }

          // Auto-create member if one doesn't exist for this investor
          const { data: allMembers } = await supabase
            .from("entity_members")
            .select("id, name, directory_entry_id")
            .eq("entity_id", capEntityId);

          const existingMember = (allMembers || []).find(
            (m) => normalizeName(m.name) === normalizedInvestor
          );

          if (!existingMember) {
            await supabase
              .from("entity_members")
              .insert({
                entity_id: capEntityId,
                name: investorName,
                directory_entry_id: capDirId,
              });
          } else if (capDirId && !existingMember.directory_entry_id) {
            // Link existing member to directory if not already linked
            await supabase
              .from("entity_members")
              .update({ directory_entry_id: capDirId })
              .eq("id", existingMember.id);
          }

          break;
        }

        case "create_directory_entry": {
          // Skip if a directory entry with this name already exists in this org (checking aliases too)
          const dirEntryName = item.data.name as string;
          const { data: allDirEntries } = await supabase
            .from("directory_entries")
            .select("id, name, aliases")
            .eq("organization_id", options.orgId);

          const existing = allDirEntries ? findDirectoryMatch(dirEntryName, allDirEntries) : null;

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
          const repName = item.data.name as string;

          // Resolve directory entry by name + aliases
          let repDirId: string | null = null;
          const { data: repDirEntries } = await supabase
            .from("directory_entries")
            .select("id, name, aliases")
            .eq("organization_id", options.orgId);
          if (repDirEntries) {
            const match = findDirectoryMatch(repName, repDirEntries);
            if (match) repDirId = match.id;
          }

          const { data, error } = await supabase
            .from("entity_partnership_reps")
            .upsert(
              {
                entity_id: item.data.entity_id,
                name: repName,
                directory_entry_id: repDirId,
              },
              { onConflict: "entity_id,name" }
            )
            .select()
            .single();
          if (error) throw error;
          results.push({ action: "add_partnership_rep", success: true, data });
          break;
        }

        case "add_role": {
          const roleName = item.data.name as string;

          // Resolve directory entry by name + aliases
          let roleDirId: string | null = null;
          const { data: roleDirEntries } = await supabase
            .from("directory_entries")
            .select("id, name, aliases")
            .eq("organization_id", options.orgId);
          if (roleDirEntries) {
            const match = findDirectoryMatch(roleName, roleDirEntries);
            if (match) roleDirId = match.id;
          }

          const { data, error } = await supabase
            .from("entity_roles")
            .insert({
              entity_id: item.data.entity_id,
              role_title: item.data.role_title,
              name: roleName,
              directory_entry_id: roleDirId,
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

        case "create_investment": {
          const invName = item.data.name as string;
          if (!invName) throw new Error("Investment name is required");

          // Create the investment (deal metadata only — no parent_entity_id, no capital/profit)
          const { data: newInvestment, error: invErr } = await supabase
            .from("investments")
            .insert({
              organization_id: options.orgId,
              name: invName,
              short_name: (item.data.short_name as string) || null,
              investment_type: (item.data.investment_type as string) || "other",
              status: "active",
              description: (item.data.description as string) || null,
              formation_state: (item.data.formation_state as string) || null,
              preferred_return_pct: item.data.preferred_return_pct != null ? Number(item.data.preferred_return_pct) : null,
              preferred_return_basis: (item.data.preferred_return_basis as string) || null,
            })
            .select()
            .single();

          if (invErr) throw invErr;

          // Create investor row if parent_entity_id is provided
          const invParentEntityId = resolveEntityId(item.data.parent_entity_id);
          if (invParentEntityId) {
            await supabase.from("investment_investors").insert({
              organization_id: options.orgId,
              investment_id: newInvestment.id,
              entity_id: invParentEntityId,
              capital_pct: item.data.ownership_pct != null ? Number(item.data.ownership_pct) : (item.data.capital_pct != null ? Number(item.data.capital_pct) : null),
              profit_pct: item.data.profit_pct != null ? Number(item.data.profit_pct) : null,
              committed_capital: item.data.committed_capital != null ? Number(item.data.committed_capital) : null,
              is_active: true,
            });
          }

          // Store placeholder mapping (e.g., new_investment_0 → real UUID)
          const invPlaceholder = `new_investment_${Object.keys(investmentPlaceholderMap).length}`;
          investmentPlaceholderMap[invPlaceholder] = newInvestment.id;
          // Also map any placeholder that was used in the original action data
          if (typeof item.data.investment_id === "string" && !UUID_REGEX.test(item.data.investment_id)) {
            investmentPlaceholderMap[item.data.investment_id] = newInvestment.id;
          }
          // Map by investment name so link_document_to_investment can resolve by name
          if (invName) {
            investmentPlaceholderMap[invName] = newInvestment.id;
          }

          results.push({
            action: "create_investment",
            success: true,
            data: { investment_id: newInvestment.id, name: invName },
          });
          break;
        }

        case "link_document_to_investment": {
          const linkInvestmentId = resolveInvestmentId(item.data.investment_id, item.data.investment_name);
          if (!linkInvestmentId) throw new Error("Could not resolve investment_id");

          // Get first investor's entity_id to also set entity_id on the document
          const { data: linkInvestor } = await supabase
            .from("investment_investors")
            .select("entity_id")
            .eq("investment_id", linkInvestmentId)
            .eq("is_active", true)
            .limit(1)
            .maybeSingle();

          // Determine which document to link — check action data first, then fall back to options
          let linkDocId = item.data.document_id as string | null;
          if (!linkDocId && item.data.queue_item_id) {
            const { data: qItem } = await supabase.from("document_queue").select("document_id").eq("id", item.data.queue_item_id as string).maybeSingle();
            linkDocId = qItem?.document_id || null;
          }
          if (!linkDocId) linkDocId = options.documentId || null;

          if (linkDocId) {
            await supabase
              .from("documents")
              .update({
                investment_id: linkInvestmentId,
                entity_id: linkInvestor?.entity_id || undefined,
              })
              .eq("id", linkDocId);
          }

          results.push({
            action: "link_document_to_investment",
            success: true,
            data: { investment_id: linkInvestmentId, document_id: linkDocId },
          });
          break;
        }

        case "set_investment_allocations": {
          const allocInvestmentId = resolveInvestmentId(item.data.investment_id, item.data.investment_name);
          if (!allocInvestmentId) throw new Error("Could not resolve investment_id for allocations");

          // Look up the investment_investor_id
          let allocInvestorId = item.data.investment_investor_id as string | null;
          if (!allocInvestorId) {
            const parentEntityId = resolveEntityId(item.data.parent_entity_id);
            let investorQuery = supabase
              .from("investment_investors")
              .select("id")
              .eq("investment_id", allocInvestmentId)
              .eq("is_active", true);
            if (parentEntityId) {
              investorQuery = investorQuery.eq("entity_id", parentEntityId);
            }
            const { data: investorRow } = await investorQuery.limit(1).single();
            allocInvestorId = investorRow?.id || null;
          }

          if (!allocInvestorId) throw new Error("Could not find investor position for allocations");

          const allocations = item.data.allocations as Array<{
            member_name: string;
            allocation_pct: number;
            committed_amount?: number | null;
          }>;
          if (!Array.isArray(allocations) || allocations.length === 0) {
            throw new Error("allocations array is required");
          }

          // Get the investor entity so we can validate members belong to it
          const { data: investorRow } = await supabase
            .from("investment_investors")
            .select("entity_id")
            .eq("id", allocInvestorId)
            .single();
          const investorEntityId = investorRow?.entity_id;

          // Fetch actual members of the investor entity
          const validMemberDirIds = new Set<string>();
          const validMemberEntityIds = new Set<string>();
          if (investorEntityId) {
            const { data: entityMembers } = await supabase
              .from("entity_members")
              .select("directory_entry_id, ref_entity_id")
              .eq("entity_id", investorEntityId);
            for (const m of entityMembers || []) {
              if (m.directory_entry_id) validMemberDirIds.add(m.directory_entry_id);
              if (m.ref_entity_id) validMemberEntityIds.add(m.ref_entity_id);
            }
          }

          // Resolve member names — only allow members that belong to the investor entity
          const { data: dirEntries } = await supabase
            .from("directory_entries")
            .select("id, name, aliases")
            .eq("organization_id", options.orgId);

          const { data: allEntities } = await supabase
            .from("entities")
            .select("id, name, short_name")
            .eq("organization_id", options.orgId);

          const resolvedAllocations: Array<{
            member_directory_id: string | null;
            member_entity_id: string | null;
            allocation_pct: number;
            committed_amount: number | null;
          }> = [];

          for (const alloc of allocations) {
            // Try directory entries first
            const dirMatch = dirEntries ? findDirectoryMatch(alloc.member_name, dirEntries) : null;
            if (dirMatch) {
              // Validate this person is a member of the investor entity
              if (validMemberDirIds.size > 0 && !validMemberDirIds.has(dirMatch.id)) {
                console.warn(`[APPLY] Skipping allocation for "${alloc.member_name}" — not a member of investor entity`);
                continue;
              }
              resolvedAllocations.push({
                member_directory_id: dirMatch.id,
                member_entity_id: null,
                allocation_pct: alloc.allocation_pct,
                committed_amount: alloc.committed_amount ?? null,
              });
              continue;
            }

            // Try entities by name
            const entityMatch = (allEntities || []).find((e: { name: string; short_name: string | null }) =>
              normalizeName(e.name) === normalizeName(alloc.member_name) ||
              (e.short_name && normalizeName(e.short_name) === normalizeName(alloc.member_name)) ||
              normalizeName(e.name).includes(normalizeName(alloc.member_name)) ||
              normalizeName(alloc.member_name).includes(normalizeName(e.name))
            );
            if (entityMatch) {
              // Validate this entity is a member of the investor entity
              if (validMemberEntityIds.size > 0 && !validMemberEntityIds.has(entityMatch.id)) {
                console.warn(`[APPLY] Skipping allocation for "${alloc.member_name}" — not a member of investor entity`);
                continue;
              }
              resolvedAllocations.push({
                member_directory_id: null,
                member_entity_id: entityMatch.id,
                allocation_pct: alloc.allocation_pct,
                committed_amount: alloc.committed_amount ?? null,
              });
              continue;
            }

            // Skip unresolvable members
            console.warn(`[APPLY] Could not resolve allocation member: "${alloc.member_name}"`);
          }

          if (resolvedAllocations.length === 0) {
            throw new Error("No allocations could be resolved to members of the investor entity");
          }

          // Deactivate existing allocations for this investor, then insert fresh
          await supabase
            .from("investment_allocations")
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq("investment_investor_id", allocInvestorId)
            .eq("is_active", true);

          for (const alloc of resolvedAllocations) {
            const insertData: Record<string, unknown> = {
              organization_id: options.orgId,
              investment_investor_id: allocInvestorId,
              allocation_pct: alloc.allocation_pct,
              committed_amount: alloc.committed_amount,
              is_active: true,
            };
            if (alloc.member_directory_id) insertData.member_directory_id = alloc.member_directory_id;
            if (alloc.member_entity_id) insertData.member_entity_id = alloc.member_entity_id;
            await supabase.from("investment_allocations").insert(insertData);
          }

          results.push({
            action: "set_investment_allocations",
            success: true,
            data: { investment_investor_id: allocInvestorId, count: resolvedAllocations.length },
          });
          break;
        }

        case "record_investment_transaction": {
          const txnInvestmentId = resolveInvestmentId(item.data.investment_id, item.data.investment_name);
          if (!txnInvestmentId) throw new Error("Could not resolve investment_id for transaction");

          // Look up the investment_investor row.
          //
          // Resolution rules:
          //   1. If investment_investor_id was provided directly, use it.
          //   2. If parent_entity_id was provided, it MUST match an existing
          //      investor row (or we auto-create one for that entity). We
          //      never silently fall back to "any other investor" — the
          //      previous fallback caused all transactions to pile onto a
          //      single investor when the model emitted unmatched UUIDs.
          //   3. If neither was provided, fall back to "any active investor"
          //      ONLY when there's exactly one investor on the deal
          //      (unambiguous). With multiple investors, refuse — we can't
          //      guess.
          let txnInvestorId = item.data.investment_investor_id as string | null;
          const txnParentEntityId = resolveEntityId(item.data.parent_entity_id);
          if (!txnInvestorId) {
            if (txnParentEntityId) {
              const { data: exactRow } = await supabase
                .from("investment_investors")
                .select("id")
                .eq("investment_id", txnInvestmentId)
                .eq("entity_id", txnParentEntityId)
                .eq("is_active", true)
                .limit(1)
                .maybeSingle();
              txnInvestorId = exactRow?.id || null;
              // If still null, the auto-create block below handles it.
            } else {
              // No parent_entity_id given — only auto-pick when unambiguous.
              const { data: candidates } = await supabase
                .from("investment_investors")
                .select("id")
                .eq("investment_id", txnInvestmentId)
                .eq("is_active", true);
              if (candidates && candidates.length === 1) {
                txnInvestorId = candidates[0].id;
              } else if (candidates && candidates.length > 1) {
                throw new Error(
                  `Investment has ${candidates.length} active investors but parent_entity_id was not provided. ` +
                  `Specify which investor's transaction this is.`
                );
              }
            }
          }

          // Auto-create investor position if we have an entity but no investor row.
          if (!txnInvestorId && txnParentEntityId) {
            const { data: newInvestor, error: createInvestorErr } = await supabase
              .from("investment_investors")
              .insert({
                organization_id: options.orgId,
                investment_id: txnInvestmentId,
                entity_id: txnParentEntityId,
                is_active: true,
              })
              .select("id")
              .single();
            if (createInvestorErr) {
              // Most common cause: parent_entity_id is a UUID that doesn't
              // exist in the entities table — i.e., the chat model made it
              // up. Fail loudly so we never silently route the transaction.
              throw new Error(
                `Could not create investor position for entity ${txnParentEntityId}: ${createInvestorErr.message}. ` +
                `This usually means the entity UUID doesn't exist — verify the parent_entity_id matches a real entity.`
              );
            }
            txnInvestorId = newInvestor?.id || null;
          }

          if (!txnInvestorId) throw new Error("Could not find or create investor position for transaction");

          const txnType = item.data.transaction_type as string;
          const txnAmount = Number(item.data.amount);
          const txnDate = item.data.transaction_date as string;
          const txnDescription = (item.data.description as string) || null;
          const adjustsTransactionId = (item.data.adjusts_transaction_id as string) || null;
          const adjustmentReason = (item.data.adjustment_reason as string) || null;

          if (!["contribution", "distribution", "return_of_capital"].includes(txnType)) {
            throw new Error(`Invalid transaction_type: ${txnType}`);
          }
          if (!Number.isFinite(txnAmount)) throw new Error("amount is required and must be a number");
          if (!adjustsTransactionId && txnAmount <= 0) throw new Error("amount must be positive on non-adjustment rows");
          if (!txnDate) throw new Error("transaction_date is required");

          // Normalize line_items, then auto-coerce common AI category mistakes
          // (audit_tax_expense ↔ compliance_holdback), then validate via the
          // shared helper so the chat-apply path can never write a row that
          // the HTTP routes would reject. Spec 036.
          const rawLineItems = item.data.line_items;
          const normalizedLineItemsRaw: TransactionLineItemInput[] = Array.isArray(rawLineItems)
            ? (rawLineItems as Array<Record<string, unknown>>)
                .map((li) => ({
                  category: li.category as TransactionLineItemInput["category"],
                  amount: Number(li.amount),
                  description: (li.description as string) ?? null,
                }))
                .filter((li) => Number.isFinite(li.amount) && typeof li.category === "string")
            : [];
          const normalizedLineItems = coerceLineItemCategories(
            txnType as "contribution" | "distribution" | "return_of_capital",
            normalizedLineItemsRaw,
          );

          const lineItemCheck = validateInvestmentTransactionLineItems({
            transaction_type: txnType as "contribution" | "distribution" | "return_of_capital",
            amount: txnAmount,
            line_items: normalizedLineItems,
            adjusts_transaction_id: adjustsTransactionId,
          });
          if (!lineItemCheck.ok) throw new Error(lineItemCheck.error);

          // If this is an adjustment, verify the referenced row exists in the
          // same org and points at the same investor.
          if (adjustsTransactionId) {
            const { data: original } = await supabase
              .from("investment_transactions")
              .select("id, organization_id, investment_investor_id")
              .eq("id", adjustsTransactionId)
              .maybeSingle();
            if (!original) throw new Error("adjusts_transaction_id does not reference an existing transaction");
            if (original.organization_id !== options.orgId) throw new Error("adjustment must belong to the same organization");
            if (original.investment_investor_id !== txnInvestorId) {
              throw new Error("adjustment must reference the same investor position as the original");
            }
          }

          // Resolve document_id with the same fallback chain that
          // link_document_to_investment uses: prefer the action's own
          // data.document_id (set by chat-apply-actions enrichment for
          // multi-PDF batches), then look it up via queue_item_id, then
          // fall back to the batch-level options.documentId. This ensures
          // each transaction is linked to ITS specific source document, not
          // just whichever one happened to be first in the batch.
          let txnDocId = (item.data.document_id as string) || null;
          if (!txnDocId && item.data.queue_item_id) {
            const { data: qItem } = await supabase
              .from("document_queue")
              .select("document_id")
              .eq("id", item.data.queue_item_id as string)
              .maybeSingle();
            txnDocId = qItem?.document_id || null;
          }
          if (!txnDocId) txnDocId = options.documentId || null;

          // Single insert. The line_items live in a JSONB column on the
          // parent row — no child rows, no parent_transaction_id involved.
          // Spec 036 supersedes the previously-shipped child-row pattern.
          const { data: parentTxn, error: parentTxnErr } = await supabase
            .from("investment_transactions")
            .insert({
              organization_id: options.orgId,
              investment_id: txnInvestmentId,
              investment_investor_id: txnInvestorId,
              member_directory_id: null,
              transaction_type: txnType,
              amount: txnAmount,
              transaction_date: txnDate,
              description: txnDescription,
              document_id: txnDocId,
              parent_transaction_id: null,
              line_items: normalizedLineItems,
              adjusts_transaction_id: adjustsTransactionId,
              adjustment_reason: adjustmentReason,
            })
            .select()
            .single();

          if (parentTxnErr) throw parentTxnErr;

          results.push({
            action: "record_investment_transaction",
            success: true,
            data: { transaction_id: parentTxn.id, type: txnType, amount: txnAmount, line_item_count: normalizedLineItems.length },
          });
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

  // Invalidate org-context caches if anything succeeded. This is the central
  // choke point for all chat-pipeline-driven mutations — every action that
  // touches entities, investments, transactions, directory entries, or
  // anything else in the cached context blob runs through here. Without this,
  // the next extraction or chat call sees a stale snapshot of org state from
  // up to 24 hours ago, which causes "matching worked then suddenly didn't"
  // bugs that are extremely hard to diagnose.
  if (options.orgId && results.some((r) => r.success)) {
    await invalidateOrgCaches(options.orgId);
  }

  return { results, firstCreatedEntityId, createdEntityIds };
}
