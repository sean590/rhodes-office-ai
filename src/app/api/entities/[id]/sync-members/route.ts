import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError, validateEntityOrg } from "@/lib/utils/org-context";
import { findDirectoryMatch, normalizeName } from "@/lib/utils/name-matching";

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

    const supabase = createAdminClient();

    // Fetch current members, cap table entries, and directory (with aliases)
    const [membersRes, capRes, directoryRes] = await Promise.all([
      supabase.from("entity_members").select("id, name, directory_entry_id").eq("entity_id", id),
      supabase.from("cap_table_entries").select("id, investor_name, investor_directory_id").eq("entity_id", id),
      supabase.from("directory_entries").select("id, name, aliases").eq("organization_id", orgId),
    ]);

    const members = membersRes.data || [];
    const capEntries = capRes.data || [];
    const directory = directoryRes.data || [];

    let linkedMembers = 0;
    let linkedCap = 0;
    let createdMembers = 0;
    let createdCap = 0;
    let createdDirectory = 0;

    // Collect all unique person names from members + cap table
    const allNames = new Set<string>();
    for (const m of members) {
      allNames.add(m.name.trim());
    }
    for (const c of capEntries) {
      if (c.investor_name) allNames.add(c.investor_name.trim());
    }

    // 1. Create directory entries for people not in the directory
    //    (matching against name + aliases with normalization)
    for (const name of allNames) {
      const match = findDirectoryMatch(name, directory);
      if (!match) {
        const { data: created } = await supabase
          .from("directory_entries")
          .insert({
            name,
            type: "individual",
            organization_id: orgId,
          })
          .select("id, name, aliases")
          .single();
        if (created) {
          directory.push(created);
          createdDirectory++;
        }
      }
    }

    // 2. Link members to directory entries (using fuzzy name + alias matching)
    for (const m of members) {
      if (!m.directory_entry_id) {
        const match = findDirectoryMatch(m.name, directory);
        if (match) {
          await supabase
            .from("entity_members")
            .update({ directory_entry_id: match.id })
            .eq("id", m.id);
          m.directory_entry_id = match.id;
          linkedMembers++;
        }
      }
    }

    // 3. Link cap table entries to directory entries (using fuzzy name + alias matching)
    for (const c of capEntries) {
      if (!c.investor_directory_id && c.investor_name) {
        const match = findDirectoryMatch(c.investor_name, directory);
        if (match) {
          await supabase
            .from("cap_table_entries")
            .update({ investor_directory_id: match.id })
            .eq("id", c.id);
          c.investor_directory_id = match.id;
          linkedCap++;
        }
      }
    }

    // 4. Create missing cap table entries for members not in cap table
    //    (using normalized matching to avoid near-duplicates)
    const capNormSet = new Set(
      capEntries.map((c) => normalizeName(c.investor_name || ""))
    );
    for (const m of members) {
      const key = normalizeName(m.name);
      if (!capNormSet.has(key)) {
        await supabase.from("cap_table_entries").insert({
          entity_id: id,
          investor_name: m.name,
          investor_type: "individual",
          ownership_pct: 0,
          capital_contributed: 0,
          investor_directory_id: m.directory_entry_id,
        });
        capNormSet.add(key);
        createdCap++;
      }
    }

    // 5. Create missing members for cap table entries not in members
    const memberNormSet = new Set(
      members.map((m) => normalizeName(m.name))
    );
    for (const c of capEntries) {
      const key = normalizeName(c.investor_name || "");
      if (key && !memberNormSet.has(key)) {
        await supabase.from("entity_members").insert({
          entity_id: id,
          name: c.investor_name,
          directory_entry_id: c.investor_directory_id,
        });
        memberNormSet.add(key);
        createdMembers++;
      }
    }

    return NextResponse.json({
      success: true,
      created_directory_entries: createdDirectory,
      linked_members_to_directory: linkedMembers,
      linked_cap_to_directory: linkedCap,
      created_members_from_cap: createdMembers,
      created_cap_from_members: createdCap,
    });
  } catch (err) {
    console.error("POST /api/entities/[id]/sync-members error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
