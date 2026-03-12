import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { runInferenceEngine, promoteToTemplate } from "@/lib/utils/inference-engine";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { headers } from "next/headers";

/**
 * GET /api/patterns
 * Returns detected patterns for the current org.
 */
export async function GET() {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;

    const admin = createAdminClient();

    const { data: patterns, error } = await admin
      .from("org_document_patterns")
      .select("*")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .gte("confidence", 0.7)
      .order("confidence", { ascending: false });

    if (error) {
      console.error("GET patterns error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Get entity names for display
    const entityIds = new Set<string>();
    for (const p of patterns || []) {
      const evidence = p.evidence as { entities_with?: string[]; entities_without?: string[] };
      for (const id of evidence.entities_with || []) entityIds.add(id);
      for (const id of evidence.entities_without || []) entityIds.add(id);
    }

    const entityNames: Record<string, string> = entityIds.size > 0
      ? await (async () => {
          const { data: entities } = await admin
            .from("entities")
            .select("id, name")
            .in("id", [...entityIds]);
          return Object.fromEntries((entities || []).map((e: { id: string; name: string }) => [e.id, e.name]));
        })()
      : {};

    return NextResponse.json({ patterns: patterns || [], entityNames });
  } catch (err) {
    console.error("GET /api/patterns error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/patterns
 * Actions: "run" (trigger inference), "promote" (create template from pattern), "dismiss" (deactivate pattern)
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const body = await request.json();
    const action = body.action as string;
    const admin = createAdminClient();

    if (action === "run") {
      const result = await runInferenceEngine(orgId);
      return NextResponse.json({
        success: true,
        patterns_found: result.patterns.length,
        diagnostics: result.diagnostics,
      });
    }

    if (action === "promote") {
      const { pattern_id } = body;
      if (!pattern_id) return NextResponse.json({ error: "pattern_id required" }, { status: 400 });

      const templateId = await promoteToTemplate(pattern_id, orgId, user.id);
      if (!templateId) {
        return NextResponse.json({ error: "Failed to promote pattern" }, { status: 500 });
      }

      const reqHeaders = await headers();
      const reqCtx = getRequestContext(reqHeaders, orgId);
      await logAuditEvent({
        userId: user.id,
        action: "promote_pattern",
        resourceType: "org_document_pattern",
        resourceId: pattern_id,
        metadata: { template_id: templateId },
        ...reqCtx,
      });

      return NextResponse.json({ success: true, template_id: templateId });
    }

    if (action === "dismiss") {
      const { pattern_id } = body;
      if (!pattern_id) return NextResponse.json({ error: "pattern_id required" }, { status: 400 });

      await admin
        .from("org_document_patterns")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", pattern_id)
        .eq("organization_id", orgId);

      const reqHeaders = await headers();
      const reqCtx = getRequestContext(reqHeaders, orgId);
      await logAuditEvent({
        userId: user.id,
        action: "dismiss_pattern",
        resourceType: "org_document_pattern",
        resourceId: pattern_id,
        ...reqCtx,
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("POST /api/patterns error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
