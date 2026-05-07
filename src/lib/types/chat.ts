export interface ChatSession {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  metadata: ChatMessageMetadata | null;
  created_at: string;
  /** Current user's thumbs+comment feedback on this message, if any.
   *  Preloaded by GET /api/chat/sessions/[id]; only set on assistant rows. */
  feedback?: { rating: 'up' | 'down'; comment: string | null } | null;
}

// Metadata stored in chat_messages.metadata JSONB
export interface ChatMessageMetadata {
  // File attachments (on user messages)
  attachments?: ChatAttachment[];
  // Batch ID for tracking processing
  batch_id?: string;
  // Proposed actions from AI (on assistant messages) — card-presentation only
  proposed_actions?: ChatProposedAction[];
  // Actions the AI asked about conversationally (not in approval card)
  pending_question_actions?: ChatProposedAction[];
  // Processing status
  processing_status?: 'uploading' | 'processing' | 'streaming' | 'completed' | 'error';
  // Page context at time of upload
  page_context?: {
    page: string;
    entityId?: string;
    entityName?: string;
    investmentId?: string;
    investmentName?: string;
  };
  // MCP v2 tool-use trace (on assistant messages written by /api/chat/v2).
  // Present iff `mcp_chat === true`. Read by the chat drawer to render the
  // collapsed "what Claude did" affordance under the assistant bubble.
  tool_calls?: Array<{
    name: string;
    arg_keys?: string[];
    ok: boolean;
    duration_ms?: number;
    error?: string;
  }>;
  iterations?: number;
  truncated?: boolean;
  stop_reason?: string | null;
  mcp_chat?: boolean;
  // Persisted approval results — survives navigation. Keyed by action id.
  applied_statuses?: Record<string, string>;
  // MCP write-tool staging (Phase 2). Present when the orchestrator staged
  // write actions for user approval.
  staged_actions?: Array<{
    id: string;
    tool: string;
    input: Record<string, unknown>;
    summary: string;
    resource_preview?: unknown;
  }>;
  // Synthetic applied-message marker. When true, the UI renders this as a
  // faint divider ("Applied N changes") instead of a full message bubble.
  synthetic?: boolean;
  applied_actions?: Array<{ tool: string; summary: string }>;
  failed_actions?: Array<{ tool: string; summary: string; error: string }>;
  // Any other fields
  [key: string]: unknown;
}

export interface ChatAttachment {
  queue_item_id: string;
  document_id: string | null;  // Set after ingestion
  filename: string;
  status: 'uploading' | 'queued' | 'extracting' | 'processed' | 'error';
  // AI results
  proposed_entity?: { id: string | null; name: string } | null;
  proposed_type?: string | null;
  proposed_category?: string | null;
  proposed_year?: number | null;
  ai_summary?: string | null;
}

export interface ChatProposedAction {
  id: string;           // Unique ID for tracking approval
  queue_item_id: string; // Which queue item this action came from
  action: string;        // 'create_entity' | 'create_investment' | etc.
  data: Record<string, unknown>;
  confidence: 'high' | 'medium' | 'low';
  description: string;   // Human-readable description
  status: 'pending' | 'approved' | 'rejected' | 'applied' | 'failed';
  presentation?: 'card' | 'question' | 'applied'; // How to present this action
  /** Populated when status is 'failed' so the approval card can show why
   *  without sending the user to devtools. */
  error?: string;
}
