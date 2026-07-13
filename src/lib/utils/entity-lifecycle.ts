/**
 * Entity status lifecycle cascade functions.
 *
 * When an entity is dissolved/inactivated, pending compliance obligations are
 * exempted and unsatisfied document expectations are marked not applicable.
 * When reactivated, compliance and expectations are regenerated from rules.
 *
 * These functions are called from:
 * - PUT /api/entities/[id]/status (UI status change)
 * - apply.ts update_entity case (MCP write tools)
 */

/**
 * Deactivate compliance tracking for a dissolved/inactive entity.
 * Completed obligations and satisfied expectations are preserved as
 * historical records.
 */
export async function deactivateEntityCompliance(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  entityId: string,
  reason?: string,
): Promise<void> {
  const exemptReason = reason || "Entity dissolved/inactivated";

  // Exempt all pending compliance obligations.
  await admin
    .from("compliance_obligations")
    .update({
      status: "exempt",
      notes: exemptReason,
      updated_at: new Date().toISOString(),
    })
    .eq("entity_id", entityId)
    .in("status", ["pending"]);

  // Mark unsatisfied document expectations as not applicable.
  await admin
    .from("entity_document_expectations")
    .update({
      is_not_applicable: true,
      notes: exemptReason,
      updated_at: new Date().toISOString(),
    })
    .eq("entity_id", entityId)
    .eq("is_satisfied", false)
    .eq("is_not_applicable", false);
}

/**
 * Reactivate compliance tracking for an entity returning to active status.
 * Re-runs the compliance sync and document expectations refresh, which
 * regenerate pending obligations based on current rules.
 */
export async function reactivateEntityCompliance(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _admin: any,
  entityId: string,
  orgId: string,
): Promise<void> {
  try {
    const { syncComplianceForEntity } = await import("./compliance-sync");
    await syncComplianceForEntity(entityId, orgId).catch(console.error);
  } catch { /* non-fatal */ }
  try {
    const { refreshEntityExpectations } = await import("./document-expectations");
    await refreshEntityExpectations(entityId).catch(console.error);
  } catch {
    // Non-fatal — module may not exist in all environments.
  }
}
