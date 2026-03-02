import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/utils/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { z } from "zod";

const createOrgSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = createOrgSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { name } = parsed.data;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

  const admin = createAdminClient();

  // Create org
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({
      name,
      slug: `${slug}-${Date.now().toString(36)}`,
      billing_email: user.email,
      created_by: user.id,
    })
    .select()
    .single();

  if (orgError) {
    return NextResponse.json({ error: "Failed to create organization" }, { status: 500 });
  }

  // Create owner membership
  await admin.from("organization_members").insert({
    organization_id: org.id,
    user_id: user.id,
    role: "owner",
  });

  // Set as active org
  await admin
    .from("user_profiles")
    .update({ active_organization_id: org.id })
    .eq("id", user.id);

  const { ipAddress, userAgent } = getRequestContext(request.headers);
  await logAuditEvent({
    userId: user.id,
    action: "organization.created",
    resourceType: "organization",
    resourceId: org.id,
    metadata: { name },
    ipAddress,
    userAgent,
  });

  return NextResponse.json(org, { status: 201 });
}
