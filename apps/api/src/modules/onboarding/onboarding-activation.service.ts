// apps/api/src/modules/onboarding/onboarding-activation.service.ts
//
// Turns an APPROVED onboarding submission into a real, enrolled, logged-in student.
//
// Context for why this exists at all: the onboarding form is filled AFTER an offline
// payment (that is what the receipt upload is). So unlike the card-checkout funnel — where
// `CommerceService.verifyPayment` creates the enrollment and activates the profile as part
// of capturing money — nothing has happened in the system yet when the form arrives. A
// human verifies the receipt, and THEIR approval is the event that has to do everything
// the payment webhook would have done.
//
// So this service deliberately walks the SAME path, reusing the same primitives rather than
// re-implementing them:
//   StudentsRepository.createStudentWithUser  → the lead-conversion student shape
//                                               (users row, student role, invited status)
//   EnrollmentsRepository.enrollOrRestore     → enrollment + `lead → active` promotion,
//                                               in ONE transaction (its own contract)
//   LmsAccountProvisioningService             → temp password + welcome email, idempotent
//
// The one thing it adds is IDENTITY RESOLUTION, which the payment path never needs because
// there the student is already known. Here we have an email typed into a public form, so:
//   - match an existing student by email within the tenant → reuse them (never a duplicate
//     account for someone who already exists);
//   - a user exists but is NOT a student (staff/faculty) → refuse rather than silently
//     attaching a student profile to a staff login;
//   - otherwise create the student.
//
// THE MONEY LEG. The receipt the student uploaded is proof of a payment the system has no
// record of, so approving optionally records it — and once money is recorded the rest of
// commerce follows for free. When `recordPayment` is set and the program has a price, this
// service does NOT enrol by hand; it drives the ORDINARY offline-payment lifecycle:
//   CommerceService.createOrder        → an order at the program's list price
//   CommerceService.recordManualPayment→ captures it, enrols, raises a GST invoice, and
//                                        sends ONE email: invoice + LMS credentials
// That is deliberately the same code path a walk-in cash payment takes, so an onboarding
// student is indistinguishable from any other paying student in the ledger — and the
// combined "receipt + credentials" email already built for that path is reused verbatim
// rather than a second, drifting copy living here.
//
// The amount is ALWAYS the program's list price, read server-side. The client never sends
// an amount (CLAUDE.md §3.6) — it only says whether to run this leg at all.
//
// FAILURE POSTURE. Enrollment is the commit point, and the student getting access outranks
// the paperwork. So:
//   - if the money leg throws (draft program, batch full, storage down mid-invoice), it is
//     logged and we fall through to the plain enrol + welcome-email path — the student is
//     never left un-enrolled because an invoice failed. Any order created before the
//     failure stays open and visible under Finance for staff to settle or cancel.
//   - if credential emailing fails afterwards it is logged and swallowed — the student IS
//     enrolled, and failing the whole approval (leaving a submission on hold while its
//     student sits enrolled) would be worse than a missing email that can be re-sent.

import { BadRequestException, Injectable, Logger, UnprocessableEntityException } from "@nestjs/common";
import type { OnboardingActivationResult } from "@repo/types";
import { PrismaService } from "../../prisma/prisma.service";
import { StudentsRepository } from "../students/students.repository";
import { EnrollmentsRepository } from "../enrollments/enrollments.repository";
import { LmsAccountProvisioningService } from "../students/lms-account-provisioning.service";
import { CommerceService } from "../commerce/commerce.service";

export interface ActivationInput {
  tenantId: string;
  batchId: string;
  /** Denormalised from the submission's answers — see OnboardingService#deriveIdentity. */
  fullName: string | null;
  email: string | null;
  phone: string | null;
  /** The program the student picked on the form, if the form asks for one. */
  programId: string | null;
  /** Free-text college answer, when one of the questions carries it. */
  college: string | null;
  /** The reviewer — stamped on the order/payment rows the money leg creates. */
  actorId: string;
  /**
   * Record the offline payment (order + captured manual payment + GST invoice) at the
   * program's list price. Silently ignored when the program is missing or free.
   */
  recordPayment: boolean;
  /** The submission this approval came from — the idempotency key for the order/payment. */
  submissionId: string;
  /**
   * What the payment row records as its reference: the uploaded receipt's filename when the
   * form captured one, so the ledger entry points at the actual evidence.
   */
  paymentReference: string | null;
}

@Injectable()
export class OnboardingActivationService {
  private readonly logger = new Logger(OnboardingActivationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly students: StudentsRepository,
    private readonly enrollments: EnrollmentsRepository,
    private readonly lmsProvisioning: LmsAccountProvisioningService,
    private readonly commerce: CommerceService,
  ) {}

  async activate(input: ActivationInput): Promise<OnboardingActivationResult> {
    const { tenantId, batchId } = input;

    // A submission with no email cannot become a student: the email IS the login, and it is
    // how we avoid creating a duplicate account for someone who already exists. Fail with a
    // message that names the fix (the form's email question), not a generic 422.
    const email = input.email?.trim().toLowerCase();
    if (!email) {
      throw new UnprocessableEntityException({
        code: "onboarding.missing_email",
        title: "No email on this submission",
        detail:
          "This submission has no email address, so a student account cannot be created. Add an email question to the form (or set one of the existing questions to feed the Email column) and ask the student to resubmit.",
      });
    }

    const batch = await this.prisma.client.batch.findFirst({
      where: { id: batchId, tenantId, deletedAt: null },
      select: { id: true, name: true, programId: true, status: true },
    });
    if (!batch) {
      throw new UnprocessableEntityException({
        code: "onboarding.batch_not_found",
        title: "Batch not found",
        detail: "That batch no longer exists. Reload the page and pick another.",
      });
    }
    // Guard the mismatch that silently puts a student in the wrong course: the form said
    // one program, the reviewer picked a batch of another. The CRM only offers batches of
    // the submitted program, so reaching this means stale UI state or a hand-made request.
    if (input.programId && batch.programId !== input.programId) {
      throw new BadRequestException({
        code: "onboarding.batch_program_mismatch",
        title: "Batch belongs to a different program",
        detail: "The chosen batch is not part of the program this student applied for.",
      });
    }

    const { studentProfileId, created, hasLogin } = await this.resolveStudent(tenantId, {
      email,
      fullName: input.fullName,
      phone: input.phone,
      college: input.college,
    });

    // Money leg first when asked for: it enrols, invoices AND emails in one lifecycle, so
    // running the plain path afterwards would double everything. Returns null when it was
    // skipped (free program) or failed — both fall through to the plain path below.
    if (input.recordPayment) {
      const invoiced = await this.tryRecordOfflinePayment({
        tenantId,
        actorId: input.actorId,
        studentProfileId,
        programId: batch.programId,
        batchId: batch.id,
        submissionId: input.submissionId,
        reference: input.paymentReference,
      });
      if (invoiced) {
        return {
          studentProfileId,
          enrollmentId: invoiced.enrollmentId,
          batchName: batch.name,
          studentCreated: created,
          // recordManualPayment provisions quietly and embeds the credentials in the
          // invoice email — so "were credentials sent?" is exactly "was this account
          // without a login when we started?".
          credentialsEmailed: !hasLogin,
          invoiceNumber: invoiced.invoiceNumber,
          amountPaise: invoiced.amountPaise,
        };
      }
    }

    // Enrollment + `lead → active` promotion, one transaction (enrollOrRestore's contract).
    const enrollment = await this.enrollments.enrollOrRestore(tenantId, {
      studentId: studentProfileId,
      batchId: batch.id,
      programId: batch.programId,
    });

    // Past the commit point — see the FAILURE POSTURE note in the file header.
    let credentialsEmailed = false;
    try {
      credentialsEmailed = await this.lmsProvisioning.provisionForStudentProfile(tenantId, studentProfileId);
    } catch (err) {
      this.logger.error(
        `[Onboarding] LMS provisioning failed after activating student=${studentProfileId}: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    }

    return {
      studentProfileId,
      enrollmentId: enrollment.id,
      batchName: batch.name,
      studentCreated: created,
      credentialsEmailed,
      invoiceNumber: null,
      amountPaise: null,
    };
  }

  /**
   * Run the ordinary offline-payment lifecycle for this approval: order at the program's
   * list price → captured manual payment → enrollment → GST invoice → one email carrying
   * the invoice AND the student's LMS credentials.
   *
   * Returns null — never throws — when there is nothing to invoice or the leg failed. The
   * caller then enrols the student the plain way, because access must not depend on
   * paperwork (see FAILURE POSTURE in the file header).
   *
   * Idempotency is keyed off the SUBMISSION, not a random uuid: approving is already
   * guarded against replay by `submissions.student_profile_id`, but a retried request that
   * got past that guard must not mint a second order for the same intake.
   */
  private async tryRecordOfflinePayment(args: {
    tenantId: string;
    actorId: string;
    studentProfileId: string;
    programId: string;
    batchId: string;
    submissionId: string;
    reference: string | null;
  }): Promise<{ enrollmentId: string; invoiceNumber: string | null; amountPaise: number } | null> {
    const program = await this.prisma.client.program.findFirst({
      where: { id: args.programId, tenantId: args.tenantId, deletedAt: null },
      select: { pricePaise: true },
    });
    // A free/unpriced program has nothing to invoice, and a ₹0 invoice is noise in the
    // ledger. Not an error — scholarship seats are a real thing.
    if (!program || program.pricePaise <= 0) return null;

    try {
      const order = await this.commerce.createOrder(
        args.tenantId,
        args.actorId,
        `onboarding-order-${args.submissionId}`,
        { studentId: args.studentProfileId, programId: args.programId, batchId: args.batchId },
      );

      await this.commerce.recordManualPayment(args.tenantId, args.actorId, `onboarding-payment-${args.submissionId}`, {
        orderId: order.id,
        // The ORDER's amount, not the program's — createOrder is what applies coupons and
        // is the authority on what is owed; recordManualPayment rejects any mismatch.
        amountPaise: order.amountPaise,
        method: "offline",
        reference: args.reference ?? `Onboarding ${args.submissionId}`,
        notes: "Recorded automatically when the onboarding submission was approved.",
      });

      const [enrollment, invoice] = await Promise.all([
        this.prisma.client.enrollment.findFirst({
          where: { studentId: args.studentProfileId, batchId: args.batchId, deletedAt: null },
          select: { id: true },
        }),
        this.prisma.client.invoice.findFirst({ where: { orderId: order.id }, select: { number: true } }),
      ]);

      // recordManualPayment creates the enrollment inside its transaction, so a miss here
      // means something is genuinely wrong with the assumption above rather than a race.
      if (!enrollment) {
        this.logger.error(
          `[Onboarding] Payment recorded for submission=${args.submissionId} but no enrollment was found, falling back.`,
        );
        return null;
      }

      return { enrollmentId: enrollment.id, invoiceNumber: invoice?.number ?? null, amountPaise: order.amountPaise };
    } catch (err) {
      // Draft program, batch at capacity, duplicate open order, storage down mid-invoice —
      // all end here. Loud log (staff will want to invoice manually), null return, and the
      // caller enrols the student anyway.
      this.logger.error(
        `[Onboarding] Offline payment/invoice failed for submission=${args.submissionId}. Enrolling without an invoice: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
      );
      return null;
    }
  }

  /**
   * Find the student behind this email, or create one.
   *
   * Matching is on `users.email` within the tenant (its `@@unique([tenantId, email])`), so
   * a student who already exists — converted from a lead, or self-registered — is reused
   * rather than duplicated. A soft-deleted student profile is restored rather than
   * re-created, because the unique email constraint would reject a second user row anyway.
   *
   * `hasLogin` reports whether the account already had a password. It is read HERE, before
   * anything provisions, because that is the only moment the answer is still knowable — the
   * money leg provisions silently inside commerce, and afterwards every account looks alike.
   */
  private async resolveStudent(
    tenantId: string,
    person: { email: string; fullName: string | null; phone: string | null; college: string | null },
  ): Promise<{ studentProfileId: string; created: boolean; hasLogin: boolean }> {
    const existingUser = await this.prisma.client.user.findFirst({
      where: { tenantId, email: person.email },
      select: {
        id: true,
        deletedAt: true,
        // Empty string = provisioned-but-never-set (students.repository.createStudentWithUser).
        passwordHash: true,
        // `deletedAt: undefined` opts out of the soft-delete extension's auto-filter so a
        // previously-removed profile is FOUND and restored, instead of falling through to
        // a create that the unique email constraint would then reject with a raw 500.
        studentProfile: { where: { deletedAt: undefined }, select: { id: true, deletedAt: true } },
      },
    });

    if (existingUser) {
      const profile = existingUser.studentProfile;
      if (!profile) {
        // The email belongs to a staff/faculty/mentor login. Attaching a student profile to
        // it would give one account two conflicting roles and let a student log into the
        // CRM. Refuse and let a human sort it out.
        throw new UnprocessableEntityException({
          code: "onboarding.email_not_a_student",
          title: "That email already belongs to a non-student account",
          detail: `${person.email} is already in use by a staff account. Ask the student for a different email address, or resolve the duplicate under Admin ▸ Users first.`,
        });
      }
      if (profile.deletedAt) {
        await this.prisma.client.studentProfile.update({
          where: { id: profile.id },
          data: { deletedAt: null, status: "lead" }, // enrollOrRestore promotes lead → active.
        });
      }
      // Backfill only what is genuinely missing — never overwrite a name/phone/college a
      // staff member has since curated in the CRM with whatever was typed into a form.
      await this.backfillMissingDetails(existingUser.id, profile.id, person);
      return { studentProfileId: profile.id, created: false, hasLogin: existingUser.passwordHash !== "" };
    }

    const created = await this.students.createStudentWithUser({
      tenantId,
      name: person.fullName?.trim() || person.email,
      email: person.email,
      ...(person.phone ? { phone: person.phone } : {}),
      ...(person.college ? { college: person.college } : {}),
      // The form does not ask for a course type, so the field is left UNSET rather than
      // recorded as "other" — an answer nobody gave. Staff fill it in the CRM if needed.
      source: "onboarding_form",
      // `lead`, not `active` — enrollOrRestore performs the promotion, so activation has
      // exactly one owner rather than two places that could disagree.
      status: "lead",
    });
    // Brand new: created with an empty passwordHash, so it has no login yet by definition.
    return { studentProfileId: created.id, created: true, hasLogin: false };
  }

  /** Fills blank name/phone/college from the submission. Never overwrites existing values. */
  private async backfillMissingDetails(
    userId: string,
    profileId: string,
    person: { fullName: string | null; phone: string | null; college: string | null },
  ): Promise<void> {
    const [user, profile] = await Promise.all([
      this.prisma.client.user.findUnique({ where: { id: userId }, select: { name: true, phone: true } }),
      this.prisma.client.studentProfile.findUnique({ where: { id: profileId }, select: { college: true } }),
    ]);

    const userPatch: { name?: string; phone?: string } = {};
    if (!user?.name?.trim() && person.fullName?.trim()) userPatch.name = person.fullName.trim();
    if (!user?.phone?.trim() && person.phone?.trim()) userPatch.phone = person.phone.trim();
    if (Object.keys(userPatch).length > 0) {
      await this.prisma.client.user.update({ where: { id: userId }, data: userPatch });
    }

    if (!profile?.college?.trim() && person.college?.trim()) {
      await this.prisma.client.studentProfile.update({
        where: { id: profileId },
        data: { college: person.college.trim() },
      });
    }
  }
}
