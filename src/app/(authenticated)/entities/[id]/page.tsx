"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useIsMobile } from "@/hooks/use-mobile";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TagPill } from "@/components/ui/tag-pill";
import { Dot } from "@/components/ui/dot";
import { BuildingIcon, PlusIcon, XIcon, CheckIcon, UploadIcon, SparkleIcon, DocIcon, FolderIcon, DownIcon, SearchIcon, ChartIcon, EllipsisVerticalIcon, PencilIcon } from "@/components/ui/icons";
import { useSetPageContext } from "@/components/chat/page-context-provider";
import { UploadDropZone } from "@/components/pipeline/UploadDropZone";
import { ProcessingView } from "@/components/pipeline/ProcessingView";
import { ENTITY_TYPE_LABELS } from "@/lib/utils/entity-colors";
import { RELATIONSHIP_TYPE_COLORS } from "@/lib/utils/entity-colors";
import { TRUST_ROLE_ORDER, TRUST_ROLE_LABELS, TRUST_ROLE_COLORS, getStateLabel, US_STATES, DOCUMENT_TYPE_LABELS, DOCUMENT_TYPE_CATEGORIES, DOCUMENT_CATEGORY_OPTIONS, DOCUMENT_CATEGORY_LABELS } from "@/lib/constants";
import { formatMoney, formatDate } from "@/lib/utils/format";
import { calculateFilingStatus, getFilingInfo } from "@/lib/utils/filing-status";
import type { EntityType, TrustRoleType, Jurisdiction, CustomFieldType, InvestorType, DocumentType, LegalStructure } from "@/lib/types/enums";
import type { DocumentCategory } from "@/lib/types/entities";
import type {
  EntityDetail,
  EntityRegistration,
  CustomFieldWithValue,
  Relationship,
  CapTableEntry,
  TrustRole,
  EntityManager,
  EntityMember,
  EntityPartnershipRep,
  EntityRole,
  Document as DocRecord,
  ProposedAction,
  ComplianceObligation,
} from "@/lib/types/entities";
import { getObligationDisplayStatus, getWorstObligationStatus } from "@/lib/utils/compliance-engine";
import type { ObligationDisplayStatus } from "@/lib/utils/compliance-engine";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PicklistItem {
  id: string;
  name: string;
  source: "directory" | "entity";
  source_type: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const CAP_TABLE_COLORS = ["#2d5a3d", "#3366a8", "#7b4db5", "#2d8a4e", "#c47520", "#c73e3e", "#8a6040", "#2a8a6a"];

const INVESTOR_TYPE_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  entity: { label: "Entity", color: "#2d5a3d", bg: "rgba(45,90,61,0.10)" },
  individual: { label: "Individual", color: "#3366a8", bg: "rgba(51,102,168,0.10)" },
  external_fund: { label: "External", color: "#7b4db5", bg: "rgba(123,77,181,0.10)" },
  family_office: { label: "Family Office", color: "#7b4db5", bg: "rgba(123,77,181,0.10)" },
  institutional: { label: "Institutional", color: "#7b4db5", bg: "rgba(123,77,181,0.10)" },
  trust: { label: "Trust", color: "#c47520", bg: "rgba(196,117,32,0.10)" },
  other: { label: "Other", color: "#6b6b76", bg: "rgba(107,107,118,0.10)" },
};

const FREQUENCY_LABELS: Record<string, string> = {
  one_time: "One-time",
  monthly: "Monthly",
  quarterly: "Quarterly",
  semi_annual: "Semi-annual",
  annual: "Annual",
  upon_event: "Upon event",
  na: "N/A",
};

const FILING_STATUS_COLORS: Record<string, { color: string; bg: string; dot: string }> = {
  current: { color: "#2d5a3d", bg: "rgba(45,138,78,0.10)", dot: "#2d8a4e" },
  due_soon: { color: "#c47520", bg: "rgba(196,117,32,0.10)", dot: "#c47520" },
  overdue: { color: "#c73e3e", bg: "rgba(199,62,62,0.10)", dot: "#c73e3e" },
  not_required: { color: "#6b6b76", bg: "rgba(107,107,118,0.10)", dot: "#9494a0" },
  exempt: { color: "#6b6b76", bg: "rgba(107,107,118,0.10)", dot: "#9494a0" },
  completed: { color: "#2d5a3d", bg: "rgba(45,138,78,0.10)", dot: "#2d8a4e" },
  not_applicable: { color: "#6b6b76", bg: "rgba(107,107,118,0.10)", dot: "#9494a0" },
};

const OBLIGATION_STATUS_LABELS: Record<string, string> = {
  current: "Current",
  due_soon: "Due Soon",
  overdue: "Overdue",
  completed: "Completed",
  exempt: "Exempt",
  not_applicable: "N/A",
};

const LEGAL_STRUCTURE_LABELS: Record<string, string> = {
  llc: "LLC",
  corporation: "Corporation",
  lp: "Limited Partnership",
  trust: "Trust",
  gp: "General Partnership",
  sole_prop: "Sole Proprietorship",
  series_llc: "Series LLC",
  other: "Other",
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getCounterpartyName(rel: Relationship, entityId: string): string {
  if (rel.from_entity_id === entityId) return rel.to_name || "Unknown";
  return rel.from_name || "Unknown";
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function isPaying(rel: Relationship, entityId: string): boolean {
  return rel.from_entity_id === entityId;
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

/* ---- Info Row (key-value) ---- */
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        padding: "10px 0",
        borderBottom: "1px solid #f0eee8",
        fontSize: 13,
      }}
    >
      <span style={{ color: "#6b6b76", fontWeight: 500, minWidth: 140, flexShrink: 0 }}>{label}</span>
      <span style={{ color: "#1a1a1f", textAlign: "right" }}>{children}</span>
    </div>
  );
}

/* ---- Legal Structure Row (inline editable) ---- */
function LegalStructureRow({
  entityId,
  currentValue,
  onUpdate,
}: {
  entityId: string;
  currentValue: LegalStructure | null;
  onUpdate: (val: LegalStructure | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<LegalStructure | "">(currentValue || "");
  const [saving, setSaving] = useState(false);

  const structures: { value: LegalStructure; label: string }[] = [
    { value: "llc", label: "LLC" },
    { value: "corporation", label: "Corporation" },
    { value: "lp", label: "Limited Partnership" },
    { value: "trust", label: "Trust" },
    { value: "gp", label: "General Partnership" },
    { value: "series_llc", label: "Series LLC" },
    { value: "other", label: "Other" },
  ];

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/entities/${entityId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ legal_structure: value || null }),
      });
      if (!res.ok) throw new Error("Failed to update");
      onUpdate(value || null);
      setEditing(false);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  const displayLabel = currentValue
    ? (LEGAL_STRUCTURE_LABELS[currentValue] || currentValue)
    : "\u2014";

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "10px 0",
        borderBottom: "1px solid #f0eee8",
        fontSize: 13,
      }}
    >
      <span style={{ color: "#6b6b76", fontWeight: 500, minWidth: 140, flexShrink: 0 }}>Legal Structure</span>
      {editing ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <select
            value={value}
            onChange={(e) => setValue(e.target.value as LegalStructure | "")}
            style={{
              fontSize: 13,
              padding: "4px 8px",
              border: "1px solid #ddd9d0",
              borderRadius: 6,
              background: "#fff",
              color: "#1a1a1f",
              fontFamily: "inherit",
            }}
          >
            <option value="">None</option>
            {structures.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              background: "#2d5a3d",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              padding: "4px 10px",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {saving ? "..." : "Save"}
          </button>
          <button
            onClick={() => { setEditing(false); setValue(currentValue || ""); }}
            style={{
              background: "none",
              border: "1px solid #e8e6df",
              borderRadius: 4,
              padding: "4px 10px",
              fontSize: 11,
              fontWeight: 500,
              color: "#6b6b76",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => { setValue(currentValue || ""); setEditing(true); }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: "none",
            border: currentValue ? "none" : "1px dashed #ddd9d0",
            borderRadius: currentValue ? 0 : 6,
            padding: currentValue ? 0 : "3px 10px",
            cursor: "pointer",
            fontSize: 13,
            fontFamily: "inherit",
            color: currentValue ? "#1a1a1f" : "#9494a0",
            textAlign: "right",
          }}
          title="Click to edit"
        >
          {currentValue ? displayLabel : "Set structure"}
          <svg width="12" height="12" viewBox="0 0 12 12" style={{ color: "#9494a0", flexShrink: 0 }}>
            <path d="M8.5 1.5l2 2-6.5 6.5H2V8L8.5 1.5z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );
}

/* ---- Picklist Dropdown ---- */
function PicklistDropdown({
  picklist,
  onSelect,
  onClose,
  loading,
  filterText,
  onFilterChange,
}: {
  picklist: PicklistItem[];
  onSelect: (item: PicklistItem) => void;
  onClose: () => void;
  loading: boolean;
  filterText: string;
  onFilterChange: (val: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const filtered = picklist.filter((item) =>
    item.name.toLowerCase().includes(filterText.toLowerCase())
  );

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: "100%",
        right: 0,
        marginTop: 4,
        background: "#fff",
        border: "1px solid #e8e6df",
        borderRadius: 8,
        boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
        zIndex: 100,
        width: 260,
        maxHeight: 280,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ padding: "8px 10px", borderBottom: "1px solid #f0eee8" }}>
        <input
          autoFocus
          placeholder="Search..."
          value={filterText}
          onChange={(e) => onFilterChange(e.target.value)}
          style={{
            width: "100%",
            fontSize: 12,
            padding: "5px 8px",
            border: "1px solid #ddd9d0",
            borderRadius: 6,
            background: "#fafaf7",
            color: "#1a1a1f",
            fontFamily: "inherit",
            outline: "none",
          }}
        />
      </div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {loading ? (
          <div style={{ padding: 12, fontSize: 12, color: "#9494a0", textAlign: "center" }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 12, fontSize: 12, color: "#9494a0", textAlign: "center" }}>No results</div>
        ) : (
          filtered.map((item) => (
            <div
              key={`${item.source}-${item.id}`}
              onClick={() => onSelect(item)}
              style={{
                padding: "8px 12px",
                fontSize: 12,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 8,
                borderBottom: "1px solid #f8f7f4",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "#fafaf7"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
            >
              <span style={{ flex: 1, color: "#1a1a1f", fontWeight: 500 }}>{item.name}</span>
              <span
                style={{
                  fontSize: 10,
                  color: item.source === "entity" ? "#2d5a3d" : "#3366a8",
                  background: item.source === "entity" ? "rgba(45,90,61,0.08)" : "rgba(51,102,168,0.08)",
                  padding: "2px 6px",
                  borderRadius: 4,
                  fontWeight: 600,
                  textTransform: "capitalize",
                }}
              >
                {item.source_type.replace(/_/g, " ")}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ---- Registration States Row ---- */
function RegistrationStatesRow({
  entityId,
  formationState,
  registrations,
  onRegistrationsChange,
}: {
  entityId: string;
  formationState: string;
  registrations: EntityRegistration[];
  onRegistrationsChange: (regs: EntityRegistration[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [selectedState, setSelectedState] = useState("");
  const [saving, setSaving] = useState(false);

  const allRegisteredCodes = new Set<string>([
    formationState,
    ...registrations.map((r) => r.jurisdiction),
  ]);

  const availableStates = US_STATES.filter((s) => !allRegisteredCodes.has(s.value));

  async function handleAdd() {
    if (!selectedState) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/entities/${entityId}/registrations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jurisdiction: selectedState }),
      });
      if (!res.ok) throw new Error("Failed to add registration");
      const newReg = await res.json();
      onRegistrationsChange([...registrations, newReg]);
      setAdding(false);
      setSelectedState("");
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(regId: string) {
    try {
      const res = await fetch(`/api/entities/${entityId}/registrations`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registration_id: regId }),
      });
      if (!res.ok) throw new Error("Failed to remove registration");
      onRegistrationsChange(registrations.filter((r) => r.id !== regId));
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        padding: "10px 0",
        borderBottom: "1px solid #f0eee8",
        fontSize: 13,
      }}
    >
      <span style={{ color: "#6b6b76", fontWeight: 500, minWidth: 140, flexShrink: 0 }}>
        Registration States
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
        <TagPill label={formationState} />
        {registrations
          .filter((r) => r.jurisdiction !== formationState)
          .map((r) => (
            <TagPill
              key={r.id}
              label={r.jurisdiction}
              onRemove={() => handleRemove(r.id)}
            />
          ))}
        {adding ? (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <select
              value={selectedState}
              onChange={(e) => setSelectedState(e.target.value)}
              style={{
                fontSize: 12,
                padding: "3px 8px",
                border: "1px solid #ddd9d0",
                borderRadius: 6,
                background: "#fff",
                color: "#1a1a1f",
                fontFamily: "inherit",
              }}
            >
              <option value="">Select state...</option>
              {availableStates.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label} ({s.value})
                </option>
              ))}
            </select>
            <Button size="sm" variant="primary" onClick={handleAdd} disabled={!selectedState || saving}>
              Add
            </Button>
            <button
              onClick={() => { setAdding(false); setSelectedState(""); }}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#9494a0", padding: 2, display: "flex" }}
            >
              <XIcon size={12} />
            </button>
          </div>
        ) : (
          <Button size="sm" onClick={() => setAdding(true)}>
            <PlusIcon size={10} />
            Add State
          </Button>
        )}
      </div>
    </div>
  );
}

/* ---- Manager/Member Row with Add/Remove ---- */
function PersonRow({
  entityId,
  label,
  persons,
  apiPath,
  deleteIdKey,
  picklist,
  picklistLoading,
  onPersonsChange,
}: {
  entityId: string;
  label: string;
  persons: (EntityManager | EntityMember)[];
  apiPath: string;
  deleteIdKey: string;
  picklist: PicklistItem[];
  picklistLoading: boolean;
  onPersonsChange: (persons: (EntityManager | EntityMember)[]) => void;
}) {
  const router = useRouter();
  const [showPicker, setShowPicker] = useState(false);
  const [filterText, setFilterText] = useState("");

  async function handleAdd(item: PicklistItem) {
    try {
      const body: Record<string, string> = { name: item.name };
      if (item.source === "directory") {
        body.directory_entry_id = item.id;
      } else {
        body.ref_entity_id = item.id;
      }
      const res = await fetch(`/api/entities/${entityId}/${apiPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to add");
      const newPerson = await res.json();
      onPersonsChange([...persons, newPerson]);
      setShowPicker(false);
      setFilterText("");
    } catch (err) {
      console.error(err);
    }
  }

  async function handleRemove(personId: string) {
    try {
      const res = await fetch(`/api/entities/${entityId}/${apiPath}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [deleteIdKey]: personId }),
      });
      if (!res.ok) throw new Error("Failed to remove");
      onPersonsChange(persons.filter((p) => p.id !== personId));
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        padding: "10px 0",
        borderBottom: "1px solid #f0eee8",
        fontSize: 13,
        position: "relative",
      }}
    >
      <span style={{ color: "#6b6b76", fontWeight: 500, minWidth: 140, flexShrink: 0 }}>{label}</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
        {persons.length === 0 && !showPicker && (
          <span style={{ color: "#9494a0" }}>{"\u2014"}</span>
        )}
        {persons.map((m) => {
          const isEntity = !!(m as EntityMember).ref_entity_id;
          return (
            <TagPill
              key={m.id}
              label={m.name + (isEntity ? " \u2197" : "")}
              color={isEntity ? "rgba(51,102,168,0.10)" : "rgba(45,90,61,0.10)"}
              textColor={isEntity ? "#3366a8" : "#2d5a3d"}
              onClick={isEntity ? () => router.push(`/entities/${(m as EntityMember).ref_entity_id}`) : undefined}
              onRemove={() => handleRemove(m.id)}
            />
          );
        })}
        <div style={{ position: "relative" }}>
          <Button size="sm" onClick={() => { setShowPicker(!showPicker); setFilterText(""); }}>
            <PlusIcon size={10} />
            Add
          </Button>
          {showPicker && (
            <PicklistDropdown
              picklist={picklist}
              onSelect={handleAdd}
              onClose={() => { setShowPicker(false); setFilterText(""); }}
              loading={picklistLoading}
              filterText={filterText}
              onFilterChange={setFilterText}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ---- Other Roles Section ---- */
const ROLE_TITLE_OPTIONS = [
  "Vice President",
  "Controller",
  "Secretary",
  "Treasurer",
  "President",
  "CFO",
  "COO",
  "Authorized Signatory",
  "Tax Matters Partner",
];

function OtherRolesSection({
  entityId,
  roles,
  picklist,
  picklistLoading,
  onRolesChange,
}: {
  entityId: string;
  roles: EntityRole[];
  picklist: PicklistItem[];
  picklistLoading: boolean;
  onRolesChange: (roles: EntityRole[]) => void;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [selectedTitle, setSelectedTitle] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [filterText, setFilterText] = useState("");

  // Group roles by role_title
  const grouped = roles.reduce<Record<string, EntityRole[]>>((acc, role) => {
    if (!acc[role.role_title]) acc[role.role_title] = [];
    acc[role.role_title].push(role);
    return acc;
  }, {});

  const effectiveTitle = selectedTitle === "Custom..." ? customTitle.trim() : selectedTitle;

  function handleTitleSelect(title: string) {
    setSelectedTitle(title);
    if (title !== "Custom...") {
      setShowPicker(true);
    }
  }

  async function handleAdd(item: PicklistItem) {
    if (!effectiveTitle) return;
    try {
      const body: Record<string, string> = { name: item.name, role_title: effectiveTitle };
      if (item.source === "directory") {
        body.directory_entry_id = item.id;
      } else {
        body.ref_entity_id = item.id;
      }
      const res = await fetch(`/api/entities/${entityId}/roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to add role");
      const newRole = await res.json();
      onRolesChange([...roles, newRole]);
      setAdding(false);
      setSelectedTitle("");
      setCustomTitle("");
      setShowPicker(false);
      setFilterText("");
    } catch (err) {
      console.error(err);
    }
  }

  async function handleRemove(roleId: string) {
    try {
      const res = await fetch(`/api/entities/${entityId}/roles`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role_id: roleId }),
      });
      if (!res.ok) throw new Error("Failed to remove role");
      onRolesChange(roles.filter((r) => r.id !== roleId));
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div
      style={{
        padding: "10px 0",
        borderBottom: "1px solid #f0eee8",
        fontSize: 13,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: Object.keys(grouped).length > 0 ? 8 : 0 }}>
        <span style={{ color: "#6b6b76", fontWeight: 500, minWidth: 140, flexShrink: 0 }}>Other Roles</span>
        {!adding && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <PlusIcon size={10} />
            Add Role
          </Button>
        )}
      </div>

      {/* Existing roles grouped by title */}
      {Object.entries(grouped).map(([title, titleRoles]) => (
        <div key={title} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "4px 0" }}>
          <span style={{ color: "#9494a0", fontSize: 12, fontWeight: 500, minWidth: 140, flexShrink: 0, paddingTop: 3 }}>{title}</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "flex-end" }}>
            {titleRoles.map((role) => {
              const isEntity = !!role.ref_entity_id;
              return (
                <TagPill
                  key={role.id}
                  label={role.name + (isEntity ? " \u2197" : "")}
                  color={isEntity ? "rgba(51,102,168,0.10)" : "rgba(45,90,61,0.10)"}
                  textColor={isEntity ? "#3366a8" : "#2d5a3d"}
                  onClick={isEntity ? () => router.push(`/entities/${role.ref_entity_id}`) : undefined}
                  onRemove={() => handleRemove(role.id)}
                />
              );
            })}
          </div>
        </div>
      ))}

      {Object.keys(grouped).length === 0 && !adding && (
        <span style={{ color: "#9494a0", fontSize: 12 }}>{"\u2014"}</span>
      )}

      {/* Add role flow */}
      {adding && (
        <div style={{ marginTop: 8, padding: "8px 0", position: "relative" }}>
          {!showPicker ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <select
                value={selectedTitle}
                onChange={(e) => handleTitleSelect(e.target.value)}
                style={{
                  fontSize: 12,
                  padding: "5px 24px 5px 8px",
                  border: "1px solid #ddd9d0",
                  borderRadius: 6,
                  background: "#fafaf7",
                  color: "#1a1a1f",
                  fontFamily: "inherit",
                  outline: "none",
                  appearance: "none" as const,
                  backgroundImage:
                    'url("data:image/svg+xml,%3Csvg width=\'10\' height=\'6\' viewBox=\'0 0 10 6\' fill=\'none\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M1 1l4 4 4-4\' stroke=\'%239494a0\' stroke-width=\'1.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E")',
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "right 8px center",
                }}
              >
                <option value="">Select role...</option>
                {ROLE_TITLE_OPTIONS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
                <option value="Custom...">Custom...</option>
              </select>
              {selectedTitle === "Custom..." && (
                <>
                  <input
                    autoFocus
                    placeholder="Role title"
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                    style={{
                      fontSize: 12,
                      padding: "5px 8px",
                      border: "1px solid #ddd9d0",
                      borderRadius: 6,
                      background: "#fafaf7",
                      color: "#1a1a1f",
                      fontFamily: "inherit",
                      outline: "none",
                      width: 120,
                    }}
                  />
                  {customTitle.trim() && (
                    <Button size="sm" onClick={() => setShowPicker(true)}>Next</Button>
                  )}
                </>
              )}
              <Button
                size="sm"
                onClick={() => { setAdding(false); setSelectedTitle(""); setCustomTitle(""); }}
                style={{ color: "#9494a0" }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <div style={{ position: "relative", display: "inline-block" }}>
              <div style={{ fontSize: 12, color: "#6b6b76", marginBottom: 4 }}>
                Select person for <strong>{effectiveTitle}</strong>:
              </div>
              <PicklistDropdown
                picklist={picklist}
                onSelect={handleAdd}
                onClose={() => { setShowPicker(false); setSelectedTitle(""); setCustomTitle(""); setAdding(false); setFilterText(""); }}
                loading={picklistLoading}
                filterText={filterText}
                onFilterChange={setFilterText}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---- Custom Fields Card ---- */
function CustomFieldsCard({
  entityId,
  fields,
  onFieldsChange,
}: {
  entityId: string;
  fields: CustomFieldWithValue[];
  onFieldsChange: (fields: CustomFieldWithValue[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<CustomFieldType>("text");
  const [saving, setSaving] = useState(false);

  async function handleAddField() {
    if (!newLabel.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/entities/${entityId}/custom-fields`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: newLabel.trim(),
          field_type: newType,
          value: newType === "checkbox" ? false : "",
        }),
      });
      if (!res.ok) throw new Error("Failed to add custom field");
      const newField = await res.json();
      onFieldsChange([...fields, newField]);
      setAdding(false);
      setNewLabel("");
      setNewType("text");
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveField(fieldDefId: string) {
    try {
      const res = await fetch(`/api/entities/${entityId}/custom-fields`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field_def_id: fieldDefId }),
      });
      if (!res.ok) throw new Error("Failed to remove custom field");
      onFieldsChange(fields.filter((f) => f.id !== fieldDefId));
    } catch (err) {
      console.error(err);
    }
  }

  async function handleUpdateValue(field: CustomFieldWithValue, newValue: string | boolean) {
    try {
      const res = await fetch(`/api/entities/${entityId}/custom-fields`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field_def_id: field.id, value: newValue }),
      });
      if (!res.ok) throw new Error("Failed to update custom field");
      const updatedValue = await res.json();
      onFieldsChange(
        fields.map((f) => (f.id === field.id ? { ...f, value: updatedValue } : f))
      );
    } catch (err) {
      console.error(err);
    }
  }

  const inputStyle: React.CSSProperties = {
    fontSize: 12,
    padding: "5px 10px",
    border: "1px solid #ddd9d0",
    borderRadius: 6,
    background: "#fff",
    color: "#1a1a1f",
    fontFamily: "inherit",
    width: "100%",
  };

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <SectionHeader>Custom Fields</SectionHeader>
        {!adding && (
          <Button size="sm" onClick={() => setAdding(true)} style={{ marginTop: -8 }}>
            <PlusIcon size={10} />
            Add Field
          </Button>
        )}
      </div>

      {adding && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
            padding: "10px 12px",
            background: "#fafaf7",
            borderRadius: 8,
          }}
        >
          <input
            placeholder="Field name"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            style={{ ...inputStyle, flex: 1 }}
          />
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value as CustomFieldType)}
            style={{ ...inputStyle, width: "auto" }}
          >
            <option value="text">Text</option>
            <option value="checkbox">Checkbox</option>
          </select>
          <Button size="sm" variant="primary" onClick={handleAddField} disabled={!newLabel.trim() || saving}>
            Add
          </Button>
          <button
            onClick={() => { setAdding(false); setNewLabel(""); setNewType("text"); }}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#9494a0", padding: 2, display: "flex" }}
          >
            <XIcon size={12} />
          </button>
        </div>
      )}

      {fields.length === 0 && !adding ? (
        <div style={{ fontSize: 13, color: "#9494a0", textAlign: "center", padding: "20px 0" }}>
          No custom fields yet
        </div>
      ) : (
        fields.map((field) => (
          <CustomFieldRow
            key={field.id}
            field={field}
            onUpdateValue={(val) => handleUpdateValue(field, val)}
            onRemove={() => handleRemoveField(field.id)}
          />
        ))
      )}
    </Card>
  );
}

/* ---- Custom Field Row ---- */
function CustomFieldRow({
  field,
  onUpdateValue,
  onRemove,
}: {
  field: CustomFieldWithValue;
  onUpdateValue: (value: string | boolean) => void;
  onRemove: () => void;
}) {
  const [textValue, setTextValue] = useState(field.value?.value_text ?? "");
  const [debounceTimer, setDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const isCheckbox = field.field_type === "checkbox";
  const isChecked = field.value?.value_boolean ?? false;

  function handleTextChange(newVal: string) {
    setTextValue(newVal);
    if (debounceTimer) clearTimeout(debounceTimer);
    const timer = setTimeout(() => onUpdateValue(newVal), 600);
    setDebounceTimer(timer);
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 0",
        borderBottom: "1px solid #f0eee8",
        fontSize: 13,
      }}
    >
      <span style={{ color: "#6b6b76", fontWeight: 500, minWidth: 120, flexShrink: 0 }}>
        {field.label}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {isCheckbox ? (
          <button
            onClick={() => onUpdateValue(!isChecked)}
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              border: isChecked ? "none" : "1.5px solid #ddd9d0",
              background: isChecked ? "#2d5a3d" : "#fff",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              flexShrink: 0,
            }}
          >
            {isChecked && <CheckIcon size={13} />}
          </button>
        ) : (
          <input
            value={textValue}
            onChange={(e) => handleTextChange(e.target.value)}
            style={{
              fontSize: 13,
              padding: "4px 8px",
              border: "1px solid #e8e6df",
              borderRadius: 6,
              background: "#fff",
              color: "#1a1a1f",
              fontFamily: "inherit",
              width: 200,
              textAlign: "right",
            }}
          />
        )}
        <button
          onClick={onRemove}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#9494a0",
            padding: 2,
            display: "flex",
            flexShrink: 0,
          }}
        >
          <XIcon size={12} />
        </button>
      </div>
    </div>
  );
}

/* ---- Relationships Summary Card (for Overview tab) ---- */
function RelationshipsSummaryCard({
  relationships,
  entityId,
  onViewAll,
}: {
  relationships: Relationship[];
  entityId: string;
  onViewAll: () => void;
}) {
  // Sort: active first, then closed
  const sorted = [...relationships].sort((a, b) => {
    if (a.status === "active" && b.status !== "active") return -1;
    if (a.status !== "active" && b.status === "active") return 1;
    return 0;
  });

  const activeRels = relationships.filter((r) => r.status === "active");
  const totalAnnual = activeRels.reduce((sum, r) => sum + (r.annual_estimate ?? 0), 0);

  const displayed = sorted.slice(0, 4);
  const moreCount = sorted.length - 4;

  if (relationships.length === 0) {
    return (
      <Card>
        <SectionHeader>Relationships</SectionHeader>
        <div style={{ fontSize: 13, color: "#9494a0", textAlign: "center", padding: "20px 0" }}>
          No relationships yet
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <SectionHeader>Relationships</SectionHeader>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        <div style={{ background: "#fafaf7", borderRadius: 8, padding: "10px 14px" }}>
          <div style={{ fontSize: 11, color: "#6b6b76", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Total
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#1a1a1f", marginTop: 2 }}>
            {relationships.length}
          </div>
        </div>
        <div style={{ background: "#fafaf7", borderRadius: 8, padding: "10px 14px" }}>
          <div style={{ fontSize: 11, color: "#6b6b76", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Est. Annual Value (Active)
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#1a1a1f", marginTop: 2 }}>
            {formatMoney(totalAnnual)}
          </div>
        </div>
      </div>

      {displayed.map((rel) => {
        const typeInfo = RELATIONSHIP_TYPE_COLORS[rel.type] || RELATIONSHIP_TYPE_COLORS.other;
        const counterparty = getCounterpartyName(rel, entityId);
        const isActive = rel.status === "active";
        return (
          <div
            key={rel.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 0",
              borderBottom: "1px solid #f0eee8",
              fontSize: 13,
            }}
          >
            <Badge label={typeInfo.label} color={typeInfo.color} bg={typeInfo.bg} />
            <Dot color={isActive ? "#2d8a4e" : "#c73e3e"} size={6} />
            <span style={{ fontSize: 11, fontWeight: 600, color: isActive ? "#2d5a3d" : "#c73e3e" }}>
              {isActive ? "Active" : "Closed"}
            </span>
            <span style={{ color: "#1a1a1f", fontWeight: 500, flex: 1 }}>{counterparty}</span>
            <span style={{ color: "#9494a0", fontSize: 12, fontFamily: "'DM Mono', monospace" }}>
              {rel.annual_estimate ? formatMoney(rel.annual_estimate) + "/yr" : "\u2014"}
            </span>
          </div>
        );
      })}

      {moreCount > 0 && (
        <div
          onClick={onViewAll}
          style={{ fontSize: 12, color: "#3366a8", fontWeight: 500, marginTop: 8, cursor: "pointer" }}
        >
          +{moreCount} more
        </div>
      )}
    </Card>
  );
}

/* ---- Cap Table Summary Card (for Overview tab) ---- */
function CapTableSummaryCard({
  capTable,
  onViewAll,
}: {
  capTable: CapTableEntry[];
  onViewAll: () => void;
}) {
  const router = useRouter();

  if (capTable.length === 0) {
    return (
      <Card>
        <SectionHeader>Cap Table</SectionHeader>
        <div style={{ fontSize: 13, color: "#9494a0", textAlign: "center", padding: "20px 0" }}>
          No cap table data yet
        </div>
      </Card>
    );
  }

  const totalRaised = capTable.reduce((sum, e) => sum + (e.capital_contributed ?? 0), 0);
  const totalUnits = capTable.reduce((sum, e) => sum + (e.units ?? 0), 0);

  return (
    <Card>
      <SectionHeader>Cap Table</SectionHeader>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
        <div style={{ background: "#fafaf7", borderRadius: 8, padding: "10px 14px" }}>
          <div style={{ fontSize: 11, color: "#6b6b76", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Investors
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#1a1a1f", marginTop: 2 }}>
            {capTable.length}
          </div>
        </div>
        <div style={{ background: "#fafaf7", borderRadius: 8, padding: "10px 14px" }}>
          <div style={{ fontSize: 11, color: "#6b6b76", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Total Raised
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#1a1a1f", marginTop: 2 }}>
            {formatMoney(totalRaised)}
          </div>
        </div>
        <div style={{ background: "#fafaf7", borderRadius: 8, padding: "10px 14px" }}>
          <div style={{ fontSize: 11, color: "#6b6b76", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Total Units
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#1a1a1f", marginTop: 2 }}>
            {totalUnits.toLocaleString()}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          height: 10,
          borderRadius: 5,
          overflow: "hidden",
          marginBottom: 16,
          background: "#f0eee8",
        }}
      >
        {capTable.map((entry, i) => (
          <div
            key={entry.id}
            style={{
              width: `${entry.ownership_pct}%`,
              background: CAP_TABLE_COLORS[i % CAP_TABLE_COLORS.length],
              minWidth: entry.ownership_pct > 0 ? 2 : 0,
            }}
          />
        ))}
      </div>

      {capTable.slice(0, 5).map((entry, i) => {
        const dotColor = CAP_TABLE_COLORS[i % CAP_TABLE_COLORS.length];
        const isEntity = !!entry.investor_entity_id;
        return (
          <div
            key={entry.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "7px 0",
              borderBottom: "1px solid #f0eee8",
              fontSize: 13,
            }}
          >
            <Dot color={dotColor} size={8} />
            <span
              onClick={isEntity ? () => router.push(`/entities/${entry.investor_entity_id}`) : undefined}
              style={{
                color: isEntity ? "#3366a8" : "#1a1a1f",
                fontWeight: 500,
                cursor: isEntity ? "pointer" : "default",
                flex: 1,
              }}
            >
              {entry.investor_name || "Unknown Investor"}
              {isEntity && <span style={{ marginLeft: 3, fontSize: 11 }}>{"\u2197"}</span>}
            </span>
            <span style={{ color: "#6b6b76", fontSize: 12, minWidth: 50, textAlign: "right" }}>
              {entry.ownership_pct.toFixed(1)}%
            </span>
            <span
              style={{
                color: "#9494a0",
                fontSize: 12,
                fontFamily: "'DM Mono', monospace",
                minWidth: 60,
                textAlign: "right",
              }}
            >
              {entry.units?.toLocaleString() ?? "\u2014"} u
            </span>
          </div>
        );
      })}
      {capTable.length > 5 && (
        <div
          onClick={onViewAll}
          style={{ fontSize: 12, color: "#3366a8", fontWeight: 500, marginTop: 8, cursor: "pointer" }}
        >
          +{capTable.length - 5} more investors
        </div>
      )}
    </Card>
  );
}

/* ---- Trust Details Card (with inline editing + role editing) ---- */
function TrustDetailsCard({
  entityId,
  trustDetails,
  trustRoles,
  onTrustRolesChange,
  onTrustDetailsChange,
  picklist,
  picklistLoading,
}: {
  entityId: string;
  trustDetails: EntityDetail["trust_details"];
  trustRoles: TrustRole[];
  onTrustRolesChange: (roles: TrustRole[]) => void;
  onTrustDetailsChange: (details: EntityDetail["trust_details"]) => void;
  picklist: PicklistItem[];
  picklistLoading: boolean;
}) {
  const [addingRole, setAddingRole] = useState(false);
  const [newRoleType, setNewRoleType] = useState<TrustRoleType>("trustee");
  const [showRolePicker, setShowRolePicker] = useState(false);
  const [roleFilterText, setRoleFilterText] = useState("");

  // Inline editing state for trust detail fields
  const [editingDetails, setEditingDetails] = useState(false);
  const [editTrustType, setEditTrustType] = useState(trustDetails?.trust_type || "revocable");
  const [editTrustDate, setEditTrustDate] = useState(trustDetails?.trust_date || "");
  const [editGrantorName, setEditGrantorName] = useState(trustDetails?.grantor_name || "");
  const [editSitusState, setEditSitusState] = useState(trustDetails?.situs_state || "");
  const [savingDetails, setSavingDetails] = useState(false);

  if (!trustDetails) return null;

  function handleStartEditDetails() {
    setEditTrustType(trustDetails!.trust_type || "revocable");
    setEditTrustDate(trustDetails!.trust_date || "");
    setEditGrantorName(trustDetails!.grantor_name || "");
    setEditSitusState(trustDetails!.situs_state || "");
    setEditingDetails(true);
  }

  async function handleSaveDetails() {
    setSavingDetails(true);
    try {
      const res = await fetch(`/api/entities/${entityId}/trust-details`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trust_type: editTrustType,
          trust_date: editTrustDate || null,
          grantor_name: editGrantorName || null,
          situs_state: editSitusState || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to update trust details");
      const updated = await res.json();
      onTrustDetailsChange(updated);
      setEditingDetails(false);
    } catch (err) {
      console.error(err);
    } finally {
      setSavingDetails(false);
    }
  }

  const rolesByType: Record<string, TrustRole[]> = {};
  for (const role of trustRoles) {
    if (!rolesByType[role.role]) rolesByType[role.role] = [];
    rolesByType[role.role].push(role);
  }

  const orderedRoleTypes = TRUST_ROLE_ORDER.filter((rt) => rolesByType[rt]?.length > 0);

  async function handleAddRole(item: PicklistItem) {
    try {
      const body: Record<string, string> = {
        role: newRoleType,
        name: item.name,
      };
      if (item.source === "directory") {
        body.directory_entry_id = item.id;
      } else {
        body.ref_entity_id = item.id;
      }

      const res = await fetch(`/api/entities/${entityId}/trust-roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to add trust role");
      const newRole = await res.json();
      onTrustRolesChange([...trustRoles, newRole]);
      setShowRolePicker(false);
      setAddingRole(false);
      setRoleFilterText("");
    } catch (err) {
      console.error(err);
    }
  }

  async function handleRemoveRole(roleId: string) {
    try {
      const res = await fetch(`/api/entities/${entityId}/trust-roles`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role_id: roleId }),
      });
      if (!res.ok) throw new Error("Failed to remove trust role");
      onTrustRolesChange(trustRoles.filter((r) => r.id !== roleId));
    } catch (err) {
      console.error(err);
    }
  }

  const detailInputStyle: React.CSSProperties = {
    fontSize: 13,
    padding: "4px 8px",
    border: "1px solid #ddd9d0",
    borderRadius: 6,
    background: "#fff",
    color: "#1a1a1f",
    fontFamily: "inherit",
    width: "100%",
    boxSizing: "border-box",
  };

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: "#6b6b76", margin: 0, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Trust Details
        </h3>
        {!editingDetails && (
          <button
            onClick={handleStartEditDetails}
            style={{
              background: "none",
              border: "1px solid #e8e6df",
              borderRadius: 6,
              padding: "3px 10px",
              fontSize: 12,
              color: "#3366a8",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Edit
          </button>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 32 }}>
        {/* Left column: Trust info */}
        <div>
          {editingDetails ? (
            <>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>Trust Type</div>
                <select
                  value={editTrustType}
                  onChange={(e) => setEditTrustType(e.target.value as "revocable" | "irrevocable")}
                  style={{ ...detailInputStyle, appearance: "none" as const, backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'10\' height=\'6\' viewBox=\'0 0 10 6\' fill=\'none\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M1 1l4 4 4-4\' stroke=\'%239494a0\' stroke-width=\'1.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E")', backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center", paddingRight: 24 }}
                >
                  <option value="revocable">Revocable</option>
                  <option value="irrevocable">Irrevocable</option>
                </select>
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>Trust Date</div>
                <input
                  type="date"
                  value={editTrustDate}
                  onChange={(e) => setEditTrustDate(e.target.value)}
                  style={detailInputStyle}
                />
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>Grantor</div>
                <input
                  type="text"
                  value={editGrantorName}
                  onChange={(e) => setEditGrantorName(e.target.value)}
                  placeholder="Grantor name"
                  style={detailInputStyle}
                />
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>Situs State</div>
                <select
                  value={editSitusState}
                  onChange={(e) => setEditSitusState(e.target.value)}
                  style={{ ...detailInputStyle, appearance: "none" as const, backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'10\' height=\'6\' viewBox=\'0 0 10 6\' fill=\'none\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M1 1l4 4 4-4\' stroke=\'%239494a0\' stroke-width=\'1.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E")', backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center", paddingRight: 24 }}
                >
                  <option value="">Select a state</option>
                  {US_STATES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <Button size="sm" variant="primary" onClick={handleSaveDetails} disabled={savingDetails}>
                  {savingDetails ? "Saving..." : "Save"}
                </Button>
                <Button size="sm" onClick={() => setEditingDetails(false)}>Cancel</Button>
              </div>
            </>
          ) : (
            <>
              <InfoRow label="Trust Type">
                <span style={{ textTransform: "capitalize" }}>{trustDetails.trust_type}</span>
              </InfoRow>
              <InfoRow label="Trust Date">{formatDate(trustDetails.trust_date)}</InfoRow>
              <InfoRow label="Grantor">{trustDetails.grantor_name || "\u2014"}</InfoRow>
              <InfoRow label="Situs State">
                {trustDetails.situs_state ? getStateLabel(trustDetails.situs_state) : "\u2014"}
              </InfoRow>
            </>
          )}
        </div>

        {/* Right column: Trust Roles */}
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1f" }}>
              Trust Roles
            </div>
            {!addingRole && (
              <Button size="sm" onClick={() => setAddingRole(true)}>
                <PlusIcon size={10} />
                Add Role
              </Button>
            )}
          </div>

          {/* Add role form */}
          {addingRole && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 12,
                padding: "10px 12px",
                background: "#fafaf7",
                borderRadius: 8,
                position: "relative",
              }}
            >
              <select
                value={newRoleType}
                onChange={(e) => setNewRoleType(e.target.value as TrustRoleType)}
                style={{
                  fontSize: 12,
                  padding: "5px 8px",
                  border: "1px solid #ddd9d0",
                  borderRadius: 6,
                  background: "#fff",
                  color: "#1a1a1f",
                  fontFamily: "inherit",
                }}
              >
                {TRUST_ROLE_ORDER.map((rt) => (
                  <option key={rt} value={rt}>
                    {TRUST_ROLE_LABELS[rt]}
                  </option>
                ))}
              </select>
              <div style={{ position: "relative" }}>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => { setShowRolePicker(!showRolePicker); setRoleFilterText(""); }}
                >
                  Select Person
                </Button>
                {showRolePicker && (
                  <PicklistDropdown
                    picklist={picklist}
                    onSelect={handleAddRole}
                    onClose={() => { setShowRolePicker(false); setRoleFilterText(""); }}
                    loading={picklistLoading}
                    filterText={roleFilterText}
                    onFilterChange={setRoleFilterText}
                  />
                )}
              </div>
              <button
                onClick={() => { setAddingRole(false); setShowRolePicker(false); setRoleFilterText(""); }}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#9494a0", padding: 2, display: "flex" }}
              >
                <XIcon size={12} />
              </button>
            </div>
          )}

          {orderedRoleTypes.length === 0 && !addingRole ? (
            <div style={{ fontSize: 13, color: "#9494a0" }}>No roles assigned</div>
          ) : (
            orderedRoleTypes.map((roleType) => {
              const color = TRUST_ROLE_COLORS[roleType as TrustRoleType];
              const label = TRUST_ROLE_LABELS[roleType as TrustRoleType];
              const roles = rolesByType[roleType];

              return (
                <div key={roleType}>
                  {roles.map((role) => (
                    <div
                      key={role.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "7px 0",
                        borderBottom: "1px solid #f0eee8",
                        fontSize: 13,
                      }}
                    >
                      <Badge label={label} color={color} bg={hexToRgba(color, 0.1)} />
                      <span style={{ color: "#1a1a1f", flex: 1 }}>{role.name}</span>
                      <button
                        onClick={() => handleRemoveRole(role.id)}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: "#9494a0",
                          padding: 2,
                          display: "flex",
                          flexShrink: 0,
                        }}
                      >
                        <XIcon size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              );
            })
          )}
        </div>
      </div>
    </Card>
  );
}

/* ---- Relationships Tab (full) ---- */
function RelationshipsTab({
  relationships,
  entityId,
}: {
  relationships: Relationship[];
  entityId: string;
}) {
  // Sort: active first, then closed
  const sorted = [...relationships].sort((a, b) => {
    if (a.status === "active" && b.status !== "active") return -1;
    if (a.status !== "active" && b.status === "active") return 1;
    return 0;
  });

  if (sorted.length === 0) {
    return (
      <div style={{ fontSize: 13, color: "#9494a0", textAlign: "center", padding: "40px 0" }}>
        No relationships
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {sorted.map((rel) => {
        const typeInfo = RELATIONSHIP_TYPE_COLORS[rel.type] || RELATIONSHIP_TYPE_COLORS.other;
        const counterparty = getCounterpartyName(rel, entityId);
        const pays = isPaying(rel, entityId);
        const directionLabel = pays ? "Pays to" : "Receives from";
        const directionColor = pays ? "#c73e3e" : "#2d8a4e";
        const freqLabel = FREQUENCY_LABELS[rel.frequency] || rel.frequency;
        const statusColor = rel.status === "active" ? "#2d8a4e" : "#9494a0";

        return (
          <Card key={rel.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              {/* Left side */}
              <div style={{ flex: 1 }}>
                {/* Top row: badges */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <Badge label={typeInfo.label} color={typeInfo.color} bg={typeInfo.bg} />
                  <span style={{ fontSize: 11, color: "#6b6b76", fontWeight: 500 }}>{freqLabel}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#6b6b76" }}>
                    <Dot color={statusColor} size={6} />
                    <span style={{ textTransform: "capitalize" }}>{rel.status}</span>
                  </span>
                </div>

                {/* Description */}
                <div style={{ fontSize: 15, fontWeight: 600, color: "#1a1a1f", marginBottom: 8 }}>
                  {rel.description || typeInfo.label}
                </div>

                {/* Direction + counterparty */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: directionColor }}>
                    {directionLabel}
                  </span>
                  <span style={{ color: "#9494a0", fontSize: 12 }}>{"\u2192"}</span>
                  <span style={{ fontSize: 13, fontWeight: 500, color: "#1a1a1f" }}>{counterparty}</span>
                </div>

                {/* Terms */}
                {rel.terms && (
                  <div style={{ fontSize: 13, color: "#6b6b76", marginBottom: 4 }}>
                    {rel.terms}
                  </div>
                )}

                {/* Effective date */}
                {rel.effective_date && (
                  <div style={{ fontSize: 12, color: "#9494a0", marginTop: 4 }}>
                    Effective: {formatDate(rel.effective_date)}
                  </div>
                )}
              </div>

              {/* Right side: Annual estimate */}
              {rel.annual_estimate != null && rel.annual_estimate > 0 && (
                <div
                  style={{
                    fontSize: 20,
                    fontWeight: 700,
                    fontFamily: "'DM Mono', monospace",
                    color: pays ? "#c73e3e" : "#2d8a4e",
                    whiteSpace: "nowrap",
                    marginLeft: 24,
                    textAlign: "right",
                  }}
                >
                  {pays ? "-" : "+"}{formatMoney(rel.annual_estimate)}
                  <div style={{ fontSize: 11, fontWeight: 500, color: "#9494a0", fontFamily: "inherit" }}>
                    per year
                  </div>
                </div>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/* ---- Cap Table Tab (full) ---- */
function CapTableTab({ entityId, capTable, onRefresh, picklist, picklistLoading }: { entityId: string; capTable: CapTableEntry[]; onRefresh: () => Promise<void> | void; picklist: PicklistItem[]; picklistLoading: boolean }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ investor_name: "", investor_type: "individual", units: "", ownership_pct: "", capital_contributed: "", investment_date: "" });
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ investor_name: "", investor_type: "individual", units: "", ownership_pct: "", capital_contributed: "", investment_date: "", investor_entity_id: "" as string | null, investor_directory_id: "" as string | null });
  const [addSaving, setAddSaving] = useState(false);
  const [showPicklist, setShowPicklist] = useState(false);
  const [picklistFilter, setPicklistFilter] = useState("");

  const inputStyle: React.CSSProperties = { background: "#fafaf7", border: "1px solid #ddd9d0", borderRadius: 6, padding: "5px 8px", fontSize: 12, fontFamily: "inherit", color: "#1a1a1f", outline: "none", width: "100%", boxSizing: "border-box" };

  const startEdit = (entry: CapTableEntry) => {
    setEditingId(entry.id);
    setEditForm({
      investor_name: entry.investor_name || "",
      investor_type: entry.investor_type || "individual",
      units: entry.units?.toString() || "",
      ownership_pct: entry.ownership_pct?.toString() || "",
      capital_contributed: entry.capital_contributed ? (entry.capital_contributed / 100).toString() : "",
      investment_date: entry.investment_date || "",
    });
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/entities/${entityId}/cap-table`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entry_id: editingId,
          investor_name: editForm.investor_name,
          investor_type: editForm.investor_type,
          units: editForm.units ? Number(editForm.units) : null,
          ownership_pct: editForm.ownership_pct ? Number(editForm.ownership_pct) : 0,
          capital_contributed: editForm.capital_contributed ? Math.round(Number(editForm.capital_contributed) * 100) : 0,
          investment_date: editForm.investment_date || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to update");
      setEditingId(null);
      await onRefresh();
    } catch (err) {
      console.error("Save error:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (entryId: string) => {
    if (!confirm("Remove this investor from the cap table?")) return;
    try {
      const res = await fetch(`/api/entities/${entityId}/cap-table`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry_id: entryId }),
      });
      if (!res.ok) throw new Error("Failed to delete");
      setEditingId(null);
      await onRefresh();
    } catch (err) {
      console.error("Delete error:", err);
    }
  };

  const resetAddForm = () => {
    setAddForm({ investor_name: "", investor_type: "individual", units: "", ownership_pct: "", capital_contributed: "", investment_date: "", investor_entity_id: null, investor_directory_id: null });
    setShowPicklist(false);
    setPicklistFilter("");
  };

  const handlePicklistSelect = (item: PicklistItem) => {
    const autoType = item.source === "entity" ? "entity" : "individual";
    setAddForm((f) => ({
      ...f,
      investor_name: item.name,
      investor_type: autoType,
      investor_entity_id: item.source === "entity" ? item.id : null,
      investor_directory_id: item.source === "directory" ? item.id : null,
    }));
    setShowPicklist(false);
    setPicklistFilter("");
  };

  const handleAdd = async () => {
    if (!addForm.investor_name.trim()) return;
    setAddSaving(true);
    try {
      const res = await fetch(`/api/entities/${entityId}/cap-table`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          investor_name: addForm.investor_name,
          investor_type: addForm.investor_type,
          units: addForm.units ? Number(addForm.units) : null,
          ownership_pct: addForm.ownership_pct ? Number(addForm.ownership_pct) : 0,
          capital_contributed: addForm.capital_contributed ? Math.round(Number(addForm.capital_contributed) * 100) : 0,
          investment_date: addForm.investment_date || null,
          investor_entity_id: addForm.investor_entity_id || null,
          investor_directory_id: addForm.investor_directory_id || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to add");
      setShowAdd(false);
      resetAddForm();
      await onRefresh();
    } catch (err) {
      console.error("Add error:", err);
    } finally {
      setAddSaving(false);
    }
  };

  if (capTable.length === 0 && !showAdd) {
    return (
      <div style={{ textAlign: "center", padding: "48px 0" }}>
        <ChartIcon size={32} />
        <div style={{ fontSize: 14, color: "#6b6b76", marginTop: 12, fontWeight: 500 }}>
          No cap table data yet
        </div>
        <div style={{ fontSize: 12, color: "#9494a0", marginTop: 4, maxWidth: 320, margin: "4px auto 0" }}>
          Upload an operating agreement or subscription document on the Documents tab — AI processing can automatically extract investor and ownership data.
        </div>
        <Button variant="primary" onClick={() => setShowAdd(true)} style={{ marginTop: 16 }}>
          <PlusIcon size={10} /> Add Investor
        </Button>
      </div>
    );
  }

  const totalRaised = capTable.reduce((sum, e) => sum + (e.capital_contributed ?? 0), 0);
  const totalUnits = capTable.reduce((sum, e) => sum + (e.units ?? 0), 0);

  return (
    <div>
      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 24 }}>
        <div style={{ background: "#fff", border: "1px solid #e8e6df", borderRadius: 12, padding: "16px 20px" }}>
          <div style={{ fontSize: 11, color: "#6b6b76", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Total Raised
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, fontFamily: "'DM Mono', monospace", color: "#1a1a1f" }}>
            {formatMoney(totalRaised)}
          </div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e8e6df", borderRadius: 12, padding: "16px 20px" }}>
          <div style={{ fontSize: 11, color: "#6b6b76", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Investors
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, fontFamily: "'DM Mono', monospace", color: "#1a1a1f" }}>
            {capTable.length}
          </div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e8e6df", borderRadius: 12, padding: "16px 20px" }}>
          <div style={{ fontSize: 11, color: "#6b6b76", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Total Units
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, fontFamily: "'DM Mono', monospace", color: "#1a1a1f" }}>
            {totalUnits.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Ownership bar (28px height) */}
      <Card>
        <SectionHeader>Ownership Distribution</SectionHeader>
        <div
          style={{
            display: "flex",
            height: 28,
            borderRadius: 8,
            overflow: "hidden",
            marginBottom: 16,
            background: "#f0eee8",
          }}
        >
          {capTable.map((entry, i) => (
            <div
              key={entry.id}
              style={{
                width: `${entry.ownership_pct}%`,
                background: CAP_TABLE_COLORS[i % CAP_TABLE_COLORS.length],
                minWidth: entry.ownership_pct > 0 ? 2 : 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
              }}
            >
              {entry.ownership_pct >= 10 && (
                <span style={{ fontSize: 11, fontWeight: 600, color: "#fff", whiteSpace: "nowrap" }}>
                  {entry.ownership_pct.toFixed(1)}%
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 4 }}>
          {capTable.map((entry, i) => (
            <div key={entry.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <Dot color={CAP_TABLE_COLORS[i % CAP_TABLE_COLORS.length]} size={8} />
              <span style={{ color: "#1a1a1f", fontWeight: 500 }}>
                {entry.investor_name || "Unknown"}
              </span>
              <span style={{ color: "#6b6b76" }}>
                {entry.ownership_pct.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* Full investor table */}
      <Card style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <SectionHeader>Investors</SectionHeader>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <PlusIcon size={10} />
            Add Investor
          </Button>
        </div>

        {/* Add form */}
        {showAdd && (
          <div style={{ background: "#fafaf7", border: "1px solid #e8e6df", borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr", gap: 8, alignItems: "end" }}>
              <div style={{ position: "relative" }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#6b6b76", textTransform: "uppercase", marginBottom: 3 }}>Investor Name *</div>
                <div style={{ display: "flex", gap: 4 }}>
                  <input
                    style={{ ...inputStyle, flex: 1, background: addForm.investor_entity_id || addForm.investor_directory_id ? "#edf7ef" : inputStyle.background }}
                    value={addForm.investor_name}
                    onChange={(e) => {
                      setAddForm((f) => ({ ...f, investor_name: e.target.value, investor_entity_id: null, investor_directory_id: null }));
                      setPicklistFilter(e.target.value);
                      if (e.target.value.length > 0) setShowPicklist(true);
                      else setShowPicklist(false);
                    }}
                    onFocus={() => { if (addForm.investor_name.length > 0 && !addForm.investor_entity_id && !addForm.investor_directory_id) { setPicklistFilter(addForm.investor_name); setShowPicklist(true); } }}
                    placeholder="Search or type name..."
                  />
                  {(addForm.investor_entity_id || addForm.investor_directory_id) && (
                    <button
                      onClick={() => setAddForm((f) => ({ ...f, investor_name: "", investor_entity_id: null, investor_directory_id: null, investor_type: "individual" }))}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#9494a0", fontSize: 14, padding: "0 2px" }}
                      title="Clear selection"
                    >
                      ×
                    </button>
                  )}
                </div>
                {showPicklist && !addForm.investor_entity_id && !addForm.investor_directory_id && (
                  <PicklistDropdown
                    picklist={picklist}
                    onSelect={handlePicklistSelect}
                    onClose={() => setShowPicklist(false)}
                    loading={picklistLoading}
                    filterText={picklistFilter}
                    onFilterChange={(val) => { setPicklistFilter(val); setAddForm((f) => ({ ...f, investor_name: val })); }}
                  />
                )}
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#6b6b76", textTransform: "uppercase", marginBottom: 3 }}>Type</div>
                <select style={{ ...inputStyle, cursor: "pointer" }} value={addForm.investor_type} onChange={(e) => setAddForm((f) => ({ ...f, investor_type: e.target.value }))}>
                  {Object.entries(INVESTOR_TYPE_BADGE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#6b6b76", textTransform: "uppercase", marginBottom: 3 }}>Units</div>
                <input style={inputStyle} type="number" value={addForm.units} onChange={(e) => setAddForm((f) => ({ ...f, units: e.target.value }))} />
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#6b6b76", textTransform: "uppercase", marginBottom: 3 }}>Ownership %</div>
                <input style={inputStyle} type="number" step="0.01" value={addForm.ownership_pct} onChange={(e) => setAddForm((f) => ({ ...f, ownership_pct: e.target.value }))} />
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#6b6b76", textTransform: "uppercase", marginBottom: 3 }}>Capital ($)</div>
                <input style={inputStyle} type="number" step="0.01" value={addForm.capital_contributed} onChange={(e) => setAddForm((f) => ({ ...f, capital_contributed: e.target.value }))} />
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#6b6b76", textTransform: "uppercase", marginBottom: 3 }}>Date</div>
                <input style={inputStyle} type="date" value={addForm.investment_date} onChange={(e) => setAddForm((f) => ({ ...f, investment_date: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "flex-end" }}>
              <Button size="sm" onClick={() => { setShowAdd(false); resetAddForm(); }}>Cancel</Button>
              <Button size="sm" variant="primary" onClick={handleAdd} disabled={addSaving || !addForm.investor_name.trim()}>{addSaving ? "Saving..." : "Save"}</Button>
            </div>
          </div>
        )}

        {/* Table header */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr 1.5fr 1fr 1fr auto",
            gap: 12,
            padding: "8px 0",
            borderBottom: "2px solid #e8e6df",
            fontSize: 11,
            fontWeight: 600,
            color: "#6b6b76",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          <div>Investor</div>
          <div>Type</div>
          <div style={{ textAlign: "right" }}>Units</div>
          <div>Ownership</div>
          <div style={{ textAlign: "right" }}>Capital</div>
          <div style={{ textAlign: "right" }}>Date</div>
          <div style={{ width: 80 }} />
        </div>

        {/* Table rows */}
        {capTable.map((entry, i) => {
          const isEntity = !!entry.investor_entity_id;
          const typeBadge = INVESTOR_TYPE_BADGE[entry.investor_type] || INVESTOR_TYPE_BADGE.other;
          const barColor = CAP_TABLE_COLORS[i % CAP_TABLE_COLORS.length];
          const isEditing = editingId === entry.id;

          if (isEditing) {
            return (
              <div
                key={entry.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1fr 1fr 1.5fr 1fr 1fr auto",
                  gap: 12,
                  padding: "8px 0",
                  borderBottom: "1px solid #f0eee8",
                  fontSize: 12,
                  alignItems: "center",
                  background: "#fafaf7",
                  margin: "0 -16px",
                  paddingLeft: 16,
                  paddingRight: 16,
                }}
              >
                <input style={inputStyle} value={editForm.investor_name} onChange={(e) => setEditForm((f) => ({ ...f, investor_name: e.target.value }))} />
                <select style={{ ...inputStyle, cursor: "pointer" }} value={editForm.investor_type} onChange={(e) => setEditForm((f) => ({ ...f, investor_type: e.target.value }))}>
                  {Object.entries(INVESTOR_TYPE_BADGE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
                <input style={{ ...inputStyle, textAlign: "right" }} type="number" value={editForm.units} onChange={(e) => setEditForm((f) => ({ ...f, units: e.target.value }))} />
                <input style={inputStyle} type="number" step="0.01" value={editForm.ownership_pct} onChange={(e) => setEditForm((f) => ({ ...f, ownership_pct: e.target.value }))} placeholder="%" />
                <input style={{ ...inputStyle, textAlign: "right" }} type="number" step="0.01" value={editForm.capital_contributed} onChange={(e) => setEditForm((f) => ({ ...f, capital_contributed: e.target.value }))} placeholder="$" />
                <input style={inputStyle} type="date" value={editForm.investment_date} onChange={(e) => setEditForm((f) => ({ ...f, investment_date: e.target.value }))} />
                <div style={{ display: "flex", gap: 4, width: 80, justifyContent: "flex-end" }}>
                  <Button size="sm" variant="primary" onClick={handleSaveEdit} disabled={saving}>{saving ? "..." : "Save"}</Button>
                  <Button size="sm" onClick={() => setEditingId(null)}>
                    <XIcon size={10} />
                  </Button>
                </div>
              </div>
            );
          }

          return (
            <div
              key={entry.id}
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1fr 1fr 1.5fr 1fr 1fr auto",
                gap: 12,
                padding: "10px 0",
                borderBottom: "1px solid #f0eee8",
                fontSize: 13,
                alignItems: "center",
              }}
            >
              {/* Investor name */}
              <div>
                <span
                  onClick={isEntity ? () => router.push(`/entities/${entry.investor_entity_id}`) : undefined}
                  style={{
                    color: isEntity ? "#3366a8" : "#1a1a1f",
                    fontWeight: 500,
                    cursor: isEntity ? "pointer" : "default",
                  }}
                >
                  {entry.investor_name || "Unknown Investor"}
                  {isEntity && <span style={{ marginLeft: 3, fontSize: 11 }}>{"\u2197"}</span>}
                </span>
              </div>

              {/* Type badge */}
              <div>
                <Badge label={typeBadge.label} color={typeBadge.color} bg={typeBadge.bg} />
              </div>

              {/* Units */}
              <div style={{ textAlign: "right", fontFamily: "'DM Mono', monospace", fontSize: 12, color: "#1a1a1f" }}>
                {entry.units?.toLocaleString() ?? "\u2014"}
              </div>

              {/* Ownership (bar + %) */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    flex: 1,
                    height: 6,
                    borderRadius: 3,
                    background: "#f0eee8",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${entry.ownership_pct}%`,
                      height: "100%",
                      background: barColor,
                      borderRadius: 3,
                    }}
                  />
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#1a1a1f", minWidth: 42, textAlign: "right" }}>
                  {entry.ownership_pct.toFixed(1)}%
                </span>
              </div>

              {/* Capital */}
              <div style={{ textAlign: "right", fontFamily: "'DM Mono', monospace", fontSize: 12, color: "#1a1a1f" }}>
                {formatMoney(entry.capital_contributed)}
              </div>

              {/* Date */}
              <div style={{ textAlign: "right", fontSize: 12, color: "#6b6b76" }}>
                {formatDate(entry.investment_date)}
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 4, width: 80, justifyContent: "flex-end" }}>
                <button
                  onClick={() => startEdit(entry)}
                  style={{ background: "none", border: "1px solid #e8e6df", borderRadius: 5, padding: "3px 8px", cursor: "pointer", fontSize: 11, color: "#6b6b76", fontWeight: 500, fontFamily: "inherit" }}
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(entry.id)}
                  style={{ background: "none", border: "1px solid #e8e6df", borderRadius: 5, padding: "3px 6px", cursor: "pointer", color: "#c73e3e", fontFamily: "inherit" }}
                >
                  <XIcon size={10} />
                </button>
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

/* ---- Compliance Tab ---- */
function ComplianceTab({
  entityId,
  formationState,
  registrations,
  formedDate,
  legalStructure,
  obligations,
  documents,
  onRegistrationsChange,
  onRefresh,
}: {
  entityId: string;
  formationState: string;
  registrations: EntityRegistration[];
  formedDate: string | null;
  legalStructure: LegalStructure | null;
  obligations: ComplianceObligation[];
  documents: { id: string; name: string }[];
  onRegistrationsChange: (regs: EntityRegistration[]) => void;
  onRefresh: () => void;
}) {
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Build jurisdictions: formation state + all registrations
  const jurisdictions: {
    code: string;
    isFormation: boolean;
    registrationId: string | null;
    qualificationDate: string | null;
    lastFilingDate: string | null;
    stateId: string | null;
    filingExempt: boolean;
  }[] = [];

  // Formation state
  const formationReg = registrations.find((r) => r.jurisdiction === formationState);
  jurisdictions.push({
    code: formationState,
    isFormation: true,
    registrationId: formationReg?.id ?? null,
    qualificationDate: formedDate,
    lastFilingDate: formationReg?.last_filing_date ?? null,
    stateId: formationReg?.state_id ?? null,
    filingExempt: formationReg?.filing_exempt ?? false,
  });

  // Additional registrations
  for (const reg of registrations) {
    if (reg.jurisdiction !== formationState) {
      jurisdictions.push({
        code: reg.jurisdiction,
        isFormation: false,
        registrationId: reg.id,
        qualificationDate: reg.qualification_date,
        lastFilingDate: reg.last_filing_date,
        stateId: reg.state_id ?? null,
        filingExempt: reg.filing_exempt ?? false,
      });
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch(`/api/entities/${entityId}/compliance/sync`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json();
        console.error("Sync error:", err.error);
        return;
      }
      const data = await res.json();
      onRefresh();
      if (data.generated_count === 0) {
        setSyncMessage("No compliance rules apply to this entity type in the registered jurisdictions.");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSyncing(false);
    }
  }

  if (!legalStructure) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0" }}>
            <div style={{ fontSize: 20 }}>&#9432;</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1f", marginBottom: 2 }}>
                Set legal structure to generate compliance obligations
              </div>
              <div style={{ fontSize: 13, color: "#6b6b76" }}>
                Edit this entity&apos;s Overview tab and set the Legal Structure field (LLC, Corporation, LP, etc.) to automatically generate state-specific compliance obligations.
              </div>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  if (jurisdictions.length === 0) {
    return (
      <div style={{ fontSize: 13, color: "#9494a0", textAlign: "center", padding: "40px 0" }}>
        No compliance data
      </div>
    );
  }

  // Group obligations by jurisdiction
  const obligationsByJurisdiction = new Map<string, ComplianceObligation[]>();
  for (const obl of obligations) {
    const existing = obligationsByJurisdiction.get(obl.jurisdiction) || [];
    existing.push(obl);
    obligationsByJurisdiction.set(obl.jurisdiction, existing);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Sync button + message */}
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12 }}>
        {syncMessage && (
          <span style={{ fontSize: 12, color: "#9494a0" }}>{syncMessage}</span>
        )}
        <Button size="sm" onClick={handleSync} disabled={syncing}>
          {syncing ? "Syncing..." : "Sync from Rules"}
        </Button>
      </div>

      {jurisdictions.map((jur) => (
        <ComplianceCard
          key={jur.code}
          entityId={entityId}
          jur={jur}
          registrations={registrations}
          obligations={obligationsByJurisdiction.get(jur.code) || []}
          documents={documents}
          onRegistrationsChange={onRegistrationsChange}
          onRefresh={onRefresh}
        />
      ))}
    </div>
  );
}

/* ---- Single Compliance Card (with inline edit + obligation rows) ---- */
function ComplianceCard({
  entityId,
  jur,
  registrations,
  obligations,
  documents,
  onRegistrationsChange,
  onRefresh,
}: {
  entityId: string;
  jur: {
    code: string;
    isFormation: boolean;
    registrationId: string | null;
    qualificationDate: string | null;
    lastFilingDate: string | null;
    stateId: string | null;
    filingExempt: boolean;
  };
  registrations: EntityRegistration[];
  obligations: ComplianceObligation[];
  documents: { id: string; name: string }[];
  onRegistrationsChange: (regs: EntityRegistration[]) => void;
  onRefresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [lastFiled, setLastFiled] = useState(jur.lastFilingDate ?? "");
  const [qualDate, setQualDate] = useState(jur.qualificationDate ?? "");
  const [stateIdVal, setStateIdVal] = useState(jur.stateId ?? "");
  const [exempt, setExempt] = useState(jur.filingExempt);
  const [saving, setSaving] = useState(false);

  const stateName = getStateLabel(jur.code as Jurisdiction);

  // Calculate worst status across all obligations for the card badge
  const displayStatuses = obligations.map((o) =>
    getObligationDisplayStatus(o.next_due_date, o.status)
  );
  const worstStatus = obligations.length > 0
    ? getWorstObligationStatus(displayStatuses)
    : "current";
  const statusColors = FILING_STATUS_COLORS[worstStatus] || FILING_STATUS_COLORS.current;

  // Find soonest upcoming due date for badge label
  const pendingObligations = obligations.filter(
    (o) => o.status === "pending" && o.next_due_date
  );
  pendingObligations.sort(
    (a, b) => new Date(a.next_due_date!).getTime() - new Date(b.next_due_date!).getTime()
  );
  const soonestDue = pendingObligations[0]?.next_due_date;
  let badgeLabel = "Current";
  if (worstStatus === "overdue") badgeLabel = "Overdue";
  else if (worstStatus === "due_soon" && soonestDue) {
    badgeLabel = `Due ${new Date(soonestDue + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  } else if (worstStatus === "current" && soonestDue) {
    badgeLabel = `Next: ${new Date(soonestDue + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  } else if (worstStatus === "completed") badgeLabel = "All Complete";
  else if (worstStatus === "exempt") badgeLabel = "Exempt";
  else if (worstStatus === "not_applicable") badgeLabel = "N/A";

  function handleStartEdit() {
    setLastFiled(jur.lastFilingDate ?? "");
    setQualDate(jur.qualificationDate ?? "");
    setStateIdVal(jur.stateId ?? "");
    setExempt(jur.filingExempt);
    setEditing(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      let regId = jur.registrationId;
      if (!regId) {
        const createRes = await fetch(`/api/entities/${entityId}/registrations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jurisdiction: jur.code }),
        });
        if (!createRes.ok) throw new Error("Failed to create registration");
        const newReg = await createRes.json();
        regId = newReg.id;
      }

      const res = await fetch(`/api/entities/${entityId}/registrations`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registration_id: regId,
          last_filing_date: lastFiled || null,
          qualification_date: qualDate || null,
          state_id: stateIdVal || null,
          filing_exempt: exempt,
        }),
      });
      if (!res.ok) throw new Error("Failed to update registration");
      const updated = await res.json();

      if (!jur.registrationId) {
        onRegistrationsChange([...registrations, updated]);
      } else {
        onRegistrationsChange(
          registrations.map((r) => (r.id === updated.id ? updated : r))
        );
      }
      setEditing(false);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  const dateInputStyle: React.CSSProperties = {
    fontSize: 13,
    padding: "4px 8px",
    border: "1px solid #ddd9d0",
    borderRadius: 6,
    background: "#fff",
    color: "#1a1a1f",
    fontFamily: "inherit",
  };

  return (
    <Card>
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: "#1a1a1f" }}>{stateName}</span>
          <Badge
            label={jur.isFormation ? "Formation" : "Qualification"}
            color={jur.isFormation ? "#2d5a3d" : "#3366a8"}
            bg={jur.isFormation ? "rgba(45,90,61,0.10)" : "rgba(51,102,168,0.10)"}
          />
          {!editing && (
            <button
              onClick={handleStartEdit}
              style={{
                background: "none",
                border: "1px solid #e8e6df",
                borderRadius: 6,
                padding: "3px 10px",
                fontSize: 12,
                fontWeight: 500,
                color: "#6b6b76",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Edit
            </button>
          )}
        </div>
        {/* Status badge */}
        <div style={{ flexShrink: 0 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              borderRadius: 8,
              background: statusColors.bg,
              fontSize: 12,
              fontWeight: 600,
              color: statusColors.color,
            }}
          >
            <Dot color={statusColors.dot} size={6} />
            {badgeLabel}
          </div>
        </div>
      </div>

          {/* Sub-header: State ID + Formed/Qualified date */}
          <div style={{ fontSize: 11, color: "#6b6b76", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
            {jur.stateId && (
              <>STATE ID #: <span style={{ fontFamily: "'DM Mono', monospace", color: "#1a1a1f" }}>{jur.stateId}</span> &middot; </>
            )}
            {jur.isFormation ? "FORMED" : "QUALIFIED"}: <span style={{ color: "#1a1a1f" }}>{formatDate(jur.isFormation ? jur.qualificationDate : jur.qualificationDate)}</span>
          </div>

          {/* Edit mode for registration fields */}
          {editing && (
            <div style={{ marginBottom: 16, padding: 12, background: "#faf9f6", borderRadius: 8, border: "1px solid #e8e6df" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, fontSize: 13, marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 11, color: "#6b6b76", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                    State ID #
                  </div>
                  <input
                    type="text"
                    value={stateIdVal}
                    onChange={(e) => setStateIdVal(e.target.value)}
                    placeholder="e.g. 202412345678"
                    style={{ ...dateInputStyle, width: "100%", boxSizing: "border-box" as const }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#6b6b76", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                    {jur.isFormation ? "Formed" : "Qualified"}
                  </div>
                  {!jur.isFormation ? (
                    <input
                      type="date"
                      value={qualDate}
                      onChange={(e) => setQualDate(e.target.value)}
                      style={dateInputStyle}
                    />
                  ) : (
                    <div style={{ color: "#1a1a1f", padding: "4px 0" }}>{formatDate(jur.qualificationDate)}</div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#6b6b76", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                    Last Filed (legacy)
                  </div>
                  <input
                    type="date"
                    value={lastFiled}
                    onChange={(e) => setLastFiled(e.target.value)}
                    style={dateInputStyle}
                  />
                </div>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#1a1a1f", cursor: "pointer", marginBottom: 10 }}>
                <input type="checkbox" checked={exempt} onChange={(e) => setExempt(e.target.checked)} style={{ accentColor: "#2d5a3d" }} />
                No filing required for this jurisdiction
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <Button size="sm" variant="primary" onClick={handleSave} disabled={saving}>
                  {saving ? "Saving..." : "Save"}
                </Button>
                <Button size="sm" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </div>
          )}

          {/* Obligation rows */}
          {obligations.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {obligations.map((obl, idx) => (
                <ObligationRow
                  key={obl.id}
                  entityId={entityId}
                  obligation={obl}
                  documents={documents}
                  isLast={idx === obligations.length - 1}
                  onRefresh={onRefresh}
                />
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "#9494a0", padding: "8px 0" }}>
              No compliance obligations for this entity type in this jurisdiction.
            </div>
          )}
    </Card>
  );
}

/* ---- Single Obligation Row within a ComplianceCard ---- */
function ObligationRow({
  entityId,
  obligation,
  documents,
  isLast,
  onRefresh,
}: {
  entityId: string;
  obligation: ComplianceObligation;
  documents: { id: string; name: string }[];
  isLast: boolean;
  onRefresh: () => void;
}) {
  const isMobile = useIsMobile();
  const [detailOpen, setDetailOpen] = useState(false);
  const [markOpen, setMarkOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [completedAt, setCompletedAt] = useState(new Date().toISOString().split("T")[0]);
  const [amountPaid, setAmountPaid] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [notes, setNotes] = useState("");
  const [markAs, setMarkAs] = useState<"completed" | "exempt" | "not_applicable">("completed");

  const displayStatus = getObligationDisplayStatus(obligation.next_due_date, obligation.status);
  const colors = FILING_STATUS_COLORS[displayStatus] || FILING_STATUS_COLORS.current;
  const statusLabel = OBLIGATION_STATUS_LABELS[displayStatus] || displayStatus;

  const dueLabel = obligation.next_due_date
    ? new Date(obligation.next_due_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "N/A";

  const completedLabel = obligation.completed_at
    ? new Date(obligation.completed_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  // Has any detail worth expanding?
  const hasDetail = obligation.completed_at || obligation.confirmation || obligation.payment_amount || obligation.document_id || obligation.penalty_description || obligation.description;

  const linkedDoc = obligation.document_id ? documents.find(d => d.id === obligation.document_id) : null;

  function handleOpenComplete() {
    setCompletedAt(new Date().toISOString().split("T")[0]);
    setAmountPaid("");
    setConfirmation("");
    setNotes("");
    setMarkAs("completed");
    setDetailOpen(false);
    setMarkOpen(true);
  }

  async function handleSaveComplete() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { status: markAs };
      if (markAs === "completed") {
        body.completed_at = completedAt;
        if (amountPaid) body.payment_amount = Math.round(parseFloat(amountPaid) * 100);
        if (confirmation) body.confirmation = confirmation;
        if (notes) body.notes = notes;
      }
      if (markAs === "exempt" || markAs === "not_applicable") {
        if (notes) body.notes = notes;
      }

      const res = await fetch(`/api/entities/${entityId}/compliance/${obligation.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to update obligation");
      setMarkOpen(false);
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    fontSize: 13,
    padding: "6px 10px",
    border: "1px solid #ddd9d0",
    borderRadius: 6,
    background: "#fff",
    color: "#1a1a1f",
    fontFamily: "inherit",
    width: "100%",
    boxSizing: "border-box",
  };

  return (
    <div style={{ borderTop: "1px solid #f0ede6", paddingTop: 10, paddingBottom: isLast ? 0 : 10 }}>
      {/* Main row — clickable to expand detail */}
      {isMobile ? (
        /* Mobile: card layout */
        <div
          onClick={() => { if (!markOpen && hasDetail) setDetailOpen(p => !p); }}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            fontSize: 13,
            cursor: hasDetail ? "pointer" : "default",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ fontWeight: 500, color: "#1a1a1f", display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
              {hasDetail && (
                <span style={{ display: "inline-block", fontSize: 8, color: "#9494a0", transition: "transform 0.15s", transform: detailOpen ? "rotate(90deg)" : "rotate(0deg)", flexShrink: 0 }}>&#9654;</span>
              )}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{obligation.name}</span>
              {obligation.form_number && (
                <>
                  {" "}
                  {obligation.portal_url ? (
                    <a href={obligation.portal_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ fontSize: 11, color: "#3366a8", textDecoration: "none", flexShrink: 0 }}>({obligation.form_number})</a>
                  ) : (
                    <span style={{ fontSize: 11, color: "#9494a0", flexShrink: 0 }}>({obligation.form_number})</span>
                  )}
                </>
              )}
            </div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 8px",
                borderRadius: 6,
                background: colors.bg,
                fontSize: 11,
                fontWeight: 600,
                color: colors.color,
                flexShrink: 0,
              }}
            >
              <Dot color={colors.dot} size={5} />
              {statusLabel}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, color: "#6b6b76" }}>
            <span>Due: {dueLabel}</span>
            <span>Fee: {obligation.fee_description || "\u2014"}</span>
          </div>
          <div style={{ fontSize: 11, color: "#9494a0" }}>
            Filed with: {obligation.filed_with || "\u2014"}
            {completedLabel && <> &middot; Last completed: {completedLabel}</>}
          </div>
          {obligation.status === "pending" && (
            <div style={{ marginTop: 2 }}>
              <button
                onClick={(e) => { e.stopPropagation(); handleOpenComplete(); }}
                style={{
                  background: "none",
                  border: "1px solid #e8e6df",
                  borderRadius: 6,
                  padding: "3px 10px",
                  fontSize: 11,
                  fontWeight: 500,
                  color: "#2d5a3d",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  whiteSpace: "nowrap",
                }}
              >
                Mark Complete
              </button>
            </div>
          )}
        </div>
      ) : (
        /* Desktop: grid layout */
        <div
          onClick={() => { if (!markOpen && hasDetail) setDetailOpen(p => !p); }}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 140px 130px 110px 110px",
            gap: 8,
            alignItems: "start",
            fontSize: 13,
            cursor: hasDetail ? "pointer" : "default",
          }}
        >
          {/* Obligation name */}
          <div>
            <div style={{ fontWeight: 500, color: "#1a1a1f", display: "flex", alignItems: "center", gap: 6 }}>
              {hasDetail && (
                <span style={{ display: "inline-block", fontSize: 8, color: "#9494a0", transition: "transform 0.15s", transform: detailOpen ? "rotate(90deg)" : "rotate(0deg)", flexShrink: 0 }}>&#9654;</span>
              )}
              <span>{obligation.name}</span>
              {obligation.form_number && (
                <>
                  {" "}
                  {obligation.portal_url ? (
                    <a
                      href={obligation.portal_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={{ fontSize: 11, color: "#3366a8", textDecoration: "none" }}
                    >
                      ({obligation.form_number})
                    </a>
                  ) : (
                    <span style={{ fontSize: 11, color: "#9494a0" }}>({obligation.form_number})</span>
                  )}
                </>
              )}
            </div>
            <div style={{ fontSize: 11, color: "#9494a0", marginTop: 2, paddingLeft: hasDetail ? 14 : 0 }}>
              Filed with: {obligation.filed_with || "\u2014"}
              {completedLabel && <> &middot; Last completed: {completedLabel}</>}
            </div>
          </div>

          {/* Fee */}
          <div style={{ color: "#1a1a1f" }}>{obligation.fee_description || "\u2014"}</div>

          {/* Due date */}
          <div style={{ color: "#1a1a1f" }}>{dueLabel}</div>

          {/* Status badge */}
          <div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 8px",
                borderRadius: 6,
                background: colors.bg,
                fontSize: 11,
                fontWeight: 600,
                color: colors.color,
              }}
            >
              <Dot color={colors.dot} size={5} />
              {statusLabel}
            </div>
          </div>

          {/* Action */}
          <div>
            {obligation.status === "pending" && (
              <button
                onClick={(e) => { e.stopPropagation(); handleOpenComplete(); }}
                style={{
                  background: "none",
                  border: "1px solid #e8e6df",
                  borderRadius: 6,
                  padding: "3px 10px",
                  fontSize: 11,
                  fontWeight: 500,
                  color: "#2d5a3d",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  whiteSpace: "nowrap",
                }}
              >
                Mark Complete
              </button>
            )}
          </div>
        </div>
      )}

      {/* Expanded detail panel */}
      {detailOpen && !markOpen && (
        <div style={{ marginTop: 8, marginLeft: 16, padding: "10px 14px", background: "#faf9f6", borderRadius: 8, border: "1px solid #f0ede6", fontSize: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            {obligation.completed_at && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>Completed</div>
                <div style={{ color: "#1a1a1f" }}>{completedLabel}</div>
              </div>
            )}
            {obligation.payment_amount != null && obligation.payment_amount > 0 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>Amount Paid</div>
                <div style={{ color: "#1a1a1f" }}>${(obligation.payment_amount / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
              </div>
            )}
            {obligation.confirmation && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>Confirmation #</div>
                <div style={{ color: "#1a1a1f" }}>{obligation.confirmation}</div>
              </div>
            )}
          </div>
          {obligation.notes && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>Notes</div>
              <div style={{ color: "#6b6b76", fontStyle: "italic" }}>{obligation.notes}</div>
            </div>
          )}
          {obligation.description && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>Description</div>
              <div style={{ color: "#6b6b76" }}>{obligation.description}</div>
            </div>
          )}
          {obligation.penalty_description && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>Penalty</div>
              <div style={{ color: "#6b6b76" }}>{obligation.penalty_description}</div>
            </div>
          )}
          {linkedDoc && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>Document</div>
              <a
                href={`/entities/${entityId}?tab=documents`}
                style={{ color: "#3366a8", textDecoration: "none", fontSize: 12 }}
              >
                {linkedDoc.name}
              </a>
            </div>
          )}
        </div>
      )}

      {/* Expanded mark complete panel */}
      {markOpen && (
        <div style={{ marginTop: 10, padding: 14, background: "#faf9f6", borderRadius: 8, border: "1px solid #e8e6df" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: "#6b6b76", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Date Completed</div>
              <input type="date" value={completedAt} onChange={(e) => setCompletedAt(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#6b6b76", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Amount Paid ($)</div>
              <input type="number" step="0.01" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} placeholder="0.00" style={inputStyle} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#6b6b76", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Confirmation #</div>
              <input type="text" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder="e.g. DEL-2026-001" style={inputStyle} />
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: "#6b6b76", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Notes</div>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
              <input type="radio" name={`mark-${obligation.id}`} checked={markAs === "completed"} onChange={() => setMarkAs("completed")} style={{ accentColor: "#2d5a3d" }} />
              Mark as Completed
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
              <input type="radio" name={`mark-${obligation.id}`} checked={markAs === "not_applicable"} onChange={() => setMarkAs("not_applicable")} style={{ accentColor: "#2d5a3d" }} />
              Mark as N/A
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
              <input type="radio" name={`mark-${obligation.id}`} checked={markAs === "exempt"} onChange={() => setMarkAs("exempt")} style={{ accentColor: "#2d5a3d" }} />
              Mark as Exempt
            </label>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button size="sm" variant="primary" onClick={handleSaveComplete} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
            <Button size="sm" onClick={() => setMarkOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Documents Tab Helpers                                              */
/* ------------------------------------------------------------------ */

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "\u2014";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  create_entity: { label: "Create Entity", color: "#2d5a3d" },
  update_entity: { label: "Update Entity", color: "#3366a8" },
  create_relationship: { label: "Create Relationship", color: "#7b4db5" },
  add_member: { label: "Add Member", color: "#2d8a4e" },
  add_manager: { label: "Add Manager", color: "#2d5a3d" },
  add_registration: { label: "Add Registration", color: "#c47520" },
  update_registration: { label: "Update Filing", color: "#c47520" },
  add_trust_role: { label: "Add Trust Role", color: "#c47520" },
  update_trust_details: { label: "Update Trust Details", color: "#c47520" },
  update_cap_table: { label: "Update Cap Table", color: "#3366a8" },
  create_directory_entry: { label: "Create Directory Entry", color: "#2d8a4e" },
  add_custom_field: { label: "Add Custom Field", color: "#6b6b76" },
  add_partnership_rep: { label: "Add Partnership Rep", color: "#2d8a4e" },
  add_role: { label: "Add Role", color: "#7b4db5" },
  complete_obligation: { label: "Complete Obligation", color: "#2d5a3d" },
  update_obligation: { label: "Update Obligation", color: "#c47520" },
};

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  type: "Type",
  ein: "EIN",
  formation_state: "Formation State",
  formed_date: "Formation Date",
  address: "Address",
  registered_agent: "Registered Agent",
  notes: "Notes",
  description: "Description",
  terms: "Terms",
  frequency: "Payment Frequency",
  annual_estimate: "Annual Estimate",
  ownership_pct: "Ownership %",
  capital_contributed: "Capital Contributed",
  units: "Units",
  investor_name: "Investor Name",
  investor_type: "Investor Type",
  replaces_investor_name: "Replaces",
  jurisdiction: "Jurisdiction",
  qualification_date: "Qualification Date",
  last_filing_date: "Last Filing Date",
  state_id: "State Filing #",
  role: "Role",
  trust_type: "Trust Type",
  trust_date: "Trust Date",
  grantor_name: "Grantor",
  situs_state: "Situs State",
  email: "Email",
  label: "Label",
  value: "Value",
  status: "Status",
  business_purpose: "Business Purpose",
  role_title: "Role Title",
  completed_at: "Completed At",
  payment_amount: "Payment Amount",
  confirmation: "Confirmation #",
  obligation_id: "Obligation",
};

const HIDDEN_ID_FIELDS = new Set([
  "entity_id",
  "trust_detail_id",
  "registration_id",
  "from_entity_id",
  "to_entity_id",
  "from_directory_id",
  "to_directory_id",
  "investor_entity_id",
  "investor_directory_id",
  "field_def_id",
  "obligation_id",
]);

function getFieldLabel(key: string): string {
  return FIELD_LABELS[key] || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Fields stored as BIGINT cents that should display as dollars in the review panel
const CENTS_FIELDS = new Set(["capital_contributed", "annual_estimate", "payment_amount"]);

function centsToDisplay(val: unknown): string {
  const num = Number(val);
  if (isNaN(num)) return String(val ?? "");
  return (num / 100).toFixed(2);
}

function displayToCents(val: string): number {
  const num = parseFloat(val);
  if (isNaN(num)) return 0;
  return Math.round(num * 100);
}

function getDocCategory(docType: DocumentType): string {
  for (const [key, cat] of Object.entries(DOCUMENT_TYPE_CATEGORIES)) {
    if (cat.types.includes(docType)) return key;
  }
  return "other";
}

/* ------------------------------------------------------------------ */
/*  Documents Tab Component                                            */
/* ------------------------------------------------------------------ */

function DocumentsTab({
  entityId,
  documents,
  docsLoading,
  onRefresh,
  onRefreshQuiet,
  onEntityRefresh,
  entityName,
  entityData,
}: {
  entityId: string;
  documents: DocRecord[];
  docsLoading: boolean;
  onRefresh: () => Promise<void> | void;
  onRefreshQuiet: () => Promise<void> | void;
  onEntityRefresh: () => Promise<void> | void;
  entityName: string;
  entityData: Record<string, unknown> | null;
}) {
  const router = useRouter();
  const [showUpload, setShowUpload] = useState(false);

  // Pipeline state
  const [pipelineBatchId, setPipelineBatchId] = useState<string | null>(null);
  const [pipelinePhase, setPipelinePhase] = useState<"upload" | "processing" | "results">("upload");

  // AI processing state
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [processError, setProcessError] = useState<string | null>(null);
  const [aiActions, setAiActions] = useState<Record<string, ProposedAction[]>>({});
  const [aiReviewDocId, setAiReviewDocId] = useState<string | null>(null);
  const [selectedActions, setSelectedActions] = useState<Record<number, boolean>>({});
  const [editedActions, setEditedActions] = useState<Record<number, ProposedAction>>({});
  const [applyingActions, setApplyingActions] = useState(false);
  const [applyResult, setApplyResult] = useState<{ applied: number; failed: number; errors: string[] } | null>(null);
  const [originalIndicesMap, setOriginalIndicesMap] = useState<Record<string, number[]>>({});

  // Collapsible category state
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());

  // Track dismissed documents so auto-open doesn't re-open them
  const [dismissedDocIds, setDismissedDocIds] = useState<Set<string>>(new Set());

  // Auto-open review panel for documents with pending AI actions
  useEffect(() => {
    if (aiReviewDocId) return; // Already reviewing something
    for (const doc of documents) {
      if (dismissedDocIds.has(doc.id)) continue; // User dismissed this one
      if (doc.ai_extracted && doc.ai_extraction) {
        const extraction = doc.ai_extraction as {
          actions?: ProposedAction[];
          applied?: boolean;
          applied_indices?: number[];
        };
        if (extraction.actions && extraction.actions.length > 0 && !extraction.applied) {
          // Filter out actions at indices that were already applied
          const appliedIndices = new Set(extraction.applied_indices || []);
          const pendingActions: ProposedAction[] = [];
          const pendingOriginalIndices: number[] = [];
          extraction.actions.forEach((a: ProposedAction, idx: number) => {
            if (!appliedIndices.has(idx)) {
              pendingActions.push(a);
              pendingOriginalIndices.push(idx);
            }
          });
          if (pendingActions.length > 0) {
            // Inject current entity ID into actions that need it
            // Also inject trust_detail_id for add_trust_role actions
            const trustDetailId = (entityData as Record<string, unknown> | null)?.trust_details
              ? ((entityData as Record<string, unknown>).trust_details as { id?: string })?.id
              : undefined;
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            const isValidUuid = (v: unknown) => typeof v === 'string' && uuidRegex.test(v);
            const fixedActions = pendingActions.map((a: ProposedAction) => {
              const d = a.data as Record<string, unknown>;
              if (!d) return a;
              let fixed = a;
              if ('entity_id' in d && !isValidUuid(d.entity_id)) {
                fixed = { ...fixed, data: { ...d, entity_id: entityId } };
              }
              if (a.action === 'add_trust_role' && 'trust_detail_id' in d && !isValidUuid(d.trust_detail_id) && trustDetailId) {
                fixed = { ...fixed, data: { ...(fixed.data as Record<string, unknown>), trust_detail_id: trustDetailId } };
              }
              return fixed;
            });
            setAiActions((prev) => ({ ...prev, [doc.id]: fixedActions }));
            setAiReviewDocId(doc.id);
            const defaults: Record<number, boolean> = {};
            const edits: Record<number, ProposedAction> = {};
            fixedActions.forEach((action: ProposedAction, idx: number) => {
              defaults[idx] = action.confidence === "high" || action.confidence === "medium";
              edits[idx] = { ...action };
            });
            setSelectedActions(defaults);
            setEditedActions(edits);
            // Store the original indices for later apply calls
            setOriginalIndicesMap((prev) => ({ ...prev, [doc.id]: pendingOriginalIndices }));
            break; // Only auto-open first one
          }
        }
      }
    }
  }, [documents, aiReviewDocId, dismissedDocIds, entityId, entityData]);

  const inputStyle: React.CSSProperties = {
    background: "#fafaf7",
    border: "1px solid #ddd9d0",
    borderRadius: 6,
    padding: "6px 10px",
    fontSize: 13,
    fontFamily: "inherit",
    color: "#1a1a1f",
    outline: "none",
    width: "100%",
    boxSizing: "border-box" as const,
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 11,
    fontWeight: 600,
    color: "#6b6b76",
    marginBottom: 4,
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
  };

  /* ---- Download ---- */
  const handleDownload = async (docId: string) => {
    try {
      const res = await fetch(`/api/documents/${docId}/download`);
      if (!res.ok) throw new Error("Download failed");
      const data = await res.json();
      window.open(data.url, "_blank");
    } catch (err) {
      console.error("Download error:", err);
    }
  };

  /* ---- Delete ---- */
  const handleDelete = async (docId: string) => {
    if (!confirm("Delete this document?")) return;
    try {
      const res = await fetch(`/api/documents/${docId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      onRefresh();
    } catch (err) {
      console.error("Delete error:", err);
    }
  };

  /* ---- AI Process ---- */
  const handleProcess = async (docId: string) => {
    setProcessingId(docId);
    setProcessError(null);
    setApplyResult(null);
    try {
      const res = await fetch(`/api/documents/${docId}/process`, { method: "POST" });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const msg = errData.error || "Processing failed";
        // Friendly message for known limits
        if (msg.includes("100 PDF pages")) {
          throw new Error("This PDF exceeds the 100-page limit for AI processing. Try uploading a shorter version of the document.");
        }
        throw new Error(msg);
      }
      const data = await res.json();
      if (data.actions && data.actions.length > 0) {
        setAiActions((prev) => ({ ...prev, [docId]: data.actions }));
        setAiReviewDocId(docId);
        // Default: select high confidence, deselect low
        const defaults: Record<number, boolean> = {};
        const edits: Record<number, ProposedAction> = {};
        const indices: number[] = [];
        data.actions.forEach((action: ProposedAction, idx: number) => {
          defaults[idx] = action.confidence === "high" || action.confidence === "medium";
          edits[idx] = { ...action };
          indices.push(idx);
        });
        setSelectedActions(defaults);
        setEditedActions(edits);
        setOriginalIndicesMap((prev) => ({ ...prev, [docId]: indices }));
      }
      onRefresh();
    } catch (err) {
      console.error("Process error:", err);
      setProcessError(err instanceof Error ? err.message : "Processing failed");
    } finally {
      setProcessingId(null);
    }
  };

  /* ---- Apply Actions ---- */
  const handleApplyActions = async () => {
    if (!aiReviewDocId) return;
    setApplyingActions(true);
    try {
      const selectedEntries = Object.entries(selectedActions)
        .filter(([, selected]) => selected);
      const toApply = selectedEntries.map(([idx]) => editedActions[Number(idx)]);
      // Mark ALL displayed indices as reviewed (selected = applied, unselected = rejected)
      const originalIndices = originalIndicesMap[aiReviewDocId] || [];
      const allReviewedIndices = [...originalIndices];

      if (toApply.length === 0) {
        // User unchecked everything — still mark all as reviewed so they don't come back
        await fetch(`/api/documents/${aiReviewDocId}/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actions: [], action_indices: allReviewedIndices }),
        });
        await onRefresh();
        const docId = aiReviewDocId;
        setAiReviewDocId(null);
        setAiActions((prev) => { const next = { ...prev }; delete next[docId]; return next; });
        setSelectedActions({});
        setEditedActions({});
        setOriginalIndicesMap((prev) => { const next = { ...prev }; delete next[docId]; return next; });
        setApplyingActions(false);
        return;
      }

      const res = await fetch(`/api/documents/${aiReviewDocId}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actions: toApply, action_indices: allReviewedIndices }),
      });
      if (!res.ok) throw new Error("Apply failed");

      const result = await res.json();
      const failedResults = (result.results || []).filter((r: { success: boolean }) => !r.success);

      // Refresh documents FIRST so the useEffect sees updated applied_indices
      // before we clear aiReviewDocId (which triggers the useEffect)
      await onRefresh();
      // Refresh entity data so all tabs reflect the applied changes
      await onEntityRefresh();

      if (failedResults.length > 0 && result.applied === 0) {
        // All actions failed — show error, don't close the panel
        const errors = failedResults.map((r: { action: string; error?: string }) =>
          `${r.action}: ${r.error || 'Unknown error'}`
        );
        setApplyResult({ applied: 0, failed: failedResults.length, errors });
        return;
      }

      // Show result summary (clears after 5s)
      if (failedResults.length > 0) {
        const errors = failedResults.map((r: { action: string; error?: string }) =>
          `${r.action}: ${r.error || 'Unknown error'}`
        );
        setApplyResult({ applied: result.applied, failed: failedResults.length, errors });
      } else {
        setApplyResult({ applied: result.applied, failed: 0, errors: [] });
      }

      const docId = aiReviewDocId;
      setDismissedDocIds((prev) => new Set([...prev, docId]));
      setAiReviewDocId(null);
      setAiActions((prev) => {
        const next = { ...prev };
        delete next[docId];
        return next;
      });
      setSelectedActions({});
      setEditedActions({});
      setOriginalIndicesMap((prev) => {
        const next = { ...prev };
        delete next[docId];
        return next;
      });
    } catch (err) {
      console.error("Apply error:", err);
      setApplyResult({ applied: 0, failed: 0, errors: [err instanceof Error ? err.message : "Apply failed"] });
    } finally {
      setApplyingActions(false);
    }
  };

  /* ---- Group documents by category ---- */
  const grouped: Record<string, DocRecord[]> = {};
  documents.forEach((doc) => {
    const cat = doc.document_category || getDocCategory(doc.document_type);
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(doc);
  });

  /* ---- Expandable row state ---- */
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);

  /* ---- Inline rename state ---- */
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const handleRename = async (docId: string) => {
    const trimmed = editingName.trim();
    if (!trimmed) return;
    try {
      const res = await fetch(`/api/documents/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error("Rename failed");
      setEditingDocId(null);
      setEditingName("");
      onRefresh();
    } catch (err) {
      console.error("Rename error:", err);
    }
  };

  const toggleCategory = (cat: string) => {
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  /* ---- Confidence badge ---- */
  const ConfidenceBadge = ({ confidence }: { confidence: string }) => {
    const colors: Record<string, { color: string; bg: string }> = {
      high: { color: "#2d5a3d", bg: "rgba(45,90,61,0.10)" },
      medium: { color: "#c47520", bg: "rgba(196,117,32,0.10)" },
      low: { color: "#c73e3e", bg: "rgba(199,62,62,0.10)" },
    };
    const c = colors[confidence] || colors.low;
    return (
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: c.color,
          background: c.bg,
          padding: "2px 8px",
          borderRadius: 4,
          textTransform: "capitalize",
        }}
      >
        {confidence}
      </span>
    );
  };

  if (docsLoading && documents.length === 0) {
    return (
      <div style={{ fontSize: 13, color: "#9494a0", textAlign: "center", padding: "40px 0" }}>
        Loading documents...
      </div>
    );
  }

  return (
    <div>
      {/* Upload toggle */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        {!showUpload && (
          <Button variant="primary" onClick={async () => {
            setShowUpload(true);
            // Create a pipeline batch for this entity
            if (!pipelineBatchId) {
              try {
                const res = await fetch("/api/pipeline/batches", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ context: "entity", entity_id: entityId }),
                });
                if (res.ok) {
                  const batch = await res.json();
                  setPipelineBatchId(batch.id);
                }
              } catch { /* ignore */ }
            }
          }}>
            <UploadIcon size={14} /> Upload Documents
          </Button>
        )}
      </div>

      {/* Pipeline Upload */}
      {showUpload && pipelineBatchId && pipelinePhase === "upload" && (
        <div style={{ marginBottom: 20 }}>
          <UploadDropZone
            batchId={pipelineBatchId}
            defaultEntityId={entityId}
            onFilesUploaded={async () => {
              await fetch(`/api/pipeline/batches/${pipelineBatchId}/process`, { method: "POST" });
              setPipelinePhase("processing");
            }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <Button onClick={() => {
              setShowUpload(false);
              setPipelineBatchId(null);
              setPipelinePhase("upload");
            }}>
              <XIcon size={12} /> Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Pipeline Processing + Results */}
      {showUpload && pipelineBatchId && (pipelinePhase === "processing" || pipelinePhase === "results") && (
        <div style={{ marginBottom: 20 }}>
          <ProcessingView
            batchId={pipelineBatchId}
            entities={[]}
            onDocumentsChanged={onRefreshQuiet}
            onComplete={() => {
              setShowUpload(false);
              setPipelineBatchId(null);
              setPipelinePhase("upload");
            }}
          />
        </div>
      )}

      {/* AI Processing Banner */}
      {processingId && (
        <Card style={{ marginBottom: 20, border: "1px solid rgba(45,90,61,0.3)", background: "rgba(45,90,61,0.03)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "4px 0" }}>
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: "50%",
                border: "3px solid #e8e6df",
                borderTopColor: "#2d5a3d",
                animation: "ai-spin 1s linear infinite",
                flexShrink: 0,
              }}
            />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1f" }}>
                Analyzing document with AI...
              </div>
              <div style={{ fontSize: 12, color: "#6b6b76", marginTop: 2 }}>
                Extracting entities, relationships, and key data. This may take 30-60 seconds.
              </div>
            </div>
          </div>
          <style>{`@keyframes ai-spin { to { transform: rotate(360deg); } }`}</style>
        </Card>
      )}

      {/* AI Process Error Banner */}
      {processError && (
        <div
          style={{
            marginBottom: 16,
            padding: "12px 16px",
            background: "rgba(199,62,62,0.06)",
            border: "1px solid rgba(199,62,62,0.2)",
            borderRadius: 8,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: 13, color: "#c73e3e" }}>{processError}</span>
          <button
            onClick={() => setProcessError(null)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#9494a0", padding: 2, display: "flex" }}
          >
            <XIcon size={12} />
          </button>
        </div>
      )}

      {/* AI Review Panel */}
      {aiReviewDocId && aiActions[aiReviewDocId] && (
        <Card style={{ marginBottom: 20, border: "1px solid rgba(45,90,61,0.3)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <SparkleIcon size={18} className="" />
            <span style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1f" }}>
              AI found {aiActions[aiReviewDocId].length} proposed change{aiActions[aiReviewDocId].length !== 1 ? "s" : ""} from &ldquo;{documents.find((d) => d.id === aiReviewDocId)?.name || "document"}&rdquo;
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {aiActions[aiReviewDocId].map((action, idx) => {
              const edited = editedActions[idx] || action;
              const originalIsCreate = action.action === "create_entity" || action.action === "create_directory_entry";
              const isDirectoryMode = edited.action === "create_directory_entry";
              const currentActionType = edited.action;
              const actionInfo = ACTION_LABELS[currentActionType] || { label: currentActionType, color: "#6b6b76" };
              const isUpdateEntity = currentActionType === "update_entity";
              const isCompleteObligation = currentActionType === "complete_obligation";

              // Resolve obligation name for complete_obligation actions
              let obligationLabel: string | null = null;
              if (isCompleteObligation && edited.data.obligation_id && entityData) {
                const obligations = entityData.compliance_obligations as { id: string; name: string; jurisdiction: string }[] | undefined;
                const matched = obligations?.find(o => o.id === edited.data.obligation_id);
                if (matched) {
                  obligationLabel = `${matched.name} (${matched.jurisdiction})`;
                }
              }

              // Determine which fields to show based on action type
              const visibleEntries = Object.entries(edited.data).filter(([key]) => {
                if (HIDDEN_ID_FIELDS.has(key)) return false;
                // For directory entry mode, only show relevant fields
                if (originalIsCreate && isDirectoryMode) {
                  return ["name", "type", "email"].includes(key);
                }
                // For update_entity, show fields from the "fields" sub-object instead
                if (isUpdateEntity && key === "fields") return false;
                return true;
              });

              // For update_entity, get the fields sub-object
              const updateFields = isUpdateEntity && edited.data.fields
                ? (edited.data.fields as Record<string, unknown>)
                : null;

              return (
                <div
                  key={idx}
                  style={{
                    border: "1px solid #e8e6df",
                    borderRadius: 8,
                    padding: 14,
                    background: selectedActions[idx] ? "rgba(45,90,61,0.02)" : "#fafaf7",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <input
                      type="checkbox"
                      checked={!!selectedActions[idx]}
                      onChange={(e) =>
                        setSelectedActions((prev) => ({ ...prev, [idx]: e.target.checked }))
                      }
                      style={{ accentColor: "#2d5a3d" }}
                    />
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: actionInfo.color,
                        background: hexToRgba(actionInfo.color, 0.1),
                        padding: "2px 8px",
                        borderRadius: 4,
                      }}
                    >
                      {actionInfo.label}
                    </span>
                    <ConfidenceBadge confidence={action.confidence} />

                    {/* Create Entity / Directory Entry toggle */}
                    {originalIsCreate && (
                      <div style={{ display: "flex", marginLeft: "auto", border: "1px solid #ddd9d0", borderRadius: 6, overflow: "hidden" }}>
                        <button
                          onClick={() => {
                            setEditedActions((prev) => ({
                              ...prev,
                              [idx]: { ...prev[idx], action: "create_entity" as ProposedAction["action"] },
                            }));
                          }}
                          style={{
                            padding: "3px 10px",
                            fontSize: 11,
                            fontWeight: 600,
                            border: "none",
                            cursor: "pointer",
                            background: !isDirectoryMode ? "#2d5a3d" : "#fafaf7",
                            color: !isDirectoryMode ? "#fff" : "#6b6b76",
                            transition: "all 0.15s",
                          }}
                        >
                          Entity
                        </button>
                        <button
                          onClick={() => {
                            setEditedActions((prev) => ({
                              ...prev,
                              [idx]: { ...prev[idx], action: "create_directory_entry" as ProposedAction["action"] },
                            }));
                          }}
                          style={{
                            padding: "3px 10px",
                            fontSize: 11,
                            fontWeight: 600,
                            border: "none",
                            borderLeft: "1px solid #ddd9d0",
                            cursor: "pointer",
                            background: isDirectoryMode ? "#2d8a4e" : "#fafaf7",
                            color: isDirectoryMode ? "#fff" : "#6b6b76",
                            transition: "all 0.15s",
                          }}
                        >
                          Directory Entry
                        </button>
                      </div>
                    )}
                    {!originalIsCreate && <span style={{ flex: 1 }} />}
                  </div>

                  {/* Update Entity: show field comparison */}
                  {isUpdateEntity && updateFields && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: "#1a1a1f", marginBottom: 8 }}>
                        Updating: {entityName || "Current Entity"}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {Object.entries(updateFields).map(([key, proposedVal]) => {
                          const currentVal = entityData ? entityData[key] : undefined;
                          return (
                            <div
                              key={key}
                              style={{
                                display: "grid",
                                gridTemplateColumns: "140px 1fr 24px 1fr",
                                gap: 8,
                                alignItems: "center",
                                padding: "6px 0",
                                borderBottom: "1px solid #f0eee8",
                              }}
                            >
                              <label style={{ fontSize: 11, fontWeight: 600, color: "#6b6b76", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                {getFieldLabel(key)}
                              </label>
                              <div
                                style={{
                                  fontSize: 12,
                                  color: "#9494a0",
                                  padding: "4px 8px",
                                  background: "#f0eee8",
                                  borderRadius: 4,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                                title={String(currentVal ?? "(empty)")}
                              >
                                {String(currentVal ?? "(empty)")}
                              </div>
                              <span style={{ fontSize: 12, color: "#9494a0", textAlign: "center" }}>&rarr;</span>
                              <input
                                style={{ ...inputStyle, fontSize: 12, padding: "4px 8px" }}
                                value={String(proposedVal ?? "")}
                                onChange={(e) => {
                                  setEditedActions((prev) => ({
                                    ...prev,
                                    [idx]: {
                                      ...prev[idx],
                                      data: {
                                        ...prev[idx].data,
                                        fields: {
                                          ...(prev[idx].data.fields as Record<string, unknown>),
                                          [key]: e.target.value,
                                        },
                                      },
                                    },
                                  }));
                                }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Update Entity without "fields" sub-object: show flat fields with comparison */}
                  {isUpdateEntity && !updateFields && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: "#1a1a1f", marginBottom: 8 }}>
                        Updating: {entityName || "Current Entity"}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {visibleEntries.map(([key, proposedVal]) => {
                          const currentVal = entityData ? entityData[key] : undefined;
                          return (
                            <div
                              key={key}
                              style={{
                                display: "grid",
                                gridTemplateColumns: "140px 1fr 24px 1fr",
                                gap: 8,
                                alignItems: "center",
                                padding: "6px 0",
                                borderBottom: "1px solid #f0eee8",
                              }}
                            >
                              <label style={{ fontSize: 11, fontWeight: 600, color: "#6b6b76", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                {getFieldLabel(key)}
                              </label>
                              <div
                                style={{
                                  fontSize: 12,
                                  color: "#9494a0",
                                  padding: "4px 8px",
                                  background: "#f0eee8",
                                  borderRadius: 4,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                                title={String(currentVal ?? "(empty)")}
                              >
                                {String(currentVal ?? "(empty)")}
                              </div>
                              <span style={{ fontSize: 12, color: "#9494a0", textAlign: "center" }}>&rarr;</span>
                              <input
                                style={{ ...inputStyle, fontSize: 12, padding: "4px 8px" }}
                                value={String(proposedVal ?? "")}
                                onChange={(e) => {
                                  setEditedActions((prev) => ({
                                    ...prev,
                                    [idx]: {
                                      ...prev[idx],
                                      data: { ...prev[idx].data, [key]: e.target.value },
                                    },
                                  }));
                                }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Complete Obligation: show which obligation is being updated */}
                  {isCompleteObligation && obligationLabel && (
                    <div style={{ fontSize: 12, fontWeight: 500, color: "#1a1a1f", marginBottom: 8 }}>
                      Completing: {obligationLabel}
                    </div>
                  )}

                  {/* Non-update actions: standard editable data fields (filtered) */}
                  {!isUpdateEntity && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                      {visibleEntries.map(([key, val]) => {
                        const isCents = CENTS_FIELDS.has(key);
                        const displayVal = isCents ? centsToDisplay(val) : String(val ?? "");
                        return (
                          <div key={key}>
                            <label style={{ fontSize: 10, fontWeight: 600, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                              {getFieldLabel(key)}
                            </label>
                            <input
                              style={{ ...inputStyle, fontSize: 12, padding: "4px 8px" }}
                              value={displayVal}
                              onChange={(e) => {
                                const newVal = isCents ? displayToCents(e.target.value) : e.target.value;
                                setEditedActions((prev) => ({
                                  ...prev,
                                  [idx]: {
                                    ...prev[idx],
                                    data: { ...prev[idx].data, [key]: newVal },
                                  },
                                }));
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Reason — strip UUIDs and (id: ...) references */}
                  <div style={{ fontSize: 12, color: "#6b6b76", fontStyle: "italic" }}>
                    {action.reason
                      .replace(/\s*\(id:\s*[0-9a-f-]{36}\)/gi, "")
                      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "")
                      .replace(/\s{2,}/g, " ")
                      .trim()}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Apply result feedback */}
          {applyResult && (
            <div
              style={{
                marginTop: 12,
                padding: "10px 14px",
                borderRadius: 8,
                background: applyResult.failed > 0 ? "#fef2f2" : "#f0fdf4",
                border: `1px solid ${applyResult.failed > 0 ? "#fecaca" : "#bbf7d0"}`,
                fontSize: 13,
              }}
            >
              <div style={{ fontWeight: 600, color: applyResult.failed > 0 ? "#b91c1c" : "#166534" }}>
                {applyResult.applied > 0 && `${applyResult.applied} change${applyResult.applied !== 1 ? "s" : ""} applied.`}
                {applyResult.failed > 0 && ` ${applyResult.failed} failed.`}
                {applyResult.applied === 0 && applyResult.failed === 0 && applyResult.errors.length > 0 && "Apply failed."}
              </div>
              {applyResult.errors.length > 0 && (
                <div style={{ marginTop: 4, color: "#b91c1c", fontSize: 12 }}>
                  {applyResult.errors.map((e, i) => (
                    <div key={i}>{e}</div>
                  ))}
                </div>
              )}
              <button
                onClick={() => setApplyResult(null)}
                style={{
                  marginTop: 6,
                  background: "none",
                  border: "none",
                  fontSize: 11,
                  color: "#6b6b76",
                  cursor: "pointer",
                  textDecoration: "underline",
                  padding: 0,
                }}
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Apply/Dismiss buttons */}
          <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
            <Button
              onClick={async () => {
                if (aiReviewDocId) {
                  // Mark all actions as reviewed in DB so they don't come back after refresh
                  const allIndices = originalIndicesMap[aiReviewDocId] || [];
                  await fetch(`/api/documents/${aiReviewDocId}/apply`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ actions: [], action_indices: allIndices, dismiss_all: true }),
                  });
                  await onRefresh();
                  setDismissedDocIds((prev) => new Set([...prev, aiReviewDocId]));
                }
                setAiReviewDocId(null);
                setSelectedActions({});
                setEditedActions({});
              }}
            >
              Dismiss
            </Button>
            <Button
              variant="primary"
              onClick={handleApplyActions}
              disabled={applyingActions || Object.values(selectedActions).every((v) => !v)}
            >
              {applyingActions ? "Applying..." : `Apply Selected Changes (${Object.values(selectedActions).filter(Boolean).length})`}
            </Button>
          </div>
        </Card>
      )}

      {/* Document list grouped by category */}
      {documents.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <DocIcon size={32} />
          <div style={{ fontSize: 14, color: "#6b6b76", marginTop: 12, fontWeight: 500 }}>
            No documents uploaded yet
          </div>
          <div style={{ fontSize: 12, color: "#9494a0", marginTop: 4 }}>
            Upload documents to get started with AI-powered extraction
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {Object.entries(DOCUMENT_TYPE_CATEGORIES).map(([catKey, cat]) => {
            const catDocs = grouped[catKey];
            if (!catDocs || catDocs.length === 0) return null;
            const collapsed = collapsedCats.has(catKey);

            return (
              <Card key={catKey} style={{ padding: 0 }}>
                {/* Category header */}
                <div
                  onClick={() => toggleCategory(catKey)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 18px",
                    cursor: "pointer",
                    borderBottom: collapsed ? "none" : "1px solid #f0eee8",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <FolderIcon size={14} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1f" }}>{cat.label}</span>
                    <span
                      style={{
                        fontSize: 11,
                        color: "#9494a0",
                        background: "#f0eee8",
                        padding: "1px 7px",
                        borderRadius: 10,
                        fontWeight: 600,
                      }}
                    >
                      {catDocs.length}
                    </span>
                  </div>
                  <DownIcon
                    size={14}
                    className=""
                  />
                </div>

                {/* Documents in this category */}
                {!collapsed && (
                  <div>
                    {catDocs.map((doc) => {
                      const isExpanded = expandedDocId === doc.id;
                      const extraction = doc.ai_extraction as { summary?: string; actions?: unknown[] } | null;

                      return (
                        <div key={doc.id}>
                          {/* Compact row — hidden when expanded */}
                          <div
                            onClick={() => setExpandedDocId(isExpanded ? null : doc.id)}
                            style={{
                              display: isExpanded ? "none" : "flex",
                              alignItems: "center",
                              gap: 12,
                              padding: "10px 18px",
                              borderBottom: "1px solid #f8f7f4",
                              fontSize: 13,
                              cursor: "pointer",
                              transition: "background 0.1s",
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "#fafaf7")}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                          >
                            <DocIcon size={16} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 500, color: "#1a1a1f", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {doc.name}
                              </div>
                            </div>

                            {/* Tags pill — doc type if not 'other' */}
                            {doc.document_type !== "other" && (
                              <span style={{ fontSize: 10, fontWeight: 600, color: "#3366a8", background: "rgba(51,102,168,0.08)", padding: "2px 8px", borderRadius: 4, whiteSpace: "nowrap" }}>
                                {DOCUMENT_TYPE_LABELS[doc.document_type] || doc.document_type}
                              </span>
                            )}

                            {/* Year pill */}
                            {doc.year && (
                              <span style={{ fontSize: 10, fontWeight: 600, color: "#6b6b76", background: "rgba(0,0,0,0.05)", padding: "2px 8px", borderRadius: 4, whiteSpace: "nowrap" }}>
                                {doc.year}
                              </span>
                            )}

                            {/* AI status */}
                            {doc.ai_extracted && (
                              <span title="AI Processed" style={{ color: "#2d5a3d", flexShrink: 0 }}>
                                <SparkleIcon size={12} />
                              </span>
                            )}

                            {/* Uploaded */}
                            <span style={{ fontSize: 11, color: "#9494a0", whiteSpace: "nowrap" }}>
                              {formatRelativeDate(doc.created_at)}
                            </span>

                            {/* Size */}
                            <span style={{ fontSize: 11, color: "#9494a0", minWidth: 50, textAlign: "right" }}>
                              {formatFileSize(doc.file_size)}
                            </span>

                            {/* Expand indicator */}
                            <div style={{ color: "#9494a0", transition: "transform 0.15s", transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}>
                              <DownIcon size={12} />
                            </div>
                          </div>

                          {/* Expanded detail */}
                          {isExpanded && (
                            <div style={{ padding: "12px 18px 16px", borderBottom: "1px solid #e8e6df", background: "#fafaf7", position: "relative" }}>
                              {/* Collapse button */}
                              <button
                                onClick={() => setExpandedDocId(null)}
                                style={{ position: "absolute", top: 12, right: 18, background: "none", border: "none", cursor: "pointer", color: "#9494a0", padding: 4, display: "flex", alignItems: "center", transition: "color 0.1s" }}
                                onMouseEnter={(e) => (e.currentTarget.style.color = "#1a1a1f")}
                                onMouseLeave={(e) => (e.currentTarget.style.color = "#9494a0")}
                                title="Collapse"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6"/></svg>
                              </button>
                              {/* Document name — inline rename */}
                              <div style={{ marginBottom: 10 }}>
                                {editingDocId === doc.id ? (
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <input
                                      autoFocus
                                      value={editingName}
                                      onChange={(e) => setEditingName(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") handleRename(doc.id);
                                        if (e.key === "Escape") { setEditingDocId(null); setEditingName(""); }
                                      }}
                                      style={{
                                        flex: 1,
                                        fontSize: 14,
                                        fontWeight: 600,
                                        color: "#1a1a1f",
                                        background: "#fff",
                                        border: "1px solid #ddd9d0",
                                        borderRadius: 6,
                                        padding: "4px 8px",
                                        fontFamily: "inherit",
                                        outline: "none",
                                      }}
                                    />
                                    <button
                                      onClick={() => handleRename(doc.id)}
                                      style={{ background: "#2d5a3d", color: "#fff", border: "none", borderRadius: 5, padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
                                    >
                                      Save
                                    </button>
                                    <button
                                      onClick={() => { setEditingDocId(null); setEditingName(""); }}
                                      style={{ background: "none", border: "1px solid #ddd9d0", borderRadius: 5, padding: "4px 10px", fontSize: 12, color: "#6b6b76", cursor: "pointer", fontFamily: "inherit" }}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1f" }}>{doc.name}</span>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setEditingDocId(doc.id); setEditingName(doc.name); }}
                                      title="Rename"
                                      style={{ background: "none", border: "none", cursor: "pointer", color: "#9494a0", padding: 2, display: "flex", alignItems: "center" }}
                                    >
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                                    </button>
                                  </div>
                                )}
                              </div>

                              {/* All tags */}
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                                {doc.document_type !== "other" && (
                                  <span style={{ fontSize: 11, fontWeight: 600, color: "#3366a8", background: "rgba(51,102,168,0.08)", padding: "3px 10px", borderRadius: 4 }}>
                                    {DOCUMENT_TYPE_LABELS[doc.document_type] || doc.document_type}
                                  </span>
                                )}
                                {doc.year && (
                                  <span style={{ fontSize: 11, fontWeight: 600, color: "#6b6b76", background: "rgba(0,0,0,0.05)", padding: "3px 10px", borderRadius: 4 }}>
                                    {doc.year}
                                  </span>
                                )}
                              </div>

                              {/* AI Summary */}
                              {extraction?.summary && (
                                <div style={{ background: "#fff", border: "1px solid #e8e6df", borderRadius: 6, padding: "10px 14px", fontSize: 12, color: "#4a4a52", lineHeight: 1.5, marginBottom: 12 }}>
                                  <div style={{ fontSize: 10, fontWeight: 600, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                                    AI Summary
                                  </div>
                                  {extraction.summary}
                                </div>
                              )}

                              {/* Details */}
                              <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#6b6b76", marginBottom: 12 }}>
                                <span>Size: {formatFileSize(doc.file_size)}</span>
                                <span>Uploaded: {new Date(doc.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}</span>
                              </div>

                              {/* Action buttons */}
                              <div style={{ display: "flex", gap: 8 }}>
                                <button
                                  onClick={() => handleProcess(doc.id)}
                                  disabled={processingId === doc.id}
                                  style={{ background: "none", border: "1px solid #e8e6df", borderRadius: 6, padding: "5px 12px", cursor: processingId === doc.id ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#c47520", fontWeight: 500, fontFamily: "inherit" }}
                                >
                                  <SparkleIcon size={12} />
                                  {processingId === doc.id ? "Processing..." : doc.ai_extracted ? "Re-process with AI" : "Process with AI"}
                                </button>
                                <button
                                  onClick={() => handleDownload(doc.id)}
                                  style={{ background: "none", border: "1px solid #e8e6df", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 12, color: "#3366a8", fontWeight: 500, fontFamily: "inherit" }}
                                >
                                  Download
                                </button>
                                <button
                                  onClick={() => handleDelete(doc.id)}
                                  style={{ background: "none", border: "1px solid #e8e6df", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 12, color: "#c73e3e", fontWeight: 500, fontFamily: "inherit" }}
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---- Entity Action Menu (three-dot dropdown with Edit / Delete) ---- */
function EntityActionMenu({ entityId, entityName, router, isMobile }: { entityId: string; entityName: string; router: ReturnType<typeof useRouter>; isMobile: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleDelete = async () => {
    setOpen(false);
    if (!confirm(`Delete "${entityName}" and all its related data (registrations, members, managers, relationships, documents, cap table)? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/entities/${entityId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to delete entity");
        return;
      }
      router.push("/entities");
    } catch {
      alert("Failed to delete entity");
    }
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((p) => !p)}
        style={{
          background: "none", border: "1px solid #ddd9d0", borderRadius: 6,
          padding: 6, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <EllipsisVerticalIcon size={16} color="#6b6b76" />
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", right: 0, marginTop: 4,
          background: "#ffffff", border: "1px solid #ddd9d0", borderRadius: 8,
          boxShadow: "0 4px 12px rgba(0,0,0,0.1)", minWidth: 160, zIndex: 20,
          overflow: "hidden",
        }}>
          {!isMobile && (
            <button
              onClick={() => { setOpen(false); router.push(`/entities/${entityId}/edit`); }}
              style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%",
                padding: "10px 14px", background: "none", border: "none",
                fontSize: 13, color: "#1a1a1f", cursor: "pointer", fontFamily: "inherit",
                textAlign: "left",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f0efe9")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
            >
              <PencilIcon size={14} color="#6b6b76" /> Edit Entity
            </button>
          )}
          <button
            onClick={handleDelete}
            style={{
              display: "flex", alignItems: "center", gap: 8, width: "100%",
              padding: "10px 14px", background: "none", border: "none",
              borderTop: !isMobile ? "1px solid #f0eee8" : "none",
              fontSize: 13, color: "#c73e3e", cursor: "pointer", fontFamily: "inherit",
              textAlign: "left",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#fdf2f2")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
          >
            <XIcon size={14} /> Delete Entity
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page Component                                                */
/* ------------------------------------------------------------------ */

export default function EntityDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const entityId = params.id as string;

  const isMobile = useIsMobile();

  const [entity, setEntity] = useState<EntityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") || "overview");

  // Documents state
  const [documents, setDocuments] = useState<DocRecord[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);

  // Picklist state
  const [picklist, setPicklist] = useState<PicklistItem[]>([]);
  const [picklistLoading, setPicklistLoading] = useState(false);
  const [picklistLoaded, setPicklistLoaded] = useState(false);

  // Activity state
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
  const [expandedActivityIds, setExpandedActivityIds] = useState<Set<string>>(new Set());

  /* Fetch entity detail */
  const fetchEntity = useCallback(async () => {
    try {
      const res = await fetch(`/api/entities/${entityId}`);
      if (!res.ok) {
        if (res.status === 404) {
          setError("Entity not found");
        } else {
          setError("Failed to load entity");
        }
        return;
      }
      const data = await res.json();
      setEntity(data);
    } catch (err) {
      console.error(err);
      setError("Failed to load entity");
    } finally {
      setLoading(false);
    }
  }, [entityId]);

  /* Fetch picklist (lazy - load once when needed) */
  const fetchPicklist = useCallback(async () => {
    if (picklistLoaded) return;
    setPicklistLoading(true);
    try {
      const res = await fetch("/api/directory/picklist");
      if (res.ok) {
        const data = await res.json();
        setPicklist(data);
      }
    } catch (err) {
      console.error("Failed to load picklist:", err);
    } finally {
      setPicklistLoading(false);
      setPicklistLoaded(true);
    }
  }, [picklistLoaded]);

  /* Fetch activity log for this entity */
  const fetchActivity = useCallback(async () => {
    setActivityLoading(true);
    try {
      const res = await fetch(`/api/audit?entity_id=${entityId}&limit=50`);
      if (res.ok) {
        const data = await res.json();
        setActivityLog(data);
      }
    } catch {
      // Non-critical
    } finally {
      setActivityLoading(false);
    }
  }, [entityId]);

  /* Fetch documents for this entity */
  const fetchDocuments = useCallback(async (quiet = false) => {
    if (!quiet) setDocsLoading(true);
    try {
      const res = await fetch(`/api/entities/${entityId}/documents`);
      if (res.ok) {
        const data = await res.json();
        setDocuments(data);
      }
    } catch (err) {
      console.error("Failed to load documents:", err);
    } finally {
      if (!quiet) setDocsLoading(false);
    }
  }, [entityId]);

  useEffect(() => {
    fetchEntity();
  }, [fetchEntity]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  // Load picklist on mount (lazy)
  useEffect(() => {
    fetchPicklist();
  }, [fetchPicklist]);

  // Fetch activity when tab becomes active
  useEffect(() => {
    if (activeTab === "activity") {
      fetchActivity();
    }
  }, [activeTab, fetchActivity]);

  // Register page context for chat drawer
  const setPageContext = useSetPageContext();
  useEffect(() => {
    if (entity) {
      setPageContext({
        page: "entity_detail",
        entityId: entity.id,
        entityName: entity.name,
      });
    }
    return () => setPageContext(null);
  }, [entity?.id, entity?.name, setPageContext]);

  /* ---- Loading state ---- */
  if (loading) {
    return (
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div
          onClick={() => router.push("/entities")}
          style={{ fontSize: 13, color: "#3366a8", cursor: "pointer", marginBottom: 20, display: "inline-block" }}
        >
          {"\u2190"} Back to Entities
        </div>
        <div style={{ color: "#9494a0", fontSize: 13, marginTop: 24 }}>Loading...</div>
      </div>
    );
  }

  /* ---- Error state ---- */
  if (error || !entity) {
    return (
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div
          onClick={() => router.push("/entities")}
          style={{ fontSize: 13, color: "#3366a8", cursor: "pointer", marginBottom: 20, display: "inline-block" }}
        >
          {"\u2190"} Back to Entities
        </div>
        <div style={{ color: "#c73e3e", fontSize: 14, marginTop: 24 }}>
          {error || "Entity not found"}
        </div>
      </div>
    );
  }

  /* ---- Derived data ---- */
  const typeLabel = ENTITY_TYPE_LABELS[entity.type] || entity.type;
  const formationStateName = getStateLabel(entity.formation_state);
  const additionalRegs = entity.registrations.filter(
    (r) => r.jurisdiction !== entity.formation_state
  );
  const regString = additionalRegs.length > 0
    ? "Reg: " + additionalRegs.map((r) => r.jurisdiction).join(", ")
    : null;

  const relCount = entity.relationships.length;
  const hasCapTable = entity.cap_table.length > 0;

  /* ---- Build tabs ---- */
  const tabs: { id: string; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "compliance", label: "Compliance & Filings" },
  ];
  tabs.push({ id: "cap_table", label: `Cap Table${hasCapTable ? ` (${entity.cap_table.length})` : ""}` });
  tabs.push({ id: "relationships", label: `Relationships (${relCount})` });
  tabs.push({ id: "documents", label: `Documents (${documents.length})` });
  tabs.push({ id: "activity", label: "Activity" });

  /* ---- Handlers for sub-components ---- */
  function handleRegistrationsChange(regs: EntityRegistration[]) {
    setEntity((prev) => (prev ? { ...prev, registrations: regs } : prev));
  }

  function handleCustomFieldsChange(fields: CustomFieldWithValue[]) {
    setEntity((prev) => (prev ? { ...prev, custom_fields: fields } : prev));
  }

  function handleManagersChange(managers: (EntityManager | EntityMember)[]) {
    setEntity((prev) => (prev ? { ...prev, managers: managers as EntityManager[] } : prev));
  }

  function handleMembersChange(members: (EntityManager | EntityMember)[]) {
    setEntity((prev) => (prev ? { ...prev, members: members as EntityMember[] } : prev));
  }

  function handlePartnershipRepsChange(reps: (EntityManager | EntityMember)[]) {
    setEntity((prev) => (prev ? { ...prev, partnership_reps: reps as EntityPartnershipRep[] } : prev));
  }

  function handleRolesChange(roles: EntityRole[]) {
    setEntity((prev) => (prev ? { ...prev, roles } : prev));
  }

  function handleTrustRolesChange(roles: TrustRole[]) {
    setEntity((prev) => (prev ? { ...prev, trust_roles: roles } : prev));
  }

  function handleTrustDetailsChange(details: EntityDetail["trust_details"]) {
    setEntity((prev) => (prev ? { ...prev, trust_details: details } : prev));
  }

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* Back button */}
      <div
        onClick={() => router.push("/entities")}
        style={{
          fontSize: 13,
          color: "#3366a8",
          cursor: "pointer",
          marginBottom: 20,
          display: "inline-block",
          fontWeight: 500,
        }}
      >
        {"\u2190"} Back to Entities
      </div>

      {/* ---- Header ---- */}
      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "stretch" : "center", gap: isMobile ? 12 : 16, marginBottom: 24 }}>
        {/* Entity icon glow box */}
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: "rgba(45,90,61,0.08)",
            border: "1px solid rgba(45,90,61,0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <BuildingIcon size={24} />
        </div>

        <div style={{ flex: 1 }}>
          {/* Entity name row with actions */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h1 style={{ fontSize: isMobile ? 18 : 22, fontWeight: 700, color: "#1a1a1f", margin: 0, lineHeight: 1.2, flex: 1 }}>
              {entity.name}
              {isMobile && (
                <button
                  onClick={() => router.push(`/entities/${entityId}/edit`)}
                  style={{ background: "none", border: "none", cursor: "pointer", padding: 4, marginLeft: 6, verticalAlign: "middle" }}
                >
                  <PencilIcon size={14} color="#9494a0" />
                </button>
              )}
            </h1>
            <EntityActionMenu entityId={entityId} entityName={entity.name} router={router} isMobile={isMobile} />
          </div>

          {/* Subtitle row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 4,
              fontSize: 13,
              color: "#6b6b76",
              flexWrap: "wrap",
            }}
          >
            {entity.short_name && (
              <>
                <span style={{ color: "#2d5a3d", fontWeight: 500 }}>{entity.short_name}</span>
                <span style={{ color: "#ddd9d0" }}>{"\u2022"}</span>
              </>
            )}
            <span>{typeLabel}</span>
            <span style={{ color: "#ddd9d0" }}>{"\u2022"}</span>
            <span>{formationStateName}</span>
            {regString && (
              <>
                <span style={{ color: "#ddd9d0" }}>{"\u2022"}</span>
                <span>{regString}</span>
              </>
            )}
            <span style={{ color: "#ddd9d0" }}>{"\u2022"}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Dot color={entity.status === "active" ? "#2d8a4e" : "#9494a0"} />
              <span style={{ textTransform: "capitalize" }}>{entity.status}</span>
            </span>
          </div>
        </div>
      </div>

      {/* ---- Mobile Section Nav (pill bar) ---- */}
      {isMobile && (
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 10,
            background: "#f5f4f0",
            overflowX: "auto",
            display: "flex",
            gap: 6,
            borderBottom: "1px solid #e8e6df",
            margin: "0 -16px",
            paddingLeft: 16,
            paddingRight: 16,
            paddingTop: 8,
            paddingBottom: 8,
            WebkitOverflowScrolling: "touch",
          }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: "6px 14px",
                borderRadius: 20,
                border: activeTab === tab.id ? "1px solid #2d5a3d" : "1px solid #ddd9d0",
                background: activeTab === tab.id ? "#2d5a3d" : "#fff",
                color: activeTab === tab.id ? "#fff" : "#1a1a1f",
                fontSize: 12,
                fontWeight: 500,
                whiteSpace: "nowrap",
                flexShrink: 0,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* ---- Tab Bar (desktop only) ---- */}
      {!isMobile && (
        <div
          style={{
            borderBottom: "1px solid #e8e6df",
            marginBottom: 24,
            display: "flex",
            gap: 0,
            overflow: "visible",
          }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: "10px 20px",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                border: "none",
                borderBottom: activeTab === tab.id ? "2px solid #2d5a3d" : "2px solid transparent",
                background: "transparent",
                color: activeTab === tab.id ? "#2d5a3d" : "#6b6b76",
                marginBottom: -1,
                whiteSpace: "nowrap",
                fontFamily: "inherit",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* ---- Tab Content ---- */}
      {isMobile && <div style={{ height: 16 }} />}

      {/* Overview Tab */}
      {activeTab === "overview" && (
        <>
          {/* First row: Entity Information + Custom Fields */}
          <div id="overview" style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 20, marginBottom: 20 }}>
            {/* Left: Entity Information */}
            <Card>
              <SectionHeader>Entity Information</SectionHeader>

              <InfoRow label="EIN">
                <span style={{ fontFamily: "'DM Mono', monospace" }}>
                  {entity.ein || "\u2014"}
                </span>
              </InfoRow>

              <InfoRow label="Formed">{formatDate(entity.formed_date)}</InfoRow>

              <InfoRow label="Formation State">{formationStateName}</InfoRow>

              <LegalStructureRow
                entityId={entityId}
                currentValue={entity.legal_structure}
                onUpdate={(val) => setEntity((prev) => (prev ? { ...prev, legal_structure: val } : prev))}
              />

              <InfoRow label="Registered Agent">{entity.registered_agent || "\u2014"}</InfoRow>

              <InfoRow label="Address">{entity.address || "\u2014"}</InfoRow>

              {/* Registration States */}
              <RegistrationStatesRow
                entityId={entityId}
                formationState={entity.formation_state}
                registrations={entity.registrations}
                onRegistrationsChange={handleRegistrationsChange}
              />

              {/* Managers */}
              <PersonRow
                entityId={entityId}
                label="Managers"
                persons={entity.managers}
                apiPath="managers"
                deleteIdKey="manager_id"
                picklist={picklist}
                picklistLoading={picklistLoading}
                onPersonsChange={handleManagersChange}
              />

              {/* Members */}
              <PersonRow
                entityId={entityId}
                label="Members"
                persons={entity.members}
                apiPath="members"
                deleteIdKey="member_id"
                picklist={picklist}
                picklistLoading={picklistLoading}
                onPersonsChange={handleMembersChange}
              />

              {/* Partnership Representative (non-trust only) */}
              {entity.type !== "trust" && (
                <PersonRow
                  entityId={entityId}
                  label="Partnership Rep"
                  persons={entity.partnership_reps}
                  apiPath="partnership-reps"
                  deleteIdKey="partnership_rep_id"
                  picklist={picklist}
                  picklistLoading={picklistLoading}
                  onPersonsChange={handlePartnershipRepsChange}
                />
              )}

              {/* Business Purpose (non-trust only) */}
              {entity.type !== "trust" && (
                <InfoRow label="Business Purpose">
                  {entity.business_purpose || "\u2014"}
                </InfoRow>
              )}

              {/* Other Roles (non-trust only) */}
              {entity.type !== "trust" && (
                <OtherRolesSection
                  entityId={entityId}
                  roles={entity.roles}
                  picklist={picklist}
                  picklistLoading={picklistLoading}
                  onRolesChange={handleRolesChange}
                />
              )}
            </Card>

            {/* Right: Custom Fields */}
            <CustomFieldsCard
              entityId={entityId}
              fields={entity.custom_fields}
              onFieldsChange={handleCustomFieldsChange}
            />
          </div>

          {/* Second row: Relationships Summary + Cap Table Summary */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 20, marginBottom: 20 }}>
            <RelationshipsSummaryCard
              relationships={entity.relationships}
              entityId={entityId}
              onViewAll={() => setActiveTab("relationships")}
            />
            <CapTableSummaryCard
              capTable={entity.cap_table}
              onViewAll={() => setActiveTab("cap_table")}
            />
          </div>

          {/* Trust Details (conditional) */}
          {entity.type === "trust" && entity.trust_details && (
            <div style={{ marginBottom: 20 }}>
              <TrustDetailsCard
                entityId={entityId}
                trustDetails={entity.trust_details}
                trustRoles={entity.trust_roles}
                onTrustRolesChange={handleTrustRolesChange}
                onTrustDetailsChange={handleTrustDetailsChange}
                picklist={picklist}
                picklistLoading={picklistLoading}
              />
            </div>
          )}
        </>
      )}

      {/* Compliance & Filings Tab */}
      {activeTab === "compliance" && (
        <ComplianceTab
          entityId={entityId}
          formationState={entity.formation_state}
          registrations={entity.registrations}
          formedDate={entity.formed_date}
          legalStructure={entity.legal_structure}
          obligations={entity.compliance_obligations || []}
          documents={documents}
          onRegistrationsChange={handleRegistrationsChange}
          onRefresh={fetchEntity}
        />
      )}

      {/* Cap Table Tab */}
      {activeTab === "cap_table" && (
        <CapTableTab entityId={entityId} capTable={entity.cap_table} onRefresh={fetchEntity} picklist={picklist} picklistLoading={picklistLoading} />
      )}

      {/* Relationships Tab */}
      {activeTab === "relationships" && (
        <RelationshipsTab
          relationships={entity.relationships}
          entityId={entityId}
        />
      )}

      {/* Documents Tab */}
      {activeTab === "documents" && (
        <DocumentsTab
          entityId={entityId}
          documents={documents}
          docsLoading={docsLoading}
          onRefresh={fetchDocuments}
          onRefreshQuiet={() => fetchDocuments(true)}
          onEntityRefresh={fetchEntity}
          entityName={entity?.name || ""}
          entityData={entity as unknown as Record<string, unknown>}
        />
      )}

      {/* Activity Tab */}
      {activeTab === "activity" && (
        <div>
          {activityLoading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#9494a0" }}>Loading activity...</div>
          ) : activityLog.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "#9494a0" }}>No activity recorded yet</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {activityLog.map((entry) => {
                const meta = entry.metadata || {};
                const time = new Date(entry.created_at);
                const timeStr = time.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
                  " at " + time.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

                // Build a human-readable description of what happened
                let title = "";
                let detail = "";

                const a = entry.action;
                const rt = entry.resource_type;

                if (a === "create" && rt === "entity") {
                  title = "Entity created";
                  if (meta.name) detail = `${meta.name} (${meta.type || "entity"})`;
                } else if (a === "edit" && rt === "entity") {
                  title = "Entity updated";
                  if (meta.fields) detail = `Changed: ${(meta.fields as string[]).join(", ")}`;
                } else if (a === "delete" && rt === "entity") {
                  title = "Entity deleted";
                  if (meta.name) detail = String(meta.name);
                } else if (a === "create" && rt === "entity_role") {
                  title = `Added role: ${meta.role_title || "role"}`;
                  if (meta.name) detail = String(meta.name);
                } else if (a === "delete" && rt === "entity_role") {
                  title = `Removed role: ${meta.role_title || "role"}`;
                  if (meta.name) detail = String(meta.name);
                } else if (a === "create" && rt === "entity_member") {
                  title = "Added member";
                  if (meta.name) detail = String(meta.name);
                } else if (a === "delete" && rt === "entity_member") {
                  title = "Removed member";
                  if (meta.name) detail = String(meta.name);
                } else if (a === "create" && rt === "entity_manager") {
                  title = "Added manager";
                  if (meta.name) detail = String(meta.name);
                } else if (a === "delete" && rt === "entity_manager") {
                  title = "Removed manager";
                  if (meta.name) detail = String(meta.name);
                } else if (a === "create" && rt === "entity_registration") {
                  title = "Added registration";
                  if (meta.jurisdiction) detail = String(meta.jurisdiction);
                } else if (a === "edit" && rt === "entity_registration") {
                  title = "Updated registration";
                  if (meta.jurisdiction) detail = String(meta.jurisdiction);
                } else if (a === "delete" && rt === "entity_registration") {
                  title = "Removed registration";
                  if (meta.jurisdiction) detail = String(meta.jurisdiction);
                } else if (a === "upload" && rt === "document") {
                  title = "Uploaded document";
                  if (meta.document_name) detail = `${meta.document_name}${meta.document_type ? ` (${meta.document_type})` : ""}`;
                } else if (a === "delete" && rt === "document") {
                  title = "Deleted document";
                  if (meta.document_name) detail = `${meta.document_name}${meta.document_type ? ` (${meta.document_type})` : ""}`;
                } else if (a === "download" && rt === "document") {
                  title = "Downloaded document";
                  if (meta.name) detail = String(meta.name);
                } else if (a === "apply_extraction") {
                  const applied = meta.applied as number || 0;
                  const failed = meta.failed as number || 0;
                  title = `Applied AI extraction (${applied} change${applied !== 1 ? "s" : ""}${failed > 0 ? `, ${failed} failed` : ""})`;
                  if (Array.isArray(meta.changes) && meta.changes.length > 0) {
                    // detail handled as expandable list below
                  }
                } else if (a === "dismiss_extraction") {
                  title = "Dismissed AI suggestions";
                } else if (a === "process") {
                  title = "Processed document with AI";
                  if (meta.action_count) detail = `${meta.action_count} changes proposed`;
                } else if (a === "approve" && rt === "pipeline_item") {
                  title = "Approved pipeline item";
                  if (meta.actions_applied) detail = `${meta.actions_applied} change${meta.actions_applied !== 1 ? "s" : ""} applied`;
                } else if (a === "edit" && rt === "trust_details") {
                  title = "Updated trust details";
                  if (meta.fields_updated) detail = `Changed: ${(meta.fields_updated as string[]).join(", ")}`;
                } else if (a === "create" && rt === "trust_role") {
                  title = `Added trust role: ${meta.role || "role"}`;
                  if (meta.name) detail = String(meta.name);
                } else if (a === "delete" && rt === "trust_role") {
                  title = `Removed trust role: ${meta.role || "role"}`;
                  if (meta.name) detail = String(meta.name);
                } else if (a === "create" && rt === "cap_table_entry") {
                  title = "Added cap table entry";
                  if (meta.investor_name) detail = String(meta.investor_name);
                } else if (a === "delete" && rt === "cap_table_entry") {
                  title = "Removed cap table entry";
                  if (meta.investor_name) detail = String(meta.investor_name);
                } else if (a === "create" && rt === "partnership_rep") {
                  title = "Added partnership representative";
                  if (meta.name) detail = String(meta.name);
                } else if (a === "delete" && rt === "partnership_rep") {
                  title = "Removed partnership representative";
                  if (meta.name) detail = String(meta.name);
                } else if (a === "create" && rt === "custom_field") {
                  title = "Added custom field";
                  if (meta.field_name) detail = String(meta.field_name);
                } else if (a === "edit" && rt === "custom_field") {
                  title = "Updated custom field";
                } else if (a === "delete" && rt === "custom_field") {
                  title = "Removed custom field";
                } else if (a === "update_obligation" || (a === "edit" && rt === "compliance_obligation")) {
                  title = "Updated compliance obligation";
                  if (meta.status) detail = `Status: ${meta.status}`;
                } else if (a === "create" && rt === "relationship") {
                  title = "Created relationship";
                } else if (a === "upload" && rt === "pipeline") {
                  title = "Uploaded documents via pipeline";
                  if (meta.file_count) detail = `${meta.file_count} file${meta.file_count !== 1 ? "s" : ""}`;
                } else {
                  // Fallback
                  title = `${a} ${rt}`.replace(/_/g, " ");
                }

                const changes = Array.isArray(meta.changes) ? (meta.changes as string[]) : [];
                const isExpandable = changes.length > 0;
                const isExpanded = expandedActivityIds.has(entry.id);

                return (
                  <div
                    key={entry.id}
                    onClick={isExpandable ? () => setExpandedActivityIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(entry.id)) next.delete(entry.id);
                      else next.add(entry.id);
                      return next;
                    }) : undefined}
                    style={{
                      padding: "12px 0",
                      borderBottom: "1px solid #e8e6df",
                      cursor: isExpandable ? "pointer" : undefined,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: "#1a1a1f", fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>
                          {isExpandable && (
                            <span style={{ fontSize: 10, color: "#9494a0", transition: "transform 0.15s", transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}>&#9654;</span>
                          )}
                          {title}
                        </div>
                        {detail && (
                          <div style={{ fontSize: 12, color: "#6b6b76", marginTop: 2, lineHeight: 1.4, paddingLeft: isExpandable ? 16 : 0 }}>
                            {detail}
                          </div>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: "#9494a0", whiteSpace: "nowrap", flexShrink: 0 }}>
                        {timeStr}
                      </div>
                    </div>
                    {isExpanded && (
                      <div style={{ paddingLeft: 16, marginTop: 6 }}>
                        {changes.map((c, i) => (
                          <div key={i} style={{ fontSize: 12, color: "#6b6b76", padding: "2px 0", lineHeight: 1.4 }}>
                            &bull; {c}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
