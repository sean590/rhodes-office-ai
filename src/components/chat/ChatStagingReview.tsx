"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface StagedFile {
  queue_item_id: string;
  filename: string;
  entity_id: string | null;
  entity_name: string | null;
  document_type: string | null;
  year: number | null;
  confidence: string;
  skip: boolean;
}

interface Props {
  files: StagedFile[];
  entities: Array<{ id: string; name: string }>;
  onProcess: (files: StagedFile[]) => void;
  processing: boolean;
}

export function ChatStagingReview({ files: initialFiles, entities, onProcess, processing }: Props) {
  const [files, setFiles] = useState(initialFiles);
  const [editing, setEditing] = useState(false);

  const matched = files.filter((f) => f.entity_id && !f.skip);
  const unmatched = files.filter((f) => !f.entity_id && !f.skip);
  const skipped = files.filter((f) => f.skip);

  const updateFile = (idx: number, updates: Partial<StagedFile>) => {
    const next = [...files];
    next[idx] = { ...next[idx], ...updates, confidence: updates.entity_id !== undefined ? "user" : next[idx].confidence };
    setFiles(next);
  };

  return (
    <div style={{
      background: "#f8f7f4", borderRadius: 10, padding: 16,
      border: "1px solid #e8e6df", marginTop: 8,
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 12,
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1f" }}>
            Staging Review — {files.length} files
          </div>
          <div style={{ fontSize: 12, color: "#6b6b76", marginTop: 2 }}>
            {matched.length} matched · {unmatched.length} unmatched{skipped.length > 0 ? ` · ${skipped.length} skipped` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setEditing(!editing)}
            style={{
              padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd9d0",
              background: "none", cursor: "pointer", fontSize: 12, color: "#6b6b76",
            }}
          >
            {editing ? "Done" : "Edit"}
          </button>
          <Button
            variant="primary"
            onClick={() => onProcess(files.filter((f) => !f.skip))}
            disabled={processing || files.filter((f) => !f.skip).length === 0}
          >
            {processing ? "Processing..." : `Process ${files.filter((f) => !f.skip).length} Files`}
          </Button>
        </div>
      </div>

      {/* File table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              <th style={thStyle}>File</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Entity</th>
              <th style={thStyle}>Year</th>
              {editing && <th style={thStyle}>Skip</th>}
            </tr>
          </thead>
          <tbody>
            {files.map((file, i) => (
              <tr key={file.queue_item_id} style={{ opacity: file.skip ? 0.4 : 1 }}>
                <td style={tdStyle}>
                  <span style={{ fontWeight: 500, color: "#1a1a1f" }}>
                    {file.filename.length > 30 ? file.filename.slice(0, 27) + "..." : file.filename}
                  </span>
                </td>
                <td style={tdStyle}>
                  {editing ? (
                    <input
                      style={editInputStyle}
                      value={file.document_type || ""}
                      onChange={(e) => updateFile(i, { document_type: e.target.value || null })}
                      placeholder="type"
                    />
                  ) : (
                    <span style={{ color: "#6b6b76" }}>
                      {file.document_type?.replace(/_/g, " ") || "—"}
                    </span>
                  )}
                </td>
                <td style={tdStyle}>
                  {editing ? (
                    <select
                      style={{ ...editInputStyle, cursor: "pointer" }}
                      value={file.entity_id || ""}
                      onChange={(e) => {
                        const ent = entities.find((en) => en.id === e.target.value);
                        updateFile(i, {
                          entity_id: e.target.value || null,
                          entity_name: ent?.name || null,
                        });
                      }}
                    >
                      <option value="">Unmatched</option>
                      {entities.map((e) => (
                        <option key={e.id} value={e.id}>{e.name}</option>
                      ))}
                    </select>
                  ) : (
                    <span style={{
                      color: file.entity_id ? "#1a1a1f" : "#c73e3e",
                      fontWeight: file.entity_id ? 400 : 500,
                    }}>
                      {file.entity_name || (file.entity_id ? "Matched" : "⚠ Unmatched")}
                    </span>
                  )}
                </td>
                <td style={tdStyle}>
                  {editing ? (
                    <input
                      type="number"
                      style={{ ...editInputStyle, width: 60 }}
                      value={file.year || ""}
                      onChange={(e) => updateFile(i, { year: e.target.value ? Number(e.target.value) : null })}
                      placeholder="year"
                    />
                  ) : (
                    <span style={{ color: "#6b6b76" }}>{file.year || "—"}</span>
                  )}
                </td>
                {editing && (
                  <td style={tdStyle}>
                    <input
                      type="checkbox"
                      checked={file.skip}
                      onChange={(e) => updateFile(i, { skip: e.target.checked })}
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {unmatched.length > 0 && !editing && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#c73e3e" }}>
          {unmatched.length} file{unmatched.length !== 1 ? "s" : ""} couldn&apos;t be matched to an entity.
          Click &quot;Edit&quot; to assign them.
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "6px 8px", textAlign: "left",
  fontSize: 10, fontWeight: 600, color: "#9494a0",
  textTransform: "uppercase", letterSpacing: "0.06em",
  borderBottom: "1px solid #e8e6df",
};

const tdStyle: React.CSSProperties = {
  padding: "6px 8px",
  borderBottom: "1px solid #f0eee8",
};

const editInputStyle: React.CSSProperties = {
  padding: "2px 6px", fontSize: 12, borderRadius: 4,
  border: "1px solid #ddd9d0", background: "#fff",
  width: "100%",
};
