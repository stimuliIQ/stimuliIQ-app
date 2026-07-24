-- Phase-9 Completion T29: Postgres full-text search index for the LMS global-search
-- surface (GET /me/search — lessons/resources/forum_threads, own-enrolled scope,
-- docs/plans/phase-9-completion.md, packages/types/src/lms/search.schemas.ts).
--
-- GENERATED ALWAYS AS ... STORED tsvector columns + GIN indexes are NOT expressible via
-- Prisma's declarative schema.prisma (no `@db.tsvector`/generated-column support), so —
-- matching the established pattern for anything Prisma cannot declare (partial-unique
-- indexes: 20260626204500_core_partial_indexes, 20260702161900_website_seo_partial_indexes,
-- etc.) — this migration is raw SQL only and is NOT reflected in schema.prisma. The
-- `search_vector` column exists in the live DB but has no Prisma model field; queries
-- against it go through `$queryRaw` in SearchRepository (apps/api/src/modules/search/
-- search.repository.ts), never through the Prisma query builder.
--
-- Additive + forward-only (CLAUDE.md §3.8): adds columns/indexes only, no data migration,
-- no column drops. Safe to run against a populated table (STORED generated columns
-- backfill automatically on ADD COLUMN).

-- ── lessons.search_vector — title + content ────────────────────────────────────────
-- `lessons` has no tenant_id column of its own (tenant is resolved via
-- module -> program -> tenant_id); the search query joins through that chain and
-- filters by the caller's enrolled program ids, so no tenant column is needed on this
-- generated column itself.
ALTER TABLE "lessons"
  ADD COLUMN IF NOT EXISTS "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("content", '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS "lessons_search_vector_idx" ON "lessons" USING GIN ("search_vector");

-- ── resources.search_vector — title only ───────────────────────────────────────────
ALTER TABLE "resources"
  ADD COLUMN IF NOT EXISTS "search_vector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce("title", ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS "resources_search_vector_idx" ON "resources" USING GIN ("search_vector");

-- ── forum_threads.search_vector — title only ───────────────────────────────────────
-- (Thread bodies live on forum_posts, a 1:N child table — out of scope for this pass;
-- title-only search still resolves a thread as a search hit, matching
-- SearchResultItemSchema's "deep-link-only shape, no content leaked" contract.)
ALTER TABLE "forum_threads"
  ADD COLUMN IF NOT EXISTS "search_vector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce("title", ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS "forum_threads_search_vector_idx" ON "forum_threads" USING GIN ("search_vector");
