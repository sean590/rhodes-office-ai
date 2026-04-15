/**
 * Tier 1: Fast Triage — lightweight document classification and entity matching.
 * Uses Haiku for speed (~2-3s per call), slim entity roster, first 2-3 pages only.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { extractFullText } from "./pdf-processor";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

// --- Types ---

export interface Tier1Input {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  pageCount?: number;
  userContext?: string;
  pageContext?: {
    entityId?: string;
    entityName?: string;
    investmentId?: string;
    investmentName?: string;
  };
}

export interface Tier1Result {
  entity_match: {
    id: string | null;
    name: string;
    confidence: "high" | "medium" | "low";
    reasoning: string;
  };
  investment_match: {
    id: string | null;
    name: string;
    confidence: "high" | "medium" | "low";
  } | null;
  document_type: string;
  document_category: string;
  year: number | null;
  is_composite: boolean;
  composite_sections: Array<{
    estimated_page_range: [number, number];
    type_hint: string;
  }>;
  mismatch_flag: boolean;
  mismatch_reason: string | null;
}

interface EntityRosterItem {
  id: string;
  name: string;
  type: string;
  ein_last4?: string;
}

interface InvestmentRosterItem {
  id: string;
  name: string;
  type: string;
  investor_entity_names: string[];
}

// --- Concurrency ---

const TIER1_CONCURRENCY = 10;

export async function processWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number
): Promise<T[]> {
  const results: T[] = [];
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const taskIndex = index++;
      results[taskIndex] = await tasks[taskIndex]();
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// --- Roster Builders ---

export async function buildEntityRoster(orgId: string): Promise<EntityRosterItem[]> {
  const admin = createAdminClient();
  const { data: entities } = await admin
    .from("entities")
    .select("id, name, type, ein")
    .eq("organization_id", orgId)
    .order("name");

  return (entities || []).map((e) => ({
    id: e.id,
    name: e.name,
    type: e.type,
    ein_last4: e.ein ? e.ein.slice(-4) : undefined,
  }));
}

export async function buildInvestmentRoster(orgId: string): Promise<InvestmentRosterItem[]> {
  const admin = createAdminClient();
  const { data: investments } = await admin
    .from("investments")
    .select("id, name, investment_type")
    .eq("organization_id", orgId);

  if (!investments || investments.length === 0) return [];

  const investmentIds = investments.map((i) => i.id);
  const { data: investors } = await admin
    .from("investment_investors")
    .select("investment_id, entity_id, entities:entity_id(name)")
    .in("investment_id", investmentIds)
    .eq("is_active", true);

  const investorMap = new Map<string, string[]>();
  for (const inv of investors || []) {
    const entityData = inv.entities as { name: string } | { name: string }[] | null;
    const entityName = Array.isArray(entityData) ? entityData[0]?.name : entityData?.name;
    if (entityName) {
      const existing = investorMap.get(inv.investment_id) || [];
      existing.push(entityName);
      investorMap.set(inv.investment_id, existing);
    }
  }

  return investments.map((i) => ({
    id: i.id,
    name: i.name,
    type: i.investment_type,
    investor_entity_names: investorMap.get(i.id) || [],
  }));
}

// --- Composite Detection (Three-Layer Approach) ---

// Layer 1: User context keyword detection (free, no API call)
const COMPOSITE_KEYWORDS = [
  /tax\s*package/i,
  /bundle/i,
  /combined/i,
  /all\s+the\s+(k-?1|documents|returns)/i,
  /complete\s+set/i,
  /everything\s+from/i,
  /cpa\s+sent/i,
  /package\s+from/i,
  /multiple\s+documents/i,
  /full\s+return/i,
];

export function hasCompositeKeywords(userMessage: string): boolean {
  return COMPOSITE_KEYWORDS.some((pattern) => pattern.test(userMessage));
}

// Layer 2: Structural scan of page headers (fast, no API call)
export interface StructuralScanResult {
  likely_composite: boolean;
  section_breaks: Array<{ page: number; signal: string }>;
  distinct_form_types: string[];
  distinct_eins: string[];
}

export async function scanDocumentStructure(buffer: Buffer): Promise<StructuralScanResult> {
  const { extractText: extractPdfText } = await import("unpdf");

  let pageTexts: string[] = [];
  try {
    const result = await extractPdfText(new Uint8Array(buffer), { mergePages: false });
    pageTexts = Array.isArray(result.text) ? result.text : [result.text as string];
  } catch {
    return { likely_composite: false, section_breaks: [], distinct_form_types: [], distinct_eins: [] };
  }

  const formPatterns = [
    /form\s*1065/i, /form\s*1120/i, /form\s*1041/i,
    /schedule\s*k-?1/i, /form\s*565/i, /form\s*568/i,
    /form\s*1040/i, /form\s*8865/i, /form\s*199/i,
  ];

  const einPattern = /\d{2}-?\d{7}/g;

  const sectionBreaks: Array<{ page: number; signal: string }> = [];
  const formTypes = new Set<string>();
  const eins = new Set<string>();

  for (let pageNum = 0; pageNum < pageTexts.length; pageNum++) {
    // Only look at first 200 chars per page (header area)
    const header = pageTexts[pageNum].slice(0, 200);

    for (const pattern of formPatterns) {
      const match = header.match(pattern);
      if (match) {
        const formType = match[0].toLowerCase().replace(/\s+/g, " ");
        if (formTypes.size > 0 && !formTypes.has(formType)) {
          sectionBreaks.push({ page: pageNum + 1, signal: `New form type: ${formType}` });
        }
        formTypes.add(formType);
      }
    }

    const einMatches = header.match(einPattern) || [];
    for (const ein of einMatches) {
      if (eins.size > 0 && !eins.has(ein)) {
        sectionBreaks.push({ page: pageNum + 1, signal: `New EIN: ${ein}` });
      }
      eins.add(ein);
    }
  }

  return {
    likely_composite: formTypes.size >= 2 || eins.size >= 2 || sectionBreaks.length >= 2,
    section_breaks: sectionBreaks,
    distinct_form_types: Array.from(formTypes),
    distinct_eins: Array.from(eins),
  };
}

// Layer 3: Combined decision (keywords + structural + Claude tier 1)
export function isComposite(
  userKeywords: boolean,
  structuralScan: StructuralScanResult,
  claudeTier1IsComposite: boolean,
  pageCount?: number,
): { composite: boolean; confidence: "confirmed" | "likely" | "uncertain" } {
  const signals = [userKeywords, structuralScan.likely_composite, claudeTier1IsComposite];
  const positiveCount = signals.filter(Boolean).length;

  if (positiveCount >= 2) return { composite: true, confidence: "confirmed" };
  if (positiveCount === 1) return { composite: true, confidence: "likely" };

  // Page count heuristic for uncertain cases
  if (pageCount && pageCount > 80) {
    return { composite: true, confidence: "uncertain" };
  }

  return { composite: false, confidence: "confirmed" };
}

// --- Text Sampling ---

function sampleText(fullText: string, maxChars: number = 3000): string {
  if (fullText.length <= maxChars) return fullText;
  return fullText.slice(0, maxChars) + "\n\n[... truncated for triage — full text available in tier 2]";
}

// --- Tier 1 API Call ---

export async function runTier1(
  input: Tier1Input,
  entityRoster: EntityRosterItem[],
  investmentRoster: InvestmentRosterItem[],
): Promise<Tier1Result> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI not configured — missing ANTHROPIC_API_KEY");

  // Extract text sample (first ~3000 chars)
  let textSample = "";
  if (input.mimeType === "application/pdf") {
    try {
      const fullText = await extractFullText(input.buffer);
      textSample = sampleText(fullText);
    } catch {
      textSample = "(text extraction failed — visual-only document)";
    }
  } else if (input.mimeType?.startsWith("text/")) {
    textSample = sampleText(input.buffer.toString("utf-8"));
  } else {
    textSample = "(non-text document)";
  }

  // Build roster strings
  const entityRosterStr = entityRoster.length > 0
    ? entityRoster.map((e) =>
        `- ${e.name} (id: ${e.id}, type: ${e.type}${e.ein_last4 ? `, EIN: ****${e.ein_last4}` : ""})`
      ).join("\n")
    : "(no entities)";

  const investmentRosterStr = investmentRoster.length > 0
    ? investmentRoster.map((i) =>
        `- ${i.name} (id: ${i.id}, type: ${i.type}, investors: ${i.investor_entity_names.join(", ") || "none"})`
      ).join("\n")
    : "(no investments)";

  // Page context string
  let pageContextStr = "";
  if (input.pageContext?.entityId) {
    pageContextStr = `User is viewing entity: ${input.pageContext.entityName || input.pageContext.entityId}`;
  } else if (input.pageContext?.investmentId) {
    pageContextStr = `User is viewing investment: ${input.pageContext.investmentName || input.pageContext.investmentId}`;
  }

  // Cacheable system prompt (stable across batch — rosters + instructions)
  // NOTE: Entity/investment matching is ADVISORY only. Tier 2 (Sonnet with full context) is the authority.
  // Rosters are included to help with document type classification (e.g., knowing an entity is a trust helps classify trust amendments).
  const cacheablePrompt = `You are a document triage assistant. Your job is to quickly classify a document and provide ADVISORY entity/investment hints. You are NOT the final authority on entity matching — a deeper analysis with full context will handle that. Focus on classification accuracy.

## Entity Roster (for classification context only)
${entityRosterStr}

## Investment Roster (for classification context only)
${investmentRosterStr}

## Your Task

Return JSON only — no markdown, no explanation:
{
  "entity_match": {
    "id": "uuid or null — best guess, advisory only",
    "name": "entity name",
    "confidence": "high" | "medium" | "low",
    "reasoning": "brief explanation"
  },
  "investment_match": {
    "id": "uuid or null — best guess, advisory only",
    "name": "investment name or null",
    "confidence": "high" | "medium" | "low"
  },
  "document_type": "operating_agreement | trust_agreement | series_seed_agreement | investment_agreement | k1 | tax_return_1065 | tax_return_1120s | tax_return_1041 | tax_return_1040 | tax_package | annual_report | distribution_notice | capital_call_notice | ...",
  "document_category": "formation | tax | financial | compliance | contracts | governance | other",
  "year": 2025,
  "is_composite": false,
  "composite_sections": [],
  "mismatch_flag": false,
  "mismatch_reason": null
}

Rules:
- Focus on document_type, document_category, year, and composite detection — these are your PRIMARY outputs
- entity_match and investment_match are best-effort hints — don't overthink them
- If you see multiple distinct form types (1065, K-1, 565, etc.) in the text → is_composite = true
- If you see EIN changes in the text → is_composite = true
- Set mismatch_flag only if user context CLEARLY contradicts the document content
- **document_type MUST be a snake_case slug from the list above, NOT a human-readable label.** Examples of correct/wrong values:
  - ✅ \`series_seed_agreement\` for any equity financing closing package (Series Seed/A/B, SAFE, convertible note, signed stock purchase agreement, investor rights agreement)
  - ❌ "series seed financing agreement" — wrong, this is a human label, not the slug
  - ✅ \`investment_agreement\` for a generic investment closing doc that doesn't fit series_seed_agreement
  - ✅ \`operating_agreement\` for an LLC operating agreement
  - ❌ "Operating Agreement" or "operating agreement" — wrong casing/spacing
  The downstream pipeline matches document_type as an exact key against a strategy table. A non-slug value falls through to the generic strategy and the document is processed less effectively.`;

  // Per-document user message (changes each call)
  const userMessage = `${input.userContext ? `User context: ${input.userContext}\n` : ""}${pageContextStr ? `${pageContextStr}\n` : ""}Filename: ${input.filename}
${input.pageCount ? `Total pages: ${input.pageCount}\n` : ""}
First pages text:
${textSample}

Classify this document and return JSON.`;

  let response;
  try {
    response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: [{ type: "text", text: cacheablePrompt, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userMessage }],
    });
  } catch (err) {
    console.error("Tier 1 triage API error:", err);
    // Return a safe default on failure
    return {
      entity_match: { id: null, name: "", confidence: "low", reasoning: "Triage API call failed" },
      investment_match: null,
      document_type: "other",
      document_category: "other",
      year: null,
      is_composite: false,
      composite_sections: [],
      mismatch_flag: false,
      mismatch_reason: null,
    };
  }

  const usage = response.usage;
  const usageAny = usage as unknown as Record<string, number>;
  console.log(`[TRIAGE] Tokens — input: ${usage.input_tokens}, cached: ${usageAny.cache_read_input_tokens || 0}, output: ${usage.output_tokens}`);

  const content = response.content[0]?.type === "text" ? response.content[0].text : "";

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        entity_match: parsed.entity_match || { id: null, name: "", confidence: "low", reasoning: "" },
        investment_match: parsed.investment_match || null,
        document_type: parsed.document_type || "other",
        document_category: parsed.document_category || "other",
        year: parsed.year || null,
        is_composite: parsed.is_composite || false,
        composite_sections: parsed.composite_sections || [],
        mismatch_flag: parsed.mismatch_flag || false,
        mismatch_reason: parsed.mismatch_reason || null,
      };
    }
  } catch (err) {
    console.error("Tier 1 triage JSON parse error:", err);
  }

  // Fallback
  return {
    entity_match: { id: null, name: "", confidence: "low", reasoning: "Failed to parse triage response" },
    investment_match: null,
    document_type: "other",
    document_category: "other",
    year: null,
    is_composite: false,
    composite_sections: [],
    mismatch_flag: false,
    mismatch_reason: null,
  };
}

// --- Batch Triage ---

export async function triageBatch(
  items: Array<{ id: string; buffer: Buffer; filename: string; mimeType: string; pageCount?: number }>,
  orgId: string,
  userContext?: string,
  pageContext?: Tier1Input["pageContext"]
): Promise<Map<string, Tier1Result>> {
  const entityRoster = await buildEntityRoster(orgId);
  const investmentRoster = await buildInvestmentRoster(orgId);

  const tasks = items.map((item) => () =>
    runTier1(
      {
        buffer: item.buffer,
        filename: item.filename,
        mimeType: item.mimeType,
        pageCount: item.pageCount,
        userContext,
        pageContext,
      },
      entityRoster,
      investmentRoster,
    ).then((result) => [item.id, result] as [string, Tier1Result])
  );

  const results = await processWithConcurrency(tasks, TIER1_CONCURRENCY);
  return new Map(results);
}
