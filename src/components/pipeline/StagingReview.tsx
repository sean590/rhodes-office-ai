"use client";

import { useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DOCUMENT_TYPE_LABELS, DOCUMENT_TYPE_CATEGORIES } from "@/lib/constants";

interface StagingReviewProps {
  batchId: string;
  items: StagingItem[];
  entities: Array<{ id: string; name: string }>;
  showEntityColumn: boolean;
  showEntityDiscovery: boolean;
  onProcess: () => void;
  onItemsChange?: (items: StagingItem[]) => void;
}

export interface StagingItem {
  id: string;
  original_filename: string;
  staged_doc_type: string | null;
  staged_entity_id: string | null;
  staged_entity_name: string | null;
  staged_year: number | null;
  staged_category: string | null;
  staging_confidence: string | null;
  ai_direction: string | null;
  is_composite: boolean;
}

const inputStyle: React.CSSProperties = {
  padding: "4px 8px",
  border: "1px solid #ddd9d0",
  borderRadius: 4,
  fontSize: 12,
  background: "#fafaf7",
  fontFamily: "inherit",
  width: "100%",
};

export function StagingReview({
  batchId,
  items,
  entities,
  showEntityColumn,
  showEntityDiscovery: _showEntityDiscovery,
  onProcess,
  onItemsChange,
}: StagingReviewProps) {
  const [processing, setProcessing] = useState(false);

  const updateItem = useCallback(async (itemId: string, updates: Partial<StagingItem>) => {
    // Optimistic update
    const newItems = items.map((item) =>
      item.id === itemId ? { ...item, ...updates, staging_confidence: "user" } : item
    );
    onItemsChange?.(newItems);

    // Persist to server
    await fetch(`/api/pipeline/queue/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
  }, [items, onItemsChange]);

  const handleProcess = async () => {
    setProcessing(true);
    try {
      const res = await fetch(`/api/pipeline/batches/${batchId}/process`, {
        method: "POST",
      });
      if (res.ok) {
        onProcess();
      }
    } finally {
      setProcessing(false);
    }
  };

  if (items.length === 0) return null;

  // Build flat document type options grouped by category
  const typeOptions: Array<{ value: string; label: string; category: string }> = [];
  for (const [catKey, cat] of Object.entries(DOCUMENT_TYPE_CATEGORIES)) {
    for (const t of cat.types) {
      typeOptions.push({ value: t, label: DOCUMENT_TYPE_LABELS[t] || t, category: catKey });
    }
  }

  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 16px",
        borderBottom: "1px solid #e8e6df",
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1f" }}>
          Staging Review ({items.length} file{items.length !== 1 ? "s" : ""})
        </span>
        <Button variant="primary" onClick={handleProcess} disabled={processing || items.length === 0}>
          {processing ? "Starting..." : `Process ${items.length} File${items.length !== 1 ? "s" : ""} with AI`}
        </Button>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #e8e6df", background: "#fafaf7" }}>
              <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 500, color: "#6b6b76" }}>File</th>
              <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 500, color: "#6b6b76" }}>Type</th>
              {showEntityColumn && (
                <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 500, color: "#6b6b76" }}>Entity</th>
              )}
              <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 500, color: "#6b6b76", width: 80 }}>Year</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} style={{ borderBottom: "1px solid #f0ede6" }}>
                {/* Filename */}
                <td style={{ padding: "6px 12px", maxWidth: 200 }}>
                  <div style={{ fontSize: 12, color: "#1a1a1f", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={item.original_filename}>
                    {item.original_filename}
                  </div>
                  {item.is_composite && (
                    <span style={{ fontSize: 10, color: "#b08000", background: "rgba(234,179,8,0.1)", padding: "1px 6px", borderRadius: 4 }}>
                      composite
                    </span>
                  )}
                </td>

                {/* Document Type */}
                <td style={{ padding: "6px 8px" }}>
                  <select
                    value={item.staged_doc_type || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      const opt = typeOptions.find((o) => o.value === val);
                      updateItem(item.id, {
                        staged_doc_type: val || null,
                        staged_category: opt?.category || null,
                      } as Partial<StagingItem>);
                    }}
                    style={inputStyle}
                  >
                    <option value="">Unclassified</option>
                    {Object.entries(DOCUMENT_TYPE_CATEGORIES).map(([catKey, cat]) => (
                      <optgroup key={catKey} label={cat.label}>
                        {cat.types.map((t) => (
                          <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t] || t}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </td>

                {/* Entity */}
                {showEntityColumn && (
                  <td style={{ padding: "6px 8px" }}>
                    <select
                      value={item.staged_entity_id || ""}
                      onChange={(e) => {
                        const ent = entities.find((en) => en.id === e.target.value);
                        updateItem(item.id, {
                          staged_entity_id: e.target.value || null,
                          staged_entity_name: ent?.name || null,
                        } as Partial<StagingItem>);
                      }}
                      style={inputStyle}
                    >
                      <option value="">AI will determine</option>
                      {entities.map((e) => (
                        <option key={e.id} value={e.id}>{e.name}</option>
                      ))}
                    </select>
                  </td>
                )}

                {/* Year */}
                <td style={{ padding: "6px 8px" }}>
                  <input
                    type="number"
                    value={item.staged_year || ""}
                    onChange={(e) => {
                      const val = e.target.value ? parseInt(e.target.value, 10) : null;
                      updateItem(item.id, { staged_year: val } as Partial<StagingItem>);
                    }}
                    placeholder="Year"
                    style={{ ...inputStyle, width: 70 }}
                    min={2000}
                    max={2099}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
