// OpenAPI registry — wires the zod schemas from ../auth and ../common into
// named OpenAPI components + path definitions. This file is the ONLY place
// that knows about `@asteasolutions/zod-to-openapi`; the DTO files in
// ../auth and ../common stay framework-agnostic zod so the frontend bundle
// never needs to pull in the openapi generator package.
//
// Source of truth flow: zod schemas (../auth, ../common) → this registry →
// generate.ts emits openapi.json → apps/api serves it at /api-docs.json →
// @repo/api-client is generated/hand-typed against it. One contract, no
// drift between BE validation and the published spec (CLAUDE.md §3.2).

import "./zod-extend.js";
import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import type { OpenAPIObject } from "openapi3-ts/oas31";
import { z } from "zod";
import { ProblemDetailsSchema } from "../common/envelope.js";
import {
  LoginRequestSchema,
  RefreshRequestSchema,
  LogoutRequestSchema,
  OtpRequestRequestSchema,
  OtpVerifyRequestSchema,
  AuthSessionDataSchema,
  OtpRequestDataSchema,
  LogoutDataSchema,
  MeResponseSchema,
} from "../auth/auth.schemas.js";
import { OffsetPaginationMetaSchema } from "../common/pagination.js";
import {
  CreateStudentRequestSchema,
  UpdateStudentRequestSchema,
  RestoreStudentRequestSchema,
  StudentSummarySchema,
  StudentDetailSchema,
  ResendCredentialsResponseSchema,
} from "../crm/students.schemas.js";
import {
  CreateFacultyRequestSchema,
  UpdateFacultyRequestSchema,
  RestoreFacultyRequestSchema,
  FacultySummarySchema,
  FacultyDetailSchema,
  FacultyResetPasswordResponseSchema,
} from "../crm/faculty.schemas.js";
import {
  CreateProgramRequestSchema,
  UpdateProgramRequestSchema,
  PublishProgramRequestSchema,
  ProgramSummarySchema,
  ProgramDetailSchema,
  CurriculumTreeSchema,
  CreateModuleRequestSchema,
  UpdateModuleRequestSchema,
  ReorderModulesRequestSchema,
  ModuleNodeSchema,
  CreateLessonRequestSchema,
  UpdateLessonRequestSchema,
  ReorderLessonsRequestSchema,
  LessonNodeSchema,
} from "../crm/courses.schemas.js";
import {
  CreateBatchRequestSchema,
  UpdateBatchRequestSchema,
  RestoreBatchRequestSchema,
  AssignBatchFacultyRequestSchema,
  BatchSummarySchema,
  BatchDetailSchema,
  BatchRosterSchema,
} from "../crm/batches.schemas.js";
import {
  CreateEnrollmentRequestSchema,
  MoveEnrollmentRequestSchema,
  WithdrawEnrollmentRequestSchema,
  EnrollmentSchema,
} from "../crm/enrollments.schemas.js";
import {
  CreateRoleRequestSchema,
  UpdateRoleRequestSchema,
  RoleSchema,
  PermissionMatrixSchema,
  RolePermissionsSchema,
  UpdateRolePermissionsRequestSchema,
  CreateBranchRequestSchema,
  UpdateBranchRequestSchema,
  BranchDetailSchema,
} from "../crm/admin.schemas.js";
import { AuditLogEntrySchema } from "../crm/audit.schemas.js";

// ── Phase 2 commerce imports ──────────────────────────────────────────────
import {
  CreateOrderRequestSchema,
  ListOrdersQuerySchema,
  OrderSummarySchema,
  OrderDetailSchema,
} from "../commerce/orders.schemas.js";
import {
  CreateRazorpayOrderResponseSchema,
  VerifyPaymentRequestSchema,
  RazorpayWebhookSchema,
  ManualPaymentRequestSchema,
  ListPaymentsQuerySchema,
  PaymentSummarySchema,
  PaymentDetailSchema,
  LedgerReconciliationSchema,
} from "../commerce/payments.schemas.js";
import {
  ListInvoicesQuerySchema,
  InvoiceSummarySchema,
  InvoiceDetailSchema,
  InvoiceDownloadResponseSchema,
} from "../commerce/invoices.schemas.js";
import {
  RequestRefundRequestSchema,
  ApproveRefundRequestSchema,
  RejectRefundRequestSchema,
  ListRefundsQuerySchema,
  RefundSummarySchema,
  RefundDetailSchema,
} from "../commerce/refunds.schemas.js";
import {
  CreateCouponRequestSchema,
  UpdateCouponRequestSchema,
  ListCouponsQuerySchema,
  ValidateCouponRequestSchema,
  ValidateCouponResponseSchema,
  CouponSummarySchema,
  CouponDetailSchema,
} from "../commerce/coupons.schemas.js";

// ── Phase 2 CRM leads imports ─────────────────────────────────────────────
import {
  CreateLeadRequestSchema,
  UpdateLeadRequestSchema,
  ListLeadsQuerySchema,
  MoveLeadStageRequestSchema,
  AssignLeadOwnerRequestSchema,
  ConvertLeadRequestSchema,
  LeadSummarySchema,
  LeadDetailSchema,
  ConvertLeadResponseSchema,
} from "../crm/leads.schemas.js";
import {
  CreateActivityRequestSchema,
  CompleteTaskRequestSchema,
  ListActivitiesQuerySchema,
  ActivityDetailSchema,
} from "../crm/activities.schemas.js";
import {
  CreateBookingRequestSchema,
  UpdateBookingRequestSchema,
  MoveBookingStatusRequestSchema,
  ListBookingsQuerySchema,
  CreatePublicBookingRequestSchema,
  PublicBookingResponseSchema,
  BookingSummarySchema,
  BookingDetailSchema,
} from "../crm/bookings.schemas.js";

// ── Phase 5 public surface imports ───────────────────────────────────────
import {
  PublicProgramSummarySchema,
  PublicProgramDetailSchema,
  ListPublicProgramsQuerySchema,
} from "../public/programs.schemas.js";
import {
  PublicLeadCaptureDtoSchema,
  PublicLeadCaptureResponseSchema,
} from "../public/leads.schemas.js";
import {
  PublicValidateCouponDtoSchema,
  PublicCouponDiscountResponseSchema,
} from "../public/coupons.schemas.js";
import { PublicRegisterDtoSchema } from "../public/auth.schemas.js";
import {
  PublicCreateOrderDtoSchema,
  PublicOrderResponseSchema,
  PublicCheckoutDtoSchema,
  PublicCheckoutResponseSchema,
  PublicVerifyPaymentDtoSchema,
  PublicVerifyPaymentResponseSchema,
} from "../public/enroll.schemas.js";

// ── Phase 3 LMS imports ───────────────────────────────────────────────────
import { MeDashboardResponseSchema } from "../lms/dashboard.schemas.js";
import {
  MyEnrollmentSummarySchema,
  MyEnrollmentDetailSchema,
} from "../lms/enrollments.schemas.js";
import { CurriculumResponseSchema } from "../lms/curriculum.schemas.js";
import {
  LessonDetailResponseSchema,
  StreamUrlResponseSchema,
  ResourceDownloadResponseSchema,
} from "../lms/lessons.schemas.js";
import {
  UpdateProgressRequestSchema,
  MarkLessonCompleteRequestSchema,
  ProgressResponseSchema,
  MyProgressResponseSchema,
} from "../lms/progress.schemas.js";

export const registry = new OpenAPIRegistry();

// ─────────────────────────────────────────────────────────────────────────
// Security schemes — cookie auth + CSRF header (LOCKED transport decision).
// ─────────────────────────────────────────────────────────────────────────

registry.registerComponent("securitySchemes", "cookieAuth", {
  type: "apiKey",
  in: "cookie",
  name: "access_token",
  description:
    "httpOnly Secure cookie set by login/refresh/otp-verify. Never readable or settable by client JS.",
});

registry.registerComponent("securitySchemes", "csrfHeader", {
  type: "apiKey",
  in: "header",
  name: "X-CSRF-Token",
  description:
    "Double-submit CSRF token. Read from the non-httpOnly `csrf_token` cookie (or the " +
    "`csrfToken` field in the auth response body) and echoed back on every unsafe " +
    "(POST/PATCH/PUT/DELETE) request.",
});

// ─────────────────────────────────────────────────────────────────────────
// Reusable component schemas
// ─────────────────────────────────────────────────────────────────────────

const ProblemDetails = registry.register("ProblemDetails", ProblemDetailsSchema);
const PaginationMeta = registry.register("OffsetPaginationMeta", OffsetPaginationMetaSchema);

function envelopeOf<T extends z.ZodTypeAny>(name: string, dataSchema: T) {
  return registry.register(
    `${name}Envelope`,
    z.object({
      data: dataSchema.nullable(),
      meta: z.record(z.string(), z.unknown()).nullable(),
      error: ProblemDetails.nullable(),
    }),
  );
}

/**
 * Envelope for offset-paginated CRM list endpoints — `meta` is the concrete
 * `OffsetPaginationMetaSchema` (page/pageSize/total/hasMore) rather than the
 * free-form record `envelopeOf` defaults to (docs/04 §2.14 envelope; see
 * common/pagination.ts for why CRM lists use offset, not cursor, pagination).
 */
function paginatedEnvelopeOf<T extends z.ZodTypeAny>(name: string, itemSchema: T) {
  return registry.register(
    `${name}ListEnvelope`,
    z.object({
      data: z.array(itemSchema).nullable(),
      meta: PaginationMeta.nullable(),
      error: ProblemDetails.nullable(),
    }),
  );
}

const LoginRequest = registry.register("LoginRequest", LoginRequestSchema);
const RefreshRequest = registry.register("RefreshRequest", RefreshRequestSchema);
const LogoutRequest = registry.register("LogoutRequest", LogoutRequestSchema);
const OtpRequestRequest = registry.register("OtpRequestRequest", OtpRequestRequestSchema);
const OtpVerifyRequest = registry.register("OtpVerifyRequest", OtpVerifyRequestSchema);

const AuthSessionEnvelope = envelopeOf("AuthSession", AuthSessionDataSchema);
const OtpRequestEnvelope = envelopeOf("OtpRequest", OtpRequestDataSchema);
const LogoutEnvelope = envelopeOf("Logout", LogoutDataSchema);
const MeEnvelope = envelopeOf("Me", MeResponseSchema);

const ErrorEnvelope = registry.register(
  "ErrorEnvelope",
  z.object({
    data: z.null(),
    meta: z.null(),
    error: ProblemDetails,
  }),
);

// NOTE: docs/04 §2.14 requires an `Idempotency-Key` header on unsafe mutations.
// None of this auth slice's mutations (login/refresh/logout/otp) need one —
// they are either naturally idempotent (refresh/logout) or have no
// side-effect duplication risk (login, OTP request/verify are rate-limited,
// not retried-with-side-effects). Future mutating modules (orders, payments,
// enrollments) register their own Idempotency-Key parameter alongside their
// own zod schemas — not duplicated here.

const errorResponses = {
  400: { description: "Validation error.", content: { "application/json": { schema: ErrorEnvelope } } },
  401: { description: "Unauthenticated.", content: { "application/json": { schema: ErrorEnvelope } } },
  403: { description: "Forbidden (RBAC/scope denied).", content: { "application/json": { schema: ErrorEnvelope } } },
  404: { description: "Not found.", content: { "application/json": { schema: ErrorEnvelope } } },
  409: { description: "Conflict (e.g. refresh reuse detected).", content: { "application/json": { schema: ErrorEnvelope } } },
  422: { description: "Unprocessable (e.g. OTP expired/invalid).", content: { "application/json": { schema: ErrorEnvelope } } },
  429: { description: "Rate limited.", content: { "application/json": { schema: ErrorEnvelope } } },
} as const;

// ─────────────────────────────────────────────────────────────────────────
// Paths
// ─────────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/v1/auth/login",
  description:
    "Email + password login (argon2id verified server-side). On success sets " +
    "`access_token` + `refresh_token` httpOnly cookies and a `csrf_token` cookie; " +
    "returns a minimal user summary + the CSRF token in the body. Requires no permission " +
    "(public, unauthenticated entry point).",
  summary: "Login with email + password",
  tags: ["auth"],
  request: { body: { content: { "application/json": { schema: LoginRequest } } } },
  responses: {
    200: { description: "Login succeeded.", content: { "application/json": { schema: AuthSessionEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/auth/refresh",
  description:
    "Rotates the refresh token. Reads the current `refresh_token` cookie (single-use); " +
    "on success issues a new access+refresh cookie pair and revokes the old token. Reuse " +
    "of an already-rotated refresh token revokes the entire session family (409) and the " +
    "user is forced to re-authenticate. Requires the CSRF header. No permission required " +
    "beyond a valid (even if access-expired) refresh cookie.",
  summary: "Rotate access + refresh tokens",
  tags: ["auth"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  request: { body: { content: { "application/json": { schema: RefreshRequest } } } },
  responses: {
    200: { description: "Refresh succeeded; new cookies set.", content: { "application/json": { schema: AuthSessionEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/auth/logout",
  description:
    "Revokes the current session (Redis + DB session row) and clears the auth + CSRF " +
    "cookies. Requires the CSRF header.",
  summary: "Logout / revoke current session",
  tags: ["auth"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  request: { body: { content: { "application/json": { schema: LogoutRequest } } } },
  responses: {
    200: { description: "Logged out; cookies cleared.", content: { "application/json": { schema: LogoutEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/auth/otp/request",
  description:
    "Requests a 6-digit OTP for the given phone. Phase 0: code is generated + logged " +
    "server-side; actual SMS delivery via `SmsProvider`/MSG91 is stubbed (response " +
    "`delivered: false` until Wave-4+ integration). Rate-limited per phone/IP. Public, " +
    "unauthenticated entry point.",
  summary: "Request an OTP for phone login",
  tags: ["auth"],
  request: { body: { content: { "application/json": { schema: OtpRequestRequest } } } },
  responses: {
    200: { description: "OTP issued.", content: { "application/json": { schema: OtpRequestEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/auth/otp/verify",
  description:
    "Verifies the 6-digit OTP for a phone. On success sets the same auth + CSRF cookies " +
    "as `/auth/login` and returns a user summary. Public, unauthenticated entry point.",
  summary: "Verify OTP and establish a session",
  tags: ["auth"],
  request: { body: { content: { "application/json": { schema: OtpVerifyRequest } } } },
  responses: {
    200: { description: "OTP verified; session established.", content: { "application/json": { schema: AuthSessionEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/me",
  description:
    "Returns the current authenticated user's profile, tenant, role keys, and flattened " +
    "permission grants (`module.action` + scope). This is the protected route the RBAC " +
    "guard + ScopeInterceptor are proven on end-to-end (docs/04 §2.4). Requires a valid " +
    "access-token cookie; no specific `module.action` permission beyond being authenticated.",
  summary: "Get current user profile + RBAC profile",
  tags: ["auth", "me"],
  security: [{ cookieAuth: [] }],
  responses: {
    200: { description: "Current user profile.", content: { "application/json": { schema: MeEnvelope } } },
    ...errorResponses,
  },
});

// ─────────────────────────────────────────────────────────────────────────
// CRM core — Phase 1, Wave 2 (docs/plans/phase-1.md task #2).
//
// Every mutation below requires `cookieAuth` + `csrfHeader` (same transport
// as auth). Permissions are documented per-path via the `x-required-permission`
// extension (module.action[, scope-note]) — informational only; actual
// enforcement is the `@RequirePermission` guard + ScopeInterceptor
// backend-builder wires per docs/03 §9 (CLAUDE.md §3.5: never trust the
// client for enforcement). `Idempotency-Key` is REQUIRED (docs/04 §2.14) on
// every unsafe (POST/PUT/PATCH/DELETE) CRM mutation below — declared as a
// required header parameter on each such path.
// ─────────────────────────────────────────────────────────────────────────

function requiredPermission(value: string) {
  return { "x-required-permission": value };
}

// ---- Students ----
const CreateStudentRequest = registry.register("CreateStudentRequest", CreateStudentRequestSchema);
const UpdateStudentRequest = registry.register("UpdateStudentRequest", UpdateStudentRequestSchema);
const RestoreStudentRequest = registry.register("RestoreStudentRequest", RestoreStudentRequestSchema);
const StudentSummary = registry.register("StudentSummary", StudentSummarySchema);
const StudentDetail = registry.register("StudentDetail", StudentDetailSchema);
const StudentDetailEnvelope = envelopeOf("StudentDetail", StudentDetail);
const StudentListEnvelope = paginatedEnvelopeOf("Student", StudentSummary);
const ResendCredentialsResponse = registry.register("ResendCredentialsResponse", ResendCredentialsResponseSchema);
const ResendCredentialsEnvelope = envelopeOf("ResendCredentials", ResendCredentialsResponse);

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/students",
  summary: "List/search the student directory",
  description: "Server-side search/filter/paginate by program, batch, branch, status (docs/03 §7.2).",
  tags: ["crm", "students"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("students.view (scope: all|branch|assigned per docs/03 §9)"),
  responses: { 200: { description: "Student directory page.", content: { "application/json": { schema: StudentListEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/students",
  summary: "Create a student",
  description:
    "Creates a `users` row (role `student`, status `invited`) and a 1:1 `student_profiles` row " +
    "in one transaction (see packages/types crm/students.schemas.ts file header). Writes one audit-log row.",
  tags: ["crm", "students"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("students.create"),
  request: {
    body: { content: { "application/json": { schema: CreateStudentRequest } } },
    headers: z.object({ "Idempotency-Key": z.string().min(1) }),
  },
  responses: { 201: { description: "Student created.", content: { "application/json": { schema: StudentDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/students/{id}",
  summary: "Get a student's full profile",
  tags: ["crm", "students"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("students.view"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: "Student detail.", content: { "application/json": { schema: StudentDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/crm/students/{id}",
  summary: "Update a student",
  tags: ["crm", "students"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("students.edit"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: UpdateStudentRequest } } },
    headers: z.object({ "Idempotency-Key": z.string().min(1) }),
  },
  responses: { 200: { description: "Student updated.", content: { "application/json": { schema: StudentDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/crm/students/{id}",
  summary: "Soft-delete a student",
  tags: ["crm", "students"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("students.delete"),
  request: { params: z.object({ id: z.string().uuid() }), headers: z.object({ "Idempotency-Key": z.string().min(1) }) },
  responses: { 200: { description: "Student soft-deleted.", content: { "application/json": { schema: StudentDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/students/{id}/restore",
  summary: "Restore a soft-deleted student",
  tags: ["crm", "students"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("students.edit"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: RestoreStudentRequest } } },
    headers: z.object({ "Idempotency-Key": z.string().min(1) }),
  },
  responses: { 200: { description: "Student restored.", content: { "application/json": { schema: StudentDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/students/{id}/resend-credentials",
  summary: "Reissue a student's LMS login credentials",
  description:
    "Gap-closing pass: staff-triggered reissue for a lost/bounced/compromised credential. Generates a " +
    "new temporary password, re-raises the must-change-password gate, and re-sends the welcome email, " +
    "works regardless of whether the account was ever provisioned before (unlike the automatic " +
    "on-enrollment provisioning, which only ever acts once on a never-provisioned account).",
  tags: ["crm", "students"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("students.edit"),
  request: { params: z.object({ id: z.string().uuid() }), headers: z.object({ "Idempotency-Key": z.string().min(1) }) },
  responses: {
    200: { description: "Credentials reissued; new temporary password emailed.", content: { "application/json": { schema: ResendCredentialsEnvelope } } },
    ...errorResponses,
  },
});

// ---- Faculty ----
const CreateFacultyRequest = registry.register("CreateFacultyRequest", CreateFacultyRequestSchema);
const UpdateFacultyRequest = registry.register("UpdateFacultyRequest", UpdateFacultyRequestSchema);
const RestoreFacultyRequest = registry.register("RestoreFacultyRequest", RestoreFacultyRequestSchema);
const FacultySummary = registry.register("FacultySummary", FacultySummarySchema);
const FacultyDetail = registry.register("FacultyDetail", FacultyDetailSchema);
const FacultyDetailEnvelope = envelopeOf("FacultyDetail", FacultyDetail);
const FacultyListEnvelope = paginatedEnvelopeOf("Faculty", FacultySummary);
const FacultyResetPasswordResponse = registry.register(
  "FacultyResetPasswordResponse",
  FacultyResetPasswordResponseSchema,
);
const FacultyResetPasswordEnvelope = envelopeOf("FacultyResetPassword", FacultyResetPasswordResponse);

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/faculty",
  summary: "List/search faculty",
  description: "Filter by branch/expertise (docs/03 §7.3).",
  tags: ["crm", "faculty"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("faculty.view (scope: all|branch|self per docs/03 §9)"),
  responses: { 200: { description: "Faculty list page.", content: { "application/json": { schema: FacultyListEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/faculty",
  summary: "Create a faculty member",
  description: "Creates a `users` row (role `faculty`) + a 1:1 `faculty_profiles` row in one transaction. Writes one audit-log row.",
  tags: ["crm", "faculty"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("faculty.create"),
  request: {
    body: { content: { "application/json": { schema: CreateFacultyRequest } } },
    headers: z.object({ "Idempotency-Key": z.string().min(1) }),
  },
  responses: { 201: { description: "Faculty created.", content: { "application/json": { schema: FacultyDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/faculty/{id}",
  summary: "Get a faculty profile (incl. assigned batches)",
  tags: ["crm", "faculty"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("faculty.view"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: "Faculty detail.", content: { "application/json": { schema: FacultyDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/crm/faculty/{id}",
  summary: "Update a faculty profile",
  tags: ["crm", "faculty"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("faculty.edit (self scope: faculty may edit own bio/expertise only)"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: UpdateFacultyRequest } } },
    headers: z.object({ "Idempotency-Key": z.string().min(1) }),
  },
  responses: { 200: { description: "Faculty updated.", content: { "application/json": { schema: FacultyDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/crm/faculty/{id}",
  summary: "Soft-delete a faculty member",
  tags: ["crm", "faculty"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("faculty.delete"),
  request: { params: z.object({ id: z.string().uuid() }), headers: z.object({ "Idempotency-Key": z.string().min(1) }) },
  responses: { 200: { description: "Faculty soft-deleted.", content: { "application/json": { schema: FacultyDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/faculty/{id}/restore",
  summary: "Restore a soft-deleted faculty member",
  tags: ["crm", "faculty"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("faculty.edit"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: RestoreFacultyRequest } } },
    headers: z.object({ "Idempotency-Key": z.string().min(1) }),
  },
  responses: { 200: { description: "Faculty restored.", content: { "application/json": { schema: FacultyDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/faculty/{id}/reset-password",
  summary: "Admin reset of a faculty member's CRM login password",
  description:
    "Staff-triggered reissue for a lost/forgotten/compromised credential. Generates a new temporary " +
    "password, re-raises the must-change-password gate, revokes all live sessions for the account, and " +
    "emails the faculty member their new temporary password + CRM login link. Mirrors the students " +
    "resend-credentials action, adapted for faculty (CRM login, not LMS).",
  tags: ["crm", "faculty"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("faculty.edit"),
  request: { params: z.object({ id: z.string().uuid() }), headers: z.object({ "Idempotency-Key": z.string().min(1) }) },
  responses: {
    200: {
      description: "Password reset; new temporary password emailed.",
      content: { "application/json": { schema: FacultyResetPasswordEnvelope } },
    },
    ...errorResponses,
  },
});

// ---- Courses (programs + curriculum) ----
const CreateProgramRequest = registry.register("CreateProgramRequest", CreateProgramRequestSchema);
const UpdateProgramRequest = registry.register("UpdateProgramRequest", UpdateProgramRequestSchema);
const PublishProgramRequest = registry.register("PublishProgramRequest", PublishProgramRequestSchema);
const ProgramSummary = registry.register("ProgramSummary", ProgramSummarySchema);
const ProgramDetail = registry.register("ProgramDetail", ProgramDetailSchema);
const ProgramDetailEnvelope = envelopeOf("ProgramDetail", ProgramDetail);
const ProgramListEnvelope = paginatedEnvelopeOf("Program", ProgramSummary);
const CurriculumTree = registry.register("CurriculumTree", CurriculumTreeSchema);
const CurriculumTreeEnvelope = envelopeOf("CurriculumTree", CurriculumTree);
const CreateModuleRequest = registry.register("CreateModuleRequest", CreateModuleRequestSchema);
const UpdateModuleRequest = registry.register("UpdateModuleRequest", UpdateModuleRequestSchema);
const ReorderModulesRequest = registry.register("ReorderModulesRequest", ReorderModulesRequestSchema);
const ModuleNode = registry.register("ModuleNode", ModuleNodeSchema);
const ModuleNodeEnvelope = envelopeOf("ModuleNode", ModuleNode);
const CreateLessonRequest = registry.register("CreateLessonRequest", CreateLessonRequestSchema);
const UpdateLessonRequest = registry.register("UpdateLessonRequest", UpdateLessonRequestSchema);
const ReorderLessonsRequest = registry.register("ReorderLessonsRequest", ReorderLessonsRequestSchema);
const LessonNode = registry.register("LessonNode", LessonNodeSchema);
const LessonNodeEnvelope = envelopeOf("LessonNode", LessonNode);

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/courses",
  summary: "List/search programs",
  tags: ["crm", "courses"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("courses.view"),
  responses: { 200: { description: "Program list page.", content: { "application/json": { schema: ProgramListEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/courses",
  summary: "Create a program",
  description: "Price/EMI fields editable here; coupons/pricing flows are P2 (docs/plans/phase-1.md scope note).",
  tags: ["crm", "courses"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("courses.create (author scope: ContentEditor/Faculty per docs/03 §9)"),
  request: {
    body: { content: { "application/json": { schema: CreateProgramRequest } } },
    headers: z.object({ "Idempotency-Key": z.string().min(1) }),
  },
  responses: { 201: { description: "Program created.", content: { "application/json": { schema: ProgramDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/courses/{id}",
  summary: "Get a program",
  tags: ["crm", "courses"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("courses.view"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: "Program detail.", content: { "application/json": { schema: ProgramDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/crm/courses/{id}",
  summary: "Update a program",
  tags: ["crm", "courses"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("courses.edit"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: UpdateProgramRequest } } },
    headers: z.object({ "Idempotency-Key": z.string().min(1) }),
  },
  responses: { 200: { description: "Program updated.", content: { "application/json": { schema: ProgramDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/courses/{id}/publish",
  summary: "Publish a program",
  tags: ["crm", "courses"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("courses.approve"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: PublishProgramRequest } } },
    headers: z.object({ "Idempotency-Key": z.string().min(1) }),
  },
  responses: { 200: { description: "Program published.", content: { "application/json": { schema: ProgramDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/courses/{id}/unpublish",
  summary: "Unpublish a program",
  tags: ["crm", "courses"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("courses.approve"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: PublishProgramRequest } } },
    headers: z.object({ "Idempotency-Key": z.string().min(1) }),
  },
  responses: { 200: { description: "Program unpublished.", content: { "application/json": { schema: ProgramDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/courses/{id}/curriculum",
  summary: "Get the program's modules→lessons curriculum tree",
  tags: ["crm", "courses"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("courses.view"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: "Curriculum tree.", content: { "application/json": { schema: CurriculumTreeEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/courses/{id}/modules",
  summary: "Create a module",
  tags: ["crm", "courses"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("courses.edit"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: CreateModuleRequest } } },
    headers: z.object({ "Idempotency-Key": z.string().min(1) }),
  },
  responses: { 201: { description: "Module created.", content: { "application/json": { schema: ModuleNodeEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/crm/courses/{id}/modules/{moduleId}",
  summary: "Update a module",
  tags: ["crm", "courses"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("courses.edit"),
  request: {
    params: z.object({ id: z.string().uuid(), moduleId: z.string().uuid() }),
    body: { content: { "application/json": { schema: UpdateModuleRequest } } },
    headers: z.object({ "Idempotency-Key": z.string().min(1) }),
  },
  responses: { 200: { description: "Module updated.", content: { "application/json": { schema: ModuleNodeEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/courses/{id}/modules/reorder",
  summary: "Reorder modules within a program",
  tags: ["crm", "courses"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("courses.edit"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: ReorderModulesRequest } } },
    headers: z.object({ "Idempotency-Key": z.string().min(1) }),
  },
  responses: { 200: { description: "Curriculum tree after reorder.", content: { "application/json": { schema: CurriculumTreeEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/courses/{id}/modules/{moduleId}/lessons",
  summary: "Create a lesson",
  tags: ["crm", "courses"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("courses.edit"),
  request: {
    params: z.object({ id: z.string().uuid(), moduleId: z.string().uuid() }),
    body: { content: { "application/json": { schema: CreateLessonRequest } } },
    headers: z.object({ "Idempotency-Key": z.string().min(1) }),
  },
  responses: { 201: { description: "Lesson created.", content: { "application/json": { schema: LessonNodeEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/crm/courses/{id}/modules/{moduleId}/lessons/{lessonId}",
  summary: "Update a lesson",
  tags: ["crm", "courses"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("courses.edit"),
  request: {
    params: z.object({ id: z.string().uuid(), moduleId: z.string().uuid(), lessonId: z.string().uuid() }),
    body: { content: { "application/json": { schema: UpdateLessonRequest } } },
    headers: z.object({ "Idempotency-Key": z.string().min(1) }),
  },
  responses: { 200: { description: "Lesson updated.", content: { "application/json": { schema: LessonNodeEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/courses/{id}/modules/{moduleId}/lessons/reorder",
  summary: "Reorder lessons within a module",
  tags: ["crm", "courses"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("courses.edit"),
  request: {
    params: z.object({ id: z.string().uuid(), moduleId: z.string().uuid() }),
    body: { content: { "application/json": { schema: ReorderLessonsRequest } } },
    headers: z.object({ "Idempotency-Key": z.string().min(1) }),
  },
  responses: { 200: { description: "Curriculum tree after reorder.", content: { "application/json": { schema: CurriculumTreeEnvelope } } }, ...errorResponses },
});

// ---- Batches ----
const CreateBatchRequest = registry.register("CreateBatchRequest", CreateBatchRequestSchema);
const UpdateBatchRequest = registry.register("UpdateBatchRequest", UpdateBatchRequestSchema);
const RestoreBatchRequest = registry.register("RestoreBatchRequest", RestoreBatchRequestSchema);
const AssignBatchFacultyRequest = registry.register("AssignBatchFacultyRequest", AssignBatchFacultyRequestSchema);
const BatchSummary = registry.register("BatchSummary", BatchSummarySchema);
const BatchDetail = registry.register("BatchDetail", BatchDetailSchema);
const BatchDetailEnvelope = envelopeOf("BatchDetail", BatchDetail);
const BatchListEnvelope = paginatedEnvelopeOf("Batch", BatchSummary);
const BatchRoster = registry.register("BatchRoster", BatchRosterSchema);
const BatchRosterEnvelope = envelopeOf("BatchRoster", BatchRoster);

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/batches",
  summary: "List/search batches",
  description: "Filter by program/branch/faculty/status (docs/03 §7.5).",
  tags: ["crm", "batches"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("batches.view (scope: all|branch|assigned per docs/03 §9)"),
  responses: { 200: { description: "Batch list page.", content: { "application/json": { schema: BatchListEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/batches",
  summary: "Create a batch",
  tags: ["crm", "batches"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("batches.create"),
  request: {
    body: { content: { "application/json": { schema: CreateBatchRequest } } },
    headers: z.object({ "Idempotency-Key": z.string().min(1) }),
  },
  responses: { 201: { description: "Batch created.", content: { "application/json": { schema: BatchDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/batches/{id}",
  summary: "Get a batch",
  tags: ["crm", "batches"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("batches.view"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: "Batch detail.", content: { "application/json": { schema: BatchDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/crm/batches/{id}",
  summary: "Update a batch",
  tags: ["crm", "batches"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("batches.edit"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: UpdateBatchRequest } } },
    headers: z.object({ "Idempotency-Key": z.string().min(1) }),
  },
  responses: { 200: { description: "Batch updated.", content: { "application/json": { schema: BatchDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/crm/batches/{id}",
  summary: "Soft-delete a batch",
  tags: ["crm", "batches"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("batches.delete"),
  request: { params: z.object({ id: z.string().uuid() }), headers: z.object({ "Idempotency-Key": z.string().min(1) }) },
  responses: { 200: { description: "Batch soft-deleted.", content: { "application/json": { schema: BatchDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/batches/{id}/restore",
  summary: "Restore a soft-deleted batch",
  tags: ["crm", "batches"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("batches.edit"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: RestoreBatchRequest } } },
    headers: z.object({ "Idempotency-Key": z.string().min(1) }),
  },
  responses: { 200: { description: "Batch restored.", content: { "application/json": { schema: BatchDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/batches/{id}/faculty",
  summary: "Assign (or unassign) a batch's faculty",
  tags: ["crm", "batches"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("batches.edit"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: AssignBatchFacultyRequest } } },
    headers: z.object({ "Idempotency-Key": z.string().min(1) }),
  },
  responses: { 200: { description: "Faculty assigned.", content: { "application/json": { schema: BatchDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/batches/{id}/roster",
  summary: "Get a batch's enrolled-student roster",
  tags: ["crm", "batches"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("batches.view"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: "Batch roster.", content: { "application/json": { schema: BatchRosterEnvelope } } }, ...errorResponses },
});

// ---- Enrollments ----
const CreateEnrollmentRequest = registry.register("CreateEnrollmentRequest", CreateEnrollmentRequestSchema);
const MoveEnrollmentRequest = registry.register("MoveEnrollmentRequest", MoveEnrollmentRequestSchema);
const WithdrawEnrollmentRequest = registry.register("WithdrawEnrollmentRequest", WithdrawEnrollmentRequestSchema);
const Enrollment = registry.register("Enrollment", EnrollmentSchema);
const EnrollmentEnvelope = envelopeOf("Enrollment", Enrollment);
const EnrollmentListEnvelope = paginatedEnvelopeOf("Enrollment", Enrollment);

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/enrollments",
  summary: "List enrollments",
  description: "Filter by student/batch/program/status. Roster/reporting join only, no commerce (P2).",
  tags: ["crm", "enrollments"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("enrollments.view"),
  responses: { 200: { description: "Enrollment list page.", content: { "application/json": { schema: EnrollmentListEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/enrollments",
  summary: "Enroll a student into a batch",
  description: "Unique (studentId, batchId). Duplicate enroll attempt returns 409.",
  tags: ["crm", "enrollments"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("enrollments.create"),
  request: {
    body: { content: { "application/json": { schema: CreateEnrollmentRequest } } },
    headers: z.object({ "Idempotency-Key": z.string().min(1) }),
  },
  responses: { 201: { description: "Enrollment created.", content: { "application/json": { schema: EnrollmentEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/enrollments/{id}/move",
  summary: "Move a student's enrollment to a different batch",
  tags: ["crm", "enrollments"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("enrollments.edit"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: MoveEnrollmentRequest } } },
    headers: z.object({ "Idempotency-Key": z.string().min(1) }),
  },
  responses: { 200: { description: "Enrollment moved.", content: { "application/json": { schema: EnrollmentEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/enrollments/{id}/withdraw",
  summary: "Withdraw a student's enrollment",
  description: "Sets status to `dropped`.",
  tags: ["crm", "enrollments"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("enrollments.edit"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: WithdrawEnrollmentRequest } } },
    headers: z.object({ "Idempotency-Key": z.string().min(1) }),
  },
  responses: { 200: { description: "Enrollment withdrawn.", content: { "application/json": { schema: EnrollmentEnvelope } } }, ...errorResponses },
});

// ---- Admin: roles + permission matrix ----
const CreateRoleRequest = registry.register("CreateRoleRequest", CreateRoleRequestSchema);
const UpdateRoleRequest = registry.register("UpdateRoleRequest", UpdateRoleRequestSchema);
const Role = registry.register("Role", RoleSchema);
const RoleEnvelope = envelopeOf("Role", Role);
const RoleListEnvelope = paginatedEnvelopeOf("Role", Role);
const PermissionMatrix = registry.register("PermissionMatrix", PermissionMatrixSchema);
const PermissionMatrixEnvelope = envelopeOf("PermissionMatrix", PermissionMatrix);
const RolePermissions = registry.register("RolePermissions", RolePermissionsSchema);
const RolePermissionsEnvelope = envelopeOf("RolePermissions", RolePermissions);
const UpdateRolePermissionsRequest = registry.register("UpdateRolePermissionsRequest", UpdateRolePermissionsRequestSchema);

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/admin/roles",
  summary: "List roles",
  tags: ["crm", "admin", "roles"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("roles.view"),
  responses: { 200: { description: "Role list page.", content: { "application/json": { schema: RoleListEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/admin/roles",
  summary: "Create a role",
  tags: ["crm", "admin", "roles"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("roles.create (Owner/Admin only per docs/03 §9)"),
  request: {
    body: { content: { "application/json": { schema: CreateRoleRequest } } },
    headers: z.object({ "Idempotency-Key": z.string().min(1) }),
  },
  responses: { 201: { description: "Role created.", content: { "application/json": { schema: RoleEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/crm/admin/roles/{id}",
  summary: "Rename a (non-system) role",
  tags: ["crm", "admin", "roles"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("roles.edit"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: UpdateRoleRequest } } },
    headers: z.object({ "Idempotency-Key": z.string().min(1) }),
  },
  responses: { 200: { description: "Role updated.", content: { "application/json": { schema: RoleEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/admin/permissions",
  summary: "Get the full permission catalog grouped by module",
  description: "Used to render the matrix editor's row/column headers (docs/03 §9).",
  tags: ["crm", "admin", "roles"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("roles.view"),
  responses: { 200: { description: "Permission catalog.", content: { "application/json": { schema: PermissionMatrixEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/admin/roles/{id}/permissions",
  summary: "Get one role's current permission grants",
  tags: ["crm", "admin", "roles"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("roles.view"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: "Role's current grants.", content: { "application/json": { schema: RolePermissionsEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "put",
  path: "/api/v1/crm/admin/roles/{id}/permissions",
  summary: "Replace a role's permission grants (matrix editor save)",
  description:
    "Full-replace semantics. See packages/types crm/admin.schemas.ts file header. Owner/Admin " +
    "only (docs/03 §9); server MUST reject grants broader than the editor's own resolved scope " +
    "for that module (privilege-escalation guard, security-reviewer task #9). Writes one " +
    "audit-log row with the full before/after grant list.",
  tags: ["crm", "admin", "roles"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("roles.edit (Owner/Admin only)"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: UpdateRolePermissionsRequest } } },
    headers: z.object({ "Idempotency-Key": z.string().min(1) }),
  },
  responses: { 200: { description: "Grants replaced.", content: { "application/json": { schema: RolePermissionsEnvelope } } }, ...errorResponses },
});

// ---- Admin: branches ----
const CreateBranchRequest = registry.register("CreateBranchRequest", CreateBranchRequestSchema);
const UpdateBranchRequest = registry.register("UpdateBranchRequest", UpdateBranchRequestSchema);
const BranchDetail = registry.register("BranchDetail", BranchDetailSchema);
const BranchDetailEnvelope = envelopeOf("BranchDetail", BranchDetail);
const BranchListEnvelope = paginatedEnvelopeOf("Branch", BranchDetail);

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/admin/branches",
  summary: "List branches",
  tags: ["crm", "admin", "branches"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("branches.view"),
  responses: { 200: { description: "Branch list page.", content: { "application/json": { schema: BranchListEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/admin/branches",
  summary: "Create a branch",
  tags: ["crm", "admin", "branches"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("branches.create (Owner/Admin only per docs/03 §9)"),
  request: {
    body: { content: { "application/json": { schema: CreateBranchRequest } } },
    headers: z.object({ "Idempotency-Key": z.string().min(1) }),
  },
  responses: { 201: { description: "Branch created.", content: { "application/json": { schema: BranchDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/crm/admin/branches/{id}",
  summary: "Update a branch",
  tags: ["crm", "admin", "branches"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("branches.edit (Owner/Admin only)"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: UpdateBranchRequest } } },
    headers: z.object({ "Idempotency-Key": z.string().min(1) }),
  },
  responses: { 200: { description: "Branch updated.", content: { "application/json": { schema: BranchDetailEnvelope } } }, ...errorResponses },
});

// ---- Audit logs (read-only) ----
const AuditLogEntry = registry.register("AuditLogEntry", AuditLogEntrySchema);
const AuditLogListEnvelope = paginatedEnvelopeOf("AuditLog", AuditLogEntry);

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/audit-logs",
  summary: "List audit log entries (read-only)",
  description: "Filter by entity/entityId/actorId/action/date-range + paginate (docs/03 §7.16, §20(b)). No write API.",
  tags: ["crm", "admin", "audit"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("audit.view (Owner=view-all, Admin=view per docs/03 §9)"),
  responses: { 200: { description: "Audit log page.", content: { "application/json": { schema: AuditLogListEnvelope } } }, ...errorResponses },
});

// ─────────────────────────────────────────────────────────────────────────
// Phase 2, Wave 2 — Commerce + Leads API contracts.
//
// Idempotency-Key header: required on ALL commerce mutations (orders, payments,
// refunds, coupons create/update) and leads mutations (create/update/stage/
// owner/convert) and bookings mutations. Documented per-path below.
//
// Security model:
//   - Authenticated routes: cookieAuth + csrfHeader on unsafe mutations.
//   - Webhook endpoint: UNAUTHENTICATED — Razorpay signature (HMAC via
//     X-Razorpay-Signature header) is the sole authentication mechanism. Do NOT
//     add cookieAuth to this path; the NestJS guard verifies the raw-body HMAC.
//   - Public booking intake: UNAUTHENTICATED — open intake, rate-limited per IP.
//     No cookie/CSRF required. The backend resolves tenant from default context.
// ─────────────────────────────────────────────────────────────────────────

// ── Idempotency-Key header parameter (reused inline on each mutation path) ──
const idempotencyKeyHeader = z.object({ "Idempotency-Key": z.string().uuid().describe(
  "Idempotency key for this mutation. Generate one via crypto.randomUUID(). " +
  "The backend stores this and returns a cached response on replay, preventing " +
  "double-mutations (docs/04 §2.6). Required on all unsafe commerce + leads mutations.",
) });

// ─────────────────────────────────────────────────────────────────────────
// Commerce — Orders
// ─────────────────────────────────────────────────────────────────────────

const CreateOrderRequest = registry.register("CreateOrderRequest", CreateOrderRequestSchema);
const OrderSummary = registry.register("OrderSummary", OrderSummarySchema);
const OrderDetail = registry.register("OrderDetail", OrderDetailSchema);
const OrderDetailEnvelope = envelopeOf("OrderDetail", OrderDetail);
const OrderListEnvelope = paginatedEnvelopeOf("Order", OrderSummary);

registry.registerPath({
  method: "get",
  path: "/api/v1/commerce/orders",
  summary: "List/filter the order ledger",
  description:
    "Server-side filter/paginate orders by status, student, program, date range. " +
    "Finance role sees all; BranchManager sees branch-scoped orders (docs/03 §9).",
  tags: ["commerce", "orders"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("payments.view (scope: all|branch per docs/03 §9, Finance=all, BranchMgr=branch)"),
  responses: {
    200: { description: "Order ledger page.", content: { "application/json": { schema: OrderListEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/commerce/orders",
  summary: "Create an order for a program",
  description:
    "Creates an order for a program. Server computes amount_paise from program.pricePaise minus " +
    "coupon discount (server is source of truth, client's expectedAmountPaise is informational). " +
    "The Idempotency-Key header maps to orders.idempotency_key (unique), replayed requests with " +
    "the same key return the cached order without creating a duplicate (docs/04 §2.6).",
  tags: ["commerce", "orders"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("payments.create (Finance + Admin/Owner per docs/03 §9)"),
  request: {
    body: { content: { "application/json": { schema: CreateOrderRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    201: { description: "Order created.", content: { "application/json": { schema: OrderDetailEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/commerce/orders/{id}",
  summary: "Get order detail (with payment + invoice + enrollment linkage)",
  tags: ["commerce", "orders"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("payments.view"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Order detail.", content: { "application/json": { schema: OrderDetailEnvelope } } },
    ...errorResponses,
  },
});

// ── Create Razorpay order (open checkout) ──
const CreateRazorpayOrderResponse = registry.register("CreateRazorpayOrderResponse", CreateRazorpayOrderResponseSchema);
const CreateRazorpayOrderEnvelope = envelopeOf("CreateRazorpayOrder", CreateRazorpayOrderResponse);

registry.registerPath({
  method: "post",
  path: "/api/v1/commerce/orders/{id}/pay",
  summary: "Initiate Razorpay checkout for an order",
  description:
    "Creates a Razorpay order via the PaymentProvider and returns the fields needed " +
    "to open Razorpay's checkout JS SDK (razorpayOrderId, keyId [PUBLIC], amountPaise, currency). " +
    "The client opens checkout with these fields, then POSTs the checkout handler callback " +
    "fields to /commerce/payments/verify. " +
    "Idempotency-Key header required (prevents duplicate Razorpay order creation on retry).",
  tags: ["commerce", "orders", "payments"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("payments.create"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    headers: idempotencyKeyHeader,
  },
  responses: {
    200: { description: "Razorpay checkout fields.", content: { "application/json": { schema: CreateRazorpayOrderEnvelope } } },
    ...errorResponses,
  },
});

// ─────────────────────────────────────────────────────────────────────────
// Commerce — Payments (ledger + verify + webhook + manual)
// ─────────────────────────────────────────────────────────────────────────

const VerifyPaymentRequest = registry.register("VerifyPaymentRequest", VerifyPaymentRequestSchema);
const ManualPaymentRequest = registry.register("ManualPaymentRequest", ManualPaymentRequestSchema);
const PaymentSummary = registry.register("PaymentSummary", PaymentSummarySchema);
const PaymentDetail = registry.register("PaymentDetail", PaymentDetailSchema);
const PaymentDetailEnvelope = envelopeOf("PaymentDetail", PaymentDetail);
const PaymentListEnvelope = paginatedEnvelopeOf("Payment", PaymentSummary);
const LedgerReconciliation = registry.register("LedgerReconciliation", LedgerReconciliationSchema);
const LedgerReconciliationEnvelope = envelopeOf("LedgerReconciliation", LedgerReconciliation);

registry.registerPath({
  method: "get",
  path: "/api/v1/commerce/payments",
  summary: "List/filter the payments ledger",
  description:
    "The authoritative payment ledger (docs/03 §20 reconciliation source). Filter by " +
    "order, status, provider, date range. Finance = all; BranchMgr = branch-scoped.",
  tags: ["commerce", "payments"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("payments.view (Finance=all, BranchMgr=branch per docs/03 §9)"),
  responses: {
    200: { description: "Payment ledger page.", content: { "application/json": { schema: PaymentListEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/commerce/payments/{id}",
  summary: "Get a payment record detail",
  tags: ["commerce", "payments"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("payments.view"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Payment detail.", content: { "application/json": { schema: PaymentDetailEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/commerce/payments/verify",
  summary: "Verify Razorpay payment signature and capture payment",
  description:
    "Receives the three callback fields from Razorpay's checkout handler " +
    "(razorpay_order_id, razorpay_payment_id, razorpay_signature). " +
    "The server verifies the HMAC-SHA256 signature with RAZORPAY_KEY_SECRET. " +
    "On success: marks payment `captured`, order `paid`, creates enrollment atomically " +
    "($transaction). Idempotent by provider_payment_id (unique), replaying does NOT " +
    "double-enroll or double-pay (phase-2.md §Risks #1). " +
    "Idempotency-Key header required.",
  tags: ["commerce", "payments"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("payments.create (student verifying own payment may also be permitted, backend decides scope)"),
  request: {
    body: { content: { "application/json": { schema: VerifyPaymentRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    200: { description: "Payment captured; enrollment created.", content: { "application/json": { schema: PaymentDetailEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/commerce/payments/webhook",
  summary: "Razorpay webhook receiver (UNAUTHENTICATED, signature-verified)",
  description:
    "UNAUTHENTICATED endpoint. Razorpay calls this from their servers. " +
    "Authentication is the HMAC-SHA256 signature in the X-Razorpay-Signature header, " +
    "verified against RAZORPAY_WEBHOOK_SECRET before any business logic runs. " +
    "The endpoint MUST receive the raw request body (bytes) for signature verification " +
    "JSON parsing happens AFTER signature check. " +
    "Replay safety: idempotent by provider_payment_id (unique), a duplicate webhook " +
    "is a no-op. Unknown event types are silently ignored (safe-by-default). " +
    "NOTE: No cookieAuth or csrfHeader, these would break Razorpay's server-to-server calls.",
  tags: ["commerce", "payments"],
  // No security — this is intentionally unauthenticated (Razorpay server-to-server)
  request: {
    body: {
      description: "Razorpay webhook event payload, passthrough shape, signature-verified.",
      content: { "application/json": { schema: registry.register("RazorpayWebhook", RazorpayWebhookSchema) } },
    },
  },
  responses: {
    200: { description: "Webhook received and processed (or safely ignored).", content: { "application/json": { schema: envelopeOf("WebhookAck", z.object({ received: z.boolean() })) } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/commerce/payments/manual",
  summary: "Record an offline/manual payment",
  description:
    "Offline / cash / NEFT / cheque payment entry by Finance staff. Creates a payment row " +
    "with is_manual=true, signature_verified=false. The order must be in `created` status. " +
    "Marks order as paid and creates enrollment atomically. " +
    "Idempotency-Key header required.",
  tags: ["commerce", "payments"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("payments.create (Finance + Admin/Owner only per docs/03 §9)"),
  request: {
    body: { content: { "application/json": { schema: ManualPaymentRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    201: { description: "Manual payment recorded.", content: { "application/json": { schema: PaymentDetailEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/commerce/payments/reconciliation",
  summary: "Ledger reconciliation summary for a date range",
  description:
    "Returns sum(captured payments) − sum(processed refunds) vs order paid total for the " +
    "given date range. The `reconcilesOk` flag indicates whether the ledger is balanced " +
    "(docs/03 §20 invariant). Finance + Admin/Owner only.",
  tags: ["commerce", "payments"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("payments.view (Finance + Admin/Owner only)"),
  responses: {
    200: { description: "Reconciliation summary.", content: { "application/json": { schema: LedgerReconciliationEnvelope } } },
    ...errorResponses,
  },
});

// ─────────────────────────────────────────────────────────────────────────
// Commerce — Invoices
// ─────────────────────────────────────────────────────────────────────────

const InvoiceSummary = registry.register("InvoiceSummary", InvoiceSummarySchema);
const InvoiceDetail = registry.register("InvoiceDetail", InvoiceDetailSchema);
const InvoiceDetailEnvelope = envelopeOf("InvoiceDetail", InvoiceDetail);
const InvoiceListEnvelope = paginatedEnvelopeOf("Invoice", InvoiceSummary);
const InvoiceDownloadResponse = registry.register("InvoiceDownloadResponse", InvoiceDownloadResponseSchema);
const InvoiceDownloadEnvelope = envelopeOf("InvoiceDownload", InvoiceDownloadResponse);

registry.registerPath({
  method: "get",
  path: "/api/v1/commerce/invoices",
  summary: "List invoices",
  description: "Filter by order, student, status, date. Finance = all; BranchMgr = branch-scoped.",
  tags: ["commerce", "invoices"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("payments.view (Finance + Admin/Owner per docs/03 §9)"),
  responses: {
    200: { description: "Invoice list page.", content: { "application/json": { schema: InvoiceListEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/commerce/invoices/{id}",
  summary: "Get invoice detail",
  tags: ["commerce", "invoices"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("payments.view"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Invoice detail.", content: { "application/json": { schema: InvoiceDetailEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/commerce/invoices/{id}/download",
  summary: "Get a pre-signed download URL for an invoice PDF",
  description:
    "Returns a short-lived pre-signed URL for the invoice PDF from object storage. " +
    "In P2 the StorageProvider may be a stub, `stubMode: true` in the response indicates " +
    "the PDF is not yet available (queue worker has not generated it, or storage is not configured).",
  tags: ["commerce", "invoices"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("payments.view"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Download URL or stub-mode response.", content: { "application/json": { schema: InvoiceDownloadEnvelope } } },
    ...errorResponses,
  },
});

// ─────────────────────────────────────────────────────────────────────────
// Commerce — Refunds
// ─────────────────────────────────────────────────────────────────────────

const RequestRefundRequest = registry.register("RequestRefundRequest", RequestRefundRequestSchema);
const ApproveRefundRequest = registry.register("ApproveRefundRequest", ApproveRefundRequestSchema);
const RejectRefundRequest = registry.register("RejectRefundRequest", RejectRefundRequestSchema);
const RefundSummary = registry.register("RefundSummary", RefundSummarySchema);
const RefundDetail = registry.register("RefundDetail", RefundDetailSchema);
const RefundDetailEnvelope = envelopeOf("RefundDetail", RefundDetail);
const RefundListEnvelope = paginatedEnvelopeOf("Refund", RefundSummary);

registry.registerPath({
  method: "get",
  path: "/api/v1/commerce/refunds",
  summary: "List refund requests",
  description: "Filter by payment, order, student, status, date. Finance = all.",
  tags: ["commerce", "refunds"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("payments.view (Finance + Admin/Owner per docs/03 §9)"),
  responses: {
    200: { description: "Refund list page.", content: { "application/json": { schema: RefundListEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/commerce/refunds",
  summary: "Request a refund for a captured payment",
  description:
    "Creates a refund row in `requested` status. Amount must be > 0 and ≤ original captured " +
    "amount (validated server-side). Triggers an approval workflow, refund is NOT immediately " +
    "processed via the provider. Idempotency-Key header required.",
  tags: ["commerce", "refunds"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("payments.create (Finance + Admin/Owner per docs/03 §9)"),
  request: {
    body: { content: { "application/json": { schema: RequestRefundRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    201: { description: "Refund requested.", content: { "application/json": { schema: RefundDetailEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/commerce/refunds/{id}",
  summary: "Get refund detail",
  tags: ["commerce", "refunds"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("payments.view"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Refund detail.", content: { "application/json": { schema: RefundDetailEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/commerce/refunds/{id}/approve",
  summary: "Approve a refund and trigger provider processing",
  description:
    "Finance + Owner/Admin only (`refunds.approve`). Moves status to `approved` and triggers " +
    "the PaymentProvider refund call. Records `approved_by` from the authenticated user. " +
    "The backend MUST prevent self-approval escalation (security-reviewer task #10). " +
    "Idempotency-Key header required.",
  tags: ["commerce", "refunds"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("refunds.approve (Finance + Owner/Admin ONLY, no self-approval escalation)"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: ApproveRefundRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    200: { description: "Refund approved and processing initiated.", content: { "application/json": { schema: RefundDetailEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/commerce/refunds/{id}/reject",
  summary: "Reject a refund request",
  description:
    "Finance + Owner/Admin only (`refunds.approve`). Moves status to `rejected` (terminal, " +
    "no provider call). Idempotency-Key header required.",
  tags: ["commerce", "refunds"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("refunds.approve (Finance + Owner/Admin ONLY)"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: RejectRefundRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    200: { description: "Refund rejected.", content: { "application/json": { schema: RefundDetailEnvelope } } },
    ...errorResponses,
  },
});

// ─────────────────────────────────────────────────────────────────────────
// Commerce — Coupons
// ─────────────────────────────────────────────────────────────────────────

const CreateCouponRequest = registry.register("CreateCouponRequest", CreateCouponRequestSchema);
const UpdateCouponRequest = registry.register("UpdateCouponRequest", UpdateCouponRequestSchema);
const ValidateCouponRequest = registry.register("ValidateCouponRequest", ValidateCouponRequestSchema);
const ValidateCouponResponse = registry.register("ValidateCouponResponse", ValidateCouponResponseSchema);
const ValidateCouponEnvelope = envelopeOf("ValidateCoupon", ValidateCouponResponse);
const CouponSummary = registry.register("CouponSummary", CouponSummarySchema);
const CouponDetail = registry.register("CouponDetail", CouponDetailSchema);
const CouponDetailEnvelope = envelopeOf("CouponDetail", CouponDetail);
const CouponListEnvelope = paginatedEnvelopeOf("Coupon", CouponSummary);

registry.registerPath({
  method: "get",
  path: "/api/v1/commerce/coupons",
  summary: "List coupons",
  description: "Filter by status, type, code prefix. Marketing = create/edit; Finance/Admin/Owner = view all.",
  tags: ["commerce", "coupons"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("coupons.view (Marketing/Finance/Admin/Owner per docs/03 §9 + phase-2.md §Risks #8)"),
  responses: {
    200: { description: "Coupon list page.", content: { "application/json": { schema: CouponListEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/commerce/coupons",
  summary: "Create a coupon",
  description:
    "Marketing role creates coupons (phase-2.md §Risks #8). `code` must be unique per tenant " +
    "(409 on duplicate). `value` for pct type must be 1–100; for flat type: integer paise. " +
    "The `used` counter is NOT set by the client. It starts at 0 and is incremented atomically " +
    "at order-creation time. Idempotency-Key header required.",
  tags: ["commerce", "coupons"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("coupons.create (Marketing + Admin/Owner per docs/03 §9)"),
  request: {
    body: { content: { "application/json": { schema: CreateCouponRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    201: { description: "Coupon created.", content: { "application/json": { schema: CouponDetailEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/commerce/coupons/{id}",
  summary: "Get coupon detail",
  tags: ["commerce", "coupons"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("coupons.view"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Coupon detail.", content: { "application/json": { schema: CouponDetailEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/commerce/coupons/{id}",
  summary: "Update a coupon (maxUses, validity window, programScope, status)",
  description:
    "Partial update. `code` and `type` cannot be changed after creation. " +
    "To disable, set status=inactive. Idempotency-Key header required.",
  tags: ["commerce", "coupons"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("coupons.edit (Marketing + Admin/Owner)"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: UpdateCouponRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    200: { description: "Coupon updated.", content: { "application/json": { schema: CouponDetailEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/commerce/coupons/validate",
  summary: "Preview coupon discount for a program (non-mutating)",
  description:
    "Safe, non-mutating preview: returns the discount that would apply for the given code + programId. " +
    "Does NOT change the `used` counter. Use this for real-time discount display in the order UI " +
    "before the user submits. The actual application happens server-side at order-create time. " +
    "Requires authentication (not a public endpoint, prevents coupon enumeration).",
  tags: ["commerce", "coupons"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("coupons.view (any authenticated user. No scope restriction on preview)"),
  request: {
    body: { content: { "application/json": { schema: ValidateCouponRequest } } },
  },
  responses: {
    200: { description: "Coupon validation result + discount preview.", content: { "application/json": { schema: ValidateCouponEnvelope } } },
    ...errorResponses,
  },
});

// ─────────────────────────────────────────────────────────────────────────
// CRM Leads — pipeline
// ─────────────────────────────────────────────────────────────────────────

const CreateLeadRequest = registry.register("CreateLeadRequest", CreateLeadRequestSchema);
const UpdateLeadRequest = registry.register("UpdateLeadRequest", UpdateLeadRequestSchema);
const MoveLeadStageRequest = registry.register("MoveLeadStageRequest", MoveLeadStageRequestSchema);
const AssignLeadOwnerRequest = registry.register("AssignLeadOwnerRequest", AssignLeadOwnerRequestSchema);
const ConvertLeadRequest = registry.register("ConvertLeadRequest", ConvertLeadRequestSchema);
const LeadSummary = registry.register("LeadSummary", LeadSummarySchema);
const LeadDetail = registry.register("LeadDetail", LeadDetailSchema);
const ConvertLeadResponse = registry.register("ConvertLeadResponse", ConvertLeadResponseSchema);
const LeadDetailEnvelope = envelopeOf("LeadDetail", LeadDetail);
const LeadListEnvelope = paginatedEnvelopeOf("Lead", LeadSummary);
const ConvertLeadEnvelope = envelopeOf("ConvertLead", ConvertLeadResponse);

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/leads",
  summary: "List/filter the lead pipeline",
  description:
    "Filter by stage, owner, source, branch, SLA overdue + full-text search. " +
    "Counsellor: `own`/`assigned` scope (owner_id = current user OR same branch, " +
    "this is the P1-deferred scope now REAL via leads.owner_id, phase-2.md §Risks #5). " +
    "Marketing: all. BranchManager: branch. Owner/Admin: all.",
  tags: ["crm", "leads"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("leads.view (scope: own|assigned|branch|all per docs/03 §9)"),
  responses: {
    200: { description: "Lead pipeline page.", content: { "application/json": { schema: LeadListEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/leads",
  summary: "Create a lead",
  description:
    "Creates a new lead. `phone` must be unique per tenant (409 on duplicate). " +
    "Stage defaults to `new`. Idempotency-Key header required.",
  tags: ["crm", "leads"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("leads.create (Counsellor/Marketing/BranchMgr/Admin/Owner per docs/03 §9)"),
  request: {
    body: { content: { "application/json": { schema: CreateLeadRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    201: { description: "Lead created.", content: { "application/json": { schema: LeadDetailEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/leads/{id}",
  summary: "Get lead detail",
  tags: ["crm", "leads"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("leads.view (scope enforced server-side. Counsellor cannot read out-of-scope leads)"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Lead detail.", content: { "application/json": { schema: LeadDetailEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/crm/leads/{id}",
  summary: "Update a lead's fields",
  description: "Partial update. Stage and owner changes use their dedicated sub-endpoints. Idempotency-Key required.",
  tags: ["crm", "leads"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("leads.edit (scope: own|assigned per docs/03 §9)"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: UpdateLeadRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    200: { description: "Lead updated.", content: { "application/json": { schema: LeadDetailEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/crm/leads/{id}",
  summary: "Soft-delete a lead",
  tags: ["crm", "leads"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("leads.delete (Admin/Owner only per docs/03 §9)"),
  request: { params: z.object({ id: z.string().uuid() }), headers: idempotencyKeyHeader },
  responses: {
    200: { description: "Lead soft-deleted.", content: { "application/json": { schema: LeadDetailEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/crm/leads/{id}/stage",
  summary: "Move a lead to a new pipeline stage (kanban transition)",
  description:
    "Stage transition, audited with before/after values. Backend owns the valid transition " +
    "state machine. Idempotency-Key required.",
  tags: ["crm", "leads"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("leads.edit (scope: own|assigned. Counsellor can move own/assigned leads)"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: MoveLeadStageRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    200: { description: "Stage updated.", content: { "application/json": { schema: LeadDetailEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/crm/leads/{id}/owner",
  summary: "Assign or unassign a lead owner",
  description:
    "Sets `leads.owner_id`. The previous owner is recorded in the audit log. " +
    "Counsellors can re-assign their own leads; Marketing/Admin can assign any lead. " +
    "Idempotency-Key required.",
  tags: ["crm", "leads"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("leads.edit (own|assigned scope. Reassign scope depends on role)"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: AssignLeadOwnerRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    200: { description: "Owner assigned.", content: { "application/json": { schema: LeadDetailEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/leads/{id}/convert",
  summary: "Convert a won lead into a student (+ optional order/enrollment)",
  description:
    "Atomic $transaction (phase-2.md §Risks conversion + §Success criteria 8): " +
    "(1) Create student_profile from studentFields. " +
    "(2) Set leads.converted_student_id + stage=won. " +
    "(3) If programId+batchId provided: create order (source=conversion) + enrollment atomically. " +
    "Idempotent by idempotency key. Replaying does NOT create a second student/order. " +
    "Counsellor own/assigned + Admin/Owner have `leads.convert` permission; " +
    "Marketing has it via full access; Finance does NOT unless granted explicitly.",
  tags: ["crm", "leads"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("leads.convert (Counsellor own/assigned + Marketing/Admin/Owner per docs/03 §9)"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: ConvertLeadRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    201: { description: "Lead converted to student.", content: { "application/json": { schema: ConvertLeadEnvelope } } },
    ...errorResponses,
  },
});

// ─────────────────────────────────────────────────────────────────────────
// CRM Leads — Activities
// ─────────────────────────────────────────────────────────────────────────

const CreateActivityRequest = registry.register("CreateActivityRequest", CreateActivityRequestSchema);
const CompleteTaskRequest = registry.register("CompleteTaskRequest", CompleteTaskRequestSchema);
const ActivityDetail = registry.register("ActivityDetail", ActivityDetailSchema);
const ActivityDetailEnvelope = envelopeOf("ActivityDetail", ActivityDetail);
const ActivityListEnvelope = paginatedEnvelopeOf("Activity", ActivityDetail);

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/activities",
  summary: "List/filter activities (timeline + tasks/SLA view)",
  description:
    "Filter by leadId, studentId, userId, type, due date (for SLA/tasks view, docs/03 §7.12). " +
    "Use `pendingTasks=true` for counsellor 'today's tasks / due follow-ups' view. " +
    "Counsellor sees only own/assigned lead activities.",
  tags: ["crm", "activities"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("leads.view (activities inherit parent lead scope)"),
  responses: {
    200: { description: "Activity list page.", content: { "application/json": { schema: ActivityListEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/activities",
  summary: "Log an activity against a lead or student",
  description:
    "LOGGED RECORD ONLY in P2. Whatsapp/email types are logged but NOT sent. " +
    "Delivery via MailProvider/WhatsAppProvider is P6. " +
    "Exactly one of leadId or studentId must be provided. " +
    "The authenticated user is recorded as the actor. Idempotency-Key required.",
  tags: ["crm", "activities"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("leads.create (Counsellor own/assigned + Marketing/Admin/Owner)"),
  request: {
    body: { content: { "application/json": { schema: CreateActivityRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    201: { description: "Activity logged.", content: { "application/json": { schema: ActivityDetailEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/activities/{id}/complete",
  summary: "Mark a task activity as done",
  description: "Sets done_at on a task-type activity. Returns 422 for non-task types. Idempotency-Key required.",
  tags: ["crm", "activities"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("leads.edit (scope: own/assigned)"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: CompleteTaskRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    200: { description: "Task marked complete.", content: { "application/json": { schema: ActivityDetailEnvelope } } },
    ...errorResponses,
  },
});

// ─────────────────────────────────────────────────────────────────────────
// CRM Leads — Bookings (authenticated CRM management)
// ─────────────────────────────────────────────────────────────────────────

const CreateBookingRequest = registry.register("CreateBookingRequest", CreateBookingRequestSchema);
const UpdateBookingRequest = registry.register("UpdateBookingRequest", UpdateBookingRequestSchema);
const MoveBookingStatusRequest = registry.register("MoveBookingStatusRequest", MoveBookingStatusRequestSchema);
const BookingSummary = registry.register("BookingSummary", BookingSummarySchema);
const BookingDetail = registry.register("BookingDetail", BookingDetailSchema);
const BookingDetailEnvelope = envelopeOf("BookingDetail", BookingDetail);
const BookingListEnvelope = paginatedEnvelopeOf("Booking", BookingSummary);

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/bookings",
  summary: "List/filter bookings",
  description: "Filter by leadId, programId, status, slot time range, source. Scope per docs/03 §9.",
  tags: ["crm", "bookings"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("leads.view (bookings inherit lead scope)"),
  responses: {
    200: { description: "Booking list page.", content: { "application/json": { schema: BookingListEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/bookings",
  summary: "Create a booking (CRM / staff)",
  description: "Creates a booking in `requested` status. Idempotency-Key required.",
  tags: ["crm", "bookings"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("leads.create (Counsellor own/assigned + Marketing/Admin/Owner)"),
  request: {
    body: { content: { "application/json": { schema: CreateBookingRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    201: { description: "Booking created.", content: { "application/json": { schema: BookingDetailEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/bookings/{id}",
  summary: "Get booking detail",
  tags: ["crm", "bookings"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("leads.view"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Booking detail.", content: { "application/json": { schema: BookingDetailEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/crm/bookings/{id}",
  summary: "Update a booking (slot time, program, notes)",
  description: "Partial update. Status transitions use the /status sub-endpoint. Idempotency-Key required.",
  tags: ["crm", "bookings"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("leads.edit (scope: own/assigned)"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: UpdateBookingRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    200: { description: "Booking updated.", content: { "application/json": { schema: BookingDetailEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/crm/bookings/{id}/status",
  summary: "Move booking status (confirm / complete / cancel / no-show)",
  description:
    "State machine: requested→confirmed|cancelled; confirmed→completed|cancelled|no_show. " +
    "Invalid transitions return 422. Idempotency-Key required.",
  tags: ["crm", "bookings"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("leads.edit (scope: own/assigned)"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: MoveBookingStatusRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    200: { description: "Booking status updated.", content: { "application/json": { schema: BookingDetailEnvelope } } },
    ...errorResponses,
  },
});

// ─────────────────────────────────────────────────────────────────────────
// Public booking intake stub (UNAUTHENTICATED)
// ─────────────────────────────────────────────────────────────────────────

const CreatePublicBookingRequest = registry.register("CreatePublicBookingRequest", CreatePublicBookingRequestSchema);
const PublicBookingResponse = registry.register("PublicBookingResponse", PublicBookingResponseSchema);
const PublicBookingEnvelope = envelopeOf("PublicBooking", PublicBookingResponse);

registry.registerPath({
  method: "post",
  path: "/api/v1/public/bookings",
  summary: "Public book-a-slot intake (UNAUTHENTICATED stub, P2)",
  description:
    "UNAUTHENTICATED open intake for the book-a-slot funnel. Rate-limited per IP. " +
    "Atomically upserts a lead (by phone for the default tenant) and creates a booking " +
    "in `requested` status. No cookie/CSRF required. This endpoint is open to the public. " +
    "NOTE: This is the minimal P2 stub; the full marketing-site book-slot funnel is P5. " +
    "No Idempotency-Key required (not a money mutation; backend deduplicates by phone+slotAt).",
  tags: ["public", "bookings"],
  // No security — intentionally unauthenticated public intake
  request: {
    body: { content: { "application/json": { schema: CreatePublicBookingRequest } } },
  },
  responses: {
    201: { description: "Booking request received.", content: { "application/json": { schema: PublicBookingEnvelope } } },
    // 429 (rate limited per IP) is already included in errorResponses spread below.
    ...errorResponses,
  },
});

// ─────────────────────────────────────────────────────────────────────────
// Phase 3, Wave 2 — LMS core student-facing API contracts.
//
// ALL endpoints here are student-facing (scope: own). The student id is
// always resolved from the session — the client never sends a studentId.
//
// Security model:
//   - cookieAuth on every read (GET).
//   - cookieAuth + csrfHeader on every unsafe mutation (PUT/POST).
//   - Idempotency-Key REQUIRED on POST /me/lessons/:id/complete (docs/04 §2.14).
//   - Progress PUT does NOT require Idempotency-Key (position pings are
//     naturally idempotent by upsert semantics — last write wins).
//
// Enrollment gate:
//   - All content endpoints (curriculum, lesson detail, stream-url, progress,
//     attendance) require an active enrollment in the lesson's/program's
//     program. Non-enrolled → 403. `is_preview=true` lessons are the only
//     exception: they are viewable (lesson detail + stream-url) without
//     enrollment.
//
// Stream-url special contract:
//   - GET /lessons/:id/stream-url is enrollment-gated + RBAC (`videos.stream`,
//     scope:own). Returns SHORT-TTL signed HLS URL + expiry + watermark.
//   - NO raw URL, NO provider_asset_id, NO long-lived token ever in the response.
//   - Provider fail-closed: if VideoProvider unconfigured → 503 (never a raw URL).
//   - Every mint writes an audit-log row.
//   - Frontend MUST re-call on expiry, MUST NOT cache the URL.
//
// Permission summary (all scope: own — student's own enrollments only):
//   GET /me/dashboard          → courses.view
//   GET /me/enrollments        → courses.view
//   GET /me/enrollments/:id    → courses.view
//   GET /me/enrollments/:id/curriculum → courses.view (enrollment-gated)
//   GET /lessons/:id           → lessons.view (enrollment-gated for non-preview)
//   GET /lessons/:id/stream-url → videos.stream (enrollment-gated, audited)
//   PUT /me/lessons/:id/progress → progress.write
//   POST /me/lessons/:id/complete → progress.write (+ attendance side-effect)
//   GET /me/progress           → progress.write (read allowed same permission)
//   GET /me/attendance         → attendance.view
// ─────────────────────────────────────────────────────────────────────────

// ── LMS schema registrations ─────────────────────────────────────────────

const MeDashboardResponse = registry.register("MeDashboardResponse", MeDashboardResponseSchema);
const MeDashboardEnvelope = envelopeOf("MeDashboard", MeDashboardResponse);

const MyEnrollmentSummary = registry.register("MyEnrollmentSummary", MyEnrollmentSummarySchema);
const MyEnrollmentDetail = registry.register("MyEnrollmentDetail", MyEnrollmentDetailSchema);
const MyEnrollmentDetailEnvelope = envelopeOf("MyEnrollmentDetail", MyEnrollmentDetail);
const MyEnrollmentListEnvelope = paginatedEnvelopeOf("MyEnrollment", MyEnrollmentSummary);

const CurriculumResponse = registry.register("CurriculumResponse", CurriculumResponseSchema);
const CurriculumEnvelope = envelopeOf("Curriculum", CurriculumResponse);

const LessonDetailResponse = registry.register("LessonDetailResponse", LessonDetailResponseSchema);
const LessonDetailEnvelope = envelopeOf("LessonDetail", LessonDetailResponse);

const StreamUrlResponse = registry.register("StreamUrlResponse", StreamUrlResponseSchema);
const StreamUrlEnvelope = envelopeOf("StreamUrl", StreamUrlResponse);

const UpdateProgressRequest = registry.register("UpdateProgressRequest", UpdateProgressRequestSchema);
const MarkLessonCompleteRequest = registry.register("MarkLessonCompleteRequest", MarkLessonCompleteRequestSchema);
const ProgressResponse = registry.register("ProgressResponse", ProgressResponseSchema);
const ProgressEnvelope = envelopeOf("Progress", ProgressResponse);

const MyProgressResponse = registry.register("MyProgressResponse", MyProgressResponseSchema);
const MyProgressEnvelope = envelopeOf("MyProgress", MyProgressResponse);

// ── LMS path registrations ────────────────────────────────────────────────

// ---- Dashboard ----

registry.registerPath({
  method: "get",
  path: "/api/v1/me/dashboard",
  summary: "Get the authenticated student's learning dashboard",
  description:
    "Returns the student's enrollment cards, the continue-learning rail (resume last " +
    "in-progress lesson at last_position_s), per-program progress summary rings, and " +
    "upcoming unwatched lessons. All data is the STUDENT'S OWN, scope:own enforced " +
    "server-side. Live-class countdown is omitted (live deferred, docs/plans/phase-3.md §Risks #4). " +
    "Permission: courses.view (scope:own).",
  tags: ["lms", "dashboard"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("courses.view (scope: own, student's own enrollments only)"),
  responses: {
    200: { description: "Dashboard snapshot.", content: { "application/json": { schema: MeDashboardEnvelope } } },
    ...errorResponses,
  },
});

// ---- My Enrollments ----

registry.registerPath({
  method: "get",
  path: "/api/v1/me/enrollments",
  summary: "List the authenticated student's enrollments",
  description:
    "Offset-paginated list of the student's own enrollments. Filter by status. " +
    "Returns enrollment cards with program/batch/progress metadata for the My Courses view. " +
    "Permission: courses.view (scope:own).",
  tags: ["lms", "enrollments"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("courses.view (scope: own)"),
  responses: {
    200: { description: "My enrollments page.", content: { "application/json": { schema: MyEnrollmentListEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/me/enrollments/{id}",
  summary: "Get detail for one of the student's enrollments",
  description:
    "Full enrollment detail including batch dates and lesson count breakdown. " +
    "The enrollment MUST belong to the requesting student (scope:own), 403 otherwise. " +
    "Permission: courses.view (scope:own).",
  tags: ["lms", "enrollments"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("courses.view (scope: own)"),
  request: { params: z.object({ id: z.string().uuid().describe("The enrollment id.") }) },
  responses: {
    200: { description: "Enrollment detail.", content: { "application/json": { schema: MyEnrollmentDetailEnvelope } } },
    ...errorResponses,
  },
});

// ---- Curriculum (enrollment-gated) ----

registry.registerPath({
  method: "get",
  path: "/api/v1/me/enrollments/{id}/curriculum",
  summary: "Get the curriculum tree for an enrolled program",
  description:
    "ENROLLMENT-GATED: the enrollment in the path MUST belong to the requesting student " +
    "and have status=active. Returns the full program → modules → lessons tree with " +
    "per-lesson progress snapshots, locked flags, video metadata (NO raw URL), and " +
    "module-level progress rollups. Content bodies are omitted (fetch via GET /lessons/:id). " +
    "All lessons are unlocked for enrolled students in P3 (sequential locking is future). " +
    "Preview lessons (is_preview=true) are also included and always unlocked. " +
    "A non-enrolled student gets 403. This is an enrollment-scoped resource. " +
    "Permission: courses.view (scope:own, enrollment-gated).",
  tags: ["lms", "curriculum"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("courses.view (scope: own, enrollment-gated, active enrollment required)"),
  request: { params: z.object({ id: z.string().uuid().describe("The enrollment id.") }) },
  responses: {
    200: { description: "Curriculum tree with per-lesson progress.", content: { "application/json": { schema: CurriculumEnvelope } } },
    ...errorResponses,
  },
});

// ---- Lesson detail (enrollment-gated for non-preview) ----

registry.registerPath({
  method: "get",
  path: "/api/v1/lessons/{id}",
  summary: "Get lesson detail (content + video meta + resources + progress)",
  description:
    "Returns the full lesson detail: title, type, content body, video metadata (NO raw URL, " +
    "see GET /lessons/:id/stream-url), resource metadata list (title/type/size only in P3, " +
    "no download URL), and the student's current progress snapshot. " +
    "ENROLLMENT GATE: non-preview lessons (is_preview=false) require an active enrollment " +
    "in the lesson's program → 403 if not enrolled. Preview lessons (is_preview=true) are " +
    "accessible without enrollment. " +
    "Includes nextLessonId/prevLessonId for curriculum navigation. " +
    "Permission: lessons.view (scope:own, enrollment-gated for non-preview lessons).",
  tags: ["lms", "lessons"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("lessons.view (scope: own; enrollment-gated for non-preview lessons; preview open without enrollment)"),
  request: { params: z.object({ id: z.string().uuid().describe("The lesson id.") }) },
  responses: {
    200: { description: "Lesson detail.", content: { "application/json": { schema: LessonDetailEnvelope } } },
    ...errorResponses,
  },
});

// ---- Stream URL (the security-critical endpoint) ----

registry.registerPath({
  method: "get",
  path: "/api/v1/lessons/{id}/stream-url",
  summary: "Mint a short-TTL signed HLS stream URL for a lesson (SECURITY-CRITICAL)",
  description:
    "*** THE ONLY WAY A CLIENT GETS A PLAYABLE VIDEO URL. *** " +
    "\n\n" +
    "Before minting, the server verifies ALL of the following:\n" +
    "  1. The requesting student has an ACTIVE ENROLLMENT in the lesson's program " +
    "     (OR the lesson is_preview=true).\n" +
    "  2. RBAC permission `videos.stream` (scope:own) is granted.\n" +
    "  3. The lesson has a `videos` row with status=ready (not processing/errored).\n" +
    "\n" +
    "The response carries ONLY:\n" +
    "  - `url`: the SHORT-TTL (≤5 min) signed HLS manifest URL produced by VideoProvider.\n" +
    "  - `expiresAt`: when the URL expires (ISO-8601). Re-call before or on expiry.\n" +
    "  - `provider`: informational (player does not branch on this).\n" +
    "  - `watermark`: per-user overlay payload (text + studentId). MUST be rendered by the player.\n" +
    "\n" +
    "WHAT IS NEVER RETURNED:\n" +
    "  - `provider_asset_id`. Never exposed to the client.\n" +
    "  - A raw CDN / manifest URL, the `url` field is ALWAYS a signed URL.\n" +
    "  - A long-lived token or cache-able link.\n" +
    "\n" +
    "PROVIDER FAIL-CLOSED: if VideoProvider keys are not configured → 503 " +
    "(never a raw/unsigned fallback URL). Noop provider returns a deterministic " +
    "fake signed URL for tests/local dev.\n" +
    "\n" +
    "AUDITED: every mint writes an audit-log row (actor=student, lessonId, timestamp).\n" +
    "\n" +
    "FRONTEND RULES:\n" +
    "  - Call this endpoint just before starting playback (not on page load).\n" +
    "  - Monitor expiresAt; re-call before URL expiry.\n" +
    "  - NEVER persist `url` to localStorage, Redux, or any long-lived cache.\n" +
    "  - NEVER log the `url` value.\n" +
    "  - MUST render `watermark.text` as a visible overlay on the video.\n" +
    "\n" +
    "Permission: videos.stream (scope:own, enrollment-gated, audited).",
  tags: ["lms", "lessons", "video"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission(
    "videos.stream (scope: own; enrollment-gated for non-preview lessons; " +
    "preview open without enrollment; AUDITED. Every mint writes an audit-log row)",
  ),
  request: { params: z.object({ id: z.string().uuid().describe("The lesson id.") }) },
  responses: {
    200: {
      description:
        "Short-TTL signed HLS stream URL + expiry + watermark. " +
        "Re-call on expiry. Never cache this URL.",
      content: { "application/json": { schema: StreamUrlEnvelope } },
    },
    ...errorResponses,
  },
});

// ---- Resource signed download URL (closes the P4 follow-up TODO) ----

const ResourceDownloadResponse = registry.register("ResourceDownloadResponse", ResourceDownloadResponseSchema);
const ResourceDownloadEnvelope = envelopeOf("ResourceDownload", ResourceDownloadResponse);

registry.registerPath({
  method: "get",
  path: "/api/v1/lessons/{lessonId}/resources/{resourceId}/download-url",
  summary: "Mint a short-lived signed download URL for a lesson resource",
  description:
    "Mirrors GET /me/certificates/:id/download. Enrollment-gated (same gate as lesson " +
    "detail / stream-url). A student must own an active enrollment in the lesson's " +
    "program, or the lesson must be is_preview=true. NEVER a raw S3/R2 bucket URL. " +
    "Re-call this endpoint to get a fresh URL, do NOT cache it. " +
    "Permission: lessons.view (scope: own).",
  tags: ["lms", "lessons"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("lessons.view (scope: own; enrollment-gated)"),
  request: {
    params: z.object({
      lessonId: z.string().uuid().describe("The lesson id."),
      resourceId: z.string().uuid().describe("The resource id."),
    }),
  },
  responses: {
    200: { description: "Signed download URL.", content: { "application/json": { schema: ResourceDownloadEnvelope } } },
    ...errorResponses,
  },
});

// ---- Progress — position ping ----

registry.registerPath({
  method: "put",
  path: "/api/v1/me/lessons/{id}/progress",
  summary: "Report current playback position (position ping)",
  description:
    "Upserts lesson_progress(enrollment_id, lesson_id) with the new lastPositionS. " +
    "Called by the player on a throttled onTimeUpdate interval (e.g. every 5–10 s). " +
    "ENROLLMENT-SCOPED: the lesson MUST belong to a program the student is enrolled in. " +
    "The student CANNOT write another student's progress (scope:own, server-enforced). " +
    "This endpoint does NOT complete the lesson. Use POST /me/lessons/:id/complete for that. " +
    "No Idempotency-Key required (upsert semantics: last write wins). " +
    "Returns the updated progress row + the enrollment's recalculated progressPct for " +
    "optimistic UI updates. " +
    "Permission: progress.write (scope:own, enrollment-gated).",
  tags: ["lms", "progress"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("progress.write (scope: own, enrollment-gated, cannot write another student's progress)"),
  request: {
    params: z.object({ id: z.string().uuid().describe("The lesson id.") }),
    body: { content: { "application/json": { schema: UpdateProgressRequest } } },
  },
  responses: {
    200: { description: "Progress updated; resume position saved.", content: { "application/json": { schema: ProgressEnvelope } } },
    ...errorResponses,
  },
});

// ---- Progress — mark complete ----

registry.registerPath({
  method: "post",
  path: "/api/v1/me/lessons/{id}/complete",
  summary: "Mark a lesson as complete",
  description:
    "Explicitly marks the lesson as completed. The server:\n" +
    "  1. Sets lesson_progress.status=completed, completed_at=now().\n" +
    "  2. Rolls up enrollment.progress_pct (completed/total lessons × 100).\n" +
    "  3. Idempotently creates one attendance row (source=recorded, status=present) " +
    "     for the (enrollment, lesson) pair, replay does NOT double-count.\n" +
    "  4. Writes an audit-log row.\n" +
    "\n" +
    "IDEMPOTENT: calling complete on an already-completed lesson returns the current " +
    "progress row without re-marking attendance or corrupting the rollup. " +
    "Idempotency-Key header REQUIRED (docs/04 §2.14). " +
    "ENROLLMENT-SCOPED: the student must be enrolled in the lesson's program (scope:own). " +
    "Returns the updated progress row + recalculated enrollment progressPct. " +
    "Permission: progress.write (scope:own, enrollment-gated).",
  tags: ["lms", "progress"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("progress.write (scope: own, enrollment-gated; triggers attendance side-effect)"),
  request: {
    params: z.object({ id: z.string().uuid().describe("The lesson id.") }),
    body: { content: { "application/json": { schema: MarkLessonCompleteRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    200: { description: "Lesson marked complete; attendance row created (idempotent).", content: { "application/json": { schema: ProgressEnvelope } } },
    ...errorResponses,
  },
});

// ---- Progress — rollup ----

registry.registerPath({
  method: "get",
  path: "/api/v1/me/progress",
  summary: "Get per-program/module completion rollup",
  description:
    "Returns per-program and per-module completion percentages + lesson counts for all " +
    "of the student's active enrollments. Used to render progress rings and the My Progress " +
    "analytics view (docs/02 §7.10). Overall aggregate stats also included. " +
    "Permission: progress.write (read is also covered by this permission, scope:own).",
  tags: ["lms", "progress"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("progress.write (scope: own. Read of own progress is included)"),
  responses: {
    200: { description: "Progress rollup.", content: { "application/json": { schema: MyProgressEnvelope } } },
    ...errorResponses,
  },
});

// ─────────────────────────────────────────────────────────────────────────
// Phase 4, Wave 2 — Learning Depth API contracts.
//
// Imports (P4 schemas).
// ─────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- registry import side-effect
import {
  AssignmentKindSchema,
  SubmissionStatusSchema,
  AssignmentStudentStatusSchema,
  MilestoneSchema,
  MilestoneInputSchema,
  CreateAssignmentRequestSchema,
  UpdateAssignmentRequestSchema,
  AssignmentDetailSchema,
  AssignmentSummarySchema,
  AssignmentListItemSchema,
  AssignmentStudentDetailSchema,
  SubmitAssignmentRequestSchema,
  GradeSubmissionRequestSchema,
  SubmissionDetailSchema,
  SubmissionSummarySchema,
  MilestoneReviewStateSchema,
  ProjectDetailSchema,
  ListAssignmentsQuerySchema,
  ListSubmissionsQuerySchema,
} from "../learning/assignments.schemas.js";

import {
  AssessmentTypeSchema,
  QuestionTypeSchema,
  McqOptionSchema,
  AssessmentQuestionPublicSchema,
  AssessmentQuestionAuthorSchema,
  QuestionInputSchema,
  CreateAssessmentRequestSchema,
  UpdateAssessmentRequestSchema,
  AssessmentDetailAuthorSchema,
  AssessmentSummarySchema,
  AssessmentDetailPublicSchema,
  StartAttemptRequestSchema,
  SubmitAttemptRequestSchema,
  FlagAttemptRequestSchema,
  QuestionResultSchema,
  AttemptResultSchema,
  AttemptInProgressSchema,
  GradeAttemptRequestSchema,
  ListAssessmentsQuerySchema,
} from "../learning/assessments.schemas.js";

import {
  CertificateStatusSchema,
  EligibilityResultSchema,
  EligibilityListItemSchema,
  EligibilityBatchSummarySchema,
  IssueCertificateRequestSchema,
  RecommendCertificateRequestSchema,
  RevokeCertificateRequestSchema,
  ReissueCertificateRequestSchema,
  CertificateListItemSchema,
  CertificateDetailSchema,
  CertificateDownloadQuerySchema,
  CertificateDownloadResponseSchema,
  CertificateCrmDetailSchema,
  VerifyResultSchema,
  CertificateTemplateSummarySchema,
  CertificateTemplateDetailSchema,
  CreateCertificateTemplateRequestSchema,
  UpdateCertificateTemplateRequestSchema,
  BulkIssueCertificatesRequestSchema,
  BulkIssueCertificatesResponseSchema,
  ListCertificatesQuerySchema,
  ListEligibilityQuerySchema,
  ListEligibilityBatchesQuerySchema,
} from "../learning/certificates.schemas.js";

import {
  GetUploadUrlRequestSchema,
  SignedUploadResponseSchema,
  SignedDownloadUrlSchema,
} from "../learning/storage.schemas.js";

// ─── P4 component registrations ──────────────────────────────────────────

// ---- Assignments ----
const CreateAssignmentRequest = registry.register("CreateAssignmentRequest", CreateAssignmentRequestSchema);
const UpdateAssignmentRequest = registry.register("UpdateAssignmentRequest", UpdateAssignmentRequestSchema);
const AssignmentSummary = registry.register("AssignmentSummary", AssignmentSummarySchema);
const AssignmentDetail = registry.register("AssignmentDetail", AssignmentDetailSchema);
const AssignmentDetailEnvelope = envelopeOf("AssignmentDetail", AssignmentDetail);
const AssignmentListEnvelope = paginatedEnvelopeOf("Assignment", AssignmentSummary);
const AssignmentListItem = registry.register("AssignmentListItem", AssignmentListItemSchema);
const AssignmentListItemEnvelope = paginatedEnvelopeOf("AssignmentListItem", AssignmentListItem);
const AssignmentStudentDetail = registry.register("AssignmentStudentDetail", AssignmentStudentDetailSchema);
const AssignmentStudentDetailEnvelope = envelopeOf("AssignmentStudentDetail", AssignmentStudentDetail);
const ProjectDetail = registry.register("ProjectDetail", ProjectDetailSchema);
const ProjectDetailEnvelope = envelopeOf("ProjectDetail", ProjectDetail);

// ---- Submissions ----
const SubmitAssignmentRequest = registry.register("SubmitAssignmentRequest", SubmitAssignmentRequestSchema);
const GradeSubmissionRequest = registry.register("GradeSubmissionRequest", GradeSubmissionRequestSchema);
const SubmissionDetail = registry.register("SubmissionDetail", SubmissionDetailSchema);
const SubmissionDetailEnvelope = envelopeOf("SubmissionDetail", SubmissionDetail);
const SubmissionSummary = registry.register("SubmissionSummary", SubmissionSummarySchema);
const SubmissionListEnvelope = paginatedEnvelopeOf("Submission", SubmissionSummary);

// ---- Assessments ----
const CreateAssessmentRequest = registry.register("CreateAssessmentRequest", CreateAssessmentRequestSchema);
const UpdateAssessmentRequest = registry.register("UpdateAssessmentRequest", UpdateAssessmentRequestSchema);
const AssessmentSummary = registry.register("AssessmentSummary", AssessmentSummarySchema);
const AssessmentSummaryListEnvelope = paginatedEnvelopeOf("AssessmentSummary", AssessmentSummary);
const AssessmentDetailAuthor = registry.register("AssessmentDetailAuthor", AssessmentDetailAuthorSchema);
const AssessmentDetailAuthorEnvelope = envelopeOf("AssessmentDetailAuthor", AssessmentDetailAuthor);
const AssessmentDetailPublic = registry.register("AssessmentDetailPublic", AssessmentDetailPublicSchema);
const AssessmentDetailPublicEnvelope = envelopeOf("AssessmentDetailPublic", AssessmentDetailPublic);
const AssessmentQuestionPublic = registry.register("AssessmentQuestionPublic", AssessmentQuestionPublicSchema);

// ---- Attempts ----
const SubmitAttemptRequest = registry.register("SubmitAttemptRequest", SubmitAttemptRequestSchema);
const FlagAttemptRequest = registry.register("FlagAttemptRequest", FlagAttemptRequestSchema);
const AttemptResult = registry.register("AttemptResult", AttemptResultSchema);
const AttemptResultEnvelope = envelopeOf("AttemptResult", AttemptResult);
const AttemptInProgress = registry.register("AttemptInProgress", AttemptInProgressSchema);
const AttemptInProgressEnvelope = envelopeOf("AttemptInProgress", AttemptInProgress);
const GradeAttemptRequest = registry.register("GradeAttemptRequest", GradeAttemptRequestSchema);

// ---- Certificates ----
const EligibilityResult = registry.register("EligibilityResult", EligibilityResultSchema);
const EligibilityResultEnvelope = envelopeOf("EligibilityResult", EligibilityResult);
const EligibilityListItem = registry.register("EligibilityListItem", EligibilityListItemSchema);
const EligibilityListEnvelope = paginatedEnvelopeOf("EligibilityListItem", EligibilityListItem);
const EligibilityBatchSummary = registry.register("EligibilityBatchSummary", EligibilityBatchSummarySchema);
const EligibilityBatchListEnvelope = paginatedEnvelopeOf("EligibilityBatchSummary", EligibilityBatchSummary);
const IssueCertificateRequest = registry.register("IssueCertificateRequest", IssueCertificateRequestSchema);
const RecommendCertificateRequest = registry.register("RecommendCertificateRequest", RecommendCertificateRequestSchema);
const RevokeCertificateRequest = registry.register("RevokeCertificateRequest", RevokeCertificateRequestSchema);
const ReissueCertificateRequest = registry.register("ReissueCertificateRequest", ReissueCertificateRequestSchema);
const CertificateListItem = registry.register("CertificateListItem", CertificateListItemSchema);
const CertificateListEnvelope = paginatedEnvelopeOf("CertificateListItem", CertificateListItem);
const CertificateDetail = registry.register("CertificateDetail", CertificateDetailSchema);
const CertificateDetailEnvelope = envelopeOf("CertificateDetail", CertificateDetail);
const CertificateCrmDetail = registry.register("CertificateCrmDetail", CertificateCrmDetailSchema);
const CertificateCrmDetailEnvelope = envelopeOf("CertificateCrmDetail", CertificateCrmDetail);
const CertificateDownloadResponse = registry.register("CertificateDownloadResponse", CertificateDownloadResponseSchema);
const CertificateDownloadEnvelope = envelopeOf("CertificateDownload", CertificateDownloadResponse);
const VerifyResult = registry.register("VerifyResult", VerifyResultSchema);
const VerifyResultEnvelope = envelopeOf("VerifyResult", VerifyResult);
const CertificateTemplateSummary = registry.register("CertificateTemplateSummary", CertificateTemplateSummarySchema);
const CertificateTemplateListEnvelope = paginatedEnvelopeOf("CertificateTemplateSummary", CertificateTemplateSummary);

// ---- Storage ----
const GetUploadUrlRequest = registry.register("GetUploadUrlRequest", GetUploadUrlRequestSchema);
const SignedUploadResponse = registry.register("SignedUploadResponse", SignedUploadResponseSchema);
const SignedUploadEnvelope = envelopeOf("SignedUpload", SignedUploadResponse);
const SignedDownloadUrl = registry.register("SignedDownloadUrl", SignedDownloadUrlSchema);
const SignedDownloadEnvelope = envelopeOf("SignedDownload", SignedDownloadUrl);

// ─── P4 paths ─────────────────────────────────────────────────────────────
//
// Permission encoding convention (same as P1–P3):
//   - `x-required-permission` extension carries `module.action (scope note)`.
//   - Actual enforcement is the NestJS @RequirePermission guard + ScopeInterceptor.
//   - Idempotency-Key REQUIRED on all unsafe mutations (docs/04 §2.14).

// ══════════════════════════════════════════════════════════════════════════
// Storage — signed upload/download URLs
// ══════════════════════════════════════════════════════════════════════════

registry.registerPath({
  method: "post",
  path: "/api/v1/storage/upload-url",
  summary: "Request a signed PUT URL for direct-to-storage file upload",
  description:
    "Mints a short-lived signed PUT URL (≤15 min) scoped to submissions/{tenantId}/{enrollmentId}/... " +
    "The client PUTs the file directly to S3/R2. NOT through the API server. " +
    "After upload, include the returned storageKey in the submission payload. " +
    "Raw bucket URLs are NEVER returned (AC-I2). " +
    "Permission: submissions.create (scope: own) for student uploads; " +
    "courses.edit for faculty resource uploads.",
  tags: ["learning", "storage"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("submissions.create (scope: own) | courses.edit (scope: assigned)"),
  request: {
    body: { content: { "application/json": { schema: GetUploadUrlRequest } } },
  },
  responses: {
    201: { description: "Signed upload URL + storageKey.", content: { "application/json": { schema: SignedUploadEnvelope } } },
    ...errorResponses,
  },
});

// ══════════════════════════════════════════════════════════════════════════
// Assignments (CRM authoring — faculty/ops, assigned-scope)
// ══════════════════════════════════════════════════════════════════════════

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/assignments",
  summary: "List assignments (CRM authoring view, assigned-batch scoped)",
  tags: ["learning", "assignments"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("assignments.view (scope: assigned. Faculty sees own batches; all for admin)"),
  responses: { 200: { description: "Assignment list.", content: { "application/json": { schema: AssignmentListEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/assignments",
  summary: "Create an assignment or project on a lesson",
  tags: ["learning", "assignments"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("assignments.create (scope: assigned)"),
  request: {
    body: { content: { "application/json": { schema: CreateAssignmentRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: { 201: { description: "Assignment created.", content: { "application/json": { schema: AssignmentDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/assignments/{id}",
  summary: "Get assignment detail (CRM)",
  tags: ["learning", "assignments"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("assignments.view (scope: assigned)"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: "Assignment detail with milestones.", content: { "application/json": { schema: AssignmentDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/crm/assignments/{id}",
  summary: "Update an assignment",
  tags: ["learning", "assignments"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("assignments.edit (scope: assigned)"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: UpdateAssignmentRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: { 200: { description: "Assignment updated.", content: { "application/json": { schema: AssignmentDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/crm/assignments/{id}",
  summary: "Soft-delete an assignment",
  tags: ["learning", "assignments"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("assignments.edit (scope: assigned)"),
  request: { params: z.object({ id: z.string().uuid() }), headers: idempotencyKeyHeader },
  responses: { 200: { description: "Assignment soft-deleted.", content: { "application/json": { schema: AssignmentDetailEnvelope } } }, ...errorResponses },
});

// ---- Submissions (CRM grading queue) ----

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/assignments/{id}/submissions",
  summary: "List submissions for an assignment (faculty grading queue)",
  tags: ["learning", "submissions"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("submissions.view (scope: assigned. Faculty sees only assigned batches)"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: "Submission list.", content: { "application/json": { schema: SubmissionListEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/submissions/{id}",
  summary: "Get a submission detail (faculty view, assigned-scope)",
  tags: ["learning", "submissions"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("submissions.view (scope: assigned)"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: "Submission detail with file download URLs.", content: { "application/json": { schema: SubmissionDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/crm/submissions/{id}/grade",
  summary: "Grade a submission (faculty, audited before/after)",
  description:
    "Sets submission.status=graded, populates score/rubric/feedback. " +
    "Writes an audit log entry with before/after values on every call (AC-B1, AC-B3). " +
    "Faculty may only grade submissions in their assigned batches (AC-B2, AC-J3). " +
    "Students cannot self-grade (AC-B4, AC-J7). " +
    "Permission: submissions.grade (scope: assigned).",
  tags: ["learning", "submissions"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("submissions.grade (scope: assigned. Submission must be in an assigned batch; audited before/after)"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: GradeSubmissionRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: { 200: { description: "Submission graded.", content: { "application/json": { schema: SubmissionDetailEnvelope } } }, ...errorResponses },
});

// ── Projects (kind=project assignment + milestones — not a separate resource) ──

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/assignments/{id}/project",
  summary: "Get full project detail with milestone review states",
  description:
    "Projects are assignments with kind='project'. This endpoint returns the assignment " +
    "plus per-milestone submission/review state for all enrolled students (faculty assigned-scope). " +
    "Permission: projects.review (scope: assigned).",
  tags: ["learning", "projects"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("projects.review (scope: assigned)"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: "Project detail + milestone states.", content: { "application/json": { schema: ProjectDetailEnvelope } } }, ...errorResponses },
});

// ══════════════════════════════════════════════════════════════════════════
// Assignments + Projects — LMS (student, own-scope)
// ══════════════════════════════════════════════════════════════════════════

registry.registerPath({
  method: "get",
  path: "/api/v1/me/assignments",
  summary: "List assignments for own enrollments (student view)",
  tags: ["learning", "assignments"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("assignments.view (scope: own)"),
  responses: { 200: { description: "Assignment list with derived status.", content: { "application/json": { schema: AssignmentListItemEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/me/assignments/{id}",
  summary: "Get assignment detail (student view, with own submission)",
  tags: ["learning", "assignments"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("assignments.view (scope: own)"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: "Assignment detail + own submission snapshot.", content: { "application/json": { schema: AssignmentStudentDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/me/assignments/{id}/submit",
  summary: "Student submits an assignment (file/text/link)",
  description:
    "Creates a Submission row. Files must be StorageProvider keys from the signed-upload flow " +
    "(POST /storage/upload-url). At least one of files/text/link required. " +
    "Errors: 422 ASSIGNMENT_OVERDUE (past due_at), 409 RESUBMIT_NOT_ALLOWED, " +
    "404 IDOR if assignment not in enrolled program (AC-A1–A6). " +
    "Permission: submissions.create (scope: own).",
  tags: ["learning", "assignments"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("submissions.create (scope: own. Enrollment-gated; IDOR→404 if not enrolled)"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: SubmitAssignmentRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: { 201: { description: "Submission created.", content: { "application/json": { schema: SubmissionDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/me/assignments/{id}/milestones/{milestoneId}/submit",
  summary: "Student submits a project milestone",
  description:
    "Same as assignment submit but scoped to a specific project milestone (AC-C1). " +
    "Permission: submissions.create (scope: own).",
  tags: ["learning", "projects"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("submissions.create (scope: own)"),
  request: {
    params: z.object({ id: z.string().uuid(), milestoneId: z.string().uuid() }),
    body: { content: { "application/json": { schema: SubmitAssignmentRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: { 201: { description: "Milestone submission created.", content: { "application/json": { schema: SubmissionDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/me/assignments/{id}/my-submission",
  summary: "Get the student's own submission for an assignment (includes grade/rubric/feedback)",
  description:
    "Returns the student's own most recent submission for an assignment. " +
    "Includes signed download URLs for files. Grade/rubric/feedback visible when status=graded (AC-B5). " +
    "Student cannot access another student's submission (AC-J1). " +
    "Permission: submissions.view (scope: own).",
  tags: ["learning", "assignments"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("submissions.view (scope: own)"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: "Own submission detail.", content: { "application/json": { schema: SubmissionDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/me/assignments/{id}/project",
  summary: "Get project detail for own enrollment (milestone states + feedback)",
  tags: ["learning", "projects"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("assignments.view (scope: own) + projects.review (own)"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: "Project milestone states.", content: { "application/json": { schema: ProjectDetailEnvelope } } }, ...errorResponses },
});

// ══════════════════════════════════════════════════════════════════════════
// Assessments (CRM authoring, assigned-scope)
// ══════════════════════════════════════════════════════════════════════════

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/assessments",
  summary: "List assessments (CRM, assigned-batch scoped)",
  tags: ["learning", "assessments"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("assessments.view (scope: assigned | all)"),
  responses: { 200: { description: "Assessment list.", content: { "application/json": { schema: AssessmentSummaryListEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/assessments",
  summary: "Create an assessment with questions (faculty authoring)",
  description:
    "Creates assessment + question rows atomically. Questions with answerKey are stored server-side; " +
    "the answer key is never returned to students. " +
    "Permission: assessments.create (scope: assigned).",
  tags: ["learning", "assessments"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("assessments.create (scope: assigned)"),
  request: {
    body: { content: { "application/json": { schema: CreateAssessmentRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: { 201: { description: "Assessment created (with answer keys in response, author view).", content: { "application/json": { schema: AssessmentDetailAuthorEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/assessments/{id}",
  summary: "Get assessment detail with answer keys (CRM/faculty only)",
  description:
    "Returns full assessment including questions WITH answer keys. " +
    "NEVER call this endpoint from a student-facing surface. " +
    "Permission: assessments.view (scope: assigned).",
  tags: ["learning", "assessments"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("assessments.view (scope: assigned). INCLUDES answer keys; CRM only"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: "Assessment detail with answer keys.", content: { "application/json": { schema: AssessmentDetailAuthorEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/crm/assessments/{id}",
  summary: "Update an assessment",
  tags: ["learning", "assessments"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("assessments.edit (scope: assigned)"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: UpdateAssessmentRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: { 200: { description: "Assessment updated.", content: { "application/json": { schema: AssessmentDetailAuthorEnvelope } } }, ...errorResponses },
});

// ---- Grade descriptive attempt (faculty) ----

registry.registerPath({
  method: "put",
  path: "/api/v1/crm/attempts/{id}/grade",
  summary: "Faculty grades descriptive questions on an attempt",
  description:
    "Manual grading for descriptive questions. Sets earned points per question and overall passed. " +
    "Error: 422 MANUAL_GRADE_NOT_APPLICABLE for MCQ-only attempts. " +
    "Permission: attempts.grade (scope: assigned).",
  tags: ["learning", "attempts"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("attempts.grade (scope: assigned, only for assigned batch)"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: GradeAttemptRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: { 200: { description: "Attempt graded.", content: { "application/json": { schema: AttemptResultEnvelope } } }, ...errorResponses },
});

// ══════════════════════════════════════════════════════════════════════════
// Assessments + Attempts — LMS (student, own-scope)
// ══════════════════════════════════════════════════════════════════════════

registry.registerPath({
  method: "get",
  path: "/api/v1/me/assessments",
  summary: "List assessments for own enrollments (student view, no answer keys)",
  tags: ["learning", "assessments"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("assessments.view (scope: own)"),
  responses: { 200: { description: "Assessment list (no answer keys).", content: { "application/json": { schema: AssessmentSummaryListEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/me/assessments/{id}",
  summary: "Get assessment detail (student view). NO questions, NO answer key",
  description:
    "Returns assessment metadata + attempt stats for the student. " +
    "Does NOT include questions (questions are delivered with the attempt on POST /attempts). " +
    "NO answer key in this response (AC-D2). " +
    "Permission: assessments.view (scope: own).",
  tags: ["learning", "assessments"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("assessments.view (scope: own). NO answer key in response"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: "Assessment metadata + attempt stats.", content: { "application/json": { schema: AssessmentDetailPublicEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/me/assessments/{id}/attempts",
  summary: "Start a new attempt (student). Returns shuffled questions WITHOUT answer key",
  description:
    "Server sets started_at=NOW(), time_expires_at=started_at+time_limit_s (null if untimed). " +
    "Returns attempt detail + shuffled questions. Questions have NO answer key (AC-D1, AC-D2). " +
    "Errors: 422 ATTEMPTS_EXHAUSTED, 422 ATTEMPT_IN_PROGRESS. " +
    "Permission: attempts.take (scope: own).",
  tags: ["learning", "attempts"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("attempts.take (scope: own). Time_expires_at set server-side; NO answer key in response"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    headers: idempotencyKeyHeader,
  },
  responses: { 201: { description: "Attempt started + shuffled questions (no answer key).", content: { "application/json": { schema: AttemptInProgressEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "put",
  path: "/api/v1/me/attempts/{id}",
  summary: "Submit attempt answers (idempotent; MCQ auto-graded server-side)",
  description:
    "Submits answers for an in-progress attempt. Server checks time_expires_at before accepting " +
    "(422 ATTEMPT_EXPIRED if late. AC-D4). MCQ auto-graded against server-only answer key. " +
    "Descriptive → passed=null until faculty manual grade. " +
    "Idempotent: re-submit of an already-submitted attempt returns 200 with cached result (AC-D7). " +
    "Permission: attempts.take (scope: own; attempt must belong to the authenticated student).",
  tags: ["learning", "attempts"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("attempts.take (scope: own). Server-enforced time-box + MCQ auto-grade; idempotent"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: SubmitAttemptRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    200: { description: "Attempt submitted (idempotent) or already submitted.", content: { "application/json": { schema: AttemptResultEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/me/attempts/{id}",
  summary: "Get attempt detail (own attempt only, IDOR→404)",
  description:
    "Returns attempt result including question results (post-submit). " +
    "In-progress: questionResults=null. " +
    "Student cannot read another student's attempt (AC-D10, AC-J4). " +
    "Permission: attempts.view (scope: own).",
  tags: ["learning", "attempts"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("attempts.view (scope: own, cross-student IDOR→404)"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: "Attempt detail.", content: { "application/json": { schema: AttemptResultEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/me/attempts/{id}/flag",
  summary: "Report a tab-switch event (advisory signal, does NOT terminate attempt)",
  description:
    "Increments attempts.flags.tabSwitchCount by 1. Does NOT auto-submit or terminate (AC-D6). " +
    "Permission: attempts.take (scope: own).",
  tags: ["learning", "attempts"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("attempts.take (scope: own). Stores flag only, no hard block"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: FlagAttemptRequest } } },
  },
  responses: { 200: { description: "Flag recorded.", content: { "application/json": { schema: AttemptResultEnvelope } } }, ...errorResponses },
});

// ══════════════════════════════════════════════════════════════════════════
// Certificates — CRM (ops/faculty, assigned/all scope)
// ══════════════════════════════════════════════════════════════════════════

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/certificates/eligibility",
  summary: "List enrollment eligibility status (ops/faculty view)",
  description:
    "Shows eligibility gate breakdown per enrollment: completion%, required assessments, final project. " +
    "Used by ops to decide whom to issue certificates to. " +
    "Permission: certificates.view (scope: assigned|all).",
  tags: ["learning", "certificates"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("certificates.view (scope: assigned|all)"),
  responses: { 200: { description: "Eligibility list.", content: { "application/json": { schema: EligibilityListEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/certificates/eligibility-batches",
  summary: "List cohorts for the batch-first Certificates landing view",
  description:
    "One row per batch holding at least one non-dropped enrollment, with cheap headline counts " +
    "(students, issued, revoked, completion-gate-ready). The CRM opens on this table and drills " +
    "into GET /crm/certificates/eligibility?batchId=… for the students. `completionReadyCount` is " +
    "the progress_pct gate ALONE. The three-gate eligibility engine is NOT run here (it costs ~5 " +
    "queries per enrollment; this endpoint is a fixed 5 queries per page). " +
    "Permission: certificates.view (scope: assigned|all. Faculty see only their assigned batches).",
  tags: ["learning", "certificates"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("certificates.view (scope: assigned|all)"),
  request: { query: ListEligibilityBatchesQuerySchema },
  responses: { 200: { description: "Batch rollup list.", content: { "application/json": { schema: EligibilityBatchListEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/certificates/eligibility/{enrollmentId}",
  summary: "Get eligibility for one enrollment",
  tags: ["learning", "certificates"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("certificates.view (scope: assigned|all)"),
  request: { params: z.object({ enrollmentId: z.string().uuid() }) },
  responses: { 200: { description: "Eligibility detail.", content: { "application/json": { schema: EligibilityResultEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/certificates",
  summary: "Issue a certificate (ops, runs eligibility check first)",
  description:
    "Runs eligibility engine → generates cert_uid (HMAC-signed) → renders PDF (CertificatePdfPort) → " +
    "stores PDF via StorageProvider → inserts certificates row. Writes audit log entry. " +
    "Errors: 422 NOT_ELIGIBLE (with reasons), 409 CERTIFICATE_ALREADY_EXISTS. " +
    "Permission: certificates.issue (scope: all|branch).",
  tags: ["learning", "certificates"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("certificates.issue (scope: all|branch, audited issuance)"),
  request: {
    body: { content: { "application/json": { schema: IssueCertificateRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: { 201: { description: "Certificate issued.", content: { "application/json": { schema: CertificateCrmDetailEnvelope } } }, ...errorResponses },
});

const BulkIssueCertificatesRequest = registry.register("BulkIssueCertificatesRequest", BulkIssueCertificatesRequestSchema);
const BulkIssueCertificatesResponse = registry.register("BulkIssueCertificatesResponse", BulkIssueCertificatesResponseSchema);
const BulkIssueCertificatesEnvelope = envelopeOf("BulkIssueCertificates", BulkIssueCertificatesResponse);

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/certificates/bulk",
  summary: "Issue certificates for a list of eligible enrollments in one audited call",
  description:
    "Runs the same per-enrollment eligibility + duplicate checks as POST /crm/certificates for EACH " +
    "enrollmentId. One row failing does not abort the others. Every successful issuance writes its " +
    "own certificate.issue audit row; this endpoint additionally writes ONE certificate.bulk_issue " +
    "summary audit row. Permission: certificates.issue (scope: all|branch).",
  tags: ["learning", "certificates"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("certificates.issue (scope: all|branch, audited, per-row + summary)"),
  request: { body: { content: { "application/json": { schema: BulkIssueCertificatesRequest } } }, headers: idempotencyKeyHeader },
  responses: { 200: { description: "Per-row bulk issuance results.", content: { "application/json": { schema: BulkIssueCertificatesEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/certificates/{enrollmentId}/recommend",
  summary: "Faculty recommends an enrollment for certificate issuance (flag only, no cert row)",
  tags: ["learning", "certificates"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("certificates.recommend (scope: assigned)"),
  request: {
    params: z.object({ enrollmentId: z.string().uuid() }),
    body: { content: { "application/json": { schema: RecommendCertificateRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: { 200: { description: "Recommendation recorded.", content: { "application/json": { schema: EligibilityResultEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/certificates/{id}",
  summary: "Get certificate detail (CRM, includes student/enrollment info)",
  tags: ["learning", "certificates"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("certificates.view (scope: assigned|all)"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: "Certificate CRM detail.", content: { "application/json": { schema: CertificateCrmDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/certificates/{id}/download",
  summary: "Get a signed URL for a certificate PDF (staff view of the student's document)",
  description:
    "Returns a short-lived signed GET URL for the certificate PDF (NOT a raw bucket URL, AC-I2), " +
    "so staff can see the document a student receives rather than only its metadata. " +
    "Differs from the student's own download on purpose: a REVOKED certificate is still " +
    "returned (that is exactly when somebody has to look at it), and a certificate whose PDF " +
    "was never stored is regenerated on demand rather than 404ing. " +
    "`disposition=inline` renders it in the CRM's preview panel; `attachment` (the default) saves it. " +
    "Permission: certificates.view (scope: assigned|all; assigned is limited to the faculty's own batches).",
  tags: ["learning", "certificates"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("certificates.view (scope: assigned|all). Signed URL only; IDOR → 404"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    query: CertificateDownloadQuerySchema,
  },
  responses: {
    200: { description: "Signed URL for the certificate PDF.", content: { "application/json": { schema: CertificateDownloadEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/crm/certificates/{id}/revoke",
  summary: "Revoke a certificate (instant. Reflected in public verify immediately)",
  description:
    "Sets certificate.status=revoked. Revocation is instant. Public verify reflects it immediately " +
    "(no cache window, AC-G1/G2). Writes audit log entry. " +
    "Error: 409 ALREADY_REVOKED. " +
    "Permission: certificates.revoke (scope: all).",
  tags: ["learning", "certificates"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("certificates.revoke (scope: all, audited; instant revocation)"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: RevokeCertificateRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: { 200: { description: "Certificate revoked.", content: { "application/json": { schema: CertificateCrmDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/certificates/{enrollmentId}/reissue",
  summary: "Reissue a revoked certificate (old cert_uid invalidated)",
  description:
    "Soft-deletes the old certificate row; creates a new cert with a new cert_uid + PDF. " +
    "The old cert_uid no longer resolves (AC-G3/G4). Writes audit log entry. " +
    "Permission: certificates.issue (scope: all|branch).",
  tags: ["learning", "certificates"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("certificates.issue (scope: all|branch), reissue; old cert_uid invalidated"),
  request: {
    params: z.object({ enrollmentId: z.string().uuid() }),
    body: { content: { "application/json": { schema: ReissueCertificateRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: { 201: { description: "Certificate reissued.", content: { "application/json": { schema: CertificateCrmDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/certificate-templates",
  summary: "List available certificate templates (for ops to select at issuance)",
  tags: ["learning", "certificates"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("certificates.view"),
  responses: { 200: { description: "Template list.", content: { "application/json": { schema: CertificateTemplateListEnvelope } } }, ...errorResponses },
});

const CertificateTemplateDetail = registry.register("CertificateTemplateDetail", CertificateTemplateDetailSchema);
const CertificateTemplateDetailEnvelope = envelopeOf("CertificateTemplateDetail", CertificateTemplateDetail);
const CreateCertificateTemplateRequest = registry.register("CreateCertificateTemplateRequest", CreateCertificateTemplateRequestSchema);
const UpdateCertificateTemplateRequest = registry.register("UpdateCertificateTemplateRequest", UpdateCertificateTemplateRequestSchema);

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/certificate-templates/{id}",
  summary: "Get a certificate template's full detail (incl. saved designer layout)",
  tags: ["learning", "certificates"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("certificates.view"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: "Template detail.", content: { "application/json": { schema: CertificateTemplateDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/certificate-templates",
  summary: "Create a certificate template",
  tags: ["learning", "certificates"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("certificates.issue"),
  request: { body: { content: { "application/json": { schema: CreateCertificateTemplateRequest } } }, headers: idempotencyKeyHeader },
  responses: { 201: { description: "Template created.", content: { "application/json": { schema: CertificateTemplateDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/crm/certificate-templates/{id}",
  summary: "Update a certificate template (incl. the designer's saved field layout)",
  tags: ["learning", "certificates"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("certificates.issue"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: UpdateCertificateTemplateRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: { 200: { description: "Template updated.", content: { "application/json": { schema: CertificateTemplateDetailEnvelope } } }, ...errorResponses },
});

// ══════════════════════════════════════════════════════════════════════════
// Certificates — LMS (student, own-scope)
// ══════════════════════════════════════════════════════════════════════════

registry.registerPath({
  method: "get",
  path: "/api/v1/me/certificates",
  summary: "List own certificates (student)",
  tags: ["learning", "certificates"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("certificates.view (scope: own)"),
  responses: { 200: { description: "Own certificates.", content: { "application/json": { schema: CertificateListEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/me/certificates/{id}",
  summary: "Get certificate detail (student, own only, IDOR→404)",
  tags: ["learning", "certificates"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("certificates.view (scope: own, IDOR→404 if not own)"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: "Own certificate detail.", content: { "application/json": { schema: CertificateDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/me/certificates/{id}/download",
  summary: "Get signed download URL for own certificate PDF (blocked if revoked/not-issued)",
  description:
    "Returns a short-lived signed GET URL for the certificate PDF (NOT a raw bucket URL, AC-I2). " +
    "Errors: 410 CERTIFICATE_REVOKED if status=revoked (AC-F5), 404 if not issued (AC-F2/F3/F4). " +
    "Permission: certificates.view (scope: own).",
  tags: ["learning", "certificates"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("certificates.view (scope: own). Signed URL only; 410 if revoked; 404 if not issued"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Signed download URL.", content: { "application/json": { schema: CertificateDownloadEnvelope } } },
    ...errorResponses,
  },
});

// ══════════════════════════════════════════════════════════════════════════
// PUBLIC — Certificate verify (unauthenticated, rate-limited)
// ══════════════════════════════════════════════════════════════════════════

registry.registerPath({
  method: "get",
  path: "/api/v1/verify/{certUid}",
  summary: "Publicly verify a certificate by cert_uid (unauthenticated, rate-limited)",
  description:
    "PUBLIC endpoint, no authentication required (AC-H8). " +
    "SECURITY: Server RECOMPUTES the cert_uid HMAC signature before any DB lookup. " +
    "A fabricated or tampered cert_uid fails before the DB is queried (AC-H3/H4). " +
    "Response payload is MINIMAL: { valid, status, program, issuedAt, holderName } only. " +
    "NO internal IDs, NO email, NO phone, NO enrollment data (AC-H7). " +
    "Rate-limited by IP (429 + Retry-After, AC-H6). " +
    "Valid → 200 { valid: true, status: 'valid', ... }. " +
    "Revoked → 200 { valid: 'revoked', status: 'revoked', ... }. " +
    "Invalid/fabricated/nonexistent → 404. " +
    "Permission: certificates.verify (public, no permission check).",
  tags: ["learning", "certificates", "public"],
  // No security — this is explicitly unauthenticated (AC-H8).
  ...requiredPermission("certificates.verify (public, unauthenticated; rate-limited; signature-recomputed)"),
  request: { params: z.object({ certUid: z.string().min(1).describe("The certificate verification uid (cert_uid from the issued certificate).") }) },
  responses: {
    200: { description: "Verification result (valid or revoked).", content: { "application/json": { schema: VerifyResultEnvelope } } },
    404: { description: "Certificate not found, invalid, or tampered cert_uid.", content: { "application/json": { schema: ErrorEnvelope } } },
    429: { description: "Rate limit exceeded.", content: { "application/json": { schema: ErrorEnvelope } } },
  },
});

// ══════════════════════════════════════════════════════════════════════════
// Phase 5 — Public marketing + enrollment funnel surface (Wave 2, task #2)
//
// All endpoints below are either:
//   (a) Fully anonymous (unauthenticated) — public reads + public writes.
//   (b) Self-service authenticated — just-registered student acting on own order.
//
// Security model for all P5 public write endpoints:
//   - CSRF-excluded (separate public controllers, ADR-0019, no session cookie for anon).
//   - Rate-limited per IP (Redis fixed-window — PublicBookingRateLimiter pattern).
//   - Captcha-gated on writes (CaptchaProvider, Noop in dev, fail-closed in prod).
//   - .strict() over-post stripping.
//   - Tenant resolved server-side (never from client).
//   - Input sanitized server-side (resolves P2 M-4).
//
// Self-service endpoints (P-7..P-9) additionally require:
//   - cookieAuth (session issued by POST /public/register).
//   - own-scoped fail-closed: student can only act on their own order (IDOR→404).
//   - Idempotency-Key header on every unsafe mutation.
// ══════════════════════════════════════════════════════════════════════════

// ── P5 component registrations ──────────────────────────────────────────

const PublicProgramSummary = registry.register("PublicProgramSummary", PublicProgramSummarySchema);
const PublicProgramDetail = registry.register("PublicProgramDetail", PublicProgramDetailSchema);
const PublicProgramSummaryListEnvelope = registry.register(
  "PublicProgramSummaryListEnvelope",
  z.object({
    data: z.array(PublicProgramSummary).nullable(),
    meta: z.object({
      nextCursor: z.string().nullable(),
      hasMore: z.boolean(),
    }).nullable(),
    error: ProblemDetails.nullable(),
  }),
);
const PublicProgramDetailEnvelope = envelopeOf("PublicProgramDetail", PublicProgramDetail);

const PublicLeadCaptureDto = registry.register("PublicLeadCaptureDto", PublicLeadCaptureDtoSchema);
const PublicLeadCaptureResponse = registry.register("PublicLeadCaptureResponse", PublicLeadCaptureResponseSchema);
const PublicLeadCaptureEnvelope = envelopeOf("PublicLeadCapture", PublicLeadCaptureResponse);

const PublicValidateCouponDto = registry.register("PublicValidateCouponDto", PublicValidateCouponDtoSchema);
const PublicCouponDiscountResponse = registry.register("PublicCouponDiscountResponse", PublicCouponDiscountResponseSchema);
const PublicCouponDiscountEnvelope = envelopeOf("PublicCouponDiscount", PublicCouponDiscountResponse);

const PublicRegisterDto = registry.register("PublicRegisterDto", PublicRegisterDtoSchema);

const PublicCreateOrderDto = registry.register("PublicCreateOrderDto", PublicCreateOrderDtoSchema);
const PublicOrderResponse = registry.register("PublicOrderResponse", PublicOrderResponseSchema);
const PublicOrderEnvelope = envelopeOf("PublicOrder", PublicOrderResponse);

const PublicCheckoutDto = registry.register("PublicCheckoutDto", PublicCheckoutDtoSchema);
const PublicCheckoutResponse = registry.register("PublicCheckoutResponse", PublicCheckoutResponseSchema);
const PublicCheckoutEnvelope = envelopeOf("PublicCheckout", PublicCheckoutResponse);

const PublicVerifyPaymentDto = registry.register("PublicVerifyPaymentDto", PublicVerifyPaymentDtoSchema);
const PublicVerifyPaymentResponse = registry.register("PublicVerifyPaymentResponse", PublicVerifyPaymentResponseSchema);
const PublicVerifyPaymentEnvelope = envelopeOf("PublicVerifyPayment", PublicVerifyPaymentResponse);

// Auth session envelope reused for POST /public/register response
// (same shape as login — AuthSessionEnvelope is already registered above).

// ── P-1: GET /public/programs ────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/v1/public/programs",
  summary: "List public programs (SEO catalog, published + is_public only)",
  description:
    "Filterable, sortable, cursor-paginated public catalog of published + is_public programs. " +
    "ONLY programs with status=published AND is_public=true are returned (AC-24). " +
    "Response projection: public allowlist only. No status, no is_public flag, no og_image_key, " +
    "no full emi JSON, no tenantId, no draft/internal fields (AC-26). " +
    "The og_image_url is a backend-minted CDN URL (never the raw storage key). " +
    "Rate-limited per IP (429 + Retry-After). CSRF-excluded (anonymous read). " +
    "Permissions: None (anonymous public read).",
  tags: ["public", "programs"],
  // No security — fully anonymous.
  responses: {
    200: { description: "Public program list (cursor-paginated).", content: { "application/json": { schema: PublicProgramSummaryListEnvelope } } },
    ...errorResponses,
  },
});

// ── P-2: GET /public/programs/:slug ─────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/v1/public/programs/{slug}",
  summary: "Get public program detail (full public projection for the detail/conversion page)",
  description:
    "Returns the full public-safe projection for a single program detail page. " +
    "Returns 404 for draft programs (status≠published) or non-public programs " +
    "(is_public=false). AC-25. Response is tightly scoped: " +
    "curriculum outline (module titles + lesson titles + is_preview only, NO content/video), " +
    "mentor bios (public fields only, no userId/email/phone/branchId), " +
    "reviews summary (first name + college only, no email/phone/student_id), " +
    "og_image_url = CDN URL (never raw og_image_key). " +
    "Rate-limited (429 + Retry-After). CSRF-excluded. " +
    "Permissions: None (anonymous public read).",
  tags: ["public", "programs"],
  request: {
    params: z.object({ slug: z.string().min(1).describe("Program SEO slug (programs.slug).") }),
  },
  responses: {
    200: { description: "Public program detail.", content: { "application/json": { schema: PublicProgramDetailEnvelope } } },
    ...errorResponses,
  },
});

// ── P-3: POST /public/leads ──────────────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/v1/public/leads",
  summary: "Public lead capture from site forms (inline/sticky/exit-intent/newsletter/career)",
  description:
    "Creates a CRM lead with stage=new from any public form on the marketing site. " +
    "Captcha-gated (fail-closed in prod, AC-3, AC-44). " +
    "Rate-limited per IP (429 + Retry-After, AC-4). " +
    "CSRF-excluded (anonymous write). " +
    ".strict() over-post stripping. " +
    "Stores DPDP consent JSON on leads.consent column (AC-37). " +
    "Enqueues a confirmation domain event in BullMQ (NOT sent. P6 handles fanout, AC-1). " +
    "UTM + landing_url + referrer + gclid/fbclid stored on the leads row. " +
    "Honeypot field honored at the endpoint layer (AC-42). " +
    "Permissions: None (anonymous public write).",
  tags: ["public", "leads"],
  request: {
    body: { content: { "application/json": { schema: PublicLeadCaptureDto } } },
  },
  responses: {
    201: { description: "Lead captured. Confirmation event enqueued.", content: { "application/json": { schema: PublicLeadCaptureEnvelope } } },
    ...errorResponses,
  },
});

// P-4: POST /public/bookings — REUSED AS-IS (P2, crm/bookings controller).
// Documented in the CRM bookings section above. No new registration here.

// ── P-5: POST /public/coupons/validate ───────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/v1/public/coupons/validate",
  summary: "Public coupon validation. Safe display-only preview (no used counter change)",
  description:
    "Non-mutating coupon preview for the pricing/checkout coupon field. " +
    "Returns discounted paise amounts for display. NEVER leaks coupon internals " +
    "(id, max_uses, used count, program_scope, valid_from/to, status, tenantId, AC-9). " +
    "Invalid/expired/non-existent coupon: 422 with generic message (no existence leak, AC-10). " +
    "Captcha-gated to prevent automated enumeration (AC-11). " +
    "Rate-limited per IP (429 + Retry-After, AC-11). CSRF-excluded. .strict() over-post. " +
    "Permissions: None (anonymous public write).",
  tags: ["public", "commerce"],
  request: {
    body: { content: { "application/json": { schema: PublicValidateCouponDto } } },
  },
  responses: {
    200: { description: "Discount preview, original/discount/final paise + type.", content: { "application/json": { schema: PublicCouponDiscountEnvelope } } },
    ...errorResponses,
  },
});

// ── P-6: POST /public/register ───────────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/v1/public/register",
  summary: "Self-service student registration (argon2id + DPDP consent + OTP verify)",
  description:
    "Creates a users row (role=student) + student_profiles row atomically. " +
    "Issues JWT access + refresh tokens on success (same AuthSessionData shape as login). " +
    "argon2id password hashing. Consent stored on users row. " +
    "OTP verified as part of registration (reuses OtpService). " +
    "Enumeration-resistant: duplicate email returns same HTTP status + generic message (AC-13). " +
    "Captcha-gated (fail-closed, AC-14). " +
    "Rate-limited per IP (429 + Retry-After, AC-15). CSRF-excluded. .strict() over-post. " +
    "On OTP expiry: 422, no users row created. " +
    "Permissions: None (anonymous → creates authenticated session).",
  tags: ["public", "auth"],
  request: {
    body: { content: { "application/json": { schema: PublicRegisterDto } } },
  },
  responses: {
    201: { description: "Registration successful. Access + refresh tokens set in cookies. AuthSessionData in body.", content: { "application/json": { schema: AuthSessionEnvelope } } },
    ...errorResponses,
  },
});

// ── P-7: POST /public/enroll/orders ──────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/v1/public/enroll/orders",
  summary: "Self-service order creation (authenticated student, own-scoped, idempotent)",
  description:
    "Creates a self-service order for the authenticated student. " +
    "studentId is derived from session (never accepted from client). " +
    "Amount computed server-side from program.pricePaise − coupon_discount (AC-21). " +
    "Idempotency: Idempotency-Key header required. Same key → returns existing order (AC-17). " +
    "Own-scoped fail-closed: student can only create orders for themselves (AC-22). " +
    "Auto-selects next available batch for the program (no batchId in public funnel). " +
    "Calls CommerceService.createOrder(). Same idempotency/paise/coupon math as staff endpoint. " +
    "Permissions: Self (own-scoped, authenticated student).",
  tags: ["public", "enroll"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("own-scoped (no RBAC permission key. Student acts on own order only)"),
  request: {
    body: { content: { "application/json": { schema: PublicCreateOrderDto } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    201: { description: "Order created.", content: { "application/json": { schema: PublicOrderEnvelope } } },
    200: { description: "Existing order returned (idempotent replay).", content: { "application/json": { schema: PublicOrderEnvelope } } },
    ...errorResponses,
  },
});

// ── P-8: POST /public/enroll/checkout ────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/v1/public/enroll/checkout",
  summary: "Initiate Razorpay checkout for own order (returns PUBLIC keyId only, never secret)",
  description:
    "Calls CommerceService.initiateRazorpayCheckout() for the authenticated student's own order. " +
    "Own-scoped: orderId must belong to the authenticated student → 404 otherwise (AC-22). " +
    "Response: razorpayOrderId + keyId (PUBLIC key only, NEVER RAZORPAY_KEY_SECRET) + amountPaise + currency. " +
    "Client opens Razorpay checkout.js with these fields. " +
    "Idempotency-Key header required. " +
    "SECURITY: keyId = RAZORPAY_KEY_ID (public). RAZORPAY_KEY_SECRET NEVER in any response (AC-41). " +
    "Permissions: Self (own-scoped, authenticated student).",
  tags: ["public", "enroll"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("own-scoped (student can only checkout their own order, IDOR→404)"),
  request: {
    body: { content: { "application/json": { schema: PublicCheckoutDto } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    200: { description: "Razorpay checkout fields (PUBLIC keyId only, never secret).", content: { "application/json": { schema: PublicCheckoutEnvelope } } },
    ...errorResponses,
  },
});

// ── P-9: POST /public/enroll/verify ──────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/v1/public/enroll/verify",
  summary: "Verify Razorpay payment signature + create enrollment atomically (idempotent)",
  description:
    "Verifies the Razorpay payment using the same CommerceService.verifyPayment() engine as " +
    "the staff /commerce/payments/verify endpoint. " +
    "Own-scoped: razorpay_order_id must map to the authenticated student's order → 404 otherwise (AC-22). " +
    "HMAC-SHA256 signature verified server-side (AC-20. Forged signature → 400, no enrollment). " +
    "Atomic $transaction: payment captured + order paid + enrollment created (ADR-0014). " +
    "Idempotent by provider_payment_id UNIQUE constraint: replay → no double-enrollment (AC-18). " +
    "Response includes lmsRedirectUrl for immediate LMS handoff (AC-23). " +
    "Idempotency-Key header required. " +
    "Permissions: Self (own-scoped, authenticated student).",
  tags: ["public", "enroll"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("own-scoped (student can only verify their own order payment, IDOR→404)"),
  request: {
    body: { content: { "application/json": { schema: PublicVerifyPaymentDto } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    200: { description: "Payment verified. Enrollment created (or already exists. Idempotent). LMS redirect URL included.", content: { "application/json": { schema: PublicVerifyPaymentEnvelope } } },
    ...errorResponses,
  },
});

// ─────────────────────────────────────────────────────────────────────────
// Phase 6, Wave 2 — Engagement contracts (Notifications, Campaigns,
// Gamification, Forum). All routes under /api/v1.
//
// Security model summary:
//   - Own-scope (notifications, gamification, forum.post): cookieAuth + csrfHeader
//     on mutations; user_id ALWAYS from session, never from the request body.
//     IDOR→404 on any cross-user attempt.
//   - CRM-scope (campaigns, forum.moderate): cookieAuth + csrfHeader + Idempotency-Key.
//     campaigns.* permission: Marketing/Admin/Owner (all-scope).
//     forum.moderate: assigned-scope for faculty, all-scope for admin.
//   - Public (unsubscribe): no auth — signed token in URL path (HMAC-verified server-side).
//   - Provider webhooks (POST /campaigns/webhooks/:channel): UNAUTHENTICATED —
//     HMAC-verified via provider verifyWebhookSignature() before any business logic.
// ─────────────────────────────────────────────────────────────────────────

// ── P6 schema imports ─────────────────────────────────────────────────────
import {
  NotificationDtoSchema,
  ListNotificationsQuerySchema,
  MarkReadResponseSchema,
  NotificationPrefsResponseSchema,
  NotificationPrefsDtoSchema,
  NotificationStreamEventSchema,
  UnsubscribeResponseSchema,
} from "../engagement/notifications.schemas.js";
import {
  CampaignDtoSchema,
  CampaignDetailDtoSchema,
  CreateCampaignDtoSchema,
  UpdateCampaignDtoSchema,
  CampaignTemplateDtoSchema,
  CreateCampaignTemplateDtoSchema,
  UpdateCampaignTemplateDtoSchema,
  CampaignRecipientDtoSchema,
  CampaignMetricsDtoSchema,
  ListCampaignsQuerySchema,
  ListCampaignRecipientsQuerySchema,
  ListCampaignTemplatesQuerySchema,
  CampaignWebhookEventDtoSchema,
} from "../engagement/campaigns.schemas.js";
import {
  PointsSummaryDtoSchema,
  BadgeDtoSchema,
  LeaderboardEntryDtoSchema,
  UpdateGamificationPrefsDtoSchema,
} from "../engagement/gamification.schemas.js";
import {
  ThreadDtoSchema,
  CreateThreadDtoSchema,
  PostDtoSchema,
  CreatePostDtoSchema,
  ModerateDtoSchema,
  ModerateResponseSchema,
  VoteResponseSchema,
  ListThreadsQuerySchema,
  ListPostsQuerySchema,
  ListModerationQueueQuerySchema,
} from "../engagement/forum.schemas.js";

// ── P6 component registrations ────────────────────────────────────────────

// Notifications
const NotificationDto = registry.register("NotificationDto", NotificationDtoSchema);
const NotificationDtoEnvelope = envelopeOf("NotificationDto", NotificationDto);
const NotificationListEnvelope = registry.register(
  "NotificationListEnvelope",
  z.object({
    data: z.array(NotificationDtoSchema).nullable(),
    meta: z.object({ nextCursor: z.string().nullable(), hasMore: z.boolean() }).nullable(),
    error: ProblemDetails.nullable(),
  }),
);
const MarkReadResponse = registry.register("MarkReadResponse", MarkReadResponseSchema);
const MarkReadEnvelope = envelopeOf("MarkReadResponse", MarkReadResponse);
const NotificationPrefsResponse = registry.register("NotificationPrefsResponse", NotificationPrefsResponseSchema);
const NotificationPrefsEnvelope = envelopeOf("NotificationPrefsResponse", NotificationPrefsResponse);
const NotificationPrefsDto = registry.register("NotificationPrefsDto", NotificationPrefsDtoSchema);
const UnsubscribeResponse = registry.register("UnsubscribeResponse", UnsubscribeResponseSchema);
const UnsubscribeEnvelope = envelopeOf("UnsubscribeResponse", UnsubscribeResponse);
const NotificationStreamEvent = registry.register("NotificationStreamEvent", NotificationStreamEventSchema);

// Campaigns
const CampaignDto = registry.register("CampaignDto", CampaignDtoSchema);
const CampaignDetailDto = registry.register("CampaignDetailDto", CampaignDetailDtoSchema);
const CampaignDetailEnvelope = envelopeOf("CampaignDetailDto", CampaignDetailDto);
const CampaignListEnvelope = paginatedEnvelopeOf("Campaign", CampaignDto);
const CreateCampaignDto = registry.register("CreateCampaignDto", CreateCampaignDtoSchema);
const UpdateCampaignDto = registry.register("UpdateCampaignDto", UpdateCampaignDtoSchema);
const CampaignTemplateDto = registry.register("CampaignTemplateDto", CampaignTemplateDtoSchema);
const CampaignTemplateDtoEnvelope = envelopeOf("CampaignTemplateDto", CampaignTemplateDto);
const CampaignTemplateListEnvelope = paginatedEnvelopeOf("CampaignTemplate", CampaignTemplateDto);
const CreateCampaignTemplateDto = registry.register("CreateCampaignTemplateDto", CreateCampaignTemplateDtoSchema);
const UpdateCampaignTemplateDto = registry.register("UpdateCampaignTemplateDto", UpdateCampaignTemplateDtoSchema);
const CampaignRecipientDto = registry.register("CampaignRecipientDto", CampaignRecipientDtoSchema);
const CampaignRecipientListEnvelope = paginatedEnvelopeOf("CampaignRecipient", CampaignRecipientDto);
const CampaignMetricsDto = registry.register("CampaignMetricsDto", CampaignMetricsDtoSchema);
const CampaignMetricsEnvelope = envelopeOf("CampaignMetricsDto", CampaignMetricsDto);
const CampaignWebhookEventDto = registry.register("CampaignWebhookEventDto", CampaignWebhookEventDtoSchema);

// Gamification
const PointsSummaryDto = registry.register("PointsSummaryDto", PointsSummaryDtoSchema);
const PointsSummaryEnvelope = envelopeOf("PointsSummaryDto", PointsSummaryDto);
const BadgeDto = registry.register("BadgeDto", BadgeDtoSchema);
const BadgeListEnvelope = paginatedEnvelopeOf("Badge", BadgeDto);
const LeaderboardEntryDto = registry.register("LeaderboardEntryDto", LeaderboardEntryDtoSchema);
const LeaderboardEnvelope = registry.register(
  "LeaderboardEnvelope",
  z.object({
    data: z.array(LeaderboardEntryDtoSchema).nullable(),
    meta: z.object({ total: z.number().int().min(0), ttlSeconds: z.number().int().min(0) }).nullable(),
    error: ProblemDetails.nullable(),
  }),
);
const UpdateGamificationPrefsDto = registry.register("UpdateGamificationPrefsDto", UpdateGamificationPrefsDtoSchema);

// Forum
const ThreadDto = registry.register("ThreadDto", ThreadDtoSchema);
const ThreadListEnvelope = registry.register(
  "ThreadListEnvelope",
  z.object({
    data: z.array(ThreadDtoSchema).nullable(),
    meta: z.object({ nextCursor: z.string().nullable(), hasMore: z.boolean() }).nullable(),
    error: ProblemDetails.nullable(),
  }),
);
const ThreadEnvelope = envelopeOf("ThreadDto", ThreadDto);
const PostDto = registry.register("PostDto", PostDtoSchema);
const PostListEnvelope = paginatedEnvelopeOf("Post", PostDto);
const PostEnvelope = envelopeOf("PostDto", PostDto);
const CreateThreadDto = registry.register("CreateThreadDto", CreateThreadDtoSchema);
const CreatePostDto = registry.register("CreatePostDto", CreatePostDtoSchema);
const ModerateDto = registry.register("ModerateDto", ModerateDtoSchema);
const ModerateResponse = registry.register("ModerateResponse", ModerateResponseSchema);
const ModerateEnvelope = envelopeOf("ModerateResponse", ModerateResponse);
const VoteResponse = registry.register("VoteResponse", VoteResponseSchema);
const VoteEnvelope = envelopeOf("VoteResponse", VoteResponse);

// ── P6 Notifications endpoints ────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/v1/me/notifications",
  summary: "List own notifications (in-app center + polling fallback for SSE)",
  description:
    "Returns the authenticated user's own notifications, cursor-paginated. " +
    "Use `unread=true` for the SSE polling fallback (LOCK-D3): the LMS client calls this " +
    "when SSE is unavailable to update the unread badge count. " +
    "IDOR: returns ONLY the authenticated user's notifications (AC-5, AC-72). " +
    "Cross-tenant filter applied before RBAC (AC-72). " +
    "Permissions: notifications.view (own, all authenticated users).",
  tags: ["notifications", "me"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("notifications.view (own. IDOR→404 for any other user's notifications)"),
  responses: {
    200: { description: "Notification list page.", content: { "application/json": { schema: NotificationListEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/me/notifications/stream",
  summary: "SSE stream for real-time notification delivery (authenticated, own-scoped)",
  description:
    "Server-Sent-Events endpoint. Response Content-Type: text/event-stream. " +
    "Emits NotificationStreamEvent on new notifications for the authenticated user ONLY. " +
    "Authentication checked BEFORE opening the stream: 401 if no valid JWT (AC-15). " +
    "Own-scoped: cross-user notifications NEVER appear on this stream (AC-14). " +
    "The X-Accel-Buffering: no header is set on the response (SSE-over-proxy compatibility). " +
    "LOCK-D3: LMS falls back to polling GET /me/notifications?unread=true when SSE unavailable. " +
    "Permissions: notifications.view (own).",
  tags: ["notifications", "me", "sse"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("notifications.view (own. SSE stream scoped to authenticated user only)"),
  responses: {
    200: {
      description: "SSE stream opened. Events of type NotificationStreamEvent emitted on new notifications.",
      content: { "text/event-stream": { schema: NotificationStreamEvent } },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/me/notifications/{id}/read",
  summary: "Mark a single notification as read",
  description:
    "Sets notifications.read_at = now() for the given notification. " +
    "Own-scope: the notification MUST belong to the authenticated user (IDOR→404, AC-5). " +
    "Idempotent: marking an already-read notification is a no-op (200). " +
    "Returns the updated unread count for badge update without a re-fetch. " +
    "Idempotency-Key header required. " +
    "Permissions: notifications.view (own).",
  tags: ["notifications", "me"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("notifications.view (own. IDOR→404 if notification belongs to another user)"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    headers: idempotencyKeyHeader,
  },
  responses: {
    200: { description: "Notification marked read. Returns updated unread count.", content: { "application/json": { schema: MarkReadEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/me/notifications/read-all",
  summary: "Mark all own notifications as read",
  description:
    "Batch UPDATE: sets read_at = now() for all unread notifications belonging to the " +
    "authenticated user. Scoped to user_id = currentUser.id, no cross-user effect. " +
    "Executes as a single UPDATE statement (no N+1, AC: 500+ notifications edge case). " +
    "Idempotency-Key header required. " +
    "Permissions: notifications.view (own).",
  tags: ["notifications", "me"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("notifications.view (own. Batch mark-all-read on own notifications only)"),
  request: { headers: idempotencyKeyHeader },
  responses: {
    200: { description: "All notifications marked read. Returns unreadCount=0.", content: { "application/json": { schema: MarkReadEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/me/notification-prefs",
  summary: "Get own notification preferences (type×channel matrix + quiet hours)",
  description:
    "Returns the authenticated user's notification_prefs row. " +
    "If no row exists, system defaults are returned (NOT a 404, AC-18). " +
    "Includes leaderboard opt-in + display name prefs (LOCK-D5). " +
    "Permissions: notification_prefs.edit (own).",
  tags: ["notifications", "me"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("notification_prefs.edit (own. Returns defaults if no row)"),
  responses: {
    200: { description: "Notification preferences (defaults if no row set).", content: { "application/json": { schema: NotificationPrefsEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "put",
  path: "/api/v1/me/notification-prefs",
  summary: "Update own notification preferences (upsert, partial update supported)",
  description:
    "Upserts the notification_prefs row for the authenticated user. " +
    "Partial update: only supplied matrix keys are updated; absent keys retain defaults. " +
    "userId is ALWAYS derived from session. Never trusted from the request body (AC-20). " +
    "Writes an audit-log entry with before/after (AC-19). " +
    "Idempotency-Key header required. " +
    "Permissions: notification_prefs.edit (own).",
  tags: ["notifications", "me"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("notification_prefs.edit (own. UserId from session, not body, AC-20)"),
  request: {
    body: { content: { "application/json": { schema: NotificationPrefsDto } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    200: { description: "Preferences upserted. Returns updated prefs.", content: { "application/json": { schema: NotificationPrefsEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/unsubscribe/{token}",
  summary: "Preview unsubscribe (public. No auth, renders confirmation page)",
  description:
    "Public endpoint, no authentication required (AC-22). " +
    "Validates the signed HMAC token (NOTIFICATION_SIGNING_SECRET). " +
    "Returns 200 with the channel that will be unsubscribed (for the confirmation UI). " +
    "Returns 400 INVALID_TOKEN if the token is tampered (AC-24). " +
    "The token MUST NOT be directly decodable to user_id or email (AC-77). " +
    "Permissions: none (public, signed token is the authentication).",
  tags: ["notifications", "public"],
  responses: {
    200: { description: "Token valid, returns confirmation info.", content: { "application/json": { schema: UnsubscribeEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/unsubscribe/{token}",
  summary: "Submit unsubscribe (public. No auth, DPDP/India compliance)",
  description:
    "Public endpoint, no authentication required (AC-22). " +
    "Validates the HMAC token and creates a notification_suppressions row for the user+channel. " +
    "After this, ALL notification fan-outs and campaign sends to this user on this channel " +
    "are suppressed (Rule C-2, AC-23). " +
    "Returns 400 INVALID_TOKEN on tampered token (AC-24). " +
    "Idempotent: double-unsubscribe is a no-op (200). " +
    "Permissions: none (public, signed token is authentication).",
  tags: ["notifications", "public"],
  request: {
    params: z.object({ token: z.string().min(1) }),
  },
  responses: {
    200: { description: "Unsubscribed. Suppression row created.", content: { "application/json": { schema: UnsubscribeEnvelope } } },
    ...errorResponses,
  },
});

// ── P6 Campaigns endpoints ────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/v1/campaigns/templates",
  summary: "List campaign templates",
  description:
    "Returns paginated list of campaign templates for the tenant. " +
    "Filter by channel. " +
    "Permissions: campaigns.view (all-scope, Marketing/Admin/Owner).",
  tags: ["campaigns"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("campaigns.view (all-scope: Marketing/Admin/Owner)"),
  responses: {
    200: { description: "Campaign template list.", content: { "application/json": { schema: CampaignTemplateListEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/campaigns/templates",
  summary: "Create a campaign template (DLT template id required for sms/whatsapp, AC-78)",
  description:
    "Creates a campaign template. " +
    "LOCK-D4 / AC-78: For channel='sms' or channel='whatsapp', dlt_template_id MUST be " +
    "a non-empty string (India DLT compliance). A missing or empty dlt_template_id for " +
    "SMS/WhatsApp returns 422 DLT_TEMPLATE_ID_REQUIRED. " +
    "For channel='email': dlt_template_id is optional (AC-32). " +
    "Idempotency-Key header required. " +
    "Permissions: campaigns.create (Marketing/Admin/Owner).",
  tags: ["campaigns"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("campaigns.create (Marketing/Admin/Owner. LOCK-D4: dlt_template_id required for sms/whatsapp)"),
  request: {
    body: { content: { "application/json": { schema: CreateCampaignTemplateDto } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    201: { description: "Template created.", content: { "application/json": { schema: CampaignTemplateDtoEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/campaigns/templates/{id}",
  summary: "Get a campaign template",
  tags: ["campaigns"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("campaigns.view"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Template detail.", content: { "application/json": { schema: CampaignTemplateDtoEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/campaigns/templates/{id}",
  summary: "Update a campaign template",
  description:
    "Updates a campaign template. " +
    "Defense-in-depth: the service re-validates dlt_template_id presence for sms/whatsapp on update " +
    "(LOCK-D4). A cleared dlt_template_id on sms/whatsapp template → 422. " +
    "Idempotency-Key header required. " +
    "Permissions: campaigns.edit.",
  tags: ["campaigns"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("campaigns.edit (Marketing/Admin/Owner)"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: UpdateCampaignTemplateDto } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    200: { description: "Template updated.", content: { "application/json": { schema: CampaignTemplateDtoEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/campaigns/templates/{id}",
  summary: "Soft-delete a campaign template",
  tags: ["campaigns"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("campaigns.delete"),
  request: { params: z.object({ id: z.string().uuid() }), headers: idempotencyKeyHeader },
  responses: {
    200: { description: "Template soft-deleted.", content: { "application/json": { schema: CampaignTemplateDtoEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/campaigns",
  summary: "List campaigns (CRM Marketing view)",
  description:
    "Returns paginated list of campaigns for the tenant. " +
    "Filter by status and channel. " +
    "Permissions: campaigns.view (all-scope).",
  tags: ["campaigns"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("campaigns.view (all-scope: Marketing/Admin/Owner)"),
  responses: {
    200: { description: "Campaign list.", content: { "application/json": { schema: CampaignListEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/campaigns",
  summary: "Create a campaign (draft)",
  description:
    "Creates a campaign in 'draft' status. The segment is stored as JSON; recipients are " +
    "materialized at send time (not at create time). " +
    "Idempotency-Key header required. " +
    "Permissions: campaigns.create (Marketing/Admin/Owner).",
  tags: ["campaigns"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("campaigns.create (Marketing/Admin/Owner)"),
  request: {
    body: { content: { "application/json": { schema: CreateCampaignDto } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    201: { description: "Campaign created (draft).", content: { "application/json": { schema: CampaignDetailEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/campaigns/{id}",
  summary: "Get campaign detail (incl. template + segment)",
  tags: ["campaigns"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("campaigns.view"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Campaign detail.", content: { "application/json": { schema: CampaignDetailEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/campaigns/{id}",
  summary: "Update a draft campaign",
  description:
    "Only campaigns in 'draft' or 'scheduled' status can be updated. " +
    "Idempotency-Key header required. Permissions: campaigns.edit.",
  tags: ["campaigns"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("campaigns.edit (Marketing/Admin/Owner)"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: UpdateCampaignDto } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    200: { description: "Campaign updated.", content: { "application/json": { schema: CampaignDetailEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/campaigns/{id}",
  summary: "Soft-delete a campaign",
  tags: ["campaigns"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("campaigns.delete"),
  request: { params: z.object({ id: z.string().uuid() }), headers: idempotencyKeyHeader },
  responses: {
    200: { description: "Campaign soft-deleted.", content: { "application/json": { schema: CampaignDetailEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/campaigns/{id}/send",
  summary: "Trigger campaign send (materialize segment + dispatch, idempotent per-recipient)",
  description:
    "Materializes the segment into campaign_recipients (skipping non-consented/suppressed, AC-29, AC-30), " +
    "then dispatches via CampaignSendPort (sync-seam by default, LOCK-D1). " +
    "LOCK-D4: Rejects if template.dlt_template_id is null for sms/whatsapp (AC-31). " +
    "Idempotent per-recipient: (campaign_id, recipient) partial-unique. Double-send = no-op (AC-27, AC-28). " +
    "Empty segment = status 'sent', metrics.sent=0, no error (AC-34). " +
    "Permissions: campaigns.send (Marketing/Admin/Owner).",
  tags: ["campaigns"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("campaigns.send (Marketing/Admin/Owner, ALL-scope; non-consented/suppressed skipped)"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    headers: idempotencyKeyHeader,
  },
  responses: {
    200: { description: "Campaign send initiated.", content: { "application/json": { schema: CampaignDetailEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/campaigns/{id}/pause",
  summary: "Pause a sending campaign",
  description:
    "Transitions campaign from 'sending' to 'paused'. Halts dispatch for remaining queued " +
    "recipients; already-sent recipients are unaffected (AC-35). " +
    "Permissions: campaigns.send.",
  tags: ["campaigns"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("campaigns.send"),
  request: { params: z.object({ id: z.string().uuid() }), headers: idempotencyKeyHeader },
  responses: {
    200: { description: "Campaign paused.", content: { "application/json": { schema: CampaignDetailEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/campaigns/{id}/cancel",
  summary: "Cancel a scheduled or paused campaign",
  description:
    "Transitions campaign to 'cancelled'. All 'queued' recipients → 'failed' with error='campaign_cancelled'. " +
    "Audit-log entry written (AC-36). " +
    "Permissions: campaigns.send.",
  tags: ["campaigns"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("campaigns.send (Marketing/Admin/Owner)"),
  request: { params: z.object({ id: z.string().uuid() }), headers: idempotencyKeyHeader },
  responses: {
    200: { description: "Campaign cancelled.", content: { "application/json": { schema: CampaignDetailEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/campaigns/{id}/recipients",
  summary: "List campaign recipients with per-recipient delivery status",
  description:
    "Returns paginated recipient rows with delivery status for the CRM metrics view. " +
    "Filter by status. " +
    "Permissions: campaigns.view.",
  tags: ["campaigns"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("campaigns.view (Marketing/Admin/Owner)"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Recipient list page.", content: { "application/json": { schema: CampaignRecipientListEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/campaigns/{id}/metrics",
  summary: "Get aggregate campaign metrics (sent/delivered/read/failed counts)",
  description:
    "Returns the campaigns.metrics JSON aggregate for the CRM metrics card. " +
    "Updated in real time as provider webhooks arrive (AC-37). " +
    "Permissions: campaigns.view.",
  tags: ["campaigns"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("campaigns.view"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Campaign metrics.", content: { "application/json": { schema: CampaignMetricsEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/campaigns/webhooks/{channel}",
  summary: "Provider delivery/read webhook receiver (UNAUTHENTICATED, HMAC-verified)",
  description:
    "UNAUTHENTICATED endpoint. Mail or WhatsApp provider posts delivery/read/bounce/complaint events. " +
    "Authentication: HMAC signature verified via provider.verifyWebhookSignature() BEFORE any DB access (AC-39). " +
    "Forged webhook → 401 (fail-closed). " +
    "Idempotent: duplicate event for the same provider_message_id is a no-op (AC-38). " +
    "Unknown provider_message_id: 200 + discard (race safety, AC-40). " +
    "On bounce: adds recipient to notification_suppressions (reason='bounce'). " +
    "Updates campaign_recipients.status + campaigns.metrics. " +
    "Permissions: none (unauthenticated, HMAC is the authentication).",
  tags: ["campaigns", "webhooks"],
  request: {
    params: z.object({ channel: z.enum(["email", "whatsapp", "sms"]) }),
    body: { content: { "application/json": { schema: CampaignWebhookEventDto } } },
  },
  responses: {
    200: { description: "Webhook processed (or safely discarded).", content: { "application/json": { schema: envelopeOf("WebhookAck", z.object({ received: z.boolean() })) } } },
    ...errorResponses,
  },
});

// ── P6 Gamification endpoints ─────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/v1/me/gamification",
  summary: "Get own gamification summary (points, badges, streak)",
  description:
    "Returns totalPoints (SUM of points_ledger.delta), earned badges, and streak state for the " +
    "authenticated user (AC-49). " +
    "Own-scope: data is filtered on user_id = currentUser.id. " +
    "Student T's data MUST NOT appear in Student S's response. " +
    "Permissions: gamification.view (own).",
  tags: ["gamification", "me"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("gamification.view (own, ledger/badges filtered to currentUser.id)"),
  responses: {
    200: { description: "Gamification summary.", content: { "application/json": { schema: PointsSummaryEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "put",
  path: "/api/v1/me/gamification/prefs",
  summary: "Update leaderboard opt-in + display name (own-scope)",
  description:
    "Updates the leaderboard_opt_in flag and display name for the authenticated user. " +
    "Setting opt-in=false removes the student from the leaderboard within the cache TTL (AC-51). " +
    "Own-scope: userId from session, never from request body. " +
    "Idempotency-Key header required. " +
    "Permissions: gamification.prefs.edit (own).",
  tags: ["gamification", "me"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("gamification.prefs.edit (own)"),
  request: {
    body: { content: { "application/json": { schema: UpdateGamificationPrefsDto } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    200: { description: "Leaderboard prefs updated.", content: { "application/json": { schema: PointsSummaryEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/batches/{id}/leaderboard",
  summary: "Get batch leaderboard (opt-in students, alias only, PII-minimal, enrollment-scoped)",
  description:
    "Returns the leaderboard for the specified batch. " +
    "LOCK-D5 / AC-50: Only includes students with leaderboard_opt_in=true. " +
    "Response entries contain ONLY { rank, displayName, totalPoints, badgeCount }, " +
    "NO email, phone, enrollmentId, studentId, userId, or any PII. " +
    "Enrollment-scoped IDOR: a non-enrolled student gets 404 (AC-52). " +
    "Cache-aside with TTL (default 60 s); opt-out takes effect within TTL (AC-51). " +
    "Permissions: gamification.view (own. Enrollment-scoped for students; all for admin/faculty).",
  tags: ["gamification", "batches"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("gamification.view (enrollment-scoped: non-enrolled → 404; LOCK-D5: no PII beyond displayName)"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Leaderboard. Opt-in students only, alias/displayName, no PII.", content: { "application/json": { schema: LeaderboardEnvelope } } },
    ...errorResponses,
  },
});

// ── P6 Forum endpoints ────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/v1/forum/threads",
  summary: "List forum threads (enrollment-scoped for students, assigned-scoped for faculty)",
  description:
    "Returns threads for a batch or program. " +
    "Enrollment-scoped IDOR: a non-enrolled student gets 404 for any non-enrolled batch (AC-55). " +
    "Faculty: assigned-scope (only batches assigned to them). " +
    "Admin: all-scope. " +
    "batchId query param is used for enrollment verification. " +
    "Permissions: forum.read (enrolled | assigned | branch | all).",
  tags: ["forum"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("forum.read (enrolled scope for students. IDOR→404 for non-enrolled batches; AC-55)"),
  responses: {
    200: { description: "Thread list (cursor-paginated).", content: { "application/json": { schema: ThreadListEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/forum/threads",
  summary: "Create a forum thread (enrollment-scoped. Student must be enrolled in the batch)",
  description:
    "Creates a new forum thread. The atomically-created opening post uses the `body` field. " +
    "IDOR / enrollment check: the student MUST be enrolled in the batchId → 404 if not (AC-56). " +
    "Non-enrolled attempt: 404 (IDOR-safe. Batch existence not revealed to non-enrolled, AC-56). " +
    "Body max 10,000 chars (AC-71). " +
    "Idempotency-Key header required. " +
    "Permissions: forum.post (enrolled scope).",
  tags: ["forum"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("forum.post (enrolled scope. Student MUST be enrolled in batchId; IDOR→404 if not, AC-56)"),
  request: {
    body: { content: { "application/json": { schema: CreateThreadDto } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    201: { description: "Thread created.", content: { "application/json": { schema: ThreadEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/forum/threads/{id}",
  summary: "Get a forum thread detail",
  description:
    "Returns thread detail. Enrollment-scope check applied (AC-55). " +
    "Permissions: forum.read (enrolled scope).",
  tags: ["forum"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("forum.read (enrolled scope, IDOR→404 for non-enrolled)"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Thread detail.", content: { "application/json": { schema: ThreadEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/forum/threads/{id}/posts",
  summary: "List posts in a forum thread (paginated, with nested replies support)",
  description:
    "Returns posts in the specified thread, paginated. Enrollment-scope check applied. " +
    "Thread with 0 posts returns data=[], meta.total=0 (not 404, AC-54 analogue). " +
    "Permissions: forum.read (enrolled scope).",
  tags: ["forum"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("forum.read (enrolled scope)"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Post list (offset-paginated).", content: { "application/json": { schema: PostListEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/forum/threads/{id}/posts",
  summary: "Create a post or nested reply in a forum thread",
  description:
    "Creates a new post in the thread. `parentId` for nested reply (AC-59). " +
    "Enrollment-scope: student must be enrolled in the thread's batch (AC-58, AC-59). " +
    "Reply notifies thread author via NotificationService (AC-60). " +
    "Body max 10,000 chars (AC-71). " +
    "Idempotency-Key header required. " +
    "Permissions: forum.post (enrolled scope).",
  tags: ["forum"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("forum.post (enrolled scope. IDOR→404 for non-enrolled; AC-58, AC-59)"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: CreatePostDto } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    201: { description: "Post created.", content: { "application/json": { schema: PostEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/forum/posts/{id}/vote",
  summary: "Toggle upvote on a post (deduped. One vote per user per post)",
  description:
    "Toggles the authenticated user's upvote on the post. " +
    "Second call from the same user removes the vote (toggle off, AC-61). " +
    "Self-vote prevention: voting on own post → 422 CANNOT_VOTE_OWN_POST (AC-62). " +
    "Concurrent votes from different users: exactly N rows created, no duplicates (AC-63). " +
    "Enrollment-scope check applied. " +
    "Idempotency-Key header required. " +
    "Permissions: forum.post (enrolled scope, same as posting).",
  tags: ["forum"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("forum.post (enrolled scope. Self-vote: 422 CANNOT_VOTE_OWN_POST; AC-61, AC-62)"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    headers: idempotencyKeyHeader,
  },
  responses: {
    200: { description: "Vote toggled. Returns updated upvote count + hasVoted.", content: { "application/json": { schema: VoteEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/forum/threads/{id}/resolve",
  summary: "Mark a thread as resolved (thread author or moderator)",
  description:
    "Sets thread.status='resolved' and optionally sets resolved_post_id. " +
    "Enrollment-scope: only the thread author or a moderator can resolve. " +
    "Idempotency-Key header required. " +
    "Permissions: forum.post (author of thread) or forum.moderate.",
  tags: ["forum"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("forum.post (own thread) or forum.moderate (assigned/all)"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: ModerateDto } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    200: { description: "Thread resolved.", content: { "application/json": { schema: ThreadEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/forum/threads/{id}/moderate",
  summary: "Moderate a forum thread (faculty/admin, hide/pin/unpin/delete)",
  description:
    "Moderation actions on a thread (hide/unhide/pin/unpin/delete). " +
    "Assigned-scope for faculty: only batches assigned to the faculty (AC-64). " +
    "All-scope for admin (AC-67). " +
    "Student with no forum.moderate permission → 403 (AC-68). " +
    "Every action is audit-logged with actor + before/after (AC-65, AC-66). " +
    "Soft-delete: 'delete' sets deleted_at; thread disappears from student lists (AC-69). " +
    "Idempotency-Key header required. " +
    "Permissions: forum.moderate (assigned-scope faculty / all-scope admin).",
  tags: ["forum", "moderation"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("forum.moderate (assigned-scope: faculty sees only assigned batches, IDOR→404, AC-64; all: admin/owner)"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: ModerateDto } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    200: { description: "Thread moderated.", content: { "application/json": { schema: ModerateEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/forum/posts/{id}/moderate",
  summary: "Moderate a forum post (faculty/admin, hide/unhide/delete)",
  description:
    "Moderation actions on a post (hide/unhide/delete). " +
    "Assigned-scope for faculty (AC-64, AC-65). All-scope for admin (AC-67). " +
    "hide action REQUIRES 'reason' in body (stored as hidden_reason, AC-65). " +
    "Soft-delete: 'delete' sets deleted_at; post disappears from student lists (AC-69). " +
    "Every action is audit-logged. " +
    "Idempotency-Key header required. " +
    "Permissions: forum.moderate.",
  tags: ["forum", "moderation"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("forum.moderate (assigned-scope faculty / all-scope admin, AC-64, AC-65, AC-68)"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: ModerateDto } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    200: { description: "Post moderated.", content: { "application/json": { schema: ModerateEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/forum/moderation",
  summary: "CRM moderation queue. Reported/hidden posts in assigned batches",
  description:
    "Returns a list of posts requiring moderation review (hidden, reported). " +
    "Assigned-scope for faculty (only batches assigned to them). " +
    "All-scope for admin. " +
    "Used by the CRM forum moderation view (docs/plans/phase-6.md task #11). " +
    "Permissions: forum.moderate.",
  tags: ["forum", "moderation", "crm"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("forum.moderate (assigned-scope faculty / all admin)"),
  responses: {
    200: { description: "Moderation queue (paginated).", content: { "application/json": { schema: PostListEnvelope } } },
    ...errorResponses,
  },
});

// ─────────────────────────────────────────────────────────────────────────
// Phase 7, Wave 1 — Analytics + Hardening API contracts
// (docs/plans/phase-7.md task #4, docs/specs/phase-7-analytics-hardening.md).
//
// WS-A: 8 KPI dashboards under GET /api/v1/crm/reports/* — every response is
// materialized-view-backed (LOCK-D1) and carries `asOf`/`stale` freshness.
// WS-B: on-demand CSV/PDF exports (POST /api/v1/crm/exports, scope-mirrored
// params per Rule H-2), export-job polling/history, and scheduled report
// emails (POST/GET/PATCH /api/v1/crm/reports/schedules).
// WS-C: GET /api/v1/health (liveness) + GET /api/v1/health/ready (readiness)
// — PUBLIC, unauthenticated (AC-49: still rate-limited), leak-safe by
// construction (Rule H-3 — see common/health.schemas.ts compile-time assertion).
// ─────────────────────────────────────────────────────────────────────────

import {
  RevenueReportQuerySchema,
  RevenueReportDtoSchema,
  EnrollmentTrendQuerySchema,
  EnrollmentTrendDtoSchema,
  FunnelReportQuerySchema,
  FunnelReportDtoSchema,
  EngagementReportQuerySchema,
  EngagementReportDtoSchema,
  CampaignPerformanceQuerySchema,
  CampaignPerformanceDtoSchema,
  GamificationParticipationQuerySchema,
  GamificationParticipationDtoSchema,
  ForumHealthReportQuerySchema,
  ForumHealthReportDtoSchema,
} from "../crm/reports.schemas.js";
import {
  CreateExportRequestDtoSchema,
  ExportJobDtoSchema,
  ListExportJobsQuerySchema,
  CreateReportScheduleDtoSchema,
  UpdateReportScheduleDtoSchema,
  ReportScheduleDtoSchema,
  ListReportSchedulesQuerySchema,
} from "../crm/exports.schemas.js";
import { LivenessResponseSchema, ReadinessResponseSchema } from "../common/health.schemas.js";

// ---- WS-A: KPI dashboard reports ----

const RevenueReport = registry.register("RevenueReportDto", RevenueReportDtoSchema);
const RevenueReportEnvelope = envelopeOf("RevenueReport", RevenueReport);
const EnrollmentTrendReport = registry.register("EnrollmentTrendDto", EnrollmentTrendDtoSchema);
const EnrollmentTrendEnvelope = envelopeOf("EnrollmentTrendReport", EnrollmentTrendReport);
const FunnelReport = registry.register("FunnelReportDto", FunnelReportDtoSchema);
const FunnelReportEnvelope = envelopeOf("FunnelReport", FunnelReport);
const EngagementReport = registry.register("EngagementReportDto", EngagementReportDtoSchema);
const EngagementReportEnvelope = envelopeOf("EngagementReport", EngagementReport);
const CampaignPerformanceReport = registry.register("CampaignPerformanceDto", CampaignPerformanceDtoSchema);
const CampaignPerformanceEnvelope = envelopeOf("CampaignPerformanceReport", CampaignPerformanceReport);
const GamificationParticipationReport = registry.register(
  "GamificationParticipationDto",
  GamificationParticipationDtoSchema,
);
const GamificationParticipationEnvelope = envelopeOf(
  "GamificationParticipationReport",
  GamificationParticipationReport,
);
const ForumHealthReport = registry.register("ForumHealthReportDto", ForumHealthReportDtoSchema);
const ForumHealthReportEnvelope = envelopeOf("ForumHealthReport", ForumHealthReport);

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/reports/revenue",
  summary: "Revenue dashboard. Reconciles exactly with the payments ledger",
  description:
    "AC-1 (HEADLINE): totalPaise = SUM(payments.amount_paise) WHERE status='captured' AND " +
    "paid_at BETWEEN [from,to] AND tenant_id=T. Branch-scoped for Branch Manager (AC-2); " +
    "tenant-isolated at the repository/MV query level, never post-filtered (AC-3). " +
    "from>to returns 422 INVALID_DATE_RANGE before any query runs (AC-4). Zero data in " +
    "range is a valid 200 (AC-5), never 404/500. Materialized-view-backed (LOCK-D1), " +
    "response carries asOf/stale freshness.",
  tags: ["crm", "reports"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("reports.revenue.view (scope: all|branch per docs/specs/phase-7-analytics-hardening.md Part 8)"),
  request: { query: RevenueReportQuerySchema },
  responses: {
    200: { description: "Revenue report.", content: { "application/json": { schema: RevenueReportEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/reports/enrollments",
  summary: "Enrollment trend dashboard",
  description:
    "AC-7: per-period counts = COUNT(enrollments) WHERE enrolled_at BETWEEN range grouped by " +
    "the echoed-back granularity. AC-8: branch-scoped for Branch Manager, assigned-scoped for " +
    "Faculty. AC-9: a zero-enrollment bucket is present with value 0, never omitted.",
  tags: ["crm", "reports"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("reports.enrollment.view (scope: all|branch|assigned)"),
  request: { query: EnrollmentTrendQuerySchema },
  responses: {
    200: { description: "Enrollment trend.", content: { "application/json": { schema: EnrollmentTrendEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/reports/funnel",
  summary: "Lead funnel / conversion dashboard",
  description:
    "AC-10: per-stage counts + conversionRate (won/total) reconcile with the leads table. " +
    "AC-11: own-scoped for Counsellor (owner_id = current user). AC-12: branch-scoped for " +
    "Branch Manager. AC-13: tenant-isolated (cross-tenant IDOR-safe).",
  tags: ["crm", "reports"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("reports.funnel.view (scope: all|branch|own)"),
  request: { query: FunnelReportQuerySchema },
  responses: {
    200: { description: "Funnel report.", content: { "application/json": { schema: FunnelReportEnvelope } } },
    ...errorResponses,
  },
});


registry.registerPath({
  method: "get",
  path: "/api/v1/crm/reports/engagement",
  summary: "Course / video engagement dashboard",
  description:
    "AC-17: per-lesson completion % = COUNT(status='completed')/COUNT(enrolled students). " +
    "AC-18: lessons returned in curriculum order; dropOffLessonId names the first lesson " +
    "crossing the configured drop-off threshold (null if none). AC-19: assigned-scoped for " +
    "Faculty (batchId required), all-scoped for Admin (batchId optional).",
  tags: ["crm", "reports"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("reports.engagement.view (scope: all|branch|assigned)"),
  request: { query: EngagementReportQuerySchema },
  responses: {
    200: { description: "Engagement report.", content: { "application/json": { schema: EngagementReportEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/reports/campaigns",
  summary: "Campaign performance dashboard",
  description:
    "AC-20: sent/delivered/read/failed counts equal COUNT(campaign_recipients) GROUP BY status " +
    "matching campaigns.metrics EXACTLY (no drift), reuses CampaignMetricsDto verbatim " +
    "(@repo/types engagement/campaigns.schemas.ts). AC-21: marketing/admin-scoped (403 otherwise). " +
    "AC-22: unknown/cross-tenant campaignId returns 404, not a cross-tenant 403.",
  tags: ["crm", "reports"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("reports.campaigns.view (all-scope; reuses campaigns.view)"),
  request: { query: CampaignPerformanceQuerySchema },
  responses: {
    200: { description: "Campaign performance report.", content: { "application/json": { schema: CampaignPerformanceEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/reports/gamification",
  summary: "Gamification participation dashboard (staff-facing. Real names/emails MAY appear, AC-24)",
  description:
    "AC-23: activeEarnersCount/totalXpDistributed/badgeAwardCount reconcile with " +
    "points_ledger/user_badges for the batch's enrolled students. AC-24: staff-facing view, " +
    "unlike the PII-minimal student leaderboard, this MAY show real names/emails to authorized " +
    "staff; a Faculty member not assigned to the batch still gets 404. AC-25: opted-out students " +
    "ARE included in aggregates and the perStudent breakdown (opt-out only affects the public leaderboard).",
  tags: ["crm", "reports"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("reports.gamification.view (scope: all|assigned)"),
  request: { query: GamificationParticipationQuerySchema },
  responses: {
    200: { description: "Gamification participation report.", content: { "application/json": { schema: GamificationParticipationEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/reports/forum-health",
  summary: "Forum health dashboard",
  description:
    "AC-26: threadCount/postCount/replyRate/resolutionRate reconcile with " +
    "forum_threads/forum_posts for the batch. AC-27: assigned-scoped for Faculty (404 for an " +
    "unassigned batch), all-scoped for Admin.",
  tags: ["crm", "reports"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("reports.forum.view (scope: all|assigned)"),
  request: { query: ForumHealthReportQuerySchema },
  responses: {
    200: { description: "Forum health report.", content: { "application/json": { schema: ForumHealthReportEnvelope } } },
    ...errorResponses,
  },
});

// ---- WS-B: Reports + Exports ----

const CreateExportRequest = registry.register("CreateExportRequestDto", CreateExportRequestDtoSchema);
const ExportJob = registry.register("ExportJobDto", ExportJobDtoSchema);
const ExportJobEnvelope = envelopeOf("ExportJob", ExportJob);
const ExportJobListEnvelope = paginatedEnvelopeOf("ExportJob", ExportJob);
const CreateReportSchedule = registry.register("CreateReportScheduleDto", CreateReportScheduleDtoSchema);
const UpdateReportSchedule = registry.register("UpdateReportScheduleDto", UpdateReportScheduleDtoSchema);
const ReportSchedule = registry.register("ReportScheduleDto", ReportScheduleDtoSchema);
const ReportScheduleEnvelope = envelopeOf("ReportSchedule", ReportSchedule);
const ReportScheduleListEnvelope = paginatedEnvelopeOf("ReportSchedule", ReportSchedule);

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/exports",
  summary: "Trigger an on-demand CSV/PDF export",
  description:
    "AC-30/31/32/Rule H-2: `params` is the SAME query shape as the on-screen equivalent view, " +
    "structurally no separate, broader export query path. AC-33: 50k+ row exports run as a " +
    "background job (poll GET /crm/exports/:id) rather than loading all rows into memory. " +
    "AC-34: requires reports.export IN ADDITION to the domain's reports.<domain>.view permission " +
    "(view-only users get 403 here; on-screen viewing keeps working). AC-28/29/Rule H-1: every " +
    "cell is neutralized via the shared csvSafeCell() choke-point (backend concern, not zod-visible). " +
    "AC-36: writes an audit_logs row (entity='export') with filters + row count on completion.",
  tags: ["crm", "reports", "exports"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("reports.export (scope mirrors the domain's view permission; see Part 8 table)"),
  request: {
    body: { content: { "application/json": { schema: CreateExportRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    202: { description: "Export job accepted (queued/running).", content: { "application/json": { schema: ExportJobEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/exports/{id}",
  summary: "Poll an export job's status / get its signed download URL",
  description:
    "AC-35: downloadUrl is a signed, short-lived URL (StorageProvider pattern), never a raw, " +
    "permanently-guessable object URL. Null until status='succeeded'.",
  tags: ["crm", "reports", "exports"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("reports.export"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Export job status.", content: { "application/json": { schema: ExportJobEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/exports",
  summary: "Export history (paginated)",
  tags: ["crm", "reports", "exports"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("reports.export"),
  request: { query: ListExportJobsQuerySchema },
  responses: {
    200: { description: "Export history page.", content: { "application/json": { schema: ExportJobListEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/reports/schedules",
  summary: "Create a scheduled (recurring) report email",
  description:
    "LOCK-D2: dispatch reuses the P6 Resend sync-seam (no BullMQ). AC-37: the recipient's RBAC " +
    "scope is re-evaluated at SEND time, not at creation time. This DTO carries no scope " +
    "snapshot. AC-38: send failure is logged/retried, never silently dropped. AC-39: a zero-row " +
    "period still sends a 'no data for this period' notice.",
  tags: ["crm", "reports", "schedules"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("reports.export (scheduling implies export)"),
  request: {
    body: { content: { "application/json": { schema: CreateReportSchedule } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    201: { description: "Schedule created.", content: { "application/json": { schema: ReportScheduleEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/reports/schedules",
  summary: "List scheduled reports (paginated)",
  tags: ["crm", "reports", "schedules"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("reports.export"),
  request: { query: ListReportSchedulesQuerySchema },
  responses: {
    200: { description: "Schedule list page.", content: { "application/json": { schema: ReportScheduleListEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/crm/reports/schedules/{id}",
  summary: "Update a scheduled report's cadence/recipient/active flag",
  description: "type/params are immutable. Delete + recreate to change what's reported.",
  tags: ["crm", "reports", "schedules"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("reports.export"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: UpdateReportSchedule } } },
    headers: idempotencyKeyHeader,
  },
  responses: {
    200: { description: "Schedule updated.", content: { "application/json": { schema: ReportScheduleEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/crm/reports/schedules/{id}",
  summary: "Delete a scheduled report",
  tags: ["crm", "reports", "schedules"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("reports.export"),
  request: { params: z.object({ id: z.string().uuid() }), headers: idempotencyKeyHeader },
  responses: {
    200: { description: "Schedule deleted.", content: { "application/json": { schema: ReportScheduleEnvelope } } },
    ...errorResponses,
  },
});

// ─────────────────────────────────────────────────────────────────────────
// Phase 8 — Mentor (human, externally-hired batch lead)
// docs/specs/phase-8-mentor.md, api-designer task #2. See
// packages/types/src/crm/mentors.schemas.ts file header for ground-truth
// schema deviations from the spec prose (no mentors.branch_id column,
// mentors.user_id nullable/no grant-login endpoint here, email required)
// and for which error codes are business-rule 422/409s owned by the service
// layer rather than zod shape checks.
//
// Permission notes (Rule M-3): mentors.view/create/edit/delete/assign are
// NEVER granted to the Mentor role. batches.view gains a new `assigned`
// scope resolver for Mentor (via batch_mentors, LOCK-2/Rule M-1) and is
// REUSED (not a new permission) for the mentors-of-a-batch list and the
// completion rollup — AC-23/AC-37. batches.markComplete is a NEW permission
// distinct from batches.edit (LOCK-5) — FLAGGED GAP: not yet present in
// prisma/seed.ts's P8_PERMISSIONS catalog nor granted to Mentor/Branch
// Manager as of this task; the guard below will 403 every caller until
// db-architect/backend-builder add it.
// ─────────────────────────────────────────────────────────────────────────

import {
  CreateMentorRequestSchema,
  UpdateMentorRequestSchema,
  ListMentorsQuerySchema,
  RestoreMentorRequestSchema,
  MentorSummarySchema,
  MentorDetailSchema,
  AssignMentorToBatchRequestSchema,
  MentorBatchAssignmentSchema,
  MentorBatchAssignmentListSchema,
  BatchCompletionSummaryDtoSchema,
  BatchCompletionStudentRowSchema,
  ListBatchCompletionStudentsQuerySchema,
  MarkBatchCompleteRequestSchema,
  MarkBatchCompleteResponseSchema,
  MentorDashboardDtoSchema,
} from "../crm/mentors.schemas.js";

// ---- Mentors: hiring-record CRUD ----

const CreateMentorRequest = registry.register("CreateMentorRequest", CreateMentorRequestSchema);
const UpdateMentorRequest = registry.register("UpdateMentorRequest", UpdateMentorRequestSchema);
const RestoreMentorRequest = registry.register("RestoreMentorRequest", RestoreMentorRequestSchema);
const MentorSummary = registry.register("MentorSummary", MentorSummarySchema);
const MentorDetail = registry.register("MentorDetail", MentorDetailSchema);
const MentorDetailEnvelope = envelopeOf("MentorDetail", MentorDetail);
const MentorListEnvelope = paginatedEnvelopeOf("Mentor", MentorSummary);

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/mentors",
  summary: "List/search the mentor directory",
  description: "Search by name/institute (AC-6), filter by engagementStatus/expertise (AC-7). Tenant/branch-scoped (AC-5).",
  tags: ["crm", "mentors"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("mentors.view (scope: all|branch. NEVER granted to the Mentor role, AC-15)"),
  request: { query: ListMentorsQuerySchema },
  responses: { 200: { description: "Mentor directory page.", content: { "application/json": { schema: MentorListEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/mentors",
  summary: "Create a mentor hiring record",
  description:
    "Creates ONLY a `mentors` row. Unlike POST /crm/students|faculty, this does NOT create a " +
    "`users` row (mentors.user_id is nullable; see packages/types crm/mentors.schemas.ts file header). " +
    "422 JOINED_DATE_REQUIRED if engagementStatus='active' with no joinedAt (AC-3). Writes one audit-log row (AC-14).",
  tags: ["crm", "mentors"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("mentors.create"),
  request: {
    body: { content: { "application/json": { schema: CreateMentorRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: { 201: { description: "Mentor created.", content: { "application/json": { schema: MentorDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/mentors/{id}",
  summary: "Get a mentor's full hiring record (incl. active batch assignments)",
  tags: ["crm", "mentors"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("mentors.view"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: "Mentor detail.", content: { "application/json": { schema: MentorDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/crm/mentors/{id}",
  summary: "Update a mentor hiring record (partial)",
  description: "AC-9: only supplied fields change. Same JOINED_DATE_REQUIRED business rule as create (AC-3).",
  tags: ["crm", "mentors"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("mentors.edit"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: UpdateMentorRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: { 200: { description: "Mentor updated.", content: { "application/json": { schema: MentorDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/crm/mentors/{id}",
  summary: "Soft-delete a mentor hiring record",
  description:
    "409 MENTOR_HAS_ACTIVE_ASSIGNMENTS (AC-12) if the mentor still has ≥1 active batch_mentors row, " +
    "remove them from every batch first (DELETE .../batches/:id/mentors/:mentorId). " +
    "Conflicting batches are listed in error.errors[] (path=batchMentorId, message=batchName).",
  tags: ["crm", "mentors"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("mentors.delete"),
  request: { params: z.object({ id: z.string().uuid() }), headers: idempotencyKeyHeader },
  responses: { 200: { description: "Mentor soft-deleted.", content: { "application/json": { schema: MentorDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/mentors/{id}/restore",
  summary: "Restore a soft-deleted mentor hiring record",
  description: "Does NOT reactivate a deactivated linked `users` row, if any. That remains a separate staff action (Part 4 edge case).",
  tags: ["crm", "mentors"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("mentors.edit"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: RestoreMentorRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: { 200: { description: "Mentor restored.", content: { "application/json": { schema: MentorDetailEnvelope } } }, ...errorResponses },
});

// ---- Mentors: batch assignment (WS-2) ----

const AssignMentorToBatchRequest = registry.register("AssignMentorToBatchRequest", AssignMentorToBatchRequestSchema);
const MentorBatchAssignment = registry.register("MentorBatchAssignment", MentorBatchAssignmentSchema);
const MentorBatchAssignmentEnvelope = envelopeOf("MentorBatchAssignment", MentorBatchAssignment);
const MentorBatchAssignmentList = registry.register("MentorBatchAssignmentList", MentorBatchAssignmentListSchema);
const MentorBatchAssignmentListEnvelope = envelopeOf("MentorBatchAssignmentList", MentorBatchAssignmentList);

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/batches/{id}/mentors",
  summary: "List a batch's currently-assigned mentors",
  description: "AC-23: reuses the caller's existing batches.view scope. No separate permission for reading this list. A batch may have zero mentors (AC-25).",
  tags: ["crm", "batches", "mentors"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("batches.view (scope: all|branch|assigned. Assigned resolved via batch_mentors for Mentor, LOCK-2)"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: "Batch's mentor list.", content: { "application/json": { schema: MentorBatchAssignmentListEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/batches/{id}/mentors",
  summary: "Assign a mentor to a batch (or update their lead flag)",
  description:
    "See packages/types crm/mentors.schemas.ts AssignMentorToBatchRequestSchema doc comment for the full " +
    "assign-vs-update-lead-flag decision tree. 422 MENTOR_NOT_ACTIVE (AC-18), 409 ALREADY_ASSIGNED on a " +
    "literal repeat (AC-19), 422 BATCH_NOT_ASSIGNABLE if the batch is completed/archived (AC-26). At most " +
    "one lead mentor per batch. Designating a new lead clears the previous one (AC-21). Writes one " +
    "audit-log row (entity=batch_mentor, AC-30).",
  tags: ["crm", "batches", "mentors"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("mentors.assign (distinct from mentors.edit, AC-29)"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: AssignMentorToBatchRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: { 201: { description: "Mentor assigned (or lead flag updated).", content: { "application/json": { schema: MentorBatchAssignmentEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/crm/batches/{id}/mentors/{mentorId}",
  summary: "Remove a mentor from a batch (soft-unassign)",
  description:
    "AC-24/Rule M-5: the batch_mentors row is timestamp-marked removed, never hard-deleted, assignment " +
    "history is preserved. Leaves the batch with zero mentors if it was the last one (AC-25, valid). " +
    "Removing a lead mentor does NOT auto-promote another mentor to lead (Part 4 edge case). Returns the " +
    "batch's updated mentor list. Writes one audit-log row (AC-30).",
  tags: ["crm", "batches", "mentors"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("mentors.assign"),
  request: {
    params: z.object({ id: z.string().uuid(), mentorId: z.string().uuid() }),
    headers: idempotencyKeyHeader,
  },
  responses: { 200: { description: "Mentor removed; updated mentor list returned.", content: { "application/json": { schema: MentorBatchAssignmentListEnvelope } } }, ...errorResponses },
});

// ---- Mentors: completion rollup + mark-complete (WS-3) ----

const BatchCompletionSummary = registry.register("BatchCompletionSummaryDto", BatchCompletionSummaryDtoSchema);
const BatchCompletionSummaryEnvelope = envelopeOf("BatchCompletionSummary", BatchCompletionSummary);
const BatchCompletionStudentRow = registry.register("BatchCompletionStudentRowDto", BatchCompletionStudentRowSchema);
const BatchCompletionStudentListEnvelope = paginatedEnvelopeOf("BatchCompletionStudentRow", BatchCompletionStudentRow);
const MarkBatchCompleteRequest = registry.register("MarkBatchCompleteRequest", MarkBatchCompleteRequestSchema);
const MarkBatchCompleteResponse = registry.register("MarkBatchCompleteResponse", MarkBatchCompleteResponseSchema);
const MarkBatchCompleteEnvelope = envelopeOf("MarkBatchComplete", MarkBatchCompleteResponse);

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/batches/{id}/completion",
  summary: "Get a batch's internship-completion rollup (batch-level headcounts + %)",
  description:
    "AC-31 (HEADLINE): every number is a LIVE read of enrollments/lesson_progress/submissions/attempts/" +
    "assessments/assignments/certificates (or the P4 eligibility engine), never a parallel progress " +
    "table. AC-36: a batch with zero enrollments is a valid 200 (all buckets 0, percentComplete null), " +
    "never 404/500. For the paginated per-student breakdown see GET .../completion/students.",
  tags: ["crm", "batches", "mentors"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("batches.view (scope: all|branch|assigned. A Mentor requesting an unassigned batch gets 404, AC-37)"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: "Batch completion rollup.", content: { "application/json": { schema: BatchCompletionSummaryEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/batches/{id}/completion/students",
  summary: "Get the batch's per-student completion breakdown (paginated)",
  description:
    "Part 4 edge case: server-side pagination for batches with 500+ students, never an unbounded array. " +
    "Optional bucket/status filters. Each row reuses EligibilityResultSchema verbatim (AC-33).",
  tags: ["crm", "batches", "mentors"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("batches.view (scope: all|branch|assigned)"),
  request: { params: z.object({ id: z.string().uuid() }), query: ListBatchCompletionStudentsQuerySchema },
  responses: { 200: { description: "Per-student completion page.", content: { "application/json": { schema: BatchCompletionStudentListEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/batches/{id}/complete",
  summary: "Mark a batch's internship program run complete (active → completed)",
  description:
    "AC-39: valid ONLY from status='active' (422 BATCH_NOT_ACTIVE from 'planned'; 409 ALREADY_COMPLETED, " +
    "idempotent no-op, from 'completed'/'archived'). AC-40: sets completed_at, never overwritten again. " +
    "AC-41 (Rule M-2): completion numbers are informational only, NEVER gate this transition. AC-42: " +
    "never mutates enrollment/progress/grading/certificate data. Pure status/timestamp write + audit log " +
    "(AC-43, entity=batch, action=complete).",
  tags: ["crm", "batches", "mentors"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("batches.markComplete (scope: all|branch|assigned. Every actively-assigned Mentor, lead or not, AC-38; NOT yet seeded, see file-level note above)"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: MarkBatchCompleteRequest } } },
    headers: idempotencyKeyHeader,
  },
  responses: { 200: { description: "Batch marked complete.", content: { "application/json": { schema: MarkBatchCompleteEnvelope } } }, ...errorResponses },
});

// ---- Mentor dashboard (WS-4) ----

const MentorDashboardDto = registry.register("MentorDashboardDto", MentorDashboardDtoSchema);
const MentorDashboardEnvelope = envelopeOf("MentorDashboard", MentorDashboardDto);

registry.registerPath({
  method: "get",
  path: "/api/v1/me/mentor/dashboard",
  summary: "Get the authenticated mentor's own dashboard (assigned batches only)",
  description:
    "AC-46 (HEADLINE): ONLY the caller's actively-assigned batch(es). Everything else is 404, never a " +
    "403 that would confirm existence (fail-closed, LOCK-2/Rule M-1). AC-47/48: cross-tenant and " +
    "cross-mentor isolation. AC-49/Rule M-4: engagementStatus is re-checked live every request, never " +
    "cached from login. AC-50: each batch card is sourced from the SAME rollup CRM staff use. AC-51: zero " +
    "assignments is a valid 200 with batches:[], not an error. No tenant/branch/mentor selector accepted " +
    "from the client. Scope is entirely session-resolved (CLAUDE.md §3.5).",
  tags: ["crm", "mentors", "dashboard"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("mentor.dashboard.view (scope: own. Re-evaluated live per request, AC-49)"),
  responses: { 200: { description: "Mentor's own dashboard.", content: { "application/json": { schema: MentorDashboardEnvelope } } }, ...errorResponses },
});

// ---- WS-C: Health / readiness ----

const Liveness = registry.register("LivenessResponse", LivenessResponseSchema);
const Readiness = registry.register("ReadinessResponse", ReadinessResponseSchema);

registry.registerPath({
  method: "get",
  path: "/api/v1/health",
  summary: "Liveness probe",
  description:
    "AC-41: PUBLIC, unauthenticated. Minimal payload only ({status:'ok'}), NEVER package " +
    "versions, stack traces, hostnames, connection strings, or env var contents (Rule H-3). " +
    "AC-49: exempt from auth but still rate-limited.",
  tags: ["health"],
  responses: {
    200: { description: "Process is up.", content: { "application/json": { schema: Liveness } } },
    429: errorResponses[429],
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/health/ready",
  summary: "Readiness probe (DB + Redis)",
  description:
    "AC-42: PUBLIC, unauthenticated. Returns 503 (not 200) when DB or Redis is unreachable, " +
    "with a per-dependency status label only. No driver error, no connection string, no stack " +
    "trace (Rule H-3). AC-49: exempt from auth but still rate-limited.",
  tags: ["health"],
  responses: {
    200: { description: "All dependencies healthy.", content: { "application/json": { schema: Readiness } } },
    503: { description: "One or more dependencies unhealthy.", content: { "application/json": { schema: Readiness } } },
    429: errorResponses[429],
  },
});


// ═════════════════════════════════════════════════════════════════════════
// Phase 9 Completion (docs/plans/phase-9-completion.md, api-designer task
// #T14). Every net-new endpoint group added in the completion phase: live
// classes, support desk, headless CMS, feature flags/settings, LMS
// bookmarks/notes/search/learning-path, commerce referrals/EMI/receipt,
// growth landing-pages/lead-forms, password reset. Same transport rules as
// every prior phase: cookieAuth+csrfHeader on authenticated mutations,
// Idempotency-Key on unsafe mutations, RFC-7807 errors, money in paise.
// ═════════════════════════════════════════════════════════════════════════

// ── Live classes (T6/T15/T20) ───────────────────────────────────────────

import {
  CreateLiveClassRequestSchema,
  UpdateLiveClassRequestSchema,
  CancelLiveClassRequestSchema,
  ListLiveClassesQuerySchema,
  ListMyLiveClassesQuerySchema,
  LiveClassSummarySchema,
  LiveClassDetailSchema,
  MyLiveClassSchema,
  JoinLiveClassResponseSchema,
} from "../live/live-classes.schemas.js";

const CreateLiveClassRequest = registry.register("CreateLiveClassRequest", CreateLiveClassRequestSchema);
const UpdateLiveClassRequest = registry.register("UpdateLiveClassRequest", UpdateLiveClassRequestSchema);
const CancelLiveClassRequest = registry.register("CancelLiveClassRequest", CancelLiveClassRequestSchema);
const LiveClassSummary = registry.register("LiveClassSummary", LiveClassSummarySchema);
const LiveClassDetail = registry.register("LiveClassDetail", LiveClassDetailSchema);
const MyLiveClass = registry.register("MyLiveClass", MyLiveClassSchema);
const JoinLiveClassResponse = registry.register("JoinLiveClassResponse", JoinLiveClassResponseSchema);
const LiveClassDetailEnvelope = envelopeOf("LiveClassDetail", LiveClassDetail);
const LiveClassListEnvelope = paginatedEnvelopeOf("LiveClass", LiveClassSummary);
const MyLiveClassListEnvelope = paginatedEnvelopeOf("MyLiveClass", MyLiveClass);
const JoinLiveClassEnvelope = envelopeOf("JoinLiveClass", JoinLiveClassResponse);

registry.registerPath({
  method: "get", path: "/api/v1/crm/live-classes",
  summary: "List/search scheduled live classes",
  tags: ["crm", "live-classes"], security: [{ cookieAuth: [] }],
  ...requiredPermission("liveclass.view (scope: all|branch|assigned via batch faculty/mentor)"),
  request: { query: ListLiveClassesQuerySchema },
  responses: { 200: { description: "Live class list.", content: { "application/json": { schema: LiveClassListEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post", path: "/api/v1/crm/live-classes",
  summary: "Schedule a live class (creates the DB row + asks the LiveClassProvider adapter to create the remote meeting)",
  tags: ["crm", "live-classes"], security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("liveclass.create"),
  request: { body: { content: { "application/json": { schema: CreateLiveClassRequest } } }, headers: idempotencyKeyHeader },
  responses: { 201: { description: "Live class scheduled.", content: { "application/json": { schema: LiveClassDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "get", path: "/api/v1/crm/live-classes/{id}",
  summary: "Get a live class's full detail",
  tags: ["crm", "live-classes"], security: [{ cookieAuth: [] }],
  ...requiredPermission("liveclass.view"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: "Live class detail.", content: { "application/json": { schema: LiveClassDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "patch", path: "/api/v1/crm/live-classes/{id}",
  summary: "Reschedule/retitle a live class",
  tags: ["crm", "live-classes"], security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("liveclass.edit"),
  request: { params: z.object({ id: z.string().uuid() }), body: { content: { "application/json": { schema: UpdateLiveClassRequest } } }, headers: idempotencyKeyHeader },
  responses: { 200: { description: "Live class updated.", content: { "application/json": { schema: LiveClassDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post", path: "/api/v1/crm/live-classes/{id}/cancel",
  summary: "Cancel a scheduled live class",
  tags: ["crm", "live-classes"], security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("liveclass.cancel"),
  request: { params: z.object({ id: z.string().uuid() }), body: { content: { "application/json": { schema: CancelLiveClassRequest } } }, headers: idempotencyKeyHeader },
  responses: { 200: { description: "Live class cancelled.", content: { "application/json": { schema: LiveClassDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post", path: "/api/v1/crm/live-classes/{id}/join",
  summary: "Host/staff join. Mints a short-lived provider join URL",
  tags: ["crm", "live-classes"], security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("liveclass.view"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: "Join URL.", content: { "application/json": { schema: JoinLiveClassEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "get", path: "/api/v1/me/live-classes",
  summary: "List the student's own enrolled-batch live class sessions",
  tags: ["lms", "live-classes"], security: [{ cookieAuth: [] }],
  ...requiredPermission("liveclass.view (scope: own, via active enrollments)"),
  request: { query: ListMyLiveClassesQuerySchema },
  responses: { 200: { description: "Own live class list.", content: { "application/json": { schema: MyLiveClassListEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "post", path: "/api/v1/me/live-classes/{id}/join",
  summary: "Student join. Mints a short-lived provider join URL (IDOR->404 if not enrolled in the batch)",
  tags: ["lms", "live-classes"], security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("liveclass.view (scope: own)"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: "Join URL.", content: { "application/json": { schema: JoinLiveClassEnvelope } } }, ...errorResponses },
});

// ── Support desk: tickets, canned responses, KB articles (T7/T21) ───────

import {
  CreateTicketRequestSchema,
  UpdateTicketRequestSchema,
  ListTicketsQuerySchema,
  ListMyTicketsQuerySchema,
  AddTicketMessageRequestSchema,
  RateTicketRequestSchema,
  TicketSummarySchema,
  TicketDetailSchema,
} from "../support/tickets.schemas.js";
import {
  CreateCannedResponseRequestSchema,
  UpdateCannedResponseRequestSchema,
  ListCannedResponsesQuerySchema,
  CannedResponseSchema,
} from "../support/canned-responses.schemas.js";
import {
  CreateKbArticleRequestSchema,
  UpdateKbArticleRequestSchema,
  ListKbArticlesQuerySchema,
  KbArticleSummarySchema,
  KbArticleDetailSchema,
  ListPublicKbArticlesQuerySchema,
  PublicKbArticleSummarySchema,
  PublicKbArticleDetailSchema,
} from "../support/kb-articles.schemas.js";

const CreateTicketRequest = registry.register("CreateTicketRequest", CreateTicketRequestSchema);
const UpdateTicketRequest = registry.register("UpdateTicketRequest", UpdateTicketRequestSchema);
const AddTicketMessageRequest = registry.register("AddTicketMessageRequest", AddTicketMessageRequestSchema);
const RateTicketRequest = registry.register("RateTicketRequest", RateTicketRequestSchema);
const TicketSummary = registry.register("TicketSummary", TicketSummarySchema);
const TicketDetail = registry.register("TicketDetail", TicketDetailSchema);
const TicketDetailEnvelope = envelopeOf("TicketDetail", TicketDetail);
const TicketListEnvelope = paginatedEnvelopeOf("Ticket", TicketSummary);

registry.registerPath({
  method: "get", path: "/api/v1/crm/tickets", summary: "List/search support tickets (staff, all|assigned scope)",
  tags: ["crm", "tickets"], security: [{ cookieAuth: [] }], ...requiredPermission("tickets.view (scope: all|assigned)"),
  request: { query: ListTicketsQuerySchema },
  responses: { 200: { description: "Ticket list.", content: { "application/json": { schema: TicketListEnvelope } } }, ...errorResponses },
});
registry.registerPath({
  method: "get", path: "/api/v1/crm/tickets/{id}", summary: "Get a ticket's full detail incl. messages (staff, includes internal notes)",
  tags: ["crm", "tickets"], security: [{ cookieAuth: [] }], ...requiredPermission("tickets.view"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: "Ticket detail.", content: { "application/json": { schema: TicketDetailEnvelope } } }, ...errorResponses },
});
registry.registerPath({
  method: "patch", path: "/api/v1/crm/tickets/{id}", summary: "Update ticket status/priority/assignee",
  tags: ["crm", "tickets"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("tickets.manage"),
  request: { params: z.object({ id: z.string().uuid() }), body: { content: { "application/json": { schema: UpdateTicketRequest } } }, headers: idempotencyKeyHeader },
  responses: { 200: { description: "Ticket updated.", content: { "application/json": { schema: TicketDetailEnvelope } } }, ...errorResponses },
});
registry.registerPath({
  method: "post", path: "/api/v1/crm/tickets/{id}/messages", summary: "Add a staff reply or internal-only note",
  tags: ["crm", "tickets"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("tickets.manage"),
  request: { params: z.object({ id: z.string().uuid() }), body: { content: { "application/json": { schema: AddTicketMessageRequest } } }, headers: idempotencyKeyHeader },
  responses: { 201: { description: "Message added.", content: { "application/json": { schema: TicketDetailEnvelope } } }, ...errorResponses },
});

registry.registerPath({
  method: "get", path: "/api/v1/me/tickets", summary: "List the student's own tickets",
  tags: ["lms", "tickets"], security: [{ cookieAuth: [] }], ...requiredPermission("tickets.view (scope: own)"),
  request: { query: ListMyTicketsQuerySchema },
  responses: { 200: { description: "Own ticket list.", content: { "application/json": { schema: TicketListEnvelope } } }, ...errorResponses },
});
registry.registerPath({
  method: "post", path: "/api/v1/me/tickets", summary: "Raise a support ticket",
  tags: ["lms", "tickets"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("tickets.create (scope: own)"),
  request: { body: { content: { "application/json": { schema: CreateTicketRequest } } }, headers: idempotencyKeyHeader },
  responses: { 201: { description: "Ticket created.", content: { "application/json": { schema: TicketDetailEnvelope } } }, ...errorResponses },
});
registry.registerPath({
  method: "get", path: "/api/v1/me/tickets/{id}", summary: "Get own ticket detail (isInternal messages filtered out server-side)",
  tags: ["lms", "tickets"], security: [{ cookieAuth: [] }], ...requiredPermission("tickets.view (scope: own)"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: "Ticket detail.", content: { "application/json": { schema: TicketDetailEnvelope } } }, ...errorResponses },
});
registry.registerPath({
  method: "post", path: "/api/v1/me/tickets/{id}/messages", summary: "Reply to own ticket (isInternal is always forced false)",
  tags: ["lms", "tickets"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("tickets.create (scope: own)"),
  request: { params: z.object({ id: z.string().uuid() }), body: { content: { "application/json": { schema: AddTicketMessageRequest } } }, headers: idempotencyKeyHeader },
  responses: { 201: { description: "Message added.", content: { "application/json": { schema: TicketDetailEnvelope } } }, ...errorResponses },
});
registry.registerPath({
  method: "post", path: "/api/v1/me/tickets/{id}/rate", summary: "Rate a resolved/closed ticket (CSAT 1-5)",
  tags: ["lms", "tickets"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("tickets.view (scope: own)"),
  request: { params: z.object({ id: z.string().uuid() }), body: { content: { "application/json": { schema: RateTicketRequest } } }, headers: idempotencyKeyHeader },
  responses: { 200: { description: "Rated.", content: { "application/json": { schema: TicketDetailEnvelope } } }, ...errorResponses },
});

const CreateCannedResponseRequest = registry.register("CreateCannedResponseRequest", CreateCannedResponseRequestSchema);
const UpdateCannedResponseRequest = registry.register("UpdateCannedResponseRequest", UpdateCannedResponseRequestSchema);
const CannedResponse = registry.register("CannedResponse", CannedResponseSchema);
const CannedResponseEnvelope = envelopeOf("CannedResponse", CannedResponse);
const CannedResponseListEnvelope = paginatedEnvelopeOf("CannedResponse", CannedResponse);

registry.registerPath({
  method: "get", path: "/api/v1/crm/canned-responses", summary: "List canned (macro) responses",
  tags: ["crm", "tickets"], security: [{ cookieAuth: [] }], ...requiredPermission("tickets.view"),
  request: { query: ListCannedResponsesQuerySchema },
  responses: { 200: { description: "Canned response list.", content: { "application/json": { schema: CannedResponseListEnvelope } } }, ...errorResponses },
});
registry.registerPath({
  method: "post", path: "/api/v1/crm/canned-responses", summary: "Create a canned response",
  tags: ["crm", "tickets"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("tickets.manage"),
  request: { body: { content: { "application/json": { schema: CreateCannedResponseRequest } } }, headers: idempotencyKeyHeader },
  responses: { 201: { description: "Canned response created.", content: { "application/json": { schema: CannedResponseEnvelope } } }, ...errorResponses },
});
registry.registerPath({
  method: "patch", path: "/api/v1/crm/canned-responses/{id}", summary: "Update a canned response",
  tags: ["crm", "tickets"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("tickets.manage"),
  request: { params: z.object({ id: z.string().uuid() }), body: { content: { "application/json": { schema: UpdateCannedResponseRequest } } }, headers: idempotencyKeyHeader },
  responses: { 200: { description: "Canned response updated.", content: { "application/json": { schema: CannedResponseEnvelope } } }, ...errorResponses },
});

const CreateKbArticleRequest = registry.register("CreateKbArticleRequest", CreateKbArticleRequestSchema);
const UpdateKbArticleRequest = registry.register("UpdateKbArticleRequest", UpdateKbArticleRequestSchema);
const KbArticleSummary = registry.register("KbArticleSummary", KbArticleSummarySchema);
const KbArticleDetail = registry.register("KbArticleDetail", KbArticleDetailSchema);
const KbArticleDetailEnvelope = envelopeOf("KbArticleDetail", KbArticleDetail);
const KbArticleListEnvelope = paginatedEnvelopeOf("KbArticle", KbArticleSummary);
const PublicKbArticleSummary = registry.register("PublicKbArticleSummary", PublicKbArticleSummarySchema);
const PublicKbArticleDetail = registry.register("PublicKbArticleDetail", PublicKbArticleDetailSchema);
const PublicKbArticleDetailEnvelope = envelopeOf("PublicKbArticleDetail", PublicKbArticleDetail);
const PublicKbArticleListEnvelope = registry.register("PublicKbArticleListEnvelope", z.object({
  data: z.array(PublicKbArticleSummary).nullable(),
  meta: z.object({ nextCursor: z.string().nullable(), hasMore: z.boolean() }).nullable(),
  error: ProblemDetails.nullable(),
}));

registry.registerPath({
  method: "get", path: "/api/v1/crm/kb-articles", summary: "List/search knowledge-base articles (admin)",
  tags: ["crm", "kb"], security: [{ cookieAuth: [] }], ...requiredPermission("tickets.view"),
  request: { query: ListKbArticlesQuerySchema },
  responses: { 200: { description: "KB article list.", content: { "application/json": { schema: KbArticleListEnvelope } } }, ...errorResponses },
});
registry.registerPath({
  method: "post", path: "/api/v1/crm/kb-articles", summary: "Create a KB article",
  tags: ["crm", "kb"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("tickets.manage"),
  request: { body: { content: { "application/json": { schema: CreateKbArticleRequest } } }, headers: idempotencyKeyHeader },
  responses: { 201: { description: "KB article created.", content: { "application/json": { schema: KbArticleDetailEnvelope } } }, ...errorResponses },
});
registry.registerPath({
  method: "patch", path: "/api/v1/crm/kb-articles/{id}", summary: "Update a KB article (incl. publish toggle)",
  tags: ["crm", "kb"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("tickets.manage"),
  request: { params: z.object({ id: z.string().uuid() }), body: { content: { "application/json": { schema: UpdateKbArticleRequest } } }, headers: idempotencyKeyHeader },
  responses: { 200: { description: "KB article updated.", content: { "application/json": { schema: KbArticleDetailEnvelope } } }, ...errorResponses },
});
registry.registerPath({
  method: "get", path: "/api/v1/public/kb-articles", summary: "List published KB articles (help center)",
  tags: ["public", "kb"],
  request: { query: ListPublicKbArticlesQuerySchema },
  responses: { 200: { description: "Published KB article list.", content: { "application/json": { schema: PublicKbArticleListEnvelope } } }, ...errorResponses },
});
registry.registerPath({
  method: "get", path: "/api/v1/public/kb-articles/{slug}", summary: "Get a published KB article by slug",
  tags: ["public", "kb"],
  request: { params: z.object({ slug: z.string().min(1) }) },
  responses: { 200: { description: "Published KB article.", content: { "application/json": { schema: PublicKbArticleDetailEnvelope } } }, ...errorResponses },
});

// ── Headless CMS: blog, testimonials, partners, faculty bios, pages,
//    newsletter, contact, careers (T8/T22/T32) ───────────────────────────

import {
  CreateBlogCategoryRequestSchema,
  UpdateBlogCategoryRequestSchema,
  BlogCategorySchema,
  CreateBlogPostRequestSchema,
  UpdateBlogPostRequestSchema,
  ListBlogPostsQuerySchema,
  BlogPostSummarySchema,
  BlogPostDetailSchema,
  ListPublicBlogPostsQuerySchema,
  PublicBlogPostSummarySchema,
  PublicBlogPostDetailSchema,
} from "../content/blog.schemas.js";
import {
  CreateTestimonialRequestSchema,
  UpdateTestimonialRequestSchema,
  ListTestimonialsQuerySchema,
  TestimonialSchema,
  ListPublicTestimonialsQuerySchema,
  PublicTestimonialSchema,
} from "../content/testimonials.schemas.js";
import {
  CreatePartnerRequestSchema,
  UpdatePartnerRequestSchema,
  ListPartnersQuerySchema,
  PartnerSchema,
  PublicPartnerSchema,
} from "../content/partners.schemas.js";
import {
  CreateFacultyBioRequestSchema,
  UpdateFacultyBioRequestSchema,
  ListFacultyBiosQuerySchema,
  FacultyBioSchema,
  PublicFacultyBioSchema,
} from "../content/faculty-bios.schemas.js";
import {
  CreateCollegeRequestSchema,
  UpdateCollegeRequestSchema,
  ListCollegesQuerySchema,
  CollegeSchema,
  DeleteCollegeResponseSchema,
  CollegeLogoUploadUrlRequestSchema,
} from "../crm/colleges.schemas.js";
import {
  CreateContentPageRequestSchema,
  UpdateContentPageRequestSchema,
  ListContentPagesQuerySchema,
  ContentPageSummarySchema,
  ContentPageDetailSchema,
  PublicContentPageSchema,
  ContentPageBuilderDetailSchema,
  CreateBuilderPageRequestSchema,
  SaveBuilderPageRequestSchema,
  PreviewBuilderPageRequestSchema,
  PreviewBuilderPageResponseSchema,
  ListContentPageVersionsQuerySchema,
  ContentPageVersionSummarySchema,
  ContentPageVersionDetailSchema,
  RevertContentPageVersionRequestSchema,
  ContentPageMediaUploadUrlRequestSchema,
} from "../content/pages.schemas.js";
import {
  SiteSettingKeySchema,
  ListSiteSettingsQuerySchema,
  SiteSettingSchema,
  UpsertSiteSettingRequestSchema,
  PublicSiteSettingsResponseSchema,
} from "../content/site-settings.schemas.js";
import {
  SubscribeNewsletterRequestSchema,
  SubscribeNewsletterResponseSchema,
  UnsubscribeNewsletterQuerySchema,
  ListNewsletterSubscriptionsQuerySchema,
  NewsletterSubscriptionSchema,
} from "../content/newsletter.schemas.js";
import {
  SubmitContactRequestSchema,
  SubmitContactResponseSchema,
  UpdateContactSubmissionStatusRequestSchema,
  ListContactSubmissionsQuerySchema,
  ContactSubmissionSchema,
} from "../content/contact.schemas.js";
import {
  SubmitCareerApplicationRequestSchema,
  SubmitCareerApplicationResponseSchema,
  ListCareerApplicationsQuerySchema,
  CareerApplicationSummarySchema,
  CareerApplicationDetailSchema,
  PublicCareerResumeUploadUrlRequestSchema,
  PublicCareerResumeUploadUrlResponseSchema,
  HoldCareerApplicationRequestSchema,
  ShortlistCareerApplicationRequestSchema,
  OfferCareerApplicationRequestSchema,
  RejectCareerApplicationRequestSchema,
  OfferLetterUploadUrlRequestSchema,
  ResendAcknowledgementResponseSchema,
} from "../content/careers.schemas.js";
import {
  PublicJobOpeningSchema,
  ListPublicJobOpeningsQuerySchema,
  JobOpeningSchema,
  CreateJobOpeningRequestSchema,
  UpdateJobOpeningRequestSchema,
  ListJobOpeningsQuerySchema,
} from "../content/job-openings.schemas.js";

// -- Blog --
const CreateBlogCategoryRequest = registry.register("CreateBlogCategoryRequest", CreateBlogCategoryRequestSchema);
const UpdateBlogCategoryRequest = registry.register("UpdateBlogCategoryRequest", UpdateBlogCategoryRequestSchema);
const BlogCategory = registry.register("BlogCategory", BlogCategorySchema);
const BlogCategoryEnvelope = envelopeOf("BlogCategory", BlogCategory);
const BlogCategoryListEnvelope = paginatedEnvelopeOf("BlogCategory", BlogCategory);
const CreateBlogPostRequest = registry.register("CreateBlogPostRequest", CreateBlogPostRequestSchema);
const UpdateBlogPostRequest = registry.register("UpdateBlogPostRequest", UpdateBlogPostRequestSchema);
const BlogPostSummary = registry.register("BlogPostSummary", BlogPostSummarySchema);
const BlogPostDetail = registry.register("BlogPostDetail", BlogPostDetailSchema);
const BlogPostDetailEnvelope = envelopeOf("BlogPostDetail", BlogPostDetail);
const BlogPostListEnvelope = paginatedEnvelopeOf("BlogPost", BlogPostSummary);
const PublicBlogPostSummary = registry.register("PublicBlogPostSummary", PublicBlogPostSummarySchema);
const PublicBlogPostDetail = registry.register("PublicBlogPostDetail", PublicBlogPostDetailSchema);
const PublicBlogPostDetailEnvelope = envelopeOf("PublicBlogPostDetail", PublicBlogPostDetail);
const PublicBlogPostListEnvelope = registry.register("PublicBlogPostListEnvelope", z.object({
  data: z.array(PublicBlogPostSummary).nullable(),
  meta: z.object({ nextCursor: z.string().nullable(), hasMore: z.boolean() }).nullable(),
  error: ProblemDetails.nullable(),
}));

registry.registerPath({ method: "get", path: "/api/v1/crm/blog/categories", summary: "List blog categories", tags: ["crm", "blog"], security: [{ cookieAuth: [] }], ...requiredPermission("content.view"), responses: { 200: { description: "Category list.", content: { "application/json": { schema: BlogCategoryListEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "post", path: "/api/v1/crm/blog/categories", summary: "Create a blog category", tags: ["crm", "blog"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("content.manage"), request: { body: { content: { "application/json": { schema: CreateBlogCategoryRequest } } }, headers: idempotencyKeyHeader }, responses: { 201: { description: "Category created.", content: { "application/json": { schema: BlogCategoryEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "patch", path: "/api/v1/crm/blog/categories/{id}", summary: "Update a blog category", tags: ["crm", "blog"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("content.manage"), request: { params: z.object({ id: z.string().uuid() }), body: { content: { "application/json": { schema: UpdateBlogCategoryRequest } } }, headers: idempotencyKeyHeader }, responses: { 200: { description: "Category updated.", content: { "application/json": { schema: BlogCategoryEnvelope } } }, ...errorResponses } });

registry.registerPath({ method: "get", path: "/api/v1/crm/blog/posts", summary: "List/search blog posts (admin)", tags: ["crm", "blog"], security: [{ cookieAuth: [] }], ...requiredPermission("content.view"), request: { query: ListBlogPostsQuerySchema }, responses: { 200: { description: "Post list.", content: { "application/json": { schema: BlogPostListEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "post", path: "/api/v1/crm/blog/posts", summary: "Create a blog post (draft by default)", tags: ["crm", "blog"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("content.manage"), request: { body: { content: { "application/json": { schema: CreateBlogPostRequest } } }, headers: idempotencyKeyHeader }, responses: { 201: { description: "Post created.", content: { "application/json": { schema: BlogPostDetailEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "get", path: "/api/v1/crm/blog/posts/{id}", summary: "Get a blog post's full detail", tags: ["crm", "blog"], security: [{ cookieAuth: [] }], ...requiredPermission("content.view"), request: { params: z.object({ id: z.string().uuid() }) }, responses: { 200: { description: "Post detail.", content: { "application/json": { schema: BlogPostDetailEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "patch", path: "/api/v1/crm/blog/posts/{id}", summary: "Update a blog post (incl. publish transition)", tags: ["crm", "blog"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("content.manage"), request: { params: z.object({ id: z.string().uuid() }), body: { content: { "application/json": { schema: UpdateBlogPostRequest } } }, headers: idempotencyKeyHeader }, responses: { 200: { description: "Post updated.", content: { "application/json": { schema: BlogPostDetailEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "get", path: "/api/v1/public/blog/posts", summary: "List published blog posts", tags: ["public", "blog"], request: { query: ListPublicBlogPostsQuerySchema }, responses: { 200: { description: "Published post list.", content: { "application/json": { schema: PublicBlogPostListEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "get", path: "/api/v1/public/blog/posts/{slug}", summary: "Get a published blog post by slug", tags: ["public", "blog"], request: { params: z.object({ slug: z.string().min(1) }) }, responses: { 200: { description: "Published post.", content: { "application/json": { schema: PublicBlogPostDetailEnvelope } } }, ...errorResponses } });

// -- Testimonials --
const CreateTestimonialRequest = registry.register("CreateTestimonialRequest", CreateTestimonialRequestSchema);
const UpdateTestimonialRequest = registry.register("UpdateTestimonialRequest", UpdateTestimonialRequestSchema);
const Testimonial = registry.register("Testimonial", TestimonialSchema);
const TestimonialEnvelope = envelopeOf("Testimonial", Testimonial);
const TestimonialListEnvelope = paginatedEnvelopeOf("Testimonial", Testimonial);
const PublicTestimonial = registry.register("PublicTestimonial", PublicTestimonialSchema);
const PublicTestimonialListEnvelope = registry.register("PublicTestimonialListEnvelope", z.object({ data: z.array(PublicTestimonial).nullable(), meta: z.record(z.string(), z.unknown()).nullable(), error: ProblemDetails.nullable() }));

registry.registerPath({ method: "get", path: "/api/v1/crm/testimonials", summary: "List testimonials (admin)", tags: ["crm", "testimonials"], security: [{ cookieAuth: [] }], ...requiredPermission("content.view"), request: { query: ListTestimonialsQuerySchema }, responses: { 200: { description: "Testimonial list.", content: { "application/json": { schema: TestimonialListEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "post", path: "/api/v1/crm/testimonials", summary: "Create a testimonial", tags: ["crm", "testimonials"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("content.manage"), request: { body: { content: { "application/json": { schema: CreateTestimonialRequest } } }, headers: idempotencyKeyHeader }, responses: { 201: { description: "Testimonial created.", content: { "application/json": { schema: TestimonialEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "patch", path: "/api/v1/crm/testimonials/{id}", summary: "Update a testimonial", tags: ["crm", "testimonials"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("content.manage"), request: { params: z.object({ id: z.string().uuid() }), body: { content: { "application/json": { schema: UpdateTestimonialRequest } } }, headers: idempotencyKeyHeader }, responses: { 200: { description: "Testimonial updated.", content: { "application/json": { schema: TestimonialEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "get", path: "/api/v1/public/testimonials", summary: "List published testimonials", tags: ["public", "testimonials"], request: { query: ListPublicTestimonialsQuerySchema }, responses: { 200: { description: "Published testimonial list.", content: { "application/json": { schema: PublicTestimonialListEnvelope } } }, ...errorResponses } });

// -- Partners --
const CreatePartnerRequest = registry.register("CreatePartnerRequest", CreatePartnerRequestSchema);
const UpdatePartnerRequest = registry.register("UpdatePartnerRequest", UpdatePartnerRequestSchema);
const Partner = registry.register("Partner", PartnerSchema);
const PartnerEnvelope = envelopeOf("Partner", Partner);
const PartnerListEnvelope = paginatedEnvelopeOf("Partner", Partner);
const PublicPartner = registry.register("PublicPartner", PublicPartnerSchema);
const PublicPartnerListEnvelope = registry.register("PublicPartnerListEnvelope", z.object({ data: z.array(PublicPartner).nullable(), meta: z.record(z.string(), z.unknown()).nullable(), error: ProblemDetails.nullable() }));

registry.registerPath({ method: "get", path: "/api/v1/crm/partners", summary: "List partners (admin)", tags: ["crm", "partners"], security: [{ cookieAuth: [] }], ...requiredPermission("content.view"), request: { query: ListPartnersQuerySchema }, responses: { 200: { description: "Partner list.", content: { "application/json": { schema: PartnerListEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "post", path: "/api/v1/crm/partners", summary: "Create a partner", tags: ["crm", "partners"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("content.manage"), request: { body: { content: { "application/json": { schema: CreatePartnerRequest } } }, headers: idempotencyKeyHeader }, responses: { 201: { description: "Partner created.", content: { "application/json": { schema: PartnerEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "patch", path: "/api/v1/crm/partners/{id}", summary: "Update a partner", tags: ["crm", "partners"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("content.manage"), request: { params: z.object({ id: z.string().uuid() }), body: { content: { "application/json": { schema: UpdatePartnerRequest } } }, headers: idempotencyKeyHeader }, responses: { 200: { description: "Partner updated.", content: { "application/json": { schema: PartnerEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "get", path: "/api/v1/public/partners", summary: "List published partners", tags: ["public", "partners"], responses: { 200: { description: "Published partner list.", content: { "application/json": { schema: PublicPartnerListEnvelope } } }, ...errorResponses } });

// -- Faculty bios --
const CreateFacultyBioRequest = registry.register("CreateFacultyBioRequest", CreateFacultyBioRequestSchema);
const UpdateFacultyBioRequest = registry.register("UpdateFacultyBioRequest", UpdateFacultyBioRequestSchema);
const FacultyBio = registry.register("FacultyBio", FacultyBioSchema);
const FacultyBioEnvelope = envelopeOf("FacultyBio", FacultyBio);
const FacultyBioListEnvelope = paginatedEnvelopeOf("FacultyBio", FacultyBio);
const PublicFacultyBio = registry.register("PublicFacultyBio", PublicFacultyBioSchema);
const PublicFacultyBioListEnvelope = registry.register("PublicFacultyBioListEnvelope", z.object({ data: z.array(PublicFacultyBio).nullable(), meta: z.record(z.string(), z.unknown()).nullable(), error: ProblemDetails.nullable() }));

registry.registerPath({ method: "get", path: "/api/v1/crm/faculty-bios", summary: "List faculty bios (admin)", tags: ["crm", "faculty-bios"], security: [{ cookieAuth: [] }], ...requiredPermission("content.view"), request: { query: ListFacultyBiosQuerySchema }, responses: { 200: { description: "Faculty bio list.", content: { "application/json": { schema: FacultyBioListEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "post", path: "/api/v1/crm/faculty-bios", summary: "Create a faculty bio", tags: ["crm", "faculty-bios"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("content.manage"), request: { body: { content: { "application/json": { schema: CreateFacultyBioRequest } } }, headers: idempotencyKeyHeader }, responses: { 201: { description: "Faculty bio created.", content: { "application/json": { schema: FacultyBioEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "patch", path: "/api/v1/crm/faculty-bios/{id}", summary: "Update a faculty bio", tags: ["crm", "faculty-bios"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("content.manage"), request: { params: z.object({ id: z.string().uuid() }), body: { content: { "application/json": { schema: UpdateFacultyBioRequest } } }, headers: idempotencyKeyHeader }, responses: { 200: { description: "Faculty bio updated.", content: { "application/json": { schema: FacultyBioEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "get", path: "/api/v1/public/faculty-bios", summary: "List published faculty bios", tags: ["public", "faculty-bios"], responses: { 200: { description: "Published faculty bio list.", content: { "application/json": { schema: PublicFacultyBioListEnvelope } } }, ...errorResponses } });

// -- Content pages --
const CreateContentPageRequest = registry.register("CreateContentPageRequest", CreateContentPageRequestSchema);
const UpdateContentPageRequest = registry.register("UpdateContentPageRequest", UpdateContentPageRequestSchema);
const ContentPageSummary = registry.register("ContentPageSummary", ContentPageSummarySchema);
const ContentPageDetail = registry.register("ContentPageDetail", ContentPageDetailSchema);
const ContentPageDetailEnvelope = envelopeOf("ContentPageDetail", ContentPageDetail);
const ContentPageListEnvelope = paginatedEnvelopeOf("ContentPage", ContentPageSummary);
const PublicContentPage = registry.register("PublicContentPage", PublicContentPageSchema);
const PublicContentPageEnvelope = envelopeOf("PublicContentPage", PublicContentPage);

registry.registerPath({ method: "get", path: "/api/v1/crm/content-pages", summary: "List content pages (admin)", tags: ["crm", "pages"], security: [{ cookieAuth: [] }], ...requiredPermission("content.view"), request: { query: ListContentPagesQuerySchema }, responses: { 200: { description: "Page list.", content: { "application/json": { schema: ContentPageListEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "post", path: "/api/v1/crm/content-pages", summary: "Create a content page", tags: ["crm", "pages"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("content.manage"), request: { body: { content: { "application/json": { schema: CreateContentPageRequest } } }, headers: idempotencyKeyHeader }, responses: { 201: { description: "Page created.", content: { "application/json": { schema: ContentPageDetailEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "patch", path: "/api/v1/crm/content-pages/{id}", summary: "Update a content page", tags: ["crm", "pages"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("content.manage"), request: { params: z.object({ id: z.string().uuid() }), body: { content: { "application/json": { schema: UpdateContentPageRequest } } }, headers: idempotencyKeyHeader }, responses: { 200: { description: "Page updated.", content: { "application/json": { schema: ContentPageDetailEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "get", path: "/api/v1/public/pages/{slug}", summary: "Get a published content page by slug (isBuilderManaged=true -> body resolved server-side incl. live_collection_ref)", tags: ["public", "pages"], request: { params: z.object({ slug: z.string().min(1) }) }, responses: { 200: { description: "Published page.", content: { "application/json": { schema: PublicContentPageEnvelope } } }, ...errorResponses } });

// -- Phase-10 page builder (docs/specs/phase-10-page-builder.md) --
// content.builder is super_admin-only (see prisma/seed.ts). All mutation endpoints
// require `Idempotency-Key` + `expectedVersion` (optimistic concurrency, Edge case #5 ->
// 409 on mismatch, code `content.builder.version_conflict`).
const ContentPageBuilderDetail = registry.register("ContentPageBuilderDetail", ContentPageBuilderDetailSchema);
const ContentPageBuilderDetailEnvelope = envelopeOf("ContentPageBuilderDetail", ContentPageBuilderDetail);
const CreateBuilderPageRequest = registry.register("CreateBuilderPageRequest", CreateBuilderPageRequestSchema);
const SaveBuilderPageRequest = registry.register("SaveBuilderPageRequest", SaveBuilderPageRequestSchema);
const PreviewBuilderPageRequest = registry.register("PreviewBuilderPageRequest", PreviewBuilderPageRequestSchema);
const PreviewBuilderPageResponse = registry.register("PreviewBuilderPageResponse", PreviewBuilderPageResponseSchema);
const PreviewBuilderPageEnvelope = envelopeOf("PreviewBuilderPage", PreviewBuilderPageResponse);
const ContentPageVersionSummary = registry.register("ContentPageVersionSummary", ContentPageVersionSummarySchema);
const ContentPageVersionListEnvelope = paginatedEnvelopeOf("ContentPageVersion", ContentPageVersionSummary);
const ContentPageVersionDetail = registry.register("ContentPageVersionDetail", ContentPageVersionDetailSchema);
const ContentPageVersionDetailEnvelope = envelopeOf("ContentPageVersionDetail", ContentPageVersionDetail);
const RevertContentPageVersionRequest = registry.register("RevertContentPageVersionRequest", RevertContentPageVersionRequestSchema);
const ContentPageMediaUploadUrlRequest = registry.register("ContentPageMediaUploadUrlRequest", ContentPageMediaUploadUrlRequestSchema);

registry.registerPath({ method: "post", path: "/api/v1/crm/content-pages/media-upload-url", summary: "Mint a signed PUT URL for a page-builder marketing image (raster only. No SVG, 5 MB cap)", tags: ["crm", "pages", "page-builder"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("content.builder"), request: { body: { content: { "application/json": { schema: ContentPageMediaUploadUrlRequest } } } }, responses: { 200: { description: "Signed upload URL + storageKey.", content: { "application/json": { schema: SignedUploadEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "post", path: "/api/v1/crm/content-pages/builder", summary: "Create a new, empty (body=[]) builder-managed page (status forced published; no version row until the first save)", tags: ["crm", "pages", "page-builder"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("content.builder"), request: { body: { content: { "application/json": { schema: CreateBuilderPageRequest } } }, headers: idempotencyKeyHeader }, responses: { 201: { description: "Builder page created.", content: { "application/json": { schema: ContentPageBuilderDetailEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "put", path: "/api/v1/crm/content-pages/{id}/builder", summary: "Save a builder page: validates the strict block union, snapshots the PRE-save state to a new ContentPageVersion, applies the new content, forces status=published (save-is-live, AC 1/2/3/5/6/12/13)", tags: ["crm", "pages", "page-builder"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("content.builder"), request: { params: z.object({ id: z.string().uuid() }), body: { content: { "application/json": { schema: SaveBuilderPageRequest } } }, headers: idempotencyKeyHeader }, responses: { 200: { description: "Page saved.", content: { "application/json": { schema: ContentPageBuilderDetailEnvelope } } }, ...errorResponses, 409: { description: "expectedVersion stale. Someone else saved since this was loaded (Edge case #5).", content: { "application/json": { schema: ErrorEnvelope } } } } });
registry.registerPath({ method: "post", path: "/api/v1/crm/content-pages/{id}/preview", summary: "Render unsaved edits with live_collection_ref resolved server-side, exactly as the public site would (AC 4). Read-only: no persistence, no version bump.", tags: ["crm", "pages", "page-builder"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("content.builder"), request: { params: z.object({ id: z.string().uuid() }), body: { content: { "application/json": { schema: PreviewBuilderPageRequest } } } }, responses: { 200: { description: "Resolved preview blocks.", content: { "application/json": { schema: PreviewBuilderPageEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "get", path: "/api/v1/crm/content-pages/{id}/versions", summary: "List version history, newest-first, metadata only (no body) (AC 6)", tags: ["crm", "pages", "page-builder"], security: [{ cookieAuth: [] }], ...requiredPermission("content.builder"), request: { params: z.object({ id: z.string().uuid() }), query: ListContentPageVersionsQuerySchema }, responses: { 200: { description: "Version list.", content: { "application/json": { schema: ContentPageVersionListEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "get", path: "/api/v1/crm/content-pages/{id}/versions/{version}", summary: "Get a single version's full snapshot (incl. body)", tags: ["crm", "pages", "page-builder"], security: [{ cookieAuth: [] }], ...requiredPermission("content.builder"), request: { params: z.object({ id: z.string().uuid(), version: z.coerce.number().int().min(1) }) }, responses: { 200: { description: "Version detail.", content: { "application/json": { schema: ContentPageVersionDetailEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "post", path: "/api/v1/crm/content-pages/{id}/versions/{version}/revert", summary: "Revert to a prior version: snapshots the CURRENT live state as a new version, then applies the target version's content live (AC 7. History is append-only, never rewound/deleted)", tags: ["crm", "pages", "page-builder"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("content.builder"), request: { params: z.object({ id: z.string().uuid(), version: z.coerce.number().int().min(1) }), body: { content: { "application/json": { schema: RevertContentPageVersionRequest } } }, headers: idempotencyKeyHeader }, responses: { 200: { description: "Reverted; new version created.", content: { "application/json": { schema: ContentPageBuilderDetailEnvelope } } }, ...errorResponses, 409: { description: "expectedVersion stale (Edge case #5).", content: { "application/json": { schema: ErrorEnvelope } } } } });

// -- Site settings (SiteSetting: nav/footer/SEO/contact primitives) --
// site_settings.view / site_settings.edit are super_admin-only (see prisma/seed.ts).
// P10-2: `stats.headline` was REMOVED entirely (real-user defect — apps/web never
// consumed it; the Page Builder `stat_group` block is the single source of truth for
// on-page stats). 7 keys remain.
const SiteSettingListSmall = registry.register("SiteSettingList", z.array(registry.register("SiteSetting", SiteSettingSchema)));
const SiteSettingListEnvelope = registry.register("SiteSettingListEnvelope", z.object({ data: SiteSettingListSmall.nullable(), meta: z.record(z.string(), z.unknown()).nullable(), error: ProblemDetails.nullable() }));
const SiteSettingEnvelope = envelopeOf("SiteSetting", registry.register("SiteSettingItem", SiteSettingSchema));
const UpsertSiteSettingRequest = registry.register("UpsertSiteSettingRequest", UpsertSiteSettingRequestSchema);
const PublicSiteSettingsResponse = registry.register("PublicSiteSettingsResponse", PublicSiteSettingsResponseSchema);
const PublicSiteSettingsEnvelope = envelopeOf("PublicSiteSettings", PublicSiteSettingsResponse);

registry.registerPath({ method: "get", path: "/api/v1/crm/site-settings", summary: "List site settings, optionally filtered by group (small, non-paginated: exactly the 8 seeded keys)", tags: ["crm", "site-settings"], security: [{ cookieAuth: [] }], ...requiredPermission("site_settings.view"), request: { query: ListSiteSettingsQuerySchema }, responses: { 200: { description: "Site setting list.", content: { "application/json": { schema: SiteSettingListEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "get", path: "/api/v1/crm/site-settings/{key}", summary: "Get a single site setting by key", tags: ["crm", "site-settings"], security: [{ cookieAuth: [] }], ...requiredPermission("site_settings.view"), request: { params: z.object({ key: SiteSettingKeySchema }) }, responses: { 200: { description: "Site setting detail.", content: { "application/json": { schema: SiteSettingEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "put", path: "/api/v1/crm/site-settings/{key}", summary: "Upsert a site setting's value (server validates `value` against that key's closed shape from SiteSettingValueSchemaByKey; 404 for any key outside the 8 seeded literals)", tags: ["crm", "site-settings"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("site_settings.edit"), request: { params: z.object({ key: SiteSettingKeySchema }), body: { content: { "application/json": { schema: UpsertSiteSettingRequest } } }, headers: idempotencyKeyHeader }, responses: { 200: { description: "Site setting set.", content: { "application/json": { schema: SiteSettingEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "get", path: "/api/v1/public/site-settings", summary: "Get all 8 sitewide settings values (anonymous, cacheable, nav/footer/SEO/contact/announcement)", tags: ["public", "site-settings"], responses: { 200: { description: "All site settings.", content: { "application/json": { schema: PublicSiteSettingsEnvelope } } }, ...errorResponses } });

// -- Colleges (Phase-11 locked templates, docs/plans/phase-11-locked-templates.md) --
// A College is a `Partner` row (category="college_partner") on its OWN dedicated CRM
// screen (crm/colleges.schemas.ts) — permissions reuse the SAME content.* keys as
// /crm/partners above (NOT a new permission domain). No public read endpoint: colleges
// surface on the site via the EXISTING /api/v1/public/partners?category=college_partner
// (see the "Partners" section above) through the page-builder's live_collection_ref
// mechanism.
const CreateCollegeRequest = registry.register("CreateCollegeRequest", CreateCollegeRequestSchema);
const UpdateCollegeRequest = registry.register("UpdateCollegeRequest", UpdateCollegeRequestSchema);
const College = registry.register("College", CollegeSchema);
const CollegeEnvelope = envelopeOf("College", College);
const CollegeListEnvelope = paginatedEnvelopeOf("College", College);
const DeleteCollegeResponse = registry.register("DeleteCollegeResponse", DeleteCollegeResponseSchema);
const CollegeLogoUploadUrlRequest = registry.register("CollegeLogoUploadUrlRequest", CollegeLogoUploadUrlRequestSchema);

registry.registerPath({ method: "post", path: "/api/v1/crm/colleges/logo-upload-url", summary: "Mint a signed PUT URL for a college logo (raster only. No SVG, 5 MB cap)", tags: ["crm", "colleges"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("content.edit"), request: { body: { content: { "application/json": { schema: CollegeLogoUploadUrlRequest } } } }, responses: { 200: { description: "Signed upload URL + storageKey.", content: { "application/json": { schema: SignedUploadEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "get", path: "/api/v1/crm/colleges", summary: "List colleges (admin), implicitly scoped to category=college_partner", tags: ["crm", "colleges"], security: [{ cookieAuth: [] }], ...requiredPermission("content.view"), request: { query: ListCollegesQuerySchema }, responses: { 200: { description: "College list.", content: { "application/json": { schema: CollegeListEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "post", path: "/api/v1/crm/colleges", summary: "Create a college", tags: ["crm", "colleges"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("content.manage"), request: { body: { content: { "application/json": { schema: CreateCollegeRequest } } }, headers: idempotencyKeyHeader }, responses: { 201: { description: "College created.", content: { "application/json": { schema: CollegeEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "patch", path: "/api/v1/crm/colleges/{id}", summary: "Update a college", tags: ["crm", "colleges"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("content.manage"), request: { params: z.object({ id: z.string().uuid() }), body: { content: { "application/json": { schema: UpdateCollegeRequest } } }, headers: idempotencyKeyHeader }, responses: { 200: { description: "College updated.", content: { "application/json": { schema: CollegeEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "delete", path: "/api/v1/crm/colleges/{id}", summary: "Soft-delete a college", tags: ["crm", "colleges"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("content.manage"), request: { params: z.object({ id: z.string().uuid() }) }, responses: { 200: { description: "Deleted.", content: { "application/json": { schema: envelopeOf("DeleteCollege", DeleteCollegeResponse) } } }, ...errorResponses } });

// -- Newsletter --
const SubscribeNewsletterRequest = registry.register("SubscribeNewsletterRequest", SubscribeNewsletterRequestSchema);
const SubscribeNewsletterResponse = registry.register("SubscribeNewsletterResponse", SubscribeNewsletterResponseSchema);
const SubscribeNewsletterEnvelope = envelopeOf("SubscribeNewsletter", SubscribeNewsletterResponse);
const NewsletterSubscription = registry.register("NewsletterSubscription", NewsletterSubscriptionSchema);
const NewsletterSubscriptionListEnvelope = paginatedEnvelopeOf("NewsletterSubscription", NewsletterSubscription);

registry.registerPath({ method: "post", path: "/api/v1/public/newsletter/subscribe", summary: "Subscribe to the newsletter (captcha-gated, re-subscribe reactivates)", tags: ["public", "newsletter"], request: { body: { content: { "application/json": { schema: SubscribeNewsletterRequest } } } }, responses: { 201: { description: "Subscribed.", content: { "application/json": { schema: SubscribeNewsletterEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "get", path: "/api/v1/public/newsletter/unsubscribe", summary: "Unsubscribe via signed email-link token", tags: ["public", "newsletter"], request: { query: UnsubscribeNewsletterQuerySchema }, responses: { 200: { description: "Unsubscribed.", content: { "application/json": { schema: SubscribeNewsletterEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "get", path: "/api/v1/crm/newsletter-subscriptions", summary: "List newsletter subscribers (admin)", tags: ["crm", "newsletter"], security: [{ cookieAuth: [] }], ...requiredPermission("content.view"), request: { query: ListNewsletterSubscriptionsQuerySchema }, responses: { 200: { description: "Subscriber list.", content: { "application/json": { schema: NewsletterSubscriptionListEnvelope } } }, ...errorResponses } });

// -- Contact --
const SubmitContactRequest = registry.register("SubmitContactRequest", SubmitContactRequestSchema);
const SubmitContactResponse = registry.register("SubmitContactResponse", SubmitContactResponseSchema);
const SubmitContactEnvelope = envelopeOf("SubmitContact", SubmitContactResponse);
const UpdateContactSubmissionStatusRequest = registry.register("UpdateContactSubmissionStatusRequest", UpdateContactSubmissionStatusRequestSchema);
const ContactSubmission = registry.register("ContactSubmission", ContactSubmissionSchema);
const ContactSubmissionEnvelope = envelopeOf("ContactSubmission", ContactSubmission);
const ContactSubmissionListEnvelope = paginatedEnvelopeOf("ContactSubmission", ContactSubmission);

registry.registerPath({ method: "post", path: "/api/v1/public/contact", summary: "Submit the contact form (captcha-gated, rate-limited)", tags: ["public", "contact"], request: { body: { content: { "application/json": { schema: SubmitContactRequest } } } }, responses: { 201: { description: "Submitted.", content: { "application/json": { schema: SubmitContactEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "get", path: "/api/v1/crm/contact-submissions", summary: "List contact submissions (admin)", tags: ["crm", "contact"], security: [{ cookieAuth: [] }], ...requiredPermission("content.view"), request: { query: ListContactSubmissionsQuerySchema }, responses: { 200: { description: "Submission list.", content: { "application/json": { schema: ContactSubmissionListEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "patch", path: "/api/v1/crm/contact-submissions/{id}", summary: "Update a contact submission's status", tags: ["crm", "contact"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("content.manage"), request: { params: z.object({ id: z.string().uuid() }), body: { content: { "application/json": { schema: UpdateContactSubmissionStatusRequest } } }, headers: idempotencyKeyHeader }, responses: { 200: { description: "Submission updated.", content: { "application/json": { schema: ContactSubmissionEnvelope } } }, ...errorResponses } });

// -- Careers --
const SubmitCareerApplicationRequest = registry.register("SubmitCareerApplicationRequest", SubmitCareerApplicationRequestSchema);
const SubmitCareerApplicationResponse = registry.register("SubmitCareerApplicationResponse", SubmitCareerApplicationResponseSchema);
const SubmitCareerApplicationEnvelope = envelopeOf("SubmitCareerApplication", SubmitCareerApplicationResponse);

const CareerApplicationSummary = registry.register("CareerApplicationSummary", CareerApplicationSummarySchema);
const CareerApplicationDetail = registry.register("CareerApplicationDetail", CareerApplicationDetailSchema);
const CareerApplicationDetailEnvelope = envelopeOf("CareerApplicationDetail", CareerApplicationDetail);
const CareerApplicationListEnvelope = paginatedEnvelopeOf("CareerApplication", CareerApplicationSummary);

const PublicCareerResumeUploadUrlRequest = registry.register("PublicCareerResumeUploadUrlRequest", PublicCareerResumeUploadUrlRequestSchema);
const PublicCareerResumeUploadUrlResponse = registry.register("PublicCareerResumeUploadUrlResponse", PublicCareerResumeUploadUrlResponseSchema);
const PublicCareerResumeUploadUrlEnvelope = envelopeOf("PublicCareerResumeUploadUrl", PublicCareerResumeUploadUrlResponse);

registry.registerPath({ method: "post", path: "/api/v1/public/careers/resume-upload-url", summary: "Mint a signed resume-upload URL for an anonymous applicant (captcha-gated, rate-limited)", tags: ["public", "careers"], request: { body: { content: { "application/json": { schema: PublicCareerResumeUploadUrlRequest } } } }, responses: { 200: { description: "Signed upload URL.", content: { "application/json": { schema: PublicCareerResumeUploadUrlEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "post", path: "/api/v1/public/careers/apply", summary: "Submit a career application (resume via StorageProvider signed upload; captcha-gated)", tags: ["public", "careers"], request: { body: { content: { "application/json": { schema: SubmitCareerApplicationRequest } } } }, responses: { 201: { description: "Submitted.", content: { "application/json": { schema: SubmitCareerApplicationEnvelope } } }, ...errorResponses } });
// Openings — public read, CRM CRUD. Note the permission split described in
// careers.controller.ts: reading the roster is careers.view (the applications screen filters
// by opening), writing an advert is careers.openings.manage.
const PublicJobOpening = registry.register("PublicJobOpening", PublicJobOpeningSchema);
const PublicJobOpeningListEnvelope = envelopeOf("PublicJobOpeningList", z.array(PublicJobOpening));
const JobOpening = registry.register("JobOpening", JobOpeningSchema);
const JobOpeningEnvelope = envelopeOf("JobOpening", JobOpening);
const JobOpeningListEnvelope = paginatedEnvelopeOf("JobOpening", JobOpening);
const CreateJobOpeningRequest = registry.register("CreateJobOpeningRequest", CreateJobOpeningRequestSchema);
const UpdateJobOpeningRequest = registry.register("UpdateJobOpeningRequest", UpdateJobOpeningRequestSchema);

registry.registerPath({ method: "get", path: "/api/v1/public/careers/openings", summary: "List the live job openings (published, not past their closing date)", tags: ["public", "careers"], request: { query: ListPublicJobOpeningsQuerySchema }, responses: { 200: { description: "Open roles.", content: { "application/json": { schema: PublicJobOpeningListEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "get", path: "/api/v1/public/careers/openings/{slug}", summary: "Get one live job opening by slug (404 for draft/lapsed)", tags: ["public", "careers"], request: { params: z.object({ slug: z.string() }) }, responses: { 200: { description: "The role.", content: { "application/json": { schema: envelopeOf("PublicJobOpeningDetail", PublicJobOpening) } } }, ...errorResponses } });
registry.registerPath({ method: "get", path: "/api/v1/crm/job-openings", summary: "List job openings incl. applicant counts (admin)", tags: ["crm", "careers"], security: [{ cookieAuth: [] }], ...requiredPermission("careers.view"), request: { query: ListJobOpeningsQuerySchema }, responses: { 200: { description: "Opening list.", content: { "application/json": { schema: JobOpeningListEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "get", path: "/api/v1/crm/job-openings/{id}", summary: "Get a job opening", tags: ["crm", "careers"], security: [{ cookieAuth: [] }], ...requiredPermission("careers.view"), request: { params: z.object({ id: z.string().uuid() }) }, responses: { 200: { description: "Opening.", content: { "application/json": { schema: JobOpeningEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "post", path: "/api/v1/crm/job-openings", summary: "Create a job opening", tags: ["crm", "careers"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("careers.openings.manage"), request: { body: { content: { "application/json": { schema: CreateJobOpeningRequest } } } }, responses: { 201: { description: "Created.", content: { "application/json": { schema: JobOpeningEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "patch", path: "/api/v1/crm/job-openings/{id}", summary: "Update a job opening", tags: ["crm", "careers"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("careers.openings.manage"), request: { params: z.object({ id: z.string().uuid() }), body: { content: { "application/json": { schema: UpdateJobOpeningRequest } } } }, responses: { 200: { description: "Updated.", content: { "application/json": { schema: JobOpeningEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "delete", path: "/api/v1/crm/job-openings/{id}", summary: "Soft-delete a job opening (prefer closing it)", tags: ["crm", "careers"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("careers.openings.manage"), request: { params: z.object({ id: z.string().uuid() }) }, responses: { 200: { description: "Deleted.", content: { "application/json": { schema: envelopeOf("DeleteJobOpening", z.object({ deleted: z.literal(true) })) } } }, ...errorResponses } });

// Applications — reads under careers.view, every decision under careers.review.
registry.registerPath({ method: "get", path: "/api/v1/crm/career-applications", summary: "List career applications (admin)", tags: ["crm", "careers"], security: [{ cookieAuth: [] }], ...requiredPermission("careers.view"), request: { query: ListCareerApplicationsQuerySchema }, responses: { 200: { description: "Application list.", content: { "application/json": { schema: CareerApplicationListEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "get", path: "/api/v1/crm/career-applications/{id}", summary: "Get a career application incl. signed resume + offer-letter download URLs", tags: ["crm", "careers"], security: [{ cookieAuth: [] }], ...requiredPermission("careers.view"), request: { params: z.object({ id: z.string().uuid() }) }, responses: { 200: { description: "Application detail.", content: { "application/json": { schema: CareerApplicationDetailEnvelope } } }, ...errorResponses } });

// THE FOUR REVIEW VERBS. Deliberately four endpoints rather than one status PATCH — each
// sends a different email (or, for hold, none at all) and carries what only it needs. See
// careers.schemas.ts's file header.
const HoldCareerApplicationRequest = registry.register("HoldCareerApplicationRequest", HoldCareerApplicationRequestSchema);
const ShortlistCareerApplicationRequest = registry.register("ShortlistCareerApplicationRequest", ShortlistCareerApplicationRequestSchema);
const OfferCareerApplicationRequest = registry.register("OfferCareerApplicationRequest", OfferCareerApplicationRequestSchema);
const RejectCareerApplicationRequest = registry.register("RejectCareerApplicationRequest", RejectCareerApplicationRequestSchema);
const OfferLetterUploadUrlRequest = registry.register("OfferLetterUploadUrlRequest", OfferLetterUploadUrlRequestSchema);
const ResendAcknowledgementResponse = registry.register("ResendAcknowledgementResponse", ResendAcknowledgementResponseSchema);
const ResendAcknowledgementEnvelope = envelopeOf("ResendAcknowledgement", ResendAcknowledgementResponse);

registry.registerPath({ method: "post", path: "/api/v1/crm/career-applications/{id}/hold", summary: "Put a candidate on hold (the one verb that sends no email)", tags: ["crm", "careers"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("careers.review"), request: { params: z.object({ id: z.string().uuid() }), body: { content: { "application/json": { schema: HoldCareerApplicationRequest } } } }, responses: { 200: { description: "Held.", content: { "application/json": { schema: CareerApplicationDetailEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "post", path: "/api/v1/crm/career-applications/{id}/shortlist", summary: "Move a candidate to a further round and email them the details", tags: ["crm", "careers"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("careers.review"), request: { params: z.object({ id: z.string().uuid() }), body: { content: { "application/json": { schema: ShortlistCareerApplicationRequest } } } }, responses: { 200: { description: "Shortlisted.", content: { "application/json": { schema: CareerApplicationDetailEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "post", path: "/api/v1/crm/career-applications/{id}/offer", summary: "Offer the role and email the uploaded offer letter as an attachment", tags: ["crm", "careers"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("careers.review"), request: { params: z.object({ id: z.string().uuid() }), body: { content: { "application/json": { schema: OfferCareerApplicationRequest } } } }, responses: { 200: { description: "Offered.", content: { "application/json": { schema: CareerApplicationDetailEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "post", path: "/api/v1/crm/career-applications/{id}/reject", summary: "Decline a candidate and email them (the internal reason is never sent)", tags: ["crm", "careers"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("careers.review"), request: { params: z.object({ id: z.string().uuid() }), body: { content: { "application/json": { schema: RejectCareerApplicationRequest } } } }, responses: { 200: { description: "Rejected.", content: { "application/json": { schema: CareerApplicationDetailEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "post", path: "/api/v1/crm/career-applications/{id}/offer-letter-upload-url", summary: "Mint a signed PUT URL for a staff-uploaded offer letter", tags: ["crm", "careers"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("careers.review"), request: { params: z.object({ id: z.string().uuid() }), body: { content: { "application/json": { schema: OfferLetterUploadUrlRequest } } } }, responses: { 200: { description: "Signed upload URL.", content: { "application/json": { schema: PublicCareerResumeUploadUrlEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "post", path: "/api/v1/crm/career-applications/{id}/resend-acknowledgement", summary: "Re-send the acknowledgement when the automatic one failed", tags: ["crm", "careers"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("careers.review"), request: { params: z.object({ id: z.string().uuid() }) }, responses: { 200: { description: "Send outcome.", content: { "application/json": { schema: ResendAcknowledgementEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "delete", path: "/api/v1/crm/career-applications/{id}", summary: "Soft-delete a career application (spam, duplicate, or an erasure request)", tags: ["crm", "careers"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("careers.review"), request: { params: z.object({ id: z.string().uuid() }) }, responses: { 200: { description: "Deleted.", content: { "application/json": { schema: envelopeOf("DeleteCareerApplication", z.object({ deleted: z.literal(true) })) } } }, ...errorResponses } });

// ── Settings ─────────────────────────────────────────────────────────────

import {
  SetSettingRequestSchema,
  ListSettingsQuerySchema,
  SettingSchema,
} from "../platform/settings.schemas.js";

const SetSettingRequest = registry.register("SetSettingRequest", SetSettingRequestSchema);
const Setting = registry.register("Setting", SettingSchema);
const SettingEnvelope = envelopeOf("Setting", Setting);
const SettingListEnvelope = paginatedEnvelopeOf("Setting", Setting);

registry.registerPath({ method: "get", path: "/api/v1/crm/settings", summary: "List settings (system+company scope)", tags: ["crm", "settings"], security: [{ cookieAuth: [] }], ...requiredPermission("settings.view"), request: { query: ListSettingsQuerySchema }, responses: { 200: { description: "Setting list.", content: { "application/json": { schema: SettingListEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "get", path: "/api/v1/crm/settings/{scope}/{key}", summary: "Get a single setting by (scope,key)", tags: ["crm", "settings"], security: [{ cookieAuth: [] }], ...requiredPermission("settings.view"), request: { params: z.object({ scope: z.enum(["system", "company"]), key: z.string().min(1) }) }, responses: { 200: { description: "Setting detail.", content: { "application/json": { schema: SettingEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "put", path: "/api/v1/crm/settings/{scope}/{key}", summary: "Create or update a setting by (scope,key)", tags: ["crm", "settings"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("settings.manage (system scope: Owner/Admin only)"), request: { params: z.object({ scope: z.enum(["system", "company"]), key: z.string().min(1) }), body: { content: { "application/json": { schema: SetSettingRequest } } }, headers: idempotencyKeyHeader }, responses: { 200: { description: "Setting set.", content: { "application/json": { schema: SettingEnvelope } } }, ...errorResponses } });

// ── LMS: bookmarks, lesson notes, search, learning path (T10/T29/T35/T36) ─

import {
  CreateBookmarkRequestSchema,
  ListBookmarksQuerySchema,
  BookmarkSchema,
} from "../lms/bookmarks.schemas.js";
import {
  CreateLessonNoteRequestSchema,
  UpdateLessonNoteRequestSchema,
  ListLessonNotesQuerySchema,
  LessonNoteSchema,
} from "../lms/lesson-notes.schemas.js";
import { GlobalSearchQuerySchema, GlobalSearchResponseSchema } from "../lms/search.schemas.js";
import { LearningPathResponseSchema } from "../lms/learning-path.schemas.js";

const CreateBookmarkRequest = registry.register("CreateBookmarkRequest", CreateBookmarkRequestSchema);
const Bookmark = registry.register("Bookmark", BookmarkSchema);
const BookmarkEnvelope = envelopeOf("Bookmark", Bookmark);
const BookmarkListEnvelope = paginatedEnvelopeOf("Bookmark", Bookmark);

registry.registerPath({ method: "get", path: "/api/v1/me/bookmarks", summary: "List own bookmarks", tags: ["lms", "bookmarks"], security: [{ cookieAuth: [] }], ...requiredPermission("bookmarks.view (scope: own)"), request: { query: ListBookmarksQuerySchema }, responses: { 200: { description: "Bookmark list.", content: { "application/json": { schema: BookmarkListEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "post", path: "/api/v1/me/bookmarks", summary: "Create a bookmark", tags: ["lms", "bookmarks"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("bookmarks.create (scope: own)"), request: { body: { content: { "application/json": { schema: CreateBookmarkRequest } } }, headers: idempotencyKeyHeader }, responses: { 201: { description: "Bookmark created.", content: { "application/json": { schema: BookmarkEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "delete", path: "/api/v1/me/bookmarks/{id}", summary: "Delete own bookmark (IDOR->404 on another user's)", tags: ["lms", "bookmarks"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("bookmarks.create (scope: own)"), request: { params: z.object({ id: z.string().uuid() }), headers: idempotencyKeyHeader }, responses: { 200: { description: "Bookmark deleted.", content: { "application/json": { schema: BookmarkEnvelope } } }, ...errorResponses } });

const CreateLessonNoteRequest = registry.register("CreateLessonNoteRequest", CreateLessonNoteRequestSchema);
const UpdateLessonNoteRequest = registry.register("UpdateLessonNoteRequest", UpdateLessonNoteRequestSchema);
const LessonNote = registry.register("LessonNote", LessonNoteSchema);
const LessonNoteEnvelope = envelopeOf("LessonNote", LessonNote);
const LessonNoteListEnvelope = paginatedEnvelopeOf("LessonNote", LessonNote);

registry.registerPath({ method: "get", path: "/api/v1/me/lessons/{lessonId}/notes", summary: "List own notes on a lesson", tags: ["lms", "notes"], security: [{ cookieAuth: [] }], ...requiredPermission("notes.view (scope: own)"), request: { params: z.object({ lessonId: z.string().uuid() }), query: ListLessonNotesQuerySchema }, responses: { 200: { description: "Note list.", content: { "application/json": { schema: LessonNoteListEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "post", path: "/api/v1/me/lessons/{lessonId}/notes", summary: "Create a note on a lesson", tags: ["lms", "notes"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("notes.create (scope: own)"), request: { params: z.object({ lessonId: z.string().uuid() }), body: { content: { "application/json": { schema: CreateLessonNoteRequest } } }, headers: idempotencyKeyHeader }, responses: { 201: { description: "Note created.", content: { "application/json": { schema: LessonNoteEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "patch", path: "/api/v1/me/lessons/{lessonId}/notes/{noteId}", summary: "Update own note", tags: ["lms", "notes"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("notes.create (scope: own)"), request: { params: z.object({ lessonId: z.string().uuid(), noteId: z.string().uuid() }), body: { content: { "application/json": { schema: UpdateLessonNoteRequest } } }, headers: idempotencyKeyHeader }, responses: { 200: { description: "Note updated.", content: { "application/json": { schema: LessonNoteEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "delete", path: "/api/v1/me/lessons/{lessonId}/notes/{noteId}", summary: "Delete own note", tags: ["lms", "notes"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("notes.create (scope: own)"), request: { params: z.object({ lessonId: z.string().uuid(), noteId: z.string().uuid() }), headers: idempotencyKeyHeader }, responses: { 200: { description: "Note deleted.", content: { "application/json": { schema: LessonNoteEnvelope } } }, ...errorResponses } });

const GlobalSearchResponse = registry.register("GlobalSearchResponse", GlobalSearchResponseSchema);
const GlobalSearchEnvelope = envelopeOf("GlobalSearch", GlobalSearchResponse);
registry.registerPath({ method: "get", path: "/api/v1/me/search", summary: "Global search across own-scoped lessons/resources/forum threads", tags: ["lms", "search"], security: [{ cookieAuth: [] }], ...requiredPermission("search.use (scope: own)"), request: { query: GlobalSearchQuerySchema }, responses: { 200: { description: "Search results.", content: { "application/json": { schema: GlobalSearchEnvelope } } }, ...errorResponses } });

const LearningPathResponse = registry.register("LearningPathResponse", LearningPathResponseSchema);
const LearningPathEnvelope = envelopeOf("LearningPath", LearningPathResponse);
registry.registerPath({ method: "get", path: "/api/v1/me/learning-path", summary: "Own recommended next-step sequence across active enrollments", tags: ["lms", "learning-path"], security: [{ cookieAuth: [] }], ...requiredPermission("progress.view (scope: own)"), responses: { 200: { description: "Learning path.", content: { "application/json": { schema: LearningPathEnvelope } } }, ...errorResponses } });

// ── Commerce: referrals, EMI + dunning, receipt PDF (T11/T24/T25/T27) ────

import {
  CreateReferralRequestSchema,
  ListReferralsQuerySchema,
  ReferralSchema,
  RedeemReferralRequestSchema,
  RedeemReferralResponseSchema,
  UpdateReferralStatusRequestSchema,
} from "../commerce/referrals.schemas.js";
import {
  CreateEmiPlanRequestSchema,
  ListEmiPlansQuerySchema,
  EmiPlanSummarySchema,
  EmiPlanDetailSchema,
  MarkEmiInstallmentPaidRequestSchema,
  TriggerEmiDunningRequestSchema,
} from "../commerce/emi.schemas.js";
import { ReceiptDownloadResponseSchema } from "../commerce/invoices.schemas.js";

const CreateReferralRequest = registry.register("CreateReferralRequest", CreateReferralRequestSchema);
const Referral = registry.register("Referral", ReferralSchema);
const ReferralEnvelope = envelopeOf("Referral", Referral);
const ReferralListEnvelope = paginatedEnvelopeOf("Referral", Referral);
const RedeemReferralRequest = registry.register("RedeemReferralRequest", RedeemReferralRequestSchema);
const RedeemReferralResponse = registry.register("RedeemReferralResponse", RedeemReferralResponseSchema);
const RedeemReferralEnvelope = envelopeOf("RedeemReferral", RedeemReferralResponse);
const UpdateReferralStatusRequest = registry.register("UpdateReferralStatusRequest", UpdateReferralStatusRequestSchema);

registry.registerPath({ method: "get", path: "/api/v1/me/referrals", summary: "List own referrals", tags: ["commerce", "referrals"], security: [{ cookieAuth: [] }], ...requiredPermission("referrals.view (scope: own)"), request: { query: ListReferralsQuerySchema }, responses: { 200: { description: "Own referral list.", content: { "application/json": { schema: ReferralListEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "post", path: "/api/v1/me/referrals", summary: "Create a new referral code for the caller", tags: ["commerce", "referrals"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("referrals.create (scope: own)"), request: { body: { content: { "application/json": { schema: CreateReferralRequest } } }, headers: idempotencyKeyHeader }, responses: { 201: { description: "Referral created.", content: { "application/json": { schema: ReferralEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "post", path: "/api/v1/public/referrals/redeem", summary: "Attach a referral code to a freshly captured lead (anti-self-referral is a 422 business rule)", tags: ["public", "referrals"], request: { body: { content: { "application/json": { schema: RedeemReferralRequest } } } }, responses: { 200: { description: "Redeemed.", content: { "application/json": { schema: RedeemReferralEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "get", path: "/api/v1/crm/referrals", summary: "List all referrals (staff oversight)", tags: ["crm", "referrals"], security: [{ cookieAuth: [] }], ...requiredPermission("referrals.view (scope: all)"), request: { query: ListReferralsQuerySchema }, responses: { 200: { description: "Referral list.", content: { "application/json": { schema: ReferralListEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "patch", path: "/api/v1/crm/referrals/{id}", summary: "Manually transition a referral's reward status", tags: ["crm", "referrals"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("referrals.manage"), request: { params: z.object({ id: z.string().uuid() }), body: { content: { "application/json": { schema: UpdateReferralStatusRequest } } }, headers: idempotencyKeyHeader }, responses: { 200: { description: "Referral updated.", content: { "application/json": { schema: ReferralEnvelope } } }, ...errorResponses } });

const CreateEmiPlanRequest = registry.register("CreateEmiPlanRequest", CreateEmiPlanRequestSchema);
const EmiPlanSummary = registry.register("EmiPlanSummary", EmiPlanSummarySchema);
const EmiPlanDetail = registry.register("EmiPlanDetail", EmiPlanDetailSchema);
const EmiPlanDetailEnvelope = envelopeOf("EmiPlanDetail", EmiPlanDetail);
const EmiPlanListEnvelope = paginatedEnvelopeOf("EmiPlan", EmiPlanSummary);
const MarkEmiInstallmentPaidRequest = registry.register("MarkEmiInstallmentPaidRequest", MarkEmiInstallmentPaidRequestSchema);
const TriggerEmiDunningRequest = registry.register("TriggerEmiDunningRequest", TriggerEmiDunningRequestSchema);

registry.registerPath({ method: "get", path: "/api/v1/crm/emi-plans", summary: "List EMI plans (Finance/Admin)", tags: ["crm", "emi"], security: [{ cookieAuth: [] }], ...requiredPermission("emi.view"), request: { query: ListEmiPlansQuerySchema }, responses: { 200: { description: "EMI plan list.", content: { "application/json": { schema: EmiPlanListEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "post", path: "/api/v1/crm/emi-plans", summary: "Create an EMI plan against an order (server computes the installment schedule)", tags: ["crm", "emi"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("emi.manage"), request: { body: { content: { "application/json": { schema: CreateEmiPlanRequest } } }, headers: idempotencyKeyHeader }, responses: { 201: { description: "EMI plan created.", content: { "application/json": { schema: EmiPlanDetailEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "get", path: "/api/v1/crm/emi-plans/{id}", summary: "Get an EMI plan incl. installment schedule", tags: ["crm", "emi"], security: [{ cookieAuth: [] }], ...requiredPermission("emi.view"), request: { params: z.object({ id: z.string().uuid() }) }, responses: { 200: { description: "EMI plan detail.", content: { "application/json": { schema: EmiPlanDetailEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "post", path: "/api/v1/crm/emi-plans/{id}/installments/{installmentId}/mark-paid", summary: "Mark an installment paid (idempotent; runs a Razorpay TEST charge)", tags: ["crm", "emi"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("emi.manage"), request: { params: z.object({ id: z.string().uuid(), installmentId: z.string().uuid() }), body: { content: { "application/json": { schema: MarkEmiInstallmentPaidRequest } } }, headers: idempotencyKeyHeader }, responses: { 200: { description: "Installment marked paid.", content: { "application/json": { schema: EmiPlanDetailEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "post", path: "/api/v1/crm/emi-plans/{id}/installments/{installmentId}/dunning", summary: "Manually trigger a dunning reminder for an overdue installment", tags: ["crm", "emi"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("emi.manage"), request: { params: z.object({ id: z.string().uuid(), installmentId: z.string().uuid() }), body: { content: { "application/json": { schema: TriggerEmiDunningRequest } } }, headers: idempotencyKeyHeader }, responses: { 200: { description: "Dunning reminder enqueued.", content: { "application/json": { schema: EmiPlanDetailEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "get", path: "/api/v1/me/emi-plans", summary: "List own EMI plans (via own orders)", tags: ["lms", "emi"], security: [{ cookieAuth: [] }], ...requiredPermission("emi.view (scope: own)"), request: { query: ListEmiPlansQuerySchema }, responses: { 200: { description: "Own EMI plan list.", content: { "application/json": { schema: EmiPlanListEnvelope } } }, ...errorResponses } });

const ReceiptDownloadResponse = registry.register("ReceiptDownloadResponse", ReceiptDownloadResponseSchema);
const ReceiptDownloadEnvelope = envelopeOf("ReceiptDownload", ReceiptDownloadResponse);
registry.registerPath({ method: "get", path: "/api/v1/commerce/payments/{id}/receipt", summary: "Get a signed download URL for a payment's receipt PDF (owner or Finance/Admin)", tags: ["commerce", "invoices"], security: [{ cookieAuth: [] }], ...requiredPermission("payments.view (scope: own|all)"), request: { params: z.object({ id: z.string().uuid() }) }, responses: { 200: { description: "Receipt download URL.", content: { "application/json": { schema: ReceiptDownloadEnvelope } } }, ...errorResponses } });

// ── Growth: landing pages, lead forms (T12/T33/T40) ──────────────────────

import {
  CreateLandingPageRequestSchema,
  UpdateLandingPageRequestSchema,
  ListLandingPagesQuerySchema,
  LandingPageSummarySchema,
  LandingPageDetailSchema,
  GetPublicLandingPageQuerySchema,
  PublicLandingPageSchema,
} from "../growth/landing-pages.schemas.js";
import {
  CreateLeadFormRequestSchema,
  UpdateLeadFormRequestSchema,
  ListLeadFormsQuerySchema,
  LeadFormSchema,
  PublicLeadFormSchema,
} from "../growth/lead-forms.schemas.js";

const CreateLandingPageRequest = registry.register("CreateLandingPageRequest", CreateLandingPageRequestSchema);
const UpdateLandingPageRequest = registry.register("UpdateLandingPageRequest", UpdateLandingPageRequestSchema);
const LandingPageSummary = registry.register("LandingPageSummary", LandingPageSummarySchema);
const LandingPageDetail = registry.register("LandingPageDetail", LandingPageDetailSchema);
const LandingPageDetailEnvelope = envelopeOf("LandingPageDetail", LandingPageDetail);
const LandingPageListEnvelope = paginatedEnvelopeOf("LandingPage", LandingPageSummary);
const PublicLandingPage = registry.register("PublicLandingPage", PublicLandingPageSchema);
const PublicLandingPageEnvelope = envelopeOf("PublicLandingPage", PublicLandingPage);

registry.registerPath({ method: "get", path: "/api/v1/crm/landing-pages", summary: "List landing pages (admin)", tags: ["crm", "landing-pages"], security: [{ cookieAuth: [] }], ...requiredPermission("landing_pages.view"), request: { query: ListLandingPagesQuerySchema }, responses: { 200: { description: "Landing page list.", content: { "application/json": { schema: LandingPageListEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "get", path: "/api/v1/crm/landing-pages/{id}", summary: "Get a landing page (admin)", tags: ["crm", "landing-pages"], security: [{ cookieAuth: [] }], ...requiredPermission("landing_pages.view"), request: { params: z.object({ id: z.string().uuid() }) }, responses: { 200: { description: "Landing page detail.", content: { "application/json": { schema: LandingPageDetailEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "post", path: "/api/v1/crm/landing-pages", summary: "Create a landing page (campaign + A/B variant)", tags: ["crm", "landing-pages"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("landing_pages.edit"), request: { body: { content: { "application/json": { schema: CreateLandingPageRequest } } }, headers: idempotencyKeyHeader }, responses: { 201: { description: "Landing page created.", content: { "application/json": { schema: LandingPageDetailEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "patch", path: "/api/v1/crm/landing-pages/{id}", summary: "Update (or publish) a landing page", tags: ["crm", "landing-pages"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("landing_pages.edit"), request: { params: z.object({ id: z.string().uuid() }), body: { content: { "application/json": { schema: UpdateLandingPageRequest } } }, headers: idempotencyKeyHeader }, responses: { 200: { description: "Landing page updated.", content: { "application/json": { schema: LandingPageDetailEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "delete", path: "/api/v1/crm/landing-pages/{id}", summary: "Soft-delete a landing page", tags: ["crm", "landing-pages"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("landing_pages.edit"), request: { params: z.object({ id: z.string().uuid() }) }, responses: { 200: { description: "Deleted.", content: { "application/json": { schema: z.object({ deleted: z.literal(true) }) } } }, ...errorResponses } });
registry.registerPath({ method: "get", path: "/api/v1/public/landing-pages/{slug}", summary: "Render a published landing page (server resolves the A/B variant when omitted)", tags: ["public", "landing-pages"], request: { params: z.object({ slug: z.string().min(1) }), query: GetPublicLandingPageQuerySchema }, responses: { 200: { description: "Rendered landing page.", content: { "application/json": { schema: PublicLandingPageEnvelope } } }, ...errorResponses } });

const CreateLeadFormRequest = registry.register("CreateLeadFormRequest", CreateLeadFormRequestSchema);
const UpdateLeadFormRequest = registry.register("UpdateLeadFormRequest", UpdateLeadFormRequestSchema);
const LeadForm = registry.register("LeadForm", LeadFormSchema);
const LeadFormEnvelope = envelopeOf("LeadForm", LeadForm);
const LeadFormListEnvelope = paginatedEnvelopeOf("LeadForm", LeadForm);
const PublicLeadForm = registry.register("PublicLeadForm", PublicLeadFormSchema);
const PublicLeadFormEnvelope = envelopeOf("PublicLeadForm", PublicLeadForm);

registry.registerPath({ method: "get", path: "/api/v1/crm/lead-forms", summary: "List lead-form configs (admin)", tags: ["crm", "lead-forms"], security: [{ cookieAuth: [] }], ...requiredPermission("lead_forms.view"), request: { query: ListLeadFormsQuerySchema }, responses: { 200: { description: "Lead-form list.", content: { "application/json": { schema: LeadFormListEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "get", path: "/api/v1/crm/lead-forms/{id}", summary: "Get a lead-form config (admin)", tags: ["crm", "lead-forms"], security: [{ cookieAuth: [] }], ...requiredPermission("lead_forms.view"), request: { params: z.object({ id: z.string().uuid() }) }, responses: { 200: { description: "Lead-form detail.", content: { "application/json": { schema: LeadFormEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "post", path: "/api/v1/crm/lead-forms", summary: "Create a lead-form config", tags: ["crm", "lead-forms"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("lead_forms.edit"), request: { body: { content: { "application/json": { schema: CreateLeadFormRequest } } }, headers: idempotencyKeyHeader }, responses: { 201: { description: "Lead-form created.", content: { "application/json": { schema: LeadFormEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "patch", path: "/api/v1/crm/lead-forms/{id}", summary: "Update a lead-form config", tags: ["crm", "lead-forms"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("lead_forms.edit"), request: { params: z.object({ id: z.string().uuid() }), body: { content: { "application/json": { schema: UpdateLeadFormRequest } } }, headers: idempotencyKeyHeader }, responses: { 200: { description: "Lead-form updated.", content: { "application/json": { schema: LeadFormEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "delete", path: "/api/v1/crm/lead-forms/{id}", summary: "Soft-delete a lead-form config", tags: ["crm", "lead-forms"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("lead_forms.edit"), request: { params: z.object({ id: z.string().uuid() }) }, responses: { 200: { description: "Deleted.", content: { "application/json": { schema: z.object({ deleted: z.literal(true) }) } } }, ...errorResponses } });
registry.registerPath({ method: "get", path: "/api/v1/public/lead-forms/{key}", summary: "Get an active lead-form's field config by key (404 if inactive/missing)", tags: ["public", "lead-forms"], request: { params: z.object({ key: z.string().min(1) }) }, responses: { 200: { description: "Lead-form config.", content: { "application/json": { schema: PublicLeadFormEnvelope } } }, ...errorResponses } });

// ── Password reset (B9/T28) ──────────────────────────────────────────────

import {
  RequestPasswordResetRequestSchema,
  RequestPasswordResetResponseSchema,
  ConfirmPasswordResetRequestSchema,
  ConfirmPasswordResetResponseSchema,
} from "../auth/password-reset.schemas.js";

const RequestPasswordResetRequest = registry.register("RequestPasswordResetRequest", RequestPasswordResetRequestSchema);
const RequestPasswordResetResponse = registry.register("RequestPasswordResetResponse", RequestPasswordResetResponseSchema);
const RequestPasswordResetEnvelope = envelopeOf("RequestPasswordReset", RequestPasswordResetResponse);
const ConfirmPasswordResetRequest = registry.register("ConfirmPasswordResetRequest", ConfirmPasswordResetRequestSchema);
const ConfirmPasswordResetResponse = registry.register("ConfirmPasswordResetResponse", ConfirmPasswordResetResponseSchema);
const ConfirmPasswordResetEnvelope = envelopeOf("ConfirmPasswordReset", ConfirmPasswordResetResponse);

registry.registerPath({ method: "post", path: "/api/v1/auth/password-reset/request", summary: "Request a password reset email (enumeration-resistant, always 200)", tags: ["auth"], request: { body: { content: { "application/json": { schema: RequestPasswordResetRequest } } } }, responses: { 200: { description: "Request accepted.", content: { "application/json": { schema: RequestPasswordResetEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "post", path: "/api/v1/auth/password-reset/confirm", summary: "Confirm a password reset with the single-use emailed token", tags: ["auth"], request: { body: { content: { "application/json": { schema: ConfirmPasswordResetRequest } } } }, responses: { 200: { description: "Password reset.", content: { "application/json": { schema: ConfirmPasswordResetEnvelope } } }, ...errorResponses } });

// ── Two-factor auth (TOTP) — Phase-9-completion gap #8 ──────────────────────

import {
  TotpEnrollResponseSchema,
  TotpVerifyEnrollRequestSchema,
  TotpVerifyEnrollResponseSchema,
  TotpDisableRequestSchema,
  TotpStatusResponseSchema,
  TwoFactorLoginVerifyRequestSchema,
} from "../auth/two-factor.schemas.js";
import {
  TwoFactorRecoveryRequestSchema,
  TwoFactorRecoveryRequestResponseSchema,
  TwoFactorRecoveryConfirmSchema,
  TwoFactorRecoveryConfirmResponseSchema,
  AdminClearTwoFactorRequestSchema,
  AdminClearTwoFactorResponseSchema,
} from "../auth/two-factor-recovery.schemas.js";

const TotpEnrollResponse = registry.register("TotpEnrollResponse", TotpEnrollResponseSchema);
const TotpEnrollEnvelope = envelopeOf("TotpEnroll", TotpEnrollResponse);
const TotpVerifyEnrollRequest = registry.register("TotpVerifyEnrollRequest", TotpVerifyEnrollRequestSchema);
const TotpVerifyEnrollResponse = registry.register("TotpVerifyEnrollResponse", TotpVerifyEnrollResponseSchema);
const TotpVerifyEnrollEnvelope = envelopeOf("TotpVerifyEnroll", TotpVerifyEnrollResponse);
const TotpDisableRequest = registry.register("TotpDisableRequest", TotpDisableRequestSchema);
const TotpDisableResponseEnvelope = registry.register("TotpDisableEnvelope", z.object({
  data: z.object({ disabled: z.literal(true) }).nullable(),
  meta: z.record(z.string(), z.unknown()).nullable(),
  error: ProblemDetails.nullable(),
}));
const TotpStatusResponse = registry.register("TotpStatusResponse", TotpStatusResponseSchema);
const TotpStatusEnvelope = envelopeOf("TotpStatus", TotpStatusResponse);
const TwoFactorLoginVerifyRequest = registry.register("TwoFactorLoginVerifyRequest", TwoFactorLoginVerifyRequestSchema);

registry.registerPath({ method: "get", path: "/api/v1/auth/2fa/status", summary: "Get the authenticated user's own 2FA enrolment status", tags: ["auth", "2fa"], security: [{ cookieAuth: [] }], ...requiredPermission("twofa.manage (scope: own)"), responses: { 200: { description: "2FA status.", content: { "application/json": { schema: TotpStatusEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "post", path: "/api/v1/auth/2fa/enroll", summary: "Begin 2FA enrolment. Issues a new TOTP secret + otpauth URL (not yet enabled)", tags: ["auth", "2fa"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("twofa.manage (scope: own)"), responses: { 200: { description: "TOTP secret + QR otpauth URL.", content: { "application/json": { schema: TotpEnrollEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "post", path: "/api/v1/auth/2fa/enroll/verify", summary: "Confirm the first TOTP code. Enables 2FA, returns one-time backup codes", tags: ["auth", "2fa"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("twofa.manage (scope: own)"), request: { body: { content: { "application/json": { schema: TotpVerifyEnrollRequest } } } }, responses: { 200: { description: "2FA enabled + backup codes (shown once).", content: { "application/json": { schema: TotpVerifyEnrollEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "post", path: "/api/v1/auth/2fa/disable", summary: "Disable 2FA. Requires a current TOTP code or an unused backup code", tags: ["auth", "2fa"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("twofa.manage (scope: own)"), request: { body: { content: { "application/json": { schema: TotpDisableRequest } } } }, responses: { 200: { description: "2FA disabled.", content: { "application/json": { schema: TotpDisableResponseEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "post", path: "/api/v1/auth/2fa/login-verify", summary: "Second step of a 2FA login. Verifies credentials + TOTP/backup code, sets session cookies", description: "UNAUTHENTICATED (no session exists yet. Same posture as POST /auth/login). Rate-limited by IP.", tags: ["auth", "2fa"], request: { body: { content: { "application/json": { schema: TwoFactorLoginVerifyRequest } } } }, responses: { 200: { description: "Session established.", content: { "application/json": { schema: AuthSessionEnvelope } } }, ...errorResponses } });

// 2FA recovery — the "lost my authenticator" path. Both routes UNAUTHENTICATED and
// CSRF-excluded (no session exists), IP-rate-limited + per-email rate-limited.
const TwoFactorRecoveryRequest = registry.register("TwoFactorRecoveryRequest", TwoFactorRecoveryRequestSchema);
const TwoFactorRecoveryRequestResponse = registry.register("TwoFactorRecoveryRequestResponse", TwoFactorRecoveryRequestResponseSchema);
const TwoFactorRecoveryRequestEnvelope = envelopeOf("TwoFactorRecoveryRequest", TwoFactorRecoveryRequestResponse);
const TwoFactorRecoveryConfirm = registry.register("TwoFactorRecoveryConfirm", TwoFactorRecoveryConfirmSchema);
const TwoFactorRecoveryConfirmResponse = registry.register("TwoFactorRecoveryConfirmResponse", TwoFactorRecoveryConfirmResponseSchema);
const TwoFactorRecoveryConfirmEnvelope = envelopeOf("TwoFactorRecoveryConfirm", TwoFactorRecoveryConfirmResponse);
const AdminClearTwoFactorRequest = registry.register("AdminClearTwoFactorRequest", AdminClearTwoFactorRequestSchema);
const AdminClearTwoFactorResponse = registry.register("AdminClearTwoFactorResponse", AdminClearTwoFactorResponseSchema);
const AdminClearTwoFactorEnvelope = envelopeOf("AdminClearTwoFactor", AdminClearTwoFactorResponse);

registry.registerPath({ method: "post", path: "/api/v1/auth/2fa/recovery/request", summary: "Request an emailed 2FA recovery code (lost authenticator)", description: "UNAUTHENTICATED. ALWAYS returns 200 with the same generic message. A nonexistent email, a wrong password, an account without 2FA, and a rate-limited caller are all indistinguishable. The current password is required so recovery is never reachable with inbox access alone.", tags: ["auth", "2fa"], request: { body: { content: { "application/json": { schema: TwoFactorRecoveryRequest } } } }, responses: { 200: { description: "Generic acknowledgement (never confirms the account exists).", content: { "application/json": { schema: TwoFactorRecoveryRequestEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "post", path: "/api/v1/auth/2fa/recovery/confirm", summary: "Confirm the emailed recovery code. Disables 2FA and revokes all sessions", description: "UNAUTHENTICATED. Re-verifies the password alongside the single-use, attempt-capped code. No session is issued: the user signs in with their password and re-enrols. 422 RECOVERY_CODE_INVALID covers bad credentials, no enrolment, and a wrong/expired/replayed code alike.", tags: ["auth", "2fa"], request: { body: { content: { "application/json": { schema: TwoFactorRecoveryConfirm } } } }, responses: { 200: { description: "2FA disabled.", content: { "application/json": { schema: TwoFactorRecoveryConfirmEnvelope } } }, ...errorResponses } });
registry.registerPath({ method: "post", path: "/api/v1/crm/admin/users/{id}/two-factor/clear", summary: "Admin rescue, clear another user's 2FA", description: "For a user who has lost BOTH their authenticator and inbox access. Requires `twofa.reset` (super_admin/admin only, NOT the own-scope `twofa.manage` every role holds). Self-clearing is forbidden. Audit-logged with the mandatory reason; idempotent (`cleared: false` when the target had no 2FA).", tags: ["admin", "2fa"], security: [{ cookieAuth: [], csrfHeader: [] }], ...requiredPermission("twofa.reset (scope: all)"), request: { params: z.object({ id: z.string().uuid() }), body: { content: { "application/json": { schema: AdminClearTwoFactorRequest } } } }, responses: { 200: { description: "2FA cleared (or already absent).", content: { "application/json": { schema: AdminClearTwoFactorEnvelope } } }, ...errorResponses } });

// ─────────────────────────────────────────────────────────────────────────
// Wave-2 follow-up promotion (docs/plans/phase-9-completion.md T30 follow-up,
// api-designer). CRM bulk actions + own-scope saved views, growth public SEO
// (per-city + bundles), LMS video-library ingest — all promoted from STOPGAP
// backend-local schemas to shared @repo/types contracts. See each schema file's
// header for the promotion rationale. No Idempotency-Key header is declared as
// required below because the current backend controllers for these routes do not
// parse/enforce one (mirrors reality exactly — do not assume otherwise).
// ─────────────────────────────────────────────────────────────────────────

import {
  BulkAssignLeadsRequestSchema,
  BulkMoveLeadsStageRequestSchema,
  BulkUpdateStudentsStatusRequestSchema,
  BulkActionResponseSchema,
} from "../crm/bulk-actions.schemas.js";
import {
  CreateSavedViewRequestSchema,
  ListSavedViewsQuerySchema,
  SavedViewSchema,
} from "../crm/saved-views.schemas.js";
import {
  CitySeoIndexResponseSchema,
  CitySeoDetailResponseSchema,
  ListBundlesResponseSchema,
} from "../growth/public-seo.schemas.js";
import {
  CreateVideoAssetRequestSchema,
  CreateVideoAssetResponseSchema,
  ListVideoAssetsQuerySchema,
  VideoAssetSchema,
  AttachCaptionsRequestSchema,
} from "../lms/video-library.schemas.js";

// ── CRM bulk actions (T30) ───────────────────────────────────────────────

const BulkAssignLeadsRequest = registry.register("BulkAssignLeadsRequest", BulkAssignLeadsRequestSchema);
const BulkMoveLeadsStageRequest = registry.register("BulkMoveLeadsStageRequest", BulkMoveLeadsStageRequestSchema);
const BulkUpdateStudentsStatusRequest = registry.register(
  "BulkUpdateStudentsStatusRequest",
  BulkUpdateStudentsStatusRequestSchema,
);
const BulkActionResponse = registry.register("BulkActionResponse", BulkActionResponseSchema);
const BulkActionEnvelope = envelopeOf("BulkAction", BulkActionResponse);

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/bulk/leads/assign",
  summary: "Bulk-assign an owner to up to 200 leads",
  description:
    "Every id runs through the SAME already-scope-checked, already-audited single-row " +
    "LeadsService.assignOwner() an equivalent single-item call uses, never broader reach " +
    "than one-at-a-time. Per-row success:false covers BOTH not-found and out-of-scope (IDOR-safe).",
  tags: ["crm", "bulk"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("bulk.leads"),
  request: { body: { content: { "application/json": { schema: BulkAssignLeadsRequest } } } },
  responses: {
    200: { description: "Per-row bulk-assign result.", content: { "application/json": { schema: BulkActionEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/bulk/leads/stage",
  summary: "Bulk-move up to 200 leads to a pipeline stage",
  tags: ["crm", "bulk"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("bulk.leads"),
  request: { body: { content: { "application/json": { schema: BulkMoveLeadsStageRequest } } } },
  responses: {
    200: { description: "Per-row bulk-stage-move result.", content: { "application/json": { schema: BulkActionEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/bulk/students/status",
  summary: "Bulk-update status on up to 200 students",
  tags: ["crm", "bulk"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("bulk.students"),
  request: { body: { content: { "application/json": { schema: BulkUpdateStudentsStatusRequest } } } },
  responses: {
    200: { description: "Per-row bulk-status-update result.", content: { "application/json": { schema: BulkActionEnvelope } } },
    ...errorResponses,
  },
});

// ── CRM saved views — own-scope (T30) ────────────────────────────────────

const CreateSavedViewRequest = registry.register("CreateSavedViewRequest", CreateSavedViewRequestSchema);
const SavedView = registry.register("SavedView", SavedViewSchema);
const SavedViewEnvelope = envelopeOf("SavedView", SavedView);
const SavedViewListEnvelope = envelopeOf("SavedViewList", z.array(SavedView));

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/saved-views",
  summary: "Create an own-scope saved filter view",
  description:
    "No dedicated permission key, authenticated only. `filters` is an opaque bag echoed " +
    "back verbatim, never interpreted server-side; the caller must separately hold " +
    "leads.view/students.view to query the data it filters.",
  tags: ["crm", "saved-views"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  request: { body: { content: { "application/json": { schema: CreateSavedViewRequest } } } },
  responses: {
    201: { description: "Saved view created.", content: { "application/json": { schema: SavedViewEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/saved-views",
  summary: "List the caller's own saved filter views",
  description: "Returns the caller's FULL own-scope set unconditionally. Page/pageSize are accepted but not applied server-side.",
  tags: ["crm", "saved-views"],
  security: [{ cookieAuth: [] }],
  request: { query: ListSavedViewsQuerySchema },
  responses: {
    200: { description: "Own saved-view list.", content: { "application/json": { schema: SavedViewListEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/crm/saved-views/{id}",
  summary: "Delete an own saved filter view",
  description: "IDOR->404 on another user's saved view (indistinguishable from nonexistent).",
  tags: ["crm", "saved-views"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Saved view deleted.", content: { "application/json": { schema: SavedViewEnvelope } } },
    ...errorResponses,
  },
});

// ── Growth public SEO — per-city + bundles (T30) ─────────────────────────

const CitySeoIndexResponse = registry.register("CitySeoIndexResponse", CitySeoIndexResponseSchema);
const CitySeoIndexEnvelope = envelopeOf("CitySeoIndex", CitySeoIndexResponse);
const CitySeoDetailResponse = registry.register("CitySeoDetailResponse", CitySeoDetailResponseSchema);
const CitySeoDetailEnvelope = envelopeOf("CitySeoDetail", CitySeoDetailResponse);
const ListBundlesResponse = registry.register("ListBundlesResponse", ListBundlesResponseSchema);
const ListBundlesEnvelope = envelopeOf("ListBundles", ListBundlesResponse);

registry.registerPath({
  method: "get",
  path: "/api/v1/public/seo/cities",
  summary: "Per-city SEO landing index (program-count per city)",
  tags: ["public", "growth", "seo"],
  responses: {
    200: { description: "City SEO index.", content: { "application/json": { schema: CitySeoIndexEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/public/seo/cities/{citySlug}",
  summary: "Per-city SEO landing detail (server-generated title/description + program list)",
  tags: ["public", "growth", "seo"],
  request: { params: z.object({ citySlug: z.string().min(1) }) },
  responses: {
    200: { description: "City SEO detail.", content: { "application/json": { schema: CitySeoDetailEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/public/bundles",
  summary: "Programs grouped by domain (\"track\") with min/max pricing",
  tags: ["public", "growth", "bundles"],
  responses: {
    200: { description: "Bundle list.", content: { "application/json": { schema: ListBundlesEnvelope } } },
    ...errorResponses,
  },
});

// ── LMS video library (CRM ingest surface, T26) ──────────────────────────

const CreateVideoAssetRequest = registry.register("CreateVideoAssetRequest", CreateVideoAssetRequestSchema);
const CreateVideoAssetResponse = registry.register("CreateVideoAssetResponse", CreateVideoAssetResponseSchema);
const CreateVideoAssetEnvelope = envelopeOf("CreateVideoAsset", CreateVideoAssetResponse);
const VideoAsset = registry.register("VideoAsset", VideoAssetSchema);
const VideoAssetEnvelope = envelopeOf("VideoAsset", VideoAsset);
const VideoAssetListEnvelope = paginatedEnvelopeOf("VideoAsset", VideoAsset);
const AttachCaptionsRequest = registry.register("AttachCaptionsRequest", AttachCaptionsRequestSchema);

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/videos",
  summary: "List video-library assets (paginated)",
  tags: ["crm", "video-library"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("videolib.view"),
  request: { query: ListVideoAssetsQuerySchema },
  responses: {
    200: { description: "Video asset list.", content: { "application/json": { schema: VideoAssetListEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/crm/videos/{id}",
  summary: "Get a video-library asset",
  tags: ["crm", "video-library"],
  security: [{ cookieAuth: [] }],
  ...requiredPermission("videolib.view"),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Video asset detail.", content: { "application/json": { schema: VideoAssetEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/crm/videos",
  summary: "Ingest a video asset for a lesson (== attach; re-ingest replaces the existing video)",
  description:
    "videos.lesson_id is NOT NULL + UNIQUE (1:1 with lesson), ingest and attach-to-lesson " +
    "are the SAME operation. Returns the video row + a one-time VideoProvider upload URL " +
    "the caller PUTs the raw file to directly (never proxied through this API).",
  tags: ["crm", "video-library"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("videolib.upload"),
  request: { body: { content: { "application/json": { schema: CreateVideoAssetRequest } } } },
  responses: {
    201: { description: "Video ingested; upload URL issued.", content: { "application/json": { schema: CreateVideoAssetEnvelope } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/crm/videos/{id}/captions",
  summary: "Replace a video's full caption-track list",
  tags: ["crm", "video-library"],
  security: [{ cookieAuth: [], csrfHeader: [] }],
  ...requiredPermission("videolib.edit"),
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: AttachCaptionsRequest } } },
  },
  responses: {
    200: { description: "Captions updated.", content: { "application/json": { schema: VideoAssetEnvelope } } },
    ...errorResponses,
  },
});

export function generateOpenApiDocument(): OpenAPIObject {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "stimuliiq API",
      version: "0.8.0",
      description:
        "stimuliiq /api/v1 contract. Phase-0 auth/me, Phase-1 CRM core " +
        "(students, faculty, courses/curriculum, batches, enrollments, admin roles/" +
        "permission-matrix/branches, audit logs), Phase-2 Commerce + Leads " +
        "(orders, payments/Razorpay/verify/webhook/manual/reconciliation, invoices, " +
        "refunds approval workflow, coupons/validate, leads pipeline/stage/owner/convert, " +
        "activities/tasks/SLA, bookings/status, public booking intake), " +
        "Phase-3 LMS core student surface (dashboard, enrollments, curriculum, " +
        "lesson detail, stream-url [short-TTL signed HLS, enrollment-gated, audited], " +
        "progress ping + completion + rollup, attendance), plus " +
        "Phase-4 Learning Depth (assignments/projects/submissions/milestones, " +
        "assessments/attempts [answer-key NEVER in student response, AssessmentQuestionPublic], " +
        "certificates [eligibility engine, issue/revoke/reissue, signed download URL], " +
        "public GET /verify/:certUid [unauthenticated, signature-recomputed, rate-limited, " +
        "minimal payload. No PII beyond holderName], StorageProvider signed upload/download). " +
        "Cookie + CSRF transport (docs/04-trd-architecture.md §2.3); standard " +
        "`{ data, meta, error }` envelope with RFC-7807 problem-details errors; " +
        "`Idempotency-Key` header REQUIRED on all unsafe mutations (docs/04 §2.14). " +
        "Unauthenticated paths: POST /commerce/payments/webhook (Razorpay HMAC-verified), " +
        "POST /public/bookings (rate-limited open intake), GET /verify/:certUid (rate-limited), " +
        "GET /public/programs (+ /:slug), POST /public/leads, POST /public/coupons/validate, " +
        "POST /public/register. Self-service (own-scope): POST /public/enroll/orders|checkout|verify. " +
        "P4 security guarantees: answer key never serialized (type + integration assertion); " +
        "cert_uid verify RECOMPUTES HMAC (fabricated row fails); signed URLs only (no raw bucket URLs). " +
        "P5 security guarantees: public catalog projection enforced (no status/isPublic/ogImageKey/tenantId " +
        "in responses. Type assertions in @repo/types/public/programs.schemas.ts); checkout response " +
        "carries PUBLIC keyId ONLY (RAZORPAY_KEY_SECRET never in any response, type assertion in " +
        "@repo/types/public/enroll.schemas.ts); captcha fail-closed in prod (AC-44); funnel IDOR→404 " +
        "(student can only transact on own order. AC-22); DPDP consent recorded on every public write. " +
        "Phase-8 Mentor (human, externally-hired batch lead, docs/specs/phase-8-mentor.md): mentor " +
        "hiring-record CRUD (crm/mentors), batch_mentors M:N assignment with single-lead-flag semantics, " +
        "read-only internship-completion rollup (batch-level + paginated per-student breakdown, reuses the " +
        "P4 eligibility engine verbatim, LOCK-4. Never a parallel progress system), active→completed " +
        "mark-complete transition (batches.markComplete, informational-only rollup, never a completion " +
        "gate), and a scoped mentor-facing dashboard (GET /me/mentor/dashboard, fail-closed cross-batch/" +
        "cross-mentor/cross-tenant isolation, compile-time no-leak assertions in " +
        "@repo/types/crm/mentors.schemas.ts).",
    },
    servers: [{ url: "/", description: "Relative to the API origin (global prefix api/v1 already in paths)." }],
  });
}
