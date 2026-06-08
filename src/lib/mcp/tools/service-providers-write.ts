/**
 * Service-provider write tools (Phase 1 routing hub) — 5 tools.
 * create/update/delete_service_provider, link/unlink_provider_entity.
 *
 * All are pure-DB mutations → each handler routes through `dispatchAction`
 * into apply.ts (the single source of truth for writes). The send tool
 * (`send_document_to_provider`) lives in M4 — it touches storage+email and
 * does NOT go through apply.ts. Mirrors directory-write.ts.
 */

import { z } from "zod";
import { defineTool, type ToolDefinition } from "../schema";
import { verifyResourceOwnership } from "../ownership";
import { dispatchAction } from "../apply-dispatch";
import { resolveName } from "../resolve-names";
import { sendDocumentToProvider } from "@/lib/providers/send-document";
import { ToolError } from "../tool-helpers";

const providerContactSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.string().optional(),
  is_default: z.boolean().optional(),
});

export const createServiceProviderTool = defineTool({
  name: "create_service_provider",
  description:
    "Create a service provider firm (CPA, bookkeeper, attorney, registered agent, trustee, etc.). Recognized by email domain and linked to the entities it serves.",
  kind: "write",
  inputSchema: z.object({
    name: z.string().min(1),
    disciplines: z.array(z.string()).optional(),
    domains: z.array(z.string()).optional(),
    contacts: z.array(providerContactSchema).optional(),
    default_contact_email: z.string().email().optional().nullable(),
    serves_all_entities: z.boolean().optional(),
    directory_entry_id: z.string().uuid().optional().nullable(),
    notes: z.string().optional().nullable(),
  }),
  dryRun: async (input) => ({
    summary: `Create service provider: ${input.name}`,
    preview: input,
  }),
  handler: async (input, ctx) => {
    const result = await dispatchAction(ctx, "create_service_provider", input);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

export const updateServiceProviderTool = defineTool({
  name: "update_service_provider",
  description: "Update a service provider's name, disciplines, domains, contacts, default recipient, serves_all_entities flag, or notes.",
  kind: "write",
  inputSchema: z.object({
    provider_id: z.string().uuid(),
    name: z.string().optional(),
    disciplines: z.array(z.string()).optional(),
    domains: z.array(z.string()).optional(),
    contacts: z.array(providerContactSchema).optional(),
    default_contact_email: z.string().email().optional().nullable(),
    serves_all_entities: z.boolean().optional(),
    directory_entry_id: z.string().uuid().optional().nullable(),
    notes: z.string().optional().nullable(),
  }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "service_provider", resourceId: input.provider_id });
    const name = await resolveName(ctx, "service_provider", input.provider_id);
    return { summary: `Update service provider "${name}"` };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "service_provider", resourceId: input.provider_id });
    const result = await dispatchAction(ctx, "update_service_provider", input);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

export const deleteServiceProviderTool = defineTool({
  name: "delete_service_provider",
  description: "Soft-delete a service provider. It no longer appears in lists or suggestions; past sends are retained.",
  kind: "write",
  inputSchema: z.object({ provider_id: z.string().uuid() }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "service_provider", resourceId: input.provider_id });
    const name = await resolveName(ctx, "service_provider", input.provider_id);
    return { summary: `Delete service provider "${name}"` };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "service_provider", resourceId: input.provider_id });
    const result = await dispatchAction(ctx, "delete_service_provider", input);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

export const linkProviderEntityTool = defineTool({
  name: "link_provider_entity",
  description: "Link a service provider to an entity it serves. Idempotent — linking an already-linked entity is a no-op.",
  kind: "write",
  inputSchema: z.object({
    provider_id: z.string().uuid(),
    entity_id: z.string().uuid(),
  }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "service_provider", resourceId: input.provider_id });
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const providerName = await resolveName(ctx, "service_provider", input.provider_id);
    const entityName = await resolveName(ctx, "entity", input.entity_id);
    return { summary: `Link "${entityName}" to provider "${providerName}"` };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "service_provider", resourceId: input.provider_id });
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const result = await dispatchAction(ctx, "link_provider_entity", input);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

export const unlinkProviderEntityTool = defineTool({
  name: "unlink_provider_entity",
  description: "Remove the link between a service provider and an entity it no longer serves.",
  kind: "write",
  inputSchema: z.object({
    provider_id: z.string().uuid(),
    entity_id: z.string().uuid(),
  }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "service_provider", resourceId: input.provider_id });
    const providerName = await resolveName(ctx, "service_provider", input.provider_id);
    const entityName = await resolveName(ctx, "entity", input.entity_id);
    return { summary: `Unlink "${entityName}" from provider "${providerName}"` };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "service_provider", resourceId: input.provider_id });
    const result = await dispatchAction(ctx, "unlink_provider_entity", input);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

// send_document_to_provider is NOT an apply.ts action — it touches Storage +
// email — so its handler calls the shared send service directly rather than
// dispatchAction. dryRun verifies ownership + a resolvable recipient (no send).
export const sendDocumentToProviderTool = defineTool({
  name: "send_document_to_provider",
  description:
    "Send one or more documents Rhodes already holds to a service provider as a single secure, expiring link (no attachment). The recipient defaults to the provider's default contact if not given. Logs the send.",
  kind: "write",
  inputSchema: z.object({
    document_ids: z.array(z.string().uuid()).min(1),
    provider_id: z.string().uuid(),
    recipient_email: z.string().email().optional().nullable(),
    subject: z.string().optional().nullable(),
    message: z.string().optional().nullable(),
  }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "service_provider", resourceId: input.provider_id });
    for (const docId of input.document_ids) {
      await verifyResourceOwnership(ctx, { resourceType: "document", resourceId: docId });
    }

    const [{ data: provider }, { data: docs }] = await Promise.all([
      ctx.supabase
        .from("service_providers")
        .select("name, default_contact_email, contacts")
        .eq("id", input.provider_id)
        .eq("organization_id", ctx.orgId)
        .is("deleted_at", null)
        .maybeSingle(),
      ctx.supabase
        .from("documents")
        .select("name")
        .in("id", input.document_ids)
        .eq("organization_id", ctx.orgId),
    ]);

    // Resolve recipient the same way the send service will.
    type Contact = { email?: string; is_default?: boolean };
    const contacts: Contact[] = (provider?.contacts as Contact[]) ?? [];
    const recipient =
      (input.recipient_email && input.recipient_email.trim()) ||
      (provider?.default_contact_email && provider.default_contact_email.trim()) ||
      contacts.find((c) => c.is_default && c.email?.trim())?.email?.trim() ||
      contacts.find((c) => c.email?.trim())?.email?.trim() ||
      null;

    if (!recipient) {
      throw new ToolError(
        "validation_failed",
        `No recipient email for provider "${provider?.name ?? input.provider_id}" — pass recipient_email or set a default contact.`,
      );
    }

    const count = input.document_ids.length;
    const what = count === 1 ? `"${docs?.[0]?.name ?? "document"}"` : `${count} documents`;
    return {
      summary: `Send ${what} to ${provider?.name ?? "provider"} (${recipient})`,
      preview: { ...input, resolved_recipient: recipient },
    };
  },
  handler: async (input, ctx) => {
    const { data } = await sendDocumentToProvider(
      {
        document_ids: input.document_ids,
        provider_id: input.provider_id,
        recipient_email: input.recipient_email,
        subject: input.subject,
        message: input.message,
      },
      { orgId: ctx.orgId, userId: ctx.userId },
    );
    return { data, audit_event_id: data.id };
  },
});

export const revokeProviderSendTool = defineTool({
  name: "revoke_provider_send",
  description:
    "Revoke a secure document share link that was sent to a provider. The link immediately stops working; past access is retained in the log.",
  kind: "write",
  inputSchema: z.object({ send_id: z.string().uuid() }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "provider_document_send", resourceId: input.send_id });
    return { summary: "Revoke this secure share link" };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "provider_document_send", resourceId: input.send_id });
    const result = await dispatchAction(ctx, "revoke_provider_send", input);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

export const dismissSendSuggestionTool = defineTool({
  name: "dismiss_send_suggestion",
  description:
    "Dismiss a proactive 'Suggested send' so it won't resurface, and decay the learned routing rule (teaches Rhodes you don't route these documents to this provider).",
  kind: "write",
  inputSchema: z.object({
    provider_id: z.string().uuid(),
    document_ids: z.array(z.string().uuid()).min(1),
  }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "service_provider", resourceId: input.provider_id });
    const name = await resolveName(ctx, "service_provider", input.provider_id);
    return { summary: `Dismiss sending ${input.document_ids.length} document(s) to "${name}"` };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "service_provider", resourceId: input.provider_id });
    const result = await dispatchAction(ctx, "dismiss_send_suggestion", input);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

export const serviceProviderWriteTools: ToolDefinition[] = [
  createServiceProviderTool,
  updateServiceProviderTool,
  deleteServiceProviderTool,
  linkProviderEntityTool,
  unlinkProviderEntityTool,
  sendDocumentToProviderTool,
  revokeProviderSendTool,
  dismissSendSuggestionTool,
];
