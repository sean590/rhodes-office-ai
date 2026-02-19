import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const admin = createAdminClient();

    // Fetch all documents with entity names
    const { data: docs, error } = await admin
      .from("documents")
      .select("*, entities(name)")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Flatten entity name into each doc
    const result = (docs || []).map((doc) => ({
      ...doc,
      entity_name: (doc.entities as { name: string } | null)?.name || null,
      entities: undefined,
    }));

    return NextResponse.json(result);
  } catch (err) {
    console.error("GET /api/documents error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const admin = createAdminClient();
    const formData = await request.formData();

    const file = formData.get("file") as File | null;
    const documentType = formData.get("document_type") as string;
    const name = (formData.get("name") as string) || file?.name || "Untitled";
    const year = formData.get("year") as string;
    const notes = formData.get("notes") as string;
    const entityId = formData.get("entity_id") as string | null;

    if (!file) {
      return NextResponse.json({ error: "File is required" }, { status: 400 });
    }

    if (!documentType) {
      return NextResponse.json({ error: "Document type is required" }, { status: 400 });
    }

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();

    // Upload file to Supabase Storage
    const folder = entityId || "unassociated";
    const filePath = `${folder}/${Date.now()}-${file.name}`;
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

    // Create document record — entity_id is optional
    const { data: doc, error: dbError } = await admin
      .from("documents")
      .insert({
        entity_id: entityId || null,
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
      await admin.storage.from("documents").remove([filePath]);
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }

    return NextResponse.json(doc, { status: 201 });
  } catch (err) {
    console.error("POST /api/documents error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
