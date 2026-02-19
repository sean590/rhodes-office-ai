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

    const { data, error } = await supabase
      .from("entity_registrations")
      .select("*")
      .eq("entity_id", id)
      .order("jurisdiction");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("GET /api/entities/[id]/registrations error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createAdminClient();
    const body = await request.json();

    const { jurisdiction } = body;

    if (!jurisdiction) {
      return NextResponse.json(
        { error: "jurisdiction is required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("entity_registrations")
      .insert({
        entity_id: id,
        jurisdiction,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "Registration already exists for this jurisdiction" },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("POST /api/entities/[id]/registrations error:", err);
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

    const { registration_id, last_filing_date, qualification_date, state_id, filing_exempt } = body;

    if (!registration_id) {
      return NextResponse.json(
        { error: "registration_id is required" },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = {};
    if (last_filing_date !== undefined) updates.last_filing_date = last_filing_date || null;
    if (qualification_date !== undefined) updates.qualification_date = qualification_date || null;
    if (state_id !== undefined) updates.state_id = state_id || null;
    if (filing_exempt !== undefined) updates.filing_exempt = !!filing_exempt;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("entity_registrations")
      .update(updates)
      .eq("id", registration_id)
      .eq("entity_id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("PUT /api/entities/[id]/registrations error:", err);
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

    const { registration_id } = body;

    if (!registration_id) {
      return NextResponse.json(
        { error: "registration_id is required" },
        { status: 400 }
      );
    }

    // Verify the registration belongs to this entity
    const { error } = await supabase
      .from("entity_registrations")
      .delete()
      .eq("id", registration_id)
      .eq("entity_id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/entities/[id]/registrations error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
