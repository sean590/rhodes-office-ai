"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ChatIcon, SparkleIcon, PlusIcon, SearchIcon } from "@/components/ui/icons";
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

/**
 * Very minimal markdown-to-HTML for assistant messages.
 * Handles: **bold**, *italic*, `code`, ### headings, - bullet lists, \n\n paragraphs
 */
function renderMarkdown(text: string): string {
  let html = text
    // Escape HTML entities
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Code blocks (```)
    .replace(/```([\s\S]*?)```/g, '<pre style="background:#f0eeea;padding:10px 14px;border-radius:6px;font-size:12px;overflow-x:auto;margin:8px 0;font-family:monospace">$1</pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code style="background:#f0eeea;padding:1px 5px;border-radius:3px;font-size:12px;font-family:monospace">$1</code>')
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    // Italic
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    // Headings
    .replace(/^### (.+)$/gm, '<div style="font-weight:700;font-size:14px;margin:12px 0 4px">$1</div>')
    .replace(/^## (.+)$/gm, '<div style="font-weight:700;font-size:15px;margin:14px 0 6px">$1</div>')
    .replace(/^# (.+)$/gm, '<div style="font-weight:700;font-size:16px;margin:16px 0 6px">$1</div>')
    // Bullet lists
    .replace(/^- (.+)$/gm, '<div style="padding-left:16px;position:relative;margin:2px 0"><span style="position:absolute;left:4px">•</span>$1</div>')
    // Numbered lists
    .replace(/^(\d+)\. (.+)$/gm, '<div style="padding-left:20px;position:relative;margin:2px 0"><span style="position:absolute;left:0;font-weight:600">$1.</span>$2</div>')
    // Line breaks (double newline = paragraph break, single = <br>)
    .replace(/\n\n/g, '<div style="margin:10px 0"></div>')
    .replace(/\n/g, "<br>");

  return html;
}

/* ------------------------------------------------------------------ */
/*  Entity linking helper                                              */
/* ------------------------------------------------------------------ */

interface EntityRef {
  id: string;
  name: string;
}

function linkifyEntities(html: string, entities: EntityRef[]): string {
  // Sort longest names first to avoid partial matches
  const sorted = [...entities].sort((a, b) => b.name.length - a.name.length);
  let result = html;
  for (const entity of sorted) {
    // Escape special regex chars in entity name
    const escaped = entity.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Only replace text outside of existing HTML tags
    const regex = new RegExp(`(?<![">])\\b(${escaped})\\b(?![<"])`, "g");
    result = result.replace(
      regex,
      `<a href="/entities/${entity.id}" style="color:#2d5a3d;font-weight:600;text-decoration:underline;text-decoration-color:rgba(45,90,61,0.3);text-underline-offset:2px;cursor:pointer">$1</a>`
    );
  }
  return result;
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
  const [entities, setEntities] = useState<EntityRef[]>([]);
  const [sessionSearch, setSessionSearch] = useState("");
  const [mobileShowChat, setMobileShowChat] = useState(false);

  const isMobile = useIsMobile();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  const fetchEntities = useCallback(async () => {
    try {
      const res = await fetch("/api/entities");
      if (!res.ok) return;
      const data = await res.json();
      setEntities(
        (data || []).map((e: { id: string; name: string }) => ({
          id: e.id,
          name: e.name,
        }))
      );
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    fetchEntities();
  }, [fetchSessions, fetchEntities]);

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

        // Read SSE stream
        const reader = res.body?.getReader();
        if (!reader) throw new Error("No reader");

        const decoder = new TextDecoder();
        let buffer = "";
        let fullText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const parsed = JSON.parse(line.slice(6));
                if (parsed.text) {
                  fullText += parsed.text;
                  setStreamingText(fullText);
                }
              } catch {
                // Skip
              }
            }
          }
        }

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
                entities={entities}
              />
            ))}

            {/* Streaming message */}
            {streamingText && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-start",
                }}
              >
                <div
                  style={{
                    maxWidth: "85%",
                    padding: "14px 18px",
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
                      __html: renderMarkdown(streamingText),
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
            )}

            {/* Thinking indicator */}
            {sending && !streamingText && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-start",
                }}
              >
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
                  <span
                    style={{
                      fontSize: 12,
                      color: "#9494a0",
                      marginLeft: 4,
                    }}
                  >
                    Thinking...
                  </span>
                </div>
              </div>
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

/* ------------------------------------------------------------------ */
/*  MessageBubble sub-component                                        */
/* ------------------------------------------------------------------ */

function MessageBubble({
  message,
  entities,
}: {
  message: ChatMessage;
  entities: EntityRef[];
}) {
  const isUser = message.role === "user";

  const bubbleStyle: React.CSSProperties = isUser
    ? {
        maxWidth: "75%",
        padding: "12px 16px",
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
        maxWidth: "85%",
        padding: "14px 18px",
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

  // Assistant: render markdown + entity links
  let html = renderMarkdown(message.content);
  if (entities.length > 0) {
    html = linkifyEntities(html, entities);
  }

  return (
    <div style={alignStyle}>
      <div style={bubbleStyle}>
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}
