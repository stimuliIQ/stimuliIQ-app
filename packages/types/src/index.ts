// @repo/types — shared zod schemas + DTOs, reused by frontend and backend
// (CLAUDE.md §3.2). Single source of truth: backend's ZodValidationPipe and
// frontend's react-hook-form resolvers both import from here — never
// duplicate a shape.

export const PACKAGE_NAME = "@repo/types" as const;

// Common (envelope, errors, primitives) — used by every resource, not just auth.
export * from "./common/envelope.js";
export * from "./common/primitives.js";
export * from "./common/pagination.js";
// Health/readiness (Phase 7, Wave 1 — docs/plans/phase-7.md task #4). Leak-safe
// by construction (Rule H-3) — see common/health.schemas.ts for the compile-time assertion.
export * from "./common/health.schemas.js";

// Auth (Phase 0, Wave 3 — docs/plans/phase-0.md task #7).
export * from "./auth/auth.schemas.js";
// Two-factor auth (TOTP) — Phase-9-completion gap #8, promoted from apps/api-local schemas.
export * from "./auth/two-factor.schemas.js";
// Two-factor RECOVERY — email-OTP self-service + the `twofa.reset` admin rescue path.
export * from "./auth/two-factor-recovery.schemas.js";

// CRM core (Phase 1, Wave 2 — docs/plans/phase-1.md task #2).
export * from "./crm/students.schemas.js";
export * from "./crm/faculty.schemas.js";
export * from "./crm/courses.schemas.js";
export * from "./crm/batches.schemas.js";
export * from "./crm/enrollments.schemas.js";
export * from "./crm/admin.schemas.js";
export * from "./crm/audit.schemas.js";

// Commerce (Phase 2, Wave 2 — docs/plans/phase-2.md task #2).
export * from "./commerce/orders.schemas.js";
export * from "./commerce/payments.schemas.js";
export * from "./commerce/pay-link.schemas.js";
export * from "./commerce/invoices.schemas.js";
export * from "./commerce/refunds.schemas.js";
export * from "./commerce/coupons.schemas.js";

// CRM leads + pipeline (Phase 2, Wave 2 — docs/plans/phase-2.md task #2).
export * from "./crm/leads.schemas.js";
export * from "./crm/activities.schemas.js";
export * from "./crm/bookings.schemas.js";
// Unified student lifecycle — derived stage resolver shared FE+BE (lifecycle-redesign P1).
export * from "./crm/lifecycle.schemas.js";

// LMS core — student surface (Phase 3, Wave 2 — docs/plans/phase-3.md task #2).
export * from "./lms/dashboard.schemas.js";
export * from "./lms/enrollments.schemas.js";
export * from "./lms/curriculum.schemas.js";
export * from "./lms/lessons.schemas.js";
export * from "./lms/progress.schemas.js";

// Learning depth (Phase 4, Wave 2 — docs/plans/phase-4.md task #2).
// Assignments + Submissions + Projects (kind=project + milestones).
export * from "./learning/assignments.schemas.js";
// Assessments + Attempts (answer-key isolation: AssessmentQuestionPublic omits answerKey).
export * from "./learning/assessments.schemas.js";
// Certificates — student view, CRM ops, public verify (VerifyResult minimal DTO).
export * from "./learning/certificates.schemas.js";
// StorageProvider signed upload/download URL DTOs.
export * from "./learning/storage.schemas.js";

// Public surface DTOs (Phase 5, Wave 2 — docs/plans/phase-5.md task #2).
// Programs catalog (list + detail, public projection only), lead capture,
// coupon validate (display-safe), self-service registration, and enroll funnel
// (order + checkout + verify). Compile-time projection + no-secret assertions.
export * from "./public/index.js";

// Engagement (Phase 6, Wave 2 — docs/plans/phase-6.md task #2).
// WS-1 Notifications (in-app center, SSE stream, prefs/quiet-hours, unsubscribe),
// WS-2 Campaigns (templates, segment, recipients, metrics, webhooks),
// WS-3 Gamification (points ledger, badges, streaks, PII-minimal leaderboard),
// WS-4 Forum (threads, posts, nested replies, votes, moderation).
// Compile-time PII/no-secret assertions for LeaderboardEntryDto, NotificationDto,
// CampaignDto/RecipientDto per docs/plans/phase-6.md §3 task #2 hard requirements.
export * from "./engagement/index.js";

// Analytics + Hardening (Phase 7, Wave 1 — docs/plans/phase-7.md task #4).
// WS-A: 8 KPI dashboards (revenue, enrollment trend, funnel, attendance,
// engagement, campaign performance, gamification participation, forum
// health) — every response carries a ReportFreshnessSchema (asOf/stale,
// LOCK-D1: materialized-view-backed, never live write-path). Money is
// integer paise + explicit currency (never a float).
export * from "./crm/reports.schemas.js";
// WS-B: on-demand CSV/PDF exports (scope-mirrored params, Rule H-2) + export
// job status polling + scheduled report emails. Signed/short-lived download
// URLs only (AC-35) — never a raw object key/bucket path.
export * from "./crm/exports.schemas.js";

// Phase-7 Wave 2 security hardening batch B (docs/plans/phase-7.md task #13, WS-E):
// DPDP erasure — redacts a subject's PII inside EXISTING audit_logs snapshots without
// deleting the audit trail itself (Rule H-5, AC-64/65/66). Admin-only, audited.
export * from "./crm/dpdp.schemas.js";

// Mentor (Phase 8, human-mentor track — docs/specs/phase-8-mentor.md, api-designer task #2).
// WS-1 mentor hiring-record CRUD, WS-2 batch_mentors M:N assignment, WS-3 completion
// rollup (reuses the P4 EligibilityResultSchema verbatim, LOCK-4) + mark-complete
// transition, WS-4 mentor-scoped dashboard (compile-time no-leak assertions, mirrors
// crm/reports.schemas.ts's AssertNoForbiddenFields pattern).
export * from "./crm/mentors.schemas.js";

// Colleges (Phase-11 locked templates, api-designer P1 — docs/plans/phase-11-locked-
// templates.md). A dedicated CRM contract over the `Partner` model (content/
// partners.schemas.js) — see crm/colleges.schemas.js header for why this is not a new table.
export * from "./crm/colleges.schemas.js";

// ─────────────────────────────────────────────────────────────────────────
// Phase 9 Completion (docs/plans/phase-9-completion.md T14, api-designer).
// Contracts for every net-new endpoint group added in the completion phase.
// Money is integer paise + explicit currency; dates ISO-8601; IDs typed uuid
// (CLAUDE.md §3.6). See prisma/schema.prisma T6-T12 model comments for the
// ground-truth DB shape each file is written against.
// ─────────────────────────────────────────────────────────────────────────

// Live classes (T6/T15/T20) — CRM schedule/manage + LMS own-scope list/join.
export * from "./live/live-classes.schemas.js";

// Support desk (T7/T21) — tickets, canned responses, knowledge-base articles
// (admin CRUD + public read).
export * from "./support/tickets.schemas.js";
export * from "./support/canned-responses.schemas.js";
export * from "./support/kb-articles.schemas.js";

// Headless CMS (T8/T22/T32) — blog, testimonials, partners, faculty bios, generic
// content pages (admin CRUD, public read), newsletter subscribe, contact form,
// career applications. `ContentStatus` is shared from content/common.schemas.js.
export * from "./content/common.schemas.js";
export * from "./content/blog.schemas.js";
export * from "./content/testimonials.schemas.js";
export * from "./content/partners.schemas.js";
export * from "./content/faculty-bios.schemas.js";
// Phase-10 page builder: the closed 11-block registry, imported by pages.schemas.js below.
export * from "./content/page-builder-blocks.schemas.js";
export * from "./content/pages.schemas.js";
// Phase-11 locked page templates: fixed section registry superseding the free block
// picker for the 6 core marketing pages — see content/page-templates.schemas.js header.
export * from "./content/page-templates.schemas.js";
export * from "./content/newsletter.schemas.js";
export * from "./content/contact.schemas.js";
export * from "./content/careers.schemas.js";
// Phase-10 page builder: SiteSetting (nav/footer/SEO/contact/stats primitives).
export * from "./content/site-settings.schemas.js";

// Feature flags + Settings (T9/T23) — admin list/get/set, cached evaluate read.
export * from "./platform/feature-flags.schemas.js";
export * from "./platform/settings.schemas.js";

// LMS: bookmarks, lesson notes, global search, learning path (T10/T29/T35/T36).
export * from "./lms/bookmarks.schemas.js";
export * from "./lms/lesson-notes.schemas.js";
export * from "./lms/search.schemas.js";
export * from "./lms/learning-path.schemas.js";

// Commerce: referrals/affiliate, EMI plans + dunning, receipt PDF (T11/T24/T25/T27).
export * from "./commerce/referrals.schemas.js";
export * from "./commerce/emi.schemas.js";

// Growth: landing pages (campaign + A/B variant) + lead-form config (T12/T33/T40).
export * from "./growth/landing-pages.schemas.js";
export * from "./growth/lead-forms.schemas.js";

// Password reset (B9/T28) — request + confirm, enumeration-resistant, single-use token.
export * from "./auth/password-reset.schemas.js";

// ─────────────────────────────────────────────────────────────────────────
// Wave-2 follow-up promotion (docs/plans/phase-9-completion.md T30 follow-up,
// api-designer). Promotes surfaces that were shipped with STOPGAP local zod schemas
// inside apps/api (see each backend file's header for the original rationale) to
// shared @repo/types contracts + @repo/api-client SDK methods, so the frontend never
// hand-rolls fetches against them. The backend controllers/services still import
// their own local copy for now — the shapes below MUST stay structurally identical
// to those local copies (not a second, divergent source of truth).
// ─────────────────────────────────────────────────────────────────────────

// CRM bulk actions (leads assign/stage, students status) + own-scope saved views.
export * from "./crm/bulk-actions.schemas.js";
export * from "./crm/saved-views.schemas.js";

// Growth public SEO (per-city landing index/detail) + bundles/tracks pricing.
export * from "./growth/public-seo.schemas.js";

// LMS video-library ingest (CRM upload/status/attach-captions surface).
export * from "./lms/video-library.schemas.js";

// Student onboarding form (onboarding.stimuliiq.com) — CRM-authored question set +
// public submissions. The question set is DATA, so the shared answer validator
// (`buildOnboardingAnswerIssues`) is exported alongside the schemas and run on BOTH sides.
export * from "./onboarding/onboarding.schemas.js";
