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
import { getOrCreateInboundAddress } from "@/lib/inbound/ses";

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
