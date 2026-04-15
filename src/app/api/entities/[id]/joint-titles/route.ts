import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError } from "@/lib/utils/org-context";

/**
 * GET /api/entities/[id]/joint-titles
 *
 * For a person entity, returns all joint_title entities this person is a
 * member of, with their membership metadata and fellow members.
 *
 * Used by:
 *   - Person detail page Family tab
 *   - Documents/Investments tab union queries (indirectly, via the joint
 *     titles returned here)
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: personId } = await params;
  const ctx = await requireOrg();
  if (isError(ctx)) return ctx;
  const { orgId } = ctx;

  const supabase = createAdminClient();

  // Verify the person belongs to this org.
  const { data: person } = await supabase
    .from("entities")
    .select("id, type")
    .eq("id", personId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!person) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Joint titles this person belongs to.
  const { data: memberships, error: mErr } = await supabase
    .from("joint_title_members")
    .select("joint_title_id, ownership_form, note")
    .eq("person_entity_id", personId);

  if (mErr) {
    console.error("Error loading joint title memberships:", mErr);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  if (!memberships || memberships.length === 0) {
    return NextResponse.json([]);
  }

  const jointTitleIds = memberships.map(m => m.joint_title_id);

  // Joint title entity names.
  const { data: jtEntities } = await supabase
    .from("entities")
    .select("id, name")
    .in("id", jointTitleIds)
    .eq("organization_id", orgId);
  const jtNameMap = new Map((jtEntities || []).map(e => [e.id, e.name]));

  // All members of those joint titles (for surfacing fellow members).
  const { data: allMembers } = await supabase
    .from("joint_title_members")
    .select("joint_title_id, person_entity_id")
    .in("joint_title_id", jointTitleIds);

  const memberIds = Array.from(new Set((allMembers || []).map(m => m.person_entity_id)));
  const { data: memberEntities } = await supabase
    .from("entities")
    .select("id, name")
    .in("id", memberIds)
    .eq("organization_id", orgId);
  const memberNameMap = new Map((memberEntities || []).map(e => [e.id, e.name]));

  const result = memberships.map(m => ({
    joint_title_id: m.joint_title_id,
    joint_title_name: jtNameMap.get(m.joint_title_id) || "(Unknown)",
    ownership_form: m.ownership_form,
    note: m.note,
    members: (allMembers || [])
      .filter(am => am.joint_title_id === m.joint_title_id)
      .map(am => ({
        person_entity_id: am.person_entity_id,
        person_name: memberNameMap.get(am.person_entity_id) || "(Unknown)",
      })),
  }));

  return NextResponse.json(result);
}
