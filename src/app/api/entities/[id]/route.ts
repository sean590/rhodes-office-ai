import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Fetch the entity
    const { data: entity, error: entityError } = await supabase
      .from("entities")
      .select("*")
      .eq("id", id)
      .single();

    if (entityError) {
      if (entityError.code === "PGRST116") {
        return NextResponse.json({ error: "Entity not found" }, { status: 404 });
      }
      return NextResponse.json({ error: entityError.message }, { status: 500 });
    }

    // Fetch all related data in parallel
    const [
      registrationsRes,
      managersRes,
      membersRes,
      customFieldDefsRes,
      customFieldValsRes,
      trustDetailsRes,
      relsFromEntityRes,
      relsToEntityRes,
      capTableRes,
      partnershipRepsRes,
      entityRolesRes,
    ] = await Promise.all([
      supabase
        .from("entity_registrations")
        .select("*")
        .eq("entity_id", id),
      supabase
        .from("entity_managers")
        .select("*")
        .eq("entity_id", id),
      supabase
        .from("entity_members")
        .select("*")
        .eq("entity_id", id),
      // Custom field definitions: entity-specific OR global
      supabase
        .from("custom_field_definitions")
        .select("*")
        .or(`entity_id.eq.${id},is_global.eq.true`)
        .order("sort_order"),
      supabase
        .from("custom_field_values")
        .select("*")
        .eq("entity_id", id),
      // Trust details (if entity is a trust)
      supabase
        .from("trust_details")
        .select("*")
        .eq("entity_id", id)
        .maybeSingle(),
      // Relationships where this entity is the "from" side
      supabase
        .from("relationships")
        .select("*")
        .eq("from_entity_id", id),
      // Relationships where this entity is the "to" side
      supabase
        .from("relationships")
        .select("*")
        .eq("to_entity_id", id),
      // Cap table entries
      supabase
        .from("cap_table_entries")
        .select("*")
        .eq("entity_id", id),
      // Partnership representatives
      supabase
        .from("entity_partnership_reps")
        .select("*")
        .eq("entity_id", id),
      // Entity roles (VP, Controller, etc.)
      supabase
        .from("entity_roles")
        .select("*")
        .eq("entity_id", id),
    ]);

    // Check for errors
    if (registrationsRes.error) {
      return NextResponse.json({ error: registrationsRes.error.message }, { status: 500 });
    }
    if (managersRes.error) {
      return NextResponse.json({ error: managersRes.error.message }, { status: 500 });
    }
    if (membersRes.error) {
      return NextResponse.json({ error: membersRes.error.message }, { status: 500 });
    }
    if (customFieldDefsRes.error) {
      return NextResponse.json({ error: customFieldDefsRes.error.message }, { status: 500 });
    }
    if (customFieldValsRes.error) {
      return NextResponse.json({ error: customFieldValsRes.error.message }, { status: 500 });
    }
    if (trustDetailsRes.error) {
      return NextResponse.json({ error: trustDetailsRes.error.message }, { status: 500 });
    }
    if (relsFromEntityRes.error) {
      return NextResponse.json({ error: relsFromEntityRes.error.message }, { status: 500 });
    }
    if (relsToEntityRes.error) {
      return NextResponse.json({ error: relsToEntityRes.error.message }, { status: 500 });
    }
    if (capTableRes.error) {
      return NextResponse.json({ error: capTableRes.error.message }, { status: 500 });
    }
    if (partnershipRepsRes.error) {
      return NextResponse.json({ error: partnershipRepsRes.error.message }, { status: 500 });
    }
    if (entityRolesRes.error) {
      return NextResponse.json({ error: entityRolesRes.error.message }, { status: 500 });
    }

    // Merge custom field definitions with their values
    const fieldValues = customFieldValsRes.data || [];
    const customFields = (customFieldDefsRes.data || []).map((def) => ({
      ...def,
      value: fieldValues.find((v) => v.field_def_id === def.id) || null,
    }));

    // Trust roles (only if trust_details exist)
    let trustRoles: unknown[] = [];
    if (trustDetailsRes.data) {
      const { data: roles, error: rolesError } = await supabase
        .from("trust_roles")
        .select("*")
        .eq("trust_detail_id", trustDetailsRes.data.id);

      if (rolesError) {
        return NextResponse.json({ error: rolesError.message }, { status: 500 });
      }
      trustRoles = roles || [];
    }

    // Combine relationships from both directions, deduplicating by id
    const allRelationships = [
      ...(relsFromEntityRes.data || []),
      ...(relsToEntityRes.data || []),
    ];
    const uniqueRels = Array.from(
      new Map(allRelationships.map((r) => [r.id, r])).values()
    );

    // Resolve party names for relationships
    // Collect entity IDs and directory IDs that need name resolution
    const entityIdsToResolve = new Set<string>();
    const directoryIdsToResolve = new Set<string>();

    for (const rel of uniqueRels) {
      if (rel.from_entity_id && rel.from_entity_id !== id) {
        entityIdsToResolve.add(rel.from_entity_id);
      }
      if (rel.to_entity_id && rel.to_entity_id !== id) {
        entityIdsToResolve.add(rel.to_entity_id);
      }
      if (rel.from_directory_id) {
        directoryIdsToResolve.add(rel.from_directory_id);
      }
      if (rel.to_directory_id) {
        directoryIdsToResolve.add(rel.to_directory_id);
      }
    }

    // Fetch names for referenced entities and directory entries
    const entityNamesMap = new Map<string, string>();
    const directoryNamesMap = new Map<string, string>();

    // Current entity name is already known
    entityNamesMap.set(id, entity.name);

    if (entityIdsToResolve.size > 0) {
      const { data: refEntities } = await supabase
        .from("entities")
        .select("id, name")
        .in("id", Array.from(entityIdsToResolve));

      if (refEntities) {
        for (const e of refEntities) {
          entityNamesMap.set(e.id, e.name);
        }
      }
    }

    if (directoryIdsToResolve.size > 0) {
      const { data: refDirectory } = await supabase
        .from("directory_entries")
        .select("id, name")
        .in("id", Array.from(directoryIdsToResolve));

      if (refDirectory) {
        for (const d of refDirectory) {
          directoryNamesMap.set(d.id, d.name);
        }
      }
    }

    // Enrich relationships with resolved names
    const enrichedRelationships = uniqueRels.map((rel) => {
      let fromName = "Unknown";
      let toName = "Unknown";

      if (rel.from_entity_id) {
        fromName = entityNamesMap.get(rel.from_entity_id) || "Unknown Entity";
      } else if (rel.from_directory_id) {
        fromName = directoryNamesMap.get(rel.from_directory_id) || "Unknown Contact";
      }

      if (rel.to_entity_id) {
        toName = entityNamesMap.get(rel.to_entity_id) || "Unknown Entity";
      } else if (rel.to_directory_id) {
        toName = directoryNamesMap.get(rel.to_directory_id) || "Unknown Contact";
      }

      return {
        ...rel,
        from_name: fromName,
        to_name: toName,
      };
    });

    // Resolve investor names on cap table entries
    const capEntries = capTableRes.data || [];
    const capInvestorEntityIds = new Set<string>();
    const capInvestorDirIds = new Set<string>();

    for (const entry of capEntries) {
      if (entry.investor_entity_id) capInvestorEntityIds.add(entry.investor_entity_id);
      if (entry.investor_directory_id) capInvestorDirIds.add(entry.investor_directory_id);
    }

    const capEntityNamesMap = new Map<string, string>();
    const capDirNamesMap = new Map<string, string>();

    if (capInvestorEntityIds.size > 0) {
      const { data: invEntities } = await supabase
        .from("entities")
        .select("id, name")
        .in("id", Array.from(capInvestorEntityIds));

      if (invEntities) {
        for (const e of invEntities) {
          capEntityNamesMap.set(e.id, e.name);
        }
      }
    }

    if (capInvestorDirIds.size > 0) {
      const { data: invDir } = await supabase
        .from("directory_entries")
        .select("id, name")
        .in("id", Array.from(capInvestorDirIds));

      if (invDir) {
        for (const d of invDir) {
          capDirNamesMap.set(d.id, d.name);
        }
      }
    }

    const enrichedCapTable = capEntries.map((entry) => {
      let resolvedInvestorName = entry.investor_name;
      if (!resolvedInvestorName) {
        if (entry.investor_entity_id) {
          resolvedInvestorName = capEntityNamesMap.get(entry.investor_entity_id) || null;
        } else if (entry.investor_directory_id) {
          resolvedInvestorName = capDirNamesMap.get(entry.investor_directory_id) || null;
        }
      }
      return {
        ...entry,
        investor_name: resolvedInvestorName,
      };
    });

    const result = {
      ...entity,
      registrations: registrationsRes.data || [],
      managers: managersRes.data || [],
      members: membersRes.data || [],
      custom_fields: customFields,
      trust_details: trustDetailsRes.data || null,
      trust_roles: trustRoles,
      relationships: enrichedRelationships,
      cap_table: enrichedCapTable,
      partnership_reps: partnershipRepsRes.data || [],
      roles: entityRolesRes.data || [],
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("GET /api/entities/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createAdminClient();
    const body = await request.json();

    // Only allow updating known entity fields
    const allowedFields = [
      "name",
      "type",
      "status",
      "ein",
      "formation_state",
      "formed_date",
      "address",
      "registered_agent",
      "parent_entity_id",
      "notes",
      "business_purpose",
    ];

    const updates: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (field in body) {
        updates[field] = body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    updates.updated_at = new Date().toISOString();

    const { data: entity, error } = await supabase
      .from("entities")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return NextResponse.json({ error: "Entity not found" }, { status: 404 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(entity);
  } catch (err) {
    console.error("PUT /api/entities/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const admin = createAdminClient();

    // Check entity exists
    const { data: entity, error: fetchError } = await admin
      .from("entities")
      .select("id, name")
      .eq("id", id)
      .single();

    if (fetchError || !entity) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }

    // Soft delete — set status to deleted
    const { error } = await admin
      .from("entities")
      .update({ status: "deleted", updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, deleted: entity.name });
  } catch (err) {
    console.error("DELETE /api/entities/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
