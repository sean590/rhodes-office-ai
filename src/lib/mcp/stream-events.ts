/**
 * Stream event types shared between the SSE backend and the client-side
 * parser. Each event maps to an `event: <type>\ndata: <json>\n\n` frame
 * in the SSE response.
 */

import type { StagedAction } from "./staging";

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; id: string; name: string; index: number }
  | {
      type: "tool_complete";
      id: string;
      name: string;
      ok: boolean;
      durationMs: number;
      error?: string;
      index: number;
    }
  | {
      type: "tool_staged";
      id: string;
      tool: string;
      summary: string;
      resource_preview?: unknown;
    }
  | { type: "iteration"; iteration: number; toolCallsSoFar: number }
  | { type: "error"; message: string; partial_text?: string }
  | {
      type: "done";
      text: string;
      toolCalls: Array<{
        name: string;
        args: Record<string, unknown>;
        ok: boolean;
        durationMs: number;
        error?: string;
      }>;
      stagedActions: StagedAction[];
      iterations: number;
      truncated: boolean;
      stopReason: string | null;
      messageId?: string;
    };
