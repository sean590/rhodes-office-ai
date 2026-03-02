import { createAdminClient } from "@/lib/supabase/admin";
import type { DocumentTypeRecord } from "@/lib/types/entities";

// In-memory cache for document types (server-side)
let cachedTypes: DocumentTypeRecord[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch all active document types from the database.
 * Uses an in-memory cache with 5-minute TTL.
 */
export async function getDocumentTypes(): Promise<DocumentTypeRecord[]> {
  const now = Date.now();
  if (cachedTypes && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedTypes;
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("document_types")
    .select("*")
    .eq("is_active", true)
    .order("category")
    .order("label");

  if (error) {
    console.error("Failed to fetch document types:", error);
    return cachedTypes || [];
  }

  cachedTypes = data as DocumentTypeRecord[];
  cacheTimestamp = now;
  return cachedTypes;
}

/**
 * Clear the document types cache (e.g., after AI creates a new type).
 */
export function invalidateDocumentTypeCache(): void {
  cachedTypes = null;
  cacheTimestamp = 0;
}

/**
 * Get the display label for a document type slug.
 */
export async function getTypeLabel(slug: string): Promise<string> {
  const types = await getDocumentTypes();
  const found = types.find((t) => t.slug === slug);
  return found?.label || slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Get the category for a document type slug.
 */
export async function getCategoryForSlug(slug: string): Promise<string> {
  const types = await getDocumentTypes();
  const found = types.find((t) => t.slug === slug);
  return found?.category || "other";
}

/**
 * Build a slug → label map for use in prompts/dropdowns.
 */
export async function getTypeLabelMap(): Promise<Record<string, string>> {
  const types = await getDocumentTypes();
  const map: Record<string, string> = {};
  for (const t of types) {
    map[t.slug] = t.label;
  }
  return map;
}

/**
 * Build a category → types[] map for grouping.
 */
export async function getTypesByCategory(): Promise<Record<string, DocumentTypeRecord[]>> {
  const types = await getDocumentTypes();
  const map: Record<string, DocumentTypeRecord[]> = {};
  for (const t of types) {
    if (!map[t.category]) map[t.category] = [];
    map[t.category].push(t);
  }
  return map;
}
