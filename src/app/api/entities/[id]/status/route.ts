/**
 * PUT /api/entities/[id]/status — change entity status with lifecycle cascade.
 *
 * When dissolved/inactivated: exempts pending compliance obligations and marks
 * unsatisfied document expectations as not applicable.
 * When reactivated: regenerates compliance obligations and expectations.
 */

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import {
  deactivateEntityCompliance,
  reactivateEntityCompliance,
} from "@/lib/utils/entity-lifecycle";

const VALID_STATUSES = [
  "active",
  "inactive",
  "dissolved",
  "suspended",
  "pending_formation",
  "converting",
];

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const { id: entityId } = await params;
    const admin = createAdminClient();

    const { data: entity } = await admin
      .from("entities")
      .select("id, name, status")
      .eq("id", entityId)
      .eq("organization_id", orgId)
      .single();
    if (!entity) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const body = await request.json();
    const { status, reason } = body;
    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }

    const oldStatus = entity.status;
    if (status === oldStatus) {
      return NextResponse.json({ ok: true, old_status: oldStatus, new_status: status });
    }

    await admin
      .from("entities")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", entityId);

    const isDeactivating =
      ["dissolved", "inactive"].includes(status) &&
      !["dissolved", "inactive"].includes(oldStatus);
    const isReactivating =
      status === "active" && ["dissolved", "inactive"].includes(oldStatus);

    if (isDeactivating) {
      await deactivateEntityCompliance(admin, entityId, reason);
    }
    if (isReactivating) {
      await reactivateEntityCompliance(admin, entityId, orgId);
    }

    const reqHeaders = await headers();
    await logAuditEvent({
      userId: user.id,
      action: "update",
      resourceType: "entity",
      resourceId: entityId,
      metadata: {
        field: "status",
        old_value: oldStatus,
        new_value: status,
        reason,
      },
      ...getRequestContext(reqHeaders, orgId),
    });

    return NextResponse.json({ ok: true, old_status: oldStatus, new_status: status });
  } catch (err) {
    console.error("PUT /api/entities/[id]/status error:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
