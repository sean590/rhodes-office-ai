"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, XIcon, SparkleIcon } from "@/components/ui/icons";
import { MessageBubble, ThinkingBubble, StreamingBubble } from "./message-bubble";
import { ChatApprovalCard } from "./ChatApprovalCard";
import { usePageContext, type PageContext } from "./page-context-provider";
import { useChatPanel } from "./chat-panel-provider";
import { readChatStream } from "@/lib/utils/chat-stream";
import { createClient } from "@/lib/supabase/client";
import { safeSubscribe } from "@/lib/supabase/safe-realtime";
import { readStreamEvents } from "@/lib/chat/stream-reader";
import type { StreamEvent } from "@/lib/mcp/stream-events";
import type { LinkableRef } from "@/lib/utils/linkify";
import type { ChatSession, ChatMessage, ChatMessageMetadata } from "@/lib/types/chat";
import { validateUploadedFile } from "@/lib/validations";
// uploadFilesToBatch was previously used by the BATCH MODE branch for 6+
// doc uploads; that branch was removed in Phase 3 of the chat unification
// (all uploads now go through the inline pipeline+chat path below). The
// /review page still uses uploadFilesToBatch directly.

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const DRAWER_PROMPTS = [
  "What entities are overdue on filings?",
  "Who manages this entity?",
  "Show me recent documents",
  "Summarize compliance status",
];

// When a chat upload contains more than this many files, skip the inline
// MCP orchestrator turn — Claude can't reliably read 6+ PDFs and stage all
// the corresponding link/update actions in a single turn (tool-call budget).
// Above the threshold, the files are routed to the pipeline in the background
// and a system-style "batch handoff" message is posted to the conversation.
// BATCH_THRESHOLD = 5 removed in Phase 3 of the chat unification. With the
// orchestrator now metadata-only (Phase 1) and the pipeline as sole
// extractor, the original rationale ("Claude can't read 6+ PDFs in one
// turn") no longer applies — Claude isn't reading any PDFs in any turn.
// All upload sizes flow through the unified inline pipeline+chat path.

/* ------------------------------------------------------------------ */
/*  Unread tracking                                                    */
/* ------------------------------------------------------------------ */

// Tracks the last time the user was actively viewing each session, kept
// in localStorage so it's per-device (matches messenger UX — a session
// you read on desktop shouldn't auto-clear unread state on your phone).
// Compared against ChatSession.updated_at to compute the unread badge in
// the session picker. updated_at gets bumped server-side on every new
// chat_messages insert (including pipeline_event and batch_summary
// messages from the auto-summary flow), so the badge surfaces whenever
// the pipeline reports something into a session the user isn't currently
// looking at.

const LAST_READ_KEY_PREFIX = "rhodes_chat_lastRead:";

function markSessionRead(sessionId: string): void {
  if (!sessionId) return;
  try {
    localStorage.setItem(LAST_READ_KEY_PREFIX + sessionId, new Date().toISOString());
  } catch {
    // private mode / quota — ignore
  }
}

function getLastReadAt(sessionId: string): string | null {
  try {
    return localStorage.getItem(LAST_READ_KEY_PREFIX + sessionId);
  } catch {
    return null;
  }
}

function isSessionUnread(session: { id: string; updated_at: string }, activeSessionId: string | null): boolean {
  // Active session is, by definition, being read — even if updated_at
  // just bumped, the Realtime delivery handler marks it read.
  if (session.id === activeSessionId) return false;
  const lastRead = getLastReadAt(session.id);
  if (!lastRead) return false; // never opened → no badge (don't shout for stale sessions)
  return Date.parse(session.updated_at) > Date.parse(lastRead);
}

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

  // Stable browser Supabase client for Realtime subscriptions.
  const supabase = useMemo(() => createClient(), []);

  // Safety-net refetch for the active session's messages. Used by the
  // Realtime resilience layer (channel reconnect, tab visibility, BFCache
  // restore). MERGES results — preserves any optimistic temp messages
  // currently in flight and upserts whatever came back from the server.
  //
  // Why this exists: the chat-drawer's primary delivery is Supabase
  // Realtime over WebSocket. When that drops silently (browser tab
  // throttling, idle disconnect, mid-handshake timing, etc.), there's no
  // recourse without a refetch. Production saw pipeline_event +
  // batch_summary messages persisted server-side but never displayed
  // because Realtime didn't deliver them; this is the backstop.
  const refetchActiveSessionMessages = useCallback(async (sessionId: string | null) => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}`);
      if (!res.ok) return;
      const data = await res.json();
      const serverMessages: ChatMessage[] = data.messages || [];
      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const next = [...prev];
        let appended = 0;
        for (const m of serverMessages) {
          if (!existingIds.has(m.id)) {
            next.push(m);
            appended += 1;
          }
        }
        if (appended > 0) {
          next.sort((a, b) => {
            const aTime = a.created_at ? Date.parse(a.created_at) : 0;
            const bTime = b.created_at ? Date.parse(b.created_at) : 0;
            return aTime - bTime;
          });
        }
        return next;
      });
    } catch {
      // Non-critical — next refetch trigger will retry.
    }
  }, []);

  // --- Realtime subscription for live message delivery ----------------------
  // Listens for INSERT events on chat_messages for the active session. Picks
  // up pipeline completion notifications, messages from other tabs/devices,
  // and (later) streaming responses + background agent messages.
  useEffect(() => {
    if (!activeSessionId) return;

    const channel = safeSubscribe(() => supabase
      .channel(`chat-${activeSessionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `session_id=eq.${activeSessionId}`,
        },
        (payload) => {
          const newMsg = payload.new as ChatMessage;
          setMessages((prev) => {
            // Dedupe: already have this exact id.
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            // Replace a temp message with the real DB row. For most temps we
            // match on content; but the in-flight STREAMING assistant
            // placeholder ("temp-assistant-…") still holds partial text when a
            // fast realtime INSERT arrives before the stream's `done` event, so
            // requiring content equality there mis-fires and renders the message
            // twice. There's only ever one streaming assistant placeholder, so
            // match it by prefix alone (the stream's `done`, if it lands after,
            // just no-ops since the id has already been swapped to the real one).
            const tempIdx = prev.findIndex(
              (m) =>
                typeof m.id === "string" &&
                m.id.startsWith("temp-") &&
                m.role === newMsg.role &&
                (m.content === newMsg.content || m.id.startsWith("temp-assistant-")),
            );
            if (tempIdx !== -1) {
              const updated = [...prev];
              updated[tempIdx] = { ...newMsg };
              return updated;
            }
            return [...prev, newMsg];
          });
          // A message just landed in the session the user is actively
          // viewing — refresh the read cursor so the unread badge doesn't
          // appear for a session they're literally watching events stream
          // into. Without this, every pipeline_event arrival would bump
          // updated_at and flip the badge on for the active session.
          if (activeSessionId) markSessionRead(activeSessionId);
        },
      )
      .subscribe((status) => {
        // Resilience layer: when the Realtime channel transitions back
        // into SUBSCRIBED after any non-SUBSCRIBED state (initial
        // connect, reconnect after disconnect, recovery after
        // CHANNEL_ERROR/TIMED_OUT/CLOSED), do a one-shot refetch to
        // catch any messages that landed during the gap. Without this,
        // websocket drops produce silent missing messages — exactly the
        // bug behind the "auto-summary never reached me" reports.
        if (status === "SUBSCRIBED") {
          void refetchActiveSessionMessages(activeSessionId);
        }
      }));

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [activeSessionId, supabase, refetchActiveSessionMessages]);

  // --- Tab-visibility refetch (Realtime resilience layer #2) ---------------
  // Browsers throttle and sometimes silently disconnect WebSockets in
  // backgrounded tabs. When the user comes back, Realtime may not have
  // delivered events that happened during the gap. Refetch on every
  // visibilitychange→visible to catch up. Also handle pageshow for
  // BFCache restores (browser back/forward into a cached page).
  useEffect(() => {
    if (!isOpen) return;
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void refetchActiveSessionMessages(activeSessionId);
        // Also refresh the session list so unread badges + ordering catch up.
        void fetchSessions();
      }
    };
    const onPageShow = (e: PageTransitionEvent) => {
      // BFCache restores fire pageshow with persisted=true; treat the
      // same as a visibility transition.
      if (e.persisted) {
        void refetchActiveSessionMessages(activeSessionId);
        void fetchSessions();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    };
    // fetchSessions is defined later as a useCallback with stable deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeSessionId, refetchActiveSessionMessages]);

  // --- Session-list Realtime subscription -----------------------------------
  // Listens for UPDATE events on chat_sessions for ANY session (filter is
  // applied client-side because Supabase Realtime can't easily scope by
  // "rows the auth user can read" without an RPC). When a session's
  // updated_at changes (typically because a pipeline_event or batch_summary
  // message landed in it from the auto-summary flow), refetch the session
  // list so the unread badge can compute fresh.
  useEffect(() => {
    if (!isOpen) return;
    const channel = safeSubscribe(() => supabase
      .channel(`session-list-updates`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_sessions" },
        () => {
          // Cheap full refetch; sessions list is capped at 100 server-side.
          void fetchSessions();
        },
      )
      .subscribe((status) => {
        // Same resilience as the chat_messages channel: refetch on
        // reconnect to catch any UPDATEs that landed during the gap.
        if (status === "SUBSCRIBED") {
          void fetchSessions();
        }
      }));
    return () => {
      if (channel) supabase.removeChannel(channel);
    };
    // fetchSessions is stable (useCallback with empty deps below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, supabase]);

  // Handle prefill from panel context (dashboard input, command palette,
  // /review's "Open in chat", etc.)
  useEffect(() => {
    if (prefillHandled.current) return;
    const hasQuery = chatPanel.prefillQuery;
    const hasFiles = chatPanel.prefillFiles.length > 0;
    const hasSession = chatPanel.prefillSessionId;

    // Session prefill: load the named session and pre-fill the input draft
    // (no auto-send — user reviews the framing first, per the unification
    // plan). This is /review's "Open in chat" path: the worker created the
    // session with the agent's defer reason as the first assistant message.
    if (hasSession) {
      prefillHandled.current = true;
      const sessionId = chatPanel.prefillSessionId as string;
      const draft = hasQuery ? chatPanel.prefillQuery || "" : "";
      chatPanel.clearPrefill();
      void loadSession(sessionId).then(() => {
        if (draft) setInput(draft);
      });
      return;
    }

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
  }, [chatPanel.prefillQuery, chatPanel.prefillFiles, chatPanel.prefillSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // MCP is the only chat path post-Phase-3 cutover. The state variable is
  // kept (always true) so the rest of the component doesn't need a rewrite.
  const [mcpEnabled] = useState<boolean>(true);

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
    // User is now actively viewing this session — clear any unread state.
    markSessionRead(sessionId);
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
      // Strip system-generated "[Continuing …]" prefixes from the display
      // content. Two flavors fire today:
      //   "[Continuing after approval] …"   after apply-actions follow_up
      //   "[Continuing after truncation] …" after a max_tokens stop reason
      // Claude sees these in the API payload as a hint to resume; the user
      // shouldn't see the prefix in the chat bubble.
      const CONTINUATION_RE = /^\[Continuing[^\]]*\]\s*/;
      const isAutoFollow = CONTINUATION_RE.test(text);
      const displayText = isAutoFollow ? text.replace(CONTINUATION_RE, "") : text.trim();
      const content = displayText || (hasFiles ? `Uploaded ${drawerFiles.length} file${drawerFiles.length !== 1 ? "s" : ""}` : "");
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
      if (inputRef.current) inputRef.current.style.height = "auto";
      const currentFiles = [...drawerFiles];
      setDrawerFiles([]);
      setSending(true);
      setStreamingText("");

      try {
        if (hasFiles) {
          // === FILE UPLOAD PATH (unified across all sizes) ===
          // Phase 3 of the chat unification merged the legacy ≤5-doc inline
          // path and the >5-doc static-handoff path into this single flow.
          // Every chat upload now: creates a batch → presigns → uploads to
          // storage → registers → kicks off processing → sends the chat
          // message via /api/chat with attachment metadata refs only.
          //
          // The orchestrator is metadata-only (Phase 1) — it never sees PDF
          // bytes, so there's no per-turn budget concern that motivated the
          // original 6+ cliff. The orchestrator narrates via tools as the
          // pipeline runs; pipeline events post structured chat messages
          // (Phase 2b) so the user gets live progress regardless of upload
          // size.

          // 1. Create a chat-context batch.
          const batchRes = await fetch("/api/pipeline/batches", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              context: "chat",
              name: `Chat upload — ${currentFiles.length} document${currentFiles.length !== 1 ? "s" : ""}`,
              entity_id: pageContext?.entityId ?? null,
              metadata: { session_id: sessionId },
            }),
          });
          if (!batchRes.ok) throw new Error("Failed to create upload batch");
          const batch = (await batchRes.json()) as { id: string };

          // 2. Presign upload URLs for each file.
          const presignRes = await fetch(
            `/api/pipeline/batches/${batch.id}/presign`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                files: currentFiles.map((f) => ({
                  name: f.name,
                  size: f.size,
                  type: f.type,
                })),
              }),
            },
          );
          if (!presignRes.ok) throw new Error("Failed to presign uploads");
          const presignData = (await presignRes.json()) as {
            urls: Array<{
              originalName: string;
              safeName: string;
              storagePath: string;
              signedUrl: string;
              token: string;
            }>;
          };

          // 3. Upload each file to Supabase Storage + compute SHA-256 hash.
          // Bounded-parallel (not one-at-a-time): uploading 3-4 files serially
          // stacked their latencies. Cap concurrency so we don't open too many
          // PUTs at once. fileHashes stays positional (indexed by i) so the
          // register step below still lines up with currentFiles.
          const fileHashes: string[] = new Array(presignData.urls.length);
          const UPLOAD_CONCURRENCY = 4;
          const uploadOne = async (i: number) => {
            const { signedUrl, token } = presignData.urls[i];
            const file = currentFiles[i];
            const buf = await file.arrayBuffer();
            const hashBuf = await crypto.subtle.digest("SHA-256", buf);
            fileHashes[i] = Array.from(new Uint8Array(hashBuf))
              .map((b) => b.toString(16).padStart(2, "0"))
              .join("");
            const uploadRes = await fetch(signedUrl, {
              method: "PUT",
              headers: {
                "Content-Type": file.type || "application/octet-stream",
                "x-upsert": "true",
                Authorization: `Bearer ${token}`,
              },
              body: buf,
            });
            if (!uploadRes.ok) throw new Error(`Failed to upload ${file.name}`);
          };
          for (let i = 0; i < presignData.urls.length; i += UPLOAD_CONCURRENCY) {
            await Promise.all(
              Array.from(
                { length: Math.min(UPLOAD_CONCURRENCY, presignData.urls.length - i) },
                (_, k) => uploadOne(i + k),
              ),
            );
          }

          // 4. Register uploaded files with the batch.
          const registerRes = await fetch(
            `/api/pipeline/batches/${batch.id}/upload`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                files: presignData.urls.map((u, i) => ({
                  originalName: u.originalName,
                  storagePath: u.storagePath,
                  size: currentFiles[i].size,
                  type: currentFiles[i].type,
                  contentHash: fileHashes[i],
                })),
              }),
            },
          );
          if (!registerRes.ok) throw new Error("Failed to register uploads");
          const registerData = (await registerRes.json()) as {
            uploaded: number;
            items: Array<{ document_id?: string | null }>;
          };

          // 5. Kick off background processing.
          await fetch(`/api/pipeline/batches/${batch.id}/process`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          });

          // 6. Send the chat message WITH attachment metadata so the MCP
          //    orchestrator fetches the files from Storage and builds content
          //    blocks — Claude sees the actual document content in this turn.
          // document_id comes from the early doc rows created at registration.
          const chatAttachments = presignData.urls.map((u, i) => ({
            storage_path: u.storagePath,
            filename: u.originalName,
            content_type: currentFiles[i].type,
            size: currentFiles[i].size,
            batch_id: batch.id,
            document_id: registerData.items?.[i]?.document_id ?? undefined,
          }));

          // Include duplicate documents with their existing IDs so Claude
          // can reference them for linking without searching.
          const dupes = (registerData as { duplicates?: Array<{ filename: string; existing_document_id?: string | null }> }).duplicates ?? [];
          for (const dupe of dupes) {
            if (dupe.existing_document_id) {
              chatAttachments.push({
                storage_path: "",
                filename: dupe.filename,
                content_type: "",
                size: 0,
                batch_id: batch.id,
                document_id: dupe.existing_document_id,
              });
            }
          }

          // Build context about duplicates for Claude.
          const dupeContext = dupes
            .filter((d) => d.existing_document_id)
            .map((d) => `"${d.filename}" already exists as document_id: ${d.existing_document_id}`)
            .join("; ");

          let chatMessage =
            text.trim() ||
            `I've uploaded ${currentFiles.length} document${currentFiles.length > 1 ? "s" : ""}: ${currentFiles.map((f) => f.name).join(", ")}. Please review ${currentFiles.length > 1 ? "them" : "it"}.`;
          if (dupeContext) {
            chatMessage += `\n\n[Note: ${dupeContext}. Use the existing document_id for any linking.]`;
          }

          const chatRes = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              session_id: sessionId,
              message: chatMessage,
              page_context: pageContext ?? undefined,
              attachments: chatAttachments,
            }),
          });

          if (!chatRes.body) throw new Error("No response body");

          // Streaming — same pattern as the regular chat path.
          const uploadPlaceholderId = `temp-assistant-upload-${Date.now()}`;
          setMessages((prev) => [...prev, {
            id: uploadPlaceholderId,
            session_id: sessionId,
            role: "assistant" as const,
            content: "",
            metadata: { mcp_chat: true, processing_status: "streaming" as const },
            created_at: new Date().toISOString(),
          }]);

          let uploadAccText = "";
          const uploadToolCalls: Array<{ name: string; ok: boolean; duration_ms?: number; error?: string }> = [];
          const uploadStagedActions: NonNullable<ChatMessageMetadata["staged_actions"]> = [];
          let uploadDoneResult: (StreamEvent & { type: "done" }) | null = null;

          await readStreamEvents(chatRes.body, {
            onTextDelta: (d) => {
              uploadAccText += d.text;
              setStreamingText(uploadAccText);
            },
            onToolStart: (d) => {
              uploadToolCalls.push({ name: d.name, ok: false });
              setMessages((prev) => prev.map((m) =>
                m.id === uploadPlaceholderId
                  ? { ...m, metadata: { ...m.metadata, tool_calls: [...uploadToolCalls] } }
                  : m,
              ));
            },
            onToolComplete: (d) => {
              const tc = uploadToolCalls[d.index];
              if (tc) { tc.ok = d.ok; tc.duration_ms = d.durationMs; if (d.error) tc.error = d.error; }
              setMessages((prev) => prev.map((m) =>
                m.id === uploadPlaceholderId
                  ? { ...m, metadata: { ...m.metadata, tool_calls: [...uploadToolCalls] } }
                  : m,
              ));
            },
            onToolStaged: (d) => {
              uploadStagedActions.push({ id: d.id, tool: d.tool, input: {}, summary: d.summary, resource_preview: d.resource_preview });
            },
            onDone: (d) => { uploadDoneResult = d; },
          });

          setStreamingText("");
          setMessages((prev) => prev.map((m) =>
            m.id === uploadPlaceholderId
              ? {
                  ...m,
                  id: uploadDoneResult?.messageId ?? m.id,
                  content: uploadDoneResult?.text ?? uploadAccText,
                  metadata: {
                    mcp_chat: true,
                    tool_calls: uploadDoneResult?.toolCalls?.map(
                      (c: { name: string; ok: boolean; durationMs?: number; error?: string }) => ({
                        name: c.name, ok: c.ok, duration_ms: c.durationMs,
                        ...(c.error ? { error: c.error } : {}),
                      }),
                    ) ?? uploadToolCalls,
                    staged_actions: (uploadDoneResult?.stagedActions?.length ?? uploadStagedActions.length) > 0
                      ? uploadDoneResult?.stagedActions ?? uploadStagedActions : undefined,
                    iterations: uploadDoneResult?.iterations,
                    truncated: uploadDoneResult?.truncated,
                    stop_reason: uploadDoneResult?.stopReason,
                    processing_status: "completed",
                  },
                }
              : m,
          ));
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

          // MCP streaming chat path — tokens stream as they arrive, tool-call
          // indicators update in real-time, staged-action summaries appear
          // progressively. The approval card renders after the done event.
          if (mcpEnabled) {
            const res = await fetch("/api/chat", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            if (!res.body) throw new Error("No response body");

            const placeholderId = `temp-assistant-${Date.now()}`;
            const placeholderMsg: ChatMessage = {
              id: placeholderId,
              session_id: sessionId,
              role: "assistant",
              content: "",
              metadata: { mcp_chat: true, processing_status: "streaming" },
              created_at: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, placeholderMsg]);

            let accText = "";
            const streamToolCalls: Array<{
              name: string;
              ok: boolean;
              duration_ms?: number;
              error?: string;
            }> = [];
            const streamStagedActions: NonNullable<ChatMessageMetadata["staged_actions"]> = [];
            let doneResult: (StreamEvent & { type: "done" }) | null = null;
            // Captured as primitives so the post-stream auto-continue check
            // doesn't have to cope with TypeScript's flow analysis losing
            // sight of doneResult after the closure assignment.
            let doneTruncated = false;
            let doneStopReason: string | null = null;

            await readStreamEvents(res.body, {
              onTextDelta: (d) => {
                accText += d.text;
                setStreamingText(accText);
              },
              onToolStart: (d) => {
                streamToolCalls.push({ name: d.name, ok: false });
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === placeholderId
                      ? {
                          ...m,
                          metadata: {
                            ...m.metadata,
                            tool_calls: [...streamToolCalls],
                          },
                        }
                      : m,
                  ),
                );
              },
              onToolComplete: (d) => {
                const tc = streamToolCalls[d.index];
                if (tc) {
                  tc.ok = d.ok;
                  tc.duration_ms = d.durationMs;
                  if (d.error) tc.error = d.error;
                }
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === placeholderId
                      ? {
                          ...m,
                          metadata: {
                            ...m.metadata,
                            tool_calls: [...streamToolCalls],
                          },
                        }
                      : m,
                  ),
                );
              },
              onToolStaged: (d) => {
                streamStagedActions.push({
                  id: d.id,
                  tool: d.tool,
                  input: {},
                  summary: d.summary,
                  resource_preview: d.resource_preview,
                });
              },
              onError: () => {
                // Error is in the streamed text — handled by done or
                // partial content.
              },
              onDone: (d) => {
                doneResult = d;
                doneTruncated = d.truncated;
                doneStopReason = d.stopReason;
              },
            });

            // Replace placeholder with final message.
            setStreamingText("");
            setMessages((prev) =>
              prev.map((m) =>
                m.id === placeholderId
                  ? {
                      ...m,
                      id: doneResult?.messageId ?? m.id,
                      content: doneResult?.text ?? accText,
                      metadata: {
                        mcp_chat: true,
                        tool_calls: doneResult?.toolCalls?.map(
                          (c: { name: string; ok: boolean; durationMs?: number; error?: string }) => ({
                            name: c.name,
                            ok: c.ok,
                            duration_ms: c.durationMs,
                            ...(c.error ? { error: c.error } : {}),
                          }),
                        ) ?? streamToolCalls,
                        staged_actions:
                          (doneResult?.stagedActions?.length ?? streamStagedActions.length) > 0
                            ? doneResult?.stagedActions ?? streamStagedActions
                            : undefined,
                        iterations: doneResult?.iterations,
                        truncated: doneResult?.truncated,
                        stop_reason: doneResult?.stopReason,
                        processing_status: "completed",
                      },
                    }
                  : m,
              ),
            );
            fetchSessions();

            // Auto-continue when the model ran out of output tokens
            // mid-thought without producing anything actionable. Same
            // contract as the apply-actions follow_up: each iteration
            // (including this auto-fired one) gets a fresh max_tokens
            // budget, so resuming gives Claude room to finish staging.
            // Skip when actions DID get staged — the user should approve
            // those before any further work; the existing apply-actions
            // follow_up handles continuation after that.
            if (
              doneTruncated &&
              doneStopReason === "max_tokens" &&
              streamStagedActions.length === 0
            ) {
              setTimeout(
                () =>
                  sendMessage(
                    "[Continuing after truncation] Your previous turn was cut off mid-output by the max_tokens limit. Continue from where you left off. If you were about to stage actions, stage them now without re-narrating the inputs (you've already explained them; just emit the tool calls).",
                  ),
                500,
              );
            }
            return;
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
    [activeSessionId, sending, drawerFiles, fetchSessions, pageContext, mcpEnabled]
  );

  // -------------------------------------------------------------------
  // Auto-scroll
  // -------------------------------------------------------------------

  // Auto-scroll moved to DrawerMessages where the scroll container lives.
  // See the smart-scroll logic inside DrawerMessages.

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
            onApplyComplete={(confirmMsg, followUp) => {
              setMessages((prev: ChatMessage[]) => [...prev, confirmMsg]);
              if (followUp) {
                setTimeout(() => sendMessage("[Continuing after approval] " + followUp), 500);
              }
            }}
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
          onApplyComplete={(confirmMsg, followUp) => {
            setMessages((prev: ChatMessage[]) => [...prev, confirmMsg]);
            if (followUp) {
              setTimeout(() => sendMessage("[Continuing after approval] " + followUp), 500);
            }
          }}
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
  isMobile: _isMobile,
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
            {sessions.slice(0, 5).map((s) => {
              const unread = isSessionUnread(s, activeSessionId);
              return (
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
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 12,
                      fontWeight: unread || s.id === activeSessionId ? 600 : 400,
                      color: "#1a1a1f",
                      overflow: "hidden",
                    }}
                  >
                    {/* Unread dot — sized to match the orange status dots
                        used elsewhere in /review. */}
                    {unread && (
                      <span
                        aria-label="Unread updates"
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: "#c47520",
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {s.title}
                    </span>
                  </div>
                </button>
              );
            })}
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
  onApplyComplete,
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
  onApplyComplete: (confirmMsg: ChatMessage, followUp?: string) => void;
  onClick: (e: React.MouseEvent) => void;
  compact?: boolean;
  currentPageContext: PageContext | null;
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isUserNearBottomRef = useRef(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  // Track whether the user is near the bottom of the scroll container.
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isUserNearBottomRef.current = distanceFromBottom < 150;
    if (isUserNearBottomRef.current) setShowJumpToBottom(false);
  }, []);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  // Smart auto-scroll: only scroll if the user hasn't scrolled up.
  // State updates deferred via queueMicrotask to avoid the cascading-render
  // lint rule (setState synchronously in an effect body).
  useEffect(() => {
    if (isUserNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      queueMicrotask(() => setShowJumpToBottom(false));
    } else if (streamingText || messages.length > 0) {
      queueMicrotask(() => setShowJumpToBottom(true));
    }
  }, [messages, streamingText, messagesEndRef]);

  const jumpToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    isUserNearBottomRef.current = true;
    setShowJumpToBottom(false);
  }, [messagesEndRef]);

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
    <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
      <div
        ref={scrollContainerRef}
        onClick={onClick}
        style={{ height: "100%", overflowY: "auto", padding: "12px 12px 8px" }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {messages.map((msg, idx) => {
          const meta = msg.metadata as ChatMessageMetadata | null;
          const hasActions =
            (meta?.proposed_actions && meta.proposed_actions.length > 0) ||
            (meta?.staged_actions && meta.staged_actions.length > 0);
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
                  sessionId={msg.session_id}
                  metadata={meta!}
                  onActionsApplied={(summary) => {
                    const confirmText = summary.failed > 0
                      ? `Applied ${summary.applied} action${summary.applied !== 1 ? "s" : ""}, ${summary.failed} failed.`
                      : summary.applied > 0
                        ? `Applied ${summary.applied} action${summary.applied !== 1 ? "s" : ""} successfully.`
                        : "Skipped all actions.";
                    const confirmMsg: ChatMessage = {
                      id: `confirm-${Date.now()}`,
                      session_id: msg.session_id,
                      role: "assistant",
                      content: confirmText,
                      metadata: { type: "apply_confirmation" },
                      created_at: new Date().toISOString(),
                    };
                    onApplyComplete(confirmMsg, summary.follow_up);
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

      {showJumpToBottom && (
        <button
          onClick={jumpToBottom}
          style={{
            position: "absolute",
            bottom: 12,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#1a1a1a",
            color: "#fff",
            border: "none",
            borderRadius: 16,
            padding: "6px 14px",
            fontSize: 12,
            cursor: "pointer",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <span style={{ fontSize: 14 }}>↓</span> New messages
        </button>
      )}
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
          onChange={(e) => {
            setInput(e.target.value);
            requestAnimationFrame(() => {
              const el = inputRef.current;
              if (!el) return;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
            });
          }}
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
            maxHeight: 140,
            lineHeight: 1.5,
            boxSizing: "border-box",
            background: "#f5f4f0",
            overflow: "auto",
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
