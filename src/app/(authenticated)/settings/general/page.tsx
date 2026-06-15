"use client";

/**
 * Settings → Organization → General. Org-wide settings (currently the
 * organization name). Moved here from the Profile page in the UX refresh
 * (Phase 7), which regroups Settings into Account / Organization / Automation.
 */

import { useState, useEffect, useCallback } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { SectionCard } from "@/components/settings/section-card";

interface CurrentUserInfo {
  orgId?: string;
  orgRole?: string;
  orgName?: string;
}

export default function SettingsGeneralPage() {
  const isMobile = useIsMobile();
  const [currentUser, setCurrentUser] = useState<CurrentUserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [orgName, setOrgName] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchUser = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (!res.ok) return;
      const data = await res.json();
      setCurrentUser(data);
      if (data.orgName) setOrgName(data.orgName);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchUser(); }, [fetchUser]);

  const handleSave = async () => {
    if (!currentUser?.orgId || !orgName.trim()) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/organizations/${currentUser.orgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: orgName.trim() }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Failed to update organization"); }
      setEditing(false);
      setCurrentUser((u) => (u ? { ...u, orgName: orgName.trim() } : u));
      // Let the Topbar breadcrumb update without a reload.
      window.dispatchEvent(new CustomEvent("rhodes:org-renamed", { detail: { name: orgName.trim() } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: isMobile ? 16 : 24 }}>
        <h1 style={{ fontSize: isMobile ? 20 : 22, fontWeight: 600, color: "#1a1a1f", letterSpacing: "-0.02em", margin: 0 }}>General</h1>
        <p style={{ fontSize: 13, color: "#9494a0", margin: "4px 0 0 0" }}>Your organization&rsquo;s settings</p>
      </div>

      {loading ? (
        <div style={{ padding: 40, color: "#9494a0", fontSize: 13, textAlign: "center" }}>Loading…</div>
      ) : (
        <SectionCard title="Organization" subtitle="Name shown across Rhodes and on documents" isMobile={isMobile}>
          {error && <div style={{ fontSize: 12.5, color: "#c73e3e", marginBottom: 12 }}>{error}</div>}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 500, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Organization Name</div>
              {editing ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={orgName} onChange={(e) => setOrgName(e.target.value)} style={{ flex: 1, padding: "8px 10px", fontSize: 13, border: "1px solid #ddd9d0", borderRadius: 6, background: "#fff", color: "#1a1a1f", fontFamily: "inherit", outline: "none" }} />
                  <button onClick={handleSave} disabled={saving} style={{ padding: "8px 14px", fontSize: 12, fontWeight: 600, color: "#fff", background: "#2d5a3d", border: "none", borderRadius: 6, cursor: "pointer" }}>{saving ? "Saving..." : "Save"}</button>
                  <button onClick={() => { setEditing(false); setOrgName(currentUser?.orgName || ""); }} style={{ padding: "8px 12px", fontSize: 12, color: "#6b6b76", background: "transparent", border: "1px solid #ddd9d0", borderRadius: 6, cursor: "pointer" }}>Cancel</button>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13, color: "#1a1a1f" }}>{orgName || "—"}</span>
                  {currentUser?.orgRole === "owner" && (
                    <button onClick={() => setEditing(true)} style={{ padding: "4px 10px", fontSize: 11, color: "#6b6b76", background: "transparent", border: "1px solid #ddd9d0", borderRadius: 4, cursor: "pointer" }}>Edit</button>
                  )}
                </div>
              )}
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 500, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Your Role</div>
              <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 10, fontSize: 12, fontWeight: 500, background: "rgba(45,90,61,0.10)", color: "#2d5a3d", textTransform: "capitalize" }}>{currentUser?.orgRole || "member"}</span>
            </div>
          </div>
        </SectionCard>
      )}
    </div>
  );
}
