# Smoke Test Results — Org-Scoped Admin Wrapper Migration

**Environment:** `http://localhost:3000` (local dev → real database), logged in as **Sean Doherty Jr**, org **Ridge Capital Management**.
**Date run:** Jun 7, 2026
**Console/Network:** No Rhodes app errors or `500`/`4xx` on any page or action — only the generic browser-extension "message channel closed" noise (ignored).

## Verdict

**The app looks healthy for the logged-in user — no over-scoping and no server errors.** Every list and detail page that should have data **does** (entities, documents, investments, compliance, per-entity tabs, provider record), including the trickiest migrated sub-sections (investment ownership / internal allocations / transactions). No page came back empty or threw. The migration looks safe from a normally-logged-in user's perspective.

## Results

| Test # | Name | Result | Notes |
|--------|------|--------|-------|
| 1 | Home / dashboard loads | **PASS** | `/` → `/entities`; **25 entities** populated, "15 overdue · 1 due soon" filing notice (normal), no error banner. |
| 2 | Documents list (`GET /api/documents`) | **PASS** | **Non-empty** — dozens of docs (Ledger, K-1s, P&L, Distribution, etc.) with **ENTITY names populated** (44 Holdings, Emma Doherty, John Patrick Doherty…), tags/dates/sizes; "Suggested sends" present. |
| 3 | Document detail (`GET /api/documents/[id]`) | **PASS** | Row expands to metadata (tags, size 74.8 KB, uploaded date, type application/pdf, Download/Delete). |
| 4 | Download (`GET /api/documents/[id]/download`) | **PASS** | Endpoint returns a **redirect to a signed URL** (verified: `opaqueredirect`, i.e. 3xx — not 404/500/"not found"). No error. |
| 5 | Rename (`PATCH /api/documents/[id]`) | **PASS** | Edited "44 Holdings LLC AppLovin Shares Distribution" → "… (smoke test)" via the rename form, saved & persisted; then **reverted** to the original. No error. |
| 6 | Investments list + detail (`/api/investments`, `/api/investments/[id]`) | **PASS** | List: **10 active deals, $11.2M invested** (16043 Temecula, Demetree Mainstream $6.5M, etc.). Detail (Demetree Mainstream): the **trickiest migrated sub-sections are all populated** — Ownership (RCM Mainstream LLC · 11.207% · $6.5M), Internal Allocations (Leslie Doherty 30.77%, The 15071 Trust 30.77%, Valley One 23.08%, South Jameson 15.39% = 100%), and Transactions (4 contributions: $1M / $1.5M / $2M ×2). No blanks. |
| 7 | Compliance (`/api/compliance/profiles`, `/api/compliance/overrides`) | **PASS** (read) | Page loads **fully populated**: 10 Overdue · 2 Upcoming · 16 Completed, with per-entity obligations (statuses, amounts, jurisdictions). *Override **write** not completed — see note below; the override **read** path is healthy.* |
| 8 | Entities + per-entity tabs | **PASS** | RCM Mainstream LLC: **Documents (15)** completeness checklist, **Compliance** filings by jurisdiction (DE/CA/Federal with statuses), **Investments** (2 deals, $7.2M), plus Cap Table (4) / Relationships (1) / People — all load their data, none blank or errored. |
| 9 | (Optional) Delete throwaway doc | **BLOCKED** | No document named `SAFE TO DELETE` exists (searched — "No documents found"). Skipped per the plan. |
| 10 | Service Providers (`/api/service-providers/[id]/entities`) | **PASS** | Andersen provider record loads with **ENTITIES SERVED: All entities**, domains, default recipient, contacts — the linked-entities route resolves and renders, no error. |

**Totals: 8 PASS · 0 FAIL · 1 BLOCKED · 1 PASS-with-note (T7 override write not run).**

## FAILs
**None.** No empty/over-scoped page, no missing entity/investment names, no 500/4xx, no error toast/banner on any tested route.

## Notes / couldn't fully exercise
1. **Compliance override *write* (T7) not completed.** The override action is "select obligation(s) → **Exempt**" (a bulk action; the row checkbox is multi-select). Clicking **Exempt** triggers a **native browser `confirm()` dialog**, which freezes the page for automation (same blocker seen on Delete/Revoke elsewhere). I **cancelled** it rather than confirm, because marking a real obligation "Exempt" creates a compliance override I couldn't be sure I'd cleanly reverse on real data. The override **read** path is healthy (the page loads fully populated, no error). *Recommend an in-app confirm modal so Exempt/override is scriptable and testable.*
2. **T10 providers all serve "All entities."** Both remaining providers (Andersen, Bartlett) serve all entities, so the linked-entities route returned "All entities" rather than a specific list. The route resolves without error, but a provider linked to *specific* entities would exercise the per-entity scoping more directly. (The QA-prefixed provider that had a single linked entity was deleted in an earlier test's cleanup.)

## Overall
No regressions surfaced for the logged-in user. The two failure modes the migration was most at risk of — **over-scoping (empty/missing data)** and **500s** — did not appear anywhere: every scoped list and detail (documents, investments incl. allocations/transactions, compliance, per-entity tabs, provider entities) returned the expected, populated data, and no action threw. The only thing left untested is the compliance-override *write*, blocked by a native confirm dialog rather than any server error.

## Test-data note
The one edit performed (document rename, T5) was **fully reverted**. No deletes, sends, shares, invites, or password changes were made. The compliance Exempt write was **cancelled** (no override created; the obligation remains "Pending").
