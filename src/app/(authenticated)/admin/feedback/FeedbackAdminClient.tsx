"use client";

import { useEffect, useState } from "react";

interface FeedbackRow {
  id: string;
  created_at: string;
  rating: "up" | "down";
  comment: string | null;
  message_id: string;
  session_id: string | null;
  message_preview: string;
  user_id: string;
  display_name: string | null;
  email: string | null;
}

interface FeedbackResponse {
  rows: FeedbackRow[];
  page: number;
  pageSize: number;
  total: number;
}

type RatingFilter = "all" | "up" | "down";

export function FeedbackAdminClient() {
  const [filter, setFilter] = useState<RatingFilter>("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<FeedbackResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // State-setting is deferred into an async IIFE so the effect body itself
    // doesn't touch setters synchronously (react-hooks/exhaustive-deps style
    // rule). The cascading-render check fires without this wrapper.
    void (async () => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (filter !== "all") params.set("rating", filter);
      params.set("page", String(page));
      try {
        const res = await fetch(`/api/admin/feedback?${params}`);
        if (!res.ok) {
          if (!cancelled) {
            setError(res.status === 403 ? "Not authorized" : "Couldn't load feedback");
          }
          return;
        }
        const json = (await res.json()) as FeedbackResponse;
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setError("Couldn't load feedback");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filter, page]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Chat Feedback</h1>
      <p style={{ color: "#6b6b76", marginBottom: 16, fontSize: 13 }}>
        Thumbs ratings + comments from family members, newest first.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <label style={{ fontSize: 12, color: "#6b6b76" }}>Filter</label>
        <select
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as RatingFilter);
            setPage(1);
          }}
          style={{ fontSize: 13, padding: "4px 8px" }}
        >
          <option value="all">All</option>
          <option value="up">Thumbs up</option>
          <option value="down">Thumbs down</option>
        </select>
        {data && (
          <span style={{ marginLeft: 8, fontSize: 12, color: "#6b6b76" }}>
            {data.total} total
          </span>
        )}
      </div>

      {loading && <div style={{ color: "#6b6b76" }}>Loading…</div>}
      {error && <div style={{ color: "#a83333" }}>{error}</div>}

      {data && !loading && (
        <>
          <table
            data-testid="feedback-table"
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
              background: "#fff",
              border: "1px solid #e8e6df",
            }}
          >
            <thead>
              <tr style={{ background: "#f6f5f1", textAlign: "left" }}>
                <th style={cellStyle}>Date</th>
                <th style={cellStyle}>Family member</th>
                <th style={cellStyle}>Message preview</th>
                <th style={cellStyle}>Rating</th>
                <th style={cellStyle}>Comment</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ ...cellStyle, color: "#6b6b76" }}>
                    No feedback yet.
                  </td>
                </tr>
              ) : (
                data.rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid #e8e6df" }}>
                    <td style={cellStyle}>
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td style={cellStyle}>
                      {r.display_name ?? r.email ?? r.user_id.slice(0, 8) + "…"}
                      {r.email && r.display_name && (
                        <div style={{ color: "#6b6b76", fontSize: 11 }}>{r.email}</div>
                      )}
                    </td>
                    <td style={{ ...cellStyle, maxWidth: 400 }}>{r.message_preview}</td>
                    <td style={cellStyle}>
                      <span
                        style={{
                          color: r.rating === "up" ? "#2d5a3d" : "#a83333",
                          fontWeight: 600,
                        }}
                      >
                        {r.rating === "up" ? "👍 Up" : "👎 Down"}
                      </span>
                    </td>
                    <td style={{ ...cellStyle, maxWidth: 300 }}>{r.comment ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1 || loading}
              style={pageBtnStyle(page === 1 || loading)}
            >
              ← Prev
            </button>
            <span style={{ fontSize: 12, color: "#6b6b76" }}>
              Page {data.page} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= totalPages || loading}
              style={pageBtnStyle(page >= totalPages || loading)}
            >
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const cellStyle: React.CSSProperties = {
  padding: "8px 10px",
  verticalAlign: "top",
  lineHeight: 1.4,
};

function pageBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    fontSize: 12,
    padding: "4px 10px",
    border: "1px solid #d0d0d8",
    background: "#fff",
    borderRadius: 4,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}
