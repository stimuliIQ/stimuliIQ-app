// apps/api/src/modules/leave/leave-notification.service.ts
//
// Who hears about a leave request, and when.
//
// EVERY SEND HERE IS BEST-EFFORT AND PAST THE COMMIT POINT. The decision is already durable
// by the time these run, and the applicant can always see the state in the CRM, so a mail
// provider having a bad afternoon must never undo an approval. Each path is wrapped in a
// try/catch that logs a warning and returns — the same discipline as
// `LeadsService.notifyAssignee` and the P4 submission-returned path.
//
// `leave_requested` fans out to every active super_admin, because the approval queue has
// exactly one audience and it must not depend on somebody remembering to open the CRM. If a
// tenant somehow has no active super_admin, that is logged loudly and the request still
// stands: an unwatched queue is a problem to fix, not a reason to refuse the application.

import { Injectable, Logger } from "@nestjs/common";
import { formatLeaveDays } from "@repo/types";

import { NotificationsService } from "../notifications/notifications.service";
import { OrgService } from "../org/org.service";
import { LeaveRepository, type LeaveRequestRow } from "./leave.repository";
import { halfDaysToDays, toIsoDate } from "./leave.util";

@Injectable()
export class LeaveNotificationService {
  private readonly logger = new Logger(LeaveNotificationService.name);

  constructor(
    private readonly repo: LeaveRepository,
    private readonly notifications: NotificationsService,
    // The org chart decides who a request has to reach. Before it existed this service could
    // only shout at every super_admin.
    private readonly org: OrgService,
  ) {}

  /** "17–21 Aug 2026", or "17 Aug 2026" when it is a single day. */
  private formatDateRange(row: LeaveRequestRow): string {
    const fmt = new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
    const start = fmt.format(row.startDate);
    const end = fmt.format(row.endDate);
    return start === end ? start : `${start} – ${end}`;
  }

  private basePayload(row: LeaveRequestRow): Record<string, string> {
    return {
      applicantName: row.user.name,
      leaveTypeName: row.leaveType.name,
      dateRange: this.formatDateRange(row),
      days: formatLeaveDays(halfDaysToDays(row.halfDays)),
      startDate: toIsoDate(row.startDate),
      endDate: toIsoDate(row.endDate),
    };
  }

  /**
   * Tells whoever actually has to decide that somebody is waiting.
   *
   * This used to fan out to every active super_admin unconditionally, which was the only
   * option when there was no org chart. It now goes to the resolved FIRST approver — the
   * applicant's team lead, or their manager on a single-step chain — and falls back to HR
   * plus the owner when the chain names nobody.
   *
   * The fallback is not a nicety. A request that lands in a queue nobody watches is the
   * exact failure `listApprovers` was written to prevent, and a half-built org chart is the
   * normal state of one being built.
   */
  async notifyRequested(tenantId: string, row: LeaveRequestRow): Promise<void> {
    try {
      const approvers = await this.resolveRecipients(tenantId, row.userId, "first");
      if (approvers.length === 0) {
        this.logger.warn(
          `[LeaveNotificationService] tenant ${tenantId} has no resolvable approver and no ` +
            `active HR or super_admin, leave request ${row.id} was saved but nobody was notified.`,
        );
        return;
      }

      const payload = { ...this.basePayload(row), reason: row.reason };

      // Sequential rather than Promise.all: this is a handful of recipients, and one
      // approver's provider failure should not abort the rest of the fan-out.
      for (const approver of approvers) {
        try {
          await this.notifications.notify(approver.id, tenantId, "leave_requested", payload, {
            toEmail: approver.email,
          });
        } catch (err) {
          this.logger.warn(
            `[LeaveNotificationService] notify leave_requested failed for ${approver.id} (non-fatal): ${String(err)}`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(`[LeaveNotificationService] notifyRequested failed (non-fatal): ${String(err)}`);
    }
  }

  /**
   * Who to tell, for a given step of a given applicant's chain.
   *
   * `"first"` is whoever must act now on a fresh request; `"final"` is whoever must confirm
   * once the lead has approved. Either resolves to a single named person when the org chart
   * has one, and to HR + the owner when it does not. The owner is ALWAYS in the fallback,
   * never merely "if there is no HR" — "we hired an HR person who then went on leave" is
   * precisely when a queue stops being watched.
   */
  private async resolveRecipients(
    tenantId: string,
    applicantId: string,
    step: "first" | "final",
  ): Promise<Array<{ id: string; name: string; email: string }>> {
    const chain = await this.org.resolveApprovalChain(tenantId, applicantId);
    const targetId = step === "first" ? (chain.firstApproverId ?? chain.finalApproverId) : chain.finalApproverId;

    if (targetId) {
      const person = await this.repo.findUserName(tenantId, targetId);
      if (person) return [{ id: targetId, ...person }];
    }
    return this.org.listFallbackApprovers(tenantId);
  }

  /**
   * Step one is done — tell the MANAGER it is waiting on them.
   *
   * Without this hop a two-step chain would be strictly worse than the one-step one it
   * replaced: the lead approves, and the request sits silently until somebody happens to
   * open the queue.
   */
  async notifyLeadApproved(tenantId: string, row: LeaveRequestRow): Promise<void> {
    try {
      const recipients = await this.resolveRecipients(tenantId, row.userId, "final");
      if (recipients.length === 0) {
        this.logger.warn(
          `[LeaveNotificationService] leave request ${row.id} was approved by the team lead ` +
            "but has no resolvable final approver — nobody was notified.",
        );
        return;
      }
      const payload = {
        ...this.basePayload(row),
        reason: row.reason,
        reviewerName: row.leadApprovedBy?.name ?? "the team lead",
      };
      for (const recipient of recipients) {
        try {
          await this.notifications.notify(recipient.id, tenantId, "leave_requested", payload, {
            toEmail: recipient.email,
          });
        } catch (err) {
          this.logger.warn(
            `[LeaveNotificationService] notify lead-approved failed for ${recipient.id} (non-fatal): ${String(err)}`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(`[LeaveNotificationService] notifyLeadApproved failed (non-fatal): ${String(err)}`);
    }
  }

  /** Tells the applicant what was decided. On a rejection, carries the reviewer's reason. */
  async notifyDecision(
    tenantId: string,
    row: LeaveRequestRow,
    decision: "approved" | "rejected",
  ): Promise<void> {
    try {
      await this.notifications.notify(
        row.userId,
        tenantId,
        decision === "approved" ? "leave_approved" : "leave_rejected",
        {
          ...this.basePayload(row),
          reviewerName: row.reviewedBy?.name ?? "your admin",
          reason: row.reviewNote ?? "",
        },
        { toEmail: row.user.email },
      );
    } catch (err) {
      this.logger.warn(
        `[LeaveNotificationService] notify leave_${decision} failed for request ${row.id} (non-fatal): ${String(err)}`,
      );
    }
  }
}
