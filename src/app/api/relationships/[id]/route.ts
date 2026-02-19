import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createAdminClient();
    const body = await request.json();

    const updates: Record<string, unknown> = {};

    if (body.type !== undefined) updates.type = body.type;
    if (body.description !== undefined) updates.description = body.description;
    if (body.terms !== undefined) updates.terms = body.terms;
    if (body.from_entity_id !== undefined) updates.from_entity_id = body.from_entity_id || null;
    if (body.from_directory_id !== undefined) updates.from_directory_id = body.from_directory_id || null;
    if (body.to_entity_id !== undefined) updates.to_entity_id = body.to_entity_id || null;
    if (body.to_directory_id !== undefined) updates.to_directory_id = body.to_directory_id || null;
    if (body.frequency !== undefined) updates.frequency = body.frequency;
    if (body.status !== undefined) updates.status = body.status;
    if (body.effective_date !== undefined) updates.effective_date = body.effective_date;
    if (body.end_date !== undefined) updates.end_date = body.end_date;
    if (body.annual_estimate !== undefined) updates.annual_estimate = body.annual_estimate;
    if (body.document_ref !== undefined) updates.document_ref = body.document_ref;
    if (body.notes !== undefined) updates.notes = body.notes;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("relationships")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json(
        { error: "Relationship not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("PUT /api/relationships/[id] error:", err);
    return NextResponse.json(
      { error: "Failed to update relationship" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createAdminClient();

    const { searchParams } = new URL(request.url);
    const hard = searchParams.get("hard") === "true";

    if (hard) {
      // Hard delete
      const { error } = await supabase
        .from("relationships")
        .delete()
        .eq("id", id);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    } else {
      // Soft delete: set status to terminated
      const { error } = await supabase
        .from("relationships")
        .update({ status: "terminated", updated_at: new Date().toISOString() })
        .eq("id", id);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/relationships/[id] error:", err);
    return NextResponse.json(
      { error: "Failed to delete relationship" },
      { status: 500 }
    );
  }
}
