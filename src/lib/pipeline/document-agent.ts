/**
 * Document agent — replaces extractDocument with a tool-using loop.
 *
 * The previous extraction path was a single Anthropic call with a
 * ~1000-line system prompt that tried to encode every database mutation
 * as a JSON action schema. Output was brittle, the model couldn't verify
 * its own claims, and the worker had to bolt on classifiers / dedup /
 * sibling reconciliation to clean up the mess.
 *
 * This agent replaces that. It runs server-side (no chat UI), reads the
 * doc, then uses the existing MCP tool handlers (called directly via a
 * constructed ToolContext) to look up entities / investments / txns /
 * existing docs, and applies write actions inline as it makes confident
 * decisions. /review only sees what the agent couldn't resolve. Pairs
 * with the principle the user articulated: "/review is the exception
 * list, not the work queue."
 *
 * Design choices:
 *
 * - **Direct handler invocation, not MCP transport.** The MCP server is a
 *   JSON-RPC wrapper around `defineTool` handlers. The handlers are
 *   designed to be called directly (the schema docs say so explicitly).
 *   We construct a ToolContext for the agent's run and pass it to each
 *   handler.
 *
 * - **No userId.** The agent runs in worker context, not on a user
 *   session. Audit logs that capture who-did-what will record null —
 *   that's an honest signal ("the system did this autonomously") and we
 *   can wire a system user later if we need stronger attribution.
 *
 * - **Side-effects, not proposals.** The agent doesn't propose actions
 *   for /review to apply later — it APPLIES them as it goes via the
 *   write tools. /review only ever sees the agent's `defer_to_review`
 *   calls (genuine ambiguity that needs human input).
 *
 * - **Bounded iteration.** Hard cap on tool-use turns; if the agent
 *   exceeds it, default to defer_to_review. Prevents runaway loops.
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { redact as redactImpl } from "@/lib/mcp/redact";
import type { ToolContext } from "@/lib/mcp/tool-context";
import type { ToolDefinition } from "@/lib/mcp/schema";
import { type TokenUsage, emptyUsage, computeCostUsd } from "./model-pricing";
import { isSpreadsheet, spreadsheetToText } from "./spreadsheet";

/** Retry an Anthropic create on 429 rate-limit with exponential backoff + jitter.
 *  This is the throttle for the durable worker: concurrent doc runs that hit the
 *  org rate limit back off and retry instead of failing the document. */
async function createWithBackoff(
  anthropic: Anthropic,
  params: Anthropic.Messages.MessageCreateParamsNonStreaming,
  maxRetries = 5,
): Promise<Anthropic.Messages.Message> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await anthropic.messages.create(params);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const msg = err instanceof Error ? err.message : String(err);
      const is429 = status === 429 || /rate.?limit|429/i.test(msg);
      if (!is429 || attempt >= maxRetries) throw err;
      const waitMs = Math.min(30_000, 1_000 * 2 ** attempt) + Math.floor(Math.random() * 1_000);
      console.warn(`[DOC-AGENT] 429 rate limit — backing off ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

// Read tools — agent uses these for verification
import { listInvestmentsTool, getInvestmentTool, listInvestmentTransactionsTool } from "@/lib/mcp/tools/investments";
import { listEntitiesTool, getEntityTool } from "@/lib/mcp/tools/entities";
import { listDirectoryEntriesTool } from "@/lib/mcp/tools/directory";
import { searchDocumentsTool, listDocumentsForEntityTool, listDocumentsForInvestmentTool } from "@/lib/mcp/tools/documents";

// Write tools — agent applies confident actions inline
import {
  linkDocumentToEntityTool,
  linkDocumentToInvestmentTool,
  updateDocumentTool,
  splitDocumentTool,
} from "@/lib/mcp/tools/documents-write";
import {
  recordInvestmentTransactionTool,
  updateInvestmentTransactionTool,
} from "@/lib/mcp/tools/investments-write";

import {
  analyzePdf,
  analyzePdfWithPassword,
  buildPdfContent,
  PdfPasswordRequiredError,
  probePdfRequiresPassword,
} from "./pdf-processor";

import { Semaphore } from "@/lib/utils/semaphore";

const anthropic = new Anthropic();

/**
 * Process-global concurrency limit on document-agent runs. Each run makes
 * ~5–12 API calls of ~50–80K input tokens; without bounding, a Silverhawk-
 * style upload (5 PDFs × 3 children) launched 15 agents in parallel and
 * blew through Anthropic's 800K-tokens-per-minute org rate limit, returning
 * 429s on iteration 4–7 of most children.
 *
 * Setting this to 4 means at most 4 agents run concurrently — others wait.
 * Combined with prompt caching, this keeps the worker comfortably under
 * the rate ceiling while still parallelizing per-investor leaves.
 */
const AGENT_CONCURRENCY = 4;
const agentLimiter = new Semaphore(AGENT_CONCURRENCY);

// --- Tool registration ----------------------------------------------------

/** A subset of the MCP tools available to the agent. We start with the
 *  tools needed for the distribution-notice / K-1 / capital-call flow and
 *  expand as we hit gaps. Every entry is an existing ToolDefinition; the
 *  agent calls handler() directly with a constructed ToolContext. */
const REGISTRY: ToolDefinition[] = [
  // Investment domain
  listInvestmentsTool,
  getInvestmentTool,
  listInvestmentTransactionsTool,
  // Entity domain
  listEntitiesTool,
  getEntityTool,
  // Directory
  listDirectoryEntriesTool,
  // Documents — read
  searchDocumentsTool,
  listDocumentsForEntityTool,
  listDocumentsForInvestmentTool,
  // Documents — write
  linkDocumentToEntityTool,
  linkDocumentToInvestmentTool,
  updateDocumentTool,
  splitDocumentTool,
  // Transactions — write
  recordInvestmentTransactionTool,
  updateInvestmentTransactionTool,
];

/** Translate a ToolDefinition into the schema Anthropic's tool-use API
 *  expects. We delegate to zod-to-json-schema (already a dependency) which
 *  handles zod 4's shape/optionality/refinements correctly — beats hand-
 *  rolling and risking a drift between what the agent thinks the tool
 *  takes and what the handler actually validates. */
function toolDefToAnthropicTool(def: ToolDefinition): Anthropic.Messages.Tool {
  // zod-to-json-schema's typings target zod 3; project is on zod 4 — the
  // runtime works fine, types don't line up. Cast through unknown.
  const generated = zodToJsonSchema(
    def.inputSchema as unknown as Parameters<typeof zodToJsonSchema>[0],
    { target: "openApi3" },
  ) as {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
  return {
    name: def.name,
    description: def.description,
    input_schema: {
      type: "object",
      properties: generated.properties ?? {},
      required: generated.required ?? [],
    },
  };
}

// --- Agent run ------------------------------------------------------------

export interface DocumentAgentInput {
  /** The queue item we're processing. Must already have file_path set. */
  queueItemId: string;
  /** The document_id this queue item maps to (or null if not yet ingested
   *  — the agent's first action will typically be `update_document` with
   *  identification fields, but the doc row should already exist by the
   *  time the agent runs). */
  documentId: string | null;
  /** Org context — used to construct ToolContext. */
  orgId: string;
  /** PDF bytes for the document. */
  fileBuffer: Buffer;
  /** Mime type. */
  mimeType: string | null;
  /** User-supplied filename. */
  filename: string;
  /** Optional user context from the chat session that triggered the upload
   *  (e.g., "associate these with Silverhawk Incline I transactions"). */
  userContext?: string | null;
  /** True when this queue item is a split child — the parent agent already
   *  verified the per-section investor mapping and the file is one logical
   *  section (typically one page). The agent must NOT call split_document
   *  in this mode; it processes the leaf as a single-section doc. */
  isSplitChild?: boolean;
  /** Pre-identified recipient/investor entity for this section, written by
   *  the splitter from the parent agent's verified mapping. When set, the
   *  agent treats entity identification as already-resolved and goes straight
   *  to investment + transaction matching. */
  preIdentifiedEntityId?: string | null;
  /** Known investment from the split context (the parent doc was already
   *  associated with this investment). When set, the agent skips
   *  list_investments/get_investment for re-identification. */
  knownInvestmentId?: string | null;
  /** Transient password for encrypted PDFs. Supplied by the unlock route /
   *  unlock_document tool; never persisted. When absent, an encrypted PDF
   *  surfaces as PdfPasswordRequiredError so the worker can park the item
   *  in password_required and prompt the user. */
  password?: string;
}

export interface DocumentAgentOutput {
  /** Did the agent finish cleanly? */
  status: "applied" | "deferred" | "failed";
  /** Short human summary of what happened, for the queue item's
   *  ai_summary field and for the chat transcript. */
  summary: string;
  /** When `status === "deferred"`, the question/context to surface in
   *  /review for human resolution. */
  deferReason?: string;
  /** Tools the agent called, in order — for debugging and audit. */
  toolCalls: Array<{ name: string; input: unknown; ok: boolean; resultPreview?: string }>;
  /** Tokens spent across the agent's run (uncached input + output — keeps the
   *  original `extraction_tokens` semantics for back-compat). */
  tokensUsed: number;
  /** Usage broken out by billing class (uncached input / output / cache read /
   *  cache write), for cost analysis. Cache reads are ~0.1× and cache writes
   *  ~1.25× of input, so the breakout is required to compute real cost. */
  usage: TokenUsage;
  /** Model round-trips (turns) in the agent loop — drives within-run caching. */
  turns: number;
  /** Model the agent ran on. */
  model: string;
  /** Fully-loaded USD cost of the run at current pricing. */
  costUsd: number;
}

const SYSTEM_PROMPT = `You are a document-processing agent for a family-office entity-management platform. A document just landed in the upload queue. Your job: read it, figure out what it is, and use tools to file it correctly.

Available tools:
- READ: list_investments, get_investment (returns active investors + recent transactions), list_investment_transactions, list_entities, get_entity, list_directory_entries, search_documents, list_documents_for_entity, list_documents_for_investment.
- WRITE: update_document, link_document_to_investment, link_document_to_entity, record_investment_transaction, update_investment_transaction, split_document.
- defer_to_review: surface to /review with a question for the human. Use sparingly — only when triangulation actually fails, not when you're unsure.

## Triangulation, not guessing

Document text is OCR — names get misread (e.g., "Incline" vs "Online", "Doherty" vs "Doherity"). Don't defer just because the doc's text doesn't perfectly match a record. Use multiple signals:

- **Investment name + investor names + amounts together.** If the doc names "Silverhawk Online Energy LP" with partners Sean Paul Doherty Jr., Emma Alexandra Doherty, John Patrick Doherty, and the org has "Silverhawk Incline Energy I" with active investors Sean Doherty Jr, Emma Doherty, John Patrick Doherty — that's the same investment. Investors agreeing is far stronger evidence than a single header word.
- **Amounts + dates + investors together.** If the doc shows a distribution of $96,086.69 on 2022-08-19 to Sean and the ledger has exactly that, it's the matching transaction even if doc-text formatting differs.

When in doubt, get_investment(id) and inspect the active_investors array — match doc partners to entity names (with tolerance for first/middle/suffix variations). Only defer if you genuinely can't find a 2-of-3 match across (investment name, investor names, amounts).

## First decision: is this multi-section or single-section?

A document is **multi-section** if it has multiple distinct investor pages, multiple bundled documents (tax package), or otherwise can't be filed under one investor. Look at the PDF: how many distinct partner sections does it contain?

- **Multi-section → split, don't verify.** Skip straight to split_document with explicit per-section info. Don't try to match amounts to the ledger; that's the children's job. The pattern: identify investment via list_investments + get_investment, identify which partner is on which page from the PDF, then split with pre-filled entity_ids:

\`\`\`
split_document({
  document_id: "...",
  sections: [
    { page_range: [1, 1], entity_id: "<entity_id of partner on page 1>", type_hint: "distribution_notice" },
    { page_range: [2, 2], entity_id: "<entity_id of partner on page 2>", type_hint: "distribution_notice" },
    { page_range: [3, 3], entity_id: "<entity_id of partner on page 3>", type_hint: "distribution_notice" }
  ]
})
\`\`\`

DO NOT call split_document with just document_id (no sections) — that path uses heuristics and routinely misallocates. The whole point of you having tools is to verify the per-page mapping yourself.

After splitting, your job is done. Each child runs through this same agent fresh, with the entity already identified.

- **Single-section** (one investor / one logical document) → verify and apply:
  1. From the doc, identify the investment name and the recipient investor name.
  2. list_investments({ name_query: "<distinctive token>" }) — pass the most distinctive single token, not the full name.
  3. get_investment(investment_id) → check active_investors; the right investment is the one whose investors match the doc's recipient.
  4. list_investment_transactions(investment_id, date_from, date_to) → find the ledger row matching the doc's investor + date + amount.
  5. Apply ALL of:
     - update_document(document_id, document_type, document_category, year, name)
     - link_document_to_investment(document_id, investment_id)
     - link_document_to_entity(document_id, entity_id) — the recipient
     - update_investment_transaction({ transaction_id, document_id }) — pass BOTH; without document_id the call is a no-op for the doc-link.
  6. If the doc's amount differs from the ledger by more than 1¢ but the investor / date / context are otherwise an obvious match: small discrepancies (<$1 or under 0.05%) are usually OCR noise — apply against the ledger amount and the document_id linkage stays correct. Larger discrepancies → defer with the specific delta.

## Tool-name precision

Tool param names are exact. Don't invent: \`investment_id\`, \`document_id\`, \`entity_id\`, \`name_query\` (NOT \`name\`), \`date_from\` / \`date_to\` (NOT \`date_min\` / \`date_max\`). When in doubt, the tool description tells you the param names.

## Style

Be terse. Don't narrate. Don't apologize. Pick a tool and call it. When done, send a 1-3 sentence final summary describing what you applied. Tool param names matter — the schema is authoritative; don't invent param names.

If you genuinely cannot make a confident decision after 8-10 tool calls, defer_to_review with a specific question.`;

// Special "tool" the agent can call to surface ambiguity to /review
// without applying anything. We intercept this client-side.
const DEFER_TOOL: Anthropic.Messages.Tool = {
  name: "defer_to_review",
  description:
    "Stop processing and surface this document to the human review queue. Use when you can't confidently identify the document, find conflicting data, or hit ambiguity that needs human input.",
  input_schema: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description: "One sentence explaining why this needs human review and what question the human should answer.",
      },
    },
    required: ["reason"],
  },
};

const MAX_ITERATIONS = 12;
const MAX_OUTPUT_TOKENS = 4096;

export async function runDocumentAgent(
  input: DocumentAgentInput,
): Promise<DocumentAgentOutput> {
  // Bound process-wide concurrency. The semaphore wraps the entire agent
  // run — split-child waves end up serialized into batches of N rather
  // than all firing at once. Holding the slot across the whole run keeps
  // the implementation simple and stable token-rate-wise; per-iteration
  // throttling would interleave but doesn't actually bound calls/min any
  // better given the agent's loop is already sequential within itself.
  return agentLimiter.run(() => runDocumentAgentInternal(input));
}

async function runDocumentAgentInternal(
  input: DocumentAgentInput,
): Promise<DocumentAgentOutput> {
  const {
    queueItemId,
    documentId,
    orgId,
    fileBuffer,
    mimeType,
    filename,
    userContext,
    isSplitChild = false,
    preIdentifiedEntityId,
    knownInvestmentId,
    password,
  } = input;

  // Construct a ToolContext for this run. The agent isn't a logged-in
  // user, so userId is empty — audit logs will record null, which is
  // the right honest signal (the system did this autonomously).
  const ctx: ToolContext = {
    userId: "",
    orgId,
    sessionId: `agent-${queueItemId}`,
    supabase: createAdminClient(),
    redact: redactImpl,
  };

  const tools: Anthropic.Messages.Tool[] = [
    ...REGISTRY.map(toolDefToAnthropicTool),
    DEFER_TOOL,
  ];
  const handlersByName = new Map<string, ToolDefinition>(
    REGISTRY.map((t) => [t.name, t]),
  );

  // Build the initial user message: the PDF + filename + optional user
  // context. We use buildPdfContent so the model gets the same multi-page
  // analysis (page count, optional text) that extractDocument produced.
  // Anthropic's vision API natively accepts these image types; the model
  // auto-downsizes large images, so a 5MB photo costs ~1.6K tokens.
  const VISION_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  const isPdf = mimeType === "application/pdf";
  const isImage = !!mimeType && VISION_IMAGE_TYPES.includes(mimeType);
  let userContent: Anthropic.Messages.ContentBlockParam[];
  if (isPdf) {
    // Password gate: pdf-lib's getPageCount walks the page tree, which is
    // still encrypted on locked PDFs even with ignoreEncryption=true, and
    // throws "Expected instance of PDFDict, but got instance of undefined".
    // Probe first; without a password, surface PdfPasswordRequiredError so
    // the worker parks the item as password_required.
    const requiresPassword = await probePdfRequiresPassword(fileBuffer);
    if (requiresPassword && !password) {
      throw new PdfPasswordRequiredError(filename);
    }
    const analysis = password
      ? await analyzePdfWithPassword(fileBuffer, password)
      : await analyzePdf(fileBuffer, null);
    const pdfBlocks = await buildPdfContent(
      fileBuffer,
      analysis,
      filename,
      null,
      null,
      password ? { password } : undefined,
    );
    // buildPdfContent returns Promise<unknown[]> because it emits a mix of
    // text blocks and base64 PDF/image blocks; the elements ARE valid
    // ContentBlockParam shapes, just typed loosely. Cast through unknown.
    userContent = pdfBlocks as unknown as Anthropic.Messages.ContentBlockParam[];
  } else if (isImage) {
    // Images (scans/photos of W-2s, 1099s, etc.) go to the vision model as a
    // base64 image block. Critically NOT as text: decoding raw JPEG/PNG bytes
    // as UTF-8 produces millions of garbage "tokens" and blows the context
    // window ("prompt is too long: 2.6M tokens > 1M") before the model runs.
    userContent = [
      { type: "text", text: `Document name: "${filename}"` },
      {
        type: "image",
        source: {
          type: "base64",
          media_type: mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
          data: fileBuffer.toString("base64"),
        },
      },
    ];
  } else if (isSpreadsheet(mimeType, filename)) {
    // Spreadsheets (.xlsx — financials, GLs, cap tables) are ZIP-of-XML, so
    // raw bytes as UTF-8 are garbage. Parse the workbook into CSV-style text.
    let sheetText: string;
    try {
      sheetText = await spreadsheetToText(fileBuffer, filename);
    } catch (err) {
      // Legacy .xls or a corrupt workbook — don't crash the run; give the agent
      // enough to defer cleanly rather than feeding it garbage.
      sheetText = `Document name: "${filename}"\n\n[Could not parse this spreadsheet${
        filename.toLowerCase().endsWith(".xls") ? " (legacy .xls format may be unsupported)" : ""
      }: ${err instanceof Error ? err.message : String(err)}]`;
    }
    userContent = [{ type: "text", text: sheetText }];
  } else {
    // Other non-PDF, non-image, non-spreadsheet files (genuinely text-y).
    userContent = [
      {
        type: "text",
        text: `Document name: "${filename}"\n\n${fileBuffer.toString("utf-8")}`,
      },
    ];
  }
  const introText: string[] = [
    `A document just landed in the queue. Process it using the tools.`,
    `Filename: "${filename}"`,
    `Queue item id: ${queueItemId}`,
  ];
  if (documentId) introText.push(`Document id (for write tools): ${documentId}`);
  if (userContext) introText.push(`User context (chat): "${userContext}"`);
  if (isSplitChild) {
    introText.push(
      "",
      "## SPLIT CHILD — DO NOT SPLIT FURTHER",
      "This file is ONE leaf section produced by a parent agent that already verified the per-section investor mapping. Treat it as single-section. Do NOT call split_document under any circumstances. Skip straight to the verify-and-apply flow described in the system prompt.",
    );
    if (preIdentifiedEntityId) {
      introText.push(
        `Recipient entity (already verified by parent agent): ${preIdentifiedEntityId}. Use this entity_id for link_document_to_entity — do not re-derive it from the page text.`,
      );
    }
    if (knownInvestmentId) {
      introText.push(
        `Investment (carried from parent): ${knownInvestmentId}. Use this for link_document_to_investment and as the scope for list_investment_transactions — do not call list_investments to re-discover it.`,
      );
    }
  }
  // Cache breakpoint on the LAST block of the first user message → caches
  // [system + tools + the entire document]. The agent re-sends this message on
  // every turn; without caching the doc (text + page images) is re-charged at
  // full price each turn — which our telemetry showed is ~97% of total cost.
  // With it, turns 2..N read the doc at 0.1× instead of 1.0×. Quality-identical;
  // the 5-min ephemeral TTL easily covers a single doc's multi-turn run.
  userContent.push({ type: "text", text: introText.join("\n"), cache_control: { type: "ephemeral" } });

  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: userContent },
  ];

  const toolCalls: DocumentAgentOutput["toolCalls"] = [];
  const AGENT_MODEL = "claude-sonnet-4-6";
  const usageTotals = emptyUsage();
  let turns = 0;
  let deferred: { reason: string } | null = null;
  let finalAssistantText: string | null = null;

  // Common cost/usage fields for every return path. Reads the live
  // accumulator, so call it at return time (after the loop has run).
  // `tokensUsed` stays uncached-input + output for back-compat; `usage` carries
  // the full breakout (incl. cache reads/writes) that `costUsd` is computed from.
  const buildMetrics = () => ({
    tokensUsed: usageTotals.input + usageTotals.output,
    usage: { ...usageTotals },
    turns,
    model: AGENT_MODEL,
    costUsd: computeCostUsd(AGENT_MODEL, usageTotals),
  });

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let response: Anthropic.Messages.Message;
    try {
      // Prompt caching: mark the system prompt with cache_control so the
      // SYSTEM_PROMPT + tools (which come before system in cache order)
      // are cached for 5 min. The PDF, tool results, and message history
      // all come AFTER and stay fresh — no staleness risk because nothing
      // dynamic is in the cached prefix. Per Anthropic docs, pricing on
      // cached blocks is ~10% of normal input. Net: ~30% cost cut on the
      // worker pipeline, since the static prefix is most of every call.
      response = await createWithBackoff(anthropic, {
        model: AGENT_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools,
        messages,
      });
    } catch (err) {
      console.error(
        `[DOC-AGENT] ${queueItemId} iter ${iter}: API error:`,
        err instanceof Error ? err.message : err,
      );
      return {
        status: "failed",
        summary: `Agent API error on iteration ${iter}: ${err instanceof Error ? err.message : String(err)}`,
        toolCalls,
        ...buildMetrics(),
      };
    }
    const usage = response.usage as unknown as Record<string, number>;
    // API `input_tokens` is UNCACHED input only; cache read/write are separate
    // billing classes (a cache write costs ~1.25× input, a read ~0.1×), so we
    // keep them apart — collapsing them is what makes a summed token count
    // useless for cost. Every call with cache_creation > 0 is a cache *write*
    // (a "cold" prefix); cache_read > 0 means we hit a warm prefix.
    usageTotals.input += usage.input_tokens || 0;
    usageTotals.output += usage.output_tokens || 0;
    usageTotals.cacheRead += usage.cache_read_input_tokens || 0;
    usageTotals.cacheCreation += usage.cache_creation_input_tokens || 0;
    turns += 1;

    // If model didn't call a tool, it's done — capture the final text.
    if (response.stop_reason !== "tool_use") {
      const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("\n")
        .trim();
      finalAssistantText = text || "(no final summary)";
      break;
    }

    // Execute every tool_use block in this turn.
    const toolResultBlocks: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

      // Special-case: defer_to_review short-circuits the loop.
      if (block.name === "defer_to_review") {
        const reason = ((block.input as Record<string, unknown>).reason as string) || "no reason";
        deferred = { reason };
        toolCalls.push({
          name: block.name,
          input: block.input,
          ok: true,
          resultPreview: reason,
        });
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Deferred. The document will be surfaced to /review with reason: ${reason}`,
        });
        break;
      }

      // Hard guard: a split-child agent must never re-split. The prompt
      // says so in two places, but if the model hallucinates anyway we
      // refuse it here rather than letting it create grandchildren that
      // either cap out at MAX_SPLIT_DEPTH or (worse) drift into a fresh
      // top-level split via splitDocumentTool's own depth=0 init.
      if (isSplitChild && block.name === "split_document") {
        const errMsg =
          "split_document is forbidden for split-child agents. This file is one leaf section; process it as single-section per the system prompt.";
        toolCalls.push({ name: block.name, input: block.input, ok: false, resultPreview: errMsg });
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: errMsg,
          is_error: true,
        });
        continue;
      }

      const def = handlersByName.get(block.name);
      if (!def) {
        const errMsg = `Unknown tool: ${block.name}`;
        toolCalls.push({ name: block.name, input: block.input, ok: false, resultPreview: errMsg });
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: errMsg,
          is_error: true,
        });
        continue;
      }

      // Validate input via the tool's zod schema, then call the handler.
      const parseResult = def.inputSchema.safeParse(block.input);
      if (!parseResult.success) {
        // Be directive: the model otherwise loops on a bad value (e.g. an
        // out-of-enum document_category) and then GIVES UP, writing a prose
        // summary instead of filing. Tell it to correct and retry, and forbid
        // the prose-instead-of-tools escape hatch.
        const errMsg =
          `Invalid input for ${block.name}: ${parseResult.error.message}. ` +
          `Correct the parameters to match the schema exactly — for enum fields you MUST use one of the exact allowed values listed above; pick the closest one rather than inventing a value — then call ${block.name} again. ` +
          `Do NOT respond with a prose summary in place of tool calls; the document is only filed when the tools succeed.`;
        toolCalls.push({ name: block.name, input: block.input, ok: false, resultPreview: errMsg });
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: errMsg,
          is_error: true,
        });
        continue;
      }

      try {
        const result = await def.handler(parseResult.data, ctx);
        const json = JSON.stringify(result);
        const preview = json.length > 200 ? json.slice(0, 200) + "…" : json;
        toolCalls.push({ name: block.name, input: block.input, ok: true, resultPreview: preview });
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: block.id,
          // Cap content length so a giant list doesn't blow the context
          // window on the next turn. The agent saw the truncation marker
          // and can re-call with filters if it needs more.
          content:
            json.length > 8000
              ? json.slice(0, 8000) + "\n[truncated — use filters to narrow]"
              : json,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        toolCalls.push({ name: block.name, input: block.input, ok: false, resultPreview: errMsg });
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: errMsg,
          is_error: true,
        });
      }
    }

    if (deferred) break;

    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: toolResultBlocks });
  }

  if (deferred) {
    return {
      status: "deferred",
      summary: `Deferred to review: ${deferred.reason}`,
      deferReason: deferred.reason,
      toolCalls,
      ...buildMetrics(),
    };
  }

  return {
    status: "applied",
    summary: finalAssistantText || `Processed in ${toolCalls.length} tool calls.`,
    toolCalls,
    ...buildMetrics(),
  };
}
