/**
 * AI-generated entity overviews (migration 086) — the entity counterpart of
 * investment-overview.ts, on the shared ai-overview-core engine.
 *
 * A model-written briefing that reads the entity's substance — what it is, the
 * investments it holds, its documents (their AI extractions), notes, compliance
 * obligations (due/overdue), and governance (members/managers/registrations) —
 * so anyone landing on the record instantly understands its state and what
 * needs attention.
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

const SYSTEM_PROMPT = `You write a concise briefing about a single legal entity (LLC, trust, corporation, partnership, etc.) for a family office, so anyone landing on the record instantly understands what it is and what's going on with it.

Rules:
- 2-4 sentences. No preamble, no headings, no bullet points — just the briefing prose.
- Say what the entity IS (its role: a holding company, a family trust, an operating LLC) and LEAD with anything that needs attention or recently changed — an overdue or upcoming filing, a governance change, a newly filed document, a change in what it holds. Be concrete: cite jurisdictions, dates, amounts, percentages when the data has them.
- Only state what the provided data supports. Never invent facts. If little is known, say plainly what the entity is and that little activity is recorded yet.
- Write in plain English for a smart reader who isn't steeped in the structure. Present tense for current state; past tense for what happened.
- Do not restate raw schema ("status: active, type: llc"). Say what it MEANS.`;

function fmtMoney(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n ?? "");
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/**
 * Pull the entity's substance into a compact prompt context + a fingerprint.
 * Returns null if the entity isn't in this org.
 */
export async function assembleEntityContext(
  db: SupabaseClient,
  orgId: string,
  entityId: string,
): Promise<AssembledContext | null> {
  const { data: ent } = await db
    .from("entities")
    .select("id, name, type, status, legal_structure, formation_state, formed_date, ein, registered_agent, notes, parent_entity_id")
    .eq("id", entityId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!ent) return null;

  const [{ data: parent }, { data: members }, { data: managers }, { data: registrations }, { data: obligations }, { data: capTable }, { data: invLinks }] =
    await Promise.all([
      ent.parent_entity_id
        ? db.from("entities").select("name").eq("id", ent.parent_entity_id).maybeSingle()
        : Promise.resolve({ data: null }),
      db.from("entity_members").select("name").eq("entity_id", entityId),
      db.from("entity_managers").select("name").eq("entity_id", entityId),
      db.from("entity_registrations").select("jurisdiction, last_filing_date").eq("entity_id", entityId),
      db.from("compliance_obligations").select("name, obligation_type, jurisdiction, next_due_date, status").eq("entity_id", entityId).order("next_due_date", { ascending: true }),
      db.from("cap_table_entries").select("investor_name, investor_type, ownership_pct, capital_contributed").eq("entity_id", entityId),
      db.from("investment_investors").select("capital_pct, committed_capital, is_active, investments:investment_id(name, status)").eq("entity_id", entityId).eq("is_active", true),
    ]);

  const { data: docs } = await db
    .from("documents")
    .select("id, name, document_type, year, created_at, ai_extraction")
    .eq("entity_id", entityId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(MAX_DOCS);

  const { data: noteLinks } = await db
    .from("note_links")
    .select("note_id")
    .eq("entity_id", entityId)
    .not("note_id", "is", null);
  const noteIds = (noteLinks ?? []).map((l) => l.note_id as string);
  const { data: notes } = noteIds.length
    ? await db.from("notes").select("id, body, note_date").in("id", noteIds).order("note_date", { ascending: false }).limit(MAX_NOTES)
    : { data: [] as Array<Record<string, unknown>> };

  // ---- Build the prompt text ----
  const lines: string[] = [];
  lines.push(`Entity: ${ent.name}`);
  lines.push(`Type: ${ent.type}${ent.legal_structure ? ` (${ent.legal_structure})` : ""} · Status: ${ent.status}`);
  if (ent.formation_state || ent.formed_date) {
    lines.push(`Formed${ent.formed_date ? ` ${ent.formed_date}` : ""}${ent.formation_state ? ` in ${ent.formation_state}` : ""}`);
  }
  if (parent && (parent as { name?: string }).name) lines.push(`Parent entity: ${(parent as { name: string }).name}`);
  if (ent.registered_agent) lines.push(`Registered agent: ${ent.registered_agent}`);
  if (ent.notes) lines.push(`Notes field: ${String(ent.notes).slice(0, 300)}`);

  if ((members ?? []).length) lines.push(`\nMembers: ${(members ?? []).map((m) => m.name).filter(Boolean).join(", ")}`);
  if ((managers ?? []).length) lines.push(`Managers: ${(managers ?? []).map((m) => m.name).filter(Boolean).join(", ")}`);

  if ((registrations ?? []).length) {
    lines.push("\nRegistrations:");
    for (const r of registrations!) lines.push(`- ${r.jurisdiction}${r.last_filing_date ? ` (last filing ${r.last_filing_date})` : ""}`);
  }

  if ((obligations ?? []).length) {
    lines.push("\nCompliance obligations:");
    for (const o of obligations!) {
      lines.push(`- ${o.name || o.obligation_type}${o.jurisdiction ? ` [${o.jurisdiction}]` : ""} — due ${o.next_due_date ?? "n/a"}, status ${o.status ?? "n/a"}`);
    }
  }

  if ((invLinks ?? []).length) {
    lines.push("\nInvestments held:");
    for (const il of invLinks!) {
      const inv = il.investments as { name?: string; status?: string } | null;
      const parts = [
        il.capital_pct != null ? `${Number(il.capital_pct)}% capital` : null,
        il.committed_capital != null ? `${fmtMoney(il.committed_capital)} committed` : null,
      ].filter(Boolean);
      lines.push(`- ${inv?.name ?? "Unknown"}${inv?.status ? ` (${inv.status})` : ""}${parts.length ? ` — ${parts.join(", ")}` : ""}`);
    }
  }

  if ((capTable ?? []).length) {
    lines.push("\nCap table:");
    for (const c of capTable!) {
      lines.push(`- ${c.investor_name ?? "Unknown"}${c.ownership_pct != null ? ` — ${Number(c.ownership_pct)}%` : ""}${c.capital_contributed != null ? ` (${fmtMoney(c.capital_contributed)})` : ""}`);
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
    for (const n of notes!) lines.push(`- ${n.note_date}: ${String(n.body).slice(0, 500)}`);
  }

  const text = lines.join("\n");
  const fingerprint = createHash("sha256").update(`${OVERVIEW_MODEL}\n${text}`).digest("hex");
  const hasSubstance =
    (docs ?? []).length > 0 || (invLinks ?? []).length > 0 || (obligations ?? []).length > 0 || (notes ?? []).length > 0;

  return { text, fingerprint, hasSubstance };
}

/** Generate (or refresh) an entity's overview and persist it. */
export async function generateEntityOverview(
  db: SupabaseClient,
  orgId: string,
  entityId: string,
  opts: { force?: boolean } = {},
): Promise<OverviewResult> {
  const ctx = await assembleEntityContext(db, orgId, entityId);
  if (!ctx) return { overview: null, skipped: true };
  return generateOverview(db, {
    table: "entities",
    resourceId: entityId,
    orgId,
    surface: "entity_overview",
    resourceType: "entity",
    systemPrompt: SYSTEM_PROMPT,
    context: ctx,
    force: opts.force,
  });
}

/** Flag entities for regeneration (app-side callers; triggers cover the DB). */
export async function markEntityOverviewStale(db: SupabaseClient, entityIds: string[]): Promise<void> {
  return markOverviewStale(db, "entities", entityIds);
}
