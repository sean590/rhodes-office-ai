/**
 * GET /api/inbound/address
 *
 * Returns the calling org's hosted inbound address
 * (`<local_part>@docs.rhodesoffice.ai`), provisioning one on first call. This
 * is the address a family office shares with service providers so their mail
 * lands in Rhodes via the SES pipeline.
 */
import { NextResponse } from "next/server";
import { createOrgClient } from "@/lib/supabase/org-client";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { getOrCreateInboundAddress, rotateInboundAddress } from "@/lib/inbound/ses";

export async function GET() {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;
    // System/provisioning write on an org-owned table; the service explicitly
    // scopes by organization_id.
    const db = createOrgClient(orgId).raw;
    const address = await getOrCreateInboundAddress(db, orgId, user.id);
    return NextResponse.json({ address });
  } catch (err) {
    console.error("GET /api/inbound/address error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/inbound/address  { action: "rotate" }
 *
 * Rotate the org's hosted address — mint a new token and deactivate the old
 * one (which stops resolving immediately). Use if the address may have leaked.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;
    const body = await request.json().catch(() => ({}));
    if (body?.action !== "rotate") {
      return NextResponse.json({ error: "unsupported action" }, { status: 400 });
    }
    const db = createOrgClient(orgId).raw;
    const address = await rotateInboundAddress(db, orgId, user.id);
    const reqCtx = getRequestContext(request.headers, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "rotate",
      resourceType: "inbound_address",
      resourceId: orgId,
      organizationId: orgId,
      metadata: { new_address: address },
      ...reqCtx,
    }).catch(() => {});
    return NextResponse.json({ address });
  } catch (err) {
    console.error("POST /api/inbound/address error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
