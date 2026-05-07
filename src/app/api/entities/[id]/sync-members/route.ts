import { NextResponse } from "next/server";
import { requireOrg, isError, validateEntityOrg } from "@/lib/utils/org-context";
import { syncEntityMembers } from "@/lib/utils/sync-members";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;

    const isValid = await validateEntityOrg(id, orgId);
    if (!isValid) return NextResponse.json({ error: "Entity not found" }, { status: 404 });

    const counts = await syncEntityMembers(id, orgId);

    return NextResponse.json({ success: true, ...counts });
  } catch (err) {
    console.error("POST /api/entities/[id]/sync-members error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
