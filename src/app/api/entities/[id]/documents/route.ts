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
      .from("documents")
      .select("*")
      .eq("entity_id", id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data || []);
  } catch (err) {
    console.error("GET /api/entities/[id]/documents error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const admin = createAdminClient();
    const formData = await request.formData();

    const file = formData.get("file") as File | null;
    const documentType = formData.get("document_type") as string;
    const name = (formData.get("name") as string) || file?.name || "Untitled";
    const year = formData.get("year") as string;
    const notes = formData.get("notes") as string;
    const relationshipId = formData.get("relationship_id") as string;

    if (!file) {
      return NextResponse.json({ error: "File is required" }, { status: 400 });
    }

    if (!documentType) {
      return NextResponse.json({ error: "Document type is required" }, { status: 400 });
    }

    // Get current user from the session-aware client
    const { data: { user } } = await supabase.auth.getUser();
    console.log("[doc upload] user:", user?.id || "null");

    // Upload file to Supabase Storage using admin client to bypass RLS
    const filePath = `${id}/${Date.now()}-${file.name}`;
    const arrayBuffer = await file.arrayBuffer();

    const { error: uploadError } = await admin.storage
      .from("documents")
      .upload(filePath, arrayBuffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      return NextResponse.json(
        { error: `Storage upload failed: ${uploadError.message}` },
        { status: 500 }
      );
    }

    // Create document record using admin client
    const { data: doc, error: dbError } = await admin
      .from("documents")
      .insert({
        entity_id: id,
        name,
        document_type: documentType,
        year: year ? parseInt(year) : null,
        file_path: filePath,
        file_size: file.size,
        mime_type: file.type,
        uploaded_by: user?.id || null,
        notes: notes || null,
      })
      .select()
      .single();

    if (dbError) {
      // Clean up uploaded file if DB insert fails
      await admin.storage.from("documents").remove([filePath]);
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }

    // If relationship_id provided, create junction record
    if (relationshipId) {
      const { error: junctionError } = await admin
        .from("relationship_documents")
        .insert({
          relationship_id: relationshipId,
          document_id: doc.id,
        });

      if (junctionError) {
        console.error("Junction insert error:", junctionError);
      }
    }

    return NextResponse.json(doc, { status: 201 });
  } catch (err) {
    console.error("POST /api/entities/[id]/documents error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
