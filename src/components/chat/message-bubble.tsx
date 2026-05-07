"use client";

import { memo } from "react";
import { renderMarkdown } from "@/lib/utils/markdown";
import { linkifyReferences, LinkableRef } from "@/lib/utils/linkify";
import type { ChatMessage } from "@/lib/types/chat";
import { ToolCallTrace } from "./ToolCallTrace";
import { MessageFeedback } from "./MessageFeedback";
import { BatchHandoffCard } from "./BatchHandoffCard";

interface MessageBubbleProps {
  message: ChatMessage;
  refs: LinkableRef[];
  compact?: boolean;
}

export const MessageBubble = memo(function MessageBubble({ message, refs, compact }: MessageBubbleProps) {
  // Synthetic applied-message from the MCP approval flow. Rendered as a
  // faint divider instead of a full bubble — the approval card already
  // confirmed the action; this is just context for the next turn.
  if (message.metadata?.synthetic) {
    const applied = (message.metadata.applied_actions ?? []) as Array<{ summary: string }>;
    const failed = (message.metadata.failed_actions ?? []) as Array<{ summary: string; error: string }>;
    const count = applied.length + failed.length;
    return (
      <div
        data-testid="synthetic-divider"
        style={{
          display: "flex",
          justifyContent: "center",
          padding: "8px 0",
          fontSize: 11,
          color: "#8a8a92",
          fontStyle: "italic",
        }}
      >
        {failed.length === 0
          ? `✓ Applied ${count} change${count !== 1 ? "s" : ""}`
          : `✓ Applied ${applied.length}, ✗ ${failed.length} failed`}
      </div>
    );
  }

  // Batch-handoff message: the chat-drawer routed 6+ uploads to the pipeline
  // and emitted this system-style assistant note. The card has its own
  // Realtime subscription on the batch row, so headline + CTA stay live.
  if (message.metadata?.type === "batch_handoff" && message.metadata.batch_id) {
    const meta = message.metadata as {
      batch_id: string;
      file_count?: number;
      filenames?: string[];
    };
    return (
      <div style={{ display: "flex", justifyContent: "flex-start" }}>
        <BatchHandoffCard
          metadata={{
            batch_id: meta.batch_id,
            file_count: meta.file_count ?? 0,
            filenames: Array.isArray(meta.filenames) ? meta.filenames : [],
          }}
        />
      </div>
    );
  }

  const isUser = message.role === "user";

  const bubbleStyle: React.CSSProperties = isUser
    ? {
        maxWidth: compact ? "90%" : "75%",
        padding: compact ? "8px 12px" : "12px 16px",
        borderRadius: "16px 16px 4px 16px",
        background: "#e8f5e9",
        border: "1px solid #c8e6c9",
        fontSize: 13,
        lineHeight: 1.5,
        color: "#1a1a1f",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }
    : {
        maxWidth: compact ? "95%" : "85%",
        padding: compact ? "10px 14px" : "14px 18px",
        borderRadius: "16px 16px 16px 4px",
        background: "#ffffff",
        border: "1px solid #e8e6df",
        fontSize: 13,
        lineHeight: 1.6,
        color: "#1a1a1f",
      };

  const alignStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: isUser ? "flex-end" : "flex-start",
  };

  // Hide the placeholder message while streaming — StreamingBubble renders
  // the progressive text instead. The placeholder gets replaced with the
  // final content when the stream closes.
  if (message.metadata?.processing_status === "streaming") return null;

  if (isUser) {
    return (
      <div style={alignStyle}>
        <div style={bubbleStyle}>{message.content}</div>
      </div>
    );
  }

  // Assistant: render markdown + reference links
  let html = renderMarkdown(message.content);
  if (refs.length > 0) {
    html = linkifyReferences(html, refs);
  }

  // If this was an MCP v2 response (or legacy message carrying the same
  // metadata shape), render the collapsed tool-use trace underneath the
  // prose. Legacy messages without tool_calls render exactly as before.
  const toolCalls = message.metadata?.tool_calls;
  const showTrace = Array.isArray(toolCalls) && toolCalls.length > 0;

  return (
    <div style={alignStyle}>
      <div style={{ ...bubbleStyle, display: "flex", flexDirection: "column" }}>
        <div dangerouslySetInnerHTML={{ __html: html }} />
        {showTrace && <ToolCallTrace calls={toolCalls} />}
        <MessageFeedback message={message} />
      </div>
    </div>
  );
});

/**
 * Streaming indicator bubble (three animated dots + "Thinking...")
 */
export function ThinkingBubble() {
  return (
    <div style={{ display: "flex", justifyContent: "flex-start" }}>
      <div
        style={{
          padding: "14px 18px",
          borderRadius: "16px 16px 16px 4px",
          background: "#ffffff",
          border: "1px solid #e8e6df",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <div style={{ display: "flex", gap: 4 }}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#9494a0",
                display: "inline-block",
                animation: `dotPulse 1.4s ease-in-out ${i * 0.2}s infinite`,
              }}
            />
          ))}
          <style>{`@keyframes dotPulse { 0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1); } }`}</style>
        </div>
        <span style={{ fontSize: 12, color: "#9494a0", marginLeft: 4 }}>
          Thinking...
        </span>
      </div>
    </div>
  );
}

/**
 * Streaming text bubble with blinking cursor
 */
export function StreamingBubble({ text, compact }: { text: string; compact?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-start" }}>
      <div
        style={{
          maxWidth: compact ? "95%" : "85%",
          padding: compact ? "10px 14px" : "14px 18px",
          borderRadius: "16px 16px 16px 4px",
          background: "#ffffff",
          border: "1px solid #e8e6df",
          fontSize: 13,
          lineHeight: 1.6,
          color: "#1a1a1f",
        }}
      >
        <div
          dangerouslySetInnerHTML={{
            __html: renderMarkdown(text),
          }}
        />
        <span
          style={{
            display: "inline-block",
            width: 6,
            height: 16,
            background: "#2d5a3d",
            marginLeft: 2,
            verticalAlign: "text-bottom",
            animation: "blink 1s step-end infinite",
          }}
        />
        <style>{`@keyframes blink { 50% { opacity: 0; } }`}</style>
      </div>
    </div>
  );
}
