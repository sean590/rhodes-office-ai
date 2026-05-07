"use client";

import { useState, useEffect, useCallback } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { SectionCard } from "@/components/settings/section-card";

type UserRole = "owner" | "admin" | "member" | "viewer";

interface UserProfile {
  id: string;
  role: UserRole;
  display_name: string | null;
  avatar_url: string | null;
  email: string;
  created_at: string;
  updated_at: string;
}

interface CurrentUserInfo {
  id: string;
  email: string;
  role: UserRole;
  display_name: string | null;
  orgId?: string;
  orgRole?: string;
}

interface PendingInvite {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
  expires_at: string;
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

const PERMISSIONS = [
  { label: "View entities", admin: true, editor: true, viewer: true },
  { label: "Edit entities", admin: true, editor: true, viewer: false },
  { label: "Create entities", admin: true, editor: true, viewer: false },
  { label: "Delete entities", admin: true, editor: false, viewer: false },
  { label: "Manage users", admin: true, editor: false, viewer: false },
  { label: "Manage settings", admin: true, editor: false, viewer: false },
];

function PermissionIndicator({ allowed }: { allowed: boolean }) {
  if (allowed) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22,
          height: 22,
          borderRadius: "50%",
          background: "rgba(45,90,61,0.10)",
          color: "#2d5a3d",
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    );
  }
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        borderRadius: "50%",
        background: "rgba(148,148,160,0.08)",
        color: "#bbbbc4",
        fontSize: 13,
      }}
    >
      <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </span>
  );
}

export default function SettingsTeamPage() {
  const isMobile = useIsMobile();
  const [currentUser, setCurrentUser] = useState<CurrentUserInfo | null>(null);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [usersLoading, setUsersLoading] = useState(false);
  const [updatingRole, setUpdatingRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("viewer");
  const [inviting, setInviting] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [deletingUser, setDeletingUser] = useState<string | null>(null);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [resendingInvite, setResendingInvite] = useState<string | null>(null);

  const fetchCurrentUser = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (!res.ok) return;
      const data = await res.json();
      setCurrentUser(data);
    } catch { /* ignore */ }
  }, []);

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const res = await fetch("/api/users");
      if (res.status === 403) {
        setUsers([]);
        return;
      }
      if (!res.ok) throw new Error("Failed to load users");
      const data = await res.json();
      setUsers(data);
    } catch {
      setUsers([]);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const fetchPendingInvites = useCallback(async (orgId: string) => {
    try {
      const res = await fetch(`/api/organizations/${orgId}/members`);
      if (!res.ok) return;
      const data = await res.json();
      setPendingInvites(data.invites || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    Promise.all([fetchCurrentUser(), fetchUsers()]).finally(() => setLoading(false));
  }, [fetchCurrentUser, fetchUsers]);

  useEffect(() => {
    if (currentUser?.orgId) fetchPendingInvites(currentUser.orgId);
  }, [currentUser?.orgId, fetchPendingInvites]);

  const isAdmin =
    currentUser?.role === "admin" ||
    currentUser?.orgRole === "owner" ||
    currentUser?.orgRole === "admin";

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    setUpdatingRole(userId);
    setError(null);
    try {
      const res = await fetch(`/api/users/${userId}/role`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update role");
      }
      await fetchUsers();
      if (userId === currentUser?.id) await fetchCurrentUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update role");
    } finally {
      setUpdatingRole(null);
    }
  };

  const handleDeleteUser = async (userId: string, email: string) => {
    if (!confirm(`Remove ${email || "this user"}? This will delete their account and revoke access.`)) return;
    setDeletingUser(userId);
    setError(null);
    try {
      const res = await fetch(`/api/users/${userId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete user");
      }
      await fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete user");
    } finally {
      setDeletingUser(null);
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !currentUser?.orgId) return;
    setInviting(true);
    setError(null);
    setInviteSuccess(null);
    try {
      const res = await fetch(`/api/organizations/${currentUser.orgId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send invite");
      setInviteSuccess(`Invite sent to ${data.email} (${data.role})`);
      setInviteEmail("");
      setInviteRole("viewer");
      setShowInvite(false);
      await fetchUsers();
      if (currentUser?.orgId) await fetchPendingInvites(currentUser.orgId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send invite");
    } finally {
      setInviting(false);
    }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    if (!currentUser?.orgId) return;
    try {
      const res = await fetch(`/api/organizations/${currentUser.orgId}/invites/${inviteId}`, { method: "DELETE" });
      if (res.ok) {
        setPendingInvites((prev) => prev.filter((i) => i.id !== inviteId));
      }
    } catch { /* ignore */ }
  };

  const handleResendInvite = async (inviteId: string) => {
    if (!currentUser?.orgId) return;
    setResendingInvite(inviteId);
    try {
      const res = await fetch(`/api/organizations/${currentUser.orgId}/invites/${inviteId}`, { method: "PATCH" });
      if (res.ok) {
        const updated = await res.json();
        setPendingInvites((prev) =>
          prev.map((i) => (i.id === inviteId ? { ...i, expires_at: updated.expires_at } : i))
        );
      }
    } catch { /* ignore */ }
    setResendingInvite(null);
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
          Team
        </h1>
        <p style={{ fontSize: 13, color: "#9494a0", margin: "4px 0 0 0" }}>
          Invite users and manage roles
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
        {isAdmin && (
          <SectionCard
            title="User Management"
            isMobile={isMobile}
            headerRight={
              !showInvite ? (
                <button
                  onClick={() => setShowInvite(true)}
                  style={{
                    padding: isMobile ? "10px 16px" : "6px 14px",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#fff",
                    background: "#2d5a3d",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                    minHeight: isMobile ? 44 : undefined,
                  }}
                >
                  + Invite User
                </button>
              ) : undefined
            }
          >
            {inviteSuccess && (
              <div
                style={{
                  background: "rgba(45,138,78,0.08)",
                  border: "1px solid rgba(45,138,78,0.20)",
                  borderRadius: 8,
                  padding: "10px 14px",
                  marginBottom: 16,
                  fontSize: 13,
                  color: "#2d5a3d",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <span style={{ flex: 1 }}>{inviteSuccess}</span>
                <button
                  onClick={() => setInviteSuccess(null)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#2d5a3d",
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

            {showInvite && (
              <div
                style={{
                  background: "#fafaf7",
                  border: "1px solid #e8e6df",
                  borderRadius: 8,
                  padding: 16,
                  marginBottom: 16,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1f", marginBottom: 12 }}>
                  Invite a new user
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: isMobile ? "column" : "row",
                    gap: isMobile ? 12 : 8,
                    alignItems: isMobile ? "stretch" : "flex-end",
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <label style={{ display: "block", fontSize: 11, fontWeight: 500, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                      Email
                    </label>
                    <input
                      type="email"
                      placeholder="user@example.com"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleInvite(); }}
                      style={{
                        width: "100%",
                        padding: isMobile ? "12px 12px" : "8px 10px",
                        fontSize: isMobile ? 16 : 13,
                        border: "1px solid #ddd9d0",
                        borderRadius: 6,
                        background: "#fff",
                        color: "#1a1a1f",
                        fontFamily: "inherit",
                        outline: "none",
                        boxSizing: "border-box",
                        minHeight: isMobile ? 44 : undefined,
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 11, fontWeight: 500, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                      Role
                    </label>
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as UserRole)}
                      style={{
                        padding: isMobile ? "12px 28px 12px 12px" : "8px 28px 8px 10px",
                        fontSize: isMobile ? 16 : 13,
                        border: "1px solid #ddd9d0",
                        borderRadius: 6,
                        background: "#fff",
                        color: "#1a1a1f",
                        fontFamily: "inherit",
                        outline: "none",
                        appearance: "none" as const,
                        backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'10\' height=\'6\' viewBox=\'0 0 10 6\' fill=\'none\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M1 1l4 4 4-4\' stroke=\'%239494a0\' stroke-width=\'1.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E")',
                        backgroundRepeat: "no-repeat",
                        backgroundPosition: "right 10px center",
                        width: isMobile ? "100%" : undefined,
                        minHeight: isMobile ? 44 : undefined,
                        boxSizing: "border-box",
                      }}
                    >
                      <option value="viewer">Viewer</option>
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div style={{ display: "flex", gap: 8, ...(isMobile ? { marginTop: 4 } : {}) }}>
                    <button
                      onClick={handleInvite}
                      disabled={inviting || !inviteEmail.trim()}
                      style={{
                        padding: isMobile ? "12px 16px" : "8px 16px",
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#fff",
                        background: inviting || !inviteEmail.trim() ? "#9494a0" : "#2d5a3d",
                        border: "none",
                        borderRadius: 6,
                        cursor: inviting || !inviteEmail.trim() ? "not-allowed" : "pointer",
                        whiteSpace: "nowrap",
                        flex: isMobile ? 1 : undefined,
                        minHeight: isMobile ? 44 : undefined,
                      }}
                    >
                      {inviting ? "Sending..." : "Send Invite"}
                    </button>
                    <button
                      onClick={() => { setShowInvite(false); setInviteEmail(""); setInviteRole("viewer"); }}
                      style={{
                        padding: isMobile ? "12px 16px" : "8px 12px",
                        fontSize: 13,
                        color: "#6b6b76",
                        background: "transparent",
                        border: "1px solid #ddd9d0",
                        borderRadius: 6,
                        cursor: "pointer",
                        minHeight: isMobile ? 44 : undefined,
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {usersLoading ? (
              <div style={{ fontSize: 13, color: "#9494a0", padding: "16px 0" }}>Loading users...</div>
            ) : users.length === 0 ? (
              <div style={{ fontSize: 13, color: "#9494a0", padding: "16px 0" }}>No users found.</div>
            ) : isMobile ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {users.map((u) => {
                  const isSelf = u.id === currentUser?.id;
                  return (
                    <div
                      key={u.id}
                      style={{
                        background: "#fafaf7",
                        border: "1px solid #e8e6df",
                        borderRadius: 8,
                        padding: 14,
                      }}
                    >
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontWeight: 500, fontSize: 13, color: "#1a1a1f" }}>
                          {u.display_name || (
                            <span style={{ color: "#9494a0", fontStyle: "italic" }}>No name</span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: "#9494a0", marginTop: 2, wordBreak: "break-all" }}>
                          {u.email || u.id.slice(0, 8) + "..."}
                        </div>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {isSelf || u.role === "owner" ? (
                            <>
                              <span
                                style={{
                                  display: "inline-block",
                                  padding: "3px 10px",
                                  borderRadius: 10,
                                  fontSize: 12,
                                  fontWeight: 500,
                                  background: ROLE_BADGE_STYLES[u.role]?.bg || "#f0f0f0",
                                  color: ROLE_BADGE_STYLES[u.role]?.color || "#6b6b76",
                                }}
                              >
                                {ROLE_LABELS[u.role] || u.role}
                              </span>
                              {isSelf && (
                                <span style={{ fontSize: 11, color: "#9494a0", fontStyle: "italic" }}>
                                  (you)
                                </span>
                              )}
                            </>
                          ) : (
                            <select
                              value={u.role}
                              disabled={updatingRole === u.id}
                              onChange={(e) => handleRoleChange(u.id, e.target.value as UserRole)}
                              style={{
                                padding: "8px 28px 8px 10px",
                                borderRadius: 6,
                                border: "1px solid #ddd9d0",
                                fontSize: 13,
                                color: "#1a1a1f",
                                background: "#ffffff",
                                cursor: updatingRole === u.id ? "not-allowed" : "pointer",
                                opacity: updatingRole === u.id ? 0.6 : 1,
                                minHeight: 44,
                                appearance: "none" as const,
                                backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'10\' height=\'6\' viewBox=\'0 0 10 6\' fill=\'none\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M1 1l4 4 4-4\' stroke=\'%239494a0\' stroke-width=\'1.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E")',
                                backgroundRepeat: "no-repeat",
                                backgroundPosition: "right 10px center",
                              }}
                            >
                              <option value="admin">Admin</option>
                              <option value="member">Member</option>
                              <option value="viewer">Viewer</option>
                            </select>
                          )}
                        </div>

                        <div style={{ fontSize: 12, color: "#6b6b76" }}>
                          {u.created_at
                            ? new Date(u.created_at).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })
                            : "---"}
                        </div>
                      </div>

                      {!isSelf && (
                        <div style={{ marginTop: 10, borderTop: "1px solid #e8e6df", paddingTop: 10 }}>
                          <button
                            onClick={() => handleDeleteUser(u.id, u.email)}
                            disabled={deletingUser === u.id}
                            style={{
                              background: "none",
                              border: "none",
                              color: deletingUser === u.id ? "#bbbbc4" : "#dc2626",
                              cursor: deletingUser === u.id ? "not-allowed" : "pointer",
                              fontSize: 12,
                              fontWeight: 500,
                              opacity: deletingUser === u.id ? 0.6 : 1,
                              padding: "10px 8px",
                              minHeight: 44,
                              display: "flex",
                              alignItems: "center",
                            }}
                          >
                            {deletingUser === u.id ? "Removing..." : "Remove user"}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 11, fontWeight: 500, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid #e8e6df" }}>Name / Email</th>
                      <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 11, fontWeight: 500, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid #e8e6df" }}>Role</th>
                      <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 11, fontWeight: 500, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid #e8e6df" }}>Joined</th>
                      <th style={{ textAlign: "right", padding: "8px 12px", fontSize: 11, fontWeight: 500, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid #e8e6df", width: 60 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => {
                      const isSelf = u.id === currentUser?.id;
                      return (
                        <tr key={u.id}>
                          <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0eeea", color: "#1a1a1f" }}>
                            <div style={{ fontWeight: 500 }}>
                              {u.display_name || (
                                <span style={{ color: "#9494a0", fontStyle: "italic" }}>No name</span>
                              )}
                            </div>
                            <div style={{ fontSize: 12, color: "#9494a0", marginTop: 2 }}>
                              {u.email || u.id.slice(0, 8) + "..."}
                            </div>
                          </td>
                          <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0eeea" }}>
                            {isSelf || u.role === "owner" ? (
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span
                                  style={{
                                    display: "inline-block",
                                    padding: "3px 10px",
                                    borderRadius: 10,
                                    fontSize: 12,
                                    fontWeight: 500,
                                    background: ROLE_BADGE_STYLES[u.role]?.bg || "#f0f0f0",
                                    color: ROLE_BADGE_STYLES[u.role]?.color || "#6b6b76",
                                  }}
                                >
                                  {ROLE_LABELS[u.role] || u.role}
                                </span>
                                {isSelf && (
                                  <span style={{ fontSize: 11, color: "#9494a0", fontStyle: "italic" }}>
                                    (you)
                                  </span>
                                )}
                              </div>
                            ) : (
                              <select
                                value={u.role}
                                disabled={updatingRole === u.id}
                                onChange={(e) => handleRoleChange(u.id, e.target.value as UserRole)}
                                style={{
                                  padding: "4px 8px",
                                  borderRadius: 6,
                                  border: "1px solid #ddd9d0",
                                  fontSize: 12,
                                  color: "#1a1a1f",
                                  background: "#ffffff",
                                  cursor: updatingRole === u.id ? "not-allowed" : "pointer",
                                  opacity: updatingRole === u.id ? 0.6 : 1,
                                }}
                              >
                                <option value="admin">Admin</option>
                                <option value="member">Member</option>
                                <option value="viewer">Viewer</option>
                              </select>
                            )}
                          </td>
                          <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0eeea", color: "#6b6b76", fontSize: 12 }}>
                            {u.created_at
                              ? new Date(u.created_at).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })
                              : "---"}
                          </td>
                          <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0eeea", textAlign: "right" }}>
                            {!isSelf && (
                              <button
                                onClick={() => handleDeleteUser(u.id, u.email)}
                                disabled={deletingUser === u.id}
                                style={{
                                  background: "none",
                                  border: "none",
                                  color: deletingUser === u.id ? "#bbbbc4" : "#dc2626",
                                  cursor: deletingUser === u.id ? "not-allowed" : "pointer",
                                  fontSize: 12,
                                  fontWeight: 500,
                                  opacity: deletingUser === u.id ? 0.6 : 1,
                                  padding: "4px 8px",
                                }}
                              >
                                {deletingUser === u.id ? "Removing..." : "Remove"}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {pendingInvites.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
                  Pending Invites
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {pendingInvites.map((inv) => {
                    const isExpired = inv.expires_at && new Date(inv.expires_at) < new Date();
                    return (
                      <div
                        key={inv.id}
                        style={{
                          display: "flex",
                          alignItems: isMobile ? "flex-start" : "center",
                          flexDirection: isMobile ? "column" : "row",
                          justifyContent: "space-between",
                          gap: isMobile ? 8 : 12,
                          padding: isMobile ? 14 : "10px 12px",
                          background: "#fafaf7",
                          border: "1px solid #e8e6df",
                          borderRadius: 8,
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: "#1a1a1f", wordBreak: "break-all" }}>
                            {inv.email}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                            <span style={{
                              display: "inline-block",
                              padding: "2px 8px",
                              borderRadius: 10,
                              fontSize: 11,
                              fontWeight: 500,
                              background: isExpired ? "rgba(220,38,38,0.08)" : "rgba(255,169,0,0.10)",
                              color: isExpired ? "#dc2626" : "#b37400",
                            }}>
                              {isExpired ? "Expired" : "Pending"}
                            </span>
                            <span style={{
                              display: "inline-block",
                              padding: "2px 8px",
                              borderRadius: 10,
                              fontSize: 11,
                              fontWeight: 500,
                              background: ROLE_BADGE_STYLES[inv.role]?.bg || "#f0f0f0",
                              color: ROLE_BADGE_STYLES[inv.role]?.color || "#6b6b76",
                            }}>
                              {ROLE_LABELS[inv.role] || inv.role}
                            </span>
                            {inv.expires_at && (
                              <span style={{ fontSize: 11, color: isExpired ? "#dc2626" : "#9494a0" }}>
                                {isExpired ? "Expired" : "Expires"} {new Date(inv.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                              </span>
                            )}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          {isExpired && (
                            <button
                              onClick={() => handleResendInvite(inv.id)}
                              disabled={resendingInvite === inv.id}
                              style={{
                                background: "none",
                                border: "none",
                                color: "#2d5a3d",
                                cursor: resendingInvite === inv.id ? "default" : "pointer",
                                fontSize: 12,
                                fontWeight: 500,
                                padding: isMobile ? "10px 8px" : "4px 8px",
                                minHeight: isMobile ? 44 : undefined,
                                whiteSpace: "nowrap",
                                opacity: resendingInvite === inv.id ? 0.5 : 1,
                              }}
                            >
                              {resendingInvite === inv.id ? "Sending..." : "Resend"}
                            </button>
                          )}
                          <button
                            onClick={() => handleRevokeInvite(inv.id)}
                            style={{
                              background: "none",
                              border: "none",
                              color: "#dc2626",
                              cursor: "pointer",
                              fontSize: 12,
                              fontWeight: 500,
                              padding: isMobile ? "10px 8px" : "4px 8px",
                              minHeight: isMobile ? 44 : undefined,
                              whiteSpace: "nowrap",
                            }}
                          >
                            Revoke
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </SectionCard>
        )}

        <SectionCard
          title="Permissions"
          subtitle="Reference for what each role can do"
          isMobile={isMobile}
        >
          {isMobile ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {PERMISSIONS.map((perm) => (
                <div
                  key={perm.label}
                  style={{
                    background: "#fafaf7",
                    border: "1px solid #e8e6df",
                    borderRadius: 8,
                    padding: 14,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 500, color: "#1a1a1f", marginBottom: 10 }}>
                    {perm.label}
                  </div>
                  <div style={{ display: "flex", gap: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <PermissionIndicator allowed={perm.admin} />
                      <span style={{ fontSize: 12, color: "#6b6b76" }}>Admin</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <PermissionIndicator allowed={perm.editor} />
                      <span style={{ fontSize: 12, color: "#6b6b76" }}>Editor</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <PermissionIndicator allowed={perm.viewer} />
                      <span style={{ fontSize: 12, color: "#6b6b76" }}>Viewer</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 11, fontWeight: 500, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid #e8e6df", width: "40%" }}>Permission</th>
                    <th style={{ textAlign: "center", padding: "8px 12px", fontSize: 11, fontWeight: 500, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid #e8e6df", width: "20%" }}>Admin</th>
                    <th style={{ textAlign: "center", padding: "8px 12px", fontSize: 11, fontWeight: 500, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid #e8e6df", width: "20%" }}>Editor</th>
                    <th style={{ textAlign: "center", padding: "8px 12px", fontSize: 11, fontWeight: 500, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid #e8e6df", width: "20%" }}>Viewer</th>
                  </tr>
                </thead>
                <tbody>
                  {PERMISSIONS.map((perm) => (
                    <tr key={perm.label}>
                      <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0eeea", color: "#1a1a1f", fontWeight: 500 }}>
                        {perm.label}
                      </td>
                      <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0eeea", textAlign: "center" }}>
                        <PermissionIndicator allowed={perm.admin} />
                      </td>
                      <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0eeea", textAlign: "center" }}>
                        <PermissionIndicator allowed={perm.editor} />
                      </td>
                      <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0eeea", textAlign: "center" }}>
                        <PermissionIndicator allowed={perm.viewer} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
