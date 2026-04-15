import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildChatContext } from "@/lib/utils/chat-context";
import { rateLimit } from "@/lib/utils/rate-limit";
import { chatMessageSchema } from "@/lib/validations";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { validateFileMetadata } from "@/lib/validations";
import { processBatchV2 } from "@/lib/pipeline/worker-v2";
import { classifyByFilename, matchEntityByHint } from "@/lib/pipeline/classify";
import type { ChatProposedAction, ChatAttachment } from "@/lib/types/chat";
import { randomUUID, createHash } from "crypto";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

/**
 * Walk a (possibly truncated) JSON action-block string and salvage every
 * complete top-level object inside the `actions` array. Used when the model
 * response was cut off mid-record by max_tokens — JSON.parse on the raw text
 * would throw, which previously caused the entire batch of actions to be
 * dropped silently.
 *
 * Input is the inner contents of a ```json ... ``` block (no fences).
 * Output is the list of complete action objects we could parse.
 *
 * Walks character by character tracking brace depth, inside the actions
 * array, and emits each object that closes cleanly. Stops at the first
 * unterminated object (the truncation point) or at the closing `]`.
 */
function salvageActionsFromTruncatedJson(raw: string): Array<Record<string, unknown>> {
  const arrayMatch = raw.match(/"actions"\s*:\s*\[/);
  if (!arrayMatch) return [];
  const arrayStart = arrayMatch.index! + arrayMatch[0].length;

  const objects: string[] = [];
  let depth = 0;
  let currentStart = -1;
  let inString = false;
  let escape = false;

  for (let i = arrayStart; i < raw.length; i++) {
    const c = raw[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === "{") {
      if (depth === 0) currentStart = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && currentStart >= 0) {
        objects.push(raw.slice(currentStart, i + 1));
        currentStart = -1;
      } else if (depth < 0) {
        break; // closing ] reached via unbalanced state
      }
    } else if (c === "]" && depth === 0) {
      break;
    }
  }

  const parsed: Array<Record<string, unknown>> = [];
  for (const s of objects) {
    try {
      const obj = JSON.parse(s) as Record<string, unknown>;
      if (typeof obj.action === "string" && obj.action.length > 0) parsed.push(obj);
    } catch {
      // Individual object malformed — skip it but keep the others.
    }
  }
  return parsed;
}

/**
 * Inject human-readable names alongside UUID references in proposed action
 * data so the approval cards can show "Investor: Sean Doherty Jr" instead
 * of "Investor: 64bc8b26-...". The model only emits the UUIDs (per the
 * action schema); the cards are pure render functions and can't do async
 * lookups, so we resolve names server-side once before sending.
 *
 * Currently resolves: parent_entity_id → parent_entity_name,
 * investment_id → investment_name, entity_id → entity_name (for actions
 * where it represents an entity FK rather than an opaque container id).
 */
async function enrichActionDataWithNames(
  actions: Array<{ action: string; data: Record<string, unknown> }>,
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
): Promise<void> {
  const entityIds = new Set<string>();
  const investmentIds = new Set<string>();
  for (const a of actions) {
    const d = a.data;
    const pe = d.parent_entity_id;
    if (typeof pe === "string" && pe.length > 0) entityIds.add(pe);
    const inv = d.investment_id;
    if (typeof inv === "string" && inv.length > 0 && !inv.startsWith("new_")) investmentIds.add(inv);
  }
  if (entityIds.size === 0 && investmentIds.size === 0) return;

  const [entRes, invRes] = await Promise.all([
    entityIds.size > 0
      ? admin.from("entities").select("id, name").in("id", Array.from(entityIds)).eq("organization_id", orgId)
      : Promise.resolve({ data: [] }),
    investmentIds.size > 0
      ? admin.from("investments").select("id, name").in("id", Array.from(investmentIds)).eq("organization_id", orgId)
      : Promise.resolve({ data: [] }),
  ]);
  const entityNameMap = new Map<string, string>();
  for (const e of (entRes.data || []) as Array<{ id: string; name: string }>) entityNameMap.set(e.id, e.name);
  const invNameMap = new Map<string, string>();
  for (const i of (invRes.data || []) as Array<{ id: string; name: string }>) invNameMap.set(i.id, i.name);

  for (const a of actions) {
    const d = a.data;
    const pe = d.parent_entity_id;
    if (typeof pe === "string" && entityNameMap.has(pe) && !d.parent_entity_name) {
      d.parent_entity_name = entityNameMap.get(pe);
    }
    const inv = d.investment_id;
    if (typeof inv === "string" && invNameMap.has(inv) && !d.investment_name) {
      d.investment_name = invNameMap.get(inv);
    }
  }
}

/**
 * Re-attach proposed_actions metadata to assistant message content for the
 * model's history view. Both chat paths strip the ```json action block from
 * the saved `content` (so the user sees clean prose), which means the model
 * loses sight of what entities/investments it just proposed in prior turns.
 * We append a compact summary so a follow-up like "add this capital call to
 * the investment we just created" can resolve the right record.
 */
function enrichHistoryWithActions(
  messages: Array<{ role: string; content: string; metadata?: unknown }>
): Array<{ role: "user" | "assistant"; content: string }> {
  return messages.map((m) => {
    let content = m.content;
    if (m.role === "assistant" && m.metadata) {
      const meta = m.metadata as Record<string, unknown>;
      const proposed = meta.proposed_actions as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(proposed) && proposed.length > 0) {
        const summary = proposed.map((a) => ({
          action: a.action,
          status: a.status,
          data: a.data,
        }));
        content = `${content}\n\n[Previously proposed actions in this turn — refer to these by name when the user follows up about "the investment we just created" or similar:]\n\`\`\`json\n${JSON.stringify({ actions: summary })}\n\`\`\``;
      }
    }
    return { role: m.role as "user" | "assistant", content };
  });
}

/**
 * POST /api/chat
 *
 * Handles two request types:
 * 1. Regular chat (JSON) — existing conversational flow with Claude
 * 2. Chat with files (multipart/form-data) — upload + process + stream results
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const admin = createAdminClient();

    if (!(await rateLimit(`chat:${user.id}`, 20, 60000))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const contentType = request.headers.get("content-type") || "";

    // ===== FILE UPLOAD PATH =====
    if (contentType.includes("multipart/form-data")) {
      // Check if this is images + instruction (vision chat) vs documents to process (pipeline)
      const clonedRequest = request.clone();
      const peekForm = await clonedRequest.formData();
      const peekFiles: File[] = [];
      for (const [key, value] of peekForm.entries()) {
        if (key === "files" && value instanceof File) peekFiles.push(value);
      }
      const peekMessage = (peekForm.get("message") as string) || "";
      const allImages = peekFiles.length > 0 && peekFiles.every(f => f.type.startsWith("image/"));

      // Route images with text to vision chat (screenshots, tables, etc.)
      // Route documents (PDFs, spreadsheets, etc.) to the pipeline
      if (allImages && peekMessage.trim().length > 0) {
        return handleVisionChat(request, admin, orgId, user);
      }

      return handleFileUpload(request, admin, orgId, user);
    }

    // ===== REGULAR CHAT PATH (existing) =====
    return handleRegularChat(request, admin, orgId, user);
  } catch (err) {
    console.error("POST /api/chat error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Regular chat message — existing flow, now using Anthropic SDK.
 */
async function handleRegularChat(
  request: Request,
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  user: { id: string }
) {
  const supabase = await createClient();
  const body = await request.json();
  const parsed = chatMessageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "session_id and message are required" },
      { status: 400 }
    );
  }
  const { session_id, message, page_context } = parsed.data;

  // Save user message
  await admin.from("chat_messages").insert({
    session_id,
    role: "user",
    content: message,
  });

  // Get message history
  const { data: history } = await supabase
    .from("chat_messages")
    .select("role, content, metadata")
    .eq("session_id", session_id)
    .order("created_at", { ascending: true });

  // Build cacheable system prompt (static org context)
  const cacheableSystemPrompt = await buildChatContext(orgId);

  // Build per-request context that goes into the user message (not cacheable)
  let perRequestContext = "";

  // Check for active document processing state in conversation history
  const recentMessages = (history || []).slice(-5);
  const documentState = recentMessages.find((m) => {
    const meta = m.metadata as Record<string, unknown> | null;
    return meta?.batch_id || meta?.proposed_actions || meta?.pending_question_actions;
  });
  if (documentState) {
    const meta = documentState.metadata as Record<string, unknown>;
    const actions = (meta.proposed_actions || []) as Array<Record<string, unknown>>;
    const questionActions = (meta.pending_question_actions || []) as Array<Record<string, unknown>>;
    const attachments = (meta.attachments || []) as Array<Record<string, unknown>>;

    perRequestContext += `\n\n## Recent Document Upload (this conversation)\n\nThe user recently uploaded documents. Here is the extraction state:\n`;

    if (attachments.length > 0) {
      perRequestContext += `\nFiles processed:\n`;
      for (const a of attachments) {
        perRequestContext += `- "${a.filename}"`;
        if (a.proposed_type) perRequestContext += ` → ${String(a.proposed_type).replace(/_/g, " ")}`;
        if ((a.proposed_entity as Record<string, unknown>)?.name) perRequestContext += ` (matched to ${(a.proposed_entity as Record<string, unknown>).name})`;
        if (a.proposed_year) perRequestContext += `, ${a.proposed_year}`;
        perRequestContext += ` [${a.status}]`;
        if (a.ai_summary) perRequestContext += `\n  Summary: ${a.ai_summary}`;
        perRequestContext += '\n';
      }
    }

    if (actions.length > 0) {
      perRequestContext += `\nProposed/applied actions:\n${actions.map((a) => {
        let line = `- [${a.status}] ${a.action}: ${a.description}`;
        if (a.confidence) line += ` (confidence: ${a.confidence})`;
        if (a.data) {
          const d = a.data as Record<string, unknown>;
          if (d.amount) line += ` — $${Number(d.amount).toLocaleString()}`;
          if (d.name) line += ` — ${d.name}`;
        }
        return line;
      }).join("\n")}\n`;
    }

    if (questionActions.length > 0) {
      perRequestContext += `\nQuestions awaiting user response:\n${questionActions.map((a) => `- ${a.action}: ${a.description}`).join("\n")}\n`;
    }

    // Include follow-up questions from extraction
    const extractionFollowUps = (meta.follow_up_questions || []) as string[];
    if (extractionFollowUps.length > 0) {
      perRequestContext += `\nExtraction follow-up questions:\n${extractionFollowUps.map((q) => `- ${q}`).join("\n")}\n`;
    }

    perRequestContext += `\nThe user may ask about these documents or actions. Use the full org context and these extraction results to answer accurately. If they're answering a question, correcting something, or giving new instructions, handle it appropriately.\n`;
    perRequestContext += `When proposing actions, include them in a JSON block:\n\`\`\`json\n{"actions": [{"action": "action_type", "data": {...}, "description": "..."}]}\n\`\`\`\n`;
    perRequestContext += `\nIMPORTANT: When proposing actions, include them in your response as a JSON block:\n\`\`\`json\n{"actions": [{"action": "action_type", "data": {...}, "description": "..."}]}\n\`\`\`\nThe system will parse these and present them as approval cards.\n\n**UUIDs must come from the org context above — never invent them.** Every \`investment_id\`, \`parent_entity_id\`, \`entity_id\`, \`document_id\`, etc. you put in an action MUST be copied verbatim from the \`(id: ...)\` or \`(entity_id: ...)\` annotations in the org context. If a real UUID isn't shown for the party you want to reference, do NOT make one up. Either pick the correct existing UUID, or ask the user a clarifying question instead of emitting an action. A made-up UUID will route the data to the wrong place silently.\n\n**Never emit an action with missing or empty required fields.** If you cannot determine all required fields (e.g., you don't know which investment_id or parent_entity_id to use), do NOT include the action in a JSON block. Instead, respond in plain text asking a specific clarifying question. Once the user answers, you can propose the action in your next turn with the field filled in.\n\n**Batching for large action sets.** Your output budget is finite (~16k tokens). If a request would generate more than ~12 actions (e.g., recording N capital calls × M investors), do NOT try to fit them all in one response — the JSON block will get truncated mid-record and the user will lose data. Instead:\n  1. Send the first batch of up to ~12 actions in a complete, valid JSON block.\n  2. End the response in plain text saying something like: *"That's the first batch of N. Reply when you're ready and I'll send the next batch (M remaining)."*\n  3. On the next user turn, send the next batch and continue the same way until done.\nThis is more reliable than trying to cram everything into one response.\n`;
  }

  const sanitize = (s: string) => s.replace(/[<>"'`\\]/g, "").slice(0, 255);
  if (page_context?.investmentId && page_context?.investmentName) {
    perRequestContext += `\n\nThe user is currently viewing the investment detail page for "${sanitize(page_context.investmentName)}" (ID: ${sanitize(page_context.investmentId)}). If they refer to "this investment" or "this deal," they mean this investment. Documents uploaded should be associated with this investment.`;
  } else if (page_context?.entityId && page_context?.entityName) {
    perRequestContext += `\n\nThe user is currently viewing the entity detail page for "${sanitize(page_context.entityName)}" (ID: ${sanitize(page_context.entityId)}). If they ask questions like "what are the managers?" or refer to "this entity," they mean this entity.`;
  } else if (page_context?.page === "documents_list") {
    perRequestContext += `\n\nThe user is currently viewing the Documents page.`;
    if (page_context.filters?.entityId) {
      perRequestContext += ` They have filtered to a specific entity.`;
    }
  } else if (page_context?.page === "directory") {
    perRequestContext += `\n\nThe user is currently viewing the Directory page.`;
  } else if (page_context?.page === "investments") {
    perRequestContext += `\n\nThe user is currently viewing the Investments page.`;
  }

  // Build messages, prepending per-request context to the last user message.
  // enrichHistoryWithActions re-attaches stripped action JSON so the model can
  // see what it proposed in earlier turns (otherwise "the investment we just
  // created" is unresolvable from history alone).
  const messages: Anthropic.MessageParam[] = enrichHistoryWithActions(
    (history || []) as Array<{ role: string; content: string; metadata?: unknown }>
  );

  if (perRequestContext && messages.length > 0) {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role === "user" && typeof lastMsg.content === "string") {
      lastMsg.content = `[Context: ${perRequestContext.trim()}]\n\n${lastMsg.content}`;
    }
  }

  // Call Claude API with streaming via Anthropic SDK
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      // Was 2048 — too small for action-heavy responses (the JSON code block
      // gets truncated mid-record and the parser silently drops everything).
      // 16k matches the extract pipeline's budget.
      max_tokens: 16384,
      system: [{ type: "text", text: cacheableSystemPrompt, cache_control: { type: "ephemeral" } }],
      messages,
      stream: true,
    });

    const encoder = new TextEncoder();
    let fullResponse = "";
    let stopReason: string | null = null;

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of response) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              fullResponse += event.delta.text;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`)
              );
            }

            // Capture stop_reason from the message_delta event so message_stop
            // can detect a max_tokens truncation and warn the user instead of
            // silently dropping a partial JSON action block.
            if (event.type === "message_delta" && event.delta.stop_reason) {
              stopReason = event.delta.stop_reason;
            }

            if (event.type === "message_stop") {
              // Check for proposed actions in JSON blocks
              const actionMatch = fullResponse.match(/```json\s*\n?([\s\S]*?)\n?\s*```/);
              let proposedActions: ChatProposedAction[] = [];
              let cleanResponse = fullResponse;

              const toProposedActions = (actions: Array<Record<string, unknown>>) =>
                actions
                  .filter((a) => typeof a.action === "string" && (a.action as string).length > 0)
                  .map((a) => ({
                    id: randomUUID(),
                    queue_item_id: "",
                    action: a.action as string,
                    data: (a.data && typeof a.data === "object") ? a.data as Record<string, unknown> : {},
                    confidence: "high" as const,
                    description: (a.description as string) || (a.action as string).replace(/_/g, " "),
                    status: "pending" as const,
                    presentation: "card" as const,
                  }));

              let continuationNote = "";

              if (actionMatch) {
                try {
                  const actionData = JSON.parse(actionMatch[1]);
                  proposedActions = toProposedActions(actionData.actions || []);
                  cleanResponse = fullResponse.replace(/```json\s*\n?[\s\S]*?\n?\s*```/, "").trim();
                } catch {
                  // JSON parse failed — typically because the response was
                  // truncated mid-record by max_tokens. Salvage every complete
                  // action object we can and append a continuation note so
                  // the user knows to ask for the rest. The model sees the
                  // continuation note in its history on the next turn and
                  // picks up where it left off.
                  const salvaged = salvageActionsFromTruncatedJson(actionMatch[1]);
                  proposedActions = toProposedActions(salvaged);
                  if (salvaged.length > 0) {
                    continuationNote = `\n\n_(I prepared ${salvaged.length} action${salvaged.length === 1 ? "" : "s"} above. There are more to come — reply when you're ready and I'll send the next batch.)_`;
                  } else {
                    continuationNote = "\n\n_(My response was cut off and I couldn't parse the action block. Reply with anything to have me retry — I'll keep the next batch shorter.)_";
                  }
                  cleanResponse = fullResponse.replace(/```json\s*\n?[\s\S]*$/, "").trim() + continuationNote;
                }
              } else if (stopReason === "max_tokens") {
                continuationNote = "\n\n_(My response was cut off — reply when you're ready and I'll continue.)_";
                cleanResponse = fullResponse + continuationNote;
              }

              if (continuationNote) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ text: continuationNote })}\n\n`)
                );
              }

              // Inject investor / investment names so the approval cards
              // can show "Investor: Sean Doherty Jr" rather than a UUID.
              await enrichActionDataWithNames(proposedActions, admin, orgId);

              const msgMetadata: Record<string, unknown> = {};
              if (proposedActions.length > 0) {
                msgMetadata.proposed_actions = proposedActions;
                msgMetadata.processing_status = "completed";
              }

              const { data: savedMsg } = await admin.from("chat_messages").insert({
                session_id,
                role: "assistant",
                content: cleanResponse,
                ...(Object.keys(msgMetadata).length > 0 ? { metadata: msgMetadata } : {}),
              }).select("id").single();

              // If we have proposed actions, send a results event for approval cards
              if (proposedActions.length > 0 && savedMsg) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({
                    type: "results",
                    message_id: savedMsg.id,
                    summary: cleanResponse,
                    attachments: [],
                    proposed_actions: proposedActions,
                  })}\n\n`)
                );
              }

              if (history && history.length <= 1) {
                const title = message.length > 50 ? message.substring(0, 50) + "..." : message;
                await admin
                  .from("chat_sessions")
                  .update({ title, updated_at: new Date().toISOString() })
                  .eq("id", session_id);
              } else {
                await admin
                  .from("chat_sessions")
                  .update({ updated_at: new Date().toISOString() })
                  .eq("id", session_id);
              }
            }
          }
        } catch (err) {
          console.error("Stream error:", err);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: "Stream interrupted" })}\n\n`)
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("Claude API error:", err);
    return NextResponse.json({ error: "AI request failed" }, { status: 500 });
  }
}

/**
 * Vision chat — images sent with a text message are passed to Claude as vision content.
 * This handles screenshots, tables, charts etc. where the user wants Claude to read
 * the image and take action (e.g., "add these transactions"), not file a document.
 */
async function handleVisionChat(
  request: Request,
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  user: { id: string }
) {
  const supabase = await createClient();
  const formData = await request.formData();
  const sessionId = formData.get("session_id") as string;
  const messageText = (formData.get("message") as string) || "";
  const pageContextStr = formData.get("page_context") as string | null;
  const pageContext = pageContextStr ? JSON.parse(pageContextStr) : null;

  if (!sessionId) {
    return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  }

  // Collect image files
  const files: File[] = [];
  for (const [key, value] of formData.entries()) {
    if (key === "files" && value instanceof File) files.push(value);
  }

  // Convert images to base64 for Claude vision AND persist each one as a
  // documents row so the AI's resulting record_investment_transaction /
  // link_document_to_investment actions can reference them.
  //
  // Without this, vision-chat uploads (screenshots, pasted PDFs) produced
  // transactions with NULL document_id and no source paper trail. Discovered
  // during the spec 036 orphan cleanup — see investigation in chat history.
  const imageContents: Array<Anthropic.ImageBlockParam> = [];
  const filenames: string[] = [];
  // Maps the *prompt-order index* of each image to the documents row created
  // for it. We tell the model the IDs in order so it can set data.document_id
  // on the right action when there are multiple images in one message.
  const visionDocumentIds: string[] = [];
  for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
    const file = files[fileIdx];
    const buffer = Buffer.from(await file.arrayBuffer());
    imageContents.push({
      type: "image",
      source: {
        type: "base64",
        media_type: file.type as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
        data: buffer.toString("base64"),
      },
    });
    filenames.push(file.name);

    // Persist to storage + documents table.
    // Path: chat-vision/{orgId}/{timestamp}-{idx}-{safe_filename}
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
    const storagePath = `chat-vision/${orgId}/${Date.now()}-${fileIdx}-${safeName}`;

    let docId: string | null = null;
    try {
      const { error: uploadErr } = await admin.storage
        .from("documents")
        .upload(storagePath, buffer, {
          contentType: file.type,
          upsert: false,
        });
      if (uploadErr) {
        console.error(`[chat-vision] storage upload failed for ${file.name}:`, uploadErr.message);
      } else {
        // Page context gives us a starting entity/investment when the user is
        // already on a relevant detail page; if they're not, the link will be
        // set later by the link_document_to_investment action handler.
        const { data: docRow, error: docErr } = await admin
          .from("documents")
          .insert({
            name: file.name,
            file_path: storagePath,
            file_size: buffer.length,
            mime_type: file.type,
            uploaded_by: user.id,
            organization_id: orgId,
            entity_id: (pageContext?.entityId as string) || null,
            investment_id: (pageContext?.investmentId as string) || null,
            document_type: "other",
            document_category: "investment_correspondence",
            ai_extracted: false,
          })
          .select("id")
          .single();
        if (docErr) {
          console.error(`[chat-vision] documents insert failed for ${file.name}:`, docErr.message);
        } else {
          docId = (docRow as { id: string }).id;
        }
      }
    } catch (err) {
      console.error(`[chat-vision] failed to persist ${file.name}:`, err);
    }

    // Push id (or empty string sentinel) so positional indexing stays aligned
    // with the imageContents array even when individual uploads fail.
    visionDocumentIds.push(docId || "");
  }

  // Save user message
  await admin.from("chat_messages").insert({
    session_id: sessionId,
    role: "user",
    content: messageText,
    metadata: {
      image_filenames: filenames,
      vision_document_ids: visionDocumentIds.filter(Boolean),
      page_context: pageContext,
    },
  });

  // Get message history
  const { data: history } = await supabase
    .from("chat_messages")
    .select("role, content, metadata")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  // Build cacheable system prompt (static org context)
  const cacheableSystemPrompt = await buildChatContext(orgId);

  // Build per-request context for user message
  let perRequestContext = "";

  // Page context
  const sanitize = (s: string) => s.replace(/[<>"'`\\]/g, "").slice(0, 255);
  if (pageContext?.investmentId && pageContext?.investmentName) {
    perRequestContext += `\n\nThe user is currently viewing the investment detail page for "${sanitize(pageContext.investmentName)}" (ID: ${sanitize(pageContext.investmentId)}). If they refer to "this investment" or "this deal," they mean this investment.`;
  } else if (pageContext?.entityId && pageContext?.entityName) {
    perRequestContext += `\n\nThe user is currently viewing the entity detail page for "${sanitize(pageContext.entityName)}" (ID: ${sanitize(pageContext.entityId)}). If they refer to "this entity," they mean this entity.`;
  }

  // Action instruction
  perRequestContext += `\n\n## Proposing Actions
When the user asks you to take action (add transactions, create entities, update records, etc.), propose the actions using a JSON block in your response:
\`\`\`json
{"actions": [{"action": "action_type", "data": {...}, "description": "human-readable description"}]}
\`\`\`

Available action types:
- record_investment_transaction: { investment_id, parent_entity_id, transaction_type (contribution|distribution|return_of_capital), amount, transaction_date, description }
- create_investment: { name, investment_type, parent_entity_id, description }
- link_document_to_investment: { investment_id }
- create_entity: { name, type, formation_state }
- create_directory_entry: { name, type: "individual" | "external_entity" }
- update_cap_table: { entity_id, investor_name, ownership_pct }
- set_investment_allocations: { investment_id, parent_entity_id, allocations: [{ member_name, allocation_pct }] }

Use real entity/investment UUIDs from the context above or from previously proposed actions in the conversation history. For dates, use YYYY-MM-DD format. For amounts, use positive numbers.

**Process EVERY data point the user asks for. Do not chunk or sample.** If the user says "all" or "every" or "the whole table" or just shares a multi-row document and says "add these," you MUST emit one action per row, every row in the document. Do NOT decide on your own to "do the recent ones first and ask about the older ones." Do NOT cap at any number. If there are 15 rows, return 15 actions. If there are 100 rows, return 100 actions. The user will deselect any they don't want via the approval card; your job is to surface everything that's there. The only acceptable reason to skip a row is if its required fields are missing or unreadable from the source.

**Recording investment transactions from a tabular source (distribution log, capital call schedule, etc.):**
- For each row in the table, emit a separate \`record_investment_transaction\` action.
- Set \`amount\` to the **NET** column for distributions, or the **TOTAL FUNDING** for capital calls. The parent \`amount\` is what the LP actually received or paid.
- Build the \`line_items\` array using the columns shown in the source. **CRITICAL — sign convention:** in source documents, deductions are typically shown as NEGATIVE numbers (e.g., \`-$461.10\` carried interest, \`($481.91)\` audit holdback in parentheses). The \`line_items\` array in your action must represent ALL amounts as POSITIVE numbers — the system applies the subtraction itself based on the category. So a source row showing \`-$461.10\` for compliance holdback becomes \`{ "category": "compliance_holdback", "amount": 461.10 }\`. NEVER pass a negative amount in line_items.
- The system enforces \`gross_distribution - sum(reductions) = amount\` within $0.01 tolerance. If the source's own math doesn't reconcile (rare but it happens — fund administrators occasionally have arithmetic errors in their statements), pick the values exactly as shown and let the validator surface the mismatch — the user will see "why it failed" and can correct manually.

**Critical rule — never emit actions with missing required fields.** If you cannot determine ALL required fields for an action (e.g., you don't know which investment_id or parent_entity_id to use, or the amount/date isn't visible in the image), do NOT include the action in a JSON block. Instead, respond in plain text asking the user a specific clarifying question — for example: "This looks like a capital call for $50,000 dated Jan 15, 2025. Which investment should I record it against?" Once they answer, you can propose the action in your next turn with the missing field filled in.

If the user has just created or referenced a specific investment/entity in a prior message in this session, prefer that as the default — but still confirm before recording financial transactions.

The user is sending you an image (screenshot or PDF). Read the data from it carefully and propose the appropriate actions.${
  visionDocumentIds.filter(Boolean).length > 0
    ? `\n\n**Document linkage.** Each image you're seeing has been saved as a document in the user's library and assigned an ID. When you propose \`record_investment_transaction\` or \`link_document_to_investment\` actions, set \`data.document_id\` to the matching ID so the transaction is linked to its source paper. The image-to-document mapping in order is:\n${visionDocumentIds
        .map((id, i) => `  ${i + 1}. ${filenames[i]} → document_id: ${id || "(upload failed — omit document_id)"}`)
        .join("\n")}\nIf you can't tell which image an action came from, use the first non-empty document_id.`
    : ""
}`;

  // Build messages with vision content for the current message.
  // Re-attach stripped action JSON to assistant history so the model can resolve
  // references like "add this to the investment we just created."
  const messages: Anthropic.MessageParam[] = [];
  const historyMessages = (history || []).slice(0, -1); // exclude the message we just saved
  const enrichedHistory = enrichHistoryWithActions(
    historyMessages as Array<{ role: string; content: string; metadata?: unknown }>
  );
  for (const m of enrichedHistory) {
    messages.push(m);
  }

  // Current message with images and per-request context
  const userContent: Array<Anthropic.ImageBlockParam | Anthropic.TextBlockParam> = [
    ...imageContents,
  ];
  if (perRequestContext) {
    userContent.push({ type: "text", text: `[Context: ${perRequestContext.trim()}]` });
  }
  userContent.push({ type: "text", text: messageText });

  messages.push({
    role: "user",
    content: userContent,
  });

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      // 4096 was too tight for action-heavy responses (e.g. recording N
      // capital calls × M investors silently truncates the JSON mid-record,
      // and the action parser then drops the whole batch). 16k matches the
      // extract pipeline's budget. The truncation handler below also surfaces
      // a clear error if even this isn't enough.
      max_tokens: 16384,
      system: [{ type: "text", text: cacheableSystemPrompt, cache_control: { type: "ephemeral" } }],
      messages,
      stream: true,
    });

    const encoder = new TextEncoder();
    let fullResponse = "";
    let stopReason: string | null = null;

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of response) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              fullResponse += event.delta.text;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`)
              );
            }

            // Capture stop_reason from message_delta so message_stop can
            // detect a max_tokens truncation and warn the user.
            if (event.type === "message_delta" && event.delta.stop_reason) {
              stopReason = event.delta.stop_reason;
            }

            if (event.type === "message_stop") {
              // Check for proposed actions in the response
              const actionMatch = fullResponse.match(/```json\s*\n?([\s\S]*?)\n?\s*```/);
              let proposedActions: ChatProposedAction[] = [];
              let cleanResponse = fullResponse;

              // Backstop: if the model omits data.document_id on a
              // record_investment_transaction or link_document_to_investment
              // action, fill it in from the first non-empty vision document
              // we persisted at the start of the request. The prompt asks
              // the model to do this itself; this is the safety net.
              const fallbackDocId = visionDocumentIds.find(Boolean) || null;
              const ACTIONS_NEEDING_DOC = new Set([
                "record_investment_transaction",
                "link_document_to_investment",
              ]);

              const toVisionProposedActions = (actions: Array<Record<string, unknown>>) =>
                actions
                  .filter((a) => typeof a.action === "string" && (a.action as string).length > 0)
                  .map((a) => {
                    const data: Record<string, unknown> = (a.data && typeof a.data === "object") ? { ...(a.data as Record<string, unknown>) } : {};
                    if (
                      ACTIONS_NEEDING_DOC.has(a.action as string) &&
                      !data.document_id &&
                      fallbackDocId
                    ) {
                      data.document_id = fallbackDocId;
                    }
                    return {
                      id: randomUUID(),
                      queue_item_id: "",
                      action: a.action as string,
                      data,
                      confidence: "high" as const,
                      description: (a.description as string) || (a.action as string).replace(/_/g, " "),
                      status: "pending" as const,
                      presentation: "card" as const,
                    };
                  });

              let continuationNote = "";

              if (actionMatch) {
                try {
                  const actionData = JSON.parse(actionMatch[1]);
                  proposedActions = toVisionProposedActions(actionData.actions || []);
                  cleanResponse = fullResponse.replace(/```json\s*\n?[\s\S]*?\n?\s*```/, "").trim();
                } catch {
                  // Truncated mid-record. Salvage what we can and tell the
                  // user a follow-up will continue.
                  const salvaged = salvageActionsFromTruncatedJson(actionMatch[1]);
                  proposedActions = toVisionProposedActions(salvaged);
                  if (salvaged.length > 0) {
                    continuationNote = `\n\n_(I prepared ${salvaged.length} action${salvaged.length === 1 ? "" : "s"} above. There are more to come — reply when you're ready and I'll send the next batch.)_`;
                  } else {
                    continuationNote = "\n\n_(My response was cut off and I couldn't parse the action block. Reply with anything to have me retry — I'll keep the next batch shorter.)_";
                  }
                  cleanResponse = fullResponse.replace(/```json\s*\n?[\s\S]*$/, "").trim() + continuationNote;
                }
              } else if (stopReason === "max_tokens") {
                continuationNote = "\n\n_(My response was cut off — reply when you're ready and I'll continue.)_";
                cleanResponse = fullResponse + continuationNote;
              }

              if (continuationNote) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ text: continuationNote })}\n\n`)
                );
              }

              await enrichActionDataWithNames(proposedActions, admin, orgId);

              const metadata: Record<string, unknown> = {
                image_filenames: filenames,
                vision_chat: true,
                vision_document_ids: visionDocumentIds.filter(Boolean),
              };
              if (proposedActions.length > 0) {
                metadata.proposed_actions = proposedActions;
                metadata.processing_status = "completed";
              }

              const { data: savedMsg } = await admin.from("chat_messages").insert({
                session_id: sessionId,
                role: "assistant",
                content: cleanResponse || fullResponse,
                metadata,
              }).select("id").single();

              // Always send results event so the client picks up the message
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({
                  type: "results",
                  message_id: savedMsg?.id || null,
                  summary: cleanResponse || fullResponse,
                  attachments: [],
                  proposed_actions: proposedActions,
                })}\n\n`)
              );

              // Update session
              if (history && history.length <= 1) {
                const title = messageText.length > 50 ? messageText.substring(0, 50) + "..." : messageText;
                await admin.from("chat_sessions")
                  .update({ title, updated_at: new Date().toISOString() })
                  .eq("id", sessionId);
              } else {
                await admin.from("chat_sessions")
                  .update({ updated_at: new Date().toISOString() })
                  .eq("id", sessionId);
              }
            }
          }
        } catch (err) {
          console.error("Vision stream error:", err);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: "Stream interrupted" })}\n\n`)
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("Claude vision API error:", err);
    return NextResponse.json({ error: "AI request failed" }, { status: 500 });
  }
}

/**
 * Chat with file attachments — upload, process, stream progress + results.
 */
async function handleFileUpload(
  request: Request,
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  user: { id: string }
) {
  try {
  const formData = await request.formData();
  const sessionId = formData.get("session_id") as string;
  const messageText = (formData.get("message") as string) || "";
  const pageContextStr = formData.get("page_context") as string | null;
  const pageContext = pageContextStr ? JSON.parse(pageContextStr) : null;

  if (!sessionId) {
    return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  }

  // Collect files from form data
  const files: File[] = [];
  for (const [key, value] of formData.entries()) {
    if (key === "files" && value instanceof File) {
      files.push(value);
    }
  }

  if (files.length === 0) {
    return NextResponse.json({ error: "No files attached" }, { status: 400 });
  }

  // Validate files
  for (const file of files) {
    const validation = validateFileMetadata(file.name, file.size, file.type);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
  }

  // Save user message with attachment metadata
  const attachmentMeta: ChatAttachment[] = files.map((f) => ({
    queue_item_id: "", // filled after queue item creation
    document_id: null,
    filename: f.name,
    status: "uploading" as const,
  }));

  const { data: userMsg } = await admin.from("chat_messages").insert({
    session_id: sessionId,
    role: "user",
    content: messageText || `Uploaded ${files.length} file${files.length !== 1 ? "s" : ""}`,
    metadata: {
      attachments: attachmentMeta,
      page_context: pageContext,
    },
  }).select("id").single();

  const userMessageId = userMsg?.id;

  // Determine entity_id and investment context from page context
  const entityId = pageContext?.entityId || null;
  const investmentId = pageContext?.investmentId || null;
  const investmentName = pageContext?.investmentName || null;

  // If on an investment page, prepend investment context to user message for extraction
  let userContext = messageText || null;
  if (investmentId && investmentName) {
    const investmentHint = `[User is viewing investment: ${investmentName} (ID: ${investmentId}). Documents should be linked to this investment.]`;
    userContext = userContext ? `${investmentHint} ${userContext}` : investmentHint;
  }

  // Check if user exists in public users table (auth user may not be synced)
  const { data: userRow } = await admin.from("users").select("id").eq("id", user.id).maybeSingle();
  const createdBy = userRow ? user.id : null;

  // Create batch
  const { data: batch, error: batchError } = await admin.from("document_batches").insert({
    organization_id: orgId,
    name: messageText || `Chat upload (${files.length} files)`,
    context: "chat",
    entity_id: entityId,
    entity_discovery: !entityId,
    user_context: userContext,
    chat_session_id: sessionId,
    chat_message_id: userMessageId,
    status: "processing",
    total_documents: files.length,
    created_by: createdBy,
  }).select("id").single();

  if (batchError || !batch) {
    console.error("Failed to create batch:", batchError);
    return NextResponse.json({ error: "Failed to create batch", details: batchError?.message }, { status: 500 });
  }

  const batchId = batch.id;

  // Upload files to Supabase Storage and create queue items
  const queueItemIds: string[] = [];

  // Fetch entities for filename classification
  const { data: entities } = await admin
    .from("entities")
    .select("id, name, short_name")
    .eq("organization_id", orgId);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${orgId}/queue/${batchId}/${safeName}`;

    // Read file buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Compute content hash
    const hashBuffer = createHash("sha256").update(buffer).digest("hex");

    // Upload to storage
    const { error: uploadError } = await admin.storage
      .from("documents")
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) {
      console.error(`Upload error for ${file.name}:`, uploadError);
      continue;
    }

    // Classify by filename
    const classification = classifyByFilename(file.name);
    const entityMatch = matchEntityByHint(
      classification.entity_hint || null,
      entities || []
    );

    // Create queue item (skip staging, go straight to queued)
    const { data: queueItem } = await admin.from("document_queue").insert({
      batch_id: batchId,
      original_filename: file.name,
      file_path: storagePath,
      file_size: file.size,
      mime_type: file.type,
      content_hash: hashBuffer,
      status: "queued",
      source_type: "upload",
      staged_doc_type: classification.document_type,
      staged_entity_id: entityId || entityMatch?.id || null,
      staged_year: classification.year,
      staging_confidence: entityId ? "user" : (entityMatch ? "ai" : null),
    }).select("id").single();

    if (queueItem) {
      queueItemIds.push(queueItem.id);
      attachmentMeta[i].queue_item_id = queueItem.id;
    }
  }

  // Update user message with queue item IDs
  if (userMessageId) {
    await admin.from("chat_messages").update({
      metadata: {
        attachments: attachmentMeta,
        batch_id: batchId,
        page_context: pageContext,
      },
    }).eq("id", userMessageId);
  }

  // Start SSE stream for processing progress
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Send initial status
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({
            type: "processing_start",
            batch_id: batchId,
            total: queueItemIds.length,
            filenames: files.map(f => f.name),
          })}\n\n`)
        );

        // Process batch using v2 two-tier pipeline.
        // Pass full pageContext (including names, not just UUIDs) so triage
        // tier 1 can match against the investment roster by name. Stripping
        // names here was a real bug — the model can't reliably match a bare
        // UUID to a roster entry.
        const batchResult = await processBatchV2(
          batchId,
          orgId,
          userContext || undefined,
          pageContext
            ? {
                entityId: pageContext.entityId,
                entityName: pageContext.entityName,
                investmentId: pageContext.investmentId,
                investmentName: pageContext.investmentName,
              }
            : undefined,
        );

        // Stream triage summary as progress
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({
            type: "progress",
            completed: queueItemIds.length,
            total: queueItemIds.length,
            triage_summary: batchResult.triageSummary,
          })}\n\n`)
        );

        // Fetch final results from queue items (including any composite children)
        const { data: processedItems } = await admin
          .from("document_queue")
          .select("*")
          .eq("batch_id", batchId)
          .not("status", "in", "(staged,queued)");


        // Build attachments and proposed actions for the assistant message
        const resultAttachments: ChatAttachment[] = [];
        const proposedActions: ChatProposedAction[] = [];

        for (const item of processedItems || []) {
          resultAttachments.push({
            queue_item_id: item.id,
            document_id: item.document_id || null,
            filename: item.original_filename,
            status: item.status === "error" ? "error" : "processed",
            proposed_entity: item.ai_entity_id
              ? { id: item.ai_entity_id, name: item.ai_entity_name || null }
              : item.ai_proposed_entity
                ? { id: null, name: (item.ai_proposed_entity as Record<string, unknown>)?.name as string || null }
                : null,
            proposed_type: item.ai_document_type || item.staged_doc_type || null,
            proposed_category: item.ai_document_category || null,
            proposed_year: item.ai_year || item.staged_year || null,
            ai_summary: item.ai_summary || null,
          });

          // Convert AI proposed actions to chat proposed actions
          if (item.status === "review_ready" && item.ai_proposed_actions) {
            const actions = item.ai_proposed_actions as Array<{
              action: string;
              data: Record<string, unknown>;
              confidence: string;
              reason: string;
            }>;

            for (const action of actions) {
              proposedActions.push({
                id: randomUUID(),
                queue_item_id: item.id,
                action: action.action,
                data: action.data,
                confidence: (action.confidence as "high" | "medium" | "low") || "medium",
                description: action.reason || action.action.replace(/_/g, " "),
                status: "pending",
              });
            }
          }
        }

        // Collect response messages AND follow-up questions from tier 2
        // extraction. The follow-ups are critical when the model returns an
        // empty actions array — without them, the user has no idea why
        // nothing happened or how to unblock the model.
        //
        // Also collect extraction_error messages from any items that errored
        // during tier 2 — those used to be silently summarized as "1 had
        // errors" with no detail, leaving the user with no idea what went
        // wrong. Now we surface the actual error message inline.
        const extractionMessages: string[] = [];
        const extractionQuestions: string[] = [];
        const extractionErrors: Array<{ filename: string; message: string }> = [];
        for (const item of processedItems || []) {
          if (item.status === "error") {
            const errMsg = (item.extraction_error as string) || "Extraction failed with no error detail recorded.";
            extractionErrors.push({
              filename: (item.original_filename as string) || "unknown file",
              message: errMsg,
            });
            continue;
          }
          const extraction = item.ai_extraction as Record<string, unknown> | null;
          if (extraction?.response_message) {
            extractionMessages.push(extraction.response_message as string);
          }
          const questions = extraction?.follow_up_questions;
          if (Array.isArray(questions)) {
            for (const q of questions) {
              if (typeof q === "string" && q.trim().length > 0) {
                extractionQuestions.push(q);
              }
            }
          }
        }

        const reviewReadyItems = (processedItems || []).filter(i => i.status === "review_ready");
        const autoIngestedItems = (processedItems || []).filter(i => i.status === "auto_ingested" || i.status === "extracted");
        console.log(`[CHAT] Results: ${processedItems?.length || 0} items, ${proposedActions.length} actions, ${extractionMessages.length} response messages`);

        // === Response message: use extraction's response_message (no separate Pass 2 call) ===
        const autoIngested = (processedItems || []).filter(i => i.status === "auto_ingested" || i.status === "extracted");
        const reviewReady = (processedItems || []).filter(i => i.status === "review_ready");
        const errors = (processedItems || []).filter(i => i.status === "error");
        const hasMismatches = batchResult.mismatched > 0;

        // Add presentation hints
        for (const action of proposedActions) {
          action.presentation = action.confidence === "high" ? "card" : "question";
        }

        // Build summary: prefer extraction's response_message, fall back to
        // triage summary or template. Always append follow-up questions when
        // present so the user can see exactly what the model needs from them.
        //
        // Errors are surfaced inline with the actual extraction_error text
        // instead of the generic "1 had errors" template so the user can see
        // what actually went wrong without opening devtools.
        let summary: string;
        if (extractionErrors.length > 0 && extractionMessages.length === 0 && proposedActions.length === 0) {
          // All items errored — show the real error messages, not the template.
          summary = extractionErrors
            .map(
              (e) =>
                `**${e.filename}** failed to process:\n${e.message}\n\n` +
                `This is usually one of: an oversized PDF that exceeded the model's token budget, ` +
                `a corrupted or unreadable file, a transient network error to the model, ` +
                `or a real bug in Rhodes. If re-uploading doesn't fix it, the underlying error ` +
                `above should tell us what to do next.`
            )
            .join("\n\n---\n\n");
        } else if (hasMismatches && batchResult.triageSummary) {
          summary = batchResult.triageSummary;
        } else if (extractionMessages.length > 0) {
          summary = extractionMessages.join("\n\n");
        } else if (proposedActions.length === 0 && reviewReady.length > 0) {
          // The model returned no actions and no response_message — that's
          // the silent-failure mode the extract.ts prompt is supposed to
          // prevent, but if it slips through we surface a clear error
          // instead of the generic "needs your review" template.
          summary = `I processed the file but couldn't propose any actions and didn't return an explanation. This usually means the model couldn't determine which entity or investment to attribute the document to. Try opening the relevant entity or investment detail page first and re-uploading, or tell me more about the document in chat.`;
        } else {
          // Template fallback for the auto-ingest path (where there's nothing for the user to review)
          summary = `Processed ${files.length} file${files.length !== 1 ? "s" : ""}.`;
          if (autoIngested.length > 0) summary += ` ${autoIngested.length} filed automatically.`;
          if (reviewReady.length > 0) summary += ` ${reviewReady.length} need${reviewReady.length === 1 ? "s" : ""} your review.`;
          if (errors.length > 0) summary += ` ${errors.length} had errors.`;
        }

        // If there's a mix of successful and errored items, append the error
        // details after the main summary so successes aren't hidden.
        if (extractionErrors.length > 0 && (extractionMessages.length > 0 || proposedActions.length > 0)) {
          summary += `\n\n**Errors on ${extractionErrors.length} file${extractionErrors.length !== 1 ? "s" : ""}:**\n` +
            extractionErrors.map((e) => `• **${e.filename}**: ${e.message}`).join("\n");
        }

        // Append the model's follow-up questions inline so the user sees
        // exactly what's needed to unblock the next turn.
        if (extractionQuestions.length > 0) {
          const uniqueQuestions = Array.from(new Set(extractionQuestions));
          summary += `\n\n**To move forward, I need to know:**\n${uniqueQuestions.map((q) => `• ${q}`).join("\n")}`;
        }

        const cardActions = proposedActions.filter(a => a.presentation === "card");
        const questionActions = proposedActions.filter(a => a.presentation === "question");

        // Save assistant message with results
        // Only include card-presentation actions in the approval card
        // Question-presentation actions are handled conversationally in the summary text
        const { data: savedMsg } = await admin.from("chat_messages").insert({
          session_id: sessionId,
          role: "assistant",
          content: summary,
          metadata: {
            batch_id: batchId,
            attachments: resultAttachments,
            proposed_actions: cardActions,
            pending_question_actions: questionActions.length > 0 ? questionActions : undefined,
            processing_status: "completed",
          },
        }).select("id").single();
        const assistantMessageId = savedMsg?.id || null;

        // Update session timestamp
        await admin
          .from("chat_sessions")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", sessionId);

        // Stream final results
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({
            type: "results",
            message_id: assistantMessageId,
            summary,
            attachments: resultAttachments,
            proposed_actions: cardActions,
            has_questions: questionActions.length > 0,
          })}\n\n`)
        );
      } catch (err) {
        console.error("Processing stream error:", err);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({
            type: "error",
            message: "Processing failed",
          })}\n\n`)
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
  } catch (err) {
    console.error("handleFileUpload error:", err);
    return NextResponse.json({
      error: "File upload failed",
      details: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
