import { createAdminClient } from "@/lib/supabase/admin";
import { invalidateAllOrgCaches } from "./org-data";

interface AuditEvent {
  userId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  entityId?: string | null;
  investmentId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
  sessionId?: string | null;
  organizationId?: string | null;
}

export async function logAuditEvent(event: AuditEvent): Promise<void> {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("audit_log").insert({
      user_id: event.userId,
      action: event.action,
      resource_type: event.resourceType,
      resource_id: event.resourceId ?? null,
      entity_id: event.entityId ?? null,
      investment_id: event.investmentId ?? null,
      metadata: event.metadata ?? {},
      ip_address: event.ipAddress ?? null,
      user_agent: event.userAgent ?? null,
      session_id: event.sessionId ?? null,
      organization_id: event.organizationId ?? null,
    });
    if (error) {
      console.error("[AUDIT] Insert failed:", error.message, error.code, error.details, event);
    }

    // Invalidate caches for this org — fire and forget
    if (event.organizationId) {
      invalidateAllOrgCaches(event.organizationId).catch((err) =>
        console.error("[AUDIT] Cache invalidation failed:", err)
      );
    }
  } catch (err) {
    console.error("[AUDIT] Failed to log event:", err, event);
    // Never throw — audit failures must not block the primary operation
  }
}

// --- Field label utilities for activity log ---

const FIELD_LABELS: Record<string, string> = {
  formation_state: "Formation State",
  formed_date: "Formation Date",
  ein: "EIN",
  name: "Name",
  short_name: "Short Name",
  type: "Entity Type",
  status: "Status",
  investment_type: "Investment Type",
  capital_pct: "Capital %",
  profit_pct: "Profit %",
  preferred_return_pct: "Preferred Return %",
  preferred_return_basis: "Preferred Return Basis",
  date_invested: "Date Invested",
  date_exited: "Date Exited",
  description: "Description",
  formation_state_: "Formation State",
  registered_agent: "Registered Agent",
  address: "Address",
  business_purpose: "Business Purpose",
  legal_structure: "Legal Structure",
  allocation_pct: "Allocation %",
  committed_amount: "Committed Amount",
  ownership_pct: "Ownership %",
  filing_status: "Filing Status",
  end_date: "End Date",
};

export function humanizeField(field: string): string {
  return FIELD_LABELS[field] || field.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
}

export function buildChanges(
  existing: Record<string, unknown>,
  updates: Record<string, unknown>
): Array<{ field: string; from: unknown; to: unknown }> {
  return Object.keys(updates)
    .filter((key) => existing[key] !== updates[key])
    .map((key) => ({
      field: humanizeField(key),
      from: existing[key] ?? null,
      to: updates[key] ?? null,
    }));
}

export function getRequestContext(headers: Headers, organizationId?: string) {
  return {
    ipAddress:
      headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      headers.get("x-real-ip") ??
      null,
    userAgent: headers.get("user-agent") ?? null,
    ...(organizationId ? { organizationId } : {}),
  };
}
