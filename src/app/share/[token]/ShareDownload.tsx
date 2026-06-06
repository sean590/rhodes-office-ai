"use client";

import React, { useState } from "react";

export function ShareDownload({
  token,
  documentName,
  senderName,
}: {
  token: string;
  documentName: string;
  senderName: string;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/share/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setError(data.error || "This link is no longer available.");
        setBusy(false);
        return;
      }
      // Navigate to the short-lived signed URL to stream the file.
      window.location.href = data.url;
      // Leave the spinner up briefly; the navigation takes over.
      setTimeout(() => setBusy(false), 4000);
    } catch {
      setError("Something went wrong. Please try again.");
      setBusy(false);
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
        Shared by <strong style={{ color: "#1a1a1f" }}>{senderName}</strong> via Rhodes
      </p>
      <h1 style={{ fontSize: 20, fontWeight: 600, color: "#1a1a1f", margin: "0 0 24px" }}>{documentName}</h1>

      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#6b6b76", marginBottom: 6 }}>
        Your email
      </label>
      <input
        style={inputStyle}
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@firm.com"
        disabled={busy}
      />

      {error && (
        <div style={{ marginTop: 12, padding: "8px 12px", background: "#fbe8e8", border: "1px solid #f4b8b8", borderRadius: 6, color: "#7a1818", fontSize: 13 }}>
          {error}
        </div>
      )}

      <button
        onClick={handleDownload}
        disabled={busy}
        style={{
          marginTop: 16,
          width: "100%",
          background: "#2d5a3d",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          padding: "12px 24px",
          fontSize: 14,
          fontWeight: 600,
          fontFamily: "inherit",
          cursor: busy ? "default" : "pointer",
        }}
      >
        {busy ? "Preparing download…" : "Download"}
      </button>
    </div>
  );
}
