# CLAUDE.md

Engineering rules for plinth-ai (Rhodes). These are hard-won invariants — most
exist because we broke something. Follow them by default; if you deviate, say so
and why.

Stack: Next.js 16 (App Router) · Supabase (Postgres + RLS + Storage + Realtime) ·
Vercel (Fluid Compute, default 300s function timeout) · Anthropic (Claude) for
extraction + chat. Multi-tenant; every row is scoped by `organization_id`.

---

## 1. Serverless route discipline (don't add to the timeout debt)

Heavy, sequential, or synchronous work `await`ed inline in an API route is the
single most common bug we've shipped. The server work succeeds, but the client
`fetch` times out with "Failed to fetch" and the user thinks it failed. Rules:

- **Validate fast, return fast.** Do the cheap checks (auth, ownership, password
  correctness, schema) inline, then return. Don't make the client wait on the
  expensive part.
- **Defer heavy work to `after()`** (`next/server`) when the caller doesn't need
  the result in the response. The UI polls / Realtime refreshes for completion.
  Pattern reference: `queue/[itemId]/unlock` and `queue/[itemId]/reprocess`.
- **Keep it synchronous only when the caller needs the result** (e.g. a share
  link, an approval count) — and then still set a budget and parallelize.
- **Always set `export const maxDuration`** on any route that runs an LLM call,
  multi-step pipeline, multi-file storage op, or outbound delivery. Use the
  smallest honest budget: agent loops → `300`; lighter multi-step → `120`.
- **Never loop `await` one-at-a-time over a user-sized collection.** Use
  bounded-concurrency chunks (`CONCURRENCY = 5`, `Promise.all` per slice). See
  `apply-adapter.ts`, `approve-all`, and the chat-drawer upload loop.
- Client-side too: parallelize file uploads / presigns in bounded chunks, not a
  serial `for` loop.

If you're about to write `for (const x of bigArray) await heavy(x)` in a route,
stop and apply the above.

## 2. MCP tool ↔ API route parity

Chat must be able to do **everything** the API can — user-facing or not. Every
capability exposed by an API route has a corresponding MCP tool so the agent can
perform it. When you add or change an API route, add or update the matching MCP
tool (and its Zod schema) in the same change. Don't let the surfaces drift.

- Write tools live in `src/lib/mcp/tools/`; they're applied via
  `apply-adapter.ts` and `lib/pipeline/apply.ts`.
- Keep the tool's input schema and the route's validation schema in sync.

## 3. One ingestion pipeline

Chat upload, the bulk-upload surface, and any future ingestion entry point all
go through the **exact same backend pipeline** (`document_batches` →
`document_queue` → `processQueueItem` → review). UX may differ; the backend path
must not fork. If you're tempted to write a second ingestion path, wire into the
existing one instead.

The queue is drained two ways: immediately after upload, and by a cron-swept
safety-net worker (`cron/process-queue`, every 3 min) that atomically claims
`queued`/`extracting` items, reclaims stuck ones, and dead-letters poison pills
via `process_attempts`. It never touches `review_ready`/terminal states.

## 4. Security invariants

- **Encrypted-PDF passwords are NEVER persisted.** Used in-process for
  decryption only — never written to the queue row, batch metadata, or any
  field. Only post-decryption extracted text is stored.
- Secrets live in gitignored `.env` / `.env.local`. Never commit them, never
  paste them into chat.
- Cross-tenant guard on every route: confirm the resource's `organization_id`
  matches `requireOrg()` before acting.

## 5. Cost telemetry on every LLM call

Every Claude call records the 4 token classes (input / output / cache_read /
cache_creation) and a `cost_usd` via `computeCostUsd` (`model-pricing.ts`, with
model-family fallback for version drift). Any **new** LLM surface must be
instrumented from the start — we price the product off these numbers. Use
Anthropic prompt caching (`cache_control: ephemeral`) where the prompt is reused
within ~5 min; document ingestion relies on it (~70% cost reduction).

## 6. UX / client conventions

- **Edit through the centralized edit menu / forms**, not inline click-to-edit
  on tables.
- **Every polling loop needs a `cancelled` guard** and a sane interval. The
  pattern: `let cancelled=false; ...if(!cancelled) timer=setTimeout(tick,N);
  return ()=>{cancelled=true;clearTimeout(timer)}`. Without it, navigation
  stacks orphaned loops into a runaway (we shipped this twice). Status banners
  poll at 15s, not 1–5s.
- **Guard Realtime `.subscribe()`** and keep CSP `connect-src` including
  `wss://*.supabase.co` — an unguarded subscribe + missing CSP broke mobile
  login.
- **Never auto-match / auto-collapse transactions** (record → update) on
  amount/date similarity. Legitimate near-duplicates exist; require explicit
  user intent.
- Audit/activity copy lives in one place: `lib/activity-humanizer.ts`. Add new
  action strings in `describe()`.

## 7. Operational reality

- **Migrations are applied by hand** via the Supabase SQL editor; the CLI
  migration history is empty, so `supabase db push` sees everything as pending.
  Apply new migrations manually and keep the `.sql` file in `migrations/`.
- **Pre-launch: no live users yet.** Skip rollout caution, feature flags, and
  downtime warnings unless explicitly asked.
