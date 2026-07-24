-- Partial indexes `WHERE deleted_at IS NULL` for the Phase-2 commerce + CRM hot tables
-- (docs/05 §4 + docs/plans/phase-2.md task #1). Prisma's declarative `@@index` cannot
-- express partial indexes, so these are added via raw SQL in a dedicated forward-only
-- migration, matching the pattern established in 20260626204500_core_partial_indexes
-- and 20260627073500_crm_core_partial_indexes.
-- These complement (do not replace) the full-column composite indexes already created
-- in 20260627203323_commerce_leads.

-- ── Commerce: coupons ──────────────────────────────────────────────────────────────────

-- Active coupon lookups by tenant (e.g. validate a coupon code at order time).
CREATE INDEX IF NOT EXISTS "coupons_active_tenant_status_idx"
  ON "coupons" ("tenant_id", "status")
  WHERE "deleted_at" IS NULL;

-- Hot path: look up a coupon by (tenant, code) for validation — only active rows.
CREATE UNIQUE INDEX IF NOT EXISTS "coupons_active_tenant_code_key"
  ON "coupons" ("tenant_id", "code")
  WHERE "deleted_at" IS NULL;

-- ── Commerce: orders ───────────────────────────────────────────────────────────────────

-- Revenue ledger / dashboard: active orders by status within a tenant.
CREATE INDEX IF NOT EXISTS "orders_active_tenant_status_created_at_idx"
  ON "orders" ("tenant_id", "status", "created_at")
  WHERE "deleted_at" IS NULL;

-- Per-student order history (active only).
CREATE INDEX IF NOT EXISTS "orders_active_student_idx"
  ON "orders" ("student_id")
  WHERE "deleted_at" IS NULL;

-- ── Commerce: payments ─────────────────────────────────────────────────────────────────

-- Reconciliation: active payments by status within a tenant.
CREATE INDEX IF NOT EXISTS "payments_active_tenant_status_idx"
  ON "payments" ("tenant_id", "status")
  WHERE "deleted_at" IS NULL;

-- ── Commerce: refunds ──────────────────────────────────────────────────────────────────

-- Finance approval queue: active refunds by status.
CREATE INDEX IF NOT EXISTS "refunds_active_tenant_status_idx"
  ON "refunds" ("tenant_id", "status")
  WHERE "deleted_at" IS NULL;

-- ── CRM: leads ────────────────────────────────────────────────────────────────────────

-- Pipeline kanban: active leads by (tenant, stage, owner) — the primary scope filter.
CREATE INDEX IF NOT EXISTS "leads_active_pipeline_idx"
  ON "leads" ("tenant_id", "stage", "owner_id")
  WHERE "deleted_at" IS NULL;

-- SLA timer queue: active leads with an SLA deadline.
CREATE INDEX IF NOT EXISTS "leads_active_sla_due_at_idx"
  ON "leads" ("sla_due_at")
  WHERE "deleted_at" IS NULL AND "sla_due_at" IS NOT NULL;

-- Deduplication: active leads by phone (within the same tenant for PII lookups).
CREATE INDEX IF NOT EXISTS "leads_active_phone_idx"
  ON "leads" ("phone")
  WHERE "deleted_at" IS NULL;

-- ── CRM: activities ───────────────────────────────────────────────────────────────────

-- "My tasks / due follow-ups": active task activities by user + due date.
CREATE INDEX IF NOT EXISTS "activities_active_user_due_at_idx"
  ON "activities" ("user_id", "due_at")
  WHERE "deleted_at" IS NULL;

-- Activity timeline for a lead: active activities ordered by due date.
CREATE INDEX IF NOT EXISTS "activities_active_lead_due_at_idx"
  ON "activities" ("lead_id", "due_at")
  WHERE "deleted_at" IS NULL AND "lead_id" IS NOT NULL;

-- ── CRM: bookings ─────────────────────────────────────────────────────────────────────

-- Slot availability / calendar: active bookings by (tenant, slot_at).
CREATE INDEX IF NOT EXISTS "bookings_active_tenant_slot_at_idx"
  ON "bookings" ("tenant_id", "slot_at")
  WHERE "deleted_at" IS NULL;

-- ── Enrollment commerce-linkage: partial-unique on order_id ───────────────────────────
--
-- Prevents one paid order from being linked to more than one active enrollment.
-- Prisma cannot express partial-unique indexes, so this is the authoritative constraint.
-- Logic:
--   - order_id IS NOT NULL AND deleted_at IS NULL: only active order-linked enrollments
--     are constrained; manual enrollments (order_id = null) are unrestricted; a
--     soft-deleted enrollment does not block re-linking the same order (restore is
--     handled by the application layer with an explicit upsert, see ADR notes in
--     docs/plans/phase-2.md "Order→enrollment atomicity").
-- This mirrors the "enrollments_active_student_batch_key" partial-unique established in
-- 20260627073500_crm_core_partial_indexes for the same table.
CREATE UNIQUE INDEX IF NOT EXISTS "enrollments_active_order_id_key"
  ON "enrollments" ("order_id")
  WHERE "order_id" IS NOT NULL AND "deleted_at" IS NULL;
