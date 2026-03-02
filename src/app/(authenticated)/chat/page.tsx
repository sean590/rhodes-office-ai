"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ChatIcon, SparkleIcon, PlusIcon, SearchIcon } from "@/components/ui/icons";
import { MessageBubble, ThinkingBubble, StreamingBubble } from "@/components/chat/message-bubble";
import { useSetPageContext } from "@/components/chat/page-context-provider";
import { readChatStream } from "@/lib/utils/chat-stream";
import type { LinkableRef } from "@/lib/utils/linkify";
import type { ChatSession, ChatMessage } from "@/lib/types/chat";
import { useIsMobile } from "@/hooks/use-mobile";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SUGGESTED_PROMPTS = [
  "Which entities are registered in multiple states?",
  "Who are the trustees of the Demetree Family Trust?",
  "Show me all overdue filings",
  "What entities does Sean Demetree manage?",
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ChatPage() {
  // State
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [refs, setRefs] = useState<LinkableRef[]>([]);
  const [sessionSearch, setSessionSearch] = useState("");
  const [mobileShowChat, setMobileShowChat] = useState(false);

  const isMobile = useIsMobile();
  const setPageContext = useSetPageContext();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Register page context (so drawer knows we're on /chat)
  useEffect(() => {
    setPageContext({ page: "chat" });
    return () => setPageContext(null);
  }, [setPageContext]);

  // -------------------------------------------------------------------
  // Fetch sessions
  // -------------------------------------------------------------------

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/sessions");
      if (!res.ok) throw new Error("Failed to fetch sessions");
      const data: ChatSession[] = await res.json();
      setSessions(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  // -------------------------------------------------------------------
  // Fetch entities (for linking)
  // -------------------------------------------------------------------

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
    fetchSessions();
    fetchRefs();
  }, [fetchSessions, fetchRefs]);

  // -------------------------------------------------------------------
  // Load a session's messages
  // -------------------------------------------------------------------

  const loadSession = useCallback(async (sessionId: string) => {
    setActiveSessionId(sessionId);
    setMobileShowChat(true);
    setMessages([]);
    setStreamingText("");
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}`);
      if (!res.ok) throw new Error("Failed to load session");
      const data = await res.json();
      setMessages(data.messages || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  // -------------------------------------------------------------------
  // Create a new session
  // -------------------------------------------------------------------

  const createSession = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New Chat" }),
      });
      if (!res.ok) throw new Error("Failed to create session");
      const session: ChatSession = await res.json();
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
      setMobileShowChat(true);
      setMessages([]);
      setStreamingText("");
      setInput("");
      inputRef.current?.focus();
    } catch (err) {
      console.error(err);
    }
  }, []);

  // -------------------------------------------------------------------
  // Send message
  // -------------------------------------------------------------------

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || sending) return;

      let sessionId = activeSessionId;

      // Create a session if none exists
      if (!sessionId) {
        try {
          const res = await fetch("/api/chat/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "New Chat" }),
          });
          if (!res.ok) throw new Error("Failed to create session");
          const session: ChatSession = await res.json();
          setSessions((prev) => [session, ...prev]);
          sessionId = session.id;
          setActiveSessionId(sessionId);
          setMobileShowChat(true);
        } catch (err) {
          console.error(err);
          return;
        }
      }

      // Optimistically add user message
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
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            message: text.trim(),
          }),
        });

        if (!res.ok) {
          throw new Error("Failed to send message");
        }

        const fullText = await readChatStream(res, setStreamingText);

        // Streaming complete — add assistant message
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

        // Refresh sessions to get updated title
        fetchSessions();
      } catch (err) {
        console.error(err);
      } finally {
        setSending(false);
      }
    },
    [activeSessionId, sending, fetchSessions]
  );

  // -------------------------------------------------------------------
  // Auto-scroll
  // -------------------------------------------------------------------

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  // -------------------------------------------------------------------
  // Filtered sessions
  // -------------------------------------------------------------------

  const filteredSessions = sessionSearch
    ? sessions.filter((s) =>
        s.title.toLowerCase().includes(sessionSearch.toLowerCase())
      )
    : sessions;

  // -------------------------------------------------------------------
  // Key handler for textarea
  // -------------------------------------------------------------------

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  // -------------------------------------------------------------------
  // Styles
  // -------------------------------------------------------------------

  const sidebarStyle: React.CSSProperties = isMobile
    ? {
        width: "100%",
        flexShrink: 0,
        background: "#ffffff",
        display: mobileShowChat ? "none" : "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }
    : {
        width: 280,
        flexShrink: 0,
        background: "#ffffff",
        borderRight: "1px solid #e8e6df",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      };

  const chatAreaStyle: React.CSSProperties = isMobile
    ? {
        flex: 1,
        display: mobileShowChat ? "flex" : "none",
        flexDirection: "column",
        height: "100%",
        background: "#f5f4f0",
        overflow: "hidden",
      }
    : {
        flex: 1,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#f5f4f0",
        overflow: "hidden",
      };

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------

  return (
    <div
      style={{
        display: "flex",
        height: "calc(100vh - 54px)",
        margin: "-28px",
        overflow: "hidden",
      }}
    >
      {/* ============================================================= */}
      {/* Sidebar                                                        */}
      {/* ============================================================= */}
      <div style={sidebarStyle}>
        {/* New Chat button */}
        <div style={{ padding: "16px 16px 12px" }}>
          <button
            onClick={createSession}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              width: "100%",
              padding: "9px 12px",
              borderRadius: 8,
              border: "1px solid #e8e6df",
              background: "#ffffff",
              color: "#2d5a3d",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background =
                "rgba(45,90,61,0.06)";
              (e.currentTarget as HTMLElement).style.borderColor = "#2d5a3d";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "#ffffff";
              (e.currentTarget as HTMLElement).style.borderColor = "#e8e6df";
            }}
          >
            <PlusIcon size={14} />
            New Chat
          </button>
        </div>

        {/* Search */}
        <div style={{ padding: "0 16px 12px" }}>
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
            }}
          >
            <SearchIcon size={13} />
            <input
              type="text"
              placeholder="Search chats..."
              value={sessionSearch}
              onChange={(e) => setSessionSearch(e.target.value)}
              style={{
                width: "100%",
                border: "none",
                background: "transparent",
                fontSize: 12,
                color: "#1a1a1f",
                padding: "4px 8px",
                outline: "none",
                fontFamily: "inherit",
              }}
            />
          </div>
          <div
            style={{
              borderBottom: "1px solid #e8e6df",
              marginTop: 4,
            }}
          />
        </div>

        {/* Sessions list */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "0 8px",
          }}
        >
          {loadingSessions && (
            <div
              style={{
                padding: 16,
                textAlign: "center",
                fontSize: 12,
                color: "#9494a0",
              }}
            >
              Loading...
            </div>
          )}

          {!loadingSessions && filteredSessions.length === 0 && (
            <div
              style={{
                padding: "24px 16px",
                textAlign: "center",
                fontSize: 12,
                color: "#9494a0",
              }}
            >
              {sessionSearch
                ? "No matching chats"
                : "No chats yet. Start a conversation!"}
            </div>
          )}

          {filteredSessions.map((session) => {
            const isActive = session.id === activeSessionId;
            return (
              <button
                key={session.id}
                onClick={() => loadSession(session.id)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: isMobile ? "14px 16px" : "10px 12px",
                  borderRadius: 6,
                  border: "none",
                  background: isActive ? "rgba(45,90,61,0.08)" : "transparent",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  marginBottom: 2,
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => {
                  if (!isActive)
                    (e.currentTarget as HTMLElement).style.background =
                      "#f5f4f0";
                }}
                onMouseLeave={(e) => {
                  if (!isActive)
                    (e.currentTarget as HTMLElement).style.background =
                      "transparent";
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 500,
                    color: isActive ? "#2d5a3d" : "#1a1a1f",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {session.title}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "#9494a0",
                    marginTop: 2,
                  }}
                >
                  {relativeTime(session.updated_at)}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ============================================================= */}
      {/* Chat Area                                                      */}
      {/* ============================================================= */}
      <div style={chatAreaStyle}>
        {/* ----------------------------------------------------------- */}
        {/* Mobile back header                                           */}
        {/* ----------------------------------------------------------- */}
        {isMobile && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 16px",
              borderBottom: "1px solid #e8e6df",
              background: "#ffffff",
              flexShrink: 0,
            }}
          >
            <button
              onClick={() => setMobileShowChat(false)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 32,
                height: 32,
                borderRadius: 8,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: "#2d5a3d",
                fontSize: 18,
                fontFamily: "inherit",
                flexShrink: 0,
              }}
            >
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "#1a1a1f",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: 1,
              }}
            >
              {sessions.find((s) => s.id === activeSessionId)?.title || "New Chat"}
            </div>
          </div>
        )}

        {/* ----------------------------------------------------------- */}
        {/* Messages area                                                */}
        {/* ----------------------------------------------------------- */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: isMobile ? "16px 12px 12px" : "24px 24px 16px",
          }}
        >
          {/* Empty state */}
          {!activeSessionId && messages.length === 0 && !loadingMessages && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                padding: "40px 20px",
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 16,
                  background:
                    "linear-gradient(135deg, #2d5a3d, #3d7a53)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 20,
                  color: "#ffffff",
                }}
              >
                <ChatIcon size={28} />
              </div>
              <h2
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: "#1a1a1f",
                  margin: "0 0 8px",
                }}
              >
                Rhodes AI
              </h2>
              <p
                style={{
                  fontSize: 13,
                  color: "#9494a0",
                  margin: "0 0 32px",
                  maxWidth: 400,
                  textAlign: "center",
                  lineHeight: 1.5,
                }}
              >
                Ask questions about your entities, relationships, compliance
                filings, and organizational structure.
              </p>

              {/* Suggested prompts */}
              <div
                style={isMobile ? {
                  display: "flex",
                  overflowX: "auto",
                  flexWrap: "nowrap",
                  WebkitOverflowScrolling: "touch",
                  gap: 10,
                  width: "100%",
                  paddingBottom: 4,
                } : {
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                  maxWidth: 560,
                  width: "100%",
                }}
              >
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => {
                      setInput(prompt);
                      sendMessage(prompt);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      padding: "14px 16px",
                      borderRadius: 8,
                      border: "1px solid #e8e6df",
                      background: "#ffffff",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      textAlign: "left",
                      transition: "all 0.15s",
                      ...(isMobile ? { flexShrink: 0, minWidth: 200 } : {}),
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.borderColor =
                        "#2d5a3d";
                      (e.currentTarget as HTMLElement).style.background =
                        "rgba(45,90,61,0.04)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.borderColor =
                        "#e8e6df";
                      (e.currentTarget as HTMLElement).style.background =
                        "#ffffff";
                    }}
                  >
                    <SparkleIcon size={14} />
                    <span
                      style={{
                        fontSize: 13,
                        color: "#1a1a1f",
                        lineHeight: 1.4,
                      }}
                    >
                      {prompt}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Active session empty state */}
          {activeSessionId &&
            messages.length === 0 &&
            !loadingMessages &&
            !streamingText && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "100%",
                  padding: "40px 20px",
                }}
              >
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 14,
                    background:
                      "linear-gradient(135deg, #2d5a3d, #3d7a53)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 16,
                    color: "#fff",
                  }}
                >
                  <SparkleIcon size={22} />
                </div>
                <p
                  style={{
                    fontSize: 14,
                    color: "#9494a0",
                    margin: 0,
                  }}
                >
                  Ask me anything about your entities...
                </p>

                {/* Suggested prompts (compact) */}
                <div
                  style={isMobile ? {
                    display: "flex",
                    overflowX: "auto",
                    flexWrap: "nowrap",
                    WebkitOverflowScrolling: "touch",
                    gap: 8,
                    marginTop: 24,
                    width: "100%",
                    paddingBottom: 4,
                  } : {
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    marginTop: 24,
                    justifyContent: "center",
                    maxWidth: 500,
                  }}
                >
                  {SUGGESTED_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => {
                        setInput(prompt);
                        sendMessage(prompt);
                      }}
                      style={{
                        padding: "7px 14px",
                        borderRadius: 20,
                        border: "1px solid #e8e6df",
                        background: "#ffffff",
                        fontSize: 12,
                        color: "#6b6b76",
                        cursor: "pointer",
                        fontFamily: "inherit",
                        transition: "all 0.15s",
                        ...(isMobile ? { flexShrink: 0, minWidth: 200 } : {}),
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.borderColor =
                          "#2d5a3d";
                        (e.currentTarget as HTMLElement).style.color =
                          "#2d5a3d";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.borderColor =
                          "#e8e6df";
                        (e.currentTarget as HTMLElement).style.color =
                          "#6b6b76";
                      }}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

          {/* Loading messages */}
          {loadingMessages && (
            <div
              style={{
                textAlign: "center",
                padding: 40,
                fontSize: 13,
                color: "#9494a0",
              }}
            >
              Loading messages...
            </div>
          )}

          {/* Message bubbles */}
          <div
            style={{
              maxWidth: 720,
              margin: "0 auto",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                refs={refs}
              />
            ))}

            {/* Streaming message */}
            {streamingText && (
              <StreamingBubble text={streamingText} />
            )}

            {/* Thinking indicator */}
            {sending && !streamingText && (
              <ThinkingBubble />
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* ----------------------------------------------------------- */}
        {/* Input area                                                   */}
        {/* ----------------------------------------------------------- */}
        <div
          style={{
            padding: isMobile ? "10px 12px 16px" : "12px 24px 20px",
            borderTop: "1px solid #e8e6df",
            background: "#ffffff",
            ...(isMobile ? { position: "sticky" as const, bottom: 0, flexShrink: 0 } : {}),
          }}
        >
          <div
            style={{
              maxWidth: 720,
              margin: "0 auto",
              display: "flex",
              gap: 10,
              alignItems: "flex-end",
            }}
          >
            <div
              style={{
                flex: 1,
                position: "relative",
              }}
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your entities..."
                rows={1}
                style={{
                  width: "100%",
                  border: "1px solid #ddd9d0",
                  borderRadius: 12,
                  padding: "12px 16px",
                  fontSize: 13,
                  fontFamily: "inherit",
                  color: "#1a1a1f",
                  outline: "none",
                  resize: "none",
                  minHeight: 44,
                  maxHeight: 120,
                  lineHeight: 1.5,
                  boxSizing: "border-box",
                  background: "#f5f4f0",
                  transition: "border-color 0.15s",
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
            </div>
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || sending}
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                border: "none",
                background:
                  input.trim() && !sending ? "#2d5a3d" : "#ddd9d0",
                color: input.trim() && !sending ? "#ffffff" : "#9494a0",
                cursor:
                  input.trim() && !sending ? "pointer" : "not-allowed",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                transition: "all 0.15s",
              }}
            >
              <svg
                width={18}
                height={18}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
          <div
            style={{
              maxWidth: 720,
              margin: "6px auto 0",
              textAlign: "center",
              fontSize: 11,
              color: "#9494a0",
            }}
          >
            Powered by Claude. Press Enter to send, Shift+Enter for new
            line.
          </div>
        </div>
      </div>
    </div>
  );
}
