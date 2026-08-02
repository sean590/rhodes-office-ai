/**
 * Shared engine for AI record overviews (investments, entities, …).
 *
 * Each record type assembles its own context (assembleContext → text +
 * fingerprint) and hands it here; this module owns the parts that must stay
 * identical across record types: the fingerprint-skip, the model call, cost +
 * central-ledger instrumentation, and the persist to the record's
 * ai_overview_* columns. Both `investments` and `entities` use the SAME column
 * names, so the only per-type knobs are the table, the ledger surface/resource
 * labels, and the system prompt.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeCostUsd, type TokenUsage } from "@/lib/pipeline/model-pricing";
import { recordAiUsage } from "@/lib/ai-usage";

const anthropic = new Anthropic();

/** Balance of quality (reasoning about materiality) vs cost for a frequent job. */
export const OVERVIEW_MODEL = "claude-sonnet-5";

export interface AssembledContext {
  text: string;
  fingerprint: string;
  hasSubstance: boolean;
}

export interface OverviewResult {
  overview: string | null;
  skipped: boolean;
  costUsd?: number;
}

export interface OverviewGenConfig {
  table: "investments" | "entities";
  resourceId: string;
  orgId: string;
  /** Ledger surface, e.g. 'investment_overview' | 'entity_overview'. */
  surface: string;
  /** Ledger resource_type, e.g. 'investment' | 'entity'. */
  resourceType: string;
  systemPrompt: string;
  context: AssembledContext;
  force?: boolean;
}

/**
 * Generate + persist an overview from an already-assembled context. Clears the
 * stale flag. Skips the model call when the fingerprint is unchanged (unless
 * `force`). Throws on API/DB error so a worker can count the attempt.
 */
export async function generateOverview(
  db: SupabaseClient,
  cfg: OverviewGenConfig,
): Promise<OverviewResult> {
  const { data: current } = await db
    .from(cfg.table)
    .select("ai_overview, ai_overview_fingerprint")
    .eq("id", cfg.resourceId)
    .maybeSingle();

  // Nothing material changed since last generation — just clear the flag.
  if (!cfg.force && current?.ai_overview && current.ai_overview_fingerprint === cfg.context.fingerprint) {
    await db
      .from(cfg.table)
      .update({ ai_overview_stale: false, ai_overview_attempts: 0 })
      .eq("id", cfg.resourceId);
    return { overview: current.ai_overview as string, skipped: true };
  }

  const t0 = Date.now();
  const response = await anthropic.messages.create({
    model: OVERVIEW_MODEL,
    max_tokens: 400,
    system: [{ type: "text", text: cfg.systemPrompt, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `${cfg.context.text}\n\nWrite the briefing.` }],
  });
  const latencyMs = Date.now() - t0;

  const overview = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const u = response.usage as unknown as Record<string, number>;
  const usage: TokenUsage = {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheCreation: u.cache_creation_input_tokens ?? 0,
  };
  const costUsd = computeCostUsd(OVERVIEW_MODEL, usage);

  await recordAiUsage(db, {
    surface: cfg.surface,
    model: OVERVIEW_MODEL,
    usage,
    costUsd,
    latencyMs,
    organizationId: cfg.orgId,
    resourceType: cfg.resourceType,
    resourceId: cfg.resourceId,
  });

  const { error } = await db
    .from(cfg.table)
    .update({
      ai_overview: overview || null,
      ai_overview_generated_at: new Date().toISOString(),
      ai_overview_model: OVERVIEW_MODEL,
      ai_overview_fingerprint: cfg.context.fingerprint,
      ai_overview_stale: false,
      ai_overview_attempts: 0,
      ai_overview_cost_usd: costUsd,
      ai_overview_input_tokens: usage.input,
      ai_overview_output_tokens: usage.output,
      ai_overview_cache_read_tokens: usage.cacheRead,
      ai_overview_cache_creation_tokens: usage.cacheCreation,
    })
    .eq("id", cfg.resourceId)
    .eq("organization_id", cfg.orgId);
  if (error) throw new Error(`Failed to persist overview: ${error.message}`);

  return { overview: overview || null, skipped: false, costUsd };
}

/** Flag rows in a table for regeneration (app-side; DB triggers cover most). */
export async function markOverviewStale(
  db: SupabaseClient,
  table: "investments" | "entities",
  ids: string[],
): Promise<void> {
  const clean = ids.filter(Boolean);
  if (!clean.length) return;
  await db.from(table).update({ ai_overview_stale: true, ai_overview_attempts: 0 }).in("id", clean);
}
