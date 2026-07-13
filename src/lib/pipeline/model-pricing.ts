// Single source of truth for model token pricing, so we can compute the real
// dollar cost of a document-agent run (the dominant COGS in the retrieval/
// ingestion product). Used to build the cost-per-document distribution that
// gates pricing-tier decisions.
//
// ⚠️ VERIFY these rates against current Anthropic pricing before trusting cost
// figures — this table is the ONE place to update when pricing changes.

/** Token counts for one or many model calls, broken out by billing class.
 *  The Anthropic API reports `input_tokens` as the UNCACHED input only;
 *  cache reads and cache writes are separate fields with very different
 *  prices, which is exactly why a single summed number mis-states cost. */
export interface TokenUsage {
  input: number; // uncached input tokens
  output: number; // generated tokens
  cacheRead: number; // cache_read_input_tokens — ~0.1× input price
  cacheCreation: number; // cache_creation_input_tokens — ~1.25× input (5-min write)
}

interface ModelRates {
  input: number; // USD per 1M tokens
  output: number;
  cacheRead: number;
  cacheWrite: number; // 5-minute ephemeral write
}

// USD per 1,000,000 tokens.
const PRICING: Record<string, ModelRates> = {
  // Sonnet 4.x — the model the document agent runs on today.
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  // For future model-tiering cost modeling (route simple docs cheaper).
  // VERIFY before relying on these two.
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  "claude-opus-4-8": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
};

export function emptyUsage(): TokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
}

/** Total tokens across all billing classes (for a rough volume figure). */
export function totalTokens(u: TokenUsage): number {
  return u.input + u.output + u.cacheRead + u.cacheCreation;
}

/** Fully-loaded USD cost for the given model + usage. Returns 0 for an
 *  unknown model (surface that as "cost unknown" in aggregation, don't trust
 *  it as free). */
/** Fall back to family pricing when the exact version string isn't in the
 *  table (e.g. chat runs "claude-opus-4-6" while the table lists "-4-8") so a
 *  model bump doesn't silently zero out cost. */
function ratesFor(model: string): ModelRates | null {
  if (PRICING[model]) return PRICING[model];
  const m = model.toLowerCase();
  if (m.includes("opus")) return PRICING["claude-opus-4-8"];
  if (m.includes("sonnet")) return PRICING["claude-sonnet-4-6"];
  if (m.includes("haiku")) return PRICING["claude-haiku-4-5"];
  return null;
}

export function computeCostUsd(model: string, u: TokenUsage): number {
  const r = ratesFor(model);
  if (!r) return 0;
  return (
    (u.input * r.input +
      u.output * r.output +
      u.cacheRead * r.cacheRead +
      u.cacheCreation * r.cacheWrite) /
    1_000_000
  );
}
