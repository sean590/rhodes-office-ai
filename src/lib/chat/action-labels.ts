/**
 * Display labels for write-tool / proposed-action types. Shared by chat's
 * approval card AND /review's review card so both surfaces render the same
 * badge for the same action. Edit one place.
 *
 * If a tool isn't in the map, callers fall back to a humanized version of
 * the raw key (see `getActionLabel`).
 */

export interface ActionLabel {
  label: string;
  color: string;
}

export const ACTION_LABELS: Record<string, ActionLabel> = {
  create_entity: { label: "Create Entity", color: "#2d5a3d" },
  update_entity: { label: "Update Entity", color: "#3366a8" },
  archive_entity: { label: "Archive Entity", color: "#a83333" },
  create_investment: { label: "Create Investment", color: "#2d5a3d" },
  update_investment: { label: "Update Investment", color: "#3366a8" },
  archive_investment: { label: "Archive Investment", color: "#a83333" },
  link_document_to_entity: { label: "Link to Entity", color: "#6b6b76" },
  link_document_to_investment: { label: "Link to Investment", color: "#6b6b76" },
  unlink_document: { label: "Unlink Document", color: "#c47520" },
  archive_document: { label: "Archive Document", color: "#a83333" },
  create_relationship: { label: "Create Relationship", color: "#7b4db5" },
  update_relationship: { label: "Update Relationship", color: "#3366a8" },
  remove_relationship: { label: "Remove Relationship", color: "#a83333" },
  add_entity_member: { label: "Add Member", color: "#2d8a4e" },
  add_member: { label: "Add Member", color: "#2d8a4e" },
  add_entity_manager: { label: "Add Manager", color: "#2d5a3d" },
  add_manager: { label: "Add Manager", color: "#2d5a3d" },
  update_cap_table: { label: "Update Cap Table", color: "#3366a8" },
  set_cap_table_entries: { label: "Set Cap Table", color: "#3366a8" },
  create_directory_entry: { label: "Create Directory Entry", color: "#2d8a4e" },
  update_directory_entry: { label: "Update Directory Entry", color: "#3366a8" },
  archive_directory_entry: { label: "Archive Directory Entry", color: "#a83333" },
  add_investment_investor: { label: "Add Investor", color: "#2d8a4e" },
  update_investment_investor: { label: "Update Investor", color: "#3366a8" },
  remove_investment_investor: { label: "Remove Investor", color: "#a83333" },
  add_co_investor: { label: "Add Co-investor", color: "#2d8a4e" },
  update_co_investor: { label: "Update Co-investor", color: "#3366a8" },
  remove_co_investor: { label: "Remove Co-investor", color: "#a83333" },
  set_investment_allocations: { label: "Set Allocations", color: "#3366a8" },
  record_investment_transaction: { label: "Record Transaction", color: "#2d5a3d" },
  update_investment_transaction: { label: "Update Transaction", color: "#3366a8" },
  delete_investment_transaction: { label: "Delete Transaction", color: "#a83333" },
  create_compliance_obligation: { label: "Create Obligation", color: "#2d5a3d" },
  update_compliance_obligation: { label: "Update Obligation", color: "#c47520" },
  mark_obligation_complete: { label: "Complete Obligation", color: "#2d5a3d" },
  update_trust_details: { label: "Update Trust", color: "#3366a8" },
  add_entity_role: { label: "Add Role", color: "#2d8a4e" },
  add_role: { label: "Add Role", color: "#2d8a4e" },
  remove_entity_role: { label: "Remove Role", color: "#a83333" },
  remove_role: { label: "Remove Role", color: "#a83333" },
  add_partnership_rep: { label: "Add Partnership Rep", color: "#2d8a4e" },
  remove_partnership_rep: { label: "Remove Partnership Rep", color: "#a83333" },
  change_entity_status: { label: "Change Status", color: "#c47520" },
  create_registration: { label: "Add Registration", color: "#2d5a3d" },
  add_registration: { label: "Add Registration", color: "#2d5a3d" },
  update_registration: { label: "Update Registration", color: "#3366a8" },
  set_custom_field: { label: "Set Custom Field", color: "#3366a8" },
  add_custom_field: { label: "Add Custom Field", color: "#2d8a4e" },
  remove_custom_field: { label: "Remove Custom Field", color: "#a83333" },
  update_document: { label: "Update Document", color: "#3366a8" },
  add_document_expectation: { label: "Add Requirement", color: "#2d5a3d" },
  dismiss_document_expectation: { label: "Dismiss Requirement", color: "#c47520" },
  dismiss_document_suggestion: { label: "Dismiss Suggestion", color: "#c47520" },
  accept_document_suggestion: { label: "Accept Suggestion", color: "#2d8a4e" },
  sync_entity_compliance: { label: "Sync Compliance", color: "#3366a8" },
  refresh_document_expectations: { label: "Refresh Checklist", color: "#3366a8" },
  sync_entity_members: { label: "Sync Members", color: "#3366a8" },
  upsert_state_id: { label: "Update State ID", color: "#3366a8" },
  create_service_provider: { label: "Create Provider", color: "#2d8a4e" },
  update_service_provider: { label: "Update Provider", color: "#3366a8" },
  delete_service_provider: { label: "Delete Provider", color: "#a83333" },
  link_provider_entity: { label: "Link Provider", color: "#6b6b76" },
  unlink_provider_entity: { label: "Unlink Provider", color: "#c47520" },
  send_document_to_provider: { label: "Send to Provider", color: "#2d5a3d" },
  // Read-tool entries kept here so trace renderers stay consistent — these
  // never go through approval; they execute immediately.
  unlock_document: { label: "Unlock Document", color: "#3366a8" },
};

export function humanizeKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Look up the label/color for an action key, falling back to a humanized
 *  version of the key + neutral grey when the action isn't known. */
export function getActionLabel(key: string): ActionLabel {
  return ACTION_LABELS[key] ?? { label: humanizeKey(key), color: "#6b6b76" };
}
