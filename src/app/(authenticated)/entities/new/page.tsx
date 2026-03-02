"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { US_STATES } from "@/lib/constants";
import { validateShortName } from "@/lib/utils/document-naming";
import type { EntityType, LegalStructure } from "@/lib/types/enums";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const ENTITY_TYPES: { value: EntityType; label: string }[] = [
  { value: "holding_company", label: "Holding Company" },
  { value: "investment_fund", label: "Investment Fund" },
  { value: "operating_company", label: "Operating Company" },
  { value: "real_estate", label: "Real Estate" },
  { value: "special_purpose", label: "Special Purpose" },
  { value: "management_company", label: "Management Company" },
  { value: "trust", label: "Trust" },
  { value: "other", label: "Other" },
];

const LEGAL_STRUCTURES: { value: LegalStructure; label: string }[] = [
  { value: "llc", label: "LLC" },
  { value: "corporation", label: "Corporation" },
  { value: "lp", label: "Limited Partnership" },
  { value: "trust", label: "Trust" },
  { value: "gp", label: "General Partnership" },
  { value: "series_llc", label: "Series LLC" },
  { value: "other", label: "Other" },
];

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: "#9494a0",
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "#f0efe9",
  border: "1px solid #ddd9d0",
  borderRadius: 6,
  padding: "8px 10px",
  color: "#1a1a1f",
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
  boxSizing: "border-box",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: "none" as const,
  backgroundImage:
    'url("data:image/svg+xml,%3Csvg width=\'10\' height=\'6\' viewBox=\'0 0 10 6\' fill=\'none\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M1 1l4 4 4-4\' stroke=\'%239494a0\' stroke-width=\'1.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E")',
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 10px center",
  paddingRight: 28,
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  height: 80,
  resize: "vertical" as const,
};

const fieldGroupStyle: React.CSSProperties = {
  marginBottom: 16,
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function NewEntityPage() {
  const router = useRouter();

  /* Form state */
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [type, setType] = useState<EntityType>("holding_company");
  const [legalStructure, setLegalStructure] = useState<LegalStructure | "">("");
  const [ein, setEin] = useState("");
  const [formationState, setFormationState] = useState("");
  const [formedDate, setFormedDate] = useState("");
  const [registeredAgent, setRegisteredAgent] = useState("");
  const [address, setAddress] = useState("");
  const [parentEntityId, setParentEntityId] = useState("");
  const [notes, setNotes] = useState("");

  /* Entity list for parent dropdown */
  const [entities, setEntities] = useState<{ id: string; name: string }[]>([]);

  /* Submission state */
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Fetch entities for parent dropdown */
  useEffect(() => {
    async function loadEntities() {
      try {
        const res = await fetch("/api/entities");
        if (!res.ok) return;
        const data = await res.json();
        setEntities(data.map((e: { id: string; name: string }) => ({ id: e.id, name: e.name })));
      } catch {
        // Silently fail -- parent dropdown will just be empty
      }
    }
    loadEntities();
  }, []);

  /* Save handler */
  async function handleSave() {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!shortName.trim()) {
      setError("Short Name is required.");
      return;
    }
    const snValidation = validateShortName(shortName.trim());
    if (!snValidation.valid) {
      setError(snValidation.error!);
      return;
    }
    if (!formationState) {
      setError("Formation State is required.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/entities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          short_name: shortName.trim(),
          type,
          legal_structure: legalStructure || null,
          ein: ein.trim() || null,
          formation_state: formationState,
          formed_date: formedDate || null,
          registered_agent: registeredAgent.trim() || null,
          address: address.trim() || null,
          parent_entity_id: parentEntityId || null,
          notes: notes.trim() || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create entity");
      }

      const entity = await res.json();
      router.push(`/entities/${entity.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSaving(false);
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      {/* Back link */}
      <Link
        href="/entities"
        style={{
          fontSize: 13,
          color: "#9494a0",
          textDecoration: "none",
          cursor: "pointer",
        }}
      >
        &larr; Back to Entities
      </Link>

      {/* Page title */}
      <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1a1a1f", margin: "12px 0 20px" }}>
        New Entity
      </h1>

      {/* Error banner */}
      {error && (
        <div
          style={{
            marginBottom: 16,
            padding: "10px 14px",
            background: "rgba(199,62,62,0.08)",
            border: "1px solid rgba(199,62,62,0.25)",
            borderRadius: 8,
            fontSize: 13,
            color: "#c73e3e",
          }}
        >
          {error}
        </div>
      )}

      <Card>
        <SectionHeader>Entity Details</SectionHeader>

        {/* Name */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Entity name"
            style={inputStyle}
          />
        </div>

        {/* Short Name */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Short Name *</label>
          <input
            type="text"
            value={shortName}
            onChange={(e) => setShortName(e.target.value)}
            placeholder="e.g. 44H"
            maxLength={30}
            style={inputStyle}
          />
          <div style={{ fontSize: 11, color: "#9494a0", marginTop: 4 }}>
            Letters, numbers, and hyphens only. Used for document filenames.
          </div>
          {shortName.trim() && (
            <div style={{ fontSize: 11, color: "#2d5a3d", marginTop: 4 }}>
              Preview: {shortName.trim()}_Tax_K1_FY2025.pdf
            </div>
          )}
        </div>

        {/* Type */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Type *</label>
          <select
            value={type}
            onChange={(e) => {
              const newType = e.target.value as EntityType;
              setType(newType);
              if (newType === "trust" && !legalStructure) setLegalStructure("trust");
            }}
            style={selectStyle}
          >
            {ENTITY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {/* Legal Structure */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Legal Structure</label>
          <select
            value={legalStructure}
            onChange={(e) => setLegalStructure(e.target.value as LegalStructure | "")}
            style={selectStyle}
          >
            <option value="">Select structure</option>
            {LEGAL_STRUCTURES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <div style={{ fontSize: 11, color: "#9494a0", marginTop: 4 }}>
            Used to generate state-specific compliance obligations.
          </div>
        </div>

        {/* EIN */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>EIN</label>
          <input
            type="text"
            value={ein}
            onChange={(e) => setEin(e.target.value)}
            placeholder="XX-XXXXXXX"
            style={inputStyle}
          />
        </div>

        {/* Formation State */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Formation State *</label>
          <select
            value={formationState}
            onChange={(e) => setFormationState(e.target.value)}
            style={selectStyle}
          >
            <option value="">Select a state</option>
            {US_STATES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {/* Date Formed */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Date Formed</label>
          <input
            type="date"
            value={formedDate}
            onChange={(e) => setFormedDate(e.target.value)}
            style={inputStyle}
          />
        </div>

        {/* Registered Agent */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Registered Agent</label>
          <input
            type="text"
            value={registeredAgent}
            onChange={(e) => setRegisteredAgent(e.target.value)}
            placeholder="Agent name"
            style={inputStyle}
          />
        </div>

        {/* Address */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Address</label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Street address"
            style={inputStyle}
          />
        </div>

        {/* Parent Entity */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Parent Entity</label>
          <select
            value={parentEntityId}
            onChange={(e) => setParentEntityId(e.target.value)}
            style={selectStyle}
          >
            <option value="">None</option>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>

        {/* Notes */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Additional notes..."
            style={textareaStyle}
          />
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button variant="secondary" onClick={() => router.push("/entities")}>
            Cancel
          </Button>
        </div>
      </Card>
    </div>
  );
}
