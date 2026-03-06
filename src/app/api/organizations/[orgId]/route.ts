import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/utils/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { z } from "zod";

const updateOrgSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  billing_email: z.string().email().optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { orgId } = await params;

  if (user.orgId !== orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  const { data: org, error } = await admin
    .from("organizations")
    .select("*")
    .eq("id", orgId)
    .single();

  if (error || !org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  return NextResponse.json(org);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { orgId } = await params;

  // Only owner can update org
  if (user.orgId !== orgId || user.orgRole !== "owner") {
    return NextResponse.json({ error: "Only the organization owner can update settings" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = updateOrgSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: org, error } = await admin
    .from("organizations")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", orgId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to update organization" }, { status: 500 });
  }

  const { ipAddress, userAgent } = getRequestContext(request.headers);
  await logAuditEvent({
    userId: user.id,
    action: "organization.updated",
    resourceType: "organization",
    resourceId: orgId,
    metadata: parsed.data,
    ipAddress,
    userAgent,
  });

  return NextResponse.json(org);
}
