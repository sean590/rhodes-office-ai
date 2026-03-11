"use client";

import { useState, useEffect, useCallback } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSetPageContext } from "@/components/chat/page-context-provider";
import { MfaSection } from "@/components/settings/mfa-section";
import { DOCUMENT_TYPE_LABELS, DOCUMENT_CATEGORY_OPTIONS, DOCUMENT_CATEGORY_LABELS } from "@/lib/constants";
import type { DocumentCategory } from "@/lib/types/entities";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  avatar_url: string | null;
  orgId?: string;
  orgRole?: string;
  orgName?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Accordion Section (mobile collapsible)
// ---------------------------------------------------------------------------

function AccordionSection({
  title,
  subtitle,
  isMobile,
  defaultOpen = true,
  headerRight,
  children,
}: {
  title: string;
  subtitle?: string;
  isMobile: boolean;
  defaultOpen?: boolean;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (!isMobile) {
    // On desktop, render as a normal card section (no collapse behavior)
    return (
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #e8e6df",
          borderRadius: 10,
          padding: 24,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: subtitle ? 4 : 16,
          }}
        >
          <h2
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "#1a1a1f",
              margin: 0,
            }}
          >
            {title}
          </h2>
          {headerRight}
        </div>
        {subtitle && (
          <p
            style={{
              fontSize: 12,
              color: "#9494a0",
              margin: "0 0 16px 0",
            }}
          >
            {subtitle}
          </p>
        )}
        {children}
      </div>
    );
  }

  // Mobile: collapsible accordion
  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #e8e6df",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          padding: "16px 16px",
          background: "none",
          border: "none",
          cursor: "pointer",
          minHeight: 48,
          textAlign: "left",
        }}
      >
        <div style={{ flex: 1 }}>
          <h2
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "#1a1a1f",
              margin: 0,
            }}
          >
            {title}
          </h2>
          {subtitle && (
            <p
              style={{
                fontSize: 12,
                color: "#9494a0",
                margin: "2px 0 0 0",
              }}
            >
              {subtitle}
            </p>
          )}
        </div>
        <svg
          width={16}
          height={16}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#9494a0"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s ease",
            flexShrink: 0,
            marginLeft: 12,
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div style={{ padding: "0 16px 16px 16px" }}>
          {headerRight && (
            <div style={{ marginBottom: 12 }}>{headerRight}</div>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SettingsPage() {
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

  // Organization state
  const [orgName, setOrgName] = useState("");
  const [editingOrgName, setEditingOrgName] = useState(false);
  const [savingOrg, setSavingOrg] = useState(false);
  const [pendingInvites, setPendingInvites] = useState<Array<{
    id: string; email: string; role: string; status: string; created_at: string; expires_at: string;
  }>>([]);

  // Activity log state
  const [activityLog, setActivityLog] = useState<Array<{
    id: string;
    action: string;
    resource_type: string;
    resource_id: string | null;
    metadata: Record<string, unknown>;
    user_id: string | null;
    created_at: string;
    ip_address: string | null;
  }>>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityFilter, setActivityFilter] = useState<{
    resource_type: string;
    action: string;
  }>({ resource_type: "", action: "" });

  // Document template state
  const [templates, setTemplates] = useState<Array<{
    id: string;
    document_type: string;
    document_category: string;
    is_required: boolean;
    description: string | null;
    applies_to_filter: Record<string, string[]>;
    source: string;
  }>>([]);
  const [templateStats, setTemplateStats] = useState<Record<string, { applied: number; satisfied: number }>>({});
  const [systemStats, setSystemStats] = useState<Record<string, { applied: number; satisfied: number }>>({});
  const [systemOverrides, setSystemOverrides] = useState<Record<string, { is_disabled: boolean; is_required: boolean }>>({});
  const [systemDefaults, setSystemDefaults] = useState<Array<{
    document_type: string;
    document_category: string;
    is_required: boolean;
    scope: string;
    applies_to?: string;
    notes?: string;
  }>>([]);
  const [entityCount, setEntityCount] = useState(0);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [updatingSystemDefault, setUpdatingSystemDefault] = useState<string | null>(null);
  const [showAddTemplate, setShowAddTemplate] = useState(false);
  const [newTplDocType, setNewTplDocType] = useState("");
  const [newTplCategory, setNewTplCategory] = useState("formation");
  const [newTplRequired, setNewTplRequired] = useState(true);
  const [newTplDescription, setNewTplDescription] = useState("");
  const [newTplFilter, setNewTplFilter] = useState<Record<string, string[]>>({});
  const [savingTemplate, setSavingTemplate] = useState(false);

  // Fetch current user info
  const fetchCurrentUser = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (!res.ok) return;
      const data = await res.json();
      setCurrentUser(data);
      if (data.orgName) setOrgName(data.orgName);
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

  // Fetch pending invites from org members endpoint
  const fetchPendingInvites = useCallback(async (orgId: string) => {
    try {
      const res = await fetch(`/api/organizations/${orgId}/members`);
      if (!res.ok) return;
      const data = await res.json();
      setPendingInvites(data.invites || []);
    } catch {
      // Non-critical
    }
  }, []);

  // Fetch document templates
  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch("/api/document-templates");
      if (!res.ok) return;
      const data = await res.json();
      setTemplates(data.templates || []);
      setTemplateStats(data.templateStats || {});
      setSystemStats(data.systemStats || {});
      setSystemOverrides(data.systemOverrides || {});
      setSystemDefaults(data.systemDefaults || []);
      setEntityCount(data.entityCount || 0);
    } catch { /* non-critical */ }
    setTemplatesLoaded(true);
  }, []);

  // Fetch activity log (admin only)
  const fetchActivity = useCallback(async () => {
    setActivityLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (activityFilter.resource_type) params.set("resource_type", activityFilter.resource_type);
      if (activityFilter.action) params.set("action", activityFilter.action);
      const res = await fetch(`/api/audit?${params}`);
      if (res.ok) {
        const data = await res.json();
        setActivityLog(data);
      }
    } catch {
      // Non-critical
    } finally {
      setActivityLoading(false);
    }
  }, [activityFilter]);

  useEffect(() => {
    Promise.all([fetchCurrentUser(), fetchUsers(), fetchTemplates()]).finally(() =>
      setLoading(false)
    );
  }, [fetchCurrentUser, fetchUsers, fetchTemplates]);

  // Fetch pending invites once we know the org
  useEffect(() => {
    if (currentUser?.orgId) {
      fetchPendingInvites(currentUser.orgId);
    }
  }, [currentUser?.orgId, fetchPendingInvites]);

  const setPageContext = useSetPageContext();
  useEffect(() => {
    setPageContext({ page: "settings" });
    return () => setPageContext(null);
  }, [setPageContext]);

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
      if (!res.ok) {
        throw new Error(data.error || "Failed to send invite");
      }
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

  const handleRevokeInvite = async (inviteId: string) => {
    if (!currentUser?.orgId) return;
    try {
      const res = await fetch(`/api/organizations/${currentUser.orgId}/invites/${inviteId}`, { method: "DELETE" });
      if (res.ok) {
        setPendingInvites((prev) => prev.filter((i) => i.id !== inviteId));
      }
    } catch { /* ignore */ }
  };

  const isAdmin = currentUser?.role === "admin" || currentUser?.orgRole === "owner" || currentUser?.orgRole === "admin";

  useEffect(() => {
    if (isAdmin) {
      fetchActivity();
    }
  }, [fetchActivity, isAdmin]);

  if (loading) {
    return (
      <div style={{ padding: isMobile ? 16 : 24 }}>
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
    <div style={{ padding: isMobile ? 16 : 24, maxWidth: 960, margin: "0 auto" }}>
      {/* Title bar */}
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
        {/* Card 1 — Your Profile */}
        <AccordionSection title="Your Profile" isMobile={isMobile}>
          {currentUser ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr",
                gap: isMobile ? 16 : 20,
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
                <div style={{ fontSize: 13, color: "#1a1a1f", wordBreak: "break-all" }}>
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
        </AccordionSection>

        {/* Organization */}
        {currentUser?.orgId && (
          <AccordionSection title="Organization" isMobile={isMobile} subtitle="Manage your organization settings">
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
          </AccordionSection>
        )}

        {/* Security & MFA */}
        <AccordionSection
          title="Security"
          isMobile={isMobile}
          subtitle="Two-factor authentication and session settings"
          defaultOpen={!isMobile}
        >
          <MfaSection isMobile={isMobile} />
        </AccordionSection>

        {/* Document Checklist */}
        <AccordionSection
          title="Document Checklist"
          isMobile={isMobile}
          subtitle="Manage expected documents for your entities"
          defaultOpen={!isMobile}
          headerRight={
            !showAddTemplate ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowAddTemplate(true);
                }}
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
                + New Template
              </button>
            ) : undefined
          }
        >
          {/* Add template form */}
          {showAddTemplate && (
            <div style={{
              background: "#fafaf7", borderRadius: 8, padding: 16, marginBottom: 16,
              border: "1px solid #e8e6df",
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1f", marginBottom: 12 }}>
                New Document Template
              </div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 500, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                    Document Type
                  </label>
                  <input
                    placeholder="e.g. Ridge Agreement"
                    value={newTplDocType}
                    onChange={(e) => setNewTplDocType(e.target.value)}
                    style={{
                      width: "100%", fontSize: 13, padding: "7px 10px", border: "1px solid #ddd9d0",
                      borderRadius: 6, background: "#fff", color: "#1a1a1f", fontFamily: "inherit",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 500, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                    Category
                  </label>
                  <select
                    value={newTplCategory}
                    onChange={(e) => setNewTplCategory(e.target.value)}
                    style={{
                      width: "100%", fontSize: 13, padding: "7px 10px", border: "1px solid #ddd9d0",
                      borderRadius: 6, background: "#fff", color: "#1a1a1f", fontFamily: "inherit",
                    }}
                  >
                    {DOCUMENT_CATEGORY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                  Description (optional)
                </label>
                <input
                  placeholder="e.g. Management agreement between entity and Ridge Capital"
                  value={newTplDescription}
                  onChange={(e) => setNewTplDescription(e.target.value)}
                  style={{
                    width: "100%", fontSize: 13, padding: "7px 10px", border: "1px solid #ddd9d0",
                    borderRadius: 6, background: "#fff", color: "#1a1a1f", fontFamily: "inherit",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
                <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, color: "#1a1a1f", cursor: "pointer" }}>
                  <input type="checkbox" checked={newTplRequired} onChange={(e) => setNewTplRequired(e.target.checked)} />
                  Required
                </label>
                <span style={{ fontSize: 12, color: "#9494a0" }}>
                  Applies to: All entities
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  onClick={() => { setShowAddTemplate(false); setNewTplDocType(""); setNewTplDescription(""); }}
                  style={{
                    padding: "6px 14px", fontSize: 12, fontWeight: 500, color: "#6b6b76",
                    background: "#fff", border: "1px solid #ddd9d0", borderRadius: 6, cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  disabled={!newTplDocType.trim() || savingTemplate}
                  onClick={async () => {
                    setSavingTemplate(true);
                    try {
                      const res = await fetch("/api/document-templates", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          document_type: newTplDocType.trim(),
                          document_category: newTplCategory,
                          is_required: newTplRequired,
                          description: newTplDescription.trim() || null,
                          applies_to_filter: Object.keys(newTplFilter).length > 0 ? newTplFilter : {},
                        }),
                      });
                      if (res.ok) {
                        setShowAddTemplate(false);
                        setNewTplDocType("");
                        setNewTplDescription("");
                        setNewTplFilter({});
                        await fetchTemplates();
                      } else {
                        const err = await res.json();
                        alert(err.error || "Failed to create template");
                      }
                    } catch { /* ignore */ }
                    setSavingTemplate(false);
                  }}
                  style={{
                    padding: "6px 14px", fontSize: 12, fontWeight: 600, color: "#fff",
                    background: (!newTplDocType.trim() || savingTemplate) ? "#9494a0" : "#2d5a3d",
                    border: "none", borderRadius: 6, cursor: (!newTplDocType.trim() || savingTemplate) ? "default" : "pointer",
                  }}
                >
                  {savingTemplate ? "Creating..." : "Create Template"}
                </button>
              </div>
            </div>
          )}

          {/* System defaults */}
          <div style={{ marginBottom: 20 }}>
            <div style={{
              fontSize: 12, fontWeight: 600, color: "#1a1a1f", marginBottom: 8,
              display: "flex", alignItems: "center", gap: 8,
            }}>
              System Defaults
              <span style={{ fontSize: 11, fontWeight: 400, color: "#9494a0" }}>
                Auto-generated based on entity type
              </span>
            </div>
            {systemDefaults.map((def) => {
              const override = systemOverrides[def.document_type];
              const isDisabled = override?.is_disabled ?? false;
              const isRequired = override?.is_required ?? def.is_required;
              const stats = systemStats[def.document_type];
              const isOwner = currentUser?.orgRole === "owner";
              const isUpdating = updatingSystemDefault === def.document_type;
              const scopeLabel = def.scope === "base" ? "All entities"
                : def.scope === "type" ? (def.applies_to || "").replace(/_/g, " ")
                : (def.applies_to || "").replace(/_/g, " ");

              const handleToggle = async (field: "is_disabled" | "is_required", value: boolean) => {
                setUpdatingSystemDefault(def.document_type);
                try {
                  await fetch("/api/document-templates", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      document_type: def.document_type,
                      is_disabled: field === "is_disabled" ? value : isDisabled,
                      is_required: field === "is_required" ? value : isRequired,
                    }),
                  });
                  setSystemOverrides((prev) => ({
                    ...prev,
                    [def.document_type]: {
                      is_disabled: field === "is_disabled" ? value : isDisabled,
                      is_required: field === "is_required" ? value : isRequired,
                    },
                  }));
                } catch { /* ignore */ }
                setUpdatingSystemDefault(null);
              };

              return (
                <div key={def.document_type} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "8px 0", borderBottom: "1px solid #f0eee8", fontSize: 13,
                  opacity: isDisabled ? 0.45 : 1,
                }}>
                  {/* Enable/disable toggle (owner only) */}
                  {isOwner ? (
                    <button
                      disabled={isUpdating}
                      onClick={() => handleToggle("is_disabled", !isDisabled)}
                      title={isDisabled ? "Enable this default" : "Disable this default"}
                      style={{
                        width: 18, height: 18, borderRadius: 4, flexShrink: 0, cursor: "pointer",
                        border: isDisabled ? "1.5px solid #ddd9d0" : "none",
                        background: isDisabled ? "transparent" : "#2d5a3d",
                        display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
                      }}
                    >
                      {!isDisabled && (
                        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                          <path d="M1 4l3 3 5-6" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                  ) : (
                    <span style={{
                      width: 8, height: 8, borderRadius: "50%",
                      background: isDisabled ? "#ddd9d0" : "#2d5a3d", flexShrink: 0,
                    }} />
                  )}

                  <span style={{
                    flex: 1, color: "#1a1a1f",
                    textDecoration: isDisabled ? "line-through" : "none",
                  }}>
                    {DOCUMENT_TYPE_LABELS[def.document_type] || def.document_type.replace(/_/g, " ")}
                  </span>

                  {/* Scope label for non-base items */}
                  {def.scope !== "base" && (
                    <span style={{
                      fontSize: 10, fontWeight: 500, padding: "1px 6px", borderRadius: 4,
                      color: "#7b4db5", background: "rgba(123,77,181,0.08)",
                      textTransform: "capitalize",
                    }}>
                      {scopeLabel}
                    </span>
                  )}

                  <span style={{
                    fontSize: 10, fontWeight: 500, padding: "1px 6px", borderRadius: 4,
                    color: "#6b6b76", background: "rgba(107,107,118,0.08)",
                  }}>
                    {DOCUMENT_CATEGORY_LABELS[def.document_category as DocumentCategory] || def.document_category}
                  </span>

                  {/* Required/Recommended toggle (owner only) */}
                  {isOwner && !isDisabled ? (
                    <button
                      disabled={isUpdating}
                      onClick={() => handleToggle("is_required", !isRequired)}
                      style={{
                        fontSize: 10, fontWeight: 500, padding: "1px 6px", borderRadius: 4,
                        cursor: "pointer", border: "none",
                        color: isRequired ? "#c47520" : "#6b6b76",
                        background: isRequired ? "rgba(196,117,32,0.08)" : "rgba(107,107,118,0.08)",
                      }}
                      title="Click to toggle required/recommended"
                    >
                      {isRequired ? "Required" : "Recommended"}
                    </button>
                  ) : (
                    <span style={{
                      fontSize: 10, fontWeight: 500, padding: "1px 6px", borderRadius: 4,
                      color: isRequired ? "#c47520" : "#6b6b76",
                      background: isRequired ? "rgba(196,117,32,0.08)" : "rgba(107,107,118,0.08)",
                    }}>
                      {isRequired ? "Required" : "Recommended"}
                    </span>
                  )}

                  {stats && !isDisabled && (
                    <span style={{ fontSize: 11, color: "#9494a0", whiteSpace: "nowrap" }}>
                      {stats.satisfied}/{stats.applied}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Custom templates */}
          <div>
            <div style={{
              fontSize: 12, fontWeight: 600, color: "#1a1a1f", marginBottom: 8,
              display: "flex", alignItems: "center", gap: 8,
            }}>
              Custom Templates
              {templates.length > 0 && (
                <span style={{ fontSize: 11, fontWeight: 400, color: "#9494a0" }}>
                  ({templates.length})
                </span>
              )}
            </div>
            {templates.length === 0 ? (
              <div style={{ fontSize: 13, color: "#9494a0", padding: "12px 0" }}>
                No custom templates yet. Create one to require specific documents across your entities.
              </div>
            ) : (
              templates.map((tpl) => {
                const stats = templateStats[tpl.id];
                const filterSummary = (() => {
                  const parts: string[] = [];
                  if (tpl.applies_to_filter?.entity_type?.length) {
                    parts.push(tpl.applies_to_filter.entity_type.map((t: string) => t.replace(/_/g, " ")).join(", "));
                  }
                  if (tpl.applies_to_filter?.state?.length) {
                    parts.push(tpl.applies_to_filter.state.join(", "));
                  }
                  return parts.length > 0 ? parts.join(" · ") : "All entities";
                })();
                return (
                  <div key={tpl.id} style={{
                    padding: "10px 0", borderBottom: "1px solid #f0eee8",
                    display: "flex", alignItems: "center", gap: 8, fontSize: 13,
                  }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: "50%", background: "#3366a8", flexShrink: 0,
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: "#1a1a1f", fontWeight: 500 }}>
                        {DOCUMENT_TYPE_LABELS[tpl.document_type] || tpl.document_type.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
                      </div>
                      {tpl.description && (
                        <div style={{ fontSize: 12, color: "#9494a0", marginTop: 2 }}>{tpl.description}</div>
                      )}
                    </div>
                    <span style={{
                      fontSize: 10, fontWeight: 500, padding: "1px 6px", borderRadius: 4,
                      color: "#6b6b76", background: "rgba(107,107,118,0.08)",
                    }}>
                      {DOCUMENT_CATEGORY_LABELS[tpl.document_category as DocumentCategory] || tpl.document_category}
                    </span>
                    <span style={{
                      fontSize: 10, fontWeight: 500, padding: "1px 6px", borderRadius: 4,
                      color: tpl.is_required ? "#c47520" : "#6b6b76",
                      background: tpl.is_required ? "rgba(196,117,32,0.08)" : "rgba(107,107,118,0.08)",
                    }}>
                      {tpl.is_required ? "Required" : "Recommended"}
                    </span>
                    <span style={{ fontSize: 11, color: "#9494a0", whiteSpace: "nowrap" }}>
                      {filterSummary}
                    </span>
                    {stats && (
                      <span style={{ fontSize: 11, color: "#9494a0", whiteSpace: "nowrap" }}>
                        {stats.satisfied}/{stats.applied}
                      </span>
                    )}
                    <button
                      onClick={async () => {
                        if (!confirm("Delete this template? Satisfied expectations will be kept as manual items.")) return;
                        await fetch("/api/document-templates", {
                          method: "DELETE",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ template_id: tpl.id }),
                        });
                        await fetchTemplates();
                      }}
                      style={{
                        background: "none", border: "none", cursor: "pointer",
                        fontSize: 11, color: "#c73e3e", padding: "2px 4px", flexShrink: 0,
                      }}
                    >
                      Delete
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </AccordionSection>

        {/* Card 2 — User Management (admin only) */}
        {isAdmin && (
          <AccordionSection
            title="User Management"
            isMobile={isMobile}
            headerRight={
              !showInvite ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowInvite(true);
                  }}
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
                  <div style={isMobile ? {} : undefined}>
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
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      ...(isMobile ? { marginTop: 4 } : {}),
                    }}
                  >
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
              <div style={{ fontSize: 13, color: "#9494a0", padding: "16px 0" }}>
                Loading users...
              </div>
            ) : users.length === 0 ? (
              <div style={{ fontSize: 13, color: "#9494a0", padding: "16px 0" }}>
                No users found.
              </div>
            ) : isMobile ? (
              /* Mobile: stacked user cards */
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
                      {/* Name and email */}
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontWeight: 500, fontSize: 13, color: "#1a1a1f" }}>
                          {u.display_name || (
                            <span style={{ color: "#9494a0", fontStyle: "italic" }}>
                              No name
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: "#9494a0", marginTop: 2, wordBreak: "break-all" }}>
                          {u.email || u.id.slice(0, 8) + "..."}
                        </div>
                      </div>

                      {/* Role + joined row */}
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
                              onChange={(e) =>
                                handleRoleChange(u.id, e.target.value as UserRole)
                              }
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

                      {/* Remove button */}
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
              /* Desktop: original table layout */
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
                                  <span
                                    style={{
                                      fontSize: 11,
                                      color: "#9494a0",
                                      fontStyle: "italic",
                                    }}
                                  >
                                    (you)
                                  </span>
                                )}
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
                                <option value="member">Member</option>
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
                              : "---"}
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

            {/* Pending Invites */}
            {pendingInvites.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
                  Pending Invites
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {pendingInvites.map((inv) => (
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
                            background: "rgba(255,169,0,0.10)",
                            color: "#b37400",
                          }}>
                            Pending
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
                            <span style={{ fontSize: 11, color: "#9494a0" }}>
                              Expires {new Date(inv.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            </span>
                          )}
                        </div>
                      </div>
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
                  ))}
                </div>
              </div>
            )}
          </AccordionSection>
        )}

        {/* Card 3 — Permissions Reference */}
        <AccordionSection
          title="Permissions"
          subtitle="Reference for what each role can do"
          isMobile={isMobile}
          defaultOpen={!isMobile}
        >
          {isMobile ? (
            /* Mobile: stacked permission cards */
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
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: "#1a1a1f",
                      marginBottom: 10,
                    }}
                  >
                    {perm.label}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 16,
                    }}
                  >
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
            /* Desktop: original table layout */
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
          )}
        </AccordionSection>

        {/* Card 4 — Activity Log (admin only) */}
        {isAdmin && (
          <AccordionSection
            title="Activity Log"
            isMobile={isMobile}
            subtitle="Recent actions across the platform"
            defaultOpen={!isMobile}
          >
            {/* Filters */}
            <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
              <select
                value={activityFilter.resource_type}
                onChange={(e) => setActivityFilter((f) => ({ ...f, resource_type: e.target.value }))}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid #ddd9d0",
                  fontSize: 13,
                  background: "#fff",
                  color: "#1a1a1f",
                }}
              >
                <option value="">All Resources</option>
                <option value="entity">Entities</option>
                <option value="document">Documents</option>
                <option value="pipeline">Pipeline</option>
                <option value="user">Users</option>
                <option value="compliance">Compliance</option>
              </select>
              <select
                value={activityFilter.action}
                onChange={(e) => setActivityFilter((f) => ({ ...f, action: e.target.value }))}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid #ddd9d0",
                  fontSize: 13,
                  background: "#fff",
                  color: "#1a1a1f",
                }}
              >
                <option value="">All Actions</option>
                <option value="create">Create</option>
                <option value="edit">Edit</option>
                <option value="delete">Delete</option>
                <option value="upload">Upload</option>
                <option value="download">Download</option>
                <option value="process">Process</option>
                <option value="apply_extraction">Apply Extraction</option>
                <option value="role_change">Role Change</option>
                <option value="invite">Invite</option>
              </select>
            </div>

            {/* Log entries */}
            {activityLoading ? (
              <div style={{ padding: 32, textAlign: "center", color: "#9494a0", fontSize: 13 }}>Loading...</div>
            ) : activityLog.length === 0 ? (
              <div style={{ padding: 32, textAlign: "center", color: "#9494a0", fontSize: 13 }}>No activity found</div>
            ) : (
              <div style={{ maxHeight: 500, overflowY: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #e8e6df" }}>
                      <th style={{ textAlign: "left", padding: "8px 8px", color: "#6b6b76", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px" }}>Action</th>
                      <th style={{ textAlign: "left", padding: "8px 8px", color: "#6b6b76", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px" }}>Resource</th>
                      <th style={{ textAlign: "left", padding: "8px 8px", color: "#6b6b76", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px" }}>Details</th>
                      <th style={{ textAlign: "right", padding: "8px 8px", color: "#6b6b76", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px" }}>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activityLog.map((entry) => {
                      const actionLabels: Record<string, string> = {
                        create: "Created",
                        edit: "Edited",
                        delete: "Deleted",
                        upload: "Uploaded",
                        download: "Downloaded",
                        process: "Processed",
                        apply_extraction: "Applied AI",
                        update_obligation: "Updated",
                        role_change: "Role change",
                        invite: "Invited",
                        create_batch: "Batch created",
                        process_batch: "Batch processed",
                        approve_batch: "Batch approved",
                      };
                      const label = actionLabels[entry.action] || entry.action;
                      const time = new Date(entry.created_at);
                      const timeStr = time.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
                        " " + time.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
                      const meta = entry.metadata || {};
                      const details: string[] = [];
                      if (meta.name) details.push(String(meta.name));
                      if (meta.fields) details.push(`${(meta.fields as string[]).join(", ")}`);
                      if (meta.new_role) details.push(`→ ${meta.new_role}`);
                      if (meta.email) details.push(String(meta.email));

                      return (
                        <tr key={entry.id} style={{ borderBottom: "1px solid #f0eeea" }}>
                          <td style={{ padding: "8px 8px", fontWeight: 500 }}>{label}</td>
                          <td style={{ padding: "8px 8px", color: "#6b6b76" }}>{entry.resource_type}</td>
                          <td style={{ padding: "8px 8px", color: "#9494a0", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{details.join(" · ") || "—"}</td>
                          <td style={{ padding: "8px 8px", color: "#9494a0", textAlign: "right", whiteSpace: "nowrap" }}>{timeStr}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </AccordionSection>
        )}
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
