import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError, validateEntityOrg } from "@/lib/utils/org-context";

/**
 * Endpoints for managing joint_title_members — the persons composing a
 * joint_title entity.
 *
 * [id] is the joint_title entity's id.
 */

const OWNERSHIP_FORMS = ["jtwros", "tbe", "tic", "community_property", "other"] as const;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await requireOrg();
  if (isError(ctx)) return ctx;
  const { orgId } = ctx;

  const ok = await validateEntityOrg(id, orgId);
  if (!ok) return NextResponse.json({ error: "Joint title not found" }, { status: 404 });

  const supabase = createAdminClient();
  const { data: members, error } = await supabase
    .from("joint_title_members")
    .select("joint_title_id, person_entity_id, ownership_form, note")
    .eq("joint_title_id", id);

  if (error) {
    console.error("GET joint-title-members error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const personIds = (members || []).map(m => m.person_entity_id);
  let nameMap = new Map<string, string>();
  if (personIds.length > 0) {
    const { data: persons } = await supabase
      .from("entities")
      .select("id, name")
      .in("id", personIds)
      .eq("organization_id", orgId);
    nameMap = new Map((persons || []).map(p => [p.id, p.name]));
  }

  return NextResponse.json((members || []).map(m => ({
    ...m,
    person_name: nameMap.get(m.person_entity_id) || "(Unknown)",
  })));
}

/**
 * POST: add a person to the joint title.
 * Body: { person_entity_id, ownership_form, note? }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await requireOrg();
  if (isError(ctx)) return ctx;
  const { orgId } = ctx;

  const ok = await validateEntityOrg(id, orgId);
  if (!ok) return NextResponse.json({ error: "Joint title not found" }, { status: 404 });

  const body = await request.json();
  const { person_entity_id, ownership_form, note } = body;

  if (!person_entity_id || !ownership_form) {
    return NextResponse.json({ error: "person_entity_id and ownership_form are required" }, { status: 400 });
  }
  if (!OWNERSHIP_FORMS.includes(ownership_form)) {
    return NextResponse.json({ error: "Invalid ownership_form" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // The joint_title entity must be of type joint_title and the member must be a person.
  const { data: rows } = await supabase
    .from("entities")
    .select("id, type")
    .in("id", [id, person_entity_id])
    .eq("organization_id", orgId);

  const jtEntity = rows?.find(r => r.id === id);
  const person = rows?.find(r => r.id === person_entity_id);
  if (!jtEntity || jtEntity.type !== "joint_title") {
    return NextResponse.json({ error: "Entity is not a joint_title" }, { status: 400 });
  }
  if (!person || person.type !== "person") {
    return NextResponse.json({ error: "Member must be a person entity" }, { status: 400 });
  }

  const { error } = await supabase.from("joint_title_members").insert({
    joint_title_id: id,
    person_entity_id,
    ownership_form,
    note: note || null,
  });

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Person is already a member of this joint title" }, { status: 409 });
    }
    console.error("POST joint-title-members error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ success: true }, { status: 201 });
}

/**
 * DELETE: remove a person from the joint title.
 * Body: { person_entity_id }
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await requireOrg();
  if (isError(ctx)) return ctx;
  const { orgId } = ctx;

  const ok = await validateEntityOrg(id, orgId);
  if (!ok) return NextResponse.json({ error: "Joint title not found" }, { status: 404 });

  const body = await request.json();
  const { person_entity_id } = body;
  if (!person_entity_id) {
    return NextResponse.json({ error: "person_entity_id is required" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("joint_title_members")
    .delete()
    .eq("joint_title_id", id)
    .eq("person_entity_id", person_entity_id);

  if (error) {
    console.error("DELETE joint-title-members error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
