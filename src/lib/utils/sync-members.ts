/**
 * Shared member/cap-table reconciliation.
 *
 * Called from:
 *   - POST /api/entities/[id]/sync-members (UI button)
 *   - sync_entity_members MCP tool
 *
 * Does five passes:
 *   1. Create directory entries for any person named in members or cap table
 *      that isn't already in the directory (fuzzy alias-aware match).
 *   2. Link unlinked entity_members rows to directory entries.
 *   3. Link unlinked cap_table_entries rows to directory entries.
 *   4. Insert missing cap_table_entries for members not yet represented.
 *   5. Insert missing entity_members for cap table investors not yet represented.
 *
 * Returns counts so callers can surface what actually changed.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { findDirectoryMatch, normalizeName } from "@/lib/utils/name-matching";

export interface SyncMembersResult {
  created_directory_entries: number;
  linked_members_to_directory: number;
  linked_cap_to_directory: number;
  created_members_from_cap: number;
  created_cap_from_members: number;
}

export async function syncEntityMembers(
  entityId: string,
  orgId: string,
): Promise<SyncMembersResult> {
  const supabase = createAdminClient();

  const [membersRes, capRes, directoryRes] = await Promise.all([
    supabase.from("entity_members").select("id, name, directory_entry_id").eq("entity_id", entityId),
    supabase.from("cap_table_entries").select("id, investor_name, investor_directory_id").eq("entity_id", entityId),
    supabase
      .from("directory_entries")
      .select("id, name, aliases")
      .eq("organization_id", orgId)
      .is("deleted_at", null),
  ]);

  const members = membersRes.data || [];
  const capEntries = capRes.data || [];
  const directory = directoryRes.data || [];

  let linkedMembers = 0;
  let linkedCap = 0;
  let createdMembers = 0;
  let createdCap = 0;
  let createdDirectory = 0;

  // Collect unique names from members + cap table.
  const allNames = new Set<string>();
  for (const m of members) allNames.add(m.name.trim());
  for (const c of capEntries) {
    if (c.investor_name) allNames.add(c.investor_name.trim());
  }

  // 1. Create directory entries for unmatched names.
  for (const name of allNames) {
    const match = findDirectoryMatch(name, directory);
    if (!match) {
      const { data: created } = await supabase
        .from("directory_entries")
        .insert({ name, type: "individual", organization_id: orgId })
        .select("id, name, aliases")
        .single();
      if (created) {
        directory.push(created);
        createdDirectory++;
      }
    }
  }

  // 2. Link unlinked members to directory entries.
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

  // 3. Link unlinked cap table entries to directory entries.
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

  // 4. Missing cap table entries for members.
  const capNormSet = new Set(capEntries.map((c) => normalizeName(c.investor_name || "")));
  for (const m of members) {
    const key = normalizeName(m.name);
    if (!capNormSet.has(key)) {
      await supabase.from("cap_table_entries").insert({
        entity_id: entityId,
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

  // 5. Missing members for cap table investors.
  const memberNormSet = new Set(members.map((m) => normalizeName(m.name)));
  for (const c of capEntries) {
    const key = normalizeName(c.investor_name || "");
    if (key && !memberNormSet.has(key)) {
      await supabase.from("entity_members").insert({
        entity_id: entityId,
        name: c.investor_name,
        directory_entry_id: c.investor_directory_id,
      });
      memberNormSet.add(key);
      createdMembers++;
    }
  }

  return {
    created_directory_entries: createdDirectory,
    linked_members_to_directory: linkedMembers,
    linked_cap_to_directory: linkedCap,
    created_members_from_cap: createdMembers,
    created_cap_from_members: createdCap,
  };
}
