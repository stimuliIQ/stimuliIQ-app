// apps/api/src/modules/onboarding/onboarding-notification.service.ts
//
// The one email onboarding sends on its own behalf: the REJECTION notice.
//
// Approval has no counterpart here on purpose — an approved student is emailed by the
// lifecycle their approval starts (the combined invoice + LMS-credentials message from
// CommerceService, or LmsAccountProvisioningService's welcome mail when there is nothing to
// invoice). Adding a third "you were accepted" email from this module would mean two
// messages for one event.
//
// WHAT THE STUDENT IS TOLD, AND WHAT THEY ARE NOT. The message says the application was not
// accepted and points at support. It deliberately does NOT carry `reviewNotes`: those are
// internal ("dodgy receipt", "duplicate of #412"), the CRM promises staff they are never
// shown to the student, and a rejection reason is a conversation for support to have with a
// real person — not a line in an automated email nobody can reply to with context.
//
// Best-effort, always: a bounced email must never fail the rejection itself. The decision
// is recorded either way; a send failure is logged for follow-up.

import { Inject, Injectable, Logger } from "@nestjs/common";
import { MAIL_PROVIDER, type MailProvider } from "../notifications/providers/mail/mail-provider.interface";
import { renderBrandedEmail, escapeEmailHtml, SUPPORT_EMAIL } from "../notifications/dispatch/email-layout";

@Injectable()
export class OnboardingNotificationService {
  private readonly logger = new Logger(OnboardingNotificationService.name);

  constructor(@Inject(MAIL_PROVIDER) private readonly mail: MailProvider) {}

  /**
   * Tell the student their onboarding submission was not accepted, and where to go next.
   *
   * Never throws. Returns true when the message was handed to the provider — a submission
   * with no email address (the form need not ask for one) is a silent no-op, not an error.
   */
  async sendRejectionEmail(to: string | null, studentName: string | null, programTitle: string | null): Promise<boolean> {
    if (!to) return false;

    try {
      await this.mail.send({
        to,
        subject: "About your Stimuli IQ application",
        html: renderBrandedEmail({
          title: "We couldn't accept your application",
          greeting: `Hi ${escapeEmailHtml(studentName?.trim() || "there")},`,
          paragraphs: [
            programTitle
              ? `Thank you for applying to <strong>${escapeEmailHtml(programTitle)}</strong>. After reviewing your onboarding details, we're not able to confirm your seat at this time.`
              : "Thank you for completing our onboarding form. After reviewing your details, we're not able to confirm your seat at this time.",
            // The single most useful thing this email can do is get a human involved:
            // most rejections are a fixable receipt or a mistyped detail, not a verdict.
            "This is often something straightforward to sort out. An unclear payment receipt, a detail that didn't match, or a batch that filled up. Please get in touch with our support team and we'll walk you through it.",
          ],
          button: { label: "Contact support", url: `mailto:${SUPPORT_EMAIL}` },
          footnote: `You can reach us any time at ${SUPPORT_EMAIL}. If you've already paid, please keep your payment receipt handy. It helps us resolve this faster.`,
        }),
        tags: [{ name: "category", value: "onboarding_rejected" }],
      });
      return true;
    } catch (err) {
      this.logger.error(
        `[Onboarding] Rejection email failed for ${to}: ${err instanceof Error ? err.message : "unknown error"}`,
      );
      return false;
    }
  }
}
