# Smoke Test — Org-Scoped Admin Wrapper Migration

**For: Claude in Chrome (browser agent).** Follow this top to bottom and produce
the report at the end. You are verifying that a backend security change did not
break the app for a normally-logged-in user.

## What changed (context, not a task)
We migrated 13 API routes to a new database wrapper that automatically scopes
every query to the logged-in user's organization. The two ways this could have
gone wrong, and what you're hunting for:

1. **Over-scoping** — a list or detail page that is **empty or missing rows**
   that should be there. This is the #1 thing to catch. If you know the account
   has documents/investments/entities and a page shows none, that's a FAIL.
2. **Server errors (500s)** — any page or action that throws, shows an error
   toast/banner, a "Something went wrong", or a failed network request.

## Base URL
`http://localhost:3000`  (a local dev server — it talks to the real database)

## Ground rules (important)
- **Do NOT delete anything, do NOT permanently remove records.** The one
  exception is Test 9, and only if its precondition is met.
- **Do NOT change passwords, send anything to anyone, or hit "send"/"share"/
  "invite" buttons.**
- **Edits:** where asked to edit, make a tiny reversible change (e.g. append
  " (smoke test)" to a name), confirm it saves, then **change it back**.
- You are **reporting, not fixing.** If something fails, capture the page URL,
  what you did, what you expected, what happened (and any visible error text or
  console error), and move on to the next test.
- If you can open Chrome DevTools, keep the **Console** and **Network** tabs in
  view and note any red `500`/`4xx` (other than expected `401` before login) or
  console exceptions tied to an action.

## Precondition
You must be **logged in**. Go to `http://localhost:3000`.
- If you land on a login screen, stop and tell the user: "I need you to log in
  first, then say continue." Do not attempt to enter credentials yourself.
- Once logged in, confirm you can see the main app (a dashboard / home with
  navigation). Note the organization name shown, if any.

---

## Tests

For each test, record one of: **PASS**, **FAIL**, or **BLOCKED** (couldn't reach
it — say why).

### 1. Home / dashboard loads
- Navigate to `http://localhost:3000`.
- **Expected:** the home/dashboard renders with content; no error banner.
- Record the result.

### 2. Documents list (route: `GET /api/documents`)
- Go to the **Documents** page (use the nav).
- **Expected:** a list of documents appears with names, types, dates. If the
  account is established, this should be **non-empty**. Columns like entity or
  investment names should be populated where applicable.
- **FAIL if:** the list is empty (and you have reason to believe docs exist), or
  rows are missing their entity/investment name, or the page errors.
- Record how many documents are visible (approx).

### 3. Open a document's detail (route: `GET /api/documents/[id]`)
- Click into one document.
- **Expected:** its detail/metadata loads.
- Record the result.

### 4. Download a document (route: `GET /api/documents/[id]/download`)
- From a document, click **Download** (or the download icon).
- **Expected:** the file begins downloading (or opens in a new tab). No error.
- **FAIL if:** you get "Document not found", "Failed to generate download URL",
  or any error.
- You don't need to keep the file. Record the result.

### 5. Rename a document (route: `PATCH /api/documents/[id]`)
- Use the document's **edit menu / edit form** (NOT inline cell editing — this
  app edits through a centralized menu/form).
- Append " (smoke test)" to the name and save.
- **Expected:** it saves and the new name shows.
- Then **rename it back** to the original.
- Record the result.

### 6. Investments list + detail (routes: `/api/investments`, `/api/investments/[id]`)
- Go to the **Investments** page.
- **Expected:** investments list loads; non-empty if the account has any. Each
  row should show its data (name, amounts, investors where shown).
- Open **one investment** to its detail page.
- **Expected:** detail loads, including investors / transactions / allocations
  sections if present — these come from the trickiest part of the migration, so
  look closely that they are populated, not blank.
- **FAIL if:** list empty when investments exist, or a detail sub-section that
  should have data is empty, or any error.
- Record approx count + whether detail sub-sections populated.

### 7. Compliance (routes: `/api/compliance/profiles`, `/api/compliance/overrides`)
- Go to the **Compliance** area (may be its own page and/or per-entity).
- **Expected:** compliance items / obligations load.
- If there is a way to **set or toggle a compliance override** on an entity, do
  it, confirm it saves, then **undo it**.
- **FAIL if:** the compliance view errors or is unexpectedly empty.
- Record the result.

### 8. Entities + per-entity tabs (exercises several scoped queries)
- Go to the **Entities** page; open one entity.
- Click through its tabs (Documents, Compliance, Investments, Details, etc.).
- **Expected:** each tab loads its data; the entity's documents/compliance/
  investments appear where they exist.
- **FAIL if:** a tab errors or is blank where you'd expect content.
- Record which tabs you checked and any that were empty/errored.

### 9. (OPTIONAL) Delete a throwaway document (route: `DELETE /api/documents/[id]`)
- **Only do this if** there is a document whose name literally contains
  `SAFE TO DELETE`. If no such document exists, **SKIP** this test and record
  BLOCKED ("no throwaway doc staged").
- If it exists: delete it, confirm it disappears from the list, no error.
- Record the result.

### 10. Service Providers (route: `/api/service-providers/[id]/entities`)
- If a **Service Providers** page is reachable in the nav, open it and open one
  provider.
- **Expected:** loads; any linked entities show.
- If not reachable, record BLOCKED.

---

## Known — do NOT report these as bugs
- The **Relationships** navigation is intentionally hidden right now. If you
  can't find a Relationships page, that's expected — record Test for it as
  BLOCKED ("nav hidden by design"), not FAIL.
- A `401` response **before** you log in is normal.
- Pages may poll/refresh every ~15s; brief loading states are fine.

## Final report (produce this)
Output a table: **Test # | Name | Result | Notes**.
Then a short summary:
- Any **FAILs** with: page URL, action, expected vs. actual, exact error text /
  console error if any.
- Overall: does the app look healthy for the logged-in user (data present, no
  errors), or are there regressions to investigate?

Do not attempt to fix anything — just report.
