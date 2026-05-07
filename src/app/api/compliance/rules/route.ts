import { NextResponse } from "next/server";
import { COMPLIANCE_RULES } from "@/lib/data/compliance-rules";
import { requireOrg, isError } from "@/lib/utils/org-context";

export async function GET() {
  const ctx = await requireOrg();
  if (isError(ctx)) return ctx;

  const rules = COMPLIANCE_RULES.map((r) => ({
    id: r.id,
    jurisdiction: r.jurisdiction,
    entity_types: r.entity_types,
    obligation_type: r.obligation_type,
    name: r.name,
    description: r.description,
    frequency: r.frequency,
    filed_with: r.filed_with,
  }));

  return NextResponse.json(rules);
}
