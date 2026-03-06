import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createHash } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateDocumentFilename, getExtension, getCategoryForDocType } from "@/lib/utils/document-naming";
import { requireOrg, isError, validateEntityOrg } from "@/lib/utils/org-context";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import type { DocumentType } from "@/lib/types/enums";
import { validateUploadedFile } from "@/lib/validations";
import type { DocumentCategory } from "@/lib/types/entities";

export async function GET(
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

    const supabase = await createClient();

    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10), 500);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);

    const { data, error } = await supabase
      .from("documents")
      .select("id, name, document_type, document_category, year, file_path, file_size, mime_type, ai_extracted, entity_id, direction, created_at, updated_at")
      .eq("entity_id", id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json(data || [], {
      headers: { "Cache-Control": "private, max-age=30" },
    });
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
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const isValid = await validateEntityOrg(id, orgId);
    if (!isValid) return NextResponse.json({ error: "Entity not found" }, { status: 404 });

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
    const relationshipId = formData.get("relationship_id") as string;

    if (!file) {
      return NextResponse.json({ error: "File is required" }, { status: 400 });
    }

    const fileCheck = validateUploadedFile(file);
    if (!fileCheck.valid) {
      return NextResponse.json({ error: fileCheck.error }, { status: 400 });
    }

    if (!documentCategory) {
      return NextResponse.json({ error: "Document category is required" }, { status: 400 });
    }

    // Get current user from the session-aware client
    const { data: { user: authUser } } = await supabase.auth.getUser();

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
    const { data: entityData } = await admin
      .from("entities")
      .select("short_name")
      .eq("id", id)
      .single();
    const shortName = entityData?.short_name || null;

    // Count existing docs with same params for collision suffix
    const parsedYear = year ? parseInt(year) : null;
    const resolvedCategory = documentCategory || getCategoryForDocType(documentType);

    let collisionQuery = admin
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("entity_id", id)
      .eq("document_type", documentType)
      .eq("document_category", resolvedCategory)
      .is("deleted_at", null);

    if (parsedYear) {
      collisionQuery = collisionQuery.eq("year", parsedYear);
    } else {
      collisionQuery = collisionQuery.is("year", null);
    }

    const { count } = await collisionQuery;
    const collisionCount = count || 0;

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

    // Upload file to Supabase Storage using admin client to bypass RLS
    let filePath = `${id}/${canonicalName}`;

    let uploadError = (await admin.storage
      .from("documents")
      .upload(filePath, arrayBuffer, {
        contentType: file.type,
        upsert: false,
      })).error;

    // If filename already exists in storage, retry with timestamp suffix
    if (uploadError?.message?.includes("already exists")) {
      const fallbackName = `${canonicalName.replace(extension, '')}_${Date.now()}${extension}`;
      filePath = `${id}/${fallbackName}`;
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

    // Create document record using admin client
    const { data: doc, error: dbError } = await admin
      .from("documents")
      .insert({
        entity_id: id,
        name,
        document_type: documentType,
        document_category: documentCategory,
        year: parsedYear,
        file_path: filePath,
        file_size: file.size,
        mime_type: file.type,
        uploaded_by: authUser?.id || null,
        notes: notes || null,
        content_hash: contentHash,
      })
      .select()
      .single();

    if (dbError) {
      // Clean up uploaded file if DB insert fails
      await admin.storage.from("documents").remove([filePath]);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
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

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "upload",
      resourceType: "document",
      resourceId: id,
      metadata: { document_name: name, document_id: doc.id, document_type: documentType },
      ...reqCtx,
    });

    return NextResponse.json(doc, { status: 201 });
  } catch (err) {
    console.error("POST /api/entities/[id]/documents error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
