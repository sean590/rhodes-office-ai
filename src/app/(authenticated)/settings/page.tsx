"use client";

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UserRole = "admin" | "editor" | "viewer";

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
  avatar_url: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROLE_BADGE_STYLES: Record<UserRole, { bg: string; color: string }> = {
  admin: { bg: "rgba(45,90,61,0.10)", color: "#2d5a3d" },
  editor: { bg: "rgba(51,102,168,0.10)", color: "#3366a8" },
  viewer: { bg: "rgba(148,148,160,0.10)", color: "#6b6b76" },
};

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SettingsPage() {
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

  // Fetch current user info
  const fetchCurrentUser = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (!res.ok) return;
      const data = await res.json();
      setCurrentUser(data);
    } catch {
      // Silently fail — user info will be empty
    }
  }, []);

  // Fetch all users (admin only)
  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const res = await fetch("/api/users");
      if (res.status === 403) {
        // Not admin — that's fine, we just don't show the user management section
        setUsers([]);
        return;
      }
      if (!res.ok) throw new Error("Failed to load users");
      const data = await res.json();
      setUsers(data);
    } catch {
      // Non-admins will get 403, which is expected
      setUsers([]);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchCurrentUser(), fetchUsers()]).finally(() =>
      setLoading(false)
    );
  }, [fetchCurrentUser, fetchUsers]);

  // Change a user's role
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
      // Refresh users list
      await fetchUsers();
      // If the user changed their own role, refresh current user too
      if (userId === currentUser?.id) {
        await fetchCurrentUser();
      }
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
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setError(null);
    setInviteSuccess(null);
    try {
      const res = await fetch("/api/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to send invite");
      }
      setInviteSuccess(`Invite sent to ${data.email} (${data.role})`);
      setInviteEmail("");
      setInviteRole("viewer");
      setShowInvite(false);
      // Refresh users list to show the new pending user
      await fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send invite");
    } finally {
      setInviting(false);
    }
  };

  const isAdmin = currentUser?.role === "admin";

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 80,
            color: "#9494a0",
            fontSize: 13,
          }}
        >
          Loading settings...
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
      {/* Title bar */}
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 600,
            color: "#1a1a1f",
            letterSpacing: "-0.02em",
            margin: 0,
          }}
        >
          Settings
        </h1>
        <p
          style={{
            fontSize: 13,
            color: "#9494a0",
            margin: "4px 0 0 0",
          }}
        >
          Manage users and permissions
        </p>
      </div>

      {/* Error banner */}
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
          }}
        >
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            style={{
              background: "none",
              border: "none",
              color: "#dc2626",
              cursor: "pointer",
              fontSize: 16,
              padding: "0 4px",
            }}
          >
            x
          </button>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Card 1 — Your Profile */}
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e8e6df",
            borderRadius: 10,
            padding: 24,
          }}
        >
          <h2
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "#1a1a1f",
              margin: "0 0 16px 0",
            }}
          >
            Your Profile
          </h2>

          {currentUser ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 20,
              }}
            >
              {/* Email */}
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
                <div style={{ fontSize: 13, color: "#1a1a1f" }}>
                  {currentUser.email}
                </div>
              </div>

              {/* Display Name */}
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

              {/* Role */}
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
                    background:
                      ROLE_BADGE_STYLES[currentUser.role]?.bg || "#f0f0f0",
                    color:
                      ROLE_BADGE_STYLES[currentUser.role]?.color || "#6b6b76",
                  }}
                >
                  {ROLE_LABELS[currentUser.role] || currentUser.role}
                </span>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "#9494a0" }}>
              Unable to load profile information.
            </div>
          )}
        </div>

        {/* Card 2 — User Management (admin only) */}
        {isAdmin && (
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e8e6df",
              borderRadius: 10,
              padding: 24,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <h2
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#1a1a1f",
                  margin: 0,
                }}
              >
                User Management
              </h2>
              {!showInvite && (
                <button
                  onClick={() => setShowInvite(true)}
                  style={{
                    padding: "6px 14px",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#fff",
                    background: "#2d5a3d",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                >
                  + Invite User
                </button>
              )}
            </div>

            {/* Invite success banner */}
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
                }}
              >
                <span>{inviteSuccess}</span>
                <button
                  onClick={() => setInviteSuccess(null)}
                  style={{ background: "none", border: "none", color: "#2d5a3d", cursor: "pointer", fontSize: 16, padding: "0 4px" }}
                >
                  x
                </button>
              </div>
            )}

            {/* Invite form */}
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
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
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
                        padding: "8px 10px",
                        fontSize: 13,
                        border: "1px solid #ddd9d0",
                        borderRadius: 6,
                        background: "#fff",
                        color: "#1a1a1f",
                        fontFamily: "inherit",
                        outline: "none",
                        boxSizing: "border-box",
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
                        padding: "8px 28px 8px 10px",
                        fontSize: 13,
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
                      }}
                    >
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <button
                    onClick={handleInvite}
                    disabled={inviting || !inviteEmail.trim()}
                    style={{
                      padding: "8px 16px",
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#fff",
                      background: inviting || !inviteEmail.trim() ? "#9494a0" : "#2d5a3d",
                      border: "none",
                      borderRadius: 6,
                      cursor: inviting || !inviteEmail.trim() ? "not-allowed" : "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {inviting ? "Sending..." : "Send Invite"}
                  </button>
                  <button
                    onClick={() => { setShowInvite(false); setInviteEmail(""); setInviteRole("viewer"); }}
                    style={{
                      padding: "8px 12px",
                      fontSize: 13,
                      color: "#6b6b76",
                      background: "transparent",
                      border: "1px solid #ddd9d0",
                      borderRadius: 6,
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {usersLoading ? (
              <div style={{ fontSize: 13, color: "#9494a0", padding: "16px 0" }}>
                Loading users...
              </div>
            ) : users.length === 0 ? (
              <div style={{ fontSize: 13, color: "#9494a0", padding: "16px 0" }}>
                No users found.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 13,
                  }}
                >
                  <thead>
                    <tr>
                      <th
                        style={{
                          textAlign: "left",
                          padding: "8px 12px",
                          fontSize: 11,
                          fontWeight: 500,
                          color: "#9494a0",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          borderBottom: "1px solid #e8e6df",
                        }}
                      >
                        Name / Email
                      </th>
                      <th
                        style={{
                          textAlign: "left",
                          padding: "8px 12px",
                          fontSize: 11,
                          fontWeight: 500,
                          color: "#9494a0",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          borderBottom: "1px solid #e8e6df",
                        }}
                      >
                        Role
                      </th>
                      <th
                        style={{
                          textAlign: "left",
                          padding: "8px 12px",
                          fontSize: 11,
                          fontWeight: 500,
                          color: "#9494a0",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          borderBottom: "1px solid #e8e6df",
                        }}
                      >
                        Joined
                      </th>
                      <th
                        style={{
                          textAlign: "right",
                          padding: "8px 12px",
                          fontSize: 11,
                          fontWeight: 500,
                          color: "#9494a0",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          borderBottom: "1px solid #e8e6df",
                          width: 60,
                        }}
                      >
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => {
                      const isSelf = u.id === currentUser?.id;
                      return (
                        <tr key={u.id}>
                          <td
                            style={{
                              padding: "10px 12px",
                              borderBottom: "1px solid #f0eeea",
                              color: "#1a1a1f",
                            }}
                          >
                            <div style={{ fontWeight: 500 }}>
                              {u.display_name || (
                                <span style={{ color: "#9494a0", fontStyle: "italic" }}>
                                  No name
                                </span>
                              )}
                            </div>
                            <div
                              style={{
                                fontSize: 12,
                                color: "#9494a0",
                                marginTop: 2,
                              }}
                            >
                              {u.email || u.id.slice(0, 8) + "..."}
                            </div>
                          </td>
                          <td
                            style={{
                              padding: "10px 12px",
                              borderBottom: "1px solid #f0eeea",
                            }}
                          >
                            {isSelf ? (
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
                                  {ROLE_LABELS[u.role]}
                                </span>
                                <span
                                  style={{
                                    fontSize: 11,
                                    color: "#9494a0",
                                    fontStyle: "italic",
                                  }}
                                >
                                  (you)
                                </span>
                              </div>
                            ) : (
                              <select
                                value={u.role}
                                disabled={updatingRole === u.id}
                                onChange={(e) =>
                                  handleRoleChange(u.id, e.target.value as UserRole)
                                }
                                style={{
                                  padding: "4px 8px",
                                  borderRadius: 6,
                                  border: "1px solid #ddd9d0",
                                  fontSize: 12,
                                  color: "#1a1a1f",
                                  background: "#ffffff",
                                  cursor:
                                    updatingRole === u.id
                                      ? "not-allowed"
                                      : "pointer",
                                  opacity: updatingRole === u.id ? 0.6 : 1,
                                }}
                              >
                                <option value="admin">Admin</option>
                                <option value="editor">Editor</option>
                                <option value="viewer">Viewer</option>
                              </select>
                            )}
                          </td>
                          <td
                            style={{
                              padding: "10px 12px",
                              borderBottom: "1px solid #f0eeea",
                              color: "#6b6b76",
                              fontSize: 12,
                            }}
                          >
                            {u.created_at
                              ? new Date(u.created_at).toLocaleDateString(
                                  "en-US",
                                  {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                  }
                                )
                              : "—"}
                          </td>
                          <td
                            style={{
                              padding: "10px 12px",
                              borderBottom: "1px solid #f0eeea",
                              textAlign: "right",
                            }}
                          >
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
          </div>
        )}

        {/* Card 3 — Permissions Reference */}
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e8e6df",
            borderRadius: 10,
            padding: 24,
          }}
        >
          <h2
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "#1a1a1f",
              margin: "0 0 4px 0",
            }}
          >
            Permissions
          </h2>
          <p
            style={{
              fontSize: 12,
              color: "#9494a0",
              margin: "0 0 16px 0",
            }}
          >
            Reference for what each role can do
          </p>

          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 13,
              }}
            >
              <thead>
                <tr>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "8px 12px",
                      fontSize: 11,
                      fontWeight: 500,
                      color: "#9494a0",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      borderBottom: "1px solid #e8e6df",
                      width: "40%",
                    }}
                  >
                    Permission
                  </th>
                  <th
                    style={{
                      textAlign: "center",
                      padding: "8px 12px",
                      fontSize: 11,
                      fontWeight: 500,
                      color: "#9494a0",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      borderBottom: "1px solid #e8e6df",
                      width: "20%",
                    }}
                  >
                    Admin
                  </th>
                  <th
                    style={{
                      textAlign: "center",
                      padding: "8px 12px",
                      fontSize: 11,
                      fontWeight: 500,
                      color: "#9494a0",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      borderBottom: "1px solid #e8e6df",
                      width: "20%",
                    }}
                  >
                    Editor
                  </th>
                  <th
                    style={{
                      textAlign: "center",
                      padding: "8px 12px",
                      fontSize: 11,
                      fontWeight: 500,
                      color: "#9494a0",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      borderBottom: "1px solid #e8e6df",
                      width: "20%",
                    }}
                  >
                    Viewer
                  </th>
                </tr>
              </thead>
              <tbody>
                {PERMISSIONS.map((perm) => (
                  <tr key={perm.label}>
                    <td
                      style={{
                        padding: "10px 12px",
                        borderBottom: "1px solid #f0eeea",
                        color: "#1a1a1f",
                        fontWeight: 500,
                      }}
                    >
                      {perm.label}
                    </td>
                    <td
                      style={{
                        padding: "10px 12px",
                        borderBottom: "1px solid #f0eeea",
                        textAlign: "center",
                      }}
                    >
                      <PermissionIndicator allowed={perm.admin} />
                    </td>
                    <td
                      style={{
                        padding: "10px 12px",
                        borderBottom: "1px solid #f0eeea",
                        textAlign: "center",
                      }}
                    >
                      <PermissionIndicator allowed={perm.editor} />
                    </td>
                    <td
                      style={{
                        padding: "10px 12px",
                        borderBottom: "1px solid #f0eeea",
                        textAlign: "center",
                      }}
                    >
                      <PermissionIndicator allowed={perm.viewer} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

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
