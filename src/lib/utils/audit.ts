import { createAdminClient } from "@/lib/supabase/admin";

interface AuditEvent {
  userId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
  sessionId?: string | null;
  organizationId?: string | null;
}

export async function logAuditEvent(event: AuditEvent): Promise<void> {
  try {
    const supabase = createAdminClient();
    await supabase.from("audit_log").insert({
      user_id: event.userId,
      action: event.action,
      resource_type: event.resourceType,
      resource_id: event.resourceId ?? null,
      metadata: event.metadata ?? {},
      ip_address: event.ipAddress ?? null,
      user_agent: event.userAgent ?? null,
      session_id: event.sessionId ?? null,
      organization_id: event.organizationId ?? null,
    });
  } catch (err) {
    console.error("[AUDIT] Failed to log event:", err, event);
    // Never throw — audit failures must not block the primary operation
  }
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
