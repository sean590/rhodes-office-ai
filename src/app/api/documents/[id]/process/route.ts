import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateDocumentFilename, generateDisplayName, getExtension, getCategoryForDocType } from "@/lib/utils/document-naming";
import { getDbContext, extractDocument } from "@/lib/pipeline/extract";
import { rateLimit } from "@/lib/utils/rate-limit";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { headers } from "next/headers";
import * as Sentry from "@sentry/nextjs";
import type { DocumentCategory } from "@/lib/types/entities";

export const maxDuration = 180;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const { id } = await params;
    const admin = createAdminClient();

    if (!(await rateLimit(`process:${user.id}`, 10, 60000))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    // Get document record
    const { data: doc, error: docError } = await admin
      .from("documents")
      .select("*")
      .eq("id", id)
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .single();

    if (docError || !doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Download the file from storage using admin client
    const { data: fileData, error: downloadError } = await admin.storage
      .from("documents")
      .download(doc.file_path);

    if (downloadError || !fileData) {
      return NextResponse.json({ error: "Failed to download file" }, { status: 500 });
    }

    // Get DB context and run extraction via shared function
    const dbContext = await getDbContext(admin);
    const result = await extractDocument(
      fileData,
      doc.mime_type,
      doc.name,
      doc.document_type,
      doc.year,
      dbContext,
      { notes: doc.notes || undefined }
    );

    // Auto-associate document with identified entity if it doesn't have one
    const docUpdate: Record<string, unknown> = {
      ai_extracted: true,
      ai_extraction: { actions: result.actions, identified_entity_id: result.entity_id, summary: result.summary },
      ai_extracted_at: new Date().toISOString(),
    };
    if (!doc.entity_id && result.entity_id) {
      docUpdate.entity_id = result.entity_id;
    }
    if (result.document_type && (doc.document_type === 'other' || !doc.document_type)) {
      docUpdate.document_type = result.document_type;
    }
    if (result.document_category) {
      docUpdate.document_category = result.document_category;
    }
    if (result.year && !doc.year) {
      docUpdate.year = result.year;
    }
    if (result.direction) {
      docUpdate.direction = result.direction;
    }

    // Rename file in storage to match updated metadata
    const finalEntityId = (docUpdate.entity_id as string) || doc.entity_id;
    const finalDocType = ((docUpdate.document_type as string) || doc.document_type);
    const finalCategory = ((docUpdate.document_category as string) || doc.document_category) as DocumentCategory | null;
    const finalYear = (docUpdate.year as number) || doc.year;

    let shortName: string | null = null;
    let entityName: string | null = null;
    if (finalEntityId) {
      const { data: ent } = await admin
        .from("entities")
        .select("name, short_name")
        .eq("id", finalEntityId)
        .single();
      shortName = ent?.short_name || null;
      entityName = ent?.name || null;
    }

    const resolvedCategory = finalCategory || getCategoryForDocType(finalDocType);
    let collisionQuery = admin
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("document_type", finalDocType)
      .eq("document_category", resolvedCategory)
      .is("deleted_at", null)
      .neq("id", id);

    if (finalEntityId) {
      collisionQuery = collisionQuery.eq("entity_id", finalEntityId);
    } else {
      collisionQuery = collisionQuery.is("entity_id", null);
    }

    if (finalYear) {
      collisionQuery = collisionQuery.eq("year", finalYear);
    } else {
      collisionQuery = collisionQuery.is("year", null);
    }

    const { count } = await collisionQuery;
    const collisionCount = count || 0;

    const extension = getExtension(doc.mime_type, doc.name || "file");
    const canonicalName = generateDocumentFilename(
      shortName,
      resolvedCategory,
      finalDocType,
      finalYear,
      extension,
      collisionCount
    );

    if (result.suggested_name) {
      docUpdate.name = result.suggested_name;
    } else {
      const displayName = generateDisplayName(entityName, finalDocType, finalYear);
      if (displayName) {
        docUpdate.name = displayName;
      }
    }

    const folder = finalEntityId || "unassociated";
    const newFilePath = `${folder}/${canonicalName}`;

    if (newFilePath !== doc.file_path) {
      let finalPath = newFilePath;
      const { error: moveError } = await admin.storage
        .from("documents")
        .move(doc.file_path, finalPath);

      if (moveError) {
        if (moveError.message?.includes("already exists")) {
          const fallbackPath = `${folder}/${canonicalName.replace(extension, '')}_${Date.now()}${extension}`;
          const { error: retryError } = await admin.storage
            .from("documents")
            .move(doc.file_path, fallbackPath);
          if (!retryError) {
            finalPath = fallbackPath;
            docUpdate.file_path = finalPath;
          }
        } else {
          console.error("Failed to rename file in storage:", moveError);
        }
      } else {
        docUpdate.file_path = finalPath;
      }
    }

    const { error: updateError } = await admin
      .from("documents")
      .update(docUpdate)
      .eq("id", id);

    if (updateError) {
      console.error("Failed to save AI extraction:", updateError);
    }

    // Audit log
    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders);
    await logAuditEvent({
      userId: user.id,
      action: "process",
      resourceType: "document",
      resourceId: id,
      metadata: { action_count: result.actions?.length ?? 0 },
      ...reqCtx,
    });

    return NextResponse.json({
      status: "processed",
      actions: result.actions,
      entity_id: result.entity_id,
      summary: result.summary,
      document_type: result.document_type,
      document_category: result.document_category,
      year: result.year,
    });
  } catch (err) {
    Sentry.withScope((scope) => {
      scope.setTag("feature", "extraction");
      scope.setExtra("route", "documents/[id]/process");
      Sentry.captureException(err);
    });
    console.error("POST /api/documents/[id]/process error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
