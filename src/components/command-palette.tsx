"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon, SparkleIcon } from "@/components/ui/icons";
import { useChatPanel } from "@/components/chat/chat-panel-provider";

interface SearchResult {
  id: string;
  type: "entity" | "investment" | "directory" | "page" | "action";
  name: string;
  subtitle?: string;
  href?: string;
  action?: () => void;
}

const PAGES: SearchResult[] = [
  { id: "page-entities", type: "page", name: "My Entities", href: "/entities" },
  { id: "page-investments", type: "page", name: "Investments", href: "/investments" },
  { id: "page-documents", type: "page", name: "Documents", href: "/documents" },
  { id: "page-directory", type: "page", name: "Directory", href: "/directory" },
  { id: "page-chat", type: "page", name: "AI Chat", href: "/chat" },
  { id: "page-settings", type: "page", name: "Settings", href: "/settings" },
];

const ACTIONS: SearchResult[] = [
  { id: "action-new-entity", type: "action", name: "New Entity", subtitle: "Create a new entity", href: "/entities/new" },
  { id: "action-new-investment", type: "action", name: "New Investment", subtitle: "Add an investment", href: "/investments" },
  { id: "action-upload", type: "action", name: "Upload Document", subtitle: "Open chat to upload", href: "__open_panel__" },
];

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  entity: { label: "Entity", color: "#2d5a3d" },
  investment: { label: "Investment", color: "#7b4db5" },
  directory: { label: "Directory", color: "#3366a8" },
  page: { label: "Page", color: "#9494a0" },
  action: { label: "Action", color: "#c47520" },
};

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [entities, setEntities] = useState<SearchResult[]>([]);
  const [investments, setInvestments] = useState<SearchResult[]>([]);
  const [directoryEntries, setDirectoryEntries] = useState<SearchResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const chatPanel = useChatPanel();

  // Global keyboard listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery("");
      setSelectedIdx(0);
    }
  }, [open]);

  // Fetch searchable data on first open
  useEffect(() => {
    if (!open || entities.length > 0) return;

    Promise.all([
      fetch("/api/entities").then(r => r.ok ? r.json() : []),
      fetch("/api/investments").then(r => r.ok ? r.json() : []),
      fetch("/api/directory").then(r => r.ok ? r.json() : []),
    ]).then(([ents, invs, dirs]) => {
      setEntities((ents || []).map((e: { id: string; name: string; type: string }) => ({
        id: `entity-${e.id}`, type: "entity" as const, name: e.name,
        subtitle: e.type?.replace(/_/g, " "), href: `/entities/${e.id}`,
      })));
      setInvestments((invs || []).map((i: { id: string; name: string; investment_type: string }) => ({
        id: `investment-${i.id}`, type: "investment" as const, name: i.name,
        subtitle: i.investment_type?.replace(/_/g, " "), href: `/investments/${i.id}`,
      })));
      setDirectoryEntries((dirs || []).map((d: { id: string; name: string; type: string }) => ({
        id: `directory-${d.id}`, type: "directory" as const, name: d.name,
        subtitle: d.type, href: `/directory/${d.id}`,
      })));
    }).catch(console.error);
  }, [open, entities.length]);

  // Filter results based on query
  useEffect(() => {
    if (!query.trim()) {
      // Show recent / suggested
      setResults([
        ...ACTIONS,
        ...PAGES,
      ]);
      setSelectedIdx(0);
      return;
    }

    const q = query.toLowerCase();
    const allItems = [...entities, ...investments, ...directoryEntries, ...PAGES, ...ACTIONS];
    const matches = allItems.filter(item =>
      item.name.toLowerCase().includes(q) ||
      (item.subtitle && item.subtitle.toLowerCase().includes(q))
    ).slice(0, 12);

    setResults(matches);
    setSelectedIdx(0);
  }, [query, entities, investments, directoryEntries]);

  const handleSelect = useCallback((result: SearchResult) => {
    setOpen(false);
    if (result.action) {
      result.action();
    } else if (result.href === "__open_panel__") {
      chatPanel.open();
    } else if (result.href) {
      router.push(result.href);
    }
  }, [router, chatPanel]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[selectedIdx]) {
        handleSelect(results[selectedIdx]);
      } else if (query.trim()) {
        // No match — send as chat query
        setOpen(false);
        chatPanel.open(query.trim());
      }
    }
  };

  if (!open) return null;

  // Group results by type
  const grouped: Record<string, SearchResult[]> = {};
  for (const r of results) {
    const group = r.type === "action" ? "Quick Actions" : r.type === "page" ? "Jump To" : "Results";
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push(r);
  }

  let flatIdx = 0;

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.4)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: "min(20vh, 120px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 560,
          background: "#ffffff", borderRadius: 16,
          boxShadow: "0 24px 80px rgba(0,0,0,0.2)",
          overflow: "hidden",
        }}
      >
        {/* Search input */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "16px 20px", borderBottom: "1px solid #e8e6df",
        }}>
          <SearchIcon size={20} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Rhodes anything, search, or jump to..."
            style={{
              flex: 1, border: "none", outline: "none",
              fontSize: 16, color: "#1a1a1f", background: "transparent",
              fontFamily: "inherit",
            }}
          />
          <kbd style={{
            fontSize: 11, color: "#9494a0", background: "#f0eee8",
            padding: "2px 6px", borderRadius: 4, fontFamily: "monospace",
          }}>ESC</kbd>
        </div>

        {/* Results */}
        <div style={{ maxHeight: 400, overflowY: "auto", padding: "8px 0" }}>
          {results.length === 0 && query.trim() && (
            <div style={{ padding: "20px", textAlign: "center" }}>
              <div style={{ fontSize: 13, color: "#6b6b76", marginBottom: 8 }}>
                No results for &quot;{query}&quot;
              </div>
              <button
                onClick={() => {
                  setOpen(false);
                  chatPanel.open(query.trim());
                }}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "8px 16px", borderRadius: 8, border: "none",
                  background: "rgba(45,90,61,0.08)", color: "#2d5a3d",
                  cursor: "pointer", fontSize: 13, fontWeight: 500,
                }}
              >
                <SparkleIcon size={14} /> Ask Rhodes: &quot;{query}&quot;
              </button>
            </div>
          )}

          {Object.entries(grouped).map(([group, items]) => (
            <div key={group}>
              <div style={{
                padding: "8px 20px 4px", fontSize: 11, fontWeight: 600,
                color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.06em",
              }}>
                {group}
              </div>
              {items.map((item) => {
                const currentIdx = flatIdx++;
                const isSelected = currentIdx === selectedIdx;
                const typeInfo = TYPE_LABELS[item.type] || TYPE_LABELS.page;

                return (
                  <button
                    key={item.id}
                    onClick={() => handleSelect(item)}
                    onMouseEnter={() => setSelectedIdx(currentIdx)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      width: "100%", padding: "8px 20px",
                      background: isSelected ? "#f8f7f4" : "transparent",
                      border: "none", cursor: "pointer", textAlign: "left",
                      transition: "background 0.1s",
                    }}
                  >
                    <span style={{
                      fontSize: 9, fontWeight: 600, padding: "1px 5px", borderRadius: 3,
                      background: `${typeInfo.color}12`, color: typeInfo.color,
                      textTransform: "uppercase", letterSpacing: "0.04em",
                      flexShrink: 0,
                    }}>
                      {typeInfo.label}
                    </span>
                    <span style={{ fontSize: 14, color: "#1a1a1f", fontWeight: 500 }}>
                      {item.name}
                    </span>
                    {item.subtitle && (
                      <span style={{ fontSize: 12, color: "#9494a0" }}>
                        {item.subtitle}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div style={{
          padding: "8px 20px", borderTop: "1px solid #e8e6df",
          display: "flex", gap: 12, fontSize: 11, color: "#9494a0",
        }}>
          <span>↑↓ Navigate</span>
          <span>↵ Select</span>
          <span>esc Close</span>
          {query.trim() && <span style={{ marginLeft: "auto" }}>↵ Ask Rhodes if no match</span>}
        </div>
      </div>
    </div>
  );
}
