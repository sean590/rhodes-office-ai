/**
 * AI-generated investment overviews (migration 084).
 *
 * A model-written briefing that reads the investment's actual substance — its
 * documents (their AI extractions), notes, transactions, ownership transfers,
 * and investors — and says, in 2-4 sentences, what's materially going on ("the
 * SAFE converted at $X in the seed round; …"). Regenerated in the background
 * when a related write flips ai_overview_stale (Postgres triggers), and on
 * demand from chat via the refresh_investment_overview MCP tool.
 *
 * Cost-controlled: a fingerprint over the salient inputs skips the LLM call
 * when a stale flag fired but nothing material actually changed. Every call is
 * priced via computeCostUsd and the four token classes are persisted.
 */
import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  OVERVIEW_MODEL,
  generateOverview,
  markOverviewStale,
  type AssembledContext,
  type OverviewResult,
} from "@/lib/ai-overview-core";

const MAX_DOCS = 20;
const MAX_NOTES = 15;
const MAX_TXNS = 40;

const SYSTEM_PROMPT = `You write a concise briefing about a single investment for a family office, so anyone landing on the record instantly understands what's going on with it.

Rules:
- 2-4 sentences. No preamble, no headings, no bullet points — just the briefing prose.
- LEAD with the most material recent development (a financing converting, a distribution paid, a round priced, a stake transferred, a default). Be concrete: cite amounts, prices, dates, percentages when the source data has them.
- Only state what the provided data supports. Never invent numbers, dates, or events. If little is known, say plainly what the investment is and that little activity is recorded yet.
- Write in plain English for a smart reader who is not on the deal team. Present tense for current state; past tense for what happened.
- Do not restate the record's raw schema ("this is an investment of type startup"). Say what it MEANS.`;

function fmtMoney(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n ?? "");
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/**
 * Pull the investment's substance into a compact prompt context + a fingerprint
 * over the salient parts. Returns null if the investment isn't in this org.
 */
export async function assembleInvestmentContext(
  db: SupabaseClient,
  orgId: string,
  investmentId: string,
): Promise<AssembledContext | null> {
  const { data: inv } = await db
    .from("investments")
    .select(
      "id, name, short_name, investment_type, status, description, formation_state, date_invested, date_exited, preferred_return_pct",
    )
    .eq("id", investmentId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!inv) return null;

  const { data: investors } = await db
    .from("investment_investors")
    .select("id, capital_pct, profit_pct, committed_capital, is_active, entities:entity_id(name)")
    .eq("investment_id", investmentId)
    .eq("is_active", true);

  const investorIds = (investors ?? []).map((i) => i.id as string);

  const { data: txns } = investorIds.length
    ? await db
        .from("investment_transactions")
        .select("transaction_type, amount, transaction_date, description")
        .in("investment_investor_id", investorIds)
        .order("transaction_date", { ascending: false })
        .limit(MAX_TXNS)
    : { data: [] as Array<Record<string, unknown>> };

  const { data: transfers } = await db
    .from("investment_ownership_transfers")
    .select("from_entity_name, to_entity_name, transfer_type, transferred_pct, fair_market_value, transfer_date")
    .eq("investment_id", investmentId)
    .order("transfer_date", { ascending: false });

  const { data: docs } = await db
    .from("documents")
    .select("id, name, document_type, year, created_at, ai_extraction")
    .eq("investment_id", investmentId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(MAX_DOCS);

  const { data: noteLinks } = await db
    .from("note_links")
    .select("note_id")
    .eq("investment_id", investmentId)
    .not("note_id", "is", null);
  const noteIds = (noteLinks ?? []).map((l) => l.note_id as string);
  const { data: notes } = noteIds.length
    ? await db
        .from("notes")
        .select("id, body, note_date")
        .in("id", noteIds)
        .order("note_date", { ascending: false })
        .limit(MAX_NOTES)
    : { data: [] as Array<Record<string, unknown>> };

  // ---- Build the prompt text ----
  const lines: string[] = [];
  lines.push(`Investment: ${inv.name}${inv.short_name ? ` (${inv.short_name})` : ""}`);
  lines.push(`Type: ${inv.investment_type} · Status: ${inv.status}`);
  if (inv.formation_state) lines.push(`Formation state: ${inv.formation_state}`);
  if (inv.date_invested) lines.push(`Initial investment date: ${inv.date_invested}`);
  if (inv.date_exited) lines.push(`Exited: ${inv.date_exited}`);
  if (inv.preferred_return_pct != null) lines.push(`Preferred return: ${inv.preferred_return_pct}%`);
  if (inv.description) lines.push(`Description: ${inv.description}`);

  if ((investors ?? []).length) {
    lines.push("\nInvestors (internal entities):");
    for (const iv of investors!) {
      const ent = iv.entities as { name?: string } | null;
      const parts = [
        iv.capital_pct != null ? `${Number(iv.capital_pct)}% capital` : null,
        iv.profit_pct != null ? `${Number(iv.profit_pct)}% profit` : null,
        iv.committed_capital != null ? `${fmtMoney(iv.committed_capital)} committed` : null,
      ].filter(Boolean);
      lines.push(`- ${ent?.name ?? "Unknown"}${parts.length ? ` — ${parts.join(", ")}` : ""}`);
    }
  }

  if ((transfers ?? []).length) {
    lines.push("\nOwnership transfers:");
    for (const t of transfers!) {
      lines.push(
        `- ${t.transfer_date}: ${t.from_entity_name} ${t.transfer_type === "sale" ? "sold" : t.transfer_type === "gift" ? "gifted" : "transferred"} ${Number(t.transferred_pct)}% to ${t.to_entity_name}${t.fair_market_value != null ? ` (FMV ${fmtMoney(t.fair_market_value)})` : ""}`,
      );
    }
  }

  if ((txns ?? []).length) {
    lines.push("\nTransactions (most recent first):");
    for (const t of txns!) {
      lines.push(`- ${t.transaction_date}: ${String(t.transaction_type).replace(/_/g, " ")} ${fmtMoney(t.amount)}${t.description ? ` — ${t.description}` : ""}`);
    }
  }

  if ((docs ?? []).length) {
    lines.push("\nDocuments on file (most recent first):");
    for (const d of docs!) {
      const ex = d.ai_extraction as { summary?: string } | null;
      const summary = ex?.summary ? ` — ${String(ex.summary).slice(0, 600)}` : "";
      lines.push(`- ${d.name}${d.document_type && d.document_type !== "other" ? ` [${d.document_type}]` : ""}${d.year ? ` (${d.year})` : ""}${summary}`);
    }
  }

  if ((notes ?? []).length) {
    lines.push("\nNotes:");
    for (const n of notes!) {
      lines.push(`- ${n.note_date}: ${String(n.body).slice(0, 500)}`);
    }
  }

  const text = lines.join("\n");
  // Fingerprint the salient content (the prompt text is deterministic given the
  // data — no timestamps of "now" in it), so an idempotent regen is cheap.
  const fingerprint = createHash("sha256").update(`${OVERVIEW_MODEL}\n${text}`).digest("hex");
  const hasSubstance =
    (docs ?? []).length > 0 || (txns ?? []).length > 0 || (transfers ?? []).length > 0 || (notes ?? []).length > 0;

  return { text, fingerprint, hasSubstance };
}

/**
 * Generate (or refresh) an investment's overview and persist it. Clears the
 * stale flag. Skips the LLM call when the fingerprint is unchanged (unless
 * `force`). Throws on API/DB error so the worker can count the attempt.
 */
export async function generateInvestmentOverview(
  db: SupabaseClient,
  orgId: string,
  investmentId: string,
  opts: { force?: boolean } = {},
): Promise<OverviewResult> {
  const ctx = await assembleInvestmentContext(db, orgId, investmentId);
  if (!ctx) return { overview: null, skipped: true };
  return generateOverview(db, {
    table: "investments",
    resourceId: investmentId,
    orgId,
    surface: "investment_overview",
    resourceType: "investment",
    systemPrompt: SYSTEM_PROMPT,
    context: ctx,
    force: opts.force,
  });
}

/** Flag investments for regeneration (app-side callers; triggers cover the DB). */
export async function markInvestmentOverviewStale(
  db: SupabaseClient,
  investmentIds: string[],
): Promise<void> {
  return markOverviewStale(db, "investments", investmentIds);
}
