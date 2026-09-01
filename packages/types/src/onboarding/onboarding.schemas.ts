// Student onboarding form — the contract shared by the public form (apps/web
// `/onboarding`, served at stimuliiq.com/onboarding), the CRM Onboarding screen, and the
// NestJS module. Backs `model OnboardingField` + `model OnboardingSubmission`.
//
// THE ONE IDEA THAT SHAPES THIS FILE: the question set is DATA, not code.
//
// Staff author every question from the CRM — label, help text, widget type, required-ness,
// choices, order, active/inactive — and can add new ones at any time. Nothing in `web`
// hardcodes "Name" or "Payment Receipt"; the page renders whatever `GET /public/onboarding/
// form` returns. That is why this file has no "core fields" constant: the seed
// (prisma/seed.ts) inserts the eight questions the Google Form asked, and from that moment
// they are ordinary, fully editable rows like any staff-added field.
//
// Two consequences worth stating explicitly, because they are easy to get wrong:
//
//   1. VALIDATION IS SERVER-DERIVED, NOT SCHEMA-DECLARED. A submission cannot be described
//      by a fixed zod object — its legal shape depends on rows in a table. So
//      `SubmitOnboardingRequestSchema` only validates the ENVELOPE (a bag of
//      fieldKey → value). The per-field rules (required, is this a legal choice, is this
//      a real 10-digit mobile) are applied server-side against the live field set, and
//      returned in the standard problem-details `errors[]` channel with
//      `path: "answers.<fieldKey>"`. `buildOnboardingAnswerIssues` below is the SHARED
//      implementation both sides run, so the web form's inline errors and the API's 422
//      can never disagree.
//
//   2. ANSWERS ARE STORED AS A SNAPSHOT. `OnboardingAnswerSchema` carries the label and
//      type alongside the value, frozen at submit time. Renaming a question later must
//      not rewrite history, and deleting one must not orphan its answers.
//
// Endpoint surface:
//   PUBLIC  (anonymous, captcha + rate-limited)
//     GET  /public/onboarding/form                — the live question set + program choices
//     POST /public/onboarding/upload-url          — signed PUT for a `file` answer
//     POST /public/onboarding/submit              — submit answers
//   CRM     (JwtAuthGuard + PermissionsGuard, `onboarding.*`)
//     GET/POST/PATCH/DELETE /crm/onboarding/fields[/:id]   — author the question set
//     POST   /crm/onboarding/fields/reorder                — bulk sort_order write
//     GET    /crm/onboarding/submissions[/:id]             — read what students sent
//     PATCH  /crm/onboarding/submissions/:id               — status + review notes
//     DELETE /crm/onboarding/submissions/:id               — soft delete

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

// ─────────────────────────────────────────────────────────────────────────────
// Field definitions (the question set)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Widget rendered on the public form. Mirrors `enum OnboardingFieldType`.
 *
 * `program` is the one type with behaviour beyond presentation: it renders as a dropdown
 * populated LIVE from published, enrollment-open programs, and its answer additionally
 * lands on `OnboardingSubmission.programId`. That is what lets ONE permanent onboarding
 * link keep working as the catalog changes, instead of a per-batch Google Form whose
 * hardcoded header goes stale (the original form's "Psychology Fellowship Program 2026").
 */
export const OnboardingFieldTypeSchema = z.enum([
  "text",
  "textarea",
  "email",
  "phone",
  "number",
  "date",
  "select",
  "radio",
  "checkbox",
  "file",
  "program",
]);
export type OnboardingFieldType = z.infer<typeof OnboardingFieldTypeSchema>;

/** Types whose answer is chosen from `options` (and may allow a free-text "Other"). */
export const CHOICE_FIELD_TYPES = ["select", "radio"] as const satisfies readonly OnboardingFieldType[];

/**
 * Marks a field as the source of a denormalised CRM list column, so the submissions table
 * can show Name/Email/Phone and search them without opening each answer blob. Staff pick
 * this per field, which is what keeps the projection working even after they rename or
 * replace the question that feeds it.
 */
export const OnboardingIdentityRoleSchema = z.enum(["none", "name", "email", "phone"]);
export type OnboardingIdentityRole = z.infer<typeof OnboardingIdentityRoleSchema>;

/** Field `key` — immutable after create, snake_case, and the join key in every snapshot. */
export const OnboardingFieldKeySchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z][a-z0-9_]*$/, "lowercase snake_case, starting with a letter");

const OnboardingFieldOptionsSchema = z.array(z.string().min(1).max(200)).min(1).max(60);

/** Shared shape of a question, as both the CRM and the public form see it. */
export const OnboardingFieldSchema = z.object({
  id: UuidSchema,
  key: OnboardingFieldKeySchema,
  label: z.string(),
  helpText: z.string().nullable(),
  placeholder: z.string().nullable(),
  type: OnboardingFieldTypeSchema,
  required: z.boolean(),
  options: z.array(z.string()).nullable(),
  allowOther: z.boolean(),
  identityRole: OnboardingIdentityRoleSchema,
  sortOrder: z.number().int().min(0),
  active: z.boolean(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type OnboardingField = z.infer<typeof OnboardingFieldSchema>;

/**
 * `POST /crm/onboarding/fields`.
 *
 * The `options`/`allowOther` cross-checks are `superRefine`d rather than left to the
 * service so the CRM form surfaces them inline before a round-trip: a `select` with no
 * choices renders as an empty, unanswerable dropdown, and choices on a `text` field are
 * silently ignored data that later reads as a bug.
 */
export const CreateOnboardingFieldRequestSchema = z
  .object({
    key: OnboardingFieldKeySchema,
    label: z.string().min(1).max(200),
    helpText: z.string().max(500).nullable().optional(),
    placeholder: z.string().max(120).nullable().optional(),
    type: OnboardingFieldTypeSchema,
    required: z.boolean().default(false),
    options: OnboardingFieldOptionsSchema.nullable().optional(),
    allowOther: z.boolean().default(false),
    identityRole: OnboardingIdentityRoleSchema.default("none"),
    sortOrder: z.number().int().min(0).default(0),
    active: z.boolean().default(true),
  })
  .strict()
  .superRefine(assertFieldShapeCoherent);
export type CreateOnboardingFieldRequest = z.infer<typeof CreateOnboardingFieldRequestSchema>;

/**
 * `PATCH /crm/onboarding/fields/:id` — everything except `key` is editable.
 *
 * `key` is deliberately absent: it is the join key baked into every answer snapshot ever
 * collected, so renaming it would silently detach historical answers from the question
 * that produced them. Staff rename the visible `label` instead, which is what they
 * actually mean by "rename this question".
 */
export const UpdateOnboardingFieldRequestSchema = z
  .object({
    label: z.string().min(1).max(200).optional(),
    helpText: z.string().max(500).nullable().optional(),
    placeholder: z.string().max(120).nullable().optional(),
    type: OnboardingFieldTypeSchema.optional(),
    required: z.boolean().optional(),
    options: OnboardingFieldOptionsSchema.nullable().optional(),
    allowOther: z.boolean().optional(),
    identityRole: OnboardingIdentityRoleSchema.optional(),
    sortOrder: z.number().int().min(0).optional(),
    active: z.boolean().optional(),
  })
  .strict();
export type UpdateOnboardingFieldRequest = z.infer<typeof UpdateOnboardingFieldRequestSchema>;

/** `POST /crm/onboarding/fields/reorder` — one write for a whole drag-and-drop reorder. */
export const ReorderOnboardingFieldsRequestSchema = z
  .object({
    /** Field ids in their new top-to-bottom order. Must list every active field. */
    fieldIds: z.array(UuidSchema).min(1).max(200),
  })
  .strict();
export type ReorderOnboardingFieldsRequest = z.infer<typeof ReorderOnboardingFieldsRequestSchema>;

export const ListOnboardingFieldsQuerySchema = z
  .object({
    /** Omit for the full authoring view (active + inactive). */
    active: z.coerce.boolean().optional(),
  })
  .strict();
export type ListOnboardingFieldsQuery = z.infer<typeof ListOnboardingFieldsQuerySchema>;

export const DeleteOnboardingFieldResponseSchema = z.object({ deleted: z.literal(true) });
export type DeleteOnboardingFieldResponse = z.infer<typeof DeleteOnboardingFieldResponseSchema>;

/** Shared coherence rules between `type`, `options` and `allowOther`. */
function assertFieldShapeCoherent(
  value: { type: OnboardingFieldType; options?: string[] | null; allowOther?: boolean },
  ctx: z.RefinementCtx,
): void {
  const isChoice = (CHOICE_FIELD_TYPES as readonly string[]).includes(value.type);
  if (isChoice && (!value.options || value.options.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["options"],
      message: `A "${value.type}" question needs at least one choice.`,
    });
  }
  if (!isChoice && value.options && value.options.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["options"],
      message: `Choices only apply to ${CHOICE_FIELD_TYPES.join("/")} questions.`,
    });
  }
  if (!isChoice && value.allowOther) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["allowOther"],
      message: `An "Other" option only applies to ${CHOICE_FIELD_TYPES.join("/")} questions.`,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public form config (what the anonymous student's browser gets)
// ─────────────────────────────────────────────────────────────────────────────

/** One choice in a `program`-typed dropdown, resolved live from the catalog. */
export const OnboardingProgramOptionSchema = z.object({
  id: UuidSchema,
  title: z.string(),
});
export type OnboardingProgramOption = z.infer<typeof OnboardingProgramOptionSchema>;

/**
 * A question as the PUBLIC form sees it. Deliberately narrower than `OnboardingField`:
 * `identityRole`, `active` and the timestamps are CRM-authoring concerns and carry no
 * meaning to a student's browser, so they are not shipped to it.
 */
export const PublicOnboardingFieldSchema = z.object({
  key: OnboardingFieldKeySchema,
  label: z.string(),
  helpText: z.string().nullable(),
  placeholder: z.string().nullable(),
  type: OnboardingFieldTypeSchema,
  required: z.boolean(),
  options: z.array(z.string()).nullable(),
  allowOther: z.boolean(),
});
export type PublicOnboardingField = z.infer<typeof PublicOnboardingFieldSchema>;

/** `GET /public/onboarding/form` — everything the page needs to render itself. */
export const PublicOnboardingFormSchema = z.object({
  fields: z.array(PublicOnboardingFieldSchema),
  /** Choices for every `program`-typed field. Empty when the catalog has none published. */
  programs: z.array(OnboardingProgramOptionSchema),
});
export type PublicOnboardingForm = z.infer<typeof PublicOnboardingFormSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Submitting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single answer on the wire. `string` covers text/email/phone/date/select/radio and the
 * program id; `boolean` covers `checkbox`; `number` covers `number`. A `file` answer sends
 * the opaque `storageKey` returned by the upload-url endpoint — never a URL, never bytes.
 */
export const OnboardingAnswerValueSchema = z.union([z.string().max(5000), z.boolean(), z.number()]);
export type OnboardingAnswerValue = z.infer<typeof OnboardingAnswerValueSchema>;

/**
 * `POST /public/onboarding/submit`.
 *
 * Only the ENVELOPE is validated here — see the file header. `answers` is keyed by field
 * `key`; unknown keys and per-field rules are resolved server-side against the live field
 * set, because zod cannot describe a shape that lives in a database table.
 */
export const SubmitOnboardingRequestSchema = z
  .object({
    answers: z.record(OnboardingFieldKeySchema, OnboardingAnswerValueSchema),
    captchaToken: z.string().min(1),
  })
  .strict();
export type SubmitOnboardingRequest = z.infer<typeof SubmitOnboardingRequestSchema>;

export const SubmitOnboardingResponseSchema = z.object({
  id: UuidSchema,
  message: z.string(),
});
export type SubmitOnboardingResponse = z.infer<typeof SubmitOnboardingResponseSchema>;

/**
 * `POST /public/onboarding/upload-url` — signed PUT for a `file` answer (the payment
 * receipt screenshot, and any file question staff add later).
 *
 * Accepted types are images + PDF: a receipt is a phone screenshot or a bank PDF. The 10 MB
 * ceiling matches what the Google Form allowed, so nobody's existing receipt is suddenly
 * too large. `fieldKey` is required and checked against a real `file` field server-side —
 * without it this endpoint would be an open, anonymous "mint me a signed write URL"
 * primitive rather than one bound to a question actually being asked.
 */
export const OnboardingUploadUrlRequestSchema = z
  .object({
    fieldKey: OnboardingFieldKeySchema,
    contentType: z.enum(["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"]),
    fileName: z.string().min(1).max(255),
    sizeBytes: z.number().int().min(1).max(10_485_760).describe("Max 10 MB per upload."),
    captchaToken: z.string().min(1),
  })
  .strict();
export type OnboardingUploadUrlRequest = z.infer<typeof OnboardingUploadUrlRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Stored answers + CRM reads
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One stored answer — the frozen snapshot described in the file header. `label`/`type` are
 * copied in at submit time so the CRM can render a submission from any era without
 * consulting today's (possibly edited, possibly deleted) field row.
 */
export const OnboardingAnswerSchema = z.object({
  fieldId: UuidSchema.nullable(),
  key: z.string(),
  label: z.string(),
  type: OnboardingFieldTypeSchema,
  /** Display value. For `file`, the original filename; for `program`, the program title. */
  value: z.string().nullable(),
  /** Present only for `file` answers — the opaque object key, never a URL. */
  storageKey: z.string().nullable(),
});
export type OnboardingAnswer = z.infer<typeof OnboardingAnswerSchema>;

/**
 * Triage state. **`hold` is the arrival state** — a submission sits on hold until a named
 * staff member accepts or rejects it, which are the only two decisions the CRM offers.
 *
 * `pending` is the LEGACY arrival value (the DB default is now `hold`, migration
 * `onboarding_default_hold`, which also moved every existing row). It stays in the enum
 * because dropping a Postgres enum value is not a safe forward-only migration, and because
 * old rows read from a backup must still parse. Nothing writes it any more; treat it as a
 * synonym of `hold` when rendering.
 */
export const OnboardingSubmissionStatusSchema = z.enum(["pending", "approved", "rejected", "hold"]);
export type OnboardingSubmissionStatus = z.infer<typeof OnboardingSubmissionStatusSchema>;

/** The three decisions staff can actually make. */
export const OnboardingReviewDecisionSchema = z.enum(["approved", "rejected", "hold"]);
export type OnboardingReviewDecision = z.infer<typeof OnboardingReviewDecisionSchema>;

/** List row — the denormalised projection, enough to triage without opening anything. */
export const OnboardingSubmissionSummarySchema = z.object({
  id: UuidSchema,
  fullName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  programId: UuidSchema.nullable(),
  programTitle: z.string().nullable(),
  /**
   * List price of the program the student picked, in integer paise (CLAUDE.md §3.6).
   *
   * Carried on the submission so the approve dialog can say exactly what invoice approving
   * will raise, without a second round-trip to the catalog. Null when the form captured no
   * program; `0` for a free/scholarship program — and a zero price is what makes approval
   * skip the money leg entirely (see `ApproveOnboardingSubmissionRequestSchema`).
   */
  programPricePaise: z.number().int().min(0).nullable(),
  programCurrency: z.string().nullable(),
  status: OnboardingSubmissionStatusSchema,
  /** True when at least one `file` answer is attached (e.g. the payment receipt). */
  hasAttachment: z.boolean(),
  /** Set once approved — the student this submission activated. Doubles as "already activated". */
  studentProfileId: UuidSchema.nullable(),
  reviewedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type OnboardingSubmissionSummary = z.infer<typeof OnboardingSubmissionSummarySchema>;

/**
 * Detail — every answer the student gave, in the order they were asked.
 *
 * `attachmentUrls` maps a `file` answer's `storageKey` to a short-lived SIGNED download
 * URL minted per request. Storage keys never become public URLs and are never served
 * directly, matching the career-application/resume contract.
 */
export const OnboardingSubmissionDetailSchema = OnboardingSubmissionSummarySchema.extend({
  answers: z.array(OnboardingAnswerSchema),
  reviewNotes: z.string().nullable(),
  /** The staff member who last approved / rejected / held this. Null while pending. */
  reviewedByName: z.string().nullable(),
  attachmentUrls: z.record(z.string(), z.string()),
});
export type OnboardingSubmissionDetail = z.infer<typeof OnboardingSubmissionDetailSchema>;


export const ListOnboardingSubmissionsQuerySchema = z
  .object({
    status: OnboardingSubmissionStatusSchema.optional(),
    programId: UuidSchema.optional(),
    search: z.string().min(1).max(200).optional().describe("Matches name/email/phone, case-insensitive."),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListOnboardingSubmissionsQuery = z.infer<typeof ListOnboardingSubmissionsQuerySchema>;

/**
 * `PATCH /crm/onboarding/submissions/:id` — notes, plus `rejected`/`hold`.
 *
 * `approved` is absent on purpose. Approving is not a status write: it creates or matches a
 * student, enrols them into a batch, invoices them and emails their login. That needs a
 * batch id and its own confirmation, so it lives at `POST .../approve` where the
 * consequences are explicit. A generic PATCH that could silently enrol someone would be a
 * trap.
 *
 * `rejected` is NOT side-effect-free either: the transition emails the student to say the
 * application was not accepted and points them at support. That effect lives in the service
 * (not only in `POST .../reject`) so both routes to the same status behave identically.
 */
export const UpdateOnboardingSubmissionRequestSchema = z
  .object({
    status: z.enum(["rejected", "hold"]).optional(),
    reviewNotes: z.string().max(2000).nullable().optional(),
  })
  .strict()
  .refine((v) => v.status !== undefined || v.reviewNotes !== undefined, {
    message: "Provide a status or review notes.",
  });
export type UpdateOnboardingSubmissionRequest = z.infer<typeof UpdateOnboardingSubmissionRequestSchema>;

/**
 * `GET /crm/onboarding/submissions/:id/batches` — the batches this submission can be
 * approved into: the open (`planned`/`active`) cohorts of the program the student picked.
 *
 * Server-resolved rather than "list all batches and filter in the CRM", so the approve
 * dialog cannot offer a batch from the wrong program or a cohort that already finished.
 */
export const OnboardingApprovableBatchSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  startDate: IsoDateTimeSchema.nullable(),
  status: z.string(),
});
export type OnboardingApprovableBatch = z.infer<typeof OnboardingApprovableBatchSchema>;

/**
 * `GET /crm/onboarding/taggable-staff` — who a member can be tagged to on approval.
 *
 * Every active non-student account, not a curated "sales" subset: who brings members in is
 * a business fact that varies, and a hardcoded role list would quietly make somebody
 * untaggable with no way for an admin to fix it.
 */
export const OnboardingTaggableStaffSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  email: z.string(),
});
export type OnboardingTaggableStaff = z.infer<typeof OnboardingTaggableStaffSchema>;

/**
 * `POST /crm/onboarding/submissions/:id/approve` — the decision that activates a student.
 *
 * `batchId` is REQUIRED and not derivable: the form captures a program and a preferred
 * month, neither of which identifies a batch, and guessing one would silently put a student
 * in the wrong cohort. The CRM preselects the only candidate when a program has exactly one
 * open batch, so the common case is still one click.
 */
export const ApproveOnboardingSubmissionRequestSchema = z
  .object({
    batchId: UuidSchema,
    /**
     * WHO THIS MEMBER BELONGS TO. Required, and it is the reason approval has a second
     * mandatory field at all.
     *
     * Until this existed, ownership lived only on `leads.owner_id` and was reached from a
     * payment by joining back through `leads.converted_student_id`. An onboarding member has
     * no lead row, so their money attributed to nobody: counted in the company total, absent
     * from every individual and team figure. Nothing looked wrong — a number that is too
     * small is not a number anyone queries.
     *
     * REQUIRED rather than optional-with-a-default, because every default here is a lie.
     * Defaulting to the reviewer credits whoever happened to open the queue; defaulting to
     * null re-creates the silence this field exists to end. The reviewer is the one person
     * who knows who actually brought this member in, and they are already in the dialog.
     *
     * Deliberately NOT the same thing as a lead owner picker: this is the MEMBER's owner,
     * written to `student_profiles.owner_id`, which is what both the per-member report and
     * the team revenue roll-up read.
     */
    ownerUserId: UuidSchema,
    /**
     * Record the money the student already paid offline, so approving also raises a real
     * GST invoice and emails it WITH their login (one message, not two).
     *
     * The amount is never sent by the client — it is always the program's list price,
     * server-side (CLAUDE.md §3.6: the server owns money). This flag only says *whether*
     * to run the money leg, which is the one thing the reviewer knows and the server
     * cannot: a scholarship or already-invoiced seat gets `false` and is simply enrolled.
     *
     * Ignored (treated as `false`) when the program is free or the submission carries no
     * program — there is nothing to invoice, and a ₹0 invoice is noise in the ledger.
     */
    recordPayment: z.boolean().default(true),
    reviewNotes: z.string().max(2000).nullable().optional(),
  })
  .strict();
export type ApproveOnboardingSubmissionRequest = z.infer<typeof ApproveOnboardingSubmissionRequestSchema>;

/** `POST /crm/onboarding/submissions/:id/reject` — a reason is optional but encouraged. */
export const RejectOnboardingSubmissionRequestSchema = z
  .object({
    reviewNotes: z.string().max(2000).nullable().optional(),
  })
  .strict();
export type RejectOnboardingSubmissionRequest = z.infer<typeof RejectOnboardingSubmissionRequestSchema>;

/**
 * What approving actually did — returned alongside the updated submission so the CRM can
 * say "enrolled into X, login emailed" rather than just flipping a chip to green.
 */
export const OnboardingActivationResultSchema = z.object({
  studentProfileId: UuidSchema,
  enrollmentId: UuidSchema,
  batchName: z.string(),
  /** True when this approval CREATED the student; false when it matched an existing one by email. */
  studentCreated: z.boolean(),
  /** True when LMS credentials were emailed (false if the student already had a login). */
  credentialsEmailed: z.boolean(),
  /**
   * The invoice raised for the offline payment, or null when the money leg did not run
   * (`recordPayment: false`, a free program, or a failure — approval never fails because
   * the invoice did; the student is enrolled either way and staff can invoice from
   * Finance). Non-null implies the credentials rode inside the invoice email.
   */
  invoiceNumber: z.string().nullable(),
  /** Amount invoiced, integer paise. Null whenever `invoiceNumber` is. */
  amountPaise: z.number().int().min(0).nullable(),
});
export type OnboardingActivationResult = z.infer<typeof OnboardingActivationResultSchema>;

/**
 * `POST .../approve` response — the submission plus what activation actually did, so the
 * CRM can report "enrolled into September Batch, login emailed" instead of only turning a
 * chip green.
 */
export const ApproveOnboardingSubmissionResponseSchema = z.object({
  submission: OnboardingSubmissionDetailSchema,
  activation: OnboardingActivationResultSchema,
});
export type ApproveOnboardingSubmissionResponse = z.infer<typeof ApproveOnboardingSubmissionResponseSchema>;

export const DeleteOnboardingSubmissionResponseSchema = z.object({ deleted: z.literal(true) });
export type DeleteOnboardingSubmissionResponse = z.infer<typeof DeleteOnboardingSubmissionResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Shared answer validation (run on BOTH sides — see file header, point 1)
// ─────────────────────────────────────────────────────────────────────────────

/** A per-field problem, keyed by field `key` so each renders under its own question. */
export interface OnboardingAnswerIssue {
  key: string;
  message: string;
}

/** Only the parts of a field the validator needs — so the CRM/public/DB shapes all fit. */
export interface OnboardingValidatableField {
  key: string;
  label: string;
  type: OnboardingFieldType;
  required: boolean;
  options: string[] | null;
  allowOther: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const LOCAL_MOBILE_RE = /^\d{10}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isBlank(value: OnboardingAnswerValue | undefined): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (typeof value === "boolean") return value === false;
  return false;
}

/**
 * Validates a submitted answer bag against the LIVE field set, returning one issue per
 * offending field.
 *
 * Both the browser (inline errors, before submit) and the API (422 body) call this, which
 * is the whole point: a form whose rules live in a database cannot have those rules
 * duplicated in two hand-written validators without them drifting the first time someone
 * edits a question.
 *
 * `phone` accepts exactly 10 local digits — the single product-wide mobile rule
 * (@repo/ui `toLocalPhoneDigits`); the API stores it as E.164 on the way in.
 * Answers to unknown keys are ignored rather than rejected: a student mid-form when staff
 * deactivate a question should not hit a hard error on submit for a question that no
 * longer exists.
 */
export function buildOnboardingAnswerIssues(
  fields: readonly OnboardingValidatableField[],
  answers: Readonly<Record<string, OnboardingAnswerValue | undefined>>,
): OnboardingAnswerIssue[] {
  const issues: OnboardingAnswerIssue[] = [];

  for (const field of fields) {
    const raw = answers[field.key];
    const blank = isBlank(raw);

    if (blank) {
      if (field.required) {
        issues.push({
          key: field.key,
          message: field.type === "checkbox" ? `Please tick "${field.label}".` : `${field.label} is required.`,
        });
      }
      continue; // Nothing further to check on an empty optional answer.
    }

    const text = typeof raw === "string" ? raw.trim() : "";

    switch (field.type) {
      case "email":
        if (!EMAIL_RE.test(text)) issues.push({ key: field.key, message: "Enter a valid email address." });
        break;
      case "phone":
        if (!LOCAL_MOBILE_RE.test(text.replace(/\D/g, ""))) {
          issues.push({ key: field.key, message: "Enter a 10-digit mobile number." });
        }
        break;
      case "number":
        if (typeof raw !== "number" && !/^-?\d+(\.\d+)?$/.test(text)) {
          issues.push({ key: field.key, message: "Enter a number." });
        }
        break;
      case "date":
        if (!ISO_DATE_RE.test(text) || Number.isNaN(Date.parse(text))) {
          issues.push({ key: field.key, message: "Enter a valid date." });
        }
        break;
      case "select":
      case "radio": {
        const choices = field.options ?? [];
        // `allowOther` is Google Forms' "Other:" escape hatch — any free text passes.
        if (!field.allowOther && !choices.includes(text)) {
          issues.push({ key: field.key, message: `Choose one of: ${choices.join(", ")}.` });
        }
        break;
      }
      case "file":
        // The value is a storage key minted by the upload endpoint; the server additionally
        // pins it to this tenant's namespace before trusting it (see the service).
        if (text.length === 0) issues.push({ key: field.key, message: `${field.label} is required.` });
        break;
      case "program":
        // Membership is checked against the live catalog server-side, not here — the
        // browser has no authoritative program list beyond what it was handed.
        break;
      case "text":
      case "textarea":
      case "checkbox":
        break;
    }
  }

  return issues;
}
