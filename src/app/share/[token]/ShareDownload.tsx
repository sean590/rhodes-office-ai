"use client";

import React, { useState } from "react";

interface ShareDoc {
  id: string;
  name: string;
}

export function ShareDownload({
  token,
  documents,
  senderName,
}: {
  token: string;
  documents: ShareDoc[];
  senderName: string | null;
}) {
  const [email, setEmail] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const multiple = documents.length > 1;

  const download = async (documentId: string) => {
    setBusyId(documentId);
    setError(null);
    try {
      const res = await fetch(`/api/share/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() || undefined, document_id: documentId }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setError(data.error || "This link is no longer available.");
        setBusyId(null);
        return;
      }
      window.location.assign(data.url);
      setTimeout(() => setBusyId(null), 4000);
    } catch {
      setError("Something went wrong. Please try again.");
      setBusyId(null);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    background: "#fff",
    border: "1px solid #ddd9d0",
    borderRadius: 6,
    padding: "10px 12px",
    fontSize: 14,
    fontFamily: "inherit",
    color: "#1a1a1f",
    outline: "none",
  };

  return (
    <div>
      <p style={{ fontSize: 14, color: "#6b6b76", lineHeight: 1.6, margin: "0 0 6px" }}>
        {senderName ? (
          <>Shared by <strong style={{ color: "#1a1a1f" }}>{senderName}</strong> via Rhodes</>
        ) : (
          <>Shared with you via Rhodes</>
        )}
      </p>
      <h1 style={{ fontSize: 20, fontWeight: 600, color: "#1a1a1f", margin: "0 0 24px" }}>
        {multiple ? `${documents.length} documents` : documents[0]?.name ?? "a document"}
      </h1>

      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#6b6b76", marginBottom: 6 }}>
        Your email
      </label>
      <input
        style={inputStyle}
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@firm.com"
      />

      {error && (
        <div style={{ marginTop: 12, padding: "8px 12px", background: "#fbe8e8", border: "1px solid #f4b8b8", borderRadius: 6, color: "#7a1818", fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Single doc: one big Download. Multiple: a list, one Download each. */}
      {multiple ? (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          {documents.map((d) => (
            <div
              key={d.id}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, border: "1px solid #e8e6df", borderRadius: 8, padding: "10px 12px" }}
            >
              <span style={{ fontSize: 14, color: "#1a1a1f", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
              <button
                onClick={() => download(d.id)}
                disabled={busyId !== null}
                style={{ background: "#2d5a3d", color: "#fff", border: "none", borderRadius: 6, padding: "7px 16px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: busyId ? "default" : "pointer", whiteSpace: "nowrap" }}
              >
                {busyId === d.id ? "…" : "Download"}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <button
          onClick={() => documents[0] && download(documents[0].id)}
          disabled={busyId !== null || !documents[0]}
          style={{ marginTop: 16, width: "100%", background: "#2d5a3d", color: "#fff", border: "none", borderRadius: 6, padding: "12px 24px", fontSize: 14, fontWeight: 600, fontFamily: "inherit", cursor: busyId ? "default" : "pointer" }}
        >
          {busyId ? "Preparing download…" : "Download"}
        </button>
      )}
    </div>
  );
}
