"use client";

import { useState, useEffect, useCallback } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { SectionCard } from "@/components/settings/section-card";
import { activityTitle } from "@/lib/utils/activity-labels";

interface CurrentUserInfo {
  id: string;
  role: string;
  orgRole?: string;
}

interface ActivityEntry {
  id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  metadata: Record<string, unknown>;
  user_id: string | null;
  created_at: string;
  ip_address: string | null;
}

export default function SettingsActivityPage() {
  const isMobile = useIsMobile();
  const [currentUser, setCurrentUser] = useState<CurrentUserInfo | null>(null);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityFilter, setActivityFilter] = useState<{ resource_type: string; action: string }>({
    resource_type: "",
    action: "",
  });
  const [userLoading, setUserLoading] = useState(true);

  const fetchCurrentUser = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (!res.ok) return;
      const data = await res.json();
      setCurrentUser(data);
    } catch { /* ignore */ }
    setUserLoading(false);
  }, []);

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
    } catch { /* ignore */ }
    finally {
      setActivityLoading(false);
    }
  }, [activityFilter]);

  useEffect(() => {
    fetchCurrentUser();
  }, [fetchCurrentUser]);

  const isAdmin =
    currentUser?.role === "admin" ||
    currentUser?.orgRole === "owner" ||
    currentUser?.orgRole === "admin";

  useEffect(() => {
    if (isAdmin) fetchActivity();
  }, [isAdmin, fetchActivity]);

  if (userLoading) {
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
          Activity
        </h1>
        <p style={{ fontSize: 13, color: "#9494a0", margin: "4px 0 0 0" }}>
          Recent actions across the organization
        </p>
      </div>

      {!isAdmin ? (
        <SectionCard title="Access denied" isMobile={isMobile}>
          <div style={{ fontSize: 13, color: "#6b6b76" }}>
            You don&apos;t have permission to view the activity log.
          </div>
        </SectionCard>
      ) : (
        <SectionCard
          title="Activity Log"
          subtitle="Recent actions across the platform"
          isMobile={isMobile}
        >
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

          {activityLoading ? (
            <div style={{ padding: 32, textAlign: "center", color: "#9494a0", fontSize: 13 }}>Loading...</div>
          ) : activityLog.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: "#9494a0", fontSize: 13 }}>No activity found</div>
          ) : (
            <div style={{ maxHeight: 500, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #e8e6df" }}>
                    <th style={{ textAlign: "left", padding: "8px 8px", color: "#6b6b76", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px" }}>Activity</th>
                    <th style={{ textAlign: "left", padding: "8px 8px", color: "#6b6b76", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px" }}>Resource</th>
                    <th style={{ textAlign: "right", padding: "8px 8px", color: "#6b6b76", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px" }}>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {activityLog.map((entry) => {
                    const title = activityTitle(entry.action, entry.resource_type, entry.metadata) ?? "(internal event)";
                    const time = new Date(entry.created_at);
                    const timeStr =
                      time.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
                      " " +
                      time.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

                    return (
                      <tr key={entry.id} style={{ borderBottom: "1px solid #f0eeea" }}>
                        <td style={{ padding: "8px 8px", color: "#1a1a1f" }}>{title}</td>
                        <td style={{ padding: "8px 8px", color: "#6b6b76", whiteSpace: "nowrap" }}>
                          {entry.resource_type.replace(/_/g, " ")}
                        </td>
                        <td style={{ padding: "8px 8px", color: "#9494a0", textAlign: "right", whiteSpace: "nowrap" }}>{timeStr}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}
    </div>
  );
}
