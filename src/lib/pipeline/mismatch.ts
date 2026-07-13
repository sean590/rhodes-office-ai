/**
 * Mismatch Detection and Handling
 * When tier 1 triage detects a conflict between user context and document content,
 * this module pauses the document and generates a question for the user.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { Tier1Result } from "./triage";

export interface MismatchedDocument {
  queue_item_id: string;
  filename: string;
  triageResult: Tier1Result;
  userExpectedEntity?: string;
  documentDetectedEntity?: string;
  question: string;
}

/**
 * Check a batch of triage results for mismatches between user context and AI detection.
 * Returns matched items (proceed to tier 2) and mismatched items (need user input).
 */
export function detectMismatches(
  triageResults: Array<{ id: string; filename: string; result: Tier1Result }>,
): { matched: typeof triageResults; mismatched: MismatchedDocument[] } {
  const matched: typeof triageResults = [];
  const mismatched: MismatchedDocument[] = [];

  for (const item of triageResults) {
    if (item.result.mismatch_flag) {
      mismatched.push({
        queue_item_id: item.id,
        filename: item.filename,
        triageResult: item.result,
        userExpectedEntity: undefined, // Will be set from user context
        documentDetectedEntity: item.result.entity_match.name,
        question: item.result.mismatch_reason || generateMismatchQuestion(item.filename, item.result),
      });
    } else if (!item.result.entity_match.id) {
      // No entity matched — needs user input regardless of confidence
      const investmentMatch = item.result.investment_match;
      const question = investmentMatch?.id
        ? `I found "${item.filename}" and it looks related to ${investmentMatch.name}. Which of your entities made this investment?`
        : `I couldn't match "${item.filename}" to any of your entities or investments. Which entity does this document belong to?`;
      mismatched.push({
        queue_item_id: item.id,
        filename: item.filename,
        triageResult: item.result,
        question,
      });
    } else {
      matched.push(item);
    }
  }

  return { matched, mismatched };
}

function generateMismatchQuestion(filename: string, result: Tier1Result): string {
  if (result.entity_match.id) {
    return `"${filename}" appears to be for ${result.entity_match.name}, not the entity you specified. Should I file it under ${result.entity_match.name} instead?`;
  }
  return `I'm not sure which entity "${filename}" belongs to. Can you help me identify it?`;
}

/**
 * Mark mismatched documents as waiting for user input.
 */
export async function pauseMismatchedDocuments(
  mismatched: MismatchedDocument[]
): Promise<void> {
  if (mismatched.length === 0) return;

  const admin = createAdminClient();

  for (const doc of mismatched) {
    await admin.from("document_queue").update({
      processing_step: "waiting_user",
      processing_progress: 25,
      status: "review_ready",
      approval_reason: "mismatch",
      ai_summary: doc.question,
      updated_at: new Date().toISOString(),
    }).eq("id", doc.queue_item_id);
  }
}

/**
 * Build a conversational message summarizing batch triage results with mismatches.
 */
export function buildTriageSummary(
  matched: Array<{ filename: string; result: Tier1Result }>,
  mismatched: MismatchedDocument[],
): string {
  const lines: string[] = [];

  // Group matched by entity
  const byEntity = new Map<string, string[]>();
  for (const item of matched) {
    const entityName = item.result.entity_match.name || "Unassigned";
    const existing = byEntity.get(entityName) || [];
    existing.push(item.filename);
    byEntity.set(entityName, existing);
  }

  if (matched.length > 0) {
    lines.push(`Sorted ${matched.length + mismatched.length} documents:`);
    lines.push("");
    for (const [entityName, files] of byEntity) {
      const types = new Set(matched
        .filter(m => m.result.entity_match.name === entityName)
        .map(m => m.result.document_type?.replace(/_/g, " "))
        .filter(Boolean)
      );
      const typeStr = types.size > 0 ? ` (${[...types].join(", ")})` : "";
      lines.push(`✓ ${files.length} → ${entityName}${typeStr}`);
    }
  }

  if (mismatched.length > 0) {
    lines.push("");
    lines.push(`⚠ ${mismatched.length} need${mismatched.length === 1 ? "s" : ""} your help:`);
    for (const doc of mismatched) {
      lines.push(`  • ${doc.filename} — ${doc.question}`);
    }
  }

  if (matched.length > 0) {
    lines.push("");
    lines.push(`Processing ${matched.length} matched documents now...`);
  }

  return lines.join("\n");
}

/**
 * Resume processing for a mismatched document after user provides the correct entity.
 */
export async function resolveMismatch(
  queueItemId: string,
  correctedEntityId: string,
): Promise<void> {
  const admin = createAdminClient();

  await admin.from("document_queue").update({
    staged_entity_id: correctedEntityId,
    staging_confidence: "user",
    processing_step: "extracting",
    processing_progress: 40,
    status: "queued",
    approval_reason: null,
    updated_at: new Date().toISOString(),
  }).eq("id", queueItemId);
}
