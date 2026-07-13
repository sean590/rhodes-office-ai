/**
 * SSE parser for the MCP chat streaming response. Reads frames from a
 * ReadableStream, parses `event:` + `data:` lines, and dispatches to
 * typed callbacks. Handles partial chunks correctly (SSE frames can
 * split across TCP packets).
 */

import type { StreamEvent } from "@/lib/mcp/stream-events";

export interface StreamEventHandlers {
  onTextDelta?: (data: { text: string }) => void;
  onToolStart?: (data: { id: string; name: string; index: number }) => void;
  onToolComplete?: (data: {
    id: string;
    name: string;
    ok: boolean;
    durationMs: number;
    error?: string;
    index: number;
  }) => void;
  onToolStaged?: (data: {
    id: string;
    tool: string;
    summary: string;
    resource_preview?: unknown;
  }) => void;
  onIteration?: (data: { iteration: number; toolCallsSoFar: number }) => void;
  onError?: (data: { message: string }) => void;
  onDone?: (data: StreamEvent & { type: "done" }) => void;
}

/**
 * Read all SSE events from the stream, dispatching to handlers as each
 * frame completes. Resolves when the stream closes.
 */
export async function readStreamEvents(
  body: ReadableStream<Uint8Array>,
  handlers: StreamEventHandlers,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are delimited by double-newline.
      const frames = buffer.split("\n\n");
      // Last element is either empty (clean split) or a partial frame.
      buffer = frames.pop() || "";

      for (const frame of frames) {
        if (!frame.trim()) continue;
        let eventType = "";
        let dataStr = "";
        for (const line of frame.split("\n")) {
          if (line.startsWith("event: ")) eventType = line.slice(7).trim();
          else if (line.startsWith("data: ")) dataStr = line.slice(6);
        }
        if (!eventType || !dataStr) continue;

        try {
          const data = JSON.parse(dataStr);
          switch (eventType) {
            case "text_delta":
              handlers.onTextDelta?.(data);
              break;
            case "tool_start":
              handlers.onToolStart?.(data);
              break;
            case "tool_complete":
              handlers.onToolComplete?.(data);
              break;
            case "tool_staged":
              handlers.onToolStaged?.(data);
              break;
            case "iteration":
              handlers.onIteration?.(data);
              break;
            case "error":
              handlers.onError?.(data);
              break;
            case "done":
              handlers.onDone?.(data);
              break;
          }
        } catch {
          // Malformed JSON — skip frame, don't crash.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
