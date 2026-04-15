"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, XIcon, SparkleIcon } from "@/components/ui/icons";
import { MessageBubble, ThinkingBubble, StreamingBubble } from "./message-bubble";
import { ChatApprovalCard } from "./ChatApprovalCard";
import { usePageContext, type PageContext } from "./page-context-provider";
import { useChatPanel } from "./chat-panel-provider";
import { readChatStream } from "@/lib/utils/chat-stream";
import type { LinkableRef } from "@/lib/utils/linkify";
import type { ChatSession, ChatMessage, ChatMessageMetadata } from "@/lib/types/chat";
import { validateUploadedFile } from "@/lib/validations";

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
  embedded?: boolean; // When true, renders without its own positioning/overlay (used in persistent panel)
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ChatDrawer({ isOpen, onClose, isMobile, embedded }: ChatDrawerProps) {
  const router = useRouter();
  const pageContext = usePageContext();
  const chatPanel = useChatPanel();

  // Session state
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [drawerFiles, setDrawerFiles] = useState<File[]>([]);
  const drawerFileInputRef = useRef<HTMLInputElement>(null);
  const prefillHandled = useRef(false);

  // Handle prefill from panel context (dashboard input, command palette, etc.)
  useEffect(() => {
    if (prefillHandled.current) return;
    const hasQuery = chatPanel.prefillQuery;
    const hasFiles = chatPanel.prefillFiles.length > 0;

    if (hasQuery || hasFiles) {
      prefillHandled.current = true;
      if (hasQuery) setInput(chatPanel.prefillQuery || "");
      if (hasFiles) setDrawerFiles(chatPanel.prefillFiles);
      chatPanel.clearPrefill();

      // Auto-send after a short delay to let the component mount
      setTimeout(() => {
        const query = hasQuery ? chatPanel.prefillQuery || "" : "";
        // Trigger send — the sendMessage function will pick up drawerFiles from state
        // We need to manually trigger since setDrawerFiles is async
        if (hasFiles || query.trim()) {
          // Use a custom event to trigger send after state updates
          window.dispatchEvent(new CustomEvent("rhodes:auto-send"));
        }
      }, 300);
    }
  }, [chatPanel.prefillQuery, chatPanel.prefillFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for auto-send trigger
  useEffect(() => {
    const handler = () => {
      if (input.trim() || drawerFiles.length > 0) {
        sendMessage(input);
      }
    };
    window.addEventListener("rhodes:auto-send", handler);
    return () => window.removeEventListener("rhodes:auto-send", handler);
  }, [input, drawerFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDrawerFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    const valid = selected.filter((f: File) => validateUploadedFile(f).valid);
    setDrawerFiles((prev) => [...prev, ...valid]);
    e.target.value = "";
  };
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [refs, setRefs] = useState<LinkableRef[]>([]);
  const [sessionLengthDismissed, setSessionLengthDismissed] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sessionPickerRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);

  // -------------------------------------------------------------------
  // Fetch sessions + entity refs (once on first open)
  // -------------------------------------------------------------------

  const fetchSessions = useCallback(async (): Promise<ChatSession[]> => {
    try {
      const res = await fetch("/api/chat/sessions");
      if (!res.ok) return [];
      const data: ChatSession[] = await res.json();
      setSessions(data);
      return data;
    } catch {
      return [];
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

  // -------------------------------------------------------------------
  // Load session messages
  // -------------------------------------------------------------------

  const loadSession = useCallback(async (sessionId: string) => {
    setActiveSessionId(sessionId);
    setMessages([]);
    setStreamingText("");
    setShowSessionPicker(false);
    setSessionLengthDismissed(false);
    try {
      localStorage.setItem("rhodes_chat_session", sessionId);
    } catch {
      // ignore
    }
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}`);
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data.messages || []);
    } catch {
      // Non-critical
    }
  }, []);

  // -------------------------------------------------------------------
  // Initialize on first open: fetch sessions, refs, then resume the saved
  // session (or the most recent one) so the drawer feels like a running
  // notepad across page reloads.
  // -------------------------------------------------------------------

  useEffect(() => {
    if (isOpen && !initializedRef.current) {
      initializedRef.current = true;
      fetchRefs();
      (async () => {
        const fetched = await fetchSessions();
        let savedSessionId: string | null = null;
        try {
          savedSessionId = localStorage.getItem("rhodes_chat_session");
        } catch {
          // ignore
        }
        const resumeId =
          savedSessionId && fetched.find((s) => s.id === savedSessionId)
            ? savedSessionId
            : fetched[0]?.id || null;
        if (resumeId) {
          loadSession(resumeId);
        }
      })();
    }
  }, [isOpen, fetchSessions, fetchRefs, loadSession]);

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
      try {
        localStorage.setItem("rhodes_chat_session", session.id);
      } catch {
        // ignore
      }
      setMessages([]);
      setStreamingText("");
      setInput("");
      setSessionLengthDismissed(false);
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
      const hasFiles = drawerFiles.length > 0;
      if (!text.trim() && !hasFiles) return;
      if (sending) return;

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
          try {
            localStorage.setItem("rhodes_chat_session", sessionId);
          } catch {
            // ignore
          }
        } catch {
          return;
        }
      }

      // Optimistic user message — capture page_context so the divider logic
      // can detect when the user moved between pages mid-conversation.
      const content = text.trim() || (hasFiles ? `Uploaded ${drawerFiles.length} file${drawerFiles.length !== 1 ? "s" : ""}` : "");
      const optimisticMeta: ChatMessageMetadata = {};
      if (hasFiles) {
        optimisticMeta.attachments = drawerFiles.map((f) => ({
          queue_item_id: "",
          document_id: null,
          filename: f.name,
          status: "uploading" as const,
        }));
      }
      if (pageContext) {
        optimisticMeta.page_context = {
          page: pageContext.page,
          entityId: pageContext.entityId,
          entityName: pageContext.entityName,
          investmentId: pageContext.investmentId,
          investmentName: pageContext.investmentName,
        };
      }
      const userMsg: ChatMessage = {
        id: `temp-${Date.now()}`,
        session_id: sessionId,
        role: "user",
        content,
        metadata: Object.keys(optimisticMeta).length > 0 ? optimisticMeta : null,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      const currentFiles = [...drawerFiles];
      setDrawerFiles([]);
      setSending(true);
      setStreamingText("");

      try {
        if (hasFiles) {
          // === FILE UPLOAD PATH ===
          const formData = new FormData();
          formData.append("session_id", sessionId);
          formData.append("message", text.trim());
          if (pageContext) formData.append("page_context", JSON.stringify(pageContext));
          for (const file of currentFiles) formData.append("files", file);

          const res = await fetch("/api/chat", { method: "POST", body: formData });
          if (!res.ok) throw new Error("Upload failed");

          // Read SSE stream
          const reader = res.body?.getReader();
          if (reader) {
            const decoder = new TextDecoder();
            let buffer = "";
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";
              for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                try {
                  const event = JSON.parse(line.slice(6));
                  if (event.type === "results") {
                    const assistantMsg: ChatMessage = {
                      id: event.message_id || `temp-assistant-${Date.now()}`,
                      session_id: sessionId!,
                      role: "assistant",
                      content: event.summary || "Processing complete.",
                      metadata: {
                        batch_id: event.batch_id,
                        attachments: event.attachments,
                        proposed_actions: event.proposed_actions,
                        processing_status: "completed",
                      },
                      created_at: new Date().toISOString(),
                    };
                    setMessages((prev) => [...prev, assistantMsg]);
                  }
                } catch { /* skip */ }
              }
            }
          }
        } else {
          // === REGULAR CHAT PATH ===
          // Send page_context with EVERY message so Claude always sees the
          // user's current page, not just the page they were on when the
          // session started.
          const body: Record<string, unknown> = {
            session_id: sessionId,
            message: text.trim(),
          };
          if (pageContext) {
            body.page_context = pageContext;
          }

          const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

          if (!res.ok) throw new Error("Failed");

          // Check for follow-up result (SSE with type: "results")
          const resClone = res.clone();
          const firstChunk = await resClone.body?.getReader().read();
          const firstText = firstChunk?.value ? new TextDecoder().decode(firstChunk.value) : "";
          const isFollowUp = firstText.includes('"type":"results"') || firstText.includes('"type": "results"');

          if (isFollowUp) {
            const reader = res.body?.getReader();
            if (reader) {
              const decoder = new TextDecoder();
              let buf = "";
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += decoder.decode(value, { stream: true });
                const lines = buf.split("\n");
                buf = lines.pop() || "";
                for (const line of lines) {
                  if (!line.startsWith("data: ")) continue;
                  try {
                    const event = JSON.parse(line.slice(6));
                    if (event.type === "results") {
                      const assistantMsg: ChatMessage = {
                        id: event.message_id || `temp-assistant-${Date.now()}`,
                        session_id: sessionId!,
                        role: "assistant",
                        content: event.summary || "Here's what I'd suggest:",
                        metadata: {
                          batch_id: event.batch_id,
                          attachments: event.attachments,
                          proposed_actions: event.proposed_actions,
                          processing_status: "completed",
                        },
                        created_at: new Date().toISOString(),
                      };
                      setMessages((prev) => [...prev, assistantMsg]);
                    }
                  } catch { /* skip */ }
                }
              }
            }
          } else {
            const { text: fullText, result: streamResult } = await readChatStream(res, setStreamingText);
            if (streamResult && streamResult.proposed_actions && (streamResult.proposed_actions as unknown[]).length > 0) {
              // Response had proposed actions — show as approval card
              const assistantMsg: ChatMessage = {
                id: streamResult.message_id || `temp-assistant-${Date.now()}`,
                session_id: sessionId!,
                role: "assistant",
                content: streamResult.summary || fullText,
                metadata: {
                  proposed_actions: streamResult.proposed_actions as ChatMessageMetadata["proposed_actions"],
                  processing_status: "completed",
                },
                created_at: new Date().toISOString(),
              };
              setMessages((prev) => [...prev, assistantMsg]);
            } else if (fullText) {
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
          }
        }
        fetchSessions();
      } catch (err) {
        console.error(err);
      } finally {
        setSending(false);
      }
    },
    [activeSessionId, sending, drawerFiles, fetchSessions, pageContext]
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
            currentPageContext={pageContext}
          />

          {/* 50-msg soft suggestion */}
          {messages.length >= 50 && !sessionLengthDismissed && (
            <SessionLengthHint onDismiss={() => setSessionLengthDismissed(true)} onNewChat={createSession} />
          )}

          {/* Context bar */}
          {contextLabel && (
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
            files={drawerFiles}
            setFiles={setDrawerFiles}
            fileInputRef={drawerFileInputRef}
            onFileSelect={handleDrawerFileSelect}
          />
        </div>
      </>
    );
  }

  // Desktop: side drawer from right
  return (
    <>
      {/* Backdrop — skip in embedded mode */}
      {!embedded && (
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
      )}

      {/* Drawer panel */}
      <div
        style={embedded ? {
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          // Without minHeight:0 a flex child defaults to its content size
          // (auto), which lets the message list push the panel taller than
          // its parent and scrolls the whole page. This forces the drawer
          // to honor its parent's height so DrawerMessages can scroll on
          // its own.
          minHeight: 0,
        } : {
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
          currentPageContext={pageContext}
        />

        {/* 50-msg soft suggestion */}
        {messages.length >= 50 && !sessionLengthDismissed && (
          <SessionLengthHint onDismiss={() => setSessionLengthDismissed(true)} onNewChat={createSession} />
        )}

        {/* Context bar */}
        {contextLabel && (
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
          files={drawerFiles}
          setFiles={setDrawerFiles}
          fileInputRef={drawerFileInputRef}
          onFileSelect={handleDrawerFileSelect}
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

      {/* Expand to full page */}
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
  currentPageContext,
}: {
  messages: ChatMessage[];
  streamingText: string;
  sending: boolean;
  refs: LinkableRef[];
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  onSendPrompt: (text: string) => void;
  onClick: (e: React.MouseEvent) => void;
  compact?: boolean;
  currentPageContext: PageContext | null;
}) {
  if (messages.length === 0 && !streamingText && !sending) {
    // Empty state with suggested prompts
    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
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
      style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 12px 8px" }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {messages.map((msg, idx) => {
          const meta = msg.metadata as ChatMessageMetadata | null;
          const hasActions = meta?.proposed_actions && meta.proposed_actions.length > 0;
          const hasAttachments = meta?.attachments && meta.attachments.length > 0;

          // Page context divider — show when this message's page_context
          // differs from the previous user message's page_context.
          const divider = renderContextDivider(messages, idx, currentPageContext);

          return (
            <div key={msg.id}>
              {divider}
              <MessageBubble message={msg} refs={refs} compact={compact} />
              {msg.role === "user" && hasAttachments && (
                <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {meta!.attachments!.map((att, i) => (
                    <span key={i} style={{ fontSize: 10, color: "#6b6b76", background: "#f0eee8", padding: "1px 6px", borderRadius: 4 }}>
                      📄 {att.filename}
                    </span>
                  ))}
                </div>
              )}
              {msg.role === "assistant" && (hasActions || (hasAttachments && meta?.processing_status === "completed")) && (
                <ChatApprovalCard
                  messageId={msg.id}
                  metadata={meta!}
                  onActionsApplied={(summary) => {
                    // Refresh messages to show updated state
                    const confirmMsg: ChatMessage = {
                      id: `confirm-${Date.now()}`,
                      session_id: msg.session_id,
                      role: "assistant",
                      content: (() => {
                        let msg = summary.failed > 0
                          ? `Done — ${summary.applied} action${summary.applied !== 1 ? "s" : ""} applied, ${summary.failed} failed.`
                          : summary.applied > 0
                            ? `Done — ${summary.applied} action${summary.applied !== 1 ? "s" : ""} applied successfully.`
                            : "Skipped all actions. Documents filed without changes.";
                        if (summary.follow_up) msg += "\n\n" + summary.follow_up;
                        return msg;
                      })(),
                      metadata: null,
                      created_at: new Date().toISOString(),
                    };
                    // Can't easily add to messages from here without prop drilling
                    // The message is added but we need a callback
                  }}
                />
              )}
            </div>
          );
        })}
        {streamingText && <StreamingBubble text={streamingText} compact={compact} />}
        {sending && !streamingText && <ThinkingBubble />}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}

/**
 * Render a "Now viewing: …" divider before a message when the page context
 * shifted between this message and the previous user message in the same
 * session. Client-side only — never persisted.
 */
function renderContextDivider(
  messages: ChatMessage[],
  idx: number,
  currentPageContext: PageContext | null
): React.ReactNode {
  const msg = messages[idx];
  const meta = msg.metadata as ChatMessageMetadata | null;
  // We only mark dividers on user messages (the user is the one who navigated).
  if (msg.role !== "user") return null;

  // Find the previous user message's page_context to compare against.
  let prevContextLabel: string | null = null;
  for (let i = idx - 1; i >= 0; i--) {
    if (messages[i].role !== "user") continue;
    const prevMeta = messages[i].metadata as ChatMessageMetadata | null;
    prevContextLabel = pageContextLabel(prevMeta?.page_context || null);
    break;
  }

  const thisLabel = pageContextLabel(meta?.page_context || null);

  // First user message: only show divider if we have a label.
  if (idx === 0 || prevContextLabel === null) {
    if (!thisLabel) return null;
    return <ContextDivider label={thisLabel} />;
  }

  if (thisLabel && thisLabel !== prevContextLabel) {
    return <ContextDivider label={thisLabel} />;
  }

  // currentPageContext is unused here but kept in the signature for future
  // use cases (e.g. dividing before the streaming bubble).
  void currentPageContext;
  return null;
}

function pageContextLabel(
  ctx: ChatMessageMetadata["page_context"] | null
): string | null {
  if (!ctx) return null;
  if (ctx.entityName) return `${ctx.entityName} (Entity)`;
  if (ctx.investmentName) return `${ctx.investmentName} (Investment)`;
  if (ctx.page === "documents_list") return "Documents";
  if (ctx.page === "directory") return "Directory";
  if (ctx.page === "relationships") return "Relationships";
  if (ctx.page === "dashboard") return "Dashboard";
  return null;
}

function ContextDivider({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        margin: "6px 4px",
        color: "#9494a0",
        fontSize: 10,
        fontStyle: "italic",
        textTransform: "uppercase",
        letterSpacing: 0.4,
      }}
    >
      <div style={{ flex: 1, height: 1, background: "#e8e6df" }} />
      <span>Now viewing: {label}</span>
      <div style={{ flex: 1, height: 1, background: "#e8e6df" }} />
    </div>
  );
}

function SessionLengthHint({
  onDismiss,
  onNewChat,
}: {
  onDismiss: () => void;
  onNewChat: () => void;
}) {
  return (
    <div
      style={{
        padding: "8px 14px",
        borderTop: "1px solid #e8e6df",
        background: "#fef6e4",
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexShrink: 0,
        fontSize: 11,
        color: "#7a5a18",
      }}
    >
      <span style={{ flex: 1 }}>
        This conversation is getting long. Want to start a fresh one? Your history is saved.
      </span>
      <button
        onClick={onNewChat}
        style={{
          background: "#2d5a3d",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          padding: "4px 10px",
          fontSize: 11,
          fontWeight: 500,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        New chat
      </button>
      <button
        onClick={onDismiss}
        title="Dismiss"
        style={{
          background: "none",
          border: "none",
          color: "#7a5a18",
          cursor: "pointer",
          padding: 2,
          display: "flex",
          alignItems: "center",
        }}
      >
        <XIcon size={12} />
      </button>
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
  files,
  setFiles,
  fileInputRef,
  onFileSelect,
}: {
  input: string;
  setInput: (v: string) => void;
  sending: boolean;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  files: File[];
  setFiles: (f: File[]) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const hasContent = input.trim() || files.length > 0;

  return (
    <div
      style={{
        padding: "10px 12px",
        paddingBottom: `calc(10px + env(safe-area-inset-bottom, 0px))`,
        borderTop: "1px solid #e8e6df",
        background: "#ffffff",
        flexShrink: 0,
      }}
      onDragOver={(e) => { e.preventDefault(); }}
      onDrop={(e) => {
        e.preventDefault();
        const dropped = Array.from(e.dataTransfer.files);
        const valid = dropped.filter((f: File) => validateUploadedFile(f).valid);
        setFiles([...files, ...valid]);
      }}
    >
      {/* File chips */}
      {files.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
          {files.map((f, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 3,
              padding: "2px 6px", background: "#f0eee8", borderRadius: 5, fontSize: 11, color: "#1a1a1f",
            }}>
              📄 {f.name.length > 20 ? f.name.slice(0, 17) + "..." : f.name}
              <button onClick={() => setFiles(files.filter((_, j) => j !== i))}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#9494a0", fontSize: 12, padding: 0, lineHeight: 1 }}>✕</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        {/* File attach button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={sending}
          style={{
            width: 36, height: 36, borderRadius: 10,
            border: "1px solid #ddd9d0", background: "#f5f4f0",
            cursor: sending ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, color: "#6b6b76",
          }}
          title="Attach files"
        >
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <input ref={fileInputRef} type="file" multiple
          accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.xlsx,.docx,.doc,.xls"
          onChange={onFileSelect} style={{ display: "none" }} />

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
          disabled={!hasContent || sending}
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            border: "none",
            background: hasContent && !sending ? "#2d5a3d" : "#ddd9d0",
            color: hasContent && !sending ? "#ffffff" : "#9494a0",
            cursor: hasContent && !sending ? "pointer" : "not-allowed",
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
