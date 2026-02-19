import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createAdminClient();
    const body = await request.json();

    const { label, field_type, value } = body;

    if (!label || !field_type) {
      return NextResponse.json(
        { error: "label and field_type are required" },
        { status: 400 }
      );
    }

    // Create the custom field definition
    const { data: fieldDef, error: defError } = await supabase
      .from("custom_field_definitions")
      .insert({
        label,
        field_type,
        entity_id: id,
        is_global: false,
      })
      .select()
      .single();

    if (defError) {
      return NextResponse.json({ error: defError.message }, { status: 500 });
    }

    // If an initial value is provided, create the value record
    let fieldValue = null;
    if (value !== undefined && value !== null) {
      const valueRecord = buildValueRecord(field_type, value, id, fieldDef.id);

      const { data: valData, error: valError } = await supabase
        .from("custom_field_values")
        .insert(valueRecord)
        .select()
        .single();

      if (valError) {
        console.error("Failed to create initial field value:", valError.message);
      } else {
        fieldValue = valData;
      }
    }

    return NextResponse.json({ ...fieldDef, value: fieldValue }, { status: 201 });
  } catch (err) {
    console.error("POST /api/entities/[id]/custom-fields error:", err);
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

    const { field_def_id, value } = body;

    if (!field_def_id) {
      return NextResponse.json(
        { error: "field_def_id is required" },
        { status: 400 }
      );
    }

    // Look up the field definition to determine the field_type
    const { data: fieldDef, error: defError } = await supabase
      .from("custom_field_definitions")
      .select("field_type")
      .eq("id", field_def_id)
      .single();

    if (defError) {
      if (defError.code === "PGRST116") {
        return NextResponse.json(
          { error: "Field definition not found" },
          { status: 404 }
        );
      }
      return NextResponse.json({ error: defError.message }, { status: 500 });
    }

    const valueColumns = getValueColumns(fieldDef.field_type, value);

    // Upsert the value (insert if not exists, update if exists)
    const { data, error } = await supabase
      .from("custom_field_values")
      .upsert(
        {
          entity_id: id,
          field_def_id,
          ...valueColumns,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "entity_id,field_def_id",
        }
      )
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("PUT /api/entities/[id]/custom-fields error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createAdminClient();
    const body = await request.json();

    const { field_def_id } = body;

    if (!field_def_id) {
      return NextResponse.json(
        { error: "field_def_id is required" },
        { status: 400 }
      );
    }

    // Delete the field values first (cascade should handle this, but be explicit)
    await supabase
      .from("custom_field_values")
      .delete()
      .eq("field_def_id", field_def_id)
      .eq("entity_id", id);

    // Delete the field definition (only if it belongs to this entity, not global)
    const { error } = await supabase
      .from("custom_field_definitions")
      .delete()
      .eq("id", field_def_id)
      .eq("entity_id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/entities/[id]/custom-fields error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Build the value columns object based on field type.
 * Clears all value columns and sets only the appropriate one.
 */
function getValueColumns(fieldType: string, value: unknown) {
  const columns: Record<string, unknown> = {
    value_text: null,
    value_boolean: null,
    value_date: null,
    value_number: null,
  };

  switch (fieldType) {
    case "text":
    case "url":
    case "dropdown":
      columns.value_text = value != null ? String(value) : null;
      break;
    case "checkbox":
      columns.value_boolean = value != null ? Boolean(value) : null;
      break;
    case "date":
      columns.value_date = value != null ? String(value) : null;
      break;
    case "number":
      columns.value_number = value != null ? Number(value) : null;
      break;
    default:
      columns.value_text = value != null ? String(value) : null;
  }

  return columns;
}

/**
 * Build a full insert record for custom_field_values.
 */
function buildValueRecord(
  fieldType: string,
  value: unknown,
  entityId: string,
  fieldDefId: string
) {
  return {
    entity_id: entityId,
    field_def_id: fieldDefId,
    ...getValueColumns(fieldType, value),
  };
}
