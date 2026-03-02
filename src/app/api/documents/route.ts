import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateDocumentFilename, getExtension, getCategoryForDocType } from "@/lib/utils/document-naming";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { headers } from "next/headers";
import type { DocumentType } from "@/lib/types/enums";
import type { DocumentCategory } from "@/lib/types/entities";

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

    // Check for ?force=true query param (bypass duplicate check)
    const { searchParams } = new URL(request.url);
    const force = searchParams.get("force") === "true";

    const formData = await request.formData();

    const file = formData.get("file") as File | null;
    const documentType = ((formData.get("document_type") as string) || "other") as DocumentType;
    const documentCategory = formData.get("document_category") as DocumentCategory | null;
    const name = (formData.get("name") as string) || file?.name || "Untitled";
    const year = formData.get("year") as string;
    const notes = formData.get("notes") as string;
    const entityId = formData.get("entity_id") as string | null;

    if (!file) {
      return NextResponse.json({ error: "File is required" }, { status: 400 });
    }

    if (!documentCategory) {
      return NextResponse.json({ error: "Document category is required" }, { status: 400 });
    }

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();

    // Read file buffer and compute SHA-256 hash
    const arrayBuffer = await file.arrayBuffer();
    const contentHash = createHash("sha256").update(Buffer.from(arrayBuffer)).digest("hex");

    // Check for duplicate (unless force=true)
    if (!force) {
      const { data: existing } = await admin
        .from("documents")
        .select("id, name, entity_id, created_at")
        .eq("content_hash", contentHash)
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle();

      if (existing) {
        // Look up entity name for the existing doc
        let existingEntityName: string | null = null;
        if (existing.entity_id) {
          const { data: ent } = await admin
            .from("entities")
            .select("name")
            .eq("id", existing.entity_id)
            .single();
          existingEntityName = ent?.name || null;
        }

        return NextResponse.json(
          {
            warning: "duplicate",
            existing_document: { ...existing, entity_name: existingEntityName },
            message: `This file appears to be a duplicate of "${existing.name}"${existingEntityName ? ` (uploaded for ${existingEntityName})` : ""}.`,
          },
          { status: 409 }
        );
      }
    }

    // Look up entity short_name for canonical filename
    let shortName: string | null = null;
    if (entityId) {
      const { data: ent } = await admin
        .from("entities")
        .select("short_name")
        .eq("id", entityId)
        .single();
      shortName = ent?.short_name || null;
    }

    // Count existing docs with same params for collision suffix
    const parsedYear = year ? parseInt(year) : null;
    const resolvedCategory = documentCategory || getCategoryForDocType(documentType);

    let collisionCount = 0;
    const matchQuery = admin
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("document_type", documentType)
      .eq("document_category", resolvedCategory)
      .is("deleted_at", null);

    if (entityId) matchQuery.eq("entity_id", entityId);
    else matchQuery.is("entity_id", null);

    if (parsedYear) matchQuery.eq("year", parsedYear);
    else matchQuery.is("year", null);

    const { count } = await matchQuery;
    collisionCount = count || 0;

    // Generate canonical filename
    const extension = getExtension(file.type, file.name);
    const canonicalName = generateDocumentFilename(
      shortName,
      resolvedCategory,
      documentType,
      parsedYear,
      extension,
      collisionCount
    );

    // Upload file to Supabase Storage
    const folder = entityId || "unassociated";
    let filePath = `${folder}/${canonicalName}`;

    let uploadError = (await admin.storage
      .from("documents")
      .upload(filePath, arrayBuffer, {
        contentType: file.type,
        upsert: false,
      })).error;

    // If filename already exists in storage, retry with timestamp suffix
    if (uploadError?.message?.includes("already exists")) {
      const fallbackName = `${canonicalName.replace(extension, '')}_${Date.now()}${extension}`;
      filePath = `${folder}/${fallbackName}`;
      uploadError = (await admin.storage
        .from("documents")
        .upload(filePath, arrayBuffer, {
          contentType: file.type,
          upsert: false,
        })).error;
    }

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
        document_category: documentCategory,
        year: parsedYear,
        file_path: filePath,
        file_size: file.size,
        mime_type: file.type,
        uploaded_by: user?.id || null,
        notes: notes || null,
        content_hash: contentHash,
      })
      .select()
      .single();

    if (dbError) {
      await admin.storage.from("documents").remove([filePath]);
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }

    // Audit log
    const reqHeaders = await headers();
    const ctx = getRequestContext(reqHeaders);
    await logAuditEvent({
      userId: user?.id ?? null,
      action: "upload",
      resourceType: "document",
      resourceId: doc.id,
      metadata: { name, entity_id: entityId },
      ...ctx,
    });

    return NextResponse.json(doc, { status: 201 });
  } catch (err) {
    console.error("POST /api/documents error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
