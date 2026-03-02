"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, XIcon, SparkleIcon } from "@/components/ui/icons";
import { MessageBubble, ThinkingBubble, StreamingBubble } from "./message-bubble";
import { usePageContext } from "./page-context-provider";
import { readChatStream } from "@/lib/utils/chat-stream";
import type { LinkableRef } from "@/lib/utils/linkify";
import type { ChatSession, ChatMessage } from "@/lib/types/chat";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const DRAWER_PROMPTS = [
  "What entities are overdue on filings?",
  "Who manages this entity?",
  "Show me recent documents",
  "Summarize compliance status",
];

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface ChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  isMobile: boolean;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ChatDrawer({ isOpen, onClose, isMobile }: ChatDrawerProps) {
  const router = useRouter();
  const pageContext = usePageContext();

  // Session state
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [refs, setRefs] = useState<LinkableRef[]>([]);
  const [contextSent, setContextSent] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sessionPickerRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);

  // -------------------------------------------------------------------
  // Fetch sessions + entity refs (once on first open)
  // -------------------------------------------------------------------

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/sessions");
      if (!res.ok) return;
      const data: ChatSession[] = await res.json();
      setSessions(data);
    } catch {
      // Non-critical
    }
  }, []);

  const fetchRefs = useCallback(async () => {
    try {
      const res = await fetch("/api/entities");
      if (!res.ok) return;
      const data = await res.json();
      setRefs(
        (data || []).map((e: { id: string; name: string }) => ({
          id: e.id,
          name: e.name,
          type: "entity" as const,
          href: `/entities/${e.id}`,
        }))
      );
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => {
    if (isOpen && !initializedRef.current) {
      initializedRef.current = true;
      fetchSessions();
      fetchRefs();
    }
  }, [isOpen, fetchSessions, fetchRefs]);

  // -------------------------------------------------------------------
  // Load session messages
  // -------------------------------------------------------------------

  const loadSession = useCallback(async (sessionId: string) => {
    setActiveSessionId(sessionId);
    setMessages([]);
    setStreamingText("");
    setShowSessionPicker(false);
    setContextSent(false);
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}`);
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data.messages || []);
      // If session has messages, context was already sent
      if ((data.messages || []).length > 0) setContextSent(true);
    } catch {
      // Non-critical
    }
  }, []);

  // -------------------------------------------------------------------
  // Create new session
  // -------------------------------------------------------------------

  const createSession = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New Chat" }),
      });
      if (!res.ok) return;
      const session: ChatSession = await res.json();
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
      setMessages([]);
      setStreamingText("");
      setInput("");
      setContextSent(false);
      setShowSessionPicker(false);
      inputRef.current?.focus();
    } catch {
      // Non-critical
    }
  }, []);

  // -------------------------------------------------------------------
  // Send message
  // -------------------------------------------------------------------

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || sending) return;

      let sessionId = activeSessionId;

      // Create session if none exists
      if (!sessionId) {
        try {
          const res = await fetch("/api/chat/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "New Chat" }),
          });
          if (!res.ok) return;
          const session: ChatSession = await res.json();
          setSessions((prev) => [session, ...prev]);
          sessionId = session.id;
          setActiveSessionId(sessionId);
        } catch {
          return;
        }
      }

      // Optimistic user message
      const userMsg: ChatMessage = {
        id: `temp-${Date.now()}`,
        session_id: sessionId,
        role: "user",
        content: text.trim(),
        metadata: null,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setSending(true);
      setStreamingText("");

      try {
        // Build request body — include page context on first message of session
        const body: Record<string, unknown> = {
          session_id: sessionId,
          message: text.trim(),
        };
        if (!contextSent && pageContext) {
          body.page_context = pageContext;
          setContextSent(true);
        }

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!res.ok) throw new Error("Failed");

        const fullText = await readChatStream(res, setStreamingText);

        if (fullText) {
          const assistantMsg: ChatMessage = {
            id: `temp-assistant-${Date.now()}`,
            session_id: sessionId,
            role: "assistant",
            content: fullText,
            metadata: null,
            created_at: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, assistantMsg]);
        }
        setStreamingText("");
        fetchSessions();
      } catch (err) {
        console.error(err);
      } finally {
        setSending(false);
      }
    },
    [activeSessionId, sending, fetchSessions, contextSent, pageContext]
  );

  // -------------------------------------------------------------------
  // Auto-scroll
  // -------------------------------------------------------------------

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  // -------------------------------------------------------------------
  // Close session picker on outside click
  // -------------------------------------------------------------------

  useEffect(() => {
    if (!showSessionPicker) return;
    const handler = (e: MouseEvent) => {
      if (sessionPickerRef.current && !sessionPickerRef.current.contains(e.target as Node)) {
        setShowSessionPicker(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSessionPicker]);

  // -------------------------------------------------------------------
  // Close on Escape
  // -------------------------------------------------------------------

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  // -------------------------------------------------------------------
  // Intercept link clicks inside drawer to navigate via router
  // -------------------------------------------------------------------

  const handleContentClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      const link = target.closest("a");
      if (link && link.href) {
        const url = new URL(link.href, window.location.origin);
        if (url.origin === window.location.origin) {
          e.preventDefault();
          router.push(url.pathname + url.search);
        }
      }
    },
    [router]
  );

  // -------------------------------------------------------------------
  // Key handler
  // -------------------------------------------------------------------

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  // -------------------------------------------------------------------
  // Context bar text
  // -------------------------------------------------------------------

  const contextLabel = pageContext?.entityName
    ? `Viewing: ${pageContext.entityName}`
    : pageContext?.page === "documents_list"
    ? "Viewing: Documents"
    : pageContext?.page === "directory"
    ? "Viewing: Directory"
    : pageContext?.page === "relationships"
    ? "Viewing: Relationships"
    : null;

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------

  // Backdrop + drawer panel
  if (isMobile) {
    // Mobile: bottom sheet
    return (
      <>
        {/* Backdrop */}
        <div
          onClick={onClose}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.3)",
            zIndex: 50,
            opacity: isOpen ? 1 : 0,
            pointerEvents: isOpen ? "auto" : "none",
            transition: "opacity 0.25s ease",
          }}
        />

        {/* Bottom sheet */}
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            height: "85vh",
            background: "#ffffff",
            borderRadius: "16px 16px 0 0",
            boxShadow: "0 -4px 20px rgba(0,0,0,0.15)",
            zIndex: 52,
            display: "flex",
            flexDirection: "column",
            transform: isOpen ? "translateY(0)" : "translateY(100%)",
            transition: "transform 0.3s ease",
          }}
        >
          {/* Drag handle */}
          <div
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: "#ddd9d0",
              margin: "8px auto 0",
            }}
          />

          {/* Header */}
          <DrawerHeader
            sessions={sessions}
            activeSessionId={activeSessionId}
            showSessionPicker={showSessionPicker}
            setShowSessionPicker={setShowSessionPicker}
            sessionPickerRef={sessionPickerRef}
            onCreateSession={createSession}
            onLoadSession={loadSession}
            onClose={onClose}
            onExpand={() => {
              onClose();
              router.push("/chat");
            }}
            isMobile
          />

          {/* Messages */}
          <DrawerMessages
            messages={messages}
            streamingText={streamingText}
            sending={sending}
            refs={refs}
            messagesEndRef={messagesEndRef}
            onSendPrompt={sendMessage}
            onClick={handleContentClick}
            compact
          />

          {/* Context bar */}
          {contextLabel && !contextSent && (
            <ContextBar label={contextLabel} />
          )}

          {/* Input */}
          <DrawerInput
            input={input}
            setInput={setInput}
            sending={sending}
            onSend={() => sendMessage(input)}
            onKeyDown={handleKeyDown}
            inputRef={inputRef}
          />
        </div>
      </>
    );
  }

  // Desktop: side drawer from right
  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.2)",
          zIndex: 50,
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? "auto" : "none",
          transition: "opacity 0.25s ease",
        }}
      />

      {/* Drawer panel */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 400,
          background: "#ffffff",
          boxShadow: "-4px 0 20px rgba(0,0,0,0.1)",
          zIndex: 52,
          display: "flex",
          flexDirection: "column",
          transform: isOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.25s ease",
        }}
      >
        {/* Header */}
        <DrawerHeader
          sessions={sessions}
          activeSessionId={activeSessionId}
          showSessionPicker={showSessionPicker}
          setShowSessionPicker={setShowSessionPicker}
          sessionPickerRef={sessionPickerRef}
          onCreateSession={createSession}
          onLoadSession={loadSession}
          onClose={onClose}
          onExpand={() => {
            onClose();
            router.push("/chat");
          }}
          isMobile={false}
        />

        {/* Messages */}
        <DrawerMessages
          messages={messages}
          streamingText={streamingText}
          sending={sending}
          refs={refs}
          messagesEndRef={messagesEndRef}
          onSendPrompt={sendMessage}
          onClick={handleContentClick}
          compact
        />

        {/* Context bar */}
        {contextLabel && !contextSent && (
          <ContextBar label={contextLabel} />
        )}

        {/* Input */}
        <DrawerInput
          input={input}
          setInput={setInput}
          sending={sending}
          onSend={() => sendMessage(input)}
          onKeyDown={handleKeyDown}
          inputRef={inputRef}
        />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function DrawerHeader({
  sessions,
  activeSessionId,
  showSessionPicker,
  setShowSessionPicker,
  sessionPickerRef,
  onCreateSession,
  onLoadSession,
  onClose,
  onExpand,
  isMobile,
}: {
  sessions: ChatSession[];
  activeSessionId: string | null;
  showSessionPicker: boolean;
  setShowSessionPicker: (v: boolean) => void;
  sessionPickerRef: React.RefObject<HTMLDivElement | null>;
  onCreateSession: () => void;
  onLoadSession: (id: string) => void;
  onClose: () => void;
  onExpand: () => void;
  isMobile: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 14px",
        borderBottom: "1px solid #e8e6df",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: 6,
          background: "linear-gradient(135deg, #2d5a3d, #3d7a53)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          color: "#fff",
        }}
      >
        <SparkleIcon size={12} />
      </div>
      <span
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "#1a1a1f",
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        Rhodes AI
      </span>

      {/* Session picker */}
      <div ref={sessionPickerRef} style={{ position: "relative" }}>
        <button
          onClick={() => setShowSessionPicker(!showSessionPicker)}
          style={{
            background: "none",
            border: "1px solid #e8e6df",
            borderRadius: 6,
            padding: "3px 8px",
            fontSize: 11,
            color: "#6b6b76",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {activeSessionId
            ? sessions.find((s) => s.id === activeSessionId)?.title?.slice(0, 20) || "Chat"
            : "Sessions"}
          {" \u25BE"}
        </button>

        {showSessionPicker && (
          <div
            style={{
              position: "absolute",
              top: "100%",
              right: 0,
              marginTop: 4,
              width: 240,
              maxHeight: 300,
              overflowY: "auto",
              background: "#ffffff",
              border: "1px solid #ddd9d0",
              borderRadius: 8,
              boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
              zIndex: 10,
            }}
          >
            {sessions.slice(0, 5).map((s) => (
              <button
                key={s.id}
                onClick={() => onLoadSession(s.id)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  border: "none",
                  borderBottom: "1px solid #f0eee8",
                  background: s.id === activeSessionId ? "rgba(45,90,61,0.08)" : "transparent",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: s.id === activeSessionId ? 600 : 400,
                    color: "#1a1a1f",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.title}
                </div>
              </button>
            ))}
            <button
              onClick={onExpand}
              style={{
                display: "block",
                width: "100%",
                textAlign: "center",
                padding: "8px 12px",
                border: "none",
                background: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 12,
                color: "#2d5a3d",
                fontWeight: 600,
              }}
            >
              View All Chats
            </button>
          </div>
        )}
      </div>

      {/* New chat button */}
      <button
        onClick={onCreateSession}
        title="New Chat"
        style={{
          background: "none",
          border: "1px solid #e8e6df",
          borderRadius: 6,
          width: 28,
          height: 28,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        <PlusIcon size={14} />
      </button>

      {/* Expand to full page (mobile) */}
      {isMobile && (
        <button
          onClick={onExpand}
          title="Full screen"
          style={{
            background: "none",
            border: "1px solid #e8e6df",
            borderRadius: 6,
            width: 28,
            height: 28,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>
      )}

      {/* Close */}
      <button
        onClick={onClose}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 4,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <XIcon size={16} />
      </button>
    </div>
  );
}

function DrawerMessages({
  messages,
  streamingText,
  sending,
  refs,
  messagesEndRef,
  onSendPrompt,
  onClick,
  compact,
}: {
  messages: ChatMessage[];
  streamingText: string;
  sending: boolean;
  refs: LinkableRef[];
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  onSendPrompt: (text: string) => void;
  onClick: (e: React.MouseEvent) => void;
  compact?: boolean;
}) {
  if (messages.length === 0 && !streamingText && !sending) {
    // Empty state with suggested prompts
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px 16px",
          overflowY: "auto",
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: "linear-gradient(135deg, #2d5a3d, #3d7a53)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 12,
            color: "#fff",
          }}
        >
          <SparkleIcon size={18} />
        </div>
        <p style={{ fontSize: 13, color: "#9494a0", margin: "0 0 20px", textAlign: "center" }}>
          Ask about your entities, filings, or documents...
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
          {DRAWER_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              onClick={() => onSendPrompt(prompt)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid #e8e6df",
                background: "#ffffff",
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "left",
                fontSize: 12,
                color: "#1a1a1f",
                transition: "border-color 0.15s",
              }}
            >
              <SparkleIcon size={11} />
              {prompt}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      style={{ flex: 1, overflowY: "auto", padding: "12px 12px 8px" }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} refs={refs} compact={compact} />
        ))}
        {streamingText && <StreamingBubble text={streamingText} compact={compact} />}
        {sending && !streamingText && <ThinkingBubble />}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}

function ContextBar({ label }: { label: string }) {
  return (
    <div
      style={{
        padding: "6px 14px",
        borderTop: "1px solid #e8e6df",
        background: "rgba(45,90,61,0.04)",
        display: "flex",
        alignItems: "center",
        gap: 6,
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize: 11, color: "#2d5a3d", fontWeight: 500 }}>
        {"\uD83D\uDCCD"} {label}
      </span>
    </div>
  );
}

function DrawerInput({
  input,
  setInput,
  sending,
  onSend,
  onKeyDown,
  inputRef,
}: {
  input: string;
  setInput: (v: string) => void;
  sending: boolean;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  return (
    <div
      style={{
        padding: "10px 12px",
        paddingBottom: `calc(10px + env(safe-area-inset-bottom, 0px))`,
        borderTop: "1px solid #e8e6df",
        background: "#ffffff",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask Rhodes..."
          rows={1}
          style={{
            flex: 1,
            border: "1px solid #ddd9d0",
            borderRadius: 10,
            padding: "10px 12px",
            fontSize: 13,
            fontFamily: "inherit",
            color: "#1a1a1f",
            outline: "none",
            resize: "none",
            minHeight: 40,
            maxHeight: 100,
            lineHeight: 1.5,
            boxSizing: "border-box",
            background: "#f5f4f0",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "#2d5a3d";
            e.currentTarget.style.background = "#ffffff";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "#ddd9d0";
            e.currentTarget.style.background = "#f5f4f0";
          }}
          disabled={sending}
        />
        <button
          onClick={onSend}
          disabled={!input.trim() || sending}
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            border: "none",
            background: input.trim() && !sending ? "#2d5a3d" : "#ddd9d0",
            color: input.trim() && !sending ? "#ffffff" : "#9494a0",
            cursor: input.trim() && !sending ? "pointer" : "not-allowed",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
