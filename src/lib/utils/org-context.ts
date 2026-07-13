import { NextResponse } from "next/server";
import { getCurrentUser, CurrentUser } from "@/lib/utils/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export interface OrgContext {
  user: CurrentUser;
  orgId: string;
}

type OrgResult = OrgContext | NextResponse;

export async function requireOrg(): Promise<OrgResult> {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!user.orgId) {
    return NextResponse.json({ error: "No organization" }, { status: 403 });
  }

  return { user, orgId: user.orgId };
}

export function isError(result: OrgResult): result is NextResponse {
  return result instanceof NextResponse;
}

/**
 * Validate that an entity belongs to the given organization.
 * Used by sub-entity routes (members, managers, registrations, etc.)
 * where the route has an entity [id] param but not an org_id param.
 */
export async function validateEntityOrg(
  entityId: string,
  orgId: string
): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("entities")
    .select("id")
    .eq("id", entityId)
    .eq("organization_id", orgId)
    .maybeSingle();

  return !!data;
}

/**
 * Validate that an investment belongs to the given organization.
 */
export async function validateInvestmentOrg(
  investmentId: string,
  orgId: string
): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("investments")
    .select("id")
    .eq("id", investmentId)
    .eq("organization_id", orgId)
    .maybeSingle();

  return !!data;
}
