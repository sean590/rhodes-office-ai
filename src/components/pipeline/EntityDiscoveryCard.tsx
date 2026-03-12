"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface EntityDiscoveryCardProps {
  proposedEntity: Record<string, unknown>;
  sourceDocuments: string[];
  onCreateEntity: (entityData: Record<string, unknown>) => Promise<void>;
  onSkip: () => void;
}

export function EntityDiscoveryCard({
  proposedEntity,
  sourceDocuments,
  onCreateEntity,
  onSkip,
}: EntityDiscoveryCardProps) {
  const [creating, setCreating] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [created, setCreated] = useState(false);

  if (skipped || created) return null;

  const name = proposedEntity.name as string || "Unknown Entity";
  const type = proposedEntity.type as string || "other";
  const ein = proposedEntity.ein as string | null;
  const state = proposedEntity.formation_state as string | null;
  const confidence = proposedEntity.confidence as string || "medium";

  const handleCreate = async () => {
    setCreating(true);
    try {
      await onCreateEntity(proposedEntity);
      setCreated(true);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={{
      border: "1px solid #ddd9d0",
      borderRadius: 8,
      padding: 12,
      marginBottom: 8,
      background: "rgba(45,90,61,0.02)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1f" }}>
            {name}
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 4, fontSize: 11, color: "#6b6b76" }}>
            <span>{type.replace(/_/g, " ")}</span>
            {state && <span>{state}</span>}
            {ein && <span>EIN: {ein}</span>}
            <span style={{
              color: confidence === "high" ? "#2d5a3d" : confidence === "medium" ? "#b08000" : "#9494a0",
            }}>
              {confidence} confidence
            </span>
          </div>
          {sourceDocuments.length > 0 && (
            <div style={{ fontSize: 11, color: "#9494a0", marginTop: 4 }}>
              From: {sourceDocuments.slice(0, 3).join(", ")}
              {sourceDocuments.length > 3 && ` +${sourceDocuments.length - 3} more`}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <Button size="sm" variant="primary" onClick={handleCreate} disabled={creating}>
            {creating ? "Creating..." : "Create Entity"}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => { setSkipped(true); onSkip(); }}>
            Skip
          </Button>
        </div>
      </div>
    </div>
  );
}
