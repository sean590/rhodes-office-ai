/**
 * Multi-entity document associations (migration 023 `document_entity_links`).
 *
 * A document has ONE primary/home entity (`documents.entity_id`) plus any number
 * of ADDITIONAL entity associations via the `document_entity_links` junction
 * (role 'related' etc.). Every entity's Documents list reads through the
 * junction, so a linked document surfaces on each associated entity.
 *
 * Ingestion already writes junction links (AI-detected related entities); this
 * service is the manual/agent path — add or remove an additional association
 * without moving the home entity. Used by both the API route and the chat apply
 * pipeline (org scoping is explicit, safe on the admin client), mirroring
 * notes.ts / investment-transfers.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAuditEvent } from "@/lib/utils/audit";

export interface DocumentEntityLinkRow {
  entity_id: string;
  entity_name: string;
  role: string;
  is_primary: boolean;
}

/**
 * Add an additional entity association to a document (does NOT move the home
 * entity). Idempotent. Refuses to duplicate the primary home as a junction row.
 */
export async function addDocumentEntityLink(
  db: SupabaseClient,
  orgId: string,
  userId: string | null,
  input: { documentId: string; entityId: string; role?: string },
): Promise<{ ok: boolean; error?: string; alreadyPrimary?: boolean }> {
  const { documentId, entityId } = input;
  if (!documentId) return { ok: false, error: "document_id is required" };
  if (!entityId) return { ok: false, error: "entity_id is required" };

  const { data: doc } = await db
    .from("documents")
    .select("id, entity_id, name")
    .eq("id", documentId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!doc) return { ok: false, error: "Document not found" };

  const { data: entity } = await db
    .from("entities")
    .select("id, name")
    .eq("id", entityId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!entity) return { ok: false, error: "Entity not found" };

  // The home entity already "holds" the doc via documents.entity_id — no need
  // for a redundant junction row.
  if (doc.entity_id === entityId) {
    return { ok: true, alreadyPrimary: true };
  }

  const role = input.role?.trim() || "related";
  const { error } = await db
    .from("document_entity_links")
    .upsert(
      {
        document_id: documentId,
        entity_id: entityId,
        organization_id: orgId,
        role,
        source: "manual",
        created_by: userId,
      },
      { onConflict: "document_id,entity_id" },
    );
  if (error) return { ok: false, error: error.message };

  await logAuditEvent({
    userId,
    action: "link",
    resourceType: "document",
    resourceId: documentId,
    entityId,
    organizationId: orgId,
    metadata: {
      document_name: doc.name,
      entity_id: entityId,
      entity_name: entity.name,
      role,
      link_type: "additional",
    },
  }).catch(() => {});

  return { ok: true };
}

/**
 * Remove an additional entity association. Refuses to remove the document's
 * primary home entity (that's a reassign/detach, not an association removal).
 */
export async function removeDocumentEntityLink(
  db: SupabaseClient,
  orgId: string,
  userId: string | null,
  input: { documentId: string; entityId: string },
): Promise<{ ok: boolean; error?: string }> {
  const { documentId, entityId } = input;
  if (!documentId) return { ok: false, error: "document_id is required" };
  if (!entityId) return { ok: false, error: "entity_id is required" };

  const { data: doc } = await db
    .from("documents")
    .select("id, entity_id, name")
    .eq("id", documentId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!doc) return { ok: false, error: "Document not found" };

  if (doc.entity_id === entityId) {
    return {
      ok: false,
      error:
        "That entity is the document's home (primary) entity — reassign it with link_document_to_entity or detach it with unlink_document instead of removing the association.",
    };
  }

  const { error } = await db
    .from("document_entity_links")
    .delete()
    .eq("document_id", documentId)
    .eq("entity_id", entityId)
    .eq("organization_id", orgId);
  if (error) return { ok: false, error: error.message };

  await logAuditEvent({
    userId,
    action: "unlink",
    resourceType: "document",
    resourceId: documentId,
    entityId,
    organizationId: orgId,
    metadata: { document_name: doc.name, entity_id: entityId, link_type: "additional" },
  }).catch(() => {});

  return { ok: true };
}

/**
 * All entities a document is associated with — the primary home plus every
 * junction link — with names, primary first. Powers the UI's link editor.
 */
export async function listDocumentEntityLinks(
  db: SupabaseClient,
  orgId: string,
  documentId: string,
): Promise<DocumentEntityLinkRow[]> {
  const { data: doc } = await db
    .from("documents")
    .select("id, entity_id")
    .eq("id", documentId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!doc) return [];

  const { data: links } = await db
    .from("document_entity_links")
    .select("entity_id, role")
    .eq("document_id", documentId)
    .eq("organization_id", orgId);

  // Collect every associated entity id: the primary home + junction rows.
  const roleById = new Map<string, string>();
  for (const l of (links ?? []) as Array<{ entity_id: string; role: string }>) {
    roleById.set(l.entity_id, l.role);
  }
  const ids = new Set<string>(roleById.keys());
  if (doc.entity_id) ids.add(doc.entity_id);
  if (ids.size === 0) return [];

  const { data: entities } = await db
    .from("entities")
    .select("id, name")
    .eq("organization_id", orgId)
    .in("id", Array.from(ids));
  const nameById = new Map<string, string>((entities ?? []).map((e) => [e.id as string, e.name as string]));

  const rows: DocumentEntityLinkRow[] = [];
  for (const id of ids) {
    rows.push({
      entity_id: id,
      entity_name: nameById.get(id) ?? "Unknown",
      role: id === doc.entity_id ? "primary" : roleById.get(id) ?? "related",
      is_primary: id === doc.entity_id,
    });
  }
  // Primary first, then alphabetical.
  rows.sort((a, b) => (a.is_primary === b.is_primary ? a.entity_name.localeCompare(b.entity_name) : a.is_primary ? -1 : 1));
  return rows;
}
