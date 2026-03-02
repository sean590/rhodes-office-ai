# Document Pipeline Testing Plan

## Pre-requisites

1. **Apply migration**: Run `007_document_pipeline.sql` against your Supabase instance
2. **Verify seed data**: Check `document_types` table has ~54 rows: `SELECT count(*) FROM document_types;`
3. **Verify schema changes**: Confirm `documents.entity_id` is now nullable: `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'documents' AND column_name = 'entity_id';`
4. **Start dev server**: `pnpm dev`

---

## Test 1: Migration & Schema

- [ ] Run `007_document_pipeline.sql` — should complete without errors
- [ ] Verify `document_types` table exists with `is_seed = true` rows
- [ ] Verify `document_queue` table exists with `queue_status` enum
- [ ] Verify `document_batches` table exists with `batch_status` enum
- [ ] Verify `documents` table has new columns: `jurisdiction`, `direction`, `source_page_range`, `source_document_id`, `k1_recipient`
- [ ] Verify `documents.entity_id` is nullable
- [ ] Verify `documents.document_type` is now TEXT (not the old enum)
- [ ] Verify RLS policies exist on all new tables (check Supabase dashboard → Authentication → Policies)
- [ ] Verify existing documents still load correctly on `/documents` page

---

## Test 2: Global Documents Page — Upload Flow

### 2a. Start Upload
- [ ] Navigate to `/documents`
- [ ] Click "Upload Documents" button
- [ ] Verify the UploadDropZone appears (dashed border area)
- [ ] Click "Upload Documents" again to toggle it off — verify it closes

### 2b. File Upload
- [ ] Click "Upload Documents" to open
- [ ] Click the drop zone to select files (pick 3-5 mixed types: a PDF, an image, a text file)
- [ ] Verify files upload with progress indicators
- [ ] Verify instant filename classifications appear (type, category columns)
- [ ] Verify the staging table appears after upload

### 2c. Drag & Drop
- [ ] Drag files into the drop zone
- [ ] Verify the border highlights on drag-over
- [ ] Verify files upload on drop

### 2d. Staging Review
- [ ] Verify each uploaded file shows in the staging table
- [ ] Click a document type dropdown — verify it shows available types
- [ ] Change a document type — verify it saves (check network tab for PATCH request)
- [ ] If entities exist, verify the entity dropdown works
- [ ] Change the year field — verify it saves

### 2e. Multi-batch Upload
- [ ] Upload 3 files
- [ ] Drop 2 more files into the upload zone
- [ ] Verify all 5 appear in staging (not just the latest 2)

### 2f. Duplicate Detection
- [ ] Upload a file
- [ ] Upload the exact same file again
- [ ] Verify it's flagged as a duplicate and skipped

---

## Test 3: Processing & Extraction

### 3a. Start Processing
- [ ] After staging some files, click "Process All"
- [ ] Verify the UI transitions to the ProcessingProgress view
- [ ] Verify items show "Queued" then transition to "Extracting..."
- [ ] Verify progress bar advances

### 3b. Extraction Results
- [ ] Wait for extraction to complete (30-120 seconds depending on file count)
- [ ] Verify items transition to "Ready for review"
- [ ] Verify each item shows: AI-suggested name, document type, year, summary
- [ ] Verify Approve/Reject buttons appear for each item

### 3c. Approve Single Item
- [ ] Click "Approve" on one item
- [ ] Verify it transitions to "Approved"
- [ ] Navigate to `/documents` — verify the approved document appears in the list
- [ ] If entity was identified, verify the document is linked to the correct entity

### 3d. Reject Item
- [ ] Click "Reject" on one item
- [ ] Verify it transitions to "Rejected"
- [ ] Verify it does NOT appear in the documents list

### 3e. Approve All
- [ ] If multiple items are "Ready for review", click "Approve All"
- [ ] Verify all eligible items are approved
- [ ] Verify approved documents appear in the documents list

### 3f. Error Handling
- [ ] Upload a corrupt/unreadable file (e.g., a .exe renamed to .pdf)
- [ ] Verify it transitions to "Error" status with an error message
- [ ] Verify the "Retry" button appears
- [ ] Click "Retry" — verify it re-queues the item

### 3g. Done
- [ ] After all items are approved/rejected, verify "Done" button appears
- [ ] Click "Done" — verify the upload panel closes and documents list refreshes

---

## Test 4: Entity Detail Page — Documents Tab

### 4a. Entity Upload
- [ ] Navigate to an entity detail page → Documents tab
- [ ] Click "Upload Documents"
- [ ] Verify UploadDropZone appears
- [ ] Upload 2-3 files
- [ ] Verify staging table appears with entity pre-filled (no entity column shown)
- [ ] Verify `showEntityColumn=false` — the entity dropdown should NOT be visible

### 4b. Process & Approve
- [ ] Click "Process All"
- [ ] Verify processing progress appears
- [ ] After extraction, approve items
- [ ] Verify documents appear in the entity's document list
- [ ] Verify documents have `entity_id` set to the current entity

### 4c. Existing Features Still Work
- [ ] Verify single-document AI processing still works (expand a document → "Process with AI")
- [ ] Verify the AI Review Panel still works (proposed actions, accept/reject)
- [ ] Verify document download works
- [ ] Verify document delete works
- [ ] Verify document rename works
- [ ] Verify document filters work (category pills, search)

---

## Test 5: Onboarding Flow

### 5a. Welcome Page
- [ ] Navigate to `/onboarding`
- [ ] Verify welcome page shows: "Welcome to Rhodes" heading
- [ ] Verify "Upload Documents" and "Skip to Dashboard" buttons exist

### 5b. Upload Phase
- [ ] Click "Upload Documents"
- [ ] Verify UploadDropZone appears
- [ ] Upload 3-5 documents (mix of types)
- [ ] Verify staging review appears with entity column visible

### 5c. Entity Discovery
- [ ] If uploaded documents contain entity names (e.g., "Operating Agreement - Acme LLC.pdf")
- [ ] After processing, verify Entity Discovery cards appear
- [ ] Click "Create Entity" on a discovered entity
- [ ] Verify entity is created and queue items are linked to it
- [ ] Click "Skip" on another discovered entity — verify it disappears

### 5d. Processing Progress Page
- [ ] Click "Process All" in staging
- [ ] Verify redirect to `/onboarding/{batchId}/progress`
- [ ] Verify processing progress with individual item status
- [ ] After completion, click "Go to Dashboard"
- [ ] Verify redirect to `/entities`

---

## Test 6: PDF Processing Tiers

### 6a. Short PDF (≤50 pages)
- [ ] Upload a short PDF (1-10 pages, like a K-1 or certificate)
- [ ] Verify extraction succeeds with full visual + text analysis

### 6b. Medium PDF (51-100 pages)
- [ ] Upload a medium-length PDF (e.g., a detailed operating agreement)
- [ ] Verify extraction succeeds — check that text extraction + selective visual pages were used

### 6c. Long PDF (>100 pages)
- [ ] Upload a PDF with 100+ pages (e.g., a full tax package)
- [ ] Verify extraction succeeds with the tiered strategy
- [ ] Verify the document type-specific page strategy was applied

---

## Test 7: Composite Document Detection

- [ ] Upload a file named "Tax Package 2024.pdf" (or similar composite-eligible name)
- [ ] Process the file
- [ ] If AI detects sub-documents, verify:
  - [ ] Parent item shows in the list
  - [ ] Child items appear nested under the parent (indented with left border)
  - [ ] Each child has its own document type, year, and K-1 recipient
  - [ ] Each child can be individually approved/rejected
  - [ ] Approving a child creates a separate document record

---

## Test 8: Direction Indicators

- [ ] Upload documents with clear direction:
  - "Capital Call Notice.pdf" → should show as "issued"
  - "K-1 2024.pdf" → should show as "received"
  - "Certificate of Insurance.pdf" → should show as "received"
- [ ] Verify direction is captured in staging review
- [ ] After approval, verify `direction` field is set on the document record

---

## Test 9: Existing Functionality Regression

### 9a. Documents Page
- [ ] Existing documents still display correctly
- [ ] Category filter pills still work
- [ ] Search still works
- [ ] Expanded row shows AI summary, tags, download/delete/process buttons
- [ ] Single-doc AI Process still works
- [ ] AI Result Banner (create entity + redirect) still works

### 9b. Entity Detail Page
- [ ] All 5 tabs load correctly (Overview, Compliance, Cap Table, Relationships, Documents)
- [ ] AI Review Panel for individual documents still works (accept/reject actions)
- [ ] Document list, filters, and actions still work
- [ ] All other entity features unchanged

### 9c. AI Chat
- [ ] Chat still works with streaming
- [ ] Entity name linking still works in chat responses

---

## Known Limitations / Deferred Items

These are NOT bugs — they're deferred Stage 8 features:

1. **Dynamic document type management UI** — no settings page for managing types yet
2. **Composite document PDF splitting** — no "Split into Files" button yet
3. **Document type duplicate normalization** — no fuzzy matching/merge for AI-created types
4. **Serverless deployment** — the fire-and-forget processing pattern works well on long-running servers but may time out on serverless platforms (Vercel hobby tier). Consider edge functions or background jobs for production.

---

## Quick Smoke Test (5 minutes)

If you're short on time, do this minimal path:

1. Apply migration
2. Go to `/documents` → click "Upload Documents"
3. Upload 2 PDF files
4. Verify staging table shows classifications
5. Click "Process All"
6. Wait for extraction → Approve both
7. Verify documents appear in the list
8. Go to an entity → Documents tab → verify existing docs still load
