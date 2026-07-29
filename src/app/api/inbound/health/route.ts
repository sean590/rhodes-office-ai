import { NextResponse } from "next/server";
import { createOrgClient } from "@/lib/supabase/org-client";
import { requireOrg, isError } from "@/lib/utils/org-context";

// GET /api/inbound/health — the Settings → Mailbox connection card:
// poll health (Connected / Connection problem / Not connected) + counters.
export async function GET() {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;
    const db = createOrgClient(orgId);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [{ data: state }, { count: monthEmails }, { data: monthDocs }, { count: waiting }] = await Promise.all([
      db.from("inbound_mail_state").select("last_success_at, last_error, mailbox_address, updated_at").maybeSingle(),
      db
        .from("inbound_deliveries")
        .select("id", { count: "exact", head: true })
        .gte("received_at", monthStart.toISOString()),
      db
        .from("inbound_deliveries")
        .select("document_ids")
        .in("status", ["ingested", "retrieved", "resolved"])
        .gte("received_at", monthStart.toISOString()),
      db
        .from("inbound_deliveries")
        .select("id", { count: "exact", head: true })
        .in("status", ["needs_user", "acknowledged"]),
    ]);

    const docsFiled = (monthDocs ?? []).reduce(
      (n: number, r: { document_ids: string[] | null }) => n + (r.document_ids?.length ?? 0),
      0,
    );

    // Not connected = no state row has ever been written (mailbox never polled).
    const status = !state
      ? "not_connected"
      : state.last_error
        ? "problem"
        : "connected";

    return NextResponse.json({
      status,
      last_success_at: state?.last_success_at ?? null,
      mailbox_address: state?.mailbox_address ?? null,
      last_error: state?.last_error ?? null,
      counters: {
        emails_this_month: monthEmails ?? 0,
        documents_filed: docsFiled,
        waiting_on_you: waiting ?? 0,
      },
    });
  } catch (err) {
    console.error("GET /api/inbound/health error:", err);
    return NextResponse.json({ error: "Failed to load mailbox health" }, { status: 500 });
  }
}
