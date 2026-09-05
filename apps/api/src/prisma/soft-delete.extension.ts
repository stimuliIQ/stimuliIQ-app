// apps/api/src/prisma/soft-delete.extension.ts
//
// Soft-delete Prisma Client Extension (docs/05-database-design.md §5).
//
// Behavior:
//   - `delete` / `deleteMany` on a soft-deletable model are rewritten into
//     `update {deleted_at: now()}` / `updateMany {deleted_at: now()}`. No row is ever
//     hard-deleted through the normal Prisma Client API.
//   - `find*` / `count` / `aggregate` / `groupBy` queries automatically filter out
//     soft-deleted rows by merging `deleted_at: null` into the `where` clause, unless
//     the caller explicitly passes a `deletedAt` filter (so privileged
//     "show deleted" / restore flows can opt out by passing their own filter).
//   - Hard deletes are intentionally NOT exposed here. Use `prisma.$executeRaw` (or a
//     dedicated privileged purge job) for GDPR/DPDP erasure, per docs/05 §5.
//
// `AuditLog` is append-only and explicitly excluded — it has no `deleted_at` column
// and must never be soft-deleted or filtered.

import { Prisma } from "@prisma/client";

/** Models that carry `deleted_at` and participate in soft-delete filtering. */
const SOFT_DELETE_MODELS = new Set<string>([
  "Tenant",
  "Branch",
  "User",
  "Role",
  "Permission",
  "RolePermission",
  "UserRole",
  "Session",
  "Program",
  "Module",
  "Lesson",
  "StudentProfile",
  "FacultyProfile",
  "Batch",
  "Enrollment",
  // Phase-2 Commerce (docs/plans/phase-2.md task #1)
  "Order",
  "Payment",
  "Invoice",
  "Refund",
  "Coupon",
  // Phase-2 CRM & leads
  "Lead",
  "Activity",
  "Booking",
  // Phase-3 LMS core (docs/plans/phase-3.md task #1)
  // All four new LMS tables carry deleted_at and must participate in soft-delete filtering.
  "Video",
  "LessonProgress",
  "Attendance",
  "Resource",
  // Phase-4 Learning Depth (docs/plans/phase-4.md task #1)
  // All eight new P4 tables carry deleted_at and must participate in soft-delete filtering.
  "Assignment",
  "AssignmentMilestone",
  "Submission",
  "Assessment",
  "AssessmentQuestion",
  "Attempt",
  "CertificateTemplate",
  "Certificate",
  // Phase-6 Engagement (docs/plans/phase-6.md). These all carry deleted_at and ARE in
  // AUDITED_MODELS, but were omitted here — so `.delete()` hard-deleted them (e.g.
  // softDeleteCampaign) and reads did not auto-filter soft-deleted rows unless the repo
  // added `deletedAt: null` by hand. Registering them makes soft-delete uniform. Repos
  // that already filter `deletedAt` explicitly are unaffected (withNotDeleted opts out).
  "Notification",
  "NotificationPref",
  "NotificationSuppression",
  "CampaignTemplate",
  "EmailTemplate",
  "Campaign",
  "CampaignRecipient",
  "Badge",
  "UserBadge",
  "PointsLedger",
  "ForumThread",
  "ForumPost",
  "ForumPostVote",
  // Phase-7 Analytics + Hardening (docs/plans/phase-7.md Wave 1 task #4)
  "ExportJob",
  // Phase-7 Wave 2 task #11 (recurring report scheduling)
  "ReportSchedule",
  // Phase-8 Mentor (human mentor, hired-from-external-institute — corrected direction;
  // the earlier "AI mentor" plan was never implemented). Both carry deleted_at.
  "Mentor",
  "BatchMentor",
  // Phase-9 Completion (docs/plans/phase-9-completion.md Wave 1 T6-T12). All twenty-two
  // new tables carry deleted_at and must participate in soft-delete filtering.
  "LiveClass",
  "Ticket",
  "TicketMessage",
  "CannedResponse",
  "KbArticle",
  "BlogCategory",
  "BlogPost",
  "Testimonial",
  "Partner",
  "FacultyBio",
  "ContentPage",
  "NewsletterSubscription",
  "ContactSubmission",
  "CareerApplication",
  // Careers/hiring (ADR-0066). An opening is soft-deleted so the applications that
  // reference it keep their FK — and so its slug frees up for reuse via the partial
  // unique index (see the migration).
  "JobOpening",
  "Setting",
  "Bookmark",
  "LessonNote",
  "Referral",
  "EmiPlan",
  "EmiInstallment",
  "LandingPage",
  "LeadForm",
  // T28 2FA hardening. Soft-deleted (disable sets deleted_at); the partial-unique
  // index (user_id WHERE deleted_at IS NULL) allows re-enrolment. Deliberately NOT
  // in AUDITED_MODELS — a TOTP secret must never be snapshotted into audit_logs.
  "TwoFactorCredential",
  // CRM-managed course types. Soft-deleted so the partial-unique index on
  // (tenant_id, key) stays reusable — remove a mistyped option and add it back — and so a
  // removal never destroys the option a student row still points at by key.
  "CourseType",
  // Student onboarding form. A deleted question must stop being asked without
  // destroying the answers already given to it (those live in the submission's
  // `answers` snapshot); a deleted submission must stay recoverable.
  "OnboardingField",
  "OnboardingSubmission",
  // Staff leave management. Every one of these is soft-deleted so the partial-unique
  // indexes stay re-usable (delete the "Casual" type or a wrongly-dated holiday and add
  // it back), and so a deleted leave request stays recoverable — it is the evidence
  // behind an absence somebody's payroll may depend on.
  "LeaveType",
  "LeaveQuota",
  "Holiday",
  "LeaveSetting",
  "LeaveRequest",
  // Monthly marketing targets — soft-deleted so the partial unique index on
  // (tenant, user, month) stays re-usable: remove a target set for the wrong person and set
  // the right one for the same month, without the tombstone blocking it forever.
  "MarketingTarget",
  // Org hierarchy — soft-deleted so the partial unique on (tenant, name) stays reusable, and
  // so a disbanded team's name can be taken again without the tombstone blocking it.
  "Team",
]);

function isSoftDeletable(model: string | undefined): boolean {
  return !!model && SOFT_DELETE_MODELS.has(model);
}

/** Merges `deleted_at: null` into a where clause unless the caller already filters on it. */
function withNotDeleted(where: Record<string, unknown> | undefined): Record<string, unknown> {
  const base = where ?? {};
  if ("deletedAt" in base) {
    return base;
  }
  return { ...base, deletedAt: null };
}

const READ_OPERATIONS_NEEDING_FILTER = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

// Generic delegate shape covering the handful of model-client methods we redirect to.
// `client[modelProperty]` returns the per-model delegate (e.g. `client.branch`), which
// exposes the *real* `update`/`updateMany` methods — distinct from the `query` callback
// passed into a `$allOperations` hook, which always re-invokes the *original* operation
// the hook fired for (so it cannot itself be used to change `delete` into `update`).
interface ModelDelegate {
  update: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<unknown>;
  updateMany: (args: { where?: Record<string, unknown>; data: Record<string, unknown> }) => Promise<unknown>;
}

/** Maps a Prisma `ModelName` (e.g. "Branch") to its client delegate property (e.g. "branch"). */
function toDelegateProperty(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/** Looks up a model's delegate on `client`, throwing if the model is somehow unknown. */
function getModelDelegate(client: unknown, model: string): ModelDelegate {
  const delegate = (client as Record<string, ModelDelegate>)[toDelegateProperty(model)];
  if (!delegate) {
    throw new Error(`[soft-delete] no client delegate found for model "${model}"`);
  }
  return delegate;
}

export const softDeleteExtension = Prisma.defineExtension((client) =>
  client.$extends({
    name: "soft-delete",
    query: {
      $allModels: {
        // Single hook covering every operation on every model (Prisma's documented
        // `$allOperations` pattern). We branch on `operation` to:
        //   1. inject `deleted_at: null` into read filters, and
        //   2. rewrite delete/deleteMany into update/updateMany with `deleted_at: now()`,
        //      dispatched through the *outer* `client`'s own model delegate (captured by
        //      this closure) rather than through `query`, since `query` is permanently
        //      bound to the original operation.
        async $allOperations({ model, operation, args, query }) {
          if (!isSoftDeletable(model)) {
            return query(args);
          }

          if (READ_OPERATIONS_NEEDING_FILTER.has(operation)) {
            const typedArgs = args as { where?: Record<string, unknown> };
            typedArgs.where = withNotDeleted(typedArgs.where);
            return query(args);
          }

          if (operation === "delete") {
            const typedArgs = args as { where: Record<string, unknown> };
            const delegate = getModelDelegate(client, model);
            return delegate.update({ where: typedArgs.where, data: { deletedAt: new Date() } });
          }

          if (operation === "deleteMany") {
            const typedArgs = args as { where?: Record<string, unknown> };
            const delegate = getModelDelegate(client, model);
            return delegate.updateMany({
              where: withNotDeleted(typedArgs.where),
              data: { deletedAt: new Date() },
            });
          }

          return query(args);
        },
      },
    },
  }),
);
