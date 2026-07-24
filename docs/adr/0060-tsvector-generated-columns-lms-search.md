# ADR 0060: Postgres `tsvector` generated columns for LMS global search

## Status
Accepted

## Context
`docs/go-live-checklist.md` Tier 2 listed "Global search + bookmarks" as known-missing
product surface (LMS §7.x, `docs/plans/phase-9-completion.md` T29). `docs/05 §4`'s
original P0-era note said "Use full-text (`tsvector`) on programs/blog/forum for search
(→ Meilisearch later)" — a deferred-tooling placeholder, not a decision. T29 needed a
real, scoped (own-enrolled, tenant-isolated), server-side search over lessons, resources,
and forum threads for the LMS student search surface, without introducing a new search
infrastructure dependency this phase.

## Decision
Search over `lessons`, `resources`, and `forum_threads` uses native Postgres full-text
search: a `GENERATED ALWAYS AS (...) STORED` `tsvector` column (`search_vector`) added to
each table via raw SQL (`prisma/migrations/20260709090000_search_tsvector_index`), each
backed by a `GIN` index:

- `lessons.search_vector` — weighted: `title` at weight `'A'`, `content` at weight
  `'B'` (title matches rank higher than body matches).
- `resources.search_vector` — `title` only (resources have no body text to index).
- `forum_threads.search_vector` — `title` only (thread bodies live on the child
  `forum_posts` table; indexing post bodies too is explicitly out of scope for this
  pass, documented inline in the migration).

`SearchRepository` (`apps/api/src/modules/search/search.repository.ts`) is the **one
legitimate `$queryRaw` user in the codebase for its primary read path** — Prisma's query
builder has no `tsvector`/`@@`-operator support, so there is no declarative-schema
alternative. Every query:

- Is tenant-scoped (joins through `programs.tenant_id` / filters
  `forum_threads.tenant_id` directly).
- Is enrollment-scoped: lessons/resources are restricted to
  `module.program_id IN (caller's enrolled program ids)`; forum threads to
  `(batch_id IN enrolled batch ids) OR (program_id IN enrolled program ids)` — resolved
  server-side from the JWT subject, never trusted from the query string, mirroring
  `ForumService`'s own enrollment gate (ADR-0045).
- Explicitly re-filters `deleted_at IS NULL` on every joined table — raw SQL bypasses the
  soft-delete Prisma extension (ADR-0005) entirely, so this repository must not rely on
  it.
- Parameterizes the free-text query via `plainto_tsquery('english', ${q})` — never
  string-concatenated — closing the obvious SQL-injection surface for a user-controlled
  search string.
- Ranks with `ts_rank(...)` and highlights with `ts_headline(...)`, giving snippet
  excerpts without a second round-trip.

Because `search_vector` is a raw-SQL-only generated column, it is **not represented in
`schema.prisma`** and has no Prisma model field — the same documented divergence class
as every partial-unique index and the P7 materialized views (`docs/05 §10`).

## Consequences
- Global search ships with **zero new infrastructure** — no Meilisearch/Elasticsearch/
  Algolia service to provision, secure, or keep in sync; Postgres is already the system
  of record, so the generated column is always consistent with the source row (no
  separate indexing pipeline to fall behind or fail silently).
- `STORED` generated columns backfill automatically on `ADD COLUMN` against a populated
  table and update transactionally on every write to their source columns — there is no
  "reindex" step or eventual-consistency window between a lesson edit and it being
  searchable.
- Anyone auditing what's searchable must read the migration file directly, not
  `schema.prisma` alone — flagged in the migration header itself, matching the
  established pattern for partial-unique indexes and materialized views.
- This scope is deliberately narrower than "search everything": `programs`/`blog_posts`
  full-text search (the public marketing-site search) is **not** covered by this ADR —
  the P9 web search surface composes results client-side from the existing
  `GET /public/programs` + published-blog list endpoints instead of a server-side
  tsvector query, tracked as a follow-up in `docs/phase-9-followups.md`. `docs/05 §4`'s
  original "Meilisearch later" note still stands for that broader, unscoped case (ranked
  relevance across heterogeneous content at higher volume/complexity than this phase's
  three tables need).
- If a future phase needs typo-tolerance, synonym expansion, faceted filtering, or
  cross-language search beyond what `to_tsvector('english', ...)` provides, that is the
  trigger to revisit Meilisearch/Elasticsearch — this ADR does not foreclose that, it
  just establishes that the LMS's current three-table, own-scoped search need does not
  yet justify the operational cost of a separate search service.

## Alternatives considered
- **Meilisearch / Elasticsearch / Algolia.** Rejected for this phase — a hosted or
  self-run search service is a new infrastructure dependency (provisioning, auth,
  reindex-on-write pipeline or webhook, backup/DR story) for a search surface whose
  current scope (three tables, own-enrolled scope, no typo-tolerance requirement in the
  PRD) Postgres full-text search already satisfies. `docs/05`'s own P0-era note flagged
  this as the eventual option, not the immediate one.
- **`ILIKE '%q%'` substring matching.** Rejected — no ranking, no relevance ordering, no
  multi-word/stemming support, and a full sequential scan (or an unindexable
  leading-wildcard pattern) at any meaningful row count; `tsvector` + `GIN` gives ranked,
  stemmed, indexed search for comparable implementation effort.
- **Application-level indexing (build an in-memory or Redis-backed index from query
  results).** Rejected — duplicates data already in Postgres, introduces a
  consistency-lag risk between the index and the source rows, and Redis is explicitly
  documented in this codebase (ADR-0058) as a cache/rate-limit layer, not a
  system-of-record for anything a query needs to be correct, not just fast.
- **Non-generated `tsvector` column, refreshed via an application-level trigger or write
  hook.** Rejected — `GENERATED ALWAYS AS ... STORED` is transactionally guaranteed to
  stay in sync with its source columns at the database level; an application-level
  refresh-on-write is one more call site to forget (the exact bug class R3's orphaned
  notifiers already demonstrated this phase) for no benefit over the database doing it
  atomically.

## Related
Closes the search portion of `docs/go-live-checklist.md` Tier 2. Extends the
"raw-SQL-only, not in `schema.prisma`" precedent from the P4–P8 partial-unique indexes
and the P7 materialized views (ADR-0046). Reuses the enrollment-scope-gate pattern from
ADR-0022/ADR-0045.
