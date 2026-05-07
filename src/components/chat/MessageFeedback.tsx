"use client";

import { useState } from "react";
import type { ChatMessage } from "@/lib/types/chat";

/**
 * Thumbs+comment feedback rendered under every assistant message.
 *
 * Three-state interaction model:
 * - No rating → click up → POST rating='up' (filled green).
 * - No rating → click down → open textarea → Send → POST rating='down'
 *   (filled red).
 * - Filled → click the OTHER thumb → POST the new rating (switch).
 * - Filled → click the SAME thumb → DELETE, clear to no-rating. For
 *   thumbs-down this also clears the comment; re-clicking down reopens a
 *   fresh textarea if the user wants to resubmit.
 *
 * Initial state comes from `message.feedback` (preloaded by the session GET
 * route). Fresh assistant messages pushed locally after a turn default to
 * null → no selection, ready to collect.
 */

interface MessageFeedbackProps {
  message: ChatMessage;
}

type Rating = "up" | "down";
type LocalFeedback = { rating: Rating; comment: string | null } | null;

export function MessageFeedback({ message }: MessageFeedbackProps) {
  const [feedback, setFeedback] = useState<LocalFeedback>(message.feedback ?? null);
  const [commenting, setCommenting] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (message.role !== "assistant") return null;

  const post = async (rating: Rating, comment: string | null) => {
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/chat/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: message.id, rating, comment }),
      });
      if (!res.ok) {
        setErrorMsg("Couldn't save feedback");
        return;
      }
      setFeedback({ rating, comment });
      setCommenting(false);
      setCommentDraft("");
    } catch {
      setErrorMsg("Couldn't save feedback");
    } finally {
      setSubmitting(false);
    }
  };

  /** Three-state toggle-clear: re-clicking a filled thumb removes the row
   *  via DELETE and snaps back to no-selection. Optimistically updates local
   *  state so the UI reflects the clear immediately; reverts on failure. */
  const clearFeedback = async () => {
    const prior = feedback;
    setSubmitting(true);
    setErrorMsg(null);
    // Optimistic snap to no-rating; also closes any open comment drawer.
    setFeedback(null);
    setCommenting(false);
    setCommentDraft("");
    try {
      const res = await fetch("/api/chat/feedback", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: message.id }),
      });
      if (!res.ok) {
        setErrorMsg("Couldn't clear feedback");
        setFeedback(prior); // revert
        return;
      }
    } catch {
      setErrorMsg("Couldn't clear feedback");
      setFeedback(prior);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUp = () => {
    if (feedback?.rating === "up") {
      void clearFeedback();
      return;
    }
    void post("up", null);
  };

  const handleDown = () => {
    if (feedback?.rating === "down") {
      // Clears BOTH the rating and the comment. If the user wants to edit
      // the comment they can click down again and resubmit (fresh textarea).
      void clearFeedback();
      return;
    }
    setCommenting(true);
    setCommentDraft(feedback?.comment ?? "");
  };

  const handleSubmitComment = () => {
    void post("down", commentDraft.trim().length > 0 ? commentDraft.trim() : null);
  };

  const iconStyle = (active: boolean, color: string): React.CSSProperties => ({
    width: 16,
    height: 16,
    stroke: active ? color : "#8a8a92",
    fill: active ? color : "none",
    strokeWidth: 1.6,
    cursor: submitting ? "wait" : "pointer",
    opacity: submitting ? 0.5 : 1,
    transition: "stroke 0.15s, fill 0.15s",
  });

  return (
    <div
      data-testid="message-feedback"
      style={{ marginTop: 6, fontSize: 11, color: "#6b6b76" }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          type="button"
          onClick={handleUp}
          disabled={submitting}
          aria-label={feedback?.rating === "up" ? "Remove thumbs up" : "Thumbs up"}
          aria-pressed={feedback?.rating === "up"}
          data-testid="thumbs-up"
          style={{ background: "none", border: "none", padding: 2 }}
        >
          <svg viewBox="0 0 24 24" style={iconStyle(feedback?.rating === "up", "#2d5a3d")}>
            <path d="M7 11v9H4v-9zM7 11l4.5-8a1.5 1.5 0 0 1 3 .5V10h4.5a2 2 0 0 1 2 2.3l-1.3 6.7A2 2 0 0 1 17.7 21H7" />
          </svg>
        </button>
        <button
          type="button"
          onClick={handleDown}
          disabled={submitting}
          aria-label={feedback?.rating === "down" ? "Remove thumbs down" : "Thumbs down"}
          aria-pressed={feedback?.rating === "down"}
          data-testid="thumbs-down"
          style={{ background: "none", border: "none", padding: 2 }}
        >
          <svg viewBox="0 0 24 24" style={iconStyle(feedback?.rating === "down", "#a83333")}>
            <path d="M17 13V4h3v9zM17 13l-4.5 8a1.5 1.5 0 0 1-3-.5V14H5a2 2 0 0 1-2-2.3l1.3-6.7A2 2 0 0 1 6.3 3H17" />
          </svg>
        </button>
        {errorMsg && <span style={{ color: "#a83333" }}>{errorMsg}</span>}
      </div>

      {commenting && (
        <div
          data-testid="feedback-comment-area"
          style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}
        >
          <textarea
            value={commentDraft}
            onChange={(e) => setCommentDraft(e.target.value)}
            placeholder="What went wrong? (optional)"
            maxLength={2000}
            rows={2}
            style={{
              fontSize: 12,
              padding: "6px 8px",
              border: "1px solid #e8e6df",
              borderRadius: 6,
              fontFamily: "inherit",
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              onClick={handleSubmitComment}
              disabled={submitting}
              data-testid="submit-feedback"
              style={{
                fontSize: 11,
                padding: "3px 10px",
                border: "1px solid #a83333",
                background: "#a83333",
                color: "#fff",
                borderRadius: 4,
                cursor: submitting ? "wait" : "pointer",
              }}
            >
              Send
            </button>
            <button
              type="button"
              onClick={() => {
                setCommenting(false);
                setCommentDraft("");
              }}
              disabled={submitting}
              style={{
                fontSize: 11,
                padding: "3px 10px",
                border: "1px solid #d0d0d8",
                background: "#fff",
                color: "#6b6b76",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
