"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { SparkleIcon, ChartIcon, BuildingIcon, DocIcon, AlertIcon, UploadIcon, XIcon } from "@/components/ui/icons";
import { validateUploadedFile } from "@/lib/validations";
import { useSetPageContext } from "@/components/chat/page-context-provider";
import { useIsMobile } from "@/hooks/use-mobile";
import { ActivityEntry } from "@/components/activity-entry";

interface DashboardStats {
  activeEntities: number;
  overdueFilings: number;
  dueSoonFilings: number;
  activeInvestments: number;
  totalDocuments: number;
  recentActivity: Array<{
    id: string;
    action: string;
    resource_type: string;
    metadata: Record<string, unknown>;
    user_name: string | null;
    created_at: string;
  }>;
}

export default function DashboardPage() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const setPageContext = useSetPageContext();
  useEffect(() => {
    setPageContext({ page: "dashboard" });
    return () => setPageContext(null);
  }, [setPageContext]);

  // Fetch dashboard data
  useEffect(() => {
    async function load() {
      try {
        const [entRes, invRes, auditRes] = await Promise.all([
          fetch("/api/entities"),
          fetch("/api/investments"),
          fetch("/api/audit?limit=15"),
        ]);

        const entities = entRes.ok ? await entRes.json() : [];
        const investments = invRes.ok ? await invRes.json() : [];
        const activity = auditRes.ok ? await auditRes.json() : [];

        const activeEntities = entities.filter((e: { status: string }) => e.status === "active").length;
        const overdueFilings = entities.filter((e: { filing_status: string }) => e.filing_status === "overdue").length;
        const dueSoonFilings = entities.filter((e: { filing_status: string }) => e.filing_status === "due_soon").length;
        const activeInvestments = investments.filter((i: { status: string }) => i.status === "active").length;

        setStats({
          activeEntities,
          overdueFilings,
          dueSoonFilings,
          activeInvestments,
          totalDocuments: 0, // could fetch from documents API
          recentActivity: activity,
        });
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim() || files.length > 0) {
      window.dispatchEvent(new CustomEvent("rhodes:open-chat", { detail: { query: query.trim(), files } }));
      setQuery("");
      setFiles([]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    const valid: File[] = [];
    for (const f of selected) {
      const result = validateUploadedFile(f);
      if (result.valid) valid.push(f);
      else alert(result.error);
    }
    setFiles((prev) => [...prev, ...valid]);
    e.target.value = "";
  };

  // Get time-based greeting
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", paddingTop: isMobile ? 20 : 40 }}>
      {/* Hero: Greeting + Chat Input */}
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <h1 style={{ fontSize: isMobile ? 24 : 32, fontWeight: 700, color: "#1a1a1f", margin: "0 0 24px" }}>
          {greeting}.
        </h1>

        <form onSubmit={handleSubmit}>
          <div
            style={{ position: "relative", maxWidth: 560, margin: "0 auto" }}
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={(e) => {
              e.preventDefault();
              const dropped = Array.from(e.dataTransfer.files);
              const valid: File[] = [];
              for (const f of dropped) { const r = validateUploadedFile(f); if (r.valid) valid.push(f); }
              setFiles((prev) => [...prev, ...valid]);
            }}
          >
            {/* File chips */}
            {files.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8, textAlign: "left" }}>
                {files.map((f, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "3px 8px", background: "#f0eee8", borderRadius: 6, fontSize: 12, color: "#1a1a1f",
                  }}>
                    📄 {f.name}
                    <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#9494a0", fontSize: 13, padding: 0, lineHeight: 1 }}>✕</button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={{
                  width: 48, height: 48, borderRadius: 14, border: "1px solid #ddd9d0",
                  background: "#f5f4f0", cursor: "pointer", display: "flex",
                  alignItems: "center", justifyContent: "center", flexShrink: 0,
                  color: "#6b6b76",
                }}
                title="Attach files"
              >
                <UploadIcon size={20} />
              </button>
              <input ref={fileInputRef} type="file" multiple
                accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.xlsx,.docx,.doc,.xls"
                onChange={handleFileSelect} style={{ display: "none" }} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask Rhodes anything..."
              style={{
                width: "100%", padding: "16px 56px 16px 20px",
                fontSize: 16, borderRadius: 14,
                border: "1px solid #ddd9d0", background: "#ffffff",
                color: "#1a1a1f", outline: "none",
                boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
                transition: "border-color 0.15s, box-shadow 0.15s",
                fontFamily: "inherit",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "#2d5a3d";
                e.currentTarget.style.boxShadow = "0 4px 20px rgba(45,90,61,0.12)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "#ddd9d0";
                e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.06)";
              }}
            />
            <button
              type="submit"
              style={{
                position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                width: 40, height: 40, borderRadius: 10, border: "none",
                background: (query.trim() || files.length > 0) ? "#2d5a3d" : "transparent",
                color: (query.trim() || files.length > 0) ? "#fff" : "#9494a0",
                cursor: (query.trim() || files.length > 0) ? "pointer" : "default",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.15s",
              }}
            >
              <SparkleIcon size={18} />
            </button>
          </div>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: "#9494a0" }}>
            or press <kbd style={{ background: "#f0eee8", padding: "1px 5px", borderRadius: 3, fontFamily: "monospace", fontSize: 11 }}>⌘K</kbd> anywhere
          </div>
        </form>
      </div>

      {/* Dashboard Cards */}
      {!loading && stats && (
        <div style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)",
          gap: 12, marginBottom: 32,
        }}>
          <DashboardCard
            icon={<BuildingIcon size={20} color="#2d5a3d" />}
            label="Active Entities"
            value={String(stats.activeEntities)}
            onClick={() => router.push("/entities")}
          />
          <DashboardCard
            icon={<ChartIcon size={20} color="#7b4db5" />}
            label="Active Investments"
            value={String(stats.activeInvestments)}
            onClick={() => router.push("/investments")}
          />
          {stats.overdueFilings > 0 ? (
            <DashboardCard
              icon={<AlertIcon size={20} />}
              label="Overdue Filings"
              value={String(stats.overdueFilings)}
              accent="#c73e3e"
              onClick={() => router.push("/entities")}
            />
          ) : stats.dueSoonFilings > 0 ? (
            <DashboardCard
              icon={<AlertIcon size={20} />}
              label="Due Soon"
              value={String(stats.dueSoonFilings)}
              accent="#a68b1a"
              onClick={() => router.push("/entities")}
            />
          ) : (
            <DashboardCard
              icon={<DocIcon size={20} color="#3366a8" />}
              label="Filings"
              value="Current"
              onClick={() => router.push("/entities")}
            />
          )}
          <DashboardCard
            icon={<DocIcon size={20} color="#3366a8" />}
            label="Documents"
            value="Browse"
            onClick={() => router.push("/documents")}
          />
        </div>
      )}

      {/* Recent Activity */}
      {!loading && stats && stats.recentActivity.length > 0 && (
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: "#1a1a1f", margin: "0 0 12px" }}>
            Recent Activity
          </h2>
          <div style={{ background: "#ffffff", borderRadius: 12, border: "1px solid #e8e6df", overflow: "hidden" }}>
            {stats.recentActivity.map((entry) => (
              <ActivityEntry key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DashboardCard({ icon, label, value, accent, onClick }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "#ffffff", border: "1px solid #e8e6df", borderRadius: 12,
        padding: "16px", cursor: "pointer", textAlign: "left",
        transition: "border-color 0.15s, box-shadow 0.15s",
        display: "flex", flexDirection: "column", gap: 8,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "#d0cdc4";
        e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.04)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "#e8e6df";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      {icon}
      <div>
        <div style={{ fontSize: 22, fontWeight: 700, color: accent || "#1a1a1f" }}>{value}</div>
        <div style={{ fontSize: 12, color: "#9494a0", marginTop: 2 }}>{label}</div>
      </div>
    </button>
  );
}
