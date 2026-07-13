import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { headers } from "next/headers";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";

/**
 * GET /api/person-relationships?person_id=<uuid>
 *
 * Returns all family relationships involving a given person, symmetrically —
 * i.e. both (from=person, to=*) and (from=*, to=person) edges.
 */
export async function GET(request: Request) {
  const ctx = await requireOrg();
  if (isError(ctx)) return ctx;
  const { orgId } = ctx;

  const url = new URL(request.url);
  const personId = url.searchParams.get("person_id");
  if (!personId) {
    return NextResponse.json({ error: "person_id is required" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Verify the person belongs to this org.
  const { data: person } = await supabase
    .from("entities")
    .select("id, organization_id, type")
    .eq("id", personId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!person) {
    return NextResponse.json({ error: "Person not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("person_relationships")
    .select("id, from_person_id, to_person_id, relationship, notes, created_at")
    .or(`from_person_id.eq.${personId},to_person_id.eq.${personId}`);

  if (error) {
    console.error("GET person-relationships error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json(data || []);
}

/**
 * POST /api/person-relationships
 *
 * Creates a family edge between two person entities. For symmetric edges
 * (spouse_of) this endpoint creates the reverse edge too. For asymmetric
 * edges (parent_of / child_of) it also creates the inverse edge so both
 * sides of the relationship can be queried directly.
 *
 * Body: { from_person_id, to_person_id, relationship: 'spouse_of'|'parent_of'|'child_of', notes? }
 */
export async function POST(request: Request) {
  const ctx = await requireOrg();
  if (isError(ctx)) return ctx;
  const { orgId, user } = ctx;

  try {
    const body = await request.json();
    const { from_person_id, to_person_id, relationship, notes } = body;

    if (!from_person_id || !to_person_id || !relationship) {
      return NextResponse.json(
        { error: "from_person_id, to_person_id, and relationship are required" },
        { status: 400 }
      );
    }
    if (from_person_id === to_person_id) {
      return NextResponse.json({ error: "Cannot relate a person to themselves" }, { status: 400 });
    }
    if (!["spouse_of", "parent_of", "child_of"].includes(relationship)) {
      return NextResponse.json({ error: "Invalid relationship type" }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Both persons must belong to this org and both must be person entities.
    const { data: persons, error: pErr } = await supabase
      .from("entities")
      .select("id, type, organization_id")
      .in("id", [from_person_id, to_person_id])
      .eq("organization_id", orgId);

    if (pErr || !persons || persons.length !== 2) {
      return NextResponse.json({ error: "Both persons must exist in this organization" }, { status: 404 });
    }
    if (persons.some((p) => p.type !== "person")) {
      return NextResponse.json({ error: "Both entities must be of type 'person'" }, { status: 400 });
    }

    // Forward edge.
    const { error: e1 } = await supabase.from("person_relationships").insert({
      from_person_id,
      to_person_id,
      relationship,
      notes: notes || null,
    });
    if (e1 && e1.code !== "23505") {
      console.error("Insert person_relationship error:", e1);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    // Reverse edge. spouse_of is symmetric so both directions use the same
    // relationship label. parent_of <-> child_of are inverses.
    const reverseLabel =
      relationship === "spouse_of" ? "spouse_of" :
      relationship === "parent_of" ? "child_of" :
      "parent_of";
    const { error: e2 } = await supabase.from("person_relationships").insert({
      from_person_id: to_person_id,
      to_person_id: from_person_id,
      relationship: reverseLabel,
      notes: notes || null,
    });
    if (e2 && e2.code !== "23505") {
      console.error("Insert reverse person_relationship error:", e2);
    }

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "create",
      resourceType: "person_relationship",
      resourceId: from_person_id,
      entityId: from_person_id,
      metadata: { from_person_id, to_person_id, relationship },
      ...reqCtx,
    });

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    console.error("POST /api/person-relationships error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/person-relationships
 *
 * Body: { from_person_id, to_person_id, relationship }
 * Removes both the forward and inverse edges.
 */
export async function DELETE(request: Request) {
  const ctx = await requireOrg();
  if (isError(ctx)) return ctx;
  const { orgId, user } = ctx;

  try {
    const body = await request.json();
    const { from_person_id, to_person_id, relationship } = body;
    if (!from_person_id || !to_person_id || !relationship) {
      return NextResponse.json({ error: "from_person_id, to_person_id, and relationship are required" }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Org-scope check — verify both persons belong to this org.
    const { data: persons } = await supabase
      .from("entities")
      .select("id")
      .in("id", [from_person_id, to_person_id])
      .eq("organization_id", orgId);
    if (!persons || persons.length !== 2) {
      return NextResponse.json({ error: "Persons not found" }, { status: 404 });
    }

    const reverseLabel =
      relationship === "spouse_of" ? "spouse_of" :
      relationship === "parent_of" ? "child_of" :
      relationship === "child_of" ? "parent_of" :
      null;
    if (!reverseLabel) {
      return NextResponse.json({ error: "Invalid relationship type" }, { status: 400 });
    }

    await supabase.from("person_relationships").delete()
      .eq("from_person_id", from_person_id).eq("to_person_id", to_person_id).eq("relationship", relationship);
    await supabase.from("person_relationships").delete()
      .eq("from_person_id", to_person_id).eq("to_person_id", from_person_id).eq("relationship", reverseLabel);

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "delete",
      resourceType: "person_relationship",
      resourceId: from_person_id,
      entityId: from_person_id,
      metadata: { from_person_id, to_person_id, relationship },
      ...reqCtx,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/person-relationships error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
