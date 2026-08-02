/**
 * Central AI-usage ledger (migration 085).
 *
 * Every call to any AI service records ONE row here via recordAiUsage(), so
 * cost-per-action is queryable in one place across all surfaces. This is the
 * standing instrumentation contract: a new AI call site is not "done" until it
 * records usage here.
 *
 * Best-effort by design — a telemetry write must never break or slow the
 * feature it's measuring, so failures are swallowed (logged, not thrown).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeCostUsd, type TokenUsage } from "@/lib/pipeline/model-pricing";

export interface AiUsageEvent {
  /** Coarse call site: 'chat' | 'document_extraction' | 'triage' | 'investment_overview' | … */
  surface: string;
  model: string;
  usage: TokenUsage;
  organizationId?: string | null;
  /** Finer operation within a surface (a tool name, a phase). */
  action?: string | null;
  provider?: string;
  /** Precomputed cost; defaults to computeCostUsd(model, usage) for consistency. */
  costUsd?: number;
  latencyMs?: number | null;
  resourceType?: string | null;
  resourceId?: string | null;
  userId?: string | null;
  success?: boolean;
  error?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Record one AI call in the central ledger. Fire-and-forget: never throws.
 * Pass the service-role/admin or org client — writes go through RLS's
 * service-role path (system jobs have no user context).
 */
export async function recordAiUsage(db: SupabaseClient, event: AiUsageEvent): Promise<void> {
  try {
    const costUsd = event.costUsd ?? computeCostUsd(event.model, event.usage);
    await db.from("ai_usage_events").insert({
      organization_id: event.organizationId ?? null,
      surface: event.surface,
      action: event.action ?? null,
      provider: event.provider ?? "anthropic",
      model: event.model,
      input_tokens: event.usage.input ?? 0,
      output_tokens: event.usage.output ?? 0,
      cache_read_tokens: event.usage.cacheRead ?? 0,
      cache_creation_tokens: event.usage.cacheCreation ?? 0,
      cost_usd: costUsd,
      latency_ms: event.latencyMs ?? null,
      resource_type: event.resourceType ?? null,
      resource_id: event.resourceId ?? null,
      user_id: event.userId ?? null,
      success: event.success ?? true,
      error: event.error ?? null,
      metadata: event.metadata ?? null,
    });
  } catch (err) {
    // Telemetry must not break the feature it measures.
    console.error(`[ai-usage] failed to record ${event.surface} usage:`, err);
  }
}
