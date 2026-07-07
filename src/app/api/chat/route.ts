/**
 * POST /api/chat — the MCP tool-use chat endpoint.
 *
 * This is the only chat endpoint post-Phase-3 cutover. The legacy JSON-action-
 * block chat path has been removed.
 *
 * TODO: streaming response (deferred from Phase 1; non-streaming JSON for now).
 */

import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { chatMessageSchema } from "@/lib/validations";
import {
  runOrchestratorStreaming,
  type OrchestratorMessage,
  type OrchestratorResult,
  type AnthropicClientLike,
} from "@/lib/mcp/orchestrator";
import type { StreamEvent } from "@/lib/mcp/stream-events";
import { redact } from "@/lib/mcp/redact";
import { contentBlocksForTurn } from "@/lib/mcp/document-content";

const anthropic = new Anthropic() as unknown as AnthropicClientLike;

export async function POST(request: Request) {
  const org = await requireOrg();
  if (isError(org)) return org;
  const { user, orgId } = org;

  const body = await request.json().catch(() => ({}));
  const parsed = chatMessageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "invalid request body" },
      { status: 400 },
    );
  }
  const { session_id, message, page_context, attachments } = parsed.data;

  const admin = createAdminClient();
  const supabase = await createClient();

  // Verify the session belongs to this org before persisting anything.
  const { data: sessionRow, error: sessionErr } = await admin
    .from("chat_sessions")
    .select("id, organization_id, title")
    .eq("id", session_id)
    .maybeSingle();
  if (sessionErr) {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
  if (!sessionRow || sessionRow.organization_id !== orgId) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  // Persist the user message first. Include attachment metadata for audit/replay
  // — the attachment content blocks are NOT persisted (they're rebuilt from
  // Storage on replay). This keeps message storage small even for large PDFs.
  await admin.from("chat_messages").insert({
    session_id,
    role: "user",
    content: message,
    metadata: attachments?.length
      ? {
          attachments: attachments.map((a) => ({
            filename: a.filename,
            content_type: a.content_type,
            size: a.size,
            storage_path: a.storage_path,
            batch_id: a.batch_id,
            document_id: a.document_id,
          })),
        }
      : undefined,
  });

  // Auto-name the session from the first user message. The big chat
  // overhaul (cf8c608) accidentally dropped this branch; sessions had been
  // sticking at the default "New Chat" since. We trigger on title still
  // being the default rather than on history length so an explicitly
  // pre-named session (e.g. created from /review with a templated title)
  // doesn't get overwritten.
  if ((sessionRow.title ?? "New Chat") === "New Chat") {
    const titleSource = message.trim();
    if (titleSource.length > 0) {
      const title =
        titleSource.length > 50 ? titleSource.slice(0, 50) + "…" : titleSource;
      await admin
        .from("chat_sessions")
        .update({ title, updated_at: new Date().toISOString() })
        .eq("id", session_id);
    }
  }

  // Load history (oldest first). The orchestrator truncates at the API
  // boundary; the DB keeps the full thread for audit/replay.
  const { data: historyRows } = await supabase
    .from("chat_messages")
    .select("role, content")
    .eq("session_id", session_id)
    .order("created_at", { ascending: true });

  // Drop the just-inserted user message from history — the orchestrator
  // receives it via `userMessage` instead to control where page_context gets
  // injected and to avoid double-sending.
  //
  // Guard: verify the tail really is the user message we just wrote. A
  // concurrent request on the same session could interleave a different
  // row at the tail; blindly slicing `-1` would drop someone else's turn.
  // If the tail doesn't match, warn and pass history as-is — a duplicated
  // user message in the prompt is a strictly less bad failure than losing
  // a real turn. This is a safety net, not a concurrency solution.
  const allHistory = (historyRows ?? []) as Array<{ role: string; content: string }>;
  const tail = allHistory[allHistory.length - 1];
  const tailIsOurs = tail?.role === "user" && tail?.content === message;
  if (!tailIsOurs && allHistory.length > 0) {
    console.warn("[mcp] history tail mismatch", { session_id });
  }
  const priorHistory = tailIsOurs ? allHistory.slice(0, -1) : allHistory;
  const history: OrchestratorMessage[] = priorHistory.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));

  // Build content blocks for any file attachments. Non-fatal: if a PDF fails
  // to parse, Claude still gets the text message and can ask the user to retry.
  let attachmentBlocks: Array<Record<string, unknown>> | undefined;
  if (attachments?.length) {
    try {
      attachmentBlocks = await contentBlocksForTurn(attachments);
    } catch (err) {
      console.error("[mcp] attachment processing failed", { session_id, error: err });
    }
  }

  // Build the recent_uploads context block. Aggregates this turn's attachments
  // plus any from earlier turns in the session (capped) so the orchestrator
  // has authoritative document_id references at the top of the prompt — not
  // buried in preamble text inside older messages. Targets the UUID-
  // hallucination class of bug we saw on the LADD Holdings link: the model
  // grabbed a doc_id that didn't exist because the real one was in turn 1's
  // preamble and turn 2 had to reach back into history to find it.
  const recentUploads = await buildRecentUploadsBlock(admin, session_id, attachments);

  // Build user identity for "me"/"my" resolution.
  const userIdentityBlock: {
    name: string;
    email: string;
    orgName: string;
    primaryEntityId?: string;
    primaryEntityName?: string;
  } = {
    name: user.display_name || user.email,
    email: user.email,
    orgName: user.orgName,
  };
  try {
    const { data: profile } = await admin
      .from("user_profiles")
      .select("primary_entity_id")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.primary_entity_id) {
      const { data: entity } = await admin
        .from("entities")
        .select("id, name")
        .eq("id", profile.primary_entity_id)
        .eq("organization_id", orgId)
        .maybeSingle();
      if (entity) {
        userIdentityBlock.primaryEntityId = entity.id;
        userIdentityBlock.primaryEntityName = entity.name;
      }
    }
  } catch { /* non-fatal */ }

  // SSE streaming response. The orchestrator yields events as it processes;
  // each event becomes an SSE frame. The assistant message is persisted once
  // after the stream completes (not during).
  //
  // NOTE: file uploads still go through a non-streaming path — the chat
  // drawer handles them with a separate fetch to the pipeline batch API,
  // then calls this endpoint for the text + attachment-blocks turn.
  const encoder = new TextEncoder();

  const sseStream = new ReadableStream({
    async start(controller) {
      const enqueue = (event: StreamEvent) => {
        controller.enqueue(
          encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
        );
      };

      try {
        let finalResult: OrchestratorResult | undefined;

        // Stream all events EXCEPT done — hold done until after DB persist
        // so we can include the real message ID in the done payload.
        for await (const event of runOrchestratorStreaming({
          ctx: {
            userId: user.id,
            orgId,
            orgRole: user.orgRole,
            sessionId: session_id,
            supabase: admin,
            redact,
          },
          userMessage: message,
          history,
          attachmentBlocks,
          pageContext: page_context ?? null,
          recentUploads,
          userIdentity: userIdentityBlock,
          anthropic,
        })) {
          if (event.type === "done") {
            finalResult = event;
          } else {
            enqueue(event);
          }
        }

        // Persist assistant message, then emit done with the real DB ID.
        if (finalResult) {
          const { data: savedMsg } = await admin.from("chat_messages").insert({
            session_id,
            role: "assistant",
            content: finalResult.text,
            metadata: {
              tool_calls: finalResult.toolCalls.map((c) => ({
                name: c.name,
                arg_keys: Object.keys(c.args),
                ok: c.ok,
                duration_ms: c.durationMs,
                ...(c.error ? { error: c.error } : {}),
              })),
              iterations: finalResult.iterations,
              truncated: finalResult.truncated,
              stop_reason: finalResult.stopReason,
              staged_actions:
                finalResult.stagedActions.length > 0
                  ? finalResult.stagedActions
                  : undefined,
              mcp_chat: true,
              // Cost telemetry — chat runs on Opus, a material cost center.
              // Measured here so we can track chat cost alongside ingestion.
              cost_usd: finalResult.costUsd,
              usage: finalResult.usage,
              model: finalResult.model,
            },
          }).select("id").single();
          await admin
            .from("chat_sessions")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", session_id);

          // Emit done with the persisted message ID.
          enqueue({
            type: "done",
            text: finalResult.text,
            toolCalls: finalResult.toolCalls,
            stagedActions: finalResult.stagedActions,
            iterations: finalResult.iterations,
            truncated: finalResult.truncated,
            stopReason: finalResult.stopReason,
            messageId: savedMsg?.id ?? undefined,
          });
        }
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : String(err);
        console.error("[mcp] stream error", { session_id, error: errMessage });
        enqueue({ type: "error", message: "Something went wrong — please try again." });
        await admin.from("chat_messages").insert({
          session_id,
          role: "assistant",
          content: "Something went wrong — please try again.",
          metadata: { error: errMessage, mcp_chat: true },
        });
        await admin
          .from("chat_sessions")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", session_id);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(sseStream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

const RECENT_UPLOADS_LIMIT = 10;

/**
 * Pull the most recent upload metadata from this session and merge it with
 * the current turn's attachments. Returned as an array the orchestrator can
 * render at the top of the prompt as a <recent_uploads> block.
 *
 * Recent attachments live in chat_messages.metadata.attachments on the user
 * messages that originally carried the upload. We pull the last N messages
 * with attachments in this session, flatten to a per-file list, dedupe by
 * document_id, and cap at RECENT_UPLOADS_LIMIT. Current-turn attachments are
 * merged in upfront — they haven't been persisted yet at the time we build
 * this block.
 */
async function buildRecentUploadsBlock(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  sessionId: string,
  currentAttachments: Array<{
    storage_path: string;
    filename: string;
    content_type: string;
    size: number;
    document_id?: string;
    batch_id?: string;
  }> | undefined,
): Promise<Array<{ filename: string; document_id?: string | null; batch_id?: string | null; uploaded_at?: string }>> {
  const seen = new Set<string>();
  const out: Array<{ filename: string; document_id?: string | null; batch_id?: string | null; uploaded_at?: string }> = [];

  // Current turn first — these are about to be the freshest.
  if (currentAttachments?.length) {
    for (const a of currentAttachments) {
      const key = a.document_id || a.storage_path;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        filename: a.filename,
        document_id: a.document_id ?? null,
        batch_id: a.batch_id ?? null,
        uploaded_at: "this turn",
      });
    }
  }

  // Historical uploads from earlier turns in the same session. Pulled
  // newest-first; we stop appending once we hit the cap.
  try {
    const { data: priorMessages } = await admin
      .from("chat_messages")
      .select("metadata, created_at")
      .eq("session_id", sessionId)
      .eq("role", "user")
      .not("metadata->attachments", "is", null)
      .order("created_at", { ascending: false })
      .limit(RECENT_UPLOADS_LIMIT);

    for (const msg of (priorMessages ?? []) as Array<{
      metadata: { attachments?: Array<{ filename: string; document_id?: string; batch_id?: string; storage_path?: string }> } | null;
      created_at: string;
    }>) {
      const atts = msg.metadata?.attachments;
      if (!Array.isArray(atts)) continue;
      for (const a of atts) {
        if (out.length >= RECENT_UPLOADS_LIMIT) return out;
        const key = a.document_id || a.storage_path || a.filename;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push({
          filename: a.filename,
          document_id: a.document_id ?? null,
          batch_id: a.batch_id ?? null,
          uploaded_at: msg.created_at,
        });
      }
    }
  } catch (err) {
    console.error("[mcp] buildRecentUploadsBlock failed", { session_id: sessionId, error: err });
  }

  return out;
}
