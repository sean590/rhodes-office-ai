import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildChatContext } from "@/lib/utils/chat-context";
import { rateLimit } from "@/lib/utils/rate-limit";
import { chatMessageSchema } from "@/lib/validations";
import { requireOrg, isError } from "@/lib/utils/org-context";

export async function POST(request: Request) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const supabase = await createClient();
    const admin = createAdminClient();

    if (!(await rateLimit(`chat:${user.id}`, 20, 60000))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const body = await request.json();
    const parsed = chatMessageSchema.safeParse(body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      return NextResponse.json(
        { error: firstError?.message || "session_id and message are required" },
        { status: 400 }
      );
    }
    const { session_id, message, page_context } = parsed.data;

    // Save user message
    const { error: saveError } = await admin
      .from("chat_messages")
      .insert({
        session_id,
        role: "user",
        content: message,
      });

    if (saveError) {
      return NextResponse.json({ error: saveError.message }, { status: 500 });
    }

    // Get message history
    const { data: history } = await supabase
      .from("chat_messages")
      .select("role, content")
      .eq("session_id", session_id)
      .order("created_at", { ascending: true });

    // Build context
    let systemPrompt = await buildChatContext(orgId);

    // Append page context if provided
    if (page_context?.entityId && page_context?.entityName) {
      systemPrompt += `\n\nThe user is currently viewing the entity detail page for "${page_context.entityName}" (ID: ${page_context.entityId}). If they ask questions like "what are the managers?" or refer to "this entity," they mean this entity.`;
    } else if (page_context?.page === "documents_list") {
      systemPrompt += `\n\nThe user is currently viewing the Documents page.`;
      if (page_context.filters?.entityId) {
        systemPrompt += ` They have filtered to a specific entity.`;
      }
    } else if (page_context?.page === "directory") {
      systemPrompt += `\n\nThe user is currently viewing the Directory page.`;
    } else if (page_context?.page === "relationships") {
      systemPrompt += `\n\nThe user is currently viewing the Relationships page.`;
    }

    // Build messages array for Claude
    const messages = (history || []).map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // Call Claude API with streaming
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "AI not configured" }, { status: 500 });
    }

    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        system: systemPrompt,
        messages,
        stream: true,
      }),
    });

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text();
      console.error("Claude API error:", errorText);
      return NextResponse.json({ error: "AI request failed" }, { status: 500 });
    }

    // Set up SSE streaming
    const encoder = new TextEncoder();
    let fullResponse = "";

    const stream = new ReadableStream({
      async start(controller) {
        const reader = claudeResponse.body?.getReader();
        if (!reader) {
          controller.close();
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const data = line.slice(6);
                if (data === "[DONE]") continue;

                try {
                  const parsed = JSON.parse(data);

                  if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                    fullResponse += parsed.delta.text;
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify({ text: parsed.delta.text })}\n\n`)
                    );
                  }

                  if (parsed.type === "message_stop") {
                    // Save assistant message to DB
                    await admin.from("chat_messages").insert({
                      session_id,
                      role: "assistant",
                      content: fullResponse,
                    });

                    // Update session title if this is the first exchange
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
                } catch {
                  // Skip unparseable lines
                }
              }
            }
          }
        } catch (err) {
          console.error("Stream error:", err);
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
    console.error("POST /api/chat error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
