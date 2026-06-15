"use client";

/**
 * Onboarding — a context-seeding stepper (UX refresh Phase 8). Name your
 * organization → add your first documents (or start in chat) → watch Rhodes
 * read them → a "here's what Rhodes set up" payoff that hands off into Home.
 * No SSN/EIN up front; the agent discovers entities from the documents. Lands
 * on /home (not /entities), so the freshly-created work is right there.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { UploadDropZone } from "@/components/pipeline/UploadDropZone";
import { ProcessingRow, type ProcessingItem } from "@/components/pipeline/ProcessingRow";
import { DOCUMENT_TYPE_LABELS } from "@/lib/constants";

type Step = "org" | "add" | "progress" | "done";

interface BatchItem {
  id: string;
  status: string;
  original_filename: string;
  ai_suggested_name: string | null;
  ai_document_type: string | null;
  staged_doc_type: string | null;
  extraction_error: string | null;
  created_at: string;
}
interface BatchSummary {
  total_items: number;
  auto_ingested: number;
  needs_review: number;
  approved: number;
  errors: number;
  processing: number;
  entities_affected: { entity_id: string | null; entity_name: string }[];
}

const STEP_LABELS: { key: Step; label: string }[] = [
  { key: "org", label: "Organization" },
  { key: "add", label: "Documents" },
  { key: "done", label: "All set" },
];
function stepIndex(s: Step): number {
  if (s === "org") return 0;
  if (s === "done") return 2;
  return 1; // add + progress are one visible step
}

function docTypeLabel(slug: string | null): string | null {
  if (!slug) return null;
  return DOCUMENT_TYPE_LABELS[slug] || slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function toProcessingItem(it: BatchItem): ProcessingItem {
  return {
    id: it.id,
    document_name: it.ai_suggested_name || it.original_filename || "Document",
    status: it.status,
    entity_name: null,
    document_type_label: docTypeLabel(it.ai_document_type || it.staged_doc_type),
    source: "Onboarding",
    created_at: it.created_at,
    extraction_error: it.extraction_error,
  };
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("org");
  const [orgName, setOrgName] = useState("");
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [orgError, setOrgError] = useState("");
  const [batchId, setBatchId] = useState<string | null>(null);

  const [items, setItems] = useState<BatchItem[]>([]);
  const [summary, setSummary] = useState<BatchSummary | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Skip the org step if the user already has one; prefill otherwise.
  useEffect(() => {
    fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).then((u) => {
      if (!u) return;
      if (u.orgId) setStep("add");
      else if (u.display_name) setOrgName(`${u.display_name.split(" ")[0]}'s Organization`);
    }).catch(() => {});
  }, []);

  // Create the onboarding batch when we reach the "add" step.
  useEffect(() => {
    if (step !== "add" || batchId) return;
    fetch("/api/pipeline/batches", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: "onboarding", entity_discovery: true, name: "Onboarding Upload" }),
    }).then((r) => (r.ok ? r.json() : null)).then((b) => { if (b) setBatchId(b.id); }).catch(() => {});
  }, [step, batchId]);

  const createOrg = async () => {
    const trimmed = orgName.trim();
    if (!trimmed) { setOrgError("Please enter a name for your organization."); return; }
    setCreatingOrg(true); setOrgError("");
    try {
      const res = await fetch("/api/organizations", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); setOrgError(e.error || "Failed to create organization."); return; }
      setStep("add");
    } catch { setOrgError("Something went wrong. Please try again."); }
    finally { setCreatingOrg(false); }
  };

  const pollBatch = useCallback(async () => {
    if (!batchId) return;
    try {
      const res = await fetch(`/api/pipeline/batches/${batchId}`);
      if (!res.ok) return;
      const data = await res.json();
      setItems(Array.isArray(data.items) ? data.items : []);
      setSummary(data.summary ?? null);
    } catch { /* keep last */ }
  }, [batchId]);

  // After files are uploaded: kick off processing and move to the progress step.
  const onFilesUploaded = async () => {
    if (!batchId) return;
    try { await fetch(`/api/pipeline/batches/${batchId}/process`, { method: "POST" }); } catch { /* ignore */ }
    setStep("progress");
  };

  // Poll while on the progress step; auto-advance to the payoff when settled.
  useEffect(() => {
    if (step !== "progress") return;
    let stop = false;
    const tick = () => pollBatch().finally(() => { if (!stop) pollRef.current = setTimeout(tick, 2500); });
    tick();
    return () => { stop = true; if (pollRef.current) clearTimeout(pollRef.current); };
  }, [step, pollBatch]);

  useEffect(() => {
    if (step === "progress" && summary && summary.total_items > 0 && summary.processing === 0) {
      setStep("done");
    }
  }, [step, summary]);

  const goHome = () => router.push("/home");
  const startInChat = () => { window.dispatchEvent(new CustomEvent("rhodes:open-chat")); router.push("/home"); };

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "40px 20px" }}>
      <Stepper current={step} />

      {step === "org" && (
        <Centered title="Name your organization" subtitle="An organization is how Rhodes groups your entities, documents, and team. You can invite others later.">
          <div style={{ maxWidth: 420, margin: "0 auto" }}>
            <input
              type="text" value={orgName} autoFocus
              onChange={(e) => { setOrgName(e.target.value); setOrgError(""); }}
              onKeyDown={(e) => e.key === "Enter" && createOrg()}
              placeholder="e.g. Doherty Family Office"
              style={{ width: "100%", boxSizing: "border-box", padding: "12px 16px", fontSize: 15, border: "1px solid var(--line-2)", borderRadius: "var(--radius-sm)", outline: "none", background: "var(--card)", color: "var(--ink)" }}
            />
            {orgError && <div style={{ color: "var(--red)", fontSize: 13, marginTop: 8, textAlign: "left" }}>{orgError}</div>}
            <div style={{ marginTop: 20 }}>
              <Button variant="primary" onClick={createOrg} disabled={creatingOrg} style={{ padding: "11px 26px", fontSize: 14 }}>
                {creatingOrg ? "Creating…" : "Continue"}
              </Button>
            </div>
          </div>
        </Centered>
      )}

      {step === "add" && (
        <div>
          <Centered title="Add your first documents" subtitle="Drop in operating agreements, tax returns, K-1s, formation docs — anything about your entities. Rhodes reads them, identifies your entities, and files everything. No SSNs needed.">
            {batchId ? (
              <UploadDropZone batchId={batchId} onFilesUploaded={onFilesUploaded} />
            ) : (
              <div style={{ color: "var(--faint)", fontSize: 13, padding: 20 }}>Preparing…</div>
            )}
            <div style={{ display: "flex", gap: 14, justifyContent: "center", alignItems: "center", marginTop: 20 }}>
              <button onClick={startInChat} style={linkBtn}><Icon name="message" size={15} /> Start in chat instead</button>
              <span style={{ color: "var(--faint)" }}>·</span>
              <button onClick={goHome} style={linkBtn}>Skip for now</button>
            </div>
          </Centered>
        </div>
      )}

      {step === "progress" && (
        <div>
          <Centered title="Reading your documents…" subtitle="Rhodes is extracting key data and matching everything to the right entities. This takes a moment — you can leave and we'll keep working.">
            <></>
          </Centered>
          <div style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--card)", padding: "4px 16px" }}>
            {items.length === 0 ? (
              <div style={{ color: "var(--faint)", fontSize: 13, padding: 20, textAlign: "center" }}>Getting started…</div>
            ) : (
              items.map((it) => <ProcessingRow key={it.id} item={toProcessingItem(it)} />)
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "center", marginTop: 20 }}>
            <button onClick={goHome} style={linkBtn}>Leave it running — take me Home</button>
          </div>
        </div>
      )}

      {step === "done" && summary && (
        <Centered title="Here's what Rhodes set up" subtitle="Your world is in Rhodes. Anything that needs a decision is waiting for you on Home.">
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginBottom: 24 }}>
            <StatTile n={summary.entities_affected.length} label={summary.entities_affected.length === 1 ? "entity set up" : "entities set up"} color="var(--green)" />
            <StatTile n={summary.auto_ingested + summary.approved} label="documents filed" color="var(--blue)" />
            {summary.needs_review > 0 && <StatTile n={summary.needs_review} label="need your review" color="var(--amber)" />}
            {summary.errors > 0 && <StatTile n={summary.errors} label="need attention" color="var(--red)" />}
          </div>

          {summary.entities_affected.length > 0 && (
            <div style={{ maxWidth: 460, margin: "0 auto 24px", textAlign: "left", border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--card)", padding: "8px 16px" }}>
              {summary.entities_affected.map((e, i) => (
                <div key={e.entity_id ?? i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: i === 0 ? "none" : "1px solid var(--line)" }}>
                  <Icon name="building" size={16} color="var(--green)" />
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>{e.entity_name}</span>
                </div>
              ))}
            </div>
          )}

          <Button variant="primary" onClick={goHome} style={{ padding: "11px 28px", fontSize: 14 }}>Go to Home</Button>
        </Centered>
      )}
    </div>
  );
}

const linkBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--muted)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0 };

function Stepper({ current }: { current: Step }) {
  const idx = stepIndex(current);
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 36 }}>
      {STEP_LABELS.map((s, i) => {
        const done = i < idx, active = i === idx;
        return (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 22, height: 22, borderRadius: 999, display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700, background: done ? "var(--green)" : active ? "var(--green)" : "var(--line)", color: done || active ? "#fff" : "var(--muted)" }}>
                {done ? <Icon name="check" size={13} /> : i + 1}
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: active ? "var(--ink)" : "var(--faint)" }}>{s.label}</span>
            </div>
            {i < STEP_LABELS.length - 1 && <span style={{ width: 28, height: 1, background: "var(--line)" }} />}
          </div>
        );
      })}
    </div>
  );
}

function Centered({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 26, fontWeight: 700, color: "var(--ink)", marginBottom: 10, letterSpacing: "-0.02em" }}>{title}</div>
      <p style={{ fontSize: 14.5, color: "var(--muted)", maxWidth: 520, margin: "0 auto 28px", lineHeight: 1.6 }}>{subtitle}</p>
      {children}
    </div>
  );
}

function StatTile({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <div style={{ minWidth: 120, border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--card)", padding: "14px 18px" }}>
      <div style={{ fontSize: 26, fontWeight: 700, color }}>{n}</div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{label}</div>
    </div>
  );
}
