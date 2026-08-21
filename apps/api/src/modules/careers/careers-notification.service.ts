// apps/api/src/modules/careers/careers-notification.service.ts
//
// Every email a job candidate receives. Four of them, and no more:
//
//   1. acknowledgement — "we have your application"   (on submit, automatic)
//   2. next round      — "you're through, here's what happens next"
//   3. offer           — "we're offering you the role" + the signed offer letter ATTACHED
//   4. rejection       — "we're not taking this forward"
//
// A candidate is NOT a platform user: they have no account, no notification preferences and
// no in-app inbox, so this does not go through NotificationsService (which is built around
// a `userId` and a per-type preference matrix). It talks to MAIL_PROVIDER directly, exactly
// as OnboardingNotificationService does for prospective students, and for the same reason.
//
// THERE IS NO "YOU ARE ON HOLD" EMAIL. Holding is an internal parking action. "We are still
// thinking about you" is not information a candidate can act on, it reads as a soft no, and
// sending it would train people to ignore mail from us.
//
// WHAT IS NEVER SENT: `internalNotes`. Not in the rejection, not anywhere. Those are
// colleague-to-colleague notes ("weak on the practical", "duplicate of #88") and the CRM
// promises reviewers they stay internal. A candidate who wants feedback gets a person, not
// an automated paragraph — the same rule as OnboardingSubmission.reviewNotes (P12).
//
// BEST-EFFORT, ALWAYS: every method returns a boolean and never throws. A decision that has
// been recorded must not be rolled back because a mailbox bounced, and a reviewer must not
// be shown an error for something they cannot fix. Failures are logged, and for the
// acknowledgement the un-set `acknowledgedAt` column is itself the "this never went out"
// record the CRM surfaces.

import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  MAIL_PROVIDER,
  type MailAttachment,
  type MailProvider,
} from "../notifications/providers/mail/mail-provider.interface";
import { renderBrandedEmail, escapeEmailHtml, SUPPORT_EMAIL } from "../notifications/dispatch/email-layout";

/** Where a candidate is told to write. Careers mail should not land in the student-support queue. */
const CAREERS_REPLY_TO = SUPPORT_EMAIL;

export interface CandidateRef {
  name: string;
  email: string;
  /** The role title as the candidate applied for it (the application's snapshot). */
  role: string;
}

@Injectable()
export class CareersNotificationService {
  private readonly logger = new Logger(CareersNotificationService.name);

  constructor(@Inject(MAIL_PROVIDER) private readonly mail: MailProvider) {}

  private async trySend(
    label: string,
    to: string,
    payload: Parameters<MailProvider["send"]>[0],
  ): Promise<boolean> {
    try {
      await this.mail.send(payload);
      return true;
    } catch (err) {
      this.logger.error(
        `[Careers] ${label} email failed for ${to}: ${err instanceof Error ? err.message : "unknown error"}`,
      );
      return false;
    }
  }

  /**
   * 1. "Thanks for applying." Sent automatically the moment an application is stored.
   *
   * Says only what is true: we have it, a human will read it, and here is roughly when to
   * expect a reply. It promises no outcome and gives no timeline we cannot keep.
   */
  async sendAcknowledgement(candidate: CandidateRef): Promise<boolean> {
    const name = escapeEmailHtml(candidate.name.trim() || "there");
    const role = escapeEmailHtml(candidate.role);

    return this.trySend("Acknowledgement", candidate.email, {
      to: candidate.email,
      subject: `We received your application: ${candidate.role}`,
      html: renderBrandedEmail({
        title: "Thanks for applying",
        greeting: `Hi ${name},`,
        paragraphs: [
          `Thank you for applying for the <strong>${role}</strong> role at Stimuli IQ. Your application and resume have reached our team.`,
          "Someone from our hiring team reads every application. If your experience matches what the role needs, we'll be in touch to arrange the next step. You'll hear from us either way.",
        ],
        details: [{ label: "Role", value: role }],
        footnote: `Please keep this email for your records. If you need to add anything to your application, reply to us at ${CAREERS_REPLY_TO}.`,
      }),
      tags: [{ name: "category", value: "career_application_received" }],
    });
  }

  /**
   * 2. "You're through to the next round."
   *
   * `roundName` and `details` are written by the reviewer for THIS candidate and are the
   * substance of the message — the standing copy around them says almost nothing, on
   * purpose, because a generic "we'll be in touch to schedule" is the email that generates
   * a support ticket. Both are escaped: they are staff input, but they are still input.
   */
  async sendNextRound(candidate: CandidateRef, roundName: string, details: string): Promise<boolean> {
    const name = escapeEmailHtml(candidate.name.trim() || "there");
    const role = escapeEmailHtml(candidate.role);
    const round = escapeEmailHtml(roundName);

    return this.trySend("Next-round", candidate.email, {
      to: candidate.email,
      subject: `Next step in your application: ${candidate.role}`,
      html: renderBrandedEmail({
        title: "You're through to the next round",
        greeting: `Hi ${name},`,
        paragraphs: [
          `Good news — after reviewing your application for the <strong>${role}</strong> role, we'd like to take you through to the <strong>${round}</strong>.`,
          // Reviewer-authored, newline-preserved: they typed it as a note to this person and
          // it should arrive looking the way they wrote it.
          escapeEmailHtml(details).replace(/\n/g, "<br />"),
        ],
        details: [
          { label: "Role", value: role },
          { label: "Next step", value: round },
        ],
        closing: ["If any of this doesn't work for you, just reply to this email and we'll sort out an alternative."],
        footnote: `Questions before then? Reply here or write to ${CAREERS_REPLY_TO}.`,
      }),
      tags: [{ name: "category", value: "career_application_shortlisted" }],
    });
  }

  /**
   * 3. "We're offering you the role" — with the offer letter attached.
   *
   * The attachment is the point of this email, which is why the caller treats a failure to
   * read the letter out of storage as a hard error and never reaches this method: an offer
   * email arriving with no letter is worse than no email, because the candidate then has
   * something to celebrate and nothing to sign.
   */
  async sendOffer(
    candidate: CandidateRef,
    offerLetter: MailAttachment,
    message: string | null,
  ): Promise<boolean> {
    const name = escapeEmailHtml(candidate.name.trim() || "there");
    const role = escapeEmailHtml(candidate.role);

    return this.trySend("Offer", candidate.email, {
      to: candidate.email,
      subject: `Your offer from Stimuli IQ: ${candidate.role}`,
      html: renderBrandedEmail({
        title: "We'd like to offer you the role",
        greeting: `Hi ${name},`,
        paragraphs: [
          `We're delighted to offer you the <strong>${role}</strong> role at Stimuli IQ. Your offer letter is attached to this email.`,
          ...(message ? [escapeEmailHtml(message).replace(/\n/g, "<br />")] : []),
          "Please read the letter in full. When you're ready to accept, reply to this email with a signed copy. If anything in it needs discussing first, reply and we'll talk it through.",
        ],
        details: [
          { label: "Role", value: role },
          { label: "Offer letter", value: escapeEmailHtml(offerLetter.filename) },
        ],
        footnote: `The offer letter is attached to this email as a PDF. If you can't open it, write to ${CAREERS_REPLY_TO} and we'll send it another way.`,
      }),
      attachments: [offerLetter],
      tags: [{ name: "category", value: "career_application_offer" }],
    });
  }

  /**
   * 4. "We're not taking this forward."
   *
   * Short, definite, and kind. It does not say "we'll keep your CV on file" unless that is
   * true, and it carries no reason — see the file header.
   */
  async sendRejection(candidate: CandidateRef): Promise<boolean> {
    const name = escapeEmailHtml(candidate.name.trim() || "there");
    const role = escapeEmailHtml(candidate.role);

    return this.trySend("Rejection", candidate.email, {
      to: candidate.email,
      subject: `About your application: ${candidate.role}`,
      html: renderBrandedEmail({
        title: "An update on your application",
        greeting: `Hi ${name},`,
        paragraphs: [
          `Thank you for applying for the <strong>${role}</strong> role at Stimuli IQ, and for the time you put into your application.`,
          "After reviewing it carefully, we've decided not to take it further on this occasion. This reflects what we need for this particular role right now, and nothing more than that.",
          "We'd genuinely welcome an application from you for a future opening that fits your experience — our open roles are always listed on our careers page.",
        ],
        button: { label: "See our open roles", url: "https://www.stimuliiq.com/careers" },
        footnote: `We wish you the very best with your search. If you'd like to talk to someone, write to ${CAREERS_REPLY_TO}.`,
      }),
      tags: [{ name: "category", value: "career_application_rejected" }],
    });
  }
}
