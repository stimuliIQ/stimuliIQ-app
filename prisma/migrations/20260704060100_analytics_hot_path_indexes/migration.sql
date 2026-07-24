-- Phase 7, Wave 1, task #2 (docs/plans/phase-7.md): index / N+1 supporting-index review.
--
-- Audited the hot read/list paths named in the task (students, faculty, leads,
-- enrollments, orders/payments, submissions, attempts, notifications,
-- campaign_recipients, forum_threads/posts, points_ledger) against `pg_indexes` (verified
-- live via `docker exec stimuliiq-postgres-1 psql ... \di` before writing this file — see
-- the per-index rationale below; NONE of these duplicate an existing index).
--
-- PATTERN: every index here is a partial index `WHERE deleted_at IS NULL` (matching the
-- established convention — 20260626204500_core_partial_indexes and successors) shaped to
-- support "tenant-scoped + status/date filtered pagination" — i.e. the common CRM list
-- endpoint shape: `WHERE tenant_id = ? AND <filter> ORDER BY created_at DESC LIMIT ?`.
-- Forward-only; never edit shipped migrations (CLAUDE.md §3.8).

-- ── student_profiles: directory listing paginated by status + recency ────────────────
-- Existing: (tenant_id, status) partial. Missing the created_at tail needed for a
-- status-filtered, cursor-paginated directory listing without an extra sort step.
CREATE INDEX IF NOT EXISTS "student_profiles_active_tenant_status_created_idx"
  ON "student_profiles" ("tenant_id", "status", "created_at")
  WHERE "deleted_at" IS NULL;

-- ── faculty_profiles: branch-scoped roster paginated by recency ──────────────────────
-- Existing: (branch_id) partial only (no tenant_id or created_at). Faculty roster reads
-- are always tenant + branch scoped in the CRM; this supports that filtered listing.
CREATE INDEX IF NOT EXISTS "faculty_profiles_active_tenant_branch_created_idx"
  ON "faculty_profiles" ("tenant_id", "branch_id", "created_at")
  WHERE "deleted_at" IS NULL;

-- ── leads: chronological + stage-filtered chronological pagination ───────────────────
-- Existing: (tenant_id, stage, owner_id) partial (Kanban/pipeline grouping) and
-- (phone)/(sla_due_at) partials. Missing a plain recency index for "all leads, newest
-- first" and a stage+recency index for "leads in stage X, newest first" (both common CRM
-- list views distinct from the Kanban grouping).
CREATE INDEX IF NOT EXISTS "leads_active_tenant_created_idx"
  ON "leads" ("tenant_id", "created_at")
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "leads_active_stage_created_idx"
  ON "leads" ("tenant_id", "stage", "created_at")
  WHERE "deleted_at" IS NULL;

-- ── enrollments: batch roster filtered by status ──────────────────────────────────────
-- Existing: (tenant_id, status) partial and (batch_id) partial, separately. Missing the
-- combined (tenant_id, batch_id, status) partial for "this batch's active/completed/
-- dropped roster" — the actual CRM batch-roster query shape.
CREATE INDEX IF NOT EXISTS "enrollments_active_batch_status_idx"
  ON "enrollments" ("tenant_id", "batch_id", "status")
  WHERE "deleted_at" IS NULL;

-- ── payments: status-filtered date-range pagination (revenue reconciliation, AC-1) ───
-- Existing: (tenant_id, status) partial only. Revenue reconciliation and the payments
-- list both filter by tenant + status + a paid_at date range — add paid_at as the
-- range/sort column.
CREATE INDEX IF NOT EXISTS "payments_active_tenant_status_paid_at_idx"
  ON "payments" ("tenant_id", "status", "paid_at")
  WHERE "deleted_at" IS NULL;

-- ── submissions: grading queue paginated by submission recency ───────────────────────
-- Existing: (tenant_id, status) partial (grading queue filter) with no recency tail —
-- the actual queue is sorted oldest/newest first within a status.
CREATE INDEX IF NOT EXISTS "submissions_active_tenant_status_created_idx"
  ON "submissions" ("tenant_id", "status", "created_at")
  WHERE "deleted_at" IS NULL;

-- ── attempts: per-assessment attempt history/review list ─────────────────────────────
-- Existing: (assessment_id, enrollment_id) and (enrollment_id, assessment_id) partials
-- (attempt-count + in-progress checks). Missing a tenant + assessment + recency index for
-- the CRM "review all attempts for this assessment" list.
CREATE INDEX IF NOT EXISTS "attempts_active_tenant_assessment_created_idx"
  ON "attempts" ("tenant_id", "assessment_id", "created_at")
  WHERE "deleted_at" IS NULL;

-- ── notifications: full notification-center pagination (not just unread count) ───────
-- Existing: (user_id, read_at) partial (unread-count query only). The notification
-- center also needs to page through ALL notifications (read + unread) for a user, newest
-- first.
CREATE INDEX IF NOT EXISTS "notifications_active_user_created_idx"
  ON "notifications" ("user_id", "created_at")
  WHERE "deleted_at" IS NULL;

-- ── campaign_recipients: full recipient list pagination (all statuses) ───────────────
-- Existing: (campaign_id, status) partial (status-filtered view only). The CRM
-- "recipients" tab pages through all recipients regardless of status, newest first.
CREATE INDEX IF NOT EXISTS "campaign_recipients_active_campaign_created_idx"
  ON "campaign_recipients" ("campaign_id", "created_at")
  WHERE "deleted_at" IS NULL;

-- ── forum_threads: chronological batch-scoped thread listing ─────────────────────────
-- Existing: (tenant_id, batch_id, status) and (tenant_id, batch_id, pinned) partials.
-- Missing a plain chronological index for the default "newest threads first" listing
-- (status-agnostic, e.g. an "all statuses" admin/moderation view).
CREATE INDEX IF NOT EXISTS "forum_threads_active_batch_created_idx"
  ON "forum_threads" ("tenant_id", "batch_id", "created_at")
  WHERE "deleted_at" IS NULL;

-- ── forum_posts: paginated visible-post timeline within a thread ──────────────────────
-- Existing: (thread_id, status) partial WHERE status='visible' (filter only, no sort
-- column) and (thread_id) partial WHERE parent_id IS NULL. The thread reader view pages
-- visible posts ordered by created_at (chat-timeline order).
CREATE INDEX IF NOT EXISTS "forum_posts_active_thread_visible_created_idx"
  ON "forum_posts" ("thread_id", "created_at")
  WHERE "deleted_at" IS NULL
    AND "status" = 'visible';

-- ── points_ledger: per-user paginated XP history ──────────────────────────────────────
-- Existing: (tenant_id, user_id) and (user_id) — both non-partial, no recency tail. The
-- "my points history" / gamification detail view pages a user's ledger newest first.
CREATE INDEX IF NOT EXISTS "points_ledger_active_tenant_user_created_idx"
  ON "points_ledger" ("tenant_id", "user_id", "created_at")
  WHERE "deleted_at" IS NULL;
