"use client";

import { renderMarkdown } from "@/lib/utils/markdown";
import { linkifyReferences, LinkableRef } from "@/lib/utils/linkify";
import type { ChatMessage } from "@/lib/types/chat";

interface MessageBubbleProps {
  message: ChatMessage;
  refs: LinkableRef[];
  compact?: boolean;
}

export function MessageBubble({ message, refs, compact }: MessageBubbleProps) {
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

  return (
    <div style={alignStyle}>
      <div style={bubbleStyle}>
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}

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
