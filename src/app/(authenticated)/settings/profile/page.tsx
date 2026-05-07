"use client";

import { useState, useEffect, useCallback } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { SectionCard } from "@/components/settings/section-card";

type UserRole = "owner" | "admin" | "member" | "viewer";

interface CurrentUserInfo {
  id: string;
  email: string;
  role: UserRole;
  display_name: string | null;
  avatar_url: string | null;
  orgId?: string;
  orgRole?: string;
  orgName?: string;
  primary_entity_id?: string | null;
}

const ROLE_BADGE_STYLES: Record<string, { bg: string; color: string }> = {
  owner: { bg: "rgba(45,90,61,0.15)", color: "#2d5a3d" },
  admin: { bg: "rgba(45,90,61,0.10)", color: "#2d5a3d" },
  member: { bg: "rgba(51,102,168,0.10)", color: "#3366a8" },
  editor: { bg: "rgba(51,102,168,0.10)", color: "#3366a8" },
  viewer: { bg: "rgba(148,148,160,0.10)", color: "#6b6b76" },
};

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  editor: "Editor",
  viewer: "Viewer",
};

export default function SettingsProfilePage() {
  const isMobile = useIsMobile();
  const [currentUser, setCurrentUser] = useState<CurrentUserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [primaryEntityId, setPrimaryEntityId] = useState<string | null>(null);
  const [orgEntities, setOrgEntities] = useState<Array<{ id: string; name: string; type: string }>>([]);
  const [savingEntity, setSavingEntity] = useState(false);

  const [orgName, setOrgName] = useState("");
  const [editingOrgName, setEditingOrgName] = useState(false);
  const [savingOrg, setSavingOrg] = useState(false);

  const fetchCurrentUser = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (!res.ok) return;
      const data = await res.json();
      setCurrentUser(data);
      if (data.orgName) setOrgName(data.orgName);
      if (data.primary_entity_id !== undefined) setPrimaryEntityId(data.primary_entity_id);
    } catch {
      // Silently fail
    }
  }, []);

  const fetchOrgEntities = useCallback(async () => {
    try {
      const res = await fetch("/api/entities");
      if (!res.ok) return;
      const data = await res.json();
      setOrgEntities(
        (data ?? []).map((e: { id: string; name: string; type: string }) => ({
          id: e.id,
          name: e.name,
          type: e.type,
        })),
      );
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => {
    Promise.all([fetchCurrentUser(), fetchOrgEntities()]).finally(() => setLoading(false));
  }, [fetchCurrentUser, fetchOrgEntities]);

  const handleSaveOrgName = async () => {
    if (!currentUser?.orgId || !orgName.trim()) return;
    setSavingOrg(true);
    try {
      const res = await fetch(`/api/organizations/${currentUser.orgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: orgName.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update organization");
      }
      setEditingOrgName(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setSavingOrg(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 80, color: "#9494a0", fontSize: 13, textAlign: "center" }}>
        Loading...
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: isMobile ? 16 : 24 }}>
        <h1
          style={{
            fontSize: isMobile ? 20 : 22,
            fontWeight: 600,
            color: "#1a1a1f",
            letterSpacing: "-0.02em",
            margin: 0,
          }}
        >
          Profile
        </h1>
        <p style={{ fontSize: 13, color: "#9494a0", margin: "4px 0 0 0" }}>
          Your account and organization
        </p>
      </div>

      {error && (
        <div
          style={{
            background: "rgba(220,38,38,0.06)",
            border: "1px solid rgba(220,38,38,0.15)",
            borderRadius: 10,
            padding: "12px 16px",
            marginBottom: 16,
            color: "#dc2626",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <span style={{ flex: 1 }}>{error}</span>
          <button
            onClick={() => setError(null)}
            style={{
              background: "none",
              border: "none",
              color: "#dc2626",
              cursor: "pointer",
              fontSize: 16,
              padding: "4px 8px",
              minWidth: 44,
              minHeight: 44,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            x
          </button>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 12 : 20 }}>
        <SectionCard title="Your Profile" isMobile={isMobile}>
          {currentUser ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr",
                gap: isMobile ? 16 : 20,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: "#9494a0",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    marginBottom: 6,
                  }}
                >
                  Email
                </div>
                <div style={{ fontSize: 13, color: "#1a1a1f", wordBreak: "break-all" }}>
                  {currentUser.email}
                </div>
              </div>

              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: "#9494a0",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    marginBottom: 6,
                  }}
                >
                  Display Name
                </div>
                <div style={{ fontSize: 13, color: "#1a1a1f" }}>
                  {currentUser.display_name || (
                    <span style={{ color: "#9494a0" }}>Not set</span>
                  )}
                </div>
              </div>

              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: "#9494a0",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    marginBottom: 6,
                  }}
                >
                  Role
                </div>
                <span
                  style={{
                    display: "inline-block",
                    padding: "3px 10px",
                    borderRadius: 10,
                    fontSize: 12,
                    fontWeight: 500,
                    background: ROLE_BADGE_STYLES[currentUser.role]?.bg || "#f0f0f0",
                    color: ROLE_BADGE_STYLES[currentUser.role]?.color || "#6b6b76",
                  }}
                >
                  {ROLE_LABELS[currentUser.role] || currentUser.role}
                </span>
              </div>

              <div style={{ gridColumn: isMobile ? "auto" : "1 / -1" }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: "#9494a0",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    marginBottom: 6,
                  }}
                >
                  My Entity
                </div>
                <div style={{ fontSize: 12, color: "#6b6b76", marginBottom: 6 }}>
                  Link yourself to your personal entity so you can say &quot;me&quot; or &quot;my&quot; in chat.
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <select
                    value={primaryEntityId ?? ""}
                    disabled={savingEntity}
                    onChange={async (e) => {
                      const val = e.target.value || null;
                      setSavingEntity(true);
                      try {
                        const res = await fetch("/api/auth/me", {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ primary_entity_id: val }),
                        });
                        if (res.ok) setPrimaryEntityId(val);
                      } catch { /* ignore */ }
                      finally { setSavingEntity(false); }
                    }}
                    style={{
                      fontSize: 13,
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: "1px solid #d0d0d8",
                      background: "#fff",
                      flex: 1,
                      maxWidth: 300,
                    }}
                  >
                    <option value="">Not set</option>
                    {orgEntities
                      .sort((a, b) => {
                        if (a.type === "person" && b.type !== "person") return -1;
                        if (a.type !== "person" && b.type === "person") return 1;
                        return a.name.localeCompare(b.name);
                      })
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}{e.type === "person" ? " (person)" : ""}
                        </option>
                      ))}
                  </select>
                  {primaryEntityId && (
                    <button
                      type="button"
                      disabled={savingEntity}
                      onClick={async () => {
                        setSavingEntity(true);
                        try {
                          const res = await fetch("/api/auth/me", {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ primary_entity_id: null }),
                          });
                          if (res.ok) setPrimaryEntityId(null);
                        } catch { /* ignore */ }
                        finally { setSavingEntity(false); }
                      }}
                      style={{
                        fontSize: 12,
                        padding: "4px 10px",
                        border: "1px solid #d0d0d8",
                        background: "#fff",
                        color: "#6b6b76",
                        borderRadius: 4,
                        cursor: "pointer",
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "#9494a0" }}>
              Unable to load profile information.
            </div>
          )}
        </SectionCard>

        {currentUser?.orgId && (
          <SectionCard title="Organization" subtitle="Manage your organization settings" isMobile={isMobile}>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 500, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                  Organization Name
                </div>
                {editingOrgName ? (
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      style={{ flex: 1, padding: "8px 10px", fontSize: 13, border: "1px solid #ddd9d0", borderRadius: 6, background: "#fff", color: "#1a1a1f", fontFamily: "inherit", outline: "none" }}
                    />
                    <button
                      onClick={handleSaveOrgName}
                      disabled={savingOrg}
                      style={{ padding: "8px 14px", fontSize: 12, fontWeight: 600, color: "#fff", background: "#2d5a3d", border: "none", borderRadius: 6, cursor: "pointer" }}
                    >
                      {savingOrg ? "Saving..." : "Save"}
                    </button>
                    <button
                      onClick={() => { setEditingOrgName(false); setOrgName(currentUser?.orgName || ""); }}
                      style={{ padding: "8px 12px", fontSize: 12, color: "#6b6b76", background: "transparent", border: "1px solid #ddd9d0", borderRadius: 6, cursor: "pointer" }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, color: "#1a1a1f" }}>{orgName}</span>
                    {currentUser?.orgRole === "owner" && (
                      <button
                        onClick={() => setEditingOrgName(true)}
                        style={{ padding: "4px 10px", fontSize: 11, color: "#6b6b76", background: "transparent", border: "1px solid #ddd9d0", borderRadius: 4, cursor: "pointer" }}
                      >
                        Edit
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 500, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                  Your Role
                </div>
                <span style={{
                  display: "inline-block", padding: "3px 10px", borderRadius: 10, fontSize: 12, fontWeight: 500,
                  background: "rgba(45,90,61,0.10)", color: "#2d5a3d", textTransform: "capitalize",
                }}>
                  {currentUser?.orgRole || "member"}
                </span>
              </div>
            </div>
          </SectionCard>
        )}
      </div>
    </div>
  );
}
