import { NextResponse } from "next/server";
import { createOrgClient } from "@/lib/supabase/org-client";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { headers } from "next/headers";
import { getMessage } from "@/lib/inbound/gmail";
import { reprocessInboundMessage } from "@/lib/inbound/worker";

// Attachment download + storage upload run inline (the caller needs the new
// classification back); extraction itself still defers to the queue sweeper.
export const maxDuration = 120;

// POST /api/inbound/[id]/reprocess — two user-correction actions on one route:
//
//  default (no body / mode "teach") — "This is a delivery" (ui-spec §3c):
//    learns the sender's domain as a delivery sender, then re-runs triage on
//    the original Gmail message so it files this time.
//
//  mode "force_ingest" — "File it anyway": releases a HELD row (sender failed
//    authentication, or the daily flood cap) and files it. The user's explicit
//    review is the verification the hold was buying. Deliberately does NOT
//    learn the sender — spoofed mail must not whitelist a domain.
//
// Deliberately no MCP tool parity: these are UI correction controls on the
// Settings mailbox surface, not chat capabilities.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const force = body?.mode === "force_ingest";

    // Org-scoped load. Teach targets recently skipped rows; force targets held
    // ones. Purged stubs (sender stripped) can't do either.
    const db = createOrgClient(orgId);
    const { data: row, error } = await db
      .from("inbound_deliveries")
      .select("id, sender, gmail_message_id, status")
      .eq("id", id)
      .in("status", force ? ["needs_user", "acknowledged"] : ["ignored"])
      .not("sender", "is", null)
      .maybeSingle();
    if (error) throw error;
    if (!row) {
      return NextResponse.json(
        {
          error: force
            ? "Not found — only held emails can be force-filed"
            : "Not found — only recently skipped emails can be reprocessed",
        },
        { status: 404 },
      );
    }

    const sender = row.sender as string;
    const domain = sender.split("@").pop()?.toLowerCase() ?? "";
    if (!domain) {
      return NextResponse.json({ error: "Sender address is malformed" }, { status: 400 });
    }

    const admin = createAdminClient();
    if (!force) {
      // Learn the sender first (admin client — the table has no authenticated
      // write policy). Overwrites a prior 'not_provider' suppression by design:
      // the user's explicit correction wins.
      const { error: upsertErr } = await admin
        .from("inbound_delivery_senders")
        .upsert(
          { organization_id: orgId, domain, kind: "delivery", learned_from: row.id },
          { onConflict: "organization_id,domain" },
        );
      if (upsertErr) throw upsertErr;
    }

    const msg = await getMessage(row.gmail_message_id as string);
    if (!msg) {
      return NextResponse.json(
        { error: "That email is no longer in the mailbox, so it can't be reprocessed" + (force ? "." : " — but Rhodes has learned the sender for next time.") },
        { status: 404 },
      );
    }

    // gmail_message_id is UNIQUE — the old row must go before the worker can
    // re-insert and dispatch.
    const { error: delErr } = await admin
      .from("inbound_deliveries")
      .delete()
      .eq("id", row.id)
      .eq("organization_id", orgId);
    if (delErr) throw delErr;

    const { deliveryId, status } = await reprocessInboundMessage(admin, orgId, msg, { force });

    if (!force && deliveryId) {
      // The delete SET-NULLed learned_from — repoint it at the fresh row.
      await admin
        .from("inbound_delivery_senders")
        .update({ learned_from: deliveryId })
        .eq("organization_id", orgId)
        .eq("domain", domain);
    }

    const reqCtx = getRequestContext(await headers(), orgId);
    await logAuditEvent({
      userId: user.id,
      action: force ? "inbound_force_filed" : "inbound_taught",
      resourceType: "inbound_delivery",
      resourceId: deliveryId ?? row.id,
      metadata: { sender, domain, classification: status },
      ...reqCtx,
    });

    return NextResponse.json({ reprocessed: true, classification: status });
  } catch (err) {
    console.error("POST /api/inbound/[id]/reprocess error:", err);
    return NextResponse.json({ error: "Failed to reprocess the email" }, { status: 500 });
  }
}
