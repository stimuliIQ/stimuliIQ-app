// prisma/seed.ts — Phase 6 Engagement seed (db-architect, Wave 1, docs/plans/phase-6.md #1).
//
// Builds on the Phase-5 Marketing Website seed and adds, idempotently (upserts):
//   - Phase-6 permission catalog additions (docs/plans/phase-6.md §2):
//       campaigns.view/create/edit/send/delete
//       notifications.view
//       forum.post, forum.moderate
//       gamification.view
//   - Role grants per plan §2:
//       Marketing/Owner/Admin: campaigns.* at scope=all
//       All authed roles: notifications.view at scope=own
//       Student: forum.post at scope=own, gamification.view at scope=own
//       Faculty: forum.post at scope=assigned, forum.moderate at scope=assigned
//       Admin: forum.moderate at scope=all
//   - Default notification_prefs for the 3 sample users (Ananya, Priya, Admin)
//   - Badges catalog (docs/02 §19): first_project_approved, perfect_attendance,
//       top_of_batch, streak_7days, streak_30days
//   - One user_badge (Ananya — first_project_approved)
//   - Points ledger rows for Ananya (3 events) + Sneha (2 events) for leaderboard testing
//   - Campaign template per channel (email, whatsapp, sms — whatsapp/sms with PLACEHOLDER DLT id)
//   - One draft campaign using the email template
//   - One forum thread + 2 forum posts on the sample hydBatch
//   - One unread sample notification for the sample student (Ananya)
//
// All P0-P5 data is preserved exactly. This seed is fully idempotent.
// Money is stored as integer paise (Int) — NO floats. CLAUDE.md §3.6.
// Idempotency: every entity is upserted/found-or-created on a natural unique key.

import {
  PrismaClient,
  RolePermissionScope,
  type Role,
  type Prisma,
  OrderStatus,
  PaymentStatus,
  InvoiceStatus,
  RefundStatus,
  CouponType,
  CouponStatus,
  LeadStage,
  ActivityType,
  BookingStatus,
  EnrollmentSource,
  // Phase-3 LMS core enums
  VideoStatus,
  LessonProgressStatus,
  // Phase-4 Learning Depth enums
  AssignmentKind,
  SubmissionStatus,
  AssessmentType,
  QuestionType,
  CertificateStatus,
  // Phase-6 Engagement enums
  NotificationType,
  NotificationChannel,
  CampaignChannel,
  CampaignStatus,
  RecipientStatus,
  // Phase-8 Mentor enum
  MentorEngagementStatus,
} from "@prisma/client";
import * as argon2 from "argon2";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const prisma = new PrismaClient();

const TENANT_SLUG = "stimuliiq";
const ADMIN_EMAIL = "admin@stimuliiq.test";

/** Phase-0 forward-looking modules (kept for backward compatibility — docs/plans/phase-0.md). */
const PHASE_0_MODULES = [
  "tenant",
  "branch",
  "user",
  "role",
  "permission",
  "program",
  "module",
  "lesson",
  "session",
  "audit_log",
] as const;

/** Standard CRUD-ish actions applied per Phase-0 module to build the `module.action` matrix. */
const PHASE_0_ACTIONS = ["create", "read", "update", "delete", "list"] as const;

/**
 * Phase-1 in-scope CRM modules (docs/plans/phase-1.md "New schema" + docs/03 §9 matrix).
 * `roles` and `branches` are distinct module keys from the Phase-0 `role`/`branch`
 * singular keys above — Phase-1 introduces the admin-surface "manage roles" /
 * "manage branches" CRUD action set (view/create/edit/delete/export/approve), which is
 * a different shape (and likely different guard usage) than the Phase-0 read/write CRUD
 * keys, so they are kept side by side rather than merged/renamed (renaming would risk
 * silently breaking anything already wired to the Phase-0 keys).
 */
const P1_MODULES = [
  "students",
  "faculty",
  "courses",
  "batches",
  "enrollments",
  "roles",
  "branches",
] as const;

/** Full P1 action set per docs/03 §9 ("module × action: view/create/edit/delete/export/approve"). */
const P1_ACTIONS = ["view", "create", "edit", "delete", "export", "approve"] as const;

type P1Module = (typeof P1_MODULES)[number];
type P1Action = (typeof P1_ACTIONS)[number];

/**
 * Phase-2 modules (docs/plans/phase-2.md task #1 + docs/03 §9).
 * Commerce: orders, payments, invoices, refunds, coupons.
 * CRM: leads, activities, bookings.
 * "leads.convert" is an additional action beyond the standard P2 action set.
 */
const P2_MODULES = [
  "orders",
  "payments",
  "invoices",
  "refunds",
  "coupons",
  "leads",
  "activities",
  "bookings",
] as const;

const P2_ACTIONS = ["view", "create", "edit", "delete", "export", "approve", "convert"] as const;

type P2Module = (typeof P2_MODULES)[number];
type P2Action = (typeof P2_ACTIONS)[number];

/**
 * Phase-3 LMS modules (docs/plans/phase-3.md task #1 + docs/02 §9).
 * Student-surface LMS: lessons (view/consume), videos (stream), progress (read/write own),
 * resources (view/download links).
 * Faculty-surface: assigned-scope on videos (their batches' content).
 * Additional action "stream" for videos (minting signed HLS URLs).
 */
const P3_MODULES = [
  "lessons",
  "videos",
  "progress",
  "resources",
] as const;

const P3_ACTIONS = ["view", "create", "edit", "delete", "export", "stream"] as const;

type P3Module = (typeof P3_MODULES)[number];
type P3Action = (typeof P3_ACTIONS)[number];

/**
 * Phase-4 Learning Depth modules + actions (docs/plans/phase-4.md task #1, docs/03 §9).
 *
 * Module/action breakdown (per plan §3 "Seed expansion"):
 *   assignments:  view, create, edit, grade
 *   submissions:  view, create, grade
 *   projects:     review  (project-specific mentor review action)
 *   assessments:  view, create, edit
 *   attempts:     take, view
 *   certificates: recommend, issue, revoke, view
 *   certificates.verify — public, no-auth; seeded but no role grants it (open endpoint).
 *
 * Scope convention (docs/plans/phase-4.md §3 "Seed expansion"):
 *   Student:        own-scoped  — take/submit/view own only
 *   Faculty:        assigned-scoped — author/grade/recommend for their assigned batches
 *   Admin/Owner:    all — full access on all P4 modules
 *   Finance/Support: certificates.view at all scope (certificate operations)
 */

// P4 uses heterogeneous action sets per module (not a single cross-module action matrix),
// so we define permission keys explicitly rather than a Cartesian product.
const P4_PERMISSIONS: Array<{ key: string; label: string }> = [
  // assignments
  { key: "assignments.view",   label: "View Assignments" },
  { key: "assignments.create", label: "Create Assignments" },
  { key: "assignments.edit",   label: "Edit Assignments" },
  { key: "assignments.grade",  label: "Grade Assignments" },
  // submissions
  { key: "submissions.view",   label: "View Submissions" },
  { key: "submissions.create", label: "Create Submissions" },
  { key: "submissions.grade",  label: "Grade Submissions" },
  // projects (kind=project specialised review action)
  { key: "projects.review",    label: "Review Projects" },
  // assessments
  { key: "assessments.view",   label: "View Assessments" },
  { key: "assessments.create", label: "Create Assessments" },
  { key: "assessments.edit",   label: "Edit Assessments" },
  // attempts
  { key: "attempts.take",      label: "Take Assessment Attempt" },
  { key: "attempts.view",      label: "View Assessment Attempts" },
  // attempts.grade gates PUT /crm/attempts/:id/grade (assessments-crm.controller.ts) — the
  // route that grades a DESCRIPTIVE attempt, which cannot be auto-scored. It was missing from
  // this catalog while the route shipped, and a key absent here can be granted to nobody, so
  // the endpoint 403'd for EVERY role including super_admin: descriptive grading was dead in
  // any real deployment, and the CRM's grade drawer could never succeed. Fail-closed, so a
  // functional gap rather than a hole. Granted below beside submissions.grade, whose reviewer
  // surface it mirrors.
  { key: "attempts.grade",     label: "Grade Assessment Attempt" },
  // certificates
  { key: "certificates.recommend", label: "Recommend Certificate" },
  { key: "certificates.issue",     label: "Issue Certificate" },
  { key: "certificates.revoke",    label: "Revoke Certificate" },
  { key: "certificates.view",      label: "View Certificates" },
  // certificates.verify — public endpoint, no auth; seeded as a permission key but
  // no role needs to hold it (the public verify route is unauthenticated, rate-limited).
  { key: "certificates.verify",    label: "Verify Certificate (Public)" },
];

function buildP3PermissionCatalog(): Array<{ key: string; label: string }> {
  const catalog: Array<{ key: string; label: string }> = [];
  for (const mod of P3_MODULES) {
    for (const action of P3_ACTIONS) {
      catalog.push({
        key: `${mod}.${action}`,
        label: `${capitalize(action)} ${humanize(mod)}`,
      });
    }
  }
  return catalog;
}

function buildP4PermissionCatalog(): Array<{ key: string; label: string }> {
  // P4 permissions are defined explicitly (not a Cartesian product) due to heterogeneous
  // action sets per module — see P4_PERMISSIONS definition above.
  return P4_PERMISSIONS;
}

/**
 * Phase-6 Engagement permissions (docs/plans/phase-6.md §2 "Seed expansion").
 * Uses an explicit flat list (like P4) because the action set is heterogeneous per module.
 *
 * campaigns:     Marketing/Owner/Admin (all), others none.
 * notifications: all authed users (view own).
 * forum:         students (post own/enrolled), faculty (post + moderate assigned), admin (moderate all).
 * gamification:  all authed users (view own).
 */
const P6_PERMISSIONS: Array<{ key: string; label: string }> = [
  // campaigns — CRM Marketing authoring surface
  { key: "campaigns.view",   label: "View Campaigns" },
  { key: "campaigns.create", label: "Create Campaigns" },
  { key: "campaigns.edit",   label: "Edit Campaigns" },
  { key: "campaigns.send",   label: "Send Campaigns" },
  { key: "campaigns.delete", label: "Delete Campaigns" },
  // notifications — in-app center (every authed user)
  { key: "notifications.view", label: "View Own Notifications" },
  // notification prefs — every authed user edits their OWN channel/quiet-hours matrix.
  // (Was required by NotificationsController but omitted here — every role 403'd on
  // PUT /me/notification-prefs. CRITICAL fix, P7 W1.)
  { key: "notification_prefs.edit", label: "Edit Own Notification Preferences" },
  // forum — discussion threads/posts
  // forum.read gates every GET /forum/threads* — was required by ForumController but
  // omitted from the catalog, so it could not be granted to ANY role (every forum read
  // 403'd, even for admins). CRITICAL fix, P7 W1.
  { key: "forum.read",     label: "Read Forum" },
  { key: "forum.post",     label: "Post in Forum" },
  { key: "forum.moderate", label: "Moderate Forum" },
  // gamification — points/badges/leaderboard (every authed user)
  { key: "gamification.view", label: "View Own Gamification" },
];

function buildP6PermissionCatalog(): Array<{ key: string; label: string }> {
  return P6_PERMISSIONS;
}

/**
 * Phase-7 Analytics KPI dashboard + exports permissions (docs/plans/phase-7.md tasks
 * #7 and #8, docs/specs/phase-7-analytics-hardening.md Part 8 "RBAC Permissions"
 * table). One `<domain>.view` permission per dashboard endpoint (AnalyticsController),
 * plus a single flat `reports.export` permission (ExportsController) that gates every
 * export type (AC-34: export requires this permission SEPARATE from the matching
 * `.view` permission — ExportsService additionally checks the caller holds the
 * type-specific `.view`/entity permission before generating). Uses an explicit flat
 * list (like P4/P6) — heterogeneous scope grants per module, not a Cartesian product.
 *
 * CRITICAL (P6 forum.read/notification_prefs.edit bug -> P7 must not repeat it): every
 * permission key referenced by `@RequirePermission` in AnalyticsController/ExportsController
 * MUST appear here AND be granted below, or every caller 403s no matter their role. See
 * `analytics.permission-catalog.spec.ts` / `exports.permission-catalog.spec.ts` for the
 * regression tests that pin this.
 *
 * observability.health.view is OUT of this list — it belongs to the not-yet-built health
 * (#9) task.
 *
 * `reports.schedule` (Wave 2 task #11): gates the recurring report-schedule CRUD surface
 * (ReportSchedulesController) — DISTINCT from `reports.export` (on-demand). The dispatch
 * cron additionally re-checks the creator STILL holds `reports.export` + the matching
 * `.view` permission fresh at send time (AC-37) — this permission only gates being able
 * to CREATE/manage a schedule definition, not the send itself.
 *
 * `dpdp.erasure.execute` (Wave 2 task #13, security hardening batch B): gates
 * `POST /dpdp/erasure` (DpdpController). Deliberately granted to NO role below — it is
 * covered ONLY by the super_admin/admin catch-all (every catalog permission at
 * scope=all, see the loop right after role creation) so no other role can ever hold it,
 * satisfying AC-65 ("a non-privileged caller cannot trigger erasure for another user")
 * purely via the permission grant, with no additional own-vs-other check needed at the
 * controller/service layer.
 */
const P7_PERMISSIONS: Array<{ key: string; label: string }> = [
  { key: "reports.revenue.view",     label: "View Revenue Report" },
  { key: "reports.enrollment.view",  label: "View Enrollment Trend Report" },
  { key: "reports.funnel.view",      label: "View Lead Funnel Report" },
  { key: "reports.engagement.view",  label: "View Course Engagement Report" },
  { key: "reports.campaigns.view",   label: "View Campaign Performance Report" },
  { key: "reports.gamification.view", label: "View Gamification Participation Report" },
  { key: "reports.forum.view",       label: "View Forum Health Report" },
  // Separate from reports.funnel.view on purpose: the funnel measures the BUSINESS,
  // this measures INDIVIDUAL STAFF by name. Whether a rep may see colleagues' numbers
  // is a management call, so it needs its own grant to switch on or off.
  { key: "reports.lead_performance.view", label: "View Lead Performance by Staff Member" },
  { key: "reports.export",          label: "Export Reports / Entity Lists (CSV/PDF)" },
  { key: "reports.schedule",        label: "Schedule Recurring Report Emails" },
  { key: "dpdp.erasure.execute",    label: "Execute DPDP Erasure (redact subject PII in audit logs)" },
];

function buildP7PermissionCatalog(): Array<{ key: string; label: string }> {
  return P7_PERMISSIONS;
}

/**
 * Phase-8 Mentor permissions (this task's brief). A "mentor" is a REAL, HUMAN
 * subject-matter expert hired from an EXTERNAL institute (distinct from
 * `FacultyProfile`, an internal hire) who leads a batch of students to completion.
 * Uses an explicit flat list (like P4/P6/P7) since `mentor.dashboard.view` uses a
 * different key shape (singular `mentor.`) than the CRM management permissions
 * (plural `mentors.*`).
 *
 * CRITICAL (P6 forum.read/notification_prefs.edit 403 bug — must not repeat it): every
 * permission key the Wave-2 MentorsController's `@RequirePermission` will require MUST
 * appear here AND be granted below, or every caller 403s no matter their role.
 *
 * mentors.view/create/edit/delete — CRM directory management (admin/staff).
 * mentors.assign                  — assign/unassign a mentor to/from a batch
 *                                    (`batch_mentors` CRUD).
 * mentor.dashboard.view           — the mentor role's OWN dashboard, scope=assigned
 *                                    (mirrors the faculty "assigned" scope pattern —
 *                                    resolved via `batch_mentors.mentor_id`, never a
 *                                    client-supplied scope).
 * batches.markComplete            — Wave-2 backend-builder task (LOCK-5): a NEW
 *                                    permission, distinct from the existing
 *                                    `batches.edit`, gating ONLY the active→completed
 *                                    mark-complete transition (POST
 *                                    /crm/batches/:id/complete). Deliberately kept in
 *                                    this flat P8 list (not the P1_MODULES × P1_ACTIONS
 *                                    cross-product) since "markComplete" is a one-off
 *                                    action on `batches`, not a full CRUD action added
 *                                    to every P1 module. Granted to admin/super_admin
 *                                    (catch-all), branch_manager (branch), and the
 *                                    mentor role (assigned) below — see the
 *                                    "Phase-8 Mentor role-permission grants" block.
 */
const P8_PERMISSIONS: Array<{ key: string; label: string }> = [
  { key: "mentors.view",         label: "View Mentors" },
  { key: "mentors.create",       label: "Create Mentors" },
  { key: "mentors.edit",         label: "Edit Mentors" },
  { key: "mentors.delete",       label: "Delete Mentors" },
  { key: "mentors.assign",       label: "Assign Mentors to Batches" },
  { key: "mentor.dashboard.view", label: "View Own Mentor Dashboard (Assigned Batches)" },
  { key: "batches.markComplete", label: "Mark a Batch's Internship Program Complete" },
];

function buildP8PermissionCatalog(): Array<{ key: string; label: string }> {
  return P8_PERMISSIONS;
}

/**
 * Phase-9 Completion permissions (docs/plans/phase-9-completion.md Wave 1 T13 —
 * "assemble the master permission-key list to be seeded"). Uses an explicit flat list
 * (like P4/P6/P7/P8) — every one of the ten new feature surfaces (live class,
 * tickets/KB, headless content, feature flags/settings, EMI/dunning,
 * referrals/affiliates, video library, bulk actions, 2FA, bookmarks/notes) has its own
 * heterogeneous action set, not a Cartesian product.
 *
 * CRITICAL (P6 forum.read/notification_prefs.edit 403 bug class — must not repeat it):
 * every permission key a Wave-3 controller's `@RequirePermission` will require MUST
 * appear here AND be granted below, or every caller 403s no matter their role. This is
 * the forward-declared "master permission-key list" T0/T13 call for — Wave-3
 * backend-builder controllers (T20-T31) MUST use exactly these key strings.
 *
 * Categories (docs/plans/phase-9-completion.md T13's suggested groupings):
 *   liveclass.*      — T6/T15/T20 live class scheduling + join
 *   tickets.* / kb.* / canned_responses.* — T7/T21 support desk
 *   content.*        — T8/T22 headless CMS (blog/testimonials/partners/faculty/pages)
 *   flags.* / settings.* — T9/T23 feature flags + system/company settings
 *   bookmarks.* / notes.* — T10/T29 LMS bookmarks + lesson notes (own-scope)
 *   emi.*            — T11/T24 EMI plans + dunning
 *   referrals.*      — T11/T25 affiliate/referral program
 *   videolib.*       — T26 video library ingest (upload/transcode/caption/attach)
 *   bulk.*           — T30 bulk actions on leads/students
 *   twofa.*          — T28 2FA enrol/verify/disable (own-scope; every role, admin-tier
 *                      required at login per R-security, enforced at the auth layer,
 *                      not by this permission gate), PLUS `twofa.reset` — the admin
 *                      rescue path for clearing ANOTHER user's factor (super_admin +
 *                      admin only; see the grants block below)
 *   landing_pages.* / lead_forms.* — T12/T40 campaign landing pages + lead form manager
 */
const P9_PERMISSIONS: Array<{ key: string; label: string }> = [
  // live class (T6/T15/T20)
  { key: "liveclass.view",   label: "View Live Classes" },
  { key: "liveclass.create", label: "Schedule Live Classes" },
  { key: "liveclass.edit",   label: "Edit Live Classes" },
  { key: "liveclass.cancel", label: "Cancel Live Classes" },
  { key: "liveclass.join",   label: "Join a Live Class" },
  // support desk — tickets / KB / canned responses (T7/T21)
  { key: "tickets.view",   label: "View Support Tickets" },
  { key: "tickets.create", label: "Raise a Support Ticket" },
  { key: "tickets.edit",   label: "Edit / Reply to Support Tickets" },
  { key: "tickets.assign", label: "Assign Support Tickets" },
  { key: "tickets.close",  label: "Close Support Tickets" },
  { key: "kb.view",        label: "View Knowledge Base Articles" },
  { key: "kb.edit",        label: "Manage Knowledge Base Articles" },
  { key: "canned_responses.manage", label: "Manage Canned Support Responses" },
  // headless content — blog/testimonials/partners/faculty bios/pages (T8/T22)
  { key: "content.view",    label: "View Content (Draft Preview)" },
  { key: "content.create",  label: "Create Content" },
  { key: "content.edit",    label: "Edit Content" },
  { key: "content.delete",  label: "Delete Content" },
  { key: "content.publish", label: "Publish Content" },
  // settings (T23)
  { key: "settings.view", label: "View System / Company Settings" },
  { key: "settings.edit", label: "Edit System / Company Settings" },
  // bookmarks + lesson notes — own-scope LMS study tools (T10/T29)
  { key: "bookmarks.manage", label: "Manage Own Bookmarks" },
  { key: "notes.manage",     label: "Manage Own Lesson Notes" },
  // global search — own-enrolled-scope LMS search across lessons/resources/forum
  // threads (T29, docs/plans/phase-9-completion.md; added alongside bookmarks.manage/
  // notes.manage as the third T29 "own-scope LMS study tool" permission — omitted from
  // the original T13 catalog pass, added here so GET /me/search does not 403 every
  // caller, same bug class as the P6 forum.read/notification_prefs.edit regression).
  { key: "search.use", label: "Use Global Search" },
  // EMI plans + dunning (T11/T24)
  { key: "emi.view",   label: "View EMI Plans" },
  { key: "emi.create", label: "Create EMI Plans" },
  { key: "emi.edit",   label: "Edit EMI Plans" },
  { key: "emi.charge", label: "Charge / Reconcile EMI Installments" },
  // referrals / affiliates (T11/T25)
  { key: "referrals.view",    label: "View Referrals" },
  { key: "referrals.create",  label: "Create a Referral Link" },
  { key: "referrals.edit",    label: "Edit Referrals" },
  { key: "referrals.approve", label: "Approve / Reward Referrals" },
  // video library ingest (T26)
  { key: "videolib.view",   label: "View Video Library" },
  { key: "videolib.upload", label: "Upload to Video Library" },
  { key: "videolib.edit",   label: "Edit Video Library Entries" },
  { key: "videolib.delete", label: "Delete Video Library Entries" },
  // bulk actions + saved views (T30)
  { key: "bulk.leads",    label: "Bulk-Edit Leads" },
  { key: "bulk.students", label: "Bulk-Edit Students" },
  // 2FA (T28) — own-scope; every authenticated role manages their OWN 2FA enrolment.
  { key: "twofa.manage", label: "Manage Own Two-Factor Authentication" },
  // 2FA admin rescue — clearing SOMEONE ELSE'S second factor. Deliberately a separate
  // key from twofa.manage (which every role holds at own-scope): bundling them would
  // hand every student the power to strip a colleague's 2FA.
  { key: "twofa.reset", label: "Clear Another User's Two-Factor Authentication" },
  // campaign landing pages + configurable lead forms (T12/T40)
  { key: "landing_pages.view", label: "View Landing Pages" },
  { key: "landing_pages.edit", label: "Edit Landing Pages" },
  { key: "lead_forms.view",    label: "View Lead Forms" },
  { key: "lead_forms.edit",    label: "Edit Lead Forms" },
];

function buildP9PermissionCatalog(): Array<{ key: string; label: string }> {
  return P9_PERMISSIONS;
}

/**
 * Phase-9-completion GAP-CLOSURE permissions (docs task: "close the backend gaps
 * surfaced by the Phase-9 frontend build"). Follows the exact same discipline as
 * P9_PERMISSIONS: every key here is granted below to >= 1 non-admin role, closing the
 * "P6 forum.read/notification_prefs.edit 403 for everyone" bug class before it can
 * recur (a @RequirePermission key with zero grants = 403 for every non-admin caller).
 *
 */
const P10_PERMISSIONS: Array<{ key: string; label: string }> = [
];

function buildP10PermissionCatalog(): Array<{ key: string; label: string }> {
  return P10_PERMISSIONS;
}

/**
 * Student onboarding form (onboarding.stimuliiq.com).
 *
 * `onboarding.fields.manage` is deliberately a SEPARATE key from the three submission
 * permissions, because editing the form and reading responses are genuinely different
 * privileges: a counsellor should be able to work through the intake queue without being
 * able to quietly delete the payment-receipt question out of the live form.
 *
 * Grants below (see the role blocks further down) follow the P9/P10 discipline — every key
 * reaches at least one non-admin role, so none of them is the "@RequirePermission key with
 * zero grants = 403 for everybody" bug this catalog exists to prevent.
 */
const ONBOARDING_PERMISSIONS: Array<{ key: string; label: string }> = [
  { key: "onboarding.view", label: "View Onboarding Submissions" },
  { key: "onboarding.edit", label: "Update Onboarding Submission Status" },
  { key: "onboarding.delete", label: "Delete Onboarding Submissions" },
  { key: "onboarding.fields.manage", label: "Edit the Onboarding Form Fields" },
];

function buildOnboardingPermissionCatalog(): Array<{ key: string; label: string }> {
  return ONBOARDING_PERMISSIONS;
}

/**
 * Careers / hiring (docs/specs/careers-hiring.md, ADR-0066).
 *
 * THREE keys, and the split is the design — see careers.controller.ts's header for the
 * long version. In short:
 *
 *   careers.view            — read the application queue. This is the one that matters.
 *                             An application carries a stranger's name, phone number,
 *                             resume and cover letter, none of it solicited. A content
 *                             editor who can rewrite the homepage has no business reading
 *                             CVs, which is exactly why careers does NOT reuse `content.*`
 *                             the way the colleges screen next door does.
 *   careers.review          — decide an application. Every verb behind this key emails a
 *                             real person, so the authority to send that mail is separate
 *                             from the ability to read the queue.
 *   careers.openings.manage — write the job adverts (create/edit/publish/close). Changing
 *                             what the public careers page says is a different privilege
 *                             from working the candidate queue, the same way
 *                             `onboarding.fields.manage` is separate from
 *                             `onboarding.view` (P12).
 *
 * Grants below follow the P9/P10 discipline — every key reaches at least one non-admin
 * role, so none of them is the "@RequirePermission key with zero grants = 403 for
 * everybody" bug the catalog specs exist to prevent.
 */
const CAREERS_PERMISSIONS: Array<{ key: string; label: string }> = [
  { key: "careers.view", label: "View Career Applications" },
  { key: "careers.review", label: "Decide Career Applications (hold/shortlist/offer/reject)" },
  { key: "careers.openings.manage", label: "Manage Job Openings" },
];

function buildCareersPermissionCatalog(): Array<{ key: string; label: string }> {
  return CAREERS_PERMISSIONS;
}

/**
 * Staff leave management (docs/specs/leave-management.md).
 *
 * Only THREE keys live in the catalog. The two AUTHORITY keys — `leave.approve` and
 * `leave.manage` — are deliberately seeded in a dedicated block further down, outside the
 * array the admin+super_admin catch-all loop iterates, so `admin` does NOT inherit them.
 * The product decision is explicit that only the super admin signs off on leave and sets the
 * yearly allowance; routing those through the catalog would silently hand the same authority
 * to every operational admin.
 *
 * `leave.calendar.view` is a SEPARATE key from `leave.view`, and that split is the design.
 * `leave.view` at scope=own shows you YOUR requests, reasons included.
 * `leave.calendar.view` at scope=all shows you WHO IS OUT WHEN across the company, and the
 * endpoint behind it returns a projection with no reason field at all. Folding the calendar
 * into `leave.view` would force a choice between "you cannot see your colleagues" and
 * "everybody can read everybody's reason for being off", and a leave reason is exactly the
 * kind of thing that is nobody else's business.
 */
const LEAVE_PERMISSIONS: Array<{ key: string; label: string }> = [
  { key: "leave.view", label: "View Leave Requests" },
  { key: "leave.request", label: "Apply For / Cancel Own Leave" },
  { key: "leave.calendar.view", label: "View the Team Leave Calendar" },
];

function buildLeavePermissionCatalog(): Array<{ key: string; label: string }> {
  return LEAVE_PERMISSIONS;
}

function p3Key(mod: P3Module, action: P3Action): string {
  return `${mod}.${action}`;
}

function buildP2PermissionCatalog(): Array<{ key: string; label: string }> {
  const catalog: Array<{ key: string; label: string }> = [];
  for (const mod of P2_MODULES) {
    for (const action of P2_ACTIONS) {
      catalog.push({
        key: `${mod}.${action}`,
        label: `${capitalize(action)} ${humanize(mod)}`,
      });
    }
  }
  return catalog;
}

function p2Key(mod: P2Module, action: P2Action): string {
  return `${mod}.${action}`;
}

function buildPhase0PermissionCatalog(): Array<{ key: string; label: string }> {
  const catalog: Array<{ key: string; label: string }> = [];
  for (const mod of PHASE_0_MODULES) {
    for (const action of PHASE_0_ACTIONS) {
      catalog.push({
        key: `${mod}.${action}`,
        label: `${capitalize(action)} ${humanize(mod)}`,
      });
    }
  }
  return catalog;
}

function buildP1PermissionCatalog(): Array<{ key: string; label: string }> {
  const catalog: Array<{ key: string; label: string }> = [];
  for (const mod of P1_MODULES) {
    for (const action of P1_ACTIONS) {
      catalog.push({
        key: `${mod}.${action}`,
        label: `${capitalize(action)} ${humanize(mod)}`,
      });
    }
  }
  return catalog;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function humanize(value: string): string {
  return value.replace(/_/g, " ");
}

function p1Key(mod: P1Module, action: P1Action): string {
  return `${mod}.${action}`;
}

/** Generates a random, high-entropy password for the seeded admin (printed once, never stored). */
function generateRandomPassword(): string {
  // 24 random bytes -> 32-char base64url string; comfortably exceeds any reasonable
  // minimum length/entropy requirement for a one-time bootstrap credential.
  return randomBytes(24).toString("base64url");
}

/**
 * Upserts a `user_roles` row by (userId, roleId, branchId). The compound unique
 * constraint `(user_id, role_id, branch_id)` includes a nullable column, which
 * Prisma's generated composite-key `where` input rejects `null` for in `upsert()` —
 * so we do the find-then-create dance manually here instead.
 */
async function upsertUserRole(userId: string, roleId: string, branchId: string | null): Promise<void> {
  const existing = await prisma.userRole.findFirst({ where: { userId, roleId, branchId } });
  if (!existing) {
    await prisma.userRole.create({ data: { userId, roleId, branchId } });
  }
}

/** Upserts a (role, permission) grant at a given scope. */
async function grant(
  roleId: string,
  permissionId: string,
  scope: RolePermissionScope,
): Promise<void> {
  await prisma.rolePermission.upsert({
    where: { roleId_permissionId: { roleId, permissionId } },
    // deletedAt: null — a killed test run can leave a seed grant soft-deleted; the seed
    // must restore it or the role silently loses the permission (same idempotent-repair
    // rule as the seed leads).
    update: { scope, deletedAt: null },
    create: { roleId, permissionId, scope },
  });
}

/** Creates (or finds) a `users` row + 1:1 role assignment for seed-data people (faculty/students). */
async function ensureSeedUser(args: {
  tenantId: string;
  email: string;
  name: string;
  roleId: string;
  branchId: string | null;
}): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId: args.tenantId, email: args.email } },
  });

  if (existing) {
    await upsertUserRole(existing.id, args.roleId, args.branchId);
    return { id: existing.id, created: false };
  }

  // Seed-data people get a deterministic (non-secret) placeholder password hash — these
  // are demo/dev fixtures, never real accounts, and login for them is not exercised by
  // P1 (no invite flow yet — see docs/plans/phase-1.md risk #1).
  const passwordHash = await argon2.hash(`seed-${args.email}`, { type: argon2.argon2id });

  const user = await prisma.user.create({
    data: {
      tenantId: args.tenantId,
      email: args.email,
      name: args.name,
      passwordHash,
      status: "invited",
    },
  });

  await upsertUserRole(user.id, args.roleId, args.branchId);

  return { id: user.id, created: true };
}

async function main(): Promise<void> {
  // ── Tenant ────────────────────────────────────────────────────────────────
  const tenant = await prisma.tenant.upsert({
    where: { slug: TENANT_SLUG },
    update: {},
    create: {
      slug: TENANT_SLUG,
      name: "Stimuliiq",
      status: "active",
      settings: {},
      branding: {},
    },
  });

  // ── Permission catalog (global, no tenant_id) ───────────────────────────
  const permissionCatalog = [
    ...buildPhase0PermissionCatalog(),
    ...buildP1PermissionCatalog(),
    ...buildP2PermissionCatalog(),
    ...buildP3PermissionCatalog(),
    ...buildP4PermissionCatalog(),
    ...buildP6PermissionCatalog(),
    ...buildP7PermissionCatalog(),
    ...buildP8PermissionCatalog(),
    ...buildP9PermissionCatalog(),
    ...buildP10PermissionCatalog(),
    ...buildOnboardingPermissionCatalog(),
    ...buildCareersPermissionCatalog(),
    ...buildLeavePermissionCatalog(),
  ];
  const permissions = await Promise.all(
    permissionCatalog.map((perm) =>
      prisma.permission.upsert({
        where: { key: perm.key },
        update: { label: perm.label },
        create: perm,
      }),
    ),
  );
  const permissionByKey = new Map(permissions.map((permission) => [permission.key, permission]));

  function permId(key: string): string {
    const permission = permissionByKey.get(key);
    if (!permission) {
      throw new Error(`[seed] expected permission "${key}" to exist after catalog upsert`);
    }
    return permission.id;
  }

  // ── Roles (tenant-scoped) — full docs/03 §9 default role set ────────────
  const roleDefs = [
    { key: "super_admin", name: "Super Admin", isSystem: true },
    { key: "admin", name: "Admin", isSystem: true },
    { key: "branch_manager", name: "Branch Manager", isSystem: false },
    { key: "counsellor", name: "Counsellor", isSystem: false },
    { key: "faculty", name: "Faculty", isSystem: false },
    { key: "finance", name: "Finance", isSystem: false },
    { key: "marketing", name: "Marketing", isSystem: false },
    { key: "support", name: "Support", isSystem: false },
    { key: "content_editor", name: "Content Editor", isSystem: false },
    { key: "student", name: "Student", isSystem: false },
    // Phase-8: mentor — a real, human external hire, distinct from the internal
    // `faculty` role. Data-scope = their ASSIGNED batches (via `batch_mentors`).
    { key: "mentor", name: "Mentor", isSystem: false },
  ] as const;

  const roles = await Promise.all(
    roleDefs.map((roleDef) =>
      prisma.role.upsert({
        where: { tenantId_key: { tenantId: tenant.id, key: roleDef.key } },
        update: { name: roleDef.name, isSystem: roleDef.isSystem },
        create: {
          tenantId: tenant.id,
          key: roleDef.key,
          name: roleDef.name,
          isSystem: roleDef.isSystem,
        },
      }),
    ),
  );

  const roleByKey = new Map<string, Role>(roles.map((role) => [role.key, role]));

  function roleId(key: string): string {
    const role = roleByKey.get(key);
    if (!role) {
      throw new Error(`[seed] expected role "${key}" to exist after upsert`);
    }
    return role.id;
  }

  const superAdminRole = roleByKey.get("super_admin");
  const adminRole = roleByKey.get("admin");
  const branchManagerRole = roleByKey.get("branch_manager");
  const counsellorRole = roleByKey.get("counsellor");
  const facultyRole = roleByKey.get("faculty");
  const financeRole = roleByKey.get("finance");
  const marketingRole = roleByKey.get("marketing");
  const supportRole = roleByKey.get("support");
  const contentEditorRole = roleByKey.get("content_editor");
  const studentRole = roleByKey.get("student");
  const mentorRole = roleByKey.get("mentor");

  if (
    !superAdminRole ||
    !adminRole ||
    !branchManagerRole ||
    !counsellorRole ||
    !facultyRole ||
    !financeRole ||
    !marketingRole ||
    !supportRole ||
    !contentEditorRole ||
    !studentRole ||
    !mentorRole
  ) {
    throw new Error("[seed] expected all default roles to exist after upsert");
  }

  // ── Role-permission grants ───────────────────────────────────────────────

  // super_admin + admin: full catalog (Phase-0 + Phase-1) at scope=all.
  for (const role of [superAdminRole, adminRole]) {
    await Promise.all(
      permissions.map((permission) => grant(role.id, permission.id, RolePermissionScope.all)),
    );
  }

  // ── Phase-10 Page Builder permissions — super_admin ONLY (deliberate narrowing) ──────
  //
  // `site_settings.view` / `site_settings.edit` / `content.builder` are seeded here, in a
  // DEDICATED block OUTSIDE `permissionCatalog`/`permissions` (the array the catch-all
  // loop directly above iterates), specifically so `admin` does NOT inherit them the way
  // it inherits every other catalog permission. Every other permission in this codebase
  // reaches admin via that catch-all — these three are the one deliberate exception:
  // site-wide nav/footer/SEO/contact copy and the CMS page builder are super_admin-only,
  // not admin, not marketing, not content_editor (docs/specs/phase-10-page-builder.md).
  // Upserted directly into `permission` (not via the shared `permissionByKey` map, which
  // only knows about `permissionCatalog` entries) and granted to super_admin alone.
  const PAGE_BUILDER_PERMISSIONS: Array<{ key: string; label: string }> = [
    { key: "site_settings.view", label: "View Site Settings" },
    { key: "site_settings.edit", label: "Edit Site Settings" },
    { key: "content.builder", label: "Use the Website Page Builder" },
  ];
  const pageBuilderPermissions = await Promise.all(
    PAGE_BUILDER_PERMISSIONS.map((perm) =>
      prisma.permission.upsert({
        where: { key: perm.key },
        update: { label: perm.label },
        create: perm,
      }),
    ),
  );
  await Promise.all(
    pageBuilderPermissions.map((permission) =>
      grant(superAdminRole.id, permission.id, RolePermissionScope.all),
    ),
  );

  // ── Admin ▸ Users permissions (staff-account credential management) ─────────────
  // Dedicated block outside `permissionCatalog` (same pattern as the page-builder keys
  // above) so the grant surface stays explicit: super_admin + admin only, scope=all.
  // Backs apps/api/src/modules/admin/users.controller.ts (/crm/admin/users CRUD).
  const USERS_ADMIN_PERMISSIONS: Array<{ key: string; label: string }> = [
    { key: "users.view", label: "View Staff Users" },
    { key: "users.create", label: "Create Staff Users" },
    { key: "users.edit", label: "Edit Staff Users" },
    { key: "users.delete", label: "Deactivate Staff Users" },
  ];
  const usersAdminPermissions = await Promise.all(
    USERS_ADMIN_PERMISSIONS.map((perm) =>
      prisma.permission.upsert({
        where: { key: perm.key },
        update: { label: perm.label },
        create: perm,
      }),
    ),
  );
  for (const role of [superAdminRole, adminRole]) {
    await Promise.all(
      usersAdminPermissions.map((permission) => grant(role.id, permission.id, RolePermissionScope.all)),
    );
  }

  // ── Audit log permissions — VIEW ONLY, for everyone, including super_admin ──────────
  //
  // Kept out of the `P1_MODULES` × `P1_ACTIONS` cross-product on purpose. That product
  // minted `audit_logs.create/edit/delete/export/approve` alongside `.view`, and the
  // super_admin/admin catch-all loop above granted the lot at scope=all — so the RBAC
  // matrix showed Super Admin holding edit and delete rights over the audit trail. No
  // endpoint ever honoured them (`audit_logs.view` is the only key any code reads, and the
  // audit controller exposes no write verb), but a permission the UI displays and nothing
  // enforces is indistinguishable, to anyone reading the matrix, from one that works.
  //
  // An audit trail nobody can edit is the entire point of having one, so the write keys
  // should not exist to be granted. Enforcement proper is the Postgres trigger and the
  // Prisma extension guard (migration audit_logs_immutability); this block removes the
  // misleading grant surface that sits on top of them.
  const auditLogViewPermission = await prisma.permission.upsert({
    where: { key: "audit_logs.view" },
    update: { label: "View Audit Logs" },
    create: { key: "audit_logs.view", label: "View Audit Logs" },
  });
  for (const role of [superAdminRole, adminRole]) {
    await grant(role.id, auditLogViewPermission.id, RolePermissionScope.all);
  }

  // Idempotent cleanup for databases seeded before the narrowing above: drop the write
  // keys and every grant pointing at them. Hard-deleted rather than soft-deleted because
  // `Permission`/`RolePermission` are catalog rows, not business records — a soft-deleted
  // permission that RBAC still resolves would defeat the purpose.
  const staleAuditPermissionKeys = [
    "audit_logs.create",
    "audit_logs.edit",
    "audit_logs.delete",
    "audit_logs.approve",
    "audit_logs.export",
  ];
  const staleAuditPermissions = await prisma.permission.findMany({
    where: { key: { in: staleAuditPermissionKeys } },
    select: { id: true },
  });
  if (staleAuditPermissions.length > 0) {
    const staleIds = staleAuditPermissions.map((row) => row.id);
    await prisma.rolePermission.deleteMany({ where: { permissionId: { in: staleIds } } });
    await prisma.permission.deleteMany({ where: { id: { in: staleIds } } });
    console.log(`  ✓ removed ${staleIds.length} stale audit_logs write permission(s)`);
  }

  // `users.remove` — DELETE /crm/admin/users/:id/permanent, which takes a staff account out
  // of the CRM entirely (soft-delete + session revocation), as opposed to `users.delete`
  // above, which despite the name only DEACTIVATES the login.
  //
  // Granted to super_admin ALONE, and kept out of USERS_ADMIN_PERMISSIONS above precisely
  // so it cannot ride the super_admin+admin loop by accident. An admin can stop someone
  // signing in; only a super admin can remove the account.
  const usersRemovePermission = await prisma.permission.upsert({
    where: { key: "users.remove" },
    update: { label: "Delete Staff Users" },
    create: { key: "users.remove", label: "Delete Staff Users" },
  });
  await grant(superAdminRole.id, usersRemovePermission.id, RolePermissionScope.all);

  // `users.reset_password` — POST /crm/admin/users/:id/reset-password, which rotates a staff
  // member's CRM password and emails them a one-time replacement.
  //
  // super_admin ALONE, and kept out of USERS_ADMIN_PERMISSIONS for the same reason as
  // `users.remove`: `users.edit` is held by admin too, and an admin who can mint a super
  // admin's credentials can take over the stronger account via that person's inbox. Editing
  // someone's profile and reissuing their credentials are different powers.
  const usersResetPasswordPermission = await prisma.permission.upsert({
    where: { key: "users.reset_password" },
    update: { label: "Reset Staff Passwords" },
    create: { key: "users.reset_password", label: "Reset Staff Passwords" },
  });
  await grant(superAdminRole.id, usersResetPasswordPermission.id, RolePermissionScope.all);

  // ── Leave approval + configuration — super_admin ONLY (deliberate narrowing) ─────────
  //
  // Same dedicated-block device as PAGE_BUILDER_PERMISSIONS above, for the same reason:
  // these two keys are upserted OUTSIDE `permissionCatalog`/`permissions` — the array the
  // admin+super_admin catch-all loop near the top of main() iterates — so `admin` does NOT
  // inherit them. Signing off on somebody's leave and setting the yearly allowance are the
  // owner's calls (docs/specs/leave-management.md); putting them in the catalog would hand
  // every operational admin the same authority without anyone deciding to.
  //
  // `leave.manage` is one key rather than four because leave types, yearly allocations,
  // holidays and the working week are a single policy surface — there is no coherent role
  // that should be able to add a holiday but not set the allowance it is measured against.
  //
  // The other three leave keys (leave.view / leave.request / leave.calendar.view) DO live in
  // the catalog and are granted to every staff role in the block further down. Only the two
  // AUTHORITY keys are narrowed here.
  const LEAVE_ADMIN_PERMISSIONS: Array<{ key: string; label: string }> = [
    { key: "leave.approve", label: "Approve / Reject Staff Leave" },
    { key: "leave.manage", label: "Manage Leave Types, Allowances, Holidays & Weekly Offs" },
  ];
  const leaveAdminPermissions = await Promise.all(
    LEAVE_ADMIN_PERMISSIONS.map((perm) =>
      prisma.permission.upsert({
        where: { key: perm.key },
        update: { label: perm.label },
        create: perm,
      }),
    ),
  );
  await Promise.all(
    leaveAdminPermissions.map((permission) =>
      grant(superAdminRole.id, permission.id, RolePermissionScope.all),
    ),
  );

  // branch_manager: docs/03 §9 row "BranchMgr" — students/faculty/batches = branch;
  // courses = view; payments(not in P1)/reports(not in P1) skipped; admin = none;
  // audit = none. roles/branches not in BranchMgr's §9 row -> no grant.
  const branchManagerGrants: Array<[P1Module, P1Action]> = [
    ["students", "view"],
    ["students", "create"],
    ["students", "edit"],
    ["students", "delete"],
    ["students", "export"],
    ["faculty", "view"],
    ["faculty", "create"],
    ["faculty", "edit"],
    ["faculty", "delete"],
    ["courses", "view"],
    ["batches", "view"],
    ["batches", "create"],
    ["batches", "edit"],
    ["batches", "delete"],
    ["enrollments", "view"],
    ["enrollments", "create"],
    ["enrollments", "edit"],
  ];
  await Promise.all(
    branchManagerGrants.map(([mod, action]) =>
      grant(branchManagerRole.id, permId(p1Key(mod, action)), RolePermissionScope.branch),
    ),
  );

  // counsellor: docs/03 §9 row "Counsellor" — students = view/edit ("leads" — P1 has no
  // leads table yet, scoped to branch per docs/plans/phase-1.md Q2 default); courses =
  // view; reports = own (not modeled in P1, skipped). No faculty/batches/admin/audit access.
  const counsellorGrants: Array<[P1Module, P1Action]> = [
    ["students", "view"],
    ["students", "edit"],
    ["students", "create"],
    ["courses", "view"],
  ];
  await Promise.all(
    counsellorGrants.map(([mod, action]) =>
      grant(counsellorRole.id, permId(p1Key(mod, action)), RolePermissionScope.branch),
    ),
  );

  // faculty: docs/03 §9 row "Faculty/Mentor" — students = assigned; faculty = self;
  // courses = author (view/create/edit, no delete/approve here — publish gating lives in
  // the courses service, not the permission matrix); batches = assigned.
  const facultyAssignedGrants: Array<[P1Module, P1Action]> = [
    ["students", "view"],
    ["batches", "view"],
    ["batches", "edit"],
    ["enrollments", "view"],
    ["enrollments", "create"],
    ["enrollments", "edit"],
  ];
  await Promise.all(
    facultyAssignedGrants.map(([mod, action]) =>
      grant(facultyRole.id, permId(p1Key(mod, action)), RolePermissionScope.assigned),
    ),
  );
  const facultySelfGrants: Array<[P1Module, P1Action]> = [
    ["faculty", "view"],
    ["faculty", "edit"],
  ];
  await Promise.all(
    facultySelfGrants.map(([mod, action]) => grant(facultyRole.id, permId(p1Key(mod, action)), RolePermissionScope.own)),
  );
  const facultyCourseAuthorGrants: Array<[P1Module, P1Action]> = [
    ["courses", "view"],
    ["courses", "create"],
    ["courses", "edit"],
  ];
  await Promise.all(
    facultyCourseAuthorGrants.map(([mod, action]) =>
      grant(facultyRole.id, permId(p1Key(mod, action)), RolePermissionScope.assigned),
    ),
  );
  // Keep the Phase-0 placeholder grants for backward compatibility with anything
  // already exercising the Phase-0 program/module/lesson keys against `faculty`.
  const facultyPhase0PermissionKeys = new Set([
    "program.read",
    "program.list",
    "module.read",
    "module.list",
    "lesson.read",
    "lesson.list",
    "lesson.update",
  ]);
  await Promise.all(
    permissions
      .filter((permission) => facultyPhase0PermissionKeys.has(permission.key))
      .map((permission) => grant(facultyRole.id, permission.id, RolePermissionScope.assigned)),
  );

  // finance: docs/03 §9 row "Finance" — full on orders/payments/invoices; can approve
  // refunds; view-all on coupons (coupons are owned by Marketing per docs/plans/phase-2.md
  // risk #8 decision); no counsellor/leads scope.
  const financeFullGrants: Array<P2Module> = ["orders", "payments", "invoices", "refunds"];
  for (const mod of financeFullGrants) {
    for (const action of P2_ACTIONS) {
      if (action === "convert") continue; // convert is CRM-only
      await grant(financeRole.id, permId(p2Key(mod, action as P2Action)), RolePermissionScope.all);
    }
  }
  // Finance can view (not create/edit) coupons — coupon management is Marketing.
  await grant(financeRole.id, permId(p2Key("coupons", "view")), RolePermissionScope.all);
  await grant(financeRole.id, permId(p2Key("coupons", "export")), RolePermissionScope.all);

  // marketing: docs/03 §9 row "Marketing" — full on coupons, leads, activities, bookings.
  // Marketing does NOT have commerce/payments access.
  const marketingFullGrants: Array<P2Module> = ["coupons", "leads", "activities", "bookings"];
  for (const mod of marketingFullGrants) {
    for (const action of P2_ACTIONS) {
      await grant(marketingRole.id, permId(p2Key(mod, action as P2Action)), RolePermissionScope.all);
    }
  }

  // counsellor: docs/03 §9 row "Counsellor" — own/assigned scope on leads/activities/bookings.
  // "leads.convert" at own scope so a counsellor can convert leads they own.
  const counsellorCrmGrants: Array<[P2Module, P2Action]> = [
    ["leads", "view"],
    ["leads", "create"],
    ["leads", "edit"],
    ["leads", "convert"],
    ["activities", "view"],
    ["activities", "create"],
    ["activities", "edit"],
    ["bookings", "view"],
    ["bookings", "create"],
    ["bookings", "edit"],
  ];
  await Promise.all(
    counsellorCrmGrants.map(([mod, action]) =>
      grant(counsellorRole.id, permId(p2Key(mod, action)), RolePermissionScope.own),
    ),
  );

  // branch_manager: docs/03 §9 row "BranchMgr" — branch scope on orders/payments (view)
  // and on leads/activities/bookings.
  const branchManagerP2Grants: Array<[P2Module, P2Action]> = [
    ["orders", "view"],
    ["orders", "export"],
    ["payments", "view"],
    ["payments", "export"],
    ["leads", "view"],
    ["leads", "create"],
    ["leads", "edit"],
    ["leads", "export"],
    ["activities", "view"],
    ["activities", "create"],
    ["bookings", "view"],
    ["bookings", "create"],
  ];
  await Promise.all(
    branchManagerP2Grants.map(([mod, action]) =>
      grant(branchManagerRole.id, permId(p2Key(mod, action)), RolePermissionScope.branch),
    ),
  );

  // support: docs/03 §9 row "Support" — students = view; reports(support, not in P1).
  await grant(supportRole.id, permId(p1Key("students", "view")), RolePermissionScope.all);

  // ── Onboarding-form grants ───────────────────────────────────────────────────────
  //
  // scope=all, not branch: an onboarding submission arrives from an anonymous public form,
  // so it has no branch to be partitioned by — the service fails closed on any narrowed
  // scope rather than silently widening it. Counsellors and support work the intake queue
  // (read + set status/notes); DELETING a submission and EDITING the live form stay with
  // admin/super_admin, who receive them through the catch-all catalog grant above.
  await Promise.all(
    [counsellorRole, supportRole].flatMap((role) =>
      ["onboarding.view", "onboarding.edit"].map((key) => grant(role.id, permId(key), RolePermissionScope.all)),
    ),
  );

  // ── Careers grants (hiring) ──────────────────────────────────────────────────────
  //
  // admin + super_admin already hold all three keys through the catch-all catalog grant
  // above — hiring decisions sit with them by default, since this company has no separate
  // HR role.
  //
  // `branch_manager` is the one non-admin role that gets careers.view + careers.review:
  // a branch manager is who actually interviews a counsellor or a faculty hire for their
  // centre, and routing every hold/shortlist through a super admin would mean nobody
  // touches the queue for a week. They do NOT get careers.openings.manage — what the
  // public careers page advertises, and at what compensation, stays with admin.
  //
  // scope=all, not branch: an application arrives from an anonymous public form and has no
  // branch to be partitioned by (same reasoning as onboarding directly above). The service
  // fails closed on any narrowed scope rather than silently widening it.
  await Promise.all(
    ["careers.view", "careers.review"].map((key) =>
      grant(branchManagerRole.id, permId(key), RolePermissionScope.all),
    ),
  );

  // ── Leave grants (staff HR) ──────────────────────────────────────────────────────
  //
  // Every STAFF role gets `leave.view` + `leave.request` at scope=own — their own history,
  // their own applications — and `leave.calendar.view` at scope=all, because the calendar is
  // deliberately company-wide. The two "all"s are not the same "all": the calendar endpoint
  // returns a projection with no reason field, so seeing that a colleague is out on Thursday
  // never reveals why.
  //
  // `student` and `mentor` are excluded. Neither is staff on the payroll this runs for —
  // mentors are external hires (docs/specs/phase-8-mentor.md), not employees with an
  // annual leave allowance.
  //
  // `admin` and `super_admin` are excluded FROM THIS LOOP ON PURPOSE. They already hold all
  // three at scope=all from the catch-all near the top of main(), and `grant()` is an upsert
  // that UPDATES the scope — re-granting here would silently DOWNGRADE admin from `all` to
  // `own` and break the approval queue for the one role that has to see everybody. Their
  // scope=all on `leave.request` is harmless: the create endpoint always writes the session
  // user's id and never a client-supplied one.
  await Promise.all(
    [
      branchManagerRole,
      counsellorRole,
      facultyRole,
      financeRole,
      marketingRole,
      supportRole,
      contentEditorRole,
    ].flatMap((role) => [
      grant(role.id, permId("leave.view"), RolePermissionScope.own),
      grant(role.id, permId("leave.request"), RolePermissionScope.own),
      grant(role.id, permId("leave.calendar.view"), RolePermissionScope.all),
    ]),
  );

  // content_editor: not in the docs/03 §9 table verbatim (table lists Owner..Support),
  // but §9's prose + course-authoring needs imply ContentEditor manages courses/curriculum
  // at scope=all (publish/unpublish gating enforced in the courses service per the
  // P1 plan's task #3 description: "ContentEditor/Faculty author").
  const contentEditorGrants: Array<[P1Module, P1Action]> = [
    ["courses", "view"],
    ["courses", "create"],
    ["courses", "edit"],
    ["courses", "delete"],
    ["courses", "approve"],
  ];
  await Promise.all(
    contentEditorGrants.map(([mod, action]) =>
      grant(contentEditorRole.id, permId(p1Key(mod, action)), RolePermissionScope.all),
    ),
  );

  // student: read/list on program/module/lesson, scope=own (Phase-0 placeholder, unchanged).
  const studentPermissionKeys = new Set([
    "program.read",
    "program.list",
    "module.read",
    "module.list",
    "lesson.read",
    "lesson.list",
  ]);
  await Promise.all(
    permissions
      .filter((permission) => studentPermissionKeys.has(permission.key))
      .map((permission) => grant(studentRole.id, permission.id, RolePermissionScope.own)),
  );

  // ── Phase-3 role-permission grants (LMS student surface — docs/02 §9) ────────────
  //
  // Student: own-scoped LMS content permissions (CLAUDE.md §3.4 — scope=own; student
  // can only read/consume their own enrolled content, write only their own progress).
  //   lessons.view      — view curriculum tree (enrollment-gated server-side)
  //   videos.view       — view video metadata (no raw URL)
  //   videos.stream     — mint signed HLS URL (enrollment + RBAC check before mint)
  //   progress.view     — read own lesson_progress rows
  //   progress.edit     — upsert own lesson_progress (position ping + mark-complete)
  //   resources.view    — list lesson resource metadata (signed download deferred P4)
  const studentP3OwnGrants: Array<[P3Module, P3Action]> = [
    ["lessons", "view"],
    ["videos", "view"],
    ["videos", "stream"],
    ["progress", "view"],
    ["progress", "edit"],
    ["resources", "view"],
  ];
  await Promise.all(
    studentP3OwnGrants.map(([mod, action]) =>
      grant(studentRole!.id, permId(p3Key(mod, action)), RolePermissionScope.own),
    ),
  );

  // courses.view (scope=own) — docs/plans/phase-3.md §"RBAC" lists it for students; it
  // gates the whole /me LMS surface (GET /me/dashboard, /me/enrollments, /me/enrollments/
  // :id, /me/enrollments/:id/curriculum — see apps/api/src/modules/lms/lms.controller.ts).
  // It's a P1-catalog permission (same key content_editor/faculty get above), granted here
  // with the other student LMS grants. Was MISSING from the seed: seeded students 403'd
  // ("Missing required permission courses.view") on every LMS dashboard endpoint.
  await grant(studentRole!.id, permId(p1Key("courses", "view")), RolePermissionScope.own);

  // Faculty: assigned-scoped on LMS content (their batches' student-side view).
  //   lessons.view      — browse curriculum for assigned batches
  //   videos.view       — view video metadata for assigned batch content
  //   resources.view    — view/list lesson resources for their assigned batches
  //   resources.create  — upload lesson resources (CRM side, but seeded for completeness)
  //   resources.edit    — edit lesson resource metadata
  //   resources.delete  — remove lesson resource
  const facultyP3AssignedGrants: Array<[P3Module, P3Action]> = [
    ["lessons", "view"],
    ["videos", "view"],
    ["resources", "view"],
    ["resources", "create"],
    ["resources", "edit"],
    ["resources", "delete"],
  ];
  await Promise.all(
    facultyP3AssignedGrants.map(([mod, action]) =>
      grant(facultyRole!.id, permId(p3Key(mod, action)), RolePermissionScope.assigned),
    ),
  );

  // content_editor: all-scoped on LMS catalog content (videos, resources).
  const contentEditorP3Grants: Array<[P3Module, P3Action]> = [
    ["lessons", "view"],
    ["lessons", "create"],
    ["lessons", "edit"],
    ["lessons", "delete"],
    ["videos", "view"],
    ["videos", "create"],
    ["videos", "edit"],
    ["videos", "delete"],
    ["resources", "view"],
    ["resources", "create"],
    ["resources", "edit"],
    ["resources", "delete"],
  ];
  await Promise.all(
    contentEditorP3Grants.map(([mod, action]) =>
      grant(contentEditorRole!.id, permId(p3Key(mod, action)), RolePermissionScope.all),
    ),
  );

  await grant(branchManagerRole!.id, permId(p3Key("progress", "view")), RolePermissionScope.branch);

  // ── Phase-4 role-permission grants (docs/plans/phase-4.md §3 "Seed expansion") ────────
  //
  // Permission key helper for P4 (flat list, not cross-product; keys defined in P4_PERMISSIONS).
  function p4permId(key: string): string {
    return permId(key);
  }

  // super_admin + admin: already granted ALL permissions above (including new P4 permissions).
  // No additional grants needed — the catch-all above covers them.

  // Student: own-scoped — take assessments, submit assignments, view own certs/results.
  //   assignments.view  — see the assignment list for their enrolled lessons
  //   submissions.view  — see their own submissions + grades/feedback
  //   submissions.create — submit an assignment response
  //   assessments.view  — see the assessment list for their enrolled modules
  //   attempts.take     — start and submit an assessment attempt (own only)
  //   attempts.view     — see their own attempt results (score/passed/feedback)
  //   certificates.view — see their own earned certificates + download signed PDF
  const studentP4OwnGrants: string[] = [
    "assignments.view",
    "submissions.view",
    "submissions.create",
    "assessments.view",
    "attempts.take",
    "attempts.view",
    "certificates.view",
  ];
  await Promise.all(
    studentP4OwnGrants.map((key) => grant(studentRole!.id, p4permId(key), RolePermissionScope.own)),
  );

  // Faculty: assigned-scoped — author/grade for batches they teach.
  //   assignments.view   — see assignments across their assigned batches
  //   assignments.create — author new assignments for lessons in their batches
  //   assignments.edit   — edit own-authored assignments
  //   assignments.grade  — grade student submissions in their assigned batches
  //   submissions.view   — see all submissions for their assigned batches
  //   submissions.grade  — grade submissions (same surface as assignments.grade)
  //   projects.review    — review project milestone submissions
  //   assessments.view   — see assessments for their assigned modules
  //   assessments.create — author new assessments on their modules
  //   assessments.edit   — edit own-authored assessments
  //   attempts.view      — see student attempt results for their assigned batches
  //   attempts.grade     — grade a DESCRIPTIVE attempt (no auto-score possible), the same
  //                        reviewer act as submissions.grade and scoped identically
  //   certificates.recommend — flag a student as eligible for a certificate
  const facultyP4AssignedGrants: string[] = [
    "assignments.view",
    "assignments.create",
    "assignments.edit",
    "assignments.grade",
    "submissions.view",
    "submissions.grade",
    "projects.review",
    "assessments.view",
    "assessments.create",
    "assessments.edit",
    "attempts.view",
    "attempts.grade",
    "certificates.recommend",
  ];
  await Promise.all(
    facultyP4AssignedGrants.map((key) =>
      grant(facultyRole!.id, p4permId(key), RolePermissionScope.assigned),
    ),
  );

  // finance: can view certificates (for refund/enrollment cross-check) — all scope.
  await grant(financeRole!.id, p4permId("certificates.view"), RolePermissionScope.all);

  // support: can view certificates (student certificate lookup support) — all scope.
  await grant(supportRole!.id, p4permId("certificates.view"), RolePermissionScope.all);

  // branch_manager: branch-scoped view on assignments/submissions/assessments (oversight).
  const branchManagerP4Grants: string[] = [
    "assignments.view",
    "submissions.view",
    "assessments.view",
    "attempts.view",
    "certificates.view",
  ];
  await Promise.all(
    branchManagerP4Grants.map((key) =>
      grant(branchManagerRole!.id, p4permId(key), RolePermissionScope.branch),
    ),
  );

  // branch_manager also acts as branch-level ops for certificate issuance/revocation
  // (Phase-9-completion gap #5/#7 — template CRUD + bulk-issue reuse certificates.issue;
  // without this grant certificates.issue/revoke would only be reachable via the
  // super_admin/admin catch-all, the same "permission with no non-admin grant" bug class
  // as the P6 forum.read/notification_prefs.edit regression).
  await grant(branchManagerRole!.id, p4permId("certificates.issue"), RolePermissionScope.branch);
  await grant(branchManagerRole!.id, p4permId("certificates.revoke"), RolePermissionScope.branch);

  // content_editor: all-scoped on learning content (assignments + assessments authoring,
  // not grading — grading is faculty responsibility).
  const contentEditorP4Grants: string[] = [
    "assignments.view",
    "assignments.create",
    "assignments.edit",
    "assessments.view",
    "assessments.create",
    "assessments.edit",
  ];
  await Promise.all(
    contentEditorP4Grants.map((key) =>
      grant(contentEditorRole!.id, p4permId(key), RolePermissionScope.all),
    ),
  );

  // certificates.verify is a public endpoint — no role needs to hold it.
  // It is seeded as a permission key for completeness (policy documentation),
  // but no grant is issued to any role; the backend route is unauthenticated.

  // ── Admin user ────────────────────────────────────────────────────────────
  const existingAdmin = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email: ADMIN_EMAIL } },
  });

  let printedPassword: string | undefined;

  if (!existingAdmin) {
    const plainPassword = generateRandomPassword();
    const passwordHash = await argon2.hash(plainPassword, { type: argon2.argon2id });

    const adminUser = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: ADMIN_EMAIL,
        name: "Stimuliiq Admin",
        passwordHash,
        status: "active",
      },
    });

    await upsertUserRole(adminUser.id, roleId("super_admin"), null);

    printedPassword = plainPassword;
  } else {
    // Ensure the existing admin always carries the super_admin role (idempotent re-seed).
    await upsertUserRole(existingAdmin.id, roleId("super_admin"), null);
  }

  // ── Sample data: branches ────────────────────────────────────────────────
  const branchDefs = [
    { name: "Hyderabad Campus", city: "Hyderabad", address: "Hitech City, Hyderabad" },
    { name: "Bengaluru Campus", city: "Bengaluru", address: "Whitefield, Bengaluru" },
    { name: "Pune Campus", city: "Pune", address: "Hinjewadi, Pune" },
  ] as const;

  const branches = await Promise.all(
    branchDefs.map(async (def) => {
      const existingBranch = await prisma.branch.findFirst({
        where: { tenantId: tenant.id, name: def.name },
      });
      if (existingBranch) {
        return prisma.branch.update({
          where: { id: existingBranch.id },
          data: { city: def.city, address: def.address, status: "active" },
        });
      }
      return prisma.branch.create({
        data: { tenantId: tenant.id, name: def.name, city: def.city, address: def.address, status: "active" },
      });
    }),
  );
  const [hyderabad, bengaluru, pune] = branches;
  if (!hyderabad || !bengaluru || !pune) {
    throw new Error("[seed] expected 3 branches to exist after upsert");
  }

  // ── Sample data: programs (+ modules/lessons) ────────────────────────────
  const programDefs = [
    {
      slug: "fullstack-web-dev-internship",
      title: "Full-Stack Web Development Internship",
      domain: "web-development",
      level: "beginner",
      mode: "hybrid" as const,
      durationWeeks: 12,
      pricePaise: 1499900,
      modules: [
        { title: "HTML, CSS & JavaScript Foundations", lessons: ["Semantic HTML", "Modern CSS & Flexbox", "JS Fundamentals"] },
        { title: "React & Frontend Engineering", lessons: ["Components & Props", "Hooks & State", "Routing & Forms"] },
        { title: "Node.js & Backend APIs", lessons: ["REST Fundamentals", "Auth & Sessions", "Database Integration"] },
      ],
    },
    {
      slug: "data-science-ml-internship",
      title: "Data Science & Machine Learning Internship",
      domain: "data-science",
      level: "intermediate",
      mode: "recorded" as const,
      durationWeeks: 16,
      pricePaise: 1999900,
      modules: [
        { title: "Python for Data Science", lessons: ["NumPy & Pandas", "Data Visualization", "Statistics Refresher"] },
        { title: "Machine Learning Foundations", lessons: ["Supervised Learning", "Model Evaluation", "Feature Engineering"] },
      ],
    },
    {
      slug: "cloud-devops-internship",
      title: "Cloud & DevOps Internship",
      domain: "cloud-devops",
      level: "intermediate",
      mode: "live" as const,
      durationWeeks: 10,
      pricePaise: 1799900,
      modules: [
        { title: "Cloud Fundamentals", lessons: ["AWS Core Services", "Networking Basics"] },
        { title: "CI/CD & Containers", lessons: ["Docker Essentials", "GitHub Actions Pipelines"] },
      ],
    },
  ] as const;

  const programs = await Promise.all(
    programDefs.map(async (def) => {
      // programs.slug is no longer a global @unique (P5 decision: per-tenant partial-unique
      // WHERE deleted_at IS NULL). Use find-by-(tenantId, slug) + update-or-create instead
      // of prisma.upsert (which requires a unique where clause).
      const existing = await prisma.program.findFirst({
        where: { tenantId: tenant.id, slug: def.slug, deletedAt: null },
      });
      const program = existing
        ? await prisma.program.update({
            where: { id: existing.id },
            data: {
              title: def.title,
              domain: def.domain,
              level: def.level,
              mode: def.mode,
              durationWeeks: def.durationWeeks,
              pricePaise: def.pricePaise,
              status: "published",
            },
          })
        : await prisma.program.create({
            data: {
              tenantId: tenant.id,
              slug: def.slug,
              title: def.title,
              domain: def.domain,
              level: def.level,
              mode: def.mode,
              durationWeeks: def.durationWeeks,
              pricePaise: def.pricePaise,
              currency: "INR",
              status: "published",
            },
          });

      for (const [moduleIndex, moduleDef] of def.modules.entries()) {
        const existingModule = await prisma.module.findFirst({
          where: { programId: program.id, title: moduleDef.title },
        });
        const moduleRow =
          existingModule ??
          (await prisma.module.create({
            data: { programId: program.id, title: moduleDef.title, order: moduleIndex },
          }));

        for (const [lessonIndex, lessonTitle] of moduleDef.lessons.entries()) {
          const existingLesson = await prisma.lesson.findFirst({
            where: { moduleId: moduleRow.id, title: lessonTitle },
          });
          if (!existingLesson) {
            await prisma.lesson.create({
              data: {
                moduleId: moduleRow.id,
                title: lessonTitle,
                type: "video",
                order: lessonIndex,
                isPreview: lessonIndex === 0,
              },
            });
          }
        }
      }

      return program;
    }),
  );
  const [fullstackProgram, dataScienceProgram, cloudDevopsProgram] = programs;
  if (!fullstackProgram || !dataScienceProgram || !cloudDevopsProgram) {
    throw new Error("[seed] expected 3 programs to exist after upsert");
  }

  // ── Sample data: faculty (users + faculty_profiles) ──────────────────────
  const facultyDefs = [
    {
      email: "faculty.priya@stimuliiq.test",
      name: "Priya Sharma",
      branch: hyderabad,
      expertise: ["React", "Node.js", "TypeScript"],
      bio: "Full-stack engineer turned mentor, 8 years building production web apps.",
    },
    {
      email: "faculty.arjun@stimuliiq.test",
      name: "Arjun Mehta",
      branch: bengaluru,
      expertise: ["Python", "Machine Learning", "Pandas"],
      bio: "Data scientist with experience shipping ML models at scale.",
    },
    {
      email: "faculty.kavya@stimuliiq.test",
      name: "Kavya Reddy",
      branch: pune,
      expertise: ["AWS", "Docker", "CI/CD"],
      bio: "DevOps lead focused on cloud infrastructure and automation.",
    },
  ] as const;

  const facultyProfiles = await Promise.all(
    facultyDefs.map(async (def) => {
      const { id: userId } = await ensureSeedUser({
        tenantId: tenant.id,
        email: def.email,
        name: def.name,
        roleId: roleId("faculty"),
        branchId: def.branch.id,
      });

      return prisma.facultyProfile.upsert({
        where: { userId },
        update: {
          expertise: def.expertise,
          bio: def.bio,
          branchId: def.branch.id,
        },
        create: {
          tenantId: tenant.id,
          userId,
          expertise: def.expertise,
          bio: def.bio,
          branchId: def.branch.id,
        },
      });
    }),
  );
  const [priyaFaculty, arjunFaculty, kavyaFaculty] = facultyProfiles;
  if (!priyaFaculty || !arjunFaculty || !kavyaFaculty) {
    throw new Error("[seed] expected 3 faculty profiles to exist after upsert");
  }

  // ── Sample data: students (users + student_profiles) across branches/statuses ──
  const studentDefs = [
    { email: "student.ananya@stimuliiq.test", name: "Ananya Gupta", branch: hyderabad, college: "JNTU Hyderabad", courseType: "btech" as const, year: 3, city: "Hyderabad", source: "organic", status: "active" as const },
    { email: "student.rahul@stimuliiq.test", name: "Rahul Verma", branch: hyderabad, college: "Osmania University", courseType: "degree" as const, year: 2, city: "Hyderabad", source: "referral", status: "active" as const },
    { email: "student.sneha@stimuliiq.test", name: "Sneha Iyer", branch: bengaluru, college: "RV College of Engineering", courseType: "btech" as const, year: 4, city: "Bengaluru", source: "instagram", status: "alumni" as const },
    { email: "student.vikram@stimuliiq.test", name: "Vikram Singh", branch: bengaluru, college: "PES University", courseType: "mca" as const, year: 1, city: "Bengaluru", source: "google-ads", status: "lead" as const },
    { email: "student.fatima.k@stimuliiq.test", name: "Fatima Khan", branch: pune, college: "COEP Pune", courseType: "diploma" as const, year: 3, city: "Pune", source: "organic", status: "active" as const },
    { email: "student.rohan@stimuliiq.test", name: "Rohan Deshmukh", branch: pune, college: "Symbiosis Institute", courseType: "mba" as const, year: 1, city: "Pune", source: "event", status: "lead" as const },
  ] as const;

  const studentProfiles = await Promise.all(
    studentDefs.map(async (def) => {
      const { id: userId } = await ensureSeedUser({
        tenantId: tenant.id,
        email: def.email,
        name: def.name,
        roleId: roleId("student"),
        branchId: def.branch.id,
      });

      return prisma.studentProfile.upsert({
        where: { userId },
        update: {
          college: def.college,
          courseType: def.courseType,
          year: def.year,
          city: def.city,
          source: def.source,
          status: def.status,
        },
        create: {
          tenantId: tenant.id,
          userId,
          college: def.college,
          courseType: def.courseType,
          year: def.year,
          city: def.city,
          source: def.source,
          status: def.status,
        },
      });
    }),
  );

  // ── Marketing consent for demo students (Campaigns "Students" audience) ────────
  //
  // The Campaigns engine's students segment (campaigns.repository.findStudentsForSegment)
  // ONLY reaches a student whose converted-from lead carries consent.marketing_opt_in=true
  // (Rule C-1, DPDP — non-bypassable). Seeded students are created directly (no lead), so
  // without this they are invisible to every "Students only" / "Leads + Students" campaign.
  // Back-fill each demo student with a `won` lead that opted into marketing so the whole
  // student cohort is campaignable out of the box. Idempotent: skip if a converted lead
  // already exists for the profile (convertedStudentId is @unique).
  const studentMarketingConsent = {
    marketing_opt_in: true,
    tos_version: "2026-01-01",
    timestamp: new Date().toISOString(),
    ip_hash: "seed-stub",
  };
  await Promise.all(
    studentProfiles.map(async (profile, i) => {
      const def = studentDefs[i]!;
      const existing = await prisma.lead.findFirst({ where: { convertedStudentId: profile.id } });
      if (existing) return;
      await prisma.lead.create({
        data: {
          tenantId: tenant.id,
          name: def.name,
          phone: `+91999900${(i + 1).toString().padStart(4, "0")}`,
          email: def.email,
          source: def.source,
          stage: "won",
          consent: studentMarketingConsent,
          convertedStudentId: profile.id,
        },
      });
    }),
  );

  // ── Sample data: batches ─────────────────────────────────────────────────
  const batchDefs = [
    {
      name: "Full-Stack Web Dev — Batch HYD-01",
      program: fullstackProgram,
      branch: hyderabad,
      faculty: priyaFaculty,
      startDate: new Date("2026-01-12"),
      endDate: new Date("2026-04-06"),
      capacity: 40,
      mode: "hybrid" as const,
      status: "active" as const,
    },
    {
      name: "Data Science & ML — Batch BLR-01",
      program: dataScienceProgram,
      branch: bengaluru,
      faculty: arjunFaculty,
      startDate: new Date("2026-02-02"),
      endDate: new Date("2026-05-25"),
      capacity: 35,
      mode: "recorded" as const,
      status: "active" as const,
    },
    {
      name: "Cloud & DevOps — Batch PUN-01",
      program: cloudDevopsProgram,
      branch: pune,
      faculty: kavyaFaculty,
      startDate: new Date("2026-03-09"),
      endDate: null,
      capacity: 30,
      mode: "live" as const,
      status: "planned" as const,
    },
  ] as const;

  const batches = await Promise.all(
    batchDefs.map(async (def) => {
      const existingBatch = await prisma.batch.findFirst({
        where: { tenantId: tenant.id, name: def.name },
      });
      if (existingBatch) {
        return prisma.batch.update({
          where: { id: existingBatch.id },
          data: {
            programId: def.program.id,
            branchId: def.branch.id,
            facultyId: def.faculty.id,
            startDate: def.startDate,
            endDate: def.endDate,
            capacity: def.capacity,
            mode: def.mode,
            status: def.status,
          },
        });
      }
      return prisma.batch.create({
        data: {
          tenantId: tenant.id,
          programId: def.program.id,
          branchId: def.branch.id,
          facultyId: def.faculty.id,
          name: def.name,
          startDate: def.startDate,
          endDate: def.endDate,
          capacity: def.capacity,
          mode: def.mode,
          schedule: { days: ["Mon", "Wed", "Fri"], time: "19:00-21:00 IST" },
          status: def.status,
        },
      });
    }),
  );
  const [hydBatch, blrBatch, punBatch] = batches;
  if (!hydBatch || !blrBatch || !punBatch) {
    throw new Error("[seed] expected 3 batches to exist after upsert");
  }

  // ── Sample data: enrollments (roster join only — no payment/commerce, P1 scope) ──
  const enrollmentDefs = [
    { student: studentProfiles[0], batch: hydBatch, program: fullstackProgram, status: "active" as const, progressPct: 45 },
    { student: studentProfiles[1], batch: hydBatch, program: fullstackProgram, status: "active" as const, progressPct: 30 },
    { student: studentProfiles[2], batch: blrBatch, program: dataScienceProgram, status: "completed" as const, progressPct: 100 },
    { student: studentProfiles[4], batch: punBatch, program: cloudDevopsProgram, status: "active" as const, progressPct: 5 },
  ] as const;

  for (const def of enrollmentDefs) {
    if (!def.student) continue;
    const existing = await prisma.enrollment.findFirst({
      where: { studentId: def.student.id, batchId: def.batch.id },
    });
    if (existing) {
      await prisma.enrollment.update({
        where: { id: existing.id },
        data: { status: def.status, progressPct: def.progressPct },
      });
    } else {
      await prisma.enrollment.create({
        data: {
          tenantId: tenant.id,
          studentId: def.student.id,
          batchId: def.batch.id,
          programId: def.program.id,
          status: def.status,
          progressPct: def.progressPct,
          completedAt: def.status === "completed" ? new Date() : null,
        },
      });
    }
  }

  // ── Phase-2 sample data: counsellor user ─────────────────────────────────
  // Ensure a sample counsellor user exists for lead ownership + scope tests.
  const { id: counsellorUserId } = await ensureSeedUser({
    tenantId: tenant.id,
    email: "counsellor.sneha@stimuliiq.test",
    name: "Sneha Kapoor",
    roleId: roleId("counsellor"),
    branchId: hyderabad.id,
  });

  // Also create a marketing user for pipeline tests.
  const { id: marketingUserId } = await ensureSeedUser({
    tenantId: tenant.id,
    email: "marketing.rahul@stimuliiq.test",
    name: "Rahul Marketing",
    roleId: roleId("marketing"),
    branchId: bengaluru.id,
  });

  // ── Phase-2 sample data: coupons ────────────────────────────────────────
  // One percentage-based coupon, one flat-paise coupon. Idempotent by (tenantId, code).
  const couponPct = await (async () => {
    const existing = await prisma.coupon.findFirst({ where: { tenantId: tenant.id, code: "LAUNCH10" } });
    if (existing) return existing;
    return prisma.coupon.create({
      data: {
        tenantId: tenant.id,
        code: "LAUNCH10",
        type: CouponType.pct,
        value: 10, // 10%
        maxUses: 100,
        used: 3,
        validFrom: new Date("2026-01-01"),
        validTo: new Date("2026-12-31"),
        programScope: null, // applies to all programs
        status: CouponStatus.active,
      },
    });
  })();

  const couponFlat = await (async () => {
    const existing = await prisma.coupon.findFirst({ where: { tenantId: tenant.id, code: "FLAT500" } });
    if (existing) return existing;
    return prisma.coupon.create({
      data: {
        tenantId: tenant.id,
        code: "FLAT500",
        type: CouponType.flat,
        value: 50000, // ₹500 = 50000 paise
        maxUses: 50,
        used: 1,
        validFrom: new Date("2026-01-01"),
        validTo: new Date("2026-06-30"),
        programScope: [fullstackProgram.id], // restricted to fullstack program
        status: CouponStatus.active,
      },
    });
  })();

  // ── Phase-2 sample data: orders ─────────────────────────────────────────
  // Use studentProfiles[0] (Ananya) for the paid order + enrolled enrollment.
  // Use studentProfiles[1] (Rahul) for the pending order.
  const ananyaProfile = studentProfiles[0];
  const rahulProfile = studentProfiles[1];
  if (!ananyaProfile || !rahulProfile) {
    throw new Error("[seed] expected sample student profiles to exist");
  }

  // Paid order: fullstack program, LAUNCH10 coupon applied.
  // price_paise = 1499900; discount = 10% = 149990; net = 1349910 paise.
  const paidOrder = await (async () => {
    const existing = await prisma.order.findFirst({
      where: { tenantId: tenant.id, idempotencyKey: "seed-order-ananya-fullstack-2026" },
    });
    if (existing) return existing;
    return prisma.order.create({
      data: {
        tenantId: tenant.id,
        studentId: ananyaProfile.id,
        programId: fullstackProgram.id,
        amountPaise: 1349910, // 1499900 - 149990 (10% off). Integer paise.
        currency: "INR",
        couponId: couponPct.id,
        discountPaise: 149990,
        status: OrderStatus.paid,
        idempotencyKey: "seed-order-ananya-fullstack-2026",
        notes: { source: "seed" },
      },
    });
  })();

  // Pending/created order: data-science program, flat coupon FLAT500 applied.
  // price = 1999900; discount = 50000; net = 1949900 paise.
  const pendingOrder = await (async () => {
    const existing = await prisma.order.findFirst({
      where: { tenantId: tenant.id, idempotencyKey: "seed-order-rahul-datascience-2026" },
    });
    if (existing) return existing;
    return prisma.order.create({
      data: {
        tenantId: tenant.id,
        studentId: rahulProfile.id,
        programId: dataScienceProgram.id,
        amountPaise: 1949900, // 1999900 - 50000. Integer paise.
        currency: "INR",
        couponId: couponFlat.id,
        discountPaise: 50000,
        status: OrderStatus.created,
        idempotencyKey: "seed-order-rahul-datascience-2026",
      },
    });
  })();

  // ── Phase-2 sample data: payments ───────────────────────────────────────
  // Payment captured for paid order (signature verified, ledger entry).
  const capturedPayment = await (async () => {
    const existing = await prisma.payment.findFirst({ where: { orderId: paidOrder.id } });
    if (existing) return existing;
    return prisma.payment.create({
      data: {
        tenantId: tenant.id,
        orderId: paidOrder.id,
        provider: "razorpay",
        providerPaymentId: "pay_seed_ananya_001",
        providerOrderId: "order_seed_rzp_ananya_001",
        amountPaise: 1349910, // matches order amount. Integer paise.
        status: PaymentStatus.captured,
        method: "upi",
        signatureVerified: true,
        isManual: false,
        paidAt: new Date("2026-06-01T10:30:00Z"),
      },
    });
  })();

  // Payment row in "created" state for the pending order (awaiting capture).
  await (async () => {
    const existing = await prisma.payment.findFirst({ where: { orderId: pendingOrder.id } });
    if (existing) return existing;
    return prisma.payment.create({
      data: {
        tenantId: tenant.id,
        orderId: pendingOrder.id,
        provider: "razorpay",
        providerPaymentId: null,
        providerOrderId: "order_seed_rzp_rahul_001",
        amountPaise: 1949900, // Integer paise.
        status: PaymentStatus.created,
        method: null,
        signatureVerified: false,
        isManual: false,
      },
    });
  })();

  // ── Phase-2 sample data: invoices ───────────────────────────────────────
  // Existence check also matches on the hardcoded `number` (not just orderId) — `number`
  // is globally unique (idempotency_key-style constraint), and a non-seed environment can
  // legitimately already carry a REAL invoice issued with this same literal number (e.g.
  // from manual/QA app usage against a shared dev DB) attached to a DIFFERENT order than
  // this run's `paidOrder`. Without this, re-running the seed against such a DB throws a
  // unique-constraint P2002 on `number` and aborts every later seed step (found while
  // verifying Phase-11 locked-templates seed changes, db-architect).
  await (async () => {
    const existing =
      (await prisma.invoice.findFirst({ where: { orderId: paidOrder.id } })) ??
      (await prisma.invoice.findFirst({ where: { number: "INV-2026-0001" } }));
    if (existing) return existing;
    return prisma.invoice.create({
      data: {
        tenantId: tenant.id,
        orderId: paidOrder.id,
        number: "INV-2026-0001",
        storageKey: null, // stub — PDF generation queued but not yet written
        tax: { igst_paise: 0, cgst_paise: 0, sgst_paise: 0 },
        status: InvoiceStatus.issued,
        issuedAt: new Date("2026-06-01T11:00:00Z"),
      },
    });
  })();

  // ── Phase-2 sample data: refunds ────────────────────────────────────────
  // A sample refund in "requested" state for the captured payment (not yet approved).
  await (async () => {
    const existing = await prisma.refund.findFirst({ where: { paymentId: capturedPayment.id } });
    if (existing) return existing;
    return prisma.refund.create({
      data: {
        tenantId: tenant.id,
        paymentId: capturedPayment.id,
        amountPaise: 1349910, // full refund requested. Integer paise.
        reason: "Student requested cancellation within cooling-off period",
        status: RefundStatus.requested,
        requestedById: counsellorUserId,
        approvedById: null,
        providerRefundId: null,
        processedAt: null,
      },
    });
  })();

  // ── Phase-2 sample data: enrollment linked to paid order ─────────────────
  // Link Ananya's existing enrollment to the paid order (source=order).
  // Use the hydBatch enrollment seeded in P1 (ananyaProfile + hydBatch).
  const linkedEnrollment = await (async () => {
    const existing = await prisma.enrollment.findFirst({
      where: { studentId: ananyaProfile.id, batchId: hydBatch.id },
    });
    if (existing) {
      // Update to link the paid order if not already linked.
      if (!existing.orderId) {
        return prisma.enrollment.update({
          where: { id: existing.id },
          data: { orderId: paidOrder.id, source: EnrollmentSource.order },
        });
      }
      return existing;
    }
    // Create if missing (should already exist from P1 seed, but guard anyway).
    return prisma.enrollment.create({
      data: {
        tenantId: tenant.id,
        studentId: ananyaProfile.id,
        batchId: hydBatch.id,
        programId: fullstackProgram.id,
        status: "active",
        progressPct: 45,
        orderId: paidOrder.id,
        source: EnrollmentSource.order,
      },
    });
  })();

  // ── Phase-2 sample data: leads ───────────────────────────────────────────
  // 5 leads across pipeline stages to populate the kanban.
  type SeedLead = Awaited<ReturnType<typeof prisma.lead.create>>;

  const leadDefs: Array<{
    findKey: { phone: string };
    data: {
      tenantId: string;
      name: string;
      phone: string;
      email: string | null;
      source: string;
      stage: LeadStage;
      ownerId: string | null;
      branchId: string | null;
      programInterestId: string | null;
      score: number | null;
      slaDueAt: Date | null;
    };
  }> = [
    {
      findKey: { phone: "+919876500001" },
      data: {
        tenantId: tenant.id,
        name: "Aditya Sharma",
        phone: "+919876500001",
        email: "aditya.sharma@example.com",
        source: "website",
        stage: LeadStage.new,
        ownerId: null,
        branchId: hyderabad.id,
        programInterestId: fullstackProgram.id,
        score: 60,
        // Relative to seed-time so the pipeline demos a realistic SLA spread instead
        // of every lead being perpetually weeks overdue (absolute dates go stale the
        // moment the demo DB ages). Aditya: ~1 day overdue (danger).
        slaDueAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
      },
    },
    {
      findKey: { phone: "+919876500002" },
      data: {
        tenantId: tenant.id,
        name: "Meera Pillai",
        phone: "+919876500002",
        email: "meera.pillai@example.com",
        source: "instagram",
        stage: LeadStage.follow_up,
        ownerId: counsellorUserId,
        branchId: hyderabad.id,
        programInterestId: dataScienceProgram.id,
        score: 72,
        // Meera: due in ~8h (warning "Due soon").
        slaDueAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
      },
    },
    {
      findKey: { phone: "+919876500003" },
      data: {
        tenantId: tenant.id,
        name: "Kiran Rao",
        phone: "+919876500003",
        email: null,
        source: "google-ads",
        stage: LeadStage.follow_up,
        ownerId: counsellorUserId,
        branchId: bengaluru.id,
        programInterestId: cloudDevopsProgram.id,
        score: 85,
        // Kiran: due in ~3 days (neutral / on-track).
        slaDueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      },
    },
    {
      findKey: { phone: "+919876500004" },
      data: {
        tenantId: tenant.id,
        name: "Divya Nair",
        phone: "+919876500004",
        email: "divya.nair@example.com",
        source: "referral",
        stage: LeadStage.follow_up,
        ownerId: counsellorUserId,
        branchId: hyderabad.id,
        programInterestId: fullstackProgram.id,
        score: 90,
        slaDueAt: null,
      },
    },
    {
      findKey: { phone: "+919876500005" },
      data: {
        tenantId: tenant.id,
        name: "Rajesh Kumar",
        phone: "+919876500005",
        email: "rajesh.k@example.com",
        source: "event",
        stage: LeadStage.won,
        ownerId: marketingUserId,
        branchId: pune.id,
        programInterestId: dataScienceProgram.id,
        score: 95,
        slaDueAt: null,
      },
    },
  ];

  const seedLeads: SeedLead[] = await Promise.all(
    leadDefs.map(async (def) => {
      const existing = await prisma.lead.findFirst({ where: { tenantId: tenant.id, phone: def.findKey.phone } });
      if (existing) {
        // A crashed/killed test run (or a bulk-delete against the demo tenant) can leave
        // the seed leads soft-deleted; findFirst on the base client still matches them,
        // so without this the seed reports "leads: 5" while the pipeline renders empty.
        // Restore the row to its seeded stage — same idempotent-repair precedent as the
        // certificate cert_uid re-sign above. Only rows the SEED owns (matched by the
        // seed phone number) are ever restored; user-created leads are never touched.
        //
        // Always refresh slaDueAt (and un-soft-delete): the seeded dates are RELATIVE to
        // seed-time, so on a re-seed of an aged demo DB they must be re-computed or every
        // lead drifts back into "weeks overdue". Only seed-owned rows are touched.
        return prisma.lead.update({
          where: { id: existing.id },
          data: {
            deletedAt: null,
            stage: def.data.stage,
            ownerId: def.data.ownerId,
            slaDueAt: def.data.slaDueAt,
          },
        });
      }
      return prisma.lead.create({ data: def.data });
    }),
  );

  const [leadNew, leadContacted, leadQualified, leadNegotiation, leadWon] = seedLeads;
  if (!leadNew || !leadContacted || !leadQualified || !leadNegotiation || !leadWon) {
    throw new Error("[seed] expected 5 sample leads to exist after seed");
  }

  // ── Phase-2 sample data: activities ─────────────────────────────────────
  // 5 activities across different types, logged against leads.
  type SeedActivity = Awaited<ReturnType<typeof prisma.activity.create>>;

  const activityDefs: Array<{
    findKey: { tenantId: string; leadId: string; type: ActivityType; createdAt?: Date };
    data: {
      tenantId: string;
      leadId: string;
      studentId: null;
      userId: string;
      type: ActivityType;
      payload: Record<string, unknown>;
      dueAt: Date | null;
      doneAt: Date | null;
    };
  }> = [
    {
      findKey: { tenantId: tenant.id, leadId: leadContacted.id, type: ActivityType.call },
      data: {
        tenantId: tenant.id,
        leadId: leadContacted.id,
        studentId: null,
        userId: counsellorUserId,
        type: ActivityType.call,
        payload: { duration_seconds: 240, disposition: "interested", notes: "Discussed fullstack program details." },
        dueAt: null,
        doneAt: new Date("2026-06-25T14:00:00Z"),
      },
    },
    {
      findKey: { tenantId: tenant.id, leadId: leadQualified.id, type: ActivityType.note },
      data: {
        tenantId: tenant.id,
        leadId: leadQualified.id,
        studentId: null,
        userId: counsellorUserId,
        type: ActivityType.note,
        payload: { text: "Lead confirmed interest in Cloud DevOps batch starting March." },
        dueAt: null,
        doneAt: null,
      },
    },
    {
      findKey: { tenantId: tenant.id, leadId: leadNegotiation.id, type: ActivityType.task },
      data: {
        tenantId: tenant.id,
        leadId: leadNegotiation.id,
        studentId: null,
        userId: counsellorUserId,
        type: ActivityType.task,
        payload: { title: "Send payment link and follow up on coupon eligibility" },
        dueAt: new Date("2026-06-29T09:00:00Z"), // SLA follow-up
        doneAt: null,
      },
    },
    {
      findKey: { tenantId: tenant.id, leadId: leadNew.id, type: ActivityType.whatsapp },
      data: {
        tenantId: tenant.id,
        leadId: leadNew.id,
        studentId: null,
        userId: marketingUserId,
        type: ActivityType.whatsapp,
        // Logged record only — no WhatsApp message sent (P2 constraint).
        payload: { message: "Hi Aditya, thanks for registering! Our counsellor will call you shortly." },
        dueAt: null,
        doneAt: null,
      },
    },
    {
      findKey: { tenantId: tenant.id, leadId: leadWon.id, type: ActivityType.email },
      data: {
        tenantId: tenant.id,
        leadId: leadWon.id,
        studentId: null,
        userId: marketingUserId,
        type: ActivityType.email,
        // Logged record only — no email sent (P2 constraint).
        payload: { subject: "Congratulations! Your enrollment is confirmed.", template: "enrollment_confirmation" },
        dueAt: null,
        doneAt: null,
      },
    },
  ];

  const seedActivities: SeedActivity[] = await Promise.all(
    activityDefs.map(async (def) => {
      const existing = await prisma.activity.findFirst({
        where: { tenantId: def.findKey.tenantId, leadId: def.findKey.leadId, type: def.findKey.type },
      });
      if (existing) return existing;
      return prisma.activity.create({ data: def.data });
    }),
  );

  // ── Phase-2 sample data: booking ────────────────────────────────────────
  const seedBooking = await (async () => {
    const existing = await prisma.booking.findFirst({
      where: { tenantId: tenant.id, leadId: leadQualified.id },
    });
    if (existing) return existing;
    return prisma.booking.create({
      data: {
        tenantId: tenant.id,
        leadId: leadQualified.id,
        programId: cloudDevopsProgram.id,
        slotAt: new Date("2026-07-02T11:00:00Z"),
        status: BookingStatus.confirmed,
        source: "crm",
      },
    });
  })();

  // ── Phase-3 sample data: ensure video lessons exist on the fullstack program ──────────
  //
  // The fullstack program's first module "HTML, CSS & JavaScript Foundations" has 3 lessons
  // seeded in P0 as type=video. We ensure their types are explicitly video, then attach
  // Video rows (provider=noop, provider_asset_id=noop-asset-xxx, status=ready, duration_s).
  //
  // Strategy: look up the first module of the fullstack program, grab the first 3 lessons,
  // ensure each has a Video row. Idempotent via upsert on the unique lesson_id FK.

  const fullstackModule1 = await prisma.module.findFirst({
    where: { programId: fullstackProgram.id, title: "HTML, CSS & JavaScript Foundations" },
  });
  if (!fullstackModule1) {
    throw new Error("[seed] expected fullstack module 1 to exist");
  }

  const fullstackLessons = await prisma.lesson.findMany({
    where: { moduleId: fullstackModule1.id },
    orderBy: { order: "asc" },
  });
  if (fullstackLessons.length < 3) {
    throw new Error("[seed] expected at least 3 lessons in fullstack module 1");
  }

  // lesson0: "Semantic HTML" — will be used for completed progress
  // lesson1: "Modern CSS & Flexbox" — will be used for in_progress + resume testing
  // lesson2: "JS Fundamentals" — not_started (default, no progress row needed)
  const [lesson0, lesson1, lesson2] = fullstackLessons;
  if (!lesson0 || !lesson1 || !lesson2) {
    throw new Error("[seed] expected lessons 0/1/2 in fullstack module 1");
  }

  // Ensure lessons are type=video (they were seeded as video in P0 but confirm).
  for (const lesson of [lesson0, lesson1, lesson2]) {
    if (lesson.type !== "video") {
      await prisma.lesson.update({ where: { id: lesson.id }, data: { type: "video" } });
    }
  }

  // ── Phase-3 sample data: video rows (noop provider) ─────────────────────────────────
  //
  // One Video row per lesson (1:1). provider=noop so the NoopVideoProvider serves
  // deterministic fake signed HLS URLs in local dev / tests (docs/plans/phase-3.md risk #6).
  // provider_asset_id is a human-readable fake id — NOT a URL (docs/05 §7 convention).
  // status=ready so the player can attempt to stream immediately in local dev.

  type SeedVideo = Awaited<ReturnType<typeof prisma.video.create>>;

  const videoDefs: Array<{
    lesson: (typeof fullstackLessons)[number];
    providerAssetId: string;
    durationS: number;
  }> = [
    { lesson: lesson0, providerAssetId: "noop-asset-semantic-html-001", durationS: 1800 },
    { lesson: lesson1, providerAssetId: "noop-asset-modern-css-001", durationS: 2400 },
    { lesson: lesson2, providerAssetId: "noop-asset-js-fundamentals-001", durationS: 3000 },
  ];

  /**
   * True for the placeholder asset ids this seed invents (`noop-asset-<slug>-001`).
   * A REAL upload through the CRM gets `noop-asset-<timestamp>-<rand>` from
   * NoopVideoProvider.createUploadTarget, or a vendor id from Cloudflare/Mux.
   */
  const isSeedStubAsset = (assetId: string): boolean => /^noop-asset-[a-z-]+-001$/.test(assetId);

  const seedVideos: SeedVideo[] = await Promise.all(
    videoDefs.map(async (def) => {
      const existing = await prisma.video.findUnique({ where: { lessonId: def.lesson.id } });
      if (existing) {
        // NEVER touch a real uploaded asset (2026-07-18 video fix): a CRM upload
        // replaces providerAssetId with a real, file-backed id — re-seeding must not
        // reset its status/duration out from under it.
        if (!isSeedStubAsset(existing.providerAssetId)) return existing;

        return prisma.video.update({
          where: { id: existing.id },
          data: { status: VideoStatus.processing, durationS: def.durationS },
        });
      }
      return prisma.video.create({
        data: {
          tenantId: tenant.id,
          lessonId: def.lesson.id,
          provider: "noop",
          providerAssetId: def.providerAssetId,
          durationS: def.durationS,
          // NOT `ready` (2026-07-18 video fix): these stub ids have NO file behind
          // them, so claiming "ready" made the player 404 on a URL that resolved to
          // nothing. `processing` is the honest state — "a lesson slot awaiting a real
          // upload" — and stream-url answers a clear 503 instead of a broken player.
          // Uploading through CRM > Content > Video Library flips it to `ready`.
          status: VideoStatus.processing,
          captions: null,
        },
      });
    }),
  );

  // ── Phase-3 sample data: resources ──────────────────────────────────────────────────
  //
  // A couple of lesson attachments for the first two lessons. storage_key is a stub
  // S3/R2 key (no signed-download URL minted in P3 — deferred to P4 StorageProvider).

  type SeedResource = Awaited<ReturnType<typeof prisma.resource.create>>;

  const resourceDefs: Array<{
    lesson: (typeof fullstackLessons)[number];
    findKey: { title: string };
    title: string;
    type: string;
    storageKey: string;
    size: number;
  }> = [
    {
      lesson: lesson0,
      findKey: { title: "Semantic HTML Cheat Sheet" },
      title: "Semantic HTML Cheat Sheet",
      type: "pdf",
      storageKey: "resources/stimuliiq/fullstack/module1/semantic-html-cheatsheet.pdf",
      size: 102400,
    },
    {
      lesson: lesson1,
      findKey: { title: "Modern CSS Flexbox Reference" },
      title: "Modern CSS Flexbox Reference",
      type: "pdf",
      storageKey: "resources/stimuliiq/fullstack/module1/modern-css-flexbox-ref.pdf",
      size: 204800,
    },
    {
      lesson: lesson1,
      findKey: { title: "CSS Practice Exercises" },
      title: "CSS Practice Exercises",
      type: "zip",
      storageKey: "resources/stimuliiq/fullstack/module1/css-exercises.zip",
      size: 512000,
    },
  ];

  const seedResources: SeedResource[] = await Promise.all(
    resourceDefs.map(async (def) => {
      const existing = await prisma.resource.findFirst({
        where: { tenantId: tenant.id, lessonId: def.lesson.id, title: def.findKey.title },
      });
      if (existing) return existing;
      return prisma.resource.create({
        data: {
          tenantId: tenant.id,
          lessonId: def.lesson.id,
          title: def.title,
          type: def.type,
          storageKey: def.storageKey,
          size: def.size,
        },
      });
    }),
  );

  // ── Phase-3 sample data: lesson_progress for Ananya (linked enrollment) ─────────────
  //
  // Use linkedEnrollment (Ananya enrolled in hydBatch / fullstack program via paid order).
  // Three progress rows:
  //   lesson0: completed (simulate Ananya has watched "Semantic HTML" fully).
  //   lesson1: in_progress at 1200s (Ananya is mid-way through "Modern CSS & Flexbox").
  //   lesson2: not seeded (no row = not_started by default — dashboard shows it as unwatched).

  type SeedLessonProgress = Awaited<ReturnType<typeof prisma.lessonProgress.create>>;

  const progressDefs: Array<{
    lesson: (typeof fullstackLessons)[number];
    status: LessonProgressStatus;
    lastPositionS: number;
    completedAt: Date | null;
  }> = [
    {
      lesson: lesson0,
      status: LessonProgressStatus.completed,
      lastPositionS: 1800, // = duration (fully watched)
      completedAt: new Date("2026-06-28T10:00:00Z"),
    },
    {
      lesson: lesson1,
      status: LessonProgressStatus.in_progress,
      lastPositionS: 1200, // 20 minutes in — resume-testing target (resume ±2s from here)
      completedAt: null,
    },
  ];

  const seedLessonProgress: SeedLessonProgress[] = await Promise.all(
    progressDefs.map(async (def) => {
      const existing = await prisma.lessonProgress.findUnique({
        where: { enrollmentId_lessonId: { enrollmentId: linkedEnrollment.id, lessonId: def.lesson.id } },
      });
      if (existing) {
        return prisma.lessonProgress.update({
          where: { id: existing.id },
          data: { status: def.status, lastPositionS: def.lastPositionS, completedAt: def.completedAt },
        });
      }
      return prisma.lessonProgress.create({
        data: {
          tenantId: tenant.id,
          enrollmentId: linkedEnrollment.id,
          lessonId: def.lesson.id,
          status: def.status,
          lastPositionS: def.lastPositionS,
          completedAt: def.completedAt,
        },
      });
    }),
  );


  // ── Phase-4 sample data: certificate templates ─────────────────────────────────────────
  //
  // TWO seeded CertificateTemplates, one per award: students finishing a programme receive
  // an internship certificate, a training certificate, or both. The two differ ONLY in
  // `design.certificateKind`, which drives the ribbon heading and the noun in the body
  // sentence (see KIND_COPY in sync-certificate-pdf.adapter.ts) — everything else about
  // the artwork is shared, so the rest of the design JSON is deliberately identical.
  //
  // Ordering matters: `autoIssueOnCompletion` picks the first ACTIVE template when no
  // template is named, so the internship certificate is created first and is the default.

  // Directives consumed by SyncCertificatePdfAdapter (CertificateDesign). The earlier x/y
  // coordinate map was dead weight — that renderer lays the certificate out with flexbox,
  // so absolute positions were never read.
  //
  // The `*FileName` keys name images in the API's PRIVATE assets/certificate/ directory;
  // they are NOT URLs and are never served over HTTP (the authorised signature must not be
  // liftable from the web). Each is optional — an absent file simply is not drawn. See
  // apps/api/assets/certificate/README.md.
  const CERT_DESIGN_BASE = {
    orientation: "landscape",
    orgName: "STIMULI IQ",
    accentColor: "#14563C",
    textColor: "#1F2933",
    borderColor: "#14563C",
    backgroundColor: "#FFFFFF",
    signatoryName: "Chandra Sekhar",
    signatoryDesignation: "Founder",
    logoFileName: "logo.png",
    signatureFileName: "ceo-signature.png",
    isoBadgeFileName: "iso-badge.png",
    msmeBadgeFileName: "msme-badge.png",
    footerLines: ["Ministry of MSME, Govt. of India"],
  } as const;

  const CERT_FIELDS = [
    { key: "student_name", label: "Student Name" },
    { key: "program_title", label: "Program Title" },
    { key: "issued_at", label: "Date of Issue", format: "DD MMMM YYYY" },
    { key: "serial", label: "Certificate ID" },
  ];

  /**
   * ARTWORK MODE. Naming a file here switches the renderer from drawing the certificate in
   * code to printing the APPROVED EXPORT and stamping the student's values onto it — the
   * only way the result is identical to the design rather than a close copy of it.
   *
   * Seeded ahead of the files themselves on purpose: `loadCertificateAsset` returns
   * undefined for a name that is not on disk, and the adapter falls straight back to the
   * code-drawn certificate. So this is inert until the two blanks are dropped into
   * apps/api/assets/certificate/, and live the moment they are — no code change, no
   * re-seed. See that directory's README for what "blank" has to mean.
   */
  const CERT_ARTWORK: Record<"internship" | "training", string> = {
    internship: "internship-certificate-blank.png",
    training: "training-certificate-blank.png",
  };

  async function upsertCertTemplate(name: string, certificateKind: "internship" | "training") {
    const existing = await prisma.certificateTemplate.findFirst({
      where: { tenantId: tenant.id, name },
    });
    // Re-write `design` on an existing row rather than returning it untouched: the seed is
    // the source of truth for the approved artwork, and a template seeded before
    // `certificateKind` existed would otherwise keep rendering the old neutral wording.
    if (existing) {
      return prisma.certificateTemplate.update({
        where: { id: existing.id },
        data: { design: { ...CERT_DESIGN_BASE, certificateKind, artworkFileName: CERT_ARTWORK[certificateKind] }, fields: CERT_FIELDS, status: "active" },
      });
    }
    return prisma.certificateTemplate.create({
      data: {
        tenantId: tenant.id,
        name,
        design: { ...CERT_DESIGN_BASE, certificateKind, artworkFileName: CERT_ARTWORK[certificateKind] },
        fields: CERT_FIELDS,
        status: "active",
      },
    });
  }

  const certTemplate = await upsertCertTemplate("Stimuli IQ Internship Certificate", "internship");
  const trainingCertTemplate = await upsertCertTemplate("Stimuli IQ Training Certificate", "training");

  // ── Phase-4 sample data: assignment (with rubric) on fullstack lesson0 ───────────────
  //
  // An assignment of kind=assignment (not project) on "Semantic HTML" (lesson0).
  // Faculty: priya (faculty.priya@stimuliiq.test, the fullstack batch's faculty).
  // Student: ananya — one graded submission attached for the LMS view + CRM grading demos.

  const seedAssignment = await (async () => {
    const existing = await prisma.assignment.findFirst({
      where: { tenantId: tenant.id, lessonId: lesson0.id, title: "Semantic HTML Portfolio Critique" },
    });
    if (existing) return existing;
    return prisma.assignment.create({
      data: {
        tenantId: tenant.id,
        lessonId: lesson0.id,
        kind: AssignmentKind.assignment,
        title: "Semantic HTML Portfolio Critique",
        instructions:
          "Review the provided HTML snippet and refactor it using semantic elements (header, nav, main, section, article, aside, footer). Submit a ZIP file containing your refactored code and a brief justification text (max 300 words).",
        maxScore: 100,
        dueAt: new Date("2026-08-01T23:59:59Z"),
        allowResubmit: false,
        isFinal: false,
      },
    });
  })();

  // ── Phase-4 sample data: project (kind=project, 2 milestones) on lesson1 ─────────────
  //
  // A project assignment (is_final=true — marks this as the final-project gate for
  // certificate eligibility) on "Modern CSS & Flexbox" (lesson1). Two milestones:
  // M1 = Design Document, M2 = Final Implementation.

  const seedProject = await (async () => {
    const existing = await prisma.assignment.findFirst({
      where: { tenantId: tenant.id, lessonId: lesson1.id, title: "CSS Layout Final Project" },
    });
    if (existing) return existing;
    return prisma.assignment.create({
      data: {
        tenantId: tenant.id,
        lessonId: lesson1.id,
        kind: AssignmentKind.project,
        title: "CSS Layout Final Project",
        instructions:
          "Build a responsive landing page using only CSS Flexbox (no Grid, no frameworks). " +
          "Milestone 1: Submit a wireframe design doc (PDF). " +
          "Milestone 2: Submit the final implementation (HTML+CSS ZIP with README).",
        maxScore: 200,
        dueAt: new Date("2026-09-01T23:59:59Z"),
        allowResubmit: true,
        // is_final=true: the eligibility engine uses this project's approval as the
        // "final project approved" gate for certificate issuance.
        isFinal: true,
      },
    });
  })();

  const [seedMilestone1, seedMilestone2] = await Promise.all([
    (async () => {
      const existing = await prisma.assignmentMilestone.findFirst({
        where: { tenantId: tenant.id, assignmentId: seedProject.id, title: "Design Document" },
      });
      if (existing) return existing;
      return prisma.assignmentMilestone.create({
        data: {
          tenantId: tenant.id,
          assignmentId: seedProject.id,
          title: "Design Document",
          order: 1,
          dueAt: new Date("2026-08-15T23:59:59Z"),
        },
      });
    })(),
    (async () => {
      const existing = await prisma.assignmentMilestone.findFirst({
        where: { tenantId: tenant.id, assignmentId: seedProject.id, title: "Final Implementation" },
      });
      if (existing) return existing;
      return prisma.assignmentMilestone.create({
        data: {
          tenantId: tenant.id,
          assignmentId: seedProject.id,
          title: "Final Implementation",
          order: 2,
          dueAt: new Date("2026-09-01T23:59:59Z"),
        },
      });
    })(),
  ]);
  if (!seedMilestone1 || !seedMilestone2) {
    throw new Error("[seed] expected 2 project milestones to exist after upsert");
  }

  // ── Phase-4 sample data: submission (Ananya's graded assignment submission) ─────────
  //
  // One graded submission for Ananya (linkedEnrollment) on seedAssignment.
  // status=graded, score=87/100, with a rubric JSON + feedback.
  // files: stub StorageProvider key (signed URL minted on demand, not stored here).

  const priyaFacultyUser = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email: "faculty.priya@stimuliiq.test" } },
  });
  if (!priyaFacultyUser) {
    throw new Error("[seed] expected priya faculty user to exist");
  }

  const seedSubmission = await (async () => {
    const existing = await prisma.submission.findFirst({
      where: { tenantId: tenant.id, assignmentId: seedAssignment.id, enrollmentId: linkedEnrollment.id },
    });
    if (existing) return existing;
    return prisma.submission.create({
      data: {
        tenantId: tenant.id,
        assignmentId: seedAssignment.id,
        milestoneId: null,
        enrollmentId: linkedEnrollment.id,
        files: ["submissions/stimuliiq/ananya-enrollment/assignment-semantic-html/portfolio-refactor.zip"],
        text: "Refactored the provided snippet using semantic elements. See attached ZIP for code + justification.",
        link: null,
        attemptNo: 1,
        status: SubmissionStatus.graded,
        score: 87,
        rubric: {
          criteria: [
            { name: "Semantic HTML Usage", maxPoints: 40, awarded: 36, comment: "Excellent use of section/article/aside." },
            { name: "Code Quality", maxPoints: 30, awarded: 28, comment: "Clean and readable; minor whitespace issues." },
            { name: "Justification Text", maxPoints: 30, awarded: 23, comment: "Good reasoning; could elaborate on accessibility benefits." },
          ],
        },
        feedback:
          "Strong submission overall. Your use of semantic elements is spot-on. " +
          "Minor note: add `aria-label` to the nav element for better screen reader support.",
        gradedById: priyaFacultyUser.id,
        gradedAt: new Date("2026-07-01T14:30:00Z"),
      },
    });
  })();

  // ── Phase-4 sample data: assessment (2 MCQ + 1 descriptive, is_required=true) ────────
  //
  // An assessment on the fullstack program's first module (HTML/CSS/JS Foundations).
  // is_required=true → must be passed to earn a certificate.
  // 2 MCQ questions + 1 descriptive question, with server-only answer keys.

  const seedAssessment = await (async () => {
    const existing = await prisma.assessment.findFirst({
      where: { tenantId: tenant.id, moduleId: fullstackModule1.id, title: "HTML Fundamentals Quiz" },
    });
    if (existing) return existing;
    return prisma.assessment.create({
      data: {
        tenantId: tenant.id,
        moduleId: fullstackModule1.id,
        title: "HTML Fundamentals Quiz",
        type: AssessmentType.quiz,
        timeLimitS: 1800, // 30 minutes
        passPct: 60,
        attemptsAllowed: 3,
        shuffle: true,
        // is_required=true: passing this assessment is mandatory for certificate eligibility.
        isRequired: true,
      },
    });
  })();

  // MCQ Question 1: which element is semantic?
  const seedQuestion1 = await (async () => {
    const existing = await prisma.assessmentQuestion.findFirst({
      where: { tenantId: tenant.id, assessmentId: seedAssessment.id, order: 1 },
    });
    if (existing) return existing;
    return prisma.assessmentQuestion.create({
      data: {
        tenantId: tenant.id,
        assessmentId: seedAssessment.id,
        type: QuestionType.mcq,
        prompt: "Which of the following HTML elements is a semantic element?",
        // options: choice text only, NO is_correct field (answer-key isolation).
        options: [
          { id: "opt-a", text: "<div>" },
          { id: "opt-b", text: "<span>" },
          { id: "opt-c", text: "<article>" },
          { id: "opt-d", text: "<b>" },
        ],
        // answer_key: SERVER-ONLY — the correct option id. Never in any student DTO.
        answerKey: { correctOptionId: "opt-c" },
        points: 10,
        order: 1,
      },
    });
  })();

  // MCQ Question 2: what does the <header> element represent?
  const seedQuestion2 = await (async () => {
    const existing = await prisma.assessmentQuestion.findFirst({
      where: { tenantId: tenant.id, assessmentId: seedAssessment.id, order: 2 },
    });
    if (existing) return existing;
    return prisma.assessmentQuestion.create({
      data: {
        tenantId: tenant.id,
        assessmentId: seedAssessment.id,
        type: QuestionType.mcq,
        prompt: "The HTML <header> element is used for:",
        options: [
          { id: "opt-a", text: "The main heading of the entire page only" },
          { id: "opt-b", text: "Introductory content or a group of navigational aids" },
          { id: "opt-c", text: "The document's <head> metadata section" },
          { id: "opt-d", text: "Bold text formatting" },
        ],
        answerKey: { correctOptionId: "opt-b" },
        points: 10,
        order: 2,
      },
    });
  })();

  // Descriptive Question 3: explain semantic HTML benefits.
  const seedQuestion3 = await (async () => {
    const existing = await prisma.assessmentQuestion.findFirst({
      where: { tenantId: tenant.id, assessmentId: seedAssessment.id, order: 3 },
    });
    if (existing) return existing;
    return prisma.assessmentQuestion.create({
      data: {
        tenantId: tenant.id,
        assessmentId: seedAssessment.id,
        type: QuestionType.descriptive,
        prompt:
          "Explain in 3–5 sentences why using semantic HTML elements improves accessibility and SEO.",
        options: null, // descriptive — no MCQ choices
        // answer_key for descriptive: rubric guidance for manual grading. SERVER-ONLY.
        answerKey: {
          rubric: [
            { criterion: "Accessibility benefit", maxPoints: 5, hint: "Screen readers interpret semantic elements correctly." },
            { criterion: "SEO benefit", maxPoints: 5, hint: "Search engines assign meaning/weight based on semantic structure." },
            { criterion: "Maintainability", maxPoints: 5, hint: "Code is self-documenting; easier for teams." },
          ],
        },
        points: 15,
        order: 3,
      },
    });
  })();
  void seedQuestion1;
  void seedQuestion2;
  void seedQuestion3;

  // ── Phase-4 sample data: attempt (graded, for Ananya on seedAssessment) ──────────────
  //
  // A graded attempt for Ananya on "HTML Fundamentals Quiz".
  // MCQ answers: Q1 → opt-c (correct), Q2 → opt-b (correct). Descriptive Q3 manually graded.
  // score = 35/35 → passed = true (score >= 60% of 35 = 21).

  const seedAttempt = await (async () => {
    const existing = await prisma.attempt.findFirst({
      where: { tenantId: tenant.id, assessmentId: seedAssessment.id, enrollmentId: linkedEnrollment.id },
    });
    if (existing) return existing;
    const startedAt = new Date("2026-06-30T09:00:00Z");
    const submittedAt = new Date("2026-06-30T09:22:00Z");
    return prisma.attempt.create({
      data: {
        tenantId: tenant.id,
        assessmentId: seedAssessment.id,
        enrollmentId: linkedEnrollment.id,
        answers: {
          [seedQuestion1.id]: "opt-c",  // correct MCQ answer
          [seedQuestion2.id]: "opt-b",  // correct MCQ answer
          [seedQuestion3.id]: "Semantic HTML elements like <header>, <nav>, <main>, and <article> help screen readers identify page structure for better accessibility. Search engines also use these elements to understand content hierarchy, improving SEO rankings. Additionally, semantic HTML makes code more self-documenting and easier for teams to maintain.",
        },
        score: 35, // 10 + 10 + 15 — all correct, full marks
        passed: true,
        startedAt,
        submittedAt,
        timeExpiresAt: new Date(startedAt.getTime() + 1800 * 1000), // 30 min from start
        flags: { tabSwitchCount: 0 },
        attemptNo: 1,
      },
    });
  })();

  // ── Phase-4 sample data: second enrollment (Sneha, blrBatch, data-science) ───────────
  //
  // Sneha (student.sneha@stimuliiq.test) is already enrolled in blrBatch on dataScienceProgram
  // with status=completed, progressPct=100 (from the P1 enrollment seed above).
  // We re-find her enrollment to attach the issued certificate.
  //
  // For the certificate to be truthfully "eligible" per the eligibility rule:
  //   progress_pct >= 90 → 100 >= 90 ✓ (already seeded)
  //   all is_required assessments passed → the only is_required assessment (seedAssessment)
  //     is on fullstackModule1 in fullstackProgram, NOT dataScienceProgram. Sneha is in
  //     dataScienceProgram which has no is_required assessments yet → vacuously true ✓.
  //   final project approved → no is_final project on dataScienceProgram → vacuously true ✓.
  // All three gates satisfied → eligible → issue certificate.

  const snehaProfile = studentProfiles[2]; // student.sneha@stimuliiq.test
  if (!snehaProfile) {
    throw new Error("[seed] expected sneha student profile to exist");
  }

  const snehaEnrollment = await prisma.enrollment.findFirst({
    where: { studentId: snehaProfile.id, batchId: blrBatch.id },
  });
  if (!snehaEnrollment) {
    throw new Error("[seed] expected sneha enrollment in blrBatch to exist");
  }

  // Ensure Sneha's enrollment is marked completed with progress_pct=100.
  if (snehaEnrollment.progressPct < 100 || snehaEnrollment.status !== "completed") {
    await prisma.enrollment.update({
      where: { id: snehaEnrollment.id },
      data: { status: "completed", progressPct: 100, completedAt: new Date("2026-06-20T10:00:00Z") },
    });
  }

  // ── Phase-4 sample data: issued certificate for Sneha ────────────────────────────────
  //
  // One ISSUED certificate on Sneha's completed data-science enrollment.
  // cert_uid: a deterministic signed-hash placeholder for local dev (the real cert_uid
  //   signing logic lives in the CertificatePdfPort / cert-uid service (task #4);
  //   for seed purposes we use a stable pseudo-uid that the integration test can look up.
  //   The PUBLIC VERIFY route will RECOMPUTE the signature; this seed value is a dev stub.
  //   In production, cert_uid is generated by the CertificateService.issue() method.
  // storage_key: stub S3/R2 key (PDF not yet generated in seed; signed URL minted on demand).
  // issued_by: the admin user (ops role in a real deployment; admin for seed convenience).

  const adminUser = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email: ADMIN_EMAIL } },
  });
  if (!adminUser) {
    throw new Error("[seed] expected admin user to exist");
  }

  // A REAL, HMAC-signed cert_uid — not a readable stub.
  //
  // The public /verify/:certUid route RECOMPUTES this signature (apps/api/src/modules/
  // certificates/cert-uid.util.ts) and 404s anything that doesn't check out. The old
  // seed value ("seed-cert-stimuliiq-…") was an unsigned placeholder, so the seeded
  // certificate could never be verified — the Verify link always landed on "Certificate
  // Not Found", which read as a broken feature rather than fake data.
  //
  // Wire format (must stay in lockstep with signCertUid): base64url(JSON {s,p,i,n})
  // + "." + base64url(HMAC-SHA256(body, secret)). The secret resolves exactly as the
  // API resolves it in dev: CERT_SIGNING_SECRET, else the same local-only fallback.
  const SEED_CERT_ISSUED_AT = new Date("2026-06-20T12:00:00Z");
  const SEED_CERT_UID = (() => {
    const secret =
      process.env.CERT_SIGNING_SECRET ??
      "LOCAL-DEV-ONLY-cert-signing-secret-not-for-production-use-0000";
    const body = Buffer.from(
      JSON.stringify({
        s: snehaProfile.id,
        p: dataScienceProgram.id,
        i: Math.floor(SEED_CERT_ISSUED_AT.getTime() / 1000),
        // Deterministic nonce: re-seeding must not mint a different uid for the same
        // certificate (the row is upserted by enrollment, and docs/tests cite this uid).
        n: "seedseedseed",
      }),
      "utf-8",
    ).toString("base64url");
    const sig = createHmac("sha256", secret).update(body).digest().toString("base64url");
    return `${body}.${sig}`;
  })();

  // Deterministic short serial for the demo cert — the human-typeable public ID printed
  // on the certificate (STMQ-YYYY-XXXX-XXXX, Crockford base32). Stable across re-seeds so
  // docs/tests can cite it. The long SEED_CERT_UID stays the QR/link id.
  const SEED_CERT_SERIAL = "STMQ-2026-SNEH-0001";

  const seedCertificate = await (async () => {
    const existing = await prisma.certificate.findFirst({
      where: { enrollmentId: snehaEnrollment.id },
    });
    if (existing) {
      // Heal a certificate seeded before uids were signed / before serials existed:
      // an unsigned uid (no "." separator) can never pass /verify, and a row from before
      // this migration would have a random backfilled serial. Re-set both in place — they
      // are lookup handles, not user data — so an existing dev DB gets the stable demo IDs
      // without a wipe.
      const needsUidHeal = !existing.certUid.includes(".");
      const needsSerialHeal = existing.serial !== SEED_CERT_SERIAL;
      if (needsUidHeal || needsSerialHeal) {
        return prisma.certificate.update({
          where: { id: existing.id },
          data: {
            ...(needsUidHeal ? { certUid: SEED_CERT_UID, issuedAt: SEED_CERT_ISSUED_AT } : {}),
            serial: SEED_CERT_SERIAL,
          },
        });
      }
      return existing;
    }
    return prisma.certificate.create({
      data: {
        tenantId: tenant.id,
        enrollmentId: snehaEnrollment.id,
        studentId: snehaProfile.id,
        programId: dataScienceProgram.id,
        certUid: SEED_CERT_UID,
        serial: SEED_CERT_SERIAL,
        templateId: certTemplate.id,
        storageKey: null, // stub — PDF not generated in seed (CertificatePdfPort deferred)
        issuedAt: SEED_CERT_ISSUED_AT,
        issuedById: adminUser.id,
        status: CertificateStatus.valid,
        revokedReason: null,
        revokedById: null,
        revokedAt: null,
      },
    });
  })();

  // ── Phase-6 role-permission grants (docs/plans/phase-6.md §2 "Seed expansion") ─────────

  function p6permId(key: string): string {
    return permId(key);
  }

  // super_admin + admin: already granted ALL permissions above (the catch-all above covers new P6 perms).

  // marketing: full campaigns access at all scope.
  const marketingCampaignGrants: string[] = [
    "campaigns.view",
    "campaigns.create",
    "campaigns.edit",
    "campaigns.send",
    "campaigns.delete",
  ];
  await Promise.all(
    marketingCampaignGrants.map((key) =>
      grant(marketingRole!.id, p6permId(key), RolePermissionScope.all),
    ),
  );

  // branch_manager: view + edit campaigns at branch scope (oversight).
  await grant(branchManagerRole!.id, p6permId("campaigns.view"), RolePermissionScope.branch);
  await grant(branchManagerRole!.id, p6permId("campaigns.edit"), RolePermissionScope.branch);

  // All authed roles: notifications.view at own scope.
  // Apply to every defined role (all users can view their own notifications).
  const allRoles = [
    superAdminRole, adminRole, branchManagerRole, counsellorRole,
    facultyRole, financeRole, marketingRole, supportRole, contentEditorRole, studentRole,
  ];
  await Promise.all(
    allRoles.map((role) =>
      grant(role!.id, p6permId("notifications.view"), RolePermissionScope.own),
    ),
  );

  // All authed roles: notification_prefs.edit at own scope (everyone edits their OWN prefs).
  await Promise.all(
    allRoles.map((role) =>
      grant(role!.id, p6permId("notification_prefs.edit"), RolePermissionScope.own),
    ),
  );

  // All authed roles: gamification.view at own scope (leaderboard + badges are own-scope).
  await Promise.all(
    allRoles.map((role) =>
      grant(role!.id, p6permId("gamification.view"), RolePermissionScope.own),
    ),
  );

  // forum.read: everyone can read the forum, scope mirrors their forum footprint (the
  // service still enforces enrollment/assigned data-scope + IDOR→404). Students & non-
  // teaching staff read own-enrolled context; faculty read assigned batches; branch_manager
  // reads their branch; admin/super_admin/content_editor read all.
  await Promise.all(
    [studentRole, counsellorRole, financeRole, marketingRole, supportRole].map((role) =>
      grant(role!.id, p6permId("forum.read"), RolePermissionScope.own),
    ),
  );
  await grant(facultyRole!.id, p6permId("forum.read"), RolePermissionScope.assigned);
  await grant(branchManagerRole!.id, p6permId("forum.read"), RolePermissionScope.branch);
  await Promise.all(
    [superAdminRole, adminRole, contentEditorRole].map((role) =>
      grant(role!.id, p6permId("forum.read"), RolePermissionScope.all),
    ),
  );

  // Student: forum.post at own scope (post in enrolled batches — IDOR→404 at service layer).
  await grant(studentRole!.id, p6permId("forum.post"), RolePermissionScope.own);

  // Faculty: forum.post at assigned scope (post + reply in their assigned batches).
  await grant(facultyRole!.id, p6permId("forum.post"), RolePermissionScope.assigned);
  // Faculty: forum.moderate at assigned scope (hide/pin/delete in their assigned batches).
  await grant(facultyRole!.id, p6permId("forum.moderate"), RolePermissionScope.assigned);

  // branch_manager: forum.moderate at branch scope (oversight across branch's batches).
  await grant(branchManagerRole!.id, p6permId("forum.moderate"), RolePermissionScope.branch);

  // content_editor: forum.moderate at all scope (content platform oversight).
  await grant(contentEditorRole!.id, p6permId("forum.moderate"), RolePermissionScope.all);

  // ── Phase-7 role-permission grants (docs/specs/phase-7-analytics-hardening.md Part 8) ──
  //
  // super_admin + admin: already granted ALL permissions above (the catch-all covers the
  // new P7 reports.* perms too — see the P4/P6 comment above for that pattern).

  function p7permId(key: string): string {
    return permId(key);
  }

  // branch_manager: revenue/enrollment/engagement at branch scope.
  await grant(branchManagerRole!.id, p7permId("reports.revenue.view"), RolePermissionScope.branch);
  await grant(branchManagerRole!.id, p7permId("reports.enrollment.view"), RolePermissionScope.branch);
  await grant(branchManagerRole!.id, p7permId("reports.funnel.view"), RolePermissionScope.branch);
  await grant(branchManagerRole!.id, p7permId("reports.engagement.view"), RolePermissionScope.branch);

  // branch_manager: lead performance for their own branches' reps.
  await grant(branchManagerRole!.id, p7permId("reports.lead_performance.view"), RolePermissionScope.branch);

  // counsellor: own-scope funnel/conversion report only.
  // Deliberately NOT granted reports.lead_performance.view — a counsellor seeing every
  // colleague's conversion numbers is a management decision, not a default. Their own
  // work is already visible to them through My Work and the pipeline's "Assigned to me".
  await grant(counsellorRole!.id, p7permId("reports.funnel.view"), RolePermissionScope.own);

  // faculty: assigned-scope enrollment/engagement/gamification/forum-health
  // (their own assigned batches' rosters — IDOR->404 for any other batch).
  await grant(facultyRole!.id, p7permId("reports.enrollment.view"), RolePermissionScope.assigned);
  await grant(facultyRole!.id, p7permId("reports.engagement.view"), RolePermissionScope.assigned);
  await grant(facultyRole!.id, p7permId("reports.gamification.view"), RolePermissionScope.assigned);
  await grant(facultyRole!.id, p7permId("reports.forum.view"), RolePermissionScope.assigned);

  // finance: revenue report at all scope (finance domain — tenant-wide payment reconciliation).
  await grant(financeRole!.id, p7permId("reports.revenue.view"), RolePermissionScope.all);

  // marketing: campaign-performance report at all scope (reuses P6 campaigns.view's grant
  // shape — Part 8 table explicitly excludes branch_manager from this one dashboard).
  await grant(marketingRole!.id, p7permId("reports.campaigns.view"), RolePermissionScope.all);

  // marketing: lead performance at all scope — marketing owns lead generation end to end
  // here (tenant-wide `leads.*` grants), so they need to see the whole team's throughput,
  // not just campaign-level numbers.
  await grant(marketingRole!.id, p7permId("reports.lead_performance.view"), RolePermissionScope.all);

  // reports.export (docs/plans/phase-7.md task #8, Part 8 grant table): a single flat
  // permission whose SCOPE determines which rows an export can touch (via
  // ExportsService reusing each domain's own scoped query, Rule H-2); ExportsService
  // additionally requires the caller to hold the matching per-type `.view`/entity
  // permission before generating (AC-34), so the scope granted here only ever narrows
  // what a role could otherwise already export, never widens it. super_admin/admin are
  // covered by the catch-all (grant every catalog permission at scope=all).
  await grant(branchManagerRole!.id, p7permId("reports.export"), RolePermissionScope.branch);
  await grant(counsellorRole!.id, p7permId("reports.export"), RolePermissionScope.own);
  await grant(facultyRole!.id, p7permId("reports.export"), RolePermissionScope.assigned);
  await grant(financeRole!.id, p7permId("reports.export"), RolePermissionScope.all);
  await grant(marketingRole!.id, p7permId("reports.export"), RolePermissionScope.all);

  // reports.schedule (Wave 2 task #11): recurring report-schedule CRUD — granted to the
  // exact same roles/scopes as reports.export (a role that can export on-demand can also
  // schedule the same report recurring). super_admin/admin covered by the catch-all.
  await grant(branchManagerRole!.id, p7permId("reports.schedule"), RolePermissionScope.branch);
  await grant(counsellorRole!.id, p7permId("reports.schedule"), RolePermissionScope.own);
  await grant(facultyRole!.id, p7permId("reports.schedule"), RolePermissionScope.assigned);
  await grant(financeRole!.id, p7permId("reports.schedule"), RolePermissionScope.all);
  await grant(marketingRole!.id, p7permId("reports.schedule"), RolePermissionScope.all);

  // ── Phase-8 Mentor role-permission grants (this task's brief) ───────────────────────────
  //
  // super_admin + admin: already granted ALL permissions above (the catch-all covers the
  // new P8 mentors.*/mentor.dashboard.view perms too — see the P4/P6/P7 comment pattern).

  function p8permId(key: string): string {
    return permId(key);
  }

  // branch_manager: manage mentors (CRM directory CRUD + batch assignment) at branch
  // scope — mirrors the branch_manager grant shape already used for
  // students/faculty/batches (docs/03 §9 "BranchMgr" row).
  const branchManagerMentorGrants: string[] = [
    "mentors.view",
    "mentors.create",
    "mentors.edit",
    "mentors.delete",
    "mentors.assign",
  ];
  await Promise.all(
    branchManagerMentorGrants.map((key) =>
      grant(branchManagerRole!.id, p8permId(key), RolePermissionScope.branch),
    ),
  );

  // branch_manager: batches.markComplete at branch scope (LOCK-5 — narrower than
  // batches.edit; a branch manager can close out a program run for any batch in their
  // own branch without gaining the broader batches.edit capability set beyond what they
  // already hold from the P1 grants above).
  await grant(branchManagerRole!.id, p8permId("batches.markComplete"), RolePermissionScope.branch);

  // mentor: the new role's OWN dashboard — mentor.dashboard.view at ASSIGNED scope
  // (mirrors the faculty "assigned" scope pattern: a mentor sees only the batches they
  // are assigned to via `batch_mentors`, resolved server-side and never client-trusted —
  // the Wave-2 backend's mentor analogue of
  // `EnrollmentScopeRepository.resolveBatchIdsForFaculty`).
  await grant(mentorRole!.id, p8permId("mentor.dashboard.view"), RolePermissionScope.assigned);

  // mentor: batches.view at ASSIGNED scope (Wave-2 backend-builder task brief + Part 7
  // RBAC table) — `batches.view` already exists in the catalog (P1_MODULES × P1_ACTIONS
  // cross-product), this is simply a NEW grant of that EXISTING permission to the new
  // mentor role, resolved server-side via `EnrollmentScopeRepository
  // .resolveBatchIdsForMentor` (batch_mentors join, LOCK-2/Rule M-1) rather than
  // `batches.facultyId`. Lets a mentor GET their assigned batch's mentor list
  // (/crm/batches/:id/mentors) and completion rollup (/crm/batches/:id/completion(+
  // /students)) — the SAME permission Admin/BranchMgr already use for those reads.
  await grant(mentorRole!.id, permId("batches.view"), RolePermissionScope.assigned);

  // mentor: batches.markComplete at ASSIGNED scope (AC-38 — every actively-assigned
  // mentor, lead or not, may mark their own batch complete).
  await grant(mentorRole!.id, p8permId("batches.markComplete"), RolePermissionScope.assigned);

  // mentor: mirrors the P7 "Faculty / Mentor" combined report grants (docs/specs/
  // phase-7-analytics-hardening.md Part 8) onto the NEW mentor role explicitly — those
  // grants previously only named the `faculty` role key even though the P7 spec's own
  // label conflated "Faculty/Mentor" (see docs/specs/phase-8-mentor.md Part 6
  // CONFLICT-P8-MENTOR-1 + Part 7 dependencies table). Assigned scope, same as faculty.
  await grant(mentorRole!.id, p7permId("reports.engagement.view"), RolePermissionScope.assigned);

  // ── Phase-8 Mentor sample data (a couple mentors + one batch_mentor assignment) ─────────
  //
  // mentorRamesh: given a dashboard login (userId set) — demonstrates the "mentor WITH
  //   login" case from this task's brief; assigned as LEAD mentor on hydBatch.
  // mentorAnjali: prospective, NO login yet (userId stays null) — demonstrates "a mentor
  //   record can exist before they have a login".
  const { id: mentorRameshUserId } = await ensureSeedUser({
    tenantId: tenant.id,
    email: "mentor.ramesh@stimuliiq.test",
    name: "Dr. Ramesh Kulkarni",
    roleId: roleId("mentor"),
    branchId: null,
  });

  const mentorRamesh = await (async () => {
    const existing = await prisma.mentor.findFirst({
      where: { tenantId: tenant.id, email: "mentor.ramesh@stimuliiq.test", deletedAt: null },
    });
    const data = {
      tenantId: tenant.id,
      userId: mentorRameshUserId,
      fullName: "Dr. Ramesh Kulkarni",
      email: "mentor.ramesh@stimuliiq.test",
      phone: "+91-9000000001",
      externalInstitute: "IIT Hyderabad",
      expertise: ["Distributed Systems", "Cloud Architecture", "System Design"],
      engagementStatus: MentorEngagementStatus.active,
      joinedAt: new Date("2026-01-05"),
      notes: "Leads the Full-Stack Web Dev HYD-01 batch as an external subject-matter expert.",
    };
    return existing
      ? prisma.mentor.update({ where: { id: existing.id }, data })
      : prisma.mentor.create({ data });
  })();

  const mentorAnjali = await (async () => {
    const existing = await prisma.mentor.findFirst({
      where: { tenantId: tenant.id, email: "mentor.anjali@stimuliiq.test", deletedAt: null },
    });
    const data = {
      tenantId: tenant.id,
      userId: null,
      fullName: "Anjali Rao",
      email: "mentor.anjali@stimuliiq.test",
      phone: null,
      externalInstitute: "IIIT Bangalore",
      expertise: ["Machine Learning", "Data Engineering"],
      engagementStatus: MentorEngagementStatus.prospective,
      joinedAt: null,
      notes: "Sourced for the Data Science & ML track; onboarding pending — no dashboard login yet.",
    };
    return existing
      ? prisma.mentor.update({ where: { id: existing.id }, data })
      : prisma.mentor.create({ data });
  })();

  // batch_mentors: assign Ramesh as LEAD mentor on hydBatch. Idempotent by
  // (tenant_id, batch_id, mentor_id) among active rows — the partial-unique
  // `batch_mentors_active_batch_mentor_key` WHERE deleted_at IS NULL is the DB backstop.
  const existingBatchMentor = await prisma.batchMentor.findFirst({
    where: { tenantId: tenant.id, batchId: hydBatch.id, mentorId: mentorRamesh.id, deletedAt: null },
  });
  if (!existingBatchMentor) {
    await prisma.batchMentor.create({
      data: {
        tenantId: tenant.id,
        batchId: hydBatch.id,
        mentorId: mentorRamesh.id,
        isLead: true,
        assignedAt: new Date("2026-01-10"),
        assignedByUserId: adminUser.id,
      },
    });
  } else if (!existingBatchMentor.isLead) {
    await prisma.batchMentor.update({
      where: { id: existingBatchMentor.id },
      data: { isLead: true },
    });
  }
  void mentorAnjali;

  // ── Phase-6 seed: default notification_prefs for sample users ───────────────────────────
  //
  // Default prefs: all channels enabled for grade_ready, certificate_ready,
  // announcement, welcome. Marketing channels (email, sms, whatsapp) opt-in for forum_reply.
  // quiet_hours: 22:00-08:00 IST for the student (typical student schedule).
  // Idempotent: upsert on unique user_id.

  const defaultMatrix = {
    grade_ready:         { in_app: true, email: true, sms: false, whatsapp: false },
    certificate_ready:   { in_app: true, email: true, sms: false, whatsapp: false },
    live_reminder:       { in_app: true, email: true, sms: false, whatsapp: false },
    forum_reply:         { in_app: true, email: false, sms: false, whatsapp: false },
    announcement:        { in_app: true, email: true, sms: false, whatsapp: false },
    lead_confirmation:   { in_app: true, email: true, sms: false, whatsapp: false },
    booking_confirmation:{ in_app: true, email: true, sms: false, whatsapp: false },
    payment_receipt:     { in_app: true, email: true, sms: false, whatsapp: false },
    welcome:             { in_app: true, email: true, sms: false, whatsapp: false },
  };

  const ananyaUser = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email: "student.ananya@stimuliiq.test" } },
  });
  const priyaUser = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email: "faculty.priya@stimuliiq.test" } },
  });
  if (!ananyaUser || !priyaUser) {
    throw new Error("[seed] expected ananya + priya users to exist for notification prefs");
  }

  const prefUsers: Array<{ user: typeof ananyaUser; quietHours: object | null }> = [
    {
      user: ananyaUser,
      quietHours: { start: "22:00", end: "08:00", tz: "Asia/Kolkata" },
    },
    {
      user: priyaUser,
      quietHours: null, // faculty — no quiet hours
    },
    {
      user: adminUser, // adminUser looked up above in P4 section
      quietHours: null,
    },
  ];

  for (const { user, quietHours } of prefUsers) {
    await prisma.notificationPref.upsert({
      where: { userId: user.id },
      update: { matrix: defaultMatrix, quietHours: quietHours ?? undefined },
      create: {
        tenantId: tenant.id,
        userId: user.id,
        matrix: defaultMatrix,
        quietHours: quietHours ?? undefined,
      },
    });
  }

  // ── Phase-6 seed: badges catalog (docs/02 §19) ────────────────────────────────────────
  //
  // Seeded badges per docs/02 §19: first project approved, perfect attendance,
  // top of batch, streak milestones (7 days, 30 days).
  // Idempotent by (tenant_id, key) WHERE deleted_at IS NULL (partial-unique in migration).
  // The Prisma @@unique([tenantId, key]) on Badge provides the upsert key.

  const badgeDefs = [
    {
      key: "first_project_approved",
      name: "First Project Approved",
      description: "Awarded when your first project submission is approved by a faculty mentor.",
      icon: "trophy",
      criteria: { event: "project_approved", condition: { firstTime: true } },
    },
    {
      // DORMANT since the attendance feature was removed: nothing computes
      // `attendancePct` any more, so this badge can no longer be earned. Kept in the
      // catalog deliberately — `student_badges` rows awarded before the removal
      // reference this row, and dropping it would orphan them. Delete it only alongside
      // those awards, or repoint the criteria at lesson completion instead.
      key: "perfect_attendance",
      name: "Perfect Attendance",
      description: "Awarded for completing all recorded lessons in a batch without missing any.",
      icon: "calendar-check",
      criteria: { event: "batch_completed", condition: { attendancePct: 100 } },
    },
    {
      key: "top_of_batch",
      name: "Top of Batch",
      description: "Awarded for achieving the highest total points in a batch leaderboard.",
      icon: "star-medal",
      criteria: { event: "leaderboard_finalized", condition: { rank: 1 } },
    },
    {
      key: "streak_7_days",
      name: "7-Day Learning Streak",
      description: "Awarded for completing at least one lesson every day for 7 consecutive days.",
      icon: "flame",
      criteria: { event: "streak_day", condition: { streakDays: 7 } },
    },
    {
      key: "streak_30_days",
      name: "30-Day Learning Streak",
      description: "Awarded for completing at least one lesson every day for 30 consecutive days.",
      icon: "flame-gold",
      criteria: { event: "streak_day", condition: { streakDays: 30 } },
    },
  ] as const;

  const seedBadges = await Promise.all(
    badgeDefs.map(async (def) => {
      return prisma.badge.upsert({
        where: { tenantId_key: { tenantId: tenant.id, key: def.key } },
        update: { name: def.name, description: def.description, icon: def.icon, criteria: def.criteria, status: "active" },
        create: {
          tenantId: tenant.id,
          key: def.key,
          name: def.name,
          description: def.description,
          icon: def.icon,
          criteria: def.criteria,
          status: "active",
        },
      });
    }),
  );

  const [badgeFirstProject, badgePerfectAttendance, badgeTopBatch, badgeStreak7, badgeStreak30] = seedBadges;
  if (!badgeFirstProject || !badgePerfectAttendance || !badgeTopBatch || !badgeStreak7 || !badgeStreak30) {
    throw new Error("[seed] expected 5 badges to exist after upsert");
  }

  // ── Phase-6 seed: one user_badge for Ananya (first_project_approved) ──────────────────
  //
  // Partial-unique (user_id, badge_id) WHERE deleted_at IS NULL enforced in DB.
  // Idempotent: find-then-create on (userId, badgeId, deleted_at IS NULL).
  // ref: the seedProject id as the source event reference.

  const ananyaBadge = await (async () => {
    const existing = await prisma.userBadge.findFirst({
      where: { userId: ananyaUser.id, badgeId: badgeFirstProject.id, deletedAt: null },
    });
    if (existing) return existing;
    return prisma.userBadge.create({
      data: {
        tenantId: tenant.id,
        userId: ananyaUser.id,
        badgeId: badgeFirstProject.id,
        awardedAt: new Date("2026-07-01T15:00:00Z"),
        ref: `project:${seedProject.id}`,
      },
    });
  })();

  // ── Phase-6 seed: points_ledger rows (leaderboard-renderable set) ─────────────────────
  //
  // 3 rows for Ananya, 2 rows for Sneha.
  // Partial-unique (user_id, reason, ref) WHERE deleted_at IS NULL AND ref IS NOT NULL.
  // Idempotent: find-then-create on (userId, reason, ref, deletedAt IS NULL).
  //
  // Total points:
  //   Ananya: 50 + 30 + 10 = 90 XP
  //   Sneha: 50 + 100 = 150 XP (leaderboard rank 1)

  const ledgerDefs = [
    // Ananya
    {
      userId: ananyaUser.id,
      delta: 50,
      reason: "project_approved",
      ref: `project:${seedProject.id}`,
    },
    {
      userId: ananyaUser.id,
      delta: 30,
      reason: "assessment_passed",
      ref: `attempt:${seedAttempt.id}`,
    },
    {
      userId: ananyaUser.id,
      delta: 10,
      reason: "lesson_completed",
      ref: `lesson:${lesson0.id}`,
    },
    // Sneha (alumna, completed program with certificate)
    {
      userId: snehaProfile.userId,
      delta: 50,
      reason: "certificate_issued",
      ref: `certificate:${seedCertificate.id}`,
    },
    {
      userId: snehaProfile.userId,
      delta: 100,
      reason: "batch_completed",
      ref: `enrollment:${snehaEnrollment.id}`,
    },
  ];

  for (const def of ledgerDefs) {
    const existing = await prisma.pointsLedger.findFirst({
      where: { userId: def.userId, reason: def.reason, ref: def.ref, deletedAt: null },
    });
    if (!existing) {
      await prisma.pointsLedger.create({
        data: {
          tenantId: tenant.id,
          userId: def.userId,
          delta: def.delta,
          reason: def.reason,
          ref: def.ref,
        },
      });
    }
  }

  // ── Phase-6 seed: campaign templates (one per channel) ───────────────────────────────
  //
  // Email: no DLT id required.
  // WhatsApp + SMS: PLACEHOLDER dlt_template_id (India DLT-registered ids are user-supplied
  //   in prod; the seed uses a placeholder so the service can be exercised in tests).
  //   Production: replace "DLT_PLACEHOLDER_*" with real approved DLT template ids.

  const emailTemplate = await (async () => {
    const existing = await prisma.campaignTemplate.findFirst({
      where: { tenantId: tenant.id, channel: CampaignChannel.email, name: "Enrollment Reminder Email" },
    });
    if (existing) return existing;
    return prisma.campaignTemplate.create({
      data: {
        tenantId: tenant.id,
        channel: CampaignChannel.email,
        name: "Enrollment Reminder Email",
        subject: "Don't miss out! {{program_title}} enrollment closes soon",
        body: "Hi {{name}},\n\nThis is a reminder that enrollment for {{program_title}} is closing soon.\n\nReply to this email and our team will help you complete it.\n\nBest,\nThe Stimuliiq Team",
        dltTemplateId: null, // DLT does not apply to email
        // ONLY keys the sender substitutes — see CAMPAIGN_TEMPLATE_VARIABLES (@repo/types).
        // `{{deadline}}` and `{{cta_url}}` were here and are resolved by nothing, so every
        // send delivered them with the braces showing. Stored as plain strings to match the
        // DTO too: the old {key,label} objects rendered as "{{[object Object]}}" in the CRM.
        variables: ["name", "program_title"],
      },
    });
  })();

  const whatsappTemplate = await (async () => {
    const existing = await prisma.campaignTemplate.findFirst({
      where: { tenantId: tenant.id, channel: CampaignChannel.whatsapp, name: "Enrollment Reminder WhatsApp" },
    });
    if (existing) return existing;
    return prisma.campaignTemplate.create({
      data: {
        tenantId: tenant.id,
        channel: CampaignChannel.whatsapp,
        name: "Enrollment Reminder WhatsApp",
        subject: null, // WhatsApp has no subject line
        body: "Hi {{1}}, don't miss the *{{2}}* internship starting {{3}}! Enroll now: {{4}}",
        // PLACEHOLDER: replace with your India DLT-approved WhatsApp template id.
        // The campaign service REJECTS sends for whatsapp/sms if this is null in prod.
        dltTemplateId: "DLT_PLACEHOLDER_WHATSAPP_ENROLLMENT_REMINDER",
        // Positional `{{1}}..{{4}}` is Meta's OWN convention for an approved WhatsApp
        // template — the provider fills them from the components/parameters payload, not
        // our renderer. Left as-is deliberately; unlike the email/SMS bodies these are not
        // ours to substitute. Stored as strings so the CRM stops showing
        // "{{[object Object]}}".
        variables: ["1", "2", "3", "4"],
      },
    });
  })();

  const smsTemplate = await (async () => {
    const existing = await prisma.campaignTemplate.findFirst({
      where: { tenantId: tenant.id, channel: CampaignChannel.sms, name: "Enrollment Reminder SMS" },
    });
    if (existing) return existing;
    return prisma.campaignTemplate.create({
      data: {
        tenantId: tenant.id,
        channel: CampaignChannel.sms,
        name: "Enrollment Reminder SMS",
        subject: null, // SMS has no subject
        body: "Hi {{name}}, {{program_title}} enrollment is closing soon. Reply to reserve your seat. -Stimuliiq",
        // PLACEHOLDER: replace with your India DLT-approved SMS template id.
        dltTemplateId: "DLT_PLACEHOLDER_SMS_ENROLLMENT_REMINDER",
        variables: ["name", "program_title"],
      },
    });
  })();

  // ── Newsletter email templates (ready-to-use marketing copy) ──────────────────────────
  //
  // Email channel needs no DLT id. These give staff friendly starting templates for
  // campaigning to newsletter subscribers (who arrive as leads with source="newsletter").

  const newsletterWelcomeTemplate = await (async () => {
    const existing = await prisma.campaignTemplate.findFirst({
      where: { tenantId: tenant.id, channel: CampaignChannel.email, name: "Newsletter — Welcome" },
    });
    if (existing) return existing;
    return prisma.campaignTemplate.create({
      data: {
        tenantId: tenant.id,
        channel: CampaignChannel.email,
        name: "Newsletter — Welcome",
        subject: "Welcome to Stimuliiq, {{name}}! 🎉",
        body: "Hi {{name}},\n\nThanks for subscribing to the Stimuliiq newsletter! You're now on the list for weekly career and clinical learning tips, early access to new batches, and exclusive scholarships.\n\nExplore our programs: https://www.stimuliiq.com/programs\n\nSee you inside,\nThe Stimuliiq Team",
        dltTemplateId: null,
        variables: ["name"],
      },
    });
  })();

  const newsletterDigestTemplate = await (async () => {
    const existing = await prisma.campaignTemplate.findFirst({
      where: { tenantId: tenant.id, channel: CampaignChannel.email, name: "Newsletter — Monthly Digest" },
    });
    if (existing) return existing;
    return prisma.campaignTemplate.create({
      data: {
        tenantId: tenant.id,
        channel: CampaignChannel.email,
        name: "Newsletter — Monthly Digest",
        subject: "Your learning digest is here 📚",
        body: "Hi {{name}},\n\nHere's what's new this month at Stimuliiq:\n\n• New batches opening for {{program_title}}\n• Fresh scholarships\n• Top career tips from our mentors\n\nRead more: https://www.stimuliiq.com/blog\n\nHappy learning,\nThe Stimuliiq Team",
        dltTemplateId: null,
        variables: ["name", "program_title"],
      },
    });
  })();

  // ── Phase-6 seed: one draft campaign using the email template ─────────────────────────
  //
  // status=draft so it does not fire any sends during seed/test runs.
  // segment: leads in 'new' or 'contacted' stages with marketing_opt_in.
  // Idempotent: find-then-create on (tenantId, name).

  const seedCampaign = await (async () => {
    const existing = await prisma.campaign.findFirst({
      where: { tenantId: tenant.id, name: "Full-Stack Enrollment Reminder — July 2026" },
    });
    if (existing) return existing;
    return prisma.campaign.create({
      data: {
        tenantId: tenant.id,
        channel: CampaignChannel.email,
        templateId: emailTemplate.id,
        name: "Full-Stack Enrollment Reminder — July 2026",
        segment: {
          stages: ["new", "contacted"],
          programInterestId: fullstackProgram.id,
          consentRequired: true,
        },
        scheduleAt: new Date("2026-07-10T10:00:00Z"),
        status: CampaignStatus.draft,
        metrics: { total: 0, queued: 0, sent: 0, delivered: 0, read: 0, failed: 0 },
        createdById: marketingUserId,
      },
    });
  })();

  // ── Newsletter-audience draft campaign (targets newsletter subscribers) ────────────────
  //
  // source="leads" filtered to sources=["newsletter"] — reaches exactly the leads created
  // by a newsletter signup. status=draft (no send during seed). Idempotent on (tenantId, name).
  const newsletterCampaign = await (async () => {
    const existing = await prisma.campaign.findFirst({
      where: { tenantId: tenant.id, name: "Newsletter Subscribers — Welcome" },
    });
    if (existing) return existing;
    return prisma.campaign.create({
      data: {
        tenantId: tenant.id,
        channel: CampaignChannel.email,
        templateId: newsletterWelcomeTemplate.id,
        name: "Newsletter Subscribers — Welcome",
        segment: { source: "leads", sources: ["newsletter"] },
        scheduleAt: null,
        status: CampaignStatus.draft,
        metrics: { total: 0, queued: 0, sent: 0, delivered: 0, read: 0, failed: 0 },
        createdById: marketingUserId,
      },
    });
  })();
  void newsletterDigestTemplate; // seeded for staff to use; not referenced elsewhere in the seed.

  // ── Phase-6 seed: forum thread + posts on hydBatch ────────────────────────────────────
  //
  // One forum thread scoped to hydBatch (Full-Stack Web Dev — Batch HYD-01).
  // Thread author: Ananya (the sample student). Two posts: Ananya's question + Priya's reply.
  // Idempotent: find-then-create on (tenantId, batchId, title).

  const seedForumThread = await (async () => {
    const existing = await prisma.forumThread.findFirst({
      where: { tenantId: tenant.id, batchId: hydBatch.id, title: "How do I approach the CSS Layout Final Project?" },
    });
    if (existing) return existing;
    return prisma.forumThread.create({
      data: {
        tenantId: tenant.id,
        batchId: hydBatch.id,
        programId: fullstackProgram.id,
        authorId: ananyaUser.id,
        title: "How do I approach the CSS Layout Final Project?",
        status: "open",
        pinned: false,
      },
    });
  })();

  // First post: Ananya's question (top-level — no parent).
  const seedPost1 = await (async () => {
    const existing = await prisma.forumPost.findFirst({
      where: { tenantId: tenant.id, threadId: seedForumThread.id, authorId: ananyaUser.id, parentId: null },
    });
    if (existing) return existing;
    return prisma.forumPost.create({
      data: {
        tenantId: tenant.id,
        threadId: seedForumThread.id,
        authorId: ananyaUser.id,
        body: "Hi everyone! I'm starting the CSS Layout Final Project and I'm not sure how to structure the wireframe. Should I include both mobile and desktop breakpoints in the design doc?",
        parentId: null,
        status: "visible",
      },
    });
  })();

  // Second post: Priya's reply (nested under post1).
  const seedPost2 = await (async () => {
    const existing = await prisma.forumPost.findFirst({
      where: { tenantId: tenant.id, threadId: seedForumThread.id, authorId: priyaUser.id },
    });
    if (existing) return existing;
    return prisma.forumPost.create({
      data: {
        tenantId: tenant.id,
        threadId: seedForumThread.id,
        authorId: priyaUser.id,
        body: "Great question Ananya! Yes — include both mobile (360px) and desktop (1280px) wireframes in your design doc. Use Figma or even a hand-drawn sketch. The key is to show your layout thinking with Flexbox containers clearly labelled. See Milestone 1 rubric for the exact criteria.",
        parentId: seedPost1.id,
        status: "visible",
      },
    });
  })();

  // ── Phase-6 seed: one unread sample notification for Ananya ──────────────────────────
  //
  // Type: grade_ready — simulates Ananya's assignment being graded.
  // channels: in_app only (as per her prefs matrix — email is enabled but we only track
  //   what channels the fan-out used for this seed row; in_app is the only one seeded).
  // read_at: null = unread (the LMS notification badge should show 1 unread).
  // Idempotent: find-then-create on (tenantId, userId, type, payload.submissionId).

  const seedNotification = await (async () => {
    const existing = await prisma.notification.findFirst({
      where: {
        tenantId: tenant.id,
        userId: ananyaUser.id,
        type: NotificationType.grade_ready,
        readAt: null,
      },
    });
    if (existing) return existing;
    return prisma.notification.create({
      data: {
        tenantId: tenant.id,
        userId: ananyaUser.id,
        type: NotificationType.grade_ready,
        channels: [NotificationChannel.in_app, NotificationChannel.email],
        payload: {
          submissionId: seedSubmission.id,
          assignmentTitle: "Semantic HTML Portfolio Critique",
          score: 87,
          maxScore: 100,
          feedback: "Strong submission! See full feedback in the LMS.",
        },
        readAt: null, // unread — drives the notification badge in LMS
      },
    });
  })();

  // ── Phase-5 seed: SEO/marketing fields on sample programs ──────────────────────────────
  //
  // Backfill seo_title / seo_description / og_image_key / card_summary / outcomes /
  // rating_avg / rating_count / is_public on the 2 flagship public programs.
  // cloudDevops program (3rd) intentionally stays is_public=false to test the public filter.
  //
  // Slugs are ALREADY set (fullstack-web-dev-internship / data-science-ml-internship /
  // cloud-devops-internship) from P0 seed. We verify + keep them — no re-slug needed.
  //
  // ratingAvg is stored as integer 0–50 (×10 scale: 47 = 4.7 stars) per CLAUDE.md §3.6.
  //
  // og_image_key: NOT seeded (2026-07-18 course-image fix). The old stub keys
  //   ("marketing/programs/*-og.jpg") pointed at files that never existed, so every
  //   consumer 404'd — and worse, each re-seed CLOBBERED a real image key uploaded
  //   through the CRM (image-upload-url → program_images/... keys), which is how CRM
  //   uploads kept "disappearing" from the website/LMS. `preserveOgImageKey` keeps a
  //   real uploaded key, clears a legacy broken stub, and otherwise leaves null
  //   (frontends render their gradient fallback until an image is uploaded in CRM).
  //
  // outcomes: Json? — array of learning outcome strings for Schema.org Course JSON-LD.

  /** undefined = leave the column untouched; null = clear a legacy broken stub key. */
  function preserveOgImageKey(row: { ogImageKey: string | null }): null | undefined {
    return row.ogImageKey?.startsWith("marketing/programs/") ? null : undefined;
  }

  await prisma.program.update({
    where: { id: fullstackProgram.id },
    data: {
      seoTitle:       "Full-Stack Web Development Internship | Stimuliiq",
      seoDescription: "Master React, Node.js & REST APIs in 12 weeks. Industry-mentored, project-based internship for B.Tech & Degree students. Placement support included.",
      ogImageKey:     preserveOgImageKey(fullstackProgram),
      cardSummary:    "Build production-grade web apps with React + Node.js. 12-week hybrid internship with live mentorship, real projects, and placement support.",
      outcomes:       [
        "Build and deploy full-stack web applications with React and Node.js",
        "Design and consume REST APIs with authentication",
        "Work with databases (PostgreSQL, MongoDB) and ORMs",
        "Follow Git, code-review, and agile workflows used in industry",
        "Earn a verified certificate + portfolio-ready project",
      ],
      ratingAvg:      46, // 4.6 stars × 10
      ratingCount:    128,
      isPublic:       true,
    },
  });

  await prisma.program.update({
    where: { id: dataScienceProgram.id },
    data: {
      seoTitle:       "Data Science & Machine Learning Internship | Stimuliiq",
      seoDescription: "From Python to production ML models in 16 weeks. Hands-on internship with real datasets, Kaggle-ready projects, and expert guidance for CS/Engineering students.",
      ogImageKey:     preserveOgImageKey(dataScienceProgram),
      cardSummary:    "Go from Python basics to deploying ML models. 16-week self-paced internship with live mentor sessions, real-world projects, and a verified certificate.",
      outcomes:       [
        "Write production-quality Python for data manipulation (NumPy, Pandas)",
        "Build and evaluate supervised ML models (sklearn, XGBoost)",
        "Visualise and communicate insights with Matplotlib + Seaborn",
        "Engineer features and tune hyperparameters for real datasets",
        "Ship an end-to-end ML pipeline and present a Kaggle-grade project",
      ],
      ratingAvg:      48, // 4.8 stars × 10
      ratingCount:    94,
      isPublic:       true,
    },
  });

  // cloudDevops program: is_public stays false (default from migration) — intentional
  // to populate the "not listed on the public site" test case.
  // Confirm it stays false (idempotent — update only if it was somehow flipped).
  await prisma.program.update({
    where: { id: cloudDevopsProgram.id },
    data: { isPublic: false },
  });

  // ── Phase-5 seed: public-facing coupon ─────────────────────────────────────────────────
  //
  // A 15%-off public coupon for the site's registration funnel + pricing page.
  // Code "WELCOME15" — broadly visible, not restricted to specific programs.
  // maxUses=null means unlimited (no hard cap — Marketing controls via status).
  // This coupon is distinct from the CRM-internal coupons (LAUNCH10, FLAT500)
  // seeded in P2. It is validated via the public GET /public/coupons/validate endpoint.

  const couponPublicWelcome = await (async () => {
    const existing = await prisma.coupon.findFirst({ where: { tenantId: tenant.id, code: "WELCOME15" } });
    if (existing) return existing;
    return prisma.coupon.create({
      data: {
        tenantId:     tenant.id,
        code:         "WELCOME15",
        type:         CouponType.pct,
        value:        15,           // 15%
        maxUses:      null,         // unlimited
        used:         0,
        validFrom:    new Date("2026-07-01"),
        validTo:      new Date("2027-06-30"),
        programScope: null,         // all programs
        status:       CouponStatus.active,
      },
    });
  })();

  // ── Phase-7 seed: one sample ExportJob + analytics MV refresh ───────────────────────────
  //
  // ExportJob: db-architect, Wave 1 task #4 (docs/plans/phase-7.md). One SUCCEEDED sample
  // row (a plausible "leads.csv" export by the admin user) so the CRM export-history UI
  // (Wave 3, frontend-builder) has something to render in local dev. Idempotent: looked up
  // by (tenantId, requestedById, type) before creating.
  const seedExportJob = await (async () => {
    const existing = await prisma.exportJob.findFirst({
      where: { tenantId: tenant.id, requestedById: adminUser.id, type: "leads.csv" },
    });
    if (existing) return existing;
    return prisma.exportJob.create({
      data: {
        tenantId: tenant.id,
        requestedById: adminUser.id,
        type: "leads.csv",
        params: { stage: ["new", "follow_up", "won"] },
        status: "succeeded",
        storageKey: `exports/${tenant.id}/leads-2026-07-04.csv`,
        rowCount: seedLeads.length,
      },
    });
  })();

  // Analytics read model (materialized views): refresh once at the end of seeding so the
  // eight P7 MVs (mv_revenue_daily, mv_enrollment_daily, mv_lead_funnel_daily,
  // mv_attendance_daily, mv_course_engagement_daily, mv_campaign_performance_daily,
  // mv_gamification_daily, mv_forum_health_daily) reflect the freshly-seeded rows —
  // otherwise a fresh `db:seed` run would leave them empty (unpopulated MVs are
  // technically "populated with 0 matching rows" here, not "WITH NO DATA", but a refresh
  // still lets local dev + Wave-2 dashboard work exercise real, non-stale data
  // immediately after seeding). Best-effort: swallow errors so a seed re-run never fails
  // because a concurrent refresh raced another seed process.
  try {
    await prisma.$executeRawUnsafe("CALL refresh_analytics_views()");
  } catch (error) {
    // eslint-disable-next-line no-console -- seed scripts run outside the app logger
    console.warn("[seed] refresh_analytics_views() skipped:", error);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  // eslint-disable-next-line no-console -- seed scripts run outside the app logger
  console.log("\n[seed] stimuliiq Phase-6 Engagement seed complete:");
  // eslint-disable-next-line no-console
  console.log(`[seed]   tenant:            ${tenant.slug} (${tenant.id})`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   roles:             ${roles.length} (${roleDefs.map((r) => r.key).join(", ")})`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   permissions:       ${permissions.length} (Phase-0 + Phase-1 + Phase-2 + Phase-3 module.action catalog)`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   branches:          ${branches.length}`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   programs:          ${programs.length} (with modules + lessons)`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   faculty profiles:  ${facultyProfiles.length}`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   student profiles:  ${studentProfiles.length}`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   batches:           ${batches.length}`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   enrollments:       ${enrollmentDefs.filter((e) => e.student).length} (P1 roster + 1 linked to paid order)`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   admin user:        ${ADMIN_EMAIL}`);
  // eslint-disable-next-line no-console
  console.log("[seed]   --- Phase-2 Commerce + CRM ---");
  // eslint-disable-next-line no-console
  console.log(`[seed]   counsellor user:   counsellor.sneha@stimuliiq.test`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   coupons:           2 (LAUNCH10 pct=10%, FLAT500 flat=₹500)`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   orders:            2 (1 paid + 1 created/pending)`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   payments:          2 (1 captured + 1 created)`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   invoices:          1 (issued, INV-2026-0001, storage_key=null stub)`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   refunds:           1 (requested, full-amount)`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   order-linked enr:  1 (Ananya → hydBatch, source=order, orderId=paidOrder)`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   leads:             ${seedLeads.length} (stages: new/contacted/qualified/negotiation/won)`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   activities:        ${seedActivities.length} (call/note/task/whatsapp/email)`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   bookings:          1 (confirmed, Kiran → cloudDevops, 2026-07-02)`);
  // eslint-disable-next-line no-console
  console.log("[seed]   --- Phase-3 LMS Core ---");
  // eslint-disable-next-line no-console
  console.log(`[seed]   video lessons:     ${seedVideos.length} (noop provider, status=ready, on fullstack module 1)`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   resources:         ${seedResources.length} (pdf/zip stubs on lessons 0+1; signed-download deferred P4)`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   lesson_progress:   ${seedLessonProgress.length} (1 completed, 1 in_progress at 1200s for Ananya)`);
  // eslint-disable-next-line no-console
  // eslint-disable-next-line no-console
  console.log(`[seed]   P3 permissions:    ${P3_MODULES.length * P3_ACTIONS.length} new (${P3_MODULES.join(", ")} × ${P3_ACTIONS.join(", ")})`);
  // eslint-disable-next-line no-console
  console.log("[seed]   student scope=own: lessons.view, videos.view, videos.stream, progress.view/edit, resources.view");
  // eslint-disable-next-line no-console
  console.log("[seed]   faculty scope=assigned: lessons/videos/resources.view + resources.create/edit/delete");
  // eslint-disable-next-line no-console
  console.log("[seed]   --- Phase-4 Learning Depth ---");
  // eslint-disable-next-line no-console
  console.log(`[seed]   P4 permissions:    ${P4_PERMISSIONS.length} (assignments/submissions/projects/assessments/attempts/certificates × actions)`);
  // eslint-disable-next-line no-console
  console.log("[seed]   student scope=own: assignments.view, submissions.create/view, assessments.view, attempts.take/view, certificates.view");
  // eslint-disable-next-line no-console
  console.log("[seed]   faculty scope=assigned: assignments.create/edit/grade, submissions.view/grade, projects.review, assessments.create/edit, attempts.view, certificates.recommend");
  // eslint-disable-next-line no-console
  console.log(
    `[seed]   cert_templates:    2 (Internship id=${certTemplate.id}, Training id=${trainingCertTemplate.id})`,
  );
  // eslint-disable-next-line no-console
  console.log(`[seed]   assignment:        1 (kind=assignment, is_final=false, allow_resubmit=false, on lesson0)`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   project:           1 (kind=project, is_final=true, 2 milestones, on lesson1)`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   assessment:        1 (is_required=true, 2 MCQ + 1 descriptive, time=30m, pass=60%)`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   submission:        1 (Ananya, graded, score=87/100 with rubric)`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   attempt:           1 (Ananya, passed, score=35/35 on HTML Fundamentals Quiz)`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   certificate:       1 ISSUED (Sneha, data-science, cert_uid=${SEED_CERT_UID})`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   eligibility check: Sneha progress_pct=100 >= 90 ✓; no is_required assessments on her program (vacuously true) ✓; no is_final project on her program (vacuously true) ✓ → eligible → ISSUED`);
  // eslint-disable-next-line no-console
  console.log("[seed]   --- Phase-5 Marketing Website ---");
  // eslint-disable-next-line no-console
  console.log("[seed]   programs.isPublic:  fullstack=true, datascience=true, clouddevops=false");
  // eslint-disable-next-line no-console
  console.log("[seed]   programs SEO:       seoTitle/seoDescription/cardSummary/outcomes/ratingAvg/ratingCount on 2 public programs (ogImageKey preserved — CRM uploads survive re-seeds)");
  // eslint-disable-next-line no-console
  console.log("[seed]   coupons:            WELCOME15 (pct=15%, all programs, no max uses, P5 public funnel)");
  // eslint-disable-next-line no-console
  console.log("[seed]   leads attribution:  landing_url/referrer/gclid/fbclid/consent — nullable, no backfill on existing leads");
  // eslint-disable-next-line no-console
  console.log("[seed]   bookings consent:   consent Json? — nullable, no backfill on existing bookings");
  // eslint-disable-next-line no-console
  console.log("[seed]   --- Phase-6 Engagement ---");
  // eslint-disable-next-line no-console
  console.log(`[seed]   P6 permissions:    ${P6_PERMISSIONS.length} (campaigns.*/notifications.view/forum.post+moderate/gamification.view)`);
  // eslint-disable-next-line no-console
  console.log("[seed]   notification_prefs: 3 (Ananya with quiet hours, Priya, Admin)");
  // eslint-disable-next-line no-console
  console.log(`[seed]   badges:            ${seedBadges.length} (first_project_approved, perfect_attendance, top_of_batch, streak_7days, streak_30days)`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   user_badges:       1 (Ananya — first_project_approved, ref=project:${seedProject.id})`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   points_ledger:     ${ledgerDefs.length} rows (Ananya: 90 XP, Sneha: 150 XP — leaderboard renderable)`);
  // eslint-disable-next-line no-console
  console.log("[seed]   campaign_templates: 5 (enrollment: email/whatsapp+DLT/sms+DLT; newsletter: welcome/digest email)");
  // eslint-disable-next-line no-console
  console.log(`[seed]   campaigns:         2 draft (Full-Stack Enrollment Reminder id=${seedCampaign.id}; Newsletter Subscribers — Welcome id=${newsletterCampaign.id}, source=newsletter)`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   forum thread:      1 (hydBatch, title="How do I approach the CSS Layout Final Project?", id=${seedForumThread.id})`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   forum posts:       2 (Ananya question + Priya reply, nested)`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   notification:      1 unread grade_ready for Ananya (submissionId=${seedSubmission.id})`);
  // eslint-disable-next-line no-console
  console.log("[seed]   --- Phase-7 Analytics + Hardening ---");
  // eslint-disable-next-line no-console
  console.log(`[seed]   export_jobs:       1 succeeded (leads.csv, rowCount=${seedExportJob.rowCount}, id=${seedExportJob.id})`);
  // eslint-disable-next-line no-console
  console.log("[seed]   analytics MVs:     refreshed (mv_revenue_daily, mv_enrollment_daily, mv_lead_funnel_daily, mv_attendance_daily, mv_course_engagement_daily, mv_campaign_performance_daily, mv_gamification_daily, mv_forum_health_daily)");
  // eslint-disable-next-line no-console
  console.log(`[seed]   P7 permissions:    ${P7_PERMISSIONS.length} (reports.revenue/enrollment/funnel/engagement/campaigns/gamification/forum.view + reports.export + reports.schedule + dpdp.erasure.execute)`);
  // eslint-disable-next-line no-console
  console.log("[seed]   --- Phase-8 Mentor (human, external-institute hire) ---");
  // eslint-disable-next-line no-console
  console.log(`[seed]   P8 permissions:    ${P8_PERMISSIONS.length} (mentors.view/create/edit/delete/assign + mentor.dashboard.view + batches.markComplete)`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   mentor role:       mentor (assigned-scope mentor.dashboard.view + batches.view + batches.markComplete + reports.engagement.view)`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   mentors:           2 (Ramesh — active, WITH dashboard login; Anjali — prospective, no login yet)`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   batch_mentors:     1 (Ramesh → hydBatch, isLead=true)`);

  // ── Phase-9 Completion — permission grants (T13) ─────────────────────────────────────
  //
  // super_admin/admin already hold every P9 permission via the catch-all loop near the
  // top of main() (it iterates over the FULL `permissions` array built from
  // `permissionCatalog`, which now includes P9_PERMISSIONS). The grants below give each
  // NON-admin role the subset of P9 permissions their real-world job needs, so the
  // permission-catalog-discipline gate ("every key granted to >= 1 non-admin role")
  // holds for every P9 key, matching the P6 forum.read/notification_prefs.edit fix
  // pattern (docs/plans/phase-9-completion.md T13).

  function p9permId(key: string): string {
    return permId(key);
  }

  // liveclass.*: faculty author/host their assigned batches' sessions; mentor + student
  // may view/join their assigned/own batch's sessions; branch_manager views branch-wide.
  await Promise.all(
    ["liveclass.view", "liveclass.create", "liveclass.edit", "liveclass.cancel", "liveclass.join"].map((key) =>
      grant(facultyRole!.id, p9permId(key), RolePermissionScope.assigned),
    ),
  );
  await grant(mentorRole!.id, p9permId("liveclass.view"), RolePermissionScope.assigned);
  await grant(mentorRole!.id, p9permId("liveclass.join"), RolePermissionScope.assigned);
  await grant(studentRole!.id, p9permId("liveclass.view"), RolePermissionScope.own);
  await grant(studentRole!.id, p9permId("liveclass.join"), RolePermissionScope.own);
  await grant(branchManagerRole!.id, p9permId("liveclass.view"), RolePermissionScope.branch);

  // tickets.*: student raises/views own; support manages the queue at scope=all;
  // branch_manager views branch-wide.
  await grant(studentRole!.id, p9permId("tickets.create"), RolePermissionScope.own);
  await grant(studentRole!.id, p9permId("tickets.view"), RolePermissionScope.own);
  await Promise.all(
    ["tickets.view", "tickets.edit", "tickets.assign", "tickets.close"].map((key) =>
      grant(supportRole!.id, p9permId(key), RolePermissionScope.all),
    ),
  );
  await grant(branchManagerRole!.id, p9permId("tickets.view"), RolePermissionScope.branch);

  // kb.view: reference material — readable by every authed staff/student role.
  await Promise.all(
    [studentRole, facultyRole, supportRole, branchManagerRole, counsellorRole, mentorRole].map((role) =>
      grant(role!.id, p9permId("kb.view"), RolePermissionScope.all),
    ),
  );
  await grant(supportRole!.id, p9permId("kb.edit"), RolePermissionScope.all);
  await grant(contentEditorRole!.id, p9permId("kb.edit"), RolePermissionScope.all);
  await grant(supportRole!.id, p9permId("canned_responses.manage"), RolePermissionScope.all);

  // content.*: content_editor authors/publishes; marketing views + edits (campaign copy).
  await Promise.all(
    ["content.view", "content.create", "content.edit", "content.delete", "content.publish"].map((key) =>
      grant(contentEditorRole!.id, p9permId(key), RolePermissionScope.all),
    ),
  );
  await grant(marketingRole!.id, p9permId("content.view"), RolePermissionScope.all);
  await grant(marketingRole!.id, p9permId("content.edit"), RolePermissionScope.all);

  // settings.*: branch_manager may VIEW branch-level config (edit stays admin-only).
  await grant(branchManagerRole!.id, p9permId("settings.view"), RolePermissionScope.branch);

  // bookmarks.manage / notes.manage / search.use: own-scope LMS study tools — student only.
  await grant(studentRole!.id, p9permId("bookmarks.manage"), RolePermissionScope.own);
  await grant(studentRole!.id, p9permId("notes.manage"), RolePermissionScope.own);
  await grant(studentRole!.id, p9permId("search.use"), RolePermissionScope.own);

  // emi.*: finance owns the EMI/dunning surface at scope=all; branch_manager views
  // branch-wide; counsellor views their own leads' EMI plans.
  await Promise.all(
    ["emi.view", "emi.create", "emi.edit", "emi.charge"].map((key) =>
      grant(financeRole!.id, p9permId(key), RolePermissionScope.all),
    ),
  );
  await grant(branchManagerRole!.id, p9permId("emi.view"), RolePermissionScope.branch);
  await grant(counsellorRole!.id, p9permId("emi.view"), RolePermissionScope.own);
  // Students see their OWN EMI plans/installments in the LMS (GET /me/emi-plans).
  await grant(studentRole!.id, p9permId("emi.view"), RolePermissionScope.own);

  // referrals.*: marketing owns the affiliate program at scope=all; students generate +
  // view their OWN referral link; counsellor views referrals on their own leads.
  await Promise.all(
    ["referrals.view", "referrals.create", "referrals.edit", "referrals.approve"].map((key) =>
      grant(marketingRole!.id, p9permId(key), RolePermissionScope.all),
    ),
  );
  await grant(studentRole!.id, p9permId("referrals.view"), RolePermissionScope.own);
  await grant(studentRole!.id, p9permId("referrals.create"), RolePermissionScope.own);
  await grant(counsellorRole!.id, p9permId("referrals.view"), RolePermissionScope.own);

  // videolib.*: content_editor manages the library at scope=all; faculty upload/view
  // for their assigned batches' course material.
  await Promise.all(
    ["videolib.view", "videolib.upload", "videolib.edit", "videolib.delete"].map((key) =>
      grant(contentEditorRole!.id, p9permId(key), RolePermissionScope.all),
    ),
  );
  await grant(facultyRole!.id, p9permId("videolib.view"), RolePermissionScope.assigned);
  await grant(facultyRole!.id, p9permId("videolib.upload"), RolePermissionScope.assigned);

  // bulk.*: counsellor bulk-edits their own leads; branch_manager bulk-edits branch-wide;
  // marketing bulk-edits the full leads pipeline; faculty bulk-edits their assigned students.
  await grant(counsellorRole!.id, p9permId("bulk.leads"), RolePermissionScope.own);
  await grant(branchManagerRole!.id, p9permId("bulk.leads"), RolePermissionScope.branch);
  await grant(branchManagerRole!.id, p9permId("bulk.students"), RolePermissionScope.branch);
  await grant(marketingRole!.id, p9permId("bulk.leads"), RolePermissionScope.all);
  await grant(facultyRole!.id, p9permId("bulk.students"), RolePermissionScope.assigned);

  // twofa.manage: EVERY role manages their OWN 2FA enrolment (own-scope). Admin-tier
  // login-time enforcement ("2FA gates admin login") is a business rule at the auth
  // layer (T28 backend-builder), not a separate RBAC permission — every role still
  // needs this own-scope grant to reach the enrol/verify/disable endpoints at all.
  await Promise.all(
    [
      superAdminRole, adminRole, branchManagerRole, counsellorRole, facultyRole,
      financeRole, marketingRole, supportRole, contentEditorRole, studentRole, mentorRole,
    ].map((role) => grant(role!.id, p9permId("twofa.manage"), RolePermissionScope.own)),
  );

  // twofa.reset: the ADMIN RESCUE path (clear another user's 2FA when they've lost both
  // authenticator and inbox). super_admin + admin ONLY, at scope=all — this permission
  // removes a security factor from an account its holder does not own, so it stays with
  // the same two roles that already hold users.* credential management. Note this is
  // NOT granted to support/counsellor, who do hold onboarding/ticket permissions: a
  // social-engineering call ("I'm locked out, clear my 2FA") should have to reach an
  // admin, not the first-line queue.
  await grant(superAdminRole!.id, p9permId("twofa.reset"), RolePermissionScope.all);
  await grant(adminRole!.id, p9permId("twofa.reset"), RolePermissionScope.all);

  // landing_pages.* / lead_forms.*: marketing owns the campaign funnel tooling;
  // branch_manager may view landing pages relevant to their branch's campaigns.
  await grant(marketingRole!.id, p9permId("landing_pages.view"), RolePermissionScope.all);
  await grant(marketingRole!.id, p9permId("landing_pages.edit"), RolePermissionScope.all);
  await grant(marketingRole!.id, p9permId("lead_forms.view"), RolePermissionScope.all);
  await grant(marketingRole!.id, p9permId("lead_forms.edit"), RolePermissionScope.all);
  await grant(branchManagerRole!.id, p9permId("landing_pages.view"), RolePermissionScope.branch);

  // ── Phase-9-completion GAP-CLOSURE grants ────────────────────────────────
  //

  // ── Phase-9 Completion — minimal sample data (T6-T12) ────────────────────────────────
  //
  // One row per new model, wired to already-seeded tenant/batch/program/lesson/user
  // fixtures, so Wave-3 backend-builder integration tests have a realistic starting
  // point. Idempotent: each block finds-or-creates on a natural key.

  const { id: supportUserId } = await ensureSeedUser({
    tenantId: tenant.id,
    email: "support.meera@stimuliiq.test",
    name: "Meera Nair",
    roleId: roleId("support"),
    branchId: null,
  });

  // T6: LiveClass — one scheduled session on hydBatch/fullstackProgram, hosted by Priya.
  const seedLiveClass = await (async () => {
    const existing = await prisma.liveClass.findFirst({
      where: { tenantId: tenant.id, batchId: hydBatch.id, title: "Live Q&A — CSS Layout Final Project" },
    });
    const data = {
      tenantId: tenant.id,
      batchId: hydBatch.id,
      programId: fullstackProgram.id,
      title: "Live Q&A — CSS Layout Final Project",
      provider: "noop" as const,
      providerMeetingId: "noop-meeting-001",
      joinUrl: "https://meet.stimuliiq.test/noop-meeting-001",
      startsAt: new Date("2026-07-15T10:00:00Z"),
      endsAt: new Date("2026-07-15T11:00:00Z"),
      status: "scheduled" as const,
      hostUserId: priyaUser.id,
    };
    return existing
      ? prisma.liveClass.update({ where: { id: existing.id }, data })
      : prisma.liveClass.create({ data });
  })();

  // T7: Ticket + TicketMessage + CannedResponse + KbArticle.
  const seedTicket = await (async () => {
    const existing = await prisma.ticket.findFirst({
      where: { tenantId: tenant.id, userId: ananyaUser.id, subject: "Unable to download certificate PDF" },
    });
    const data = {
      tenantId: tenant.id,
      userId: ananyaUser.id,
      subject: "Unable to download certificate PDF",
      body: "The download link on my certificate page returns a 404. Can you help?",
      status: "open" as const,
      priority: "medium" as const,
      assigneeId: supportUserId,
      slaDueAt: new Date("2026-07-11T00:00:00Z"),
    };
    return existing
      ? prisma.ticket.update({ where: { id: existing.id }, data })
      : prisma.ticket.create({ data });
  })();

  const existingTicketMessage = await prisma.ticketMessage.findFirst({
    where: { tenantId: tenant.id, ticketId: seedTicket.id, authorId: supportUserId },
  });
  if (!existingTicketMessage) {
    await prisma.ticketMessage.create({
      data: {
        tenantId: tenant.id,
        ticketId: seedTicket.id,
        authorId: supportUserId,
        body: "Thanks for flagging this — looking into the signed-URL generation now.",
        isInternal: false,
      },
    });
  }

  const seedCannedResponse = await (async () => {
    const existing = await prisma.cannedResponse.findFirst({
      where: { tenantId: tenant.id, title: "Certificate download issue" },
    });
    const data = {
      tenantId: tenant.id,
      title: "Certificate download issue",
      body: "We're sorry for the trouble — please try again in a few minutes; if it persists, share the certificate ID and we'll investigate.",
      category: "certificates",
    };
    return existing
      ? prisma.cannedResponse.update({ where: { id: existing.id }, data })
      : prisma.cannedResponse.create({ data });
  })();

  const seedKbArticle = await (async () => {
    const existing = await prisma.kbArticle.findFirst({ where: { tenantId: tenant.id, slug: "download-your-certificate" } });
    const data = {
      tenantId: tenant.id,
      title: "How to download your certificate",
      slug: "download-your-certificate",
      body: "Go to My Certificates → select your certificate → click Download. The link is signed and expires after a few minutes.",
      category: "certificates",
      published: true,
    };
    return existing
      ? prisma.kbArticle.update({ where: { id: existing.id }, data })
      : prisma.kbArticle.create({ data });
  })();

  // T8: Headless CMS — BlogCategory + BlogPost, Testimonial, Partner, FacultyBio,
  // ContentPage, NewsletterSubscription, ContactSubmission, CareerApplication.
  const seedBlogCategory = await (async () => {
    const existing = await prisma.blogCategory.findFirst({ where: { tenantId: tenant.id, slug: "career-tips" } });
    const data = { tenantId: tenant.id, name: "Career Tips", slug: "career-tips" };
    return existing
      ? prisma.blogCategory.update({ where: { id: existing.id }, data })
      : prisma.blogCategory.create({ data });
  })();

  const seedBlogPost = await (async () => {
    const existing = await prisma.blogPost.findFirst({ where: { tenantId: tenant.id, slug: "5-tips-to-ace-your-internship" } });
    const data = {
      tenantId: tenant.id,
      categoryId: seedBlogCategory.id,
      authorId: adminUser.id,
      title: "5 Tips to Ace Your Internship",
      slug: "5-tips-to-ace-your-internship",
      excerpt: "Practical advice for getting the most out of your Stimuliiq internship.",
      body: "1. Show up prepared. 2. Ask questions. 3. Ship small things often. 4. Document your work. 5. Ask for feedback early.",
      status: "published" as const,
      publishedAt: new Date("2026-06-01T00:00:00Z"),
    };
    return existing
      ? prisma.blogPost.update({ where: { id: existing.id }, data })
      : prisma.blogPost.create({ data });
  })();

  const seedTestimonial = await (async () => {
    const existing = await prisma.testimonial.findFirst({
      where: { tenantId: tenant.id, studentName: "Sneha Iyer", programId: fullstackProgram.id },
    });
    const data = {
      tenantId: tenant.id,
      programId: fullstackProgram.id,
      studentName: "Sneha Iyer",
      quote: "The mentorship and hands-on projects made all the difference in landing my first role.",
      rating: 48,
      status: "published" as const,
      order: 0,
    };
    return existing
      ? prisma.testimonial.update({ where: { id: existing.id }, data })
      : prisma.testimonial.create({ data });
  })();

  const seedPartner = await (async () => {
    const existing = await prisma.partner.findFirst({ where: { tenantId: tenant.id, name: "Acme Tech Solutions" } });
    const data = {
      tenantId: tenant.id,
      name: "Acme Tech Solutions",
      category: "hiring_partner",
      status: "published" as const,
      order: 0,
    };
    return existing
      ? prisma.partner.update({ where: { id: existing.id }, data })
      : prisma.partner.create({ data });
  })();

  // Phase-10 page-builder spec (docs/specs/phase-10-page-builder.md, finding #1): backfill
  // Partner rows for the 12 homepage "partner colleges" currently hardcoded in
  // apps/web/src/components/home/partner-colleges.tsx, using the new focus/established/
  // city columns, so the reference block has real DB-backed content parity once wired.
  // category="college_partner" distinguishes these from the generic hiring/tech partners
  // above — same open-ended-string precedent (Partner.category doc comment).
  const PARTNER_COLLEGES: Array<{ name: string; focus: string; established: number; city: string }> = [
    { name: "St. John's Medical College", focus: "Teaching Hospital & Research", established: 1963, city: "Bengaluru" },
    { name: "Manipal College of Medical Sciences", focus: "Multi-speciality & Research", established: 1953, city: "Bengaluru" },
    { name: "MS Ramaiah Medical College", focus: "Clinical Research & Education", established: 1979, city: "Bengaluru" },
    { name: "Kempegowda Institute of Medical Sciences", focus: "Healthcare & Allied Sciences", established: 1980, city: "Bengaluru" },
    { name: "Bangalore Medical College & RI", focus: "Government Teaching Hospital", established: 1955, city: "Bengaluru" },
    { name: "RajaRajeswari Medical College", focus: "Modern Medical Education", established: 2004, city: "Bengaluru" },
    { name: "Grant Medical College & Sir JJ Hospital", focus: "Premier Government Medical College", established: 1845, city: "Mumbai" },
    { name: "KEM Hospital & Seth GS Medical College", focus: "Research & Clinical Excellence", established: 1926, city: "Mumbai" },
    { name: "Lokmanya Tilak Municipal Medical College", focus: "Municipal Teaching Hospital", established: 1964, city: "Mumbai" },
    { name: "LTMMC Sion Hospital", focus: "Healthcare & Surgical Sciences", established: 1964, city: "Mumbai" },
    { name: "D.Y. Patil Medical College", focus: "Private Medical Education & Research", established: 1989, city: "Mumbai" },
    { name: "Topiwala National Medical College", focus: "Nair Hospital — Trauma & Emergency", established: 1921, city: "Mumbai" },
  ];
  for (const [index, college] of PARTNER_COLLEGES.entries()) {
    const existingCollege = await prisma.partner.findFirst({ where: { tenantId: tenant.id, name: college.name } });
    const collegeData = {
      tenantId: tenant.id,
      name: college.name,
      category: "college_partner",
      focus: college.focus,
      established: college.established,
      city: college.city,
      status: "published" as const,
      order: index,
    };
    if (existingCollege) {
      await prisma.partner.update({ where: { id: existingCollege.id }, data: collegeData });
    } else {
      await prisma.partner.create({ data: collegeData });
    }
  }

  const seedFacultyBio = await (async () => {
    const existing = await prisma.facultyBio.findFirst({ where: { tenantId: tenant.id, name: "Priya Sharma" } });
    const data = {
      tenantId: tenant.id,
      name: "Priya Sharma",
      title: "Senior Full-Stack Faculty, Ex-Amazon",
      bio: "Priya has 8 years of industry experience building large-scale web platforms and has taught 500+ students at Stimuliiq.",
      status: "published" as const,
      order: 0,
    };
    return existing
      ? prisma.facultyBio.update({ where: { id: existing.id }, data })
      : prisma.facultyBio.create({ data });
  })();

  const seedContentPage = await (async () => {
    const existing = await prisma.contentPage.findFirst({ where: { tenantId: tenant.id, slug: "about-us" } });
    const data = {
      tenantId: tenant.id,
      slug: "about-us",
      title: "About Stimuliiq",
      body: [{ type: "hero", data: { heading: "We train India's next generation of healthcare professionals" } }],
      status: "published" as const,
      publishedAt: new Date("2026-01-01T00:00:00Z"),
    };
    return existing
      ? prisma.contentPage.update({ where: { id: existing.id }, data })
      : prisma.contentPage.create({ data });
  })();

  // Phase-10 Page Builder: one version-1 snapshot for seedContentPage, so Wave-3
  // backend-builder integration tests (history list + revert flow) have a realistic
  // starting point — same "one row per new model" convention as the rest of this Phase-9/
  // Phase-10 sample-data block.
  const existingContentPageVersion = await prisma.contentPageVersion.findFirst({
    where: { tenantId: tenant.id, contentPageId: seedContentPage.id, version: 1 },
  });
  if (!existingContentPageVersion) {
    await prisma.contentPageVersion.create({
      data: {
        tenantId: tenant.id,
        contentPageId: seedContentPage.id,
        version: 1,
        title: seedContentPage.title,
        body: seedContentPage.body as Prisma.InputJsonValue,
        seoTitle: seedContentPage.seoTitle,
        seoDescription: seedContentPage.seoDescription,
        createdById: adminUser.id,
      },
    });
  }

  // ── Phase-10 Page Builder — SiteSetting defaults ─────────────────────────────────────
  //
  // Seeds the CRM-editable sitewide primitives (nav, footer, SEO defaults, contact) with
  // the EXACT values currently hardcoded in apps/web, so wiring the site to read from
  // `site_settings` is visually a no-op on first deploy (docs/specs/phase-10-page-
  // builder.md). Sources:
  //   apps/web/src/components/shell/nav-config.ts       (nav.primary_links, footer.columns/legal_links)
  //   apps/web/src/lib/seo/metadata.ts                  (seo.defaults)
  //   apps/web/src/components/shell/site-shell.tsx       (footer.copyright_text, contact.*)
  // `key` is a dotted "<group>.<name>" namespace; `group` mirrors the leading segment for
  // CRM UI tab grouping only (not a uniqueness dimension — see SiteSetting doc comment).
  async function upsertSiteSetting(key: string, group: string, value: Prisma.InputJsonValue): Promise<void> {
    const existing = await prisma.siteSetting.findFirst({ where: { tenantId: tenant.id, key } });
    const data = { tenantId: tenant.id, key, group, value };
    if (existing) {
      await prisma.siteSetting.update({ where: { id: existing.id }, data });
    } else {
      await prisma.siteSetting.create({ data });
    }
  }

  // nav.primary_links: buildNavItems(null) static fallback — "Courses" is a live mega-menu
  // in the app (dynamic catalog), represented here as a plain link to its footer
  // "View All Programs" target (/programs) since SiteSetting stores primitives, not
  // dynamically-composed mega-menu sections.
  await upsertSiteSetting("nav.primary_links", "nav", [
    { label: "Courses", href: "/programs" },
    { label: "Mentors", href: "/mentors" },
    { label: "Scholarship", href: "/scholarship" },
    { label: "For Colleges", href: "/for-colleges" },
    { label: "About", href: "/about" },
    { label: "Blog", href: "/blog" },
    { label: "Contact", href: "/contact" },
  ]);

  await upsertSiteSetting("footer.columns", "footer", [
    {
      heading: "Company",
      links: [
        { label: "About Us", href: "/about" },
        { label: "Mentors", href: "/mentors" },
        { label: "Testimonials", href: "/testimonials" },
        { label: "Gallery", href: "/gallery" },
        { label: "Careers", href: "/careers" },
      ],
    },
    {
      heading: "Resources",
      links: [
        { label: "Blog", href: "/blog" },
        { label: "Scholarship", href: "/scholarship" },
        { label: "FAQ", href: "/faq" },
        { label: "Pricing", href: "/pricing" },
        { label: "For Colleges", href: "/for-colleges" },
      ],
    },
    {
      heading: "Legal",
      links: [
        { label: "Privacy Policy", href: "/privacy" },
        { label: "Terms of Service", href: "/terms" },
        { label: "Refund Policy", href: "/refund-policy" },
        { label: "Contact Us", href: "/contact" },
      ],
    },
  ]);

  await upsertSiteSetting("footer.legal_links", "footer", [
    { label: "Privacy Policy", href: "/privacy" },
    { label: "Terms of Service", href: "/terms" },
    { label: "Refund Policy", href: "/refund-policy" },
  ]);

  // footer.copyright_text carries a "{year}" placeholder — the hardcoded value
  // interpolates `new Date().getFullYear()` at render time (site-shell.tsx
  // CURRENT_YEAR); baking in a specific year here would go stale.
  await upsertSiteSetting("footer.copyright_text", "footer", {
    template: "© {year} Stimuli IQ Technologies Pvt. Ltd. All rights reserved.",
  });

  await upsertSiteSetting("seo.defaults", "seo", {
    siteName: "Stimuli IQ",
    defaultDescription:
      "Stimuli IQ is India's internship and career training platform for MBBS, BDS, Nursing, Pharmacy, and Allied Health students. Structured programs, verifiable certificates, clinician mentors.",
    // Relative path — combined with NEXT_PUBLIC_SITE_URL at render time (matches
    // apps/web/src/lib/seo/metadata.ts DEFAULT_OG_IMAGE, which is env-derived).
    defaultOgImagePath: "/og-default.png",
  });

  await upsertSiteSetting("contact.details", "contact", {
    contactText: "India's Next Generation Healthcare Learning Platform",
  });

  // contact.whatsapp — matches site-shell.tsx's NEXT_PUBLIC_WHATSAPP_NUMBER/_MESSAGE
  // fallback defaults (env vars override these in every real deployment).
  //
  // L3 (security review, apps/web fix): `message` is now RAW human-readable text, NOT
  // URL-encoded. `web`'s SiteShell applies `encodeURIComponent()` exactly once at the
  // `wa.me` href construction site — a pre-encoded value stored here would be
  // double-encoded there. NOTE: this changes the stored-value convention documented in
  // `packages/types/src/content/site-settings.schemas.ts`'s `ContactWhatsappValueSchema`
  // doc comment ("message is stored URL-encoded") — that file is out of this fix's scope
  // (owned/being hardened by another agent in parallel); the zod schema itself only
  // enforces `z.string().min(1).max(500)` (no encoding-format constraint), so this value
  // still validates, but whoever next touches that file should update its now-stale doc
  // comment to match this raw-text convention.
  await upsertSiteSetting("contact.whatsapp", "contact", {
    number: "919177748321",
    message: "Hi, I want to know more about Stimuli IQ programs",
  });

  // announcement.bar — the CRM-toggleable message strip above the website header
  // (apps/web SiteShell → AnnouncementBar). Seeded OFF: the strip renders nothing
  // until a super_admin enables it in CRM → Marketing → Site settings → Announcement.
  await upsertSiteSetting("announcement.bar", "announcement", {
    enabled: false,
    message: "Admissions are open — book a free counselling slot today.",
    mode: "static",
  });

  // P10-2 (real-user defect promoted from follow-up): `stats.headline` was REMOVED
  // entirely — `apps/web`'s homepage never actually read this setting (the homepage
  // stat trio is sourced from the `home` page's Page Builder `stat_group` block
  // instead, seeded below via BUILDER_PAGES), so a super_admin editing "Stats" in the
  // CRM saved successfully but changed NOTHING on the live site — a save-but-does-
  // nothing trap. The Page Builder `stat_group` block is now the single source of
  // truth for on-page stats.
  //
  // Idempotent cleanup: soft-delete (never hard-delete, CLAUDE.md §3.4 — audit_logs
  // history for any prior edit must survive) any pre-existing `stats.headline` row a
  // dev/staging DB may already carry from before this removal (including a
  // super_admin's own test edit — that edit's audit trail is preserved, it's just no
  // longer a live, readable setting). `updateMany` + `deletedAt: null` guard makes this
  // safe to re-run on every `db:seed` invocation — a no-op once the row is already
  // soft-deleted (or was never seeded, e.g. a fresh DB created after this removal).
  await prisma.siteSetting.updateMany({
    where: { tenantId: tenant.id, key: "stats.headline", deletedAt: null },
    data: { deletedAt: new Date() },
  });

  // ── Phase-10 Page Builder — migrated marketing pages (docs/specs/phase-10-page-
  // builder.md, "Existing pages render identically after migration" AC 10) ────────────
  //
  // Seeds the 6 audited `web` pages (home, about, scholarship, for-colleges, gallery,
  // careers) as `isBuilderManaged=true`, `status='published'` ContentPage rows so the
  // thin route wrappers `frontend-builder` migrated (apps/web/src/app/{page.tsx,about,
  // scholarship,for-colleges,gallery,careers}/page.tsx) resolve real CMS content instead
  // of always hitting their hardcoded-constants fallback path. Block arrays live in
  // prisma/fixtures/builder-pages/*.json (validated against `PageBuilderBlockSchema` by
  // packages/types/src/content/page-builder-fixtures.test.ts — this seed does not
  // re-validate at runtime, matching this file's existing convention of trusting
  // reviewed/tested JSON literals for other JSON columns, e.g. `seedContentPage.body`
  // above). `isBuilderManaged` bypasses the generic draft/publish gate (forced
  // `status='published'` per the builder's "save is live" model), same as
  // `content-pages-builder.service.ts`'s create path.
  const BUILDER_PAGES: Array<{ slug: string; title: string; seoTitle: string; seoDescription: string }> = [
    {
      slug: "home",
      title: "Stimuli IQ | Healthcare Training & Internships for Students in India",
      seoTitle: "Healthcare training and internships for students in India",
      seoDescription:
        "Structured training and internship tracks in psychology, clinical practice, and allied healthcare. Healthcare mentors, real case work, and verifiable certificates.",
    },
    {
      slug: "about",
      title: "About Us",
      seoTitle: "About Stimuli IQ",
      seoDescription:
        "Stimuli IQ is a healthcare education and training platform for India's medical, psychology, and allied health science students — bridging the gap between academics and real practice.",
    },
    {
      slug: "scholarship",
      title: "Stimuli IQ Scholarship Programme",
      seoTitle: "Scholarship programme: merit and need based fee waivers",
      seoDescription:
        "The Stimuli IQ Scholarship grants merit-and-need-based fee waivers of up to 50% on healthcare training and internship programs for students across India.",
    },
    {
      slug: "for-colleges",
      title: "For Campus Communities",
      seoTitle: "Healthcare training collaborations for campus communities",
      seoDescription: "Collaborate with Stimuli IQ to bring hands-on healthcare training, workshops, mentorship, and career exposure to your campus community.",
    },
    {
      slug: "gallery",
      title: "Gallery",
      seoTitle: "Gallery | Sessions, Certificates & Events",
      seoDescription: "Photos and highlights from Stimuli IQ training sessions, certificate ceremonies, and industry events.",
    },
    {
      slug: "careers",
      title: "Careers at Stimuli IQ",
      seoTitle: "Careers at Stimuli IQ",
      seoDescription: "Join the Stimuli IQ team. We are hiring instructors, counsellors, and engineers passionate about transforming medical training in India.",
    },
  ];

  const builderPagesFixturesDir = join(__dirname, "fixtures", "builder-pages");

  for (const page of BUILDER_PAGES) {
    const existingBuilderPage = await prisma.contentPage.findFirst({ where: { tenantId: tenant.id, slug: page.slug } });
    // CREATE-ONLY: builder pages are CRM-editable content (super_admins author the
    // homepage stats, hero copy, etc. via the page builder). Re-seeding must NEVER
    // overwrite an existing page's body — doing so silently discards live CRM edits
    // (a real incident: a `db:seed` run reset the homepage `stat_group` back to the
    // fixture defaults). So we only seed a page when it's MISSING (fresh DB); if it
    // already exists we leave it exactly as the CRM last saved it.
    if (existingBuilderPage) continue;
    const body = JSON.parse(readFileSync(join(builderPagesFixturesDir, `${page.slug}.json`), "utf-8")) as Prisma.InputJsonValue;
    await prisma.contentPage.create({
      data: {
        tenantId: tenant.id,
        slug: page.slug,
        title: page.title,
        body,
        seoTitle: page.seoTitle,
        seoDescription: page.seoDescription,
        status: "published" as const,
        publishedAt: new Date("2026-01-01T00:00:00Z"),
        isBuilderManaged: true,
      },
    });
  }

  const existingNewsletter = await prisma.newsletterSubscription.findFirst({
    where: { tenantId: tenant.id, email: "newsletter.subscriber@example.com" },
  });
  if (!existingNewsletter) {
    await prisma.newsletterSubscription.create({
      data: {
        tenantId: tenant.id,
        email: "newsletter.subscriber@example.com",
        consent: { marketing_opt_in: true, tos_version: "2026-01-01", timestamp: new Date().toISOString(), ip_hash: "seed-stub" },
        status: "active",
      },
    });
  }

  const existingContactSubmission = await prisma.contactSubmission.findFirst({
    where: { tenantId: tenant.id, email: "prospective.parent@example.com" },
  });
  if (!existingContactSubmission) {
    await prisma.contactSubmission.create({
      data: {
        tenantId: tenant.id,
        name: "Prospective Parent",
        email: "prospective.parent@example.com",
        phone: "+91-9876500000",
        subject: "Fee structure query",
        message: "Could you share the fee structure and EMI options for the Full-Stack program?",
        status: "new",
      },
    });
  }

  const existingCareerApplication = await prisma.careerApplication.findFirst({
    where: { tenantId: tenant.id, email: "applicant.dev@example.com" },
  });
  if (!existingCareerApplication) {
    await prisma.careerApplication.create({
      data: {
        tenantId: tenant.id,
        name: "Applicant Developer",
        email: "applicant.dev@example.com",
        role: "Backend Engineer",
        resumeStorageKey: "careers/stimuliiq/seed-applicant-dev-resume.pdf",
        status: "new",
      },
    });
  }

  // T9: Setting.
  const existingSetting = await prisma.setting.findFirst({
    where: { tenantId: tenant.id, scope: "company", key: "support_desk_sla_hours" },
  });
  if (!existingSetting) {
    await prisma.setting.create({
      data: { tenantId: tenant.id, scope: "company", key: "support_desk_sla_hours", value: 24 },
    });
  }

  // T10: Bookmark + LessonNote — Ananya bookmarks lesson1 and leaves a timestamped note.
  const existingBookmark = await prisma.bookmark.findFirst({
    where: { tenantId: tenant.id, userId: ananyaUser.id, refType: "lesson", refId: lesson1.id },
  });
  if (!existingBookmark) {
    await prisma.bookmark.create({
      data: { tenantId: tenant.id, userId: ananyaUser.id, refType: "lesson", refId: lesson1.id, note: "Revisit Flexbox alignment section" },
    });
  }
  const existingLessonNote = await prisma.lessonNote.findFirst({
    where: { tenantId: tenant.id, userId: ananyaUser.id, lessonId: lesson1.id },
  });
  if (!existingLessonNote) {
    await prisma.lessonNote.create({
      data: {
        tenantId: tenant.id,
        userId: ananyaUser.id,
        lessonId: lesson1.id,
        timestampS: 420,
        body: "justify-content vs align-items — remember: main axis vs cross axis.",
      },
    });
  }

  // T11: Referral + EmiPlan + EmiInstallment (2 installments against Ananya's paidOrder).
  const seedReferral = await (async () => {
    const existing = await prisma.referral.findFirst({ where: { tenantId: tenant.id, code: "ANANYA2026" } });
    const data = {
      tenantId: tenant.id,
      referrerUserId: ananyaUser.id,
      code: "ANANYA2026",
      reward: { type: "cash", amountPaise: 100000, currency: "INR" },
      status: "pending" as const,
    };
    return existing
      ? prisma.referral.update({ where: { id: existing.id }, data })
      : prisma.referral.create({ data });
  })();

  const seedEmiPlan = await (async () => {
    const existing = await prisma.emiPlan.findFirst({ where: { tenantId: tenant.id, orderId: paidOrder.id, deletedAt: null } });
    const data = {
      tenantId: tenant.id,
      orderId: paidOrder.id,
      totalAmountPaise: paidOrder.amountPaise,
      currency: "INR",
      numInstallments: 2,
      startDate: new Date("2026-06-01T00:00:00Z"),
      status: "active" as const,
    };
    return existing
      ? prisma.emiPlan.update({ where: { id: existing.id }, data })
      : prisma.emiPlan.create({ data });
  })();

  const emiInstallmentDefs = [
    { installmentNo: 1, amountPaise: Math.floor(paidOrder.amountPaise / 2), dueDate: new Date("2026-06-01T00:00:00Z"), status: "paid" as const, paidAt: new Date("2026-06-01T00:00:00Z") },
    { installmentNo: 2, amountPaise: paidOrder.amountPaise - Math.floor(paidOrder.amountPaise / 2), dueDate: new Date("2026-07-01T00:00:00Z"), status: "pending" as const, paidAt: null },
  ];
  for (const def of emiInstallmentDefs) {
    const existing = await prisma.emiInstallment.findFirst({
      where: { tenantId: tenant.id, emiPlanId: seedEmiPlan.id, installmentNo: def.installmentNo, deletedAt: null },
    });
    const data = {
      tenantId: tenant.id,
      emiPlanId: seedEmiPlan.id,
      installmentNo: def.installmentNo,
      amountPaise: def.amountPaise,
      dueDate: def.dueDate,
      status: def.status,
      paidAt: def.paidAt,
    };
    if (!existing) {
      await prisma.emiInstallment.create({ data });
    } else {
      await prisma.emiInstallment.update({ where: { id: existing.id }, data });
    }
  }

  // T12: LandingPage + LeadForm.
  const seedLandingPage = await (async () => {
    const existing = await prisma.landingPage.findFirst({
      where: { tenantId: tenant.id, slug: "fullstack-monsoon-offer", variant: "a" },
    });
    const data = {
      tenantId: tenant.id,
      campaign: "monsoon-2026",
      slug: "fullstack-monsoon-offer",
      title: "Full-Stack Web Dev — Monsoon Offer",
      variant: "a",
      content: [{ type: "hero", data: { heading: "Flat 15% off — offer ends soon" } }],
      status: "published" as const,
      publishedAt: new Date("2026-07-01T00:00:00Z"),
    };
    return existing
      ? prisma.landingPage.update({ where: { id: existing.id }, data })
      : prisma.landingPage.create({ data });
  })();

  const seedLeadForm = await (async () => {
    const existing = await prisma.leadForm.findFirst({ where: { tenantId: tenant.id, key: "homepage-hero" } });
    const data = {
      tenantId: tenant.id,
      key: "homepage-hero",
      name: "Homepage Hero Lead Form",
      fields: [
        { key: "name", label: "Full Name", type: "text", required: true },
        { key: "phone", label: "Phone Number", type: "tel", required: true },
        { key: "email", label: "Email", type: "email", required: false },
      ],
      targetProgramId: fullstackProgram.id,
      active: true,
    };
    return existing
      ? prisma.leadForm.update({ where: { id: existing.id }, data })
      : prisma.leadForm.create({ data });
  })();

  // ── Onboarding form (onboarding.stimuliiq.com) ─────────────────────────────────
  //
  // Seeds the eight questions the Google Form asked, in its order. Nothing about them is
  // special after this point: they are ordinary `onboarding_fields` rows, and staff edit
  // labels, help text, choices, required-ness, order — or delete them and add their own —
  // entirely from the CRM. This seed exists so the form is usable on day one, not to
  // define a protected core.
  //
  // Two deliberate departures from the Google Form:
  //   - "Month Opted" was a hardcoded Sep–Dec radio, which goes stale every year. It stays
  //     a radio (staff edit the choices in the CRM when the intake window moves).
  //   - The program is a `program`-typed dropdown fed live from the published catalog,
  //     replacing the form title's hardcoded "Psychology Fellowship Program 2026" — so one
  //     permanent link keeps working as programs change.
  //
  // Upsert-by-key, and `update` touches only `label`/`type`-shaped defaults on a row staff
  // have not yet made their own: re-running the seed must never silently revert a staff
  // edit. `sortOrder`/`required` are set on create only for exactly that reason.
  const onboardingFieldDefs: Array<{
    key: string;
    label: string;
    helpText?: string;
    placeholder?: string;
    type: "text" | "email" | "phone" | "radio" | "textarea" | "file" | "program";
    required: boolean;
    options?: string[];
    allowOther?: boolean;
    identityRole?: "name" | "email" | "phone";
  }> = [
    { key: "full_name", label: "Name", type: "text", required: true, identityRole: "name", placeholder: "Your full name" },
    { key: "email", label: "Email ID", type: "email", required: true, identityRole: "email", placeholder: "you@example.com" },
    { key: "contact_number", label: "Contact Number", type: "phone", required: true, identityRole: "phone" },
    { key: "whatsapp_number", label: "Whatsapp Number", type: "phone", required: true },
    { key: "college_name", label: "College Name", type: "text", required: true },
    { key: "program", label: "Program", helpText: "The program you have enrolled in.", type: "program", required: true },
    {
      key: "month_opted",
      label: "Month Opted",
      helpText: "Enter the preferred month.",
      type: "radio",
      required: true,
      options: ["September", "October", "November", "December"],
      allowOther: true,
    },
    {
      key: "referrals",
      label: "Referrals from the batch",
      helpText: "Contact details of someone you would like to refer to this program.",
      type: "textarea",
      required: false,
    },
    {
      key: "payment_receipt",
      label: "Payment Receipt",
      helpText: "Upload a screenshot or PDF of your payment. Max 10 MB.",
      type: "file",
      required: true,
    },
  ];

  for (const [index, def] of onboardingFieldDefs.entries()) {
    const existing = await prisma.onboardingField.findFirst({
      where: { tenantId: tenant.id, key: def.key, deletedAt: null },
    });
    if (existing) continue; // Staff own this row now — never overwrite their edits.
    await prisma.onboardingField.create({
      data: {
        tenantId: tenant.id,
        key: def.key,
        label: def.label,
        helpText: def.helpText ?? null,
        placeholder: def.placeholder ?? null,
        type: def.type,
        required: def.required,
        options: def.options ?? undefined,
        allowOther: def.allowOther ?? false,
        identityRole: def.identityRole ?? "none",
        sortOrder: index,
        active: true,
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log("[seed]   --- Phase-9 Completion (Wave 1 schema) ---");
  // eslint-disable-next-line no-console
  console.log(`[seed]   P9 permissions:    ${P9_PERMISSIONS.length} (liveclass.*/tickets.*/kb.*/content.*/flags.*/settings.*/bookmarks.manage/notes.manage/search.use/emi.*/referrals.*/videolib.*/bulk.*/twofa.manage/landing_pages.*/lead_forms.*)`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   live_class:        1 (${seedLiveClass.title}, hydBatch, host=Priya)`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   ticket:            1 (Ananya → support.meera, open, 1 reply, id=${seedTicket.id})`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   kb_article:        1 published ("${seedKbArticle.title}")`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   blog_post:         1 published ("${seedBlogPost.title}")`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   testimonial/partner/faculty_bio: 1 each (published)`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   content_page:      1 published (about-us)`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   newsletter/contact/career: 1 each`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   feature_flag/setting: 1 each`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   bookmark/lesson_note: 1 each (Ananya, lesson1)`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   referral:          1 (${seedReferral.code}, pending)`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   emi_plan:          1 (2 installments — 1 paid, 1 pending, on paidOrder)`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   landing_page/lead_form: 1 each`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   --- Onboarding form (onboarding.stimuliiq.com) ---`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   onboarding perms:  ${ONBOARDING_PERMISSIONS.length} (onboarding.view/edit/delete + onboarding.fields.manage)`);
  console.log(`[seed]   careers perms:     ${CAREERS_PERMISSIONS.length} (careers.view/review + careers.openings.manage)`);
  // eslint-disable-next-line no-console
  console.log(`[seed]   onboarding_fields: ${onboardingFieldDefs.length} seeded questions (all CRM-editable; existing rows never overwritten)`);

  void seedCannedResponse;
  void seedFacultyBio;
  void seedContentPage;
  void seedPartner;
  void seedTestimonial;
  void seedLandingPage;
  void seedLeadForm;

  // Suppress unused-variable warnings via void — these variables are assigned for clarity
  // and used in the summary above; TypeScript strict mode requires this acknowledgement.
  void linkedEnrollment;
  void seedBooking;
  void seedAssignment;
  void seedProject;
  void seedSubmission;
  void seedAttempt;
  void seedCertificate;
  void couponPublicWelcome;
  void ananyaBadge;
  void emailTemplate;
  void whatsappTemplate;
  void smsTemplate;
  void seedPost2;

  if (printedPassword) {
    // eslint-disable-next-line no-console
    console.log("\n[seed] ──────────────────────────────────────────────────────────────");
    // eslint-disable-next-line no-console
    console.log("[seed]  ADMIN PASSWORD (shown ONCE — store it now, it is not persisted");
    // eslint-disable-next-line no-console
    console.log("[seed]  in plaintext anywhere and will not be printed again):");
    // eslint-disable-next-line no-console
    console.log(`[seed]\n[seed]    ${printedPassword}\n[seed]`);
    // eslint-disable-next-line no-console
    console.log("[seed] ──────────────────────────────────────────────────────────────\n");
  } else {
    // eslint-disable-next-line no-console
    console.log("[seed]   (admin user already existed — password left unchanged)\n");
  }
}

main()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console -- seed scripts run outside the app logger
    console.error("[seed] failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
