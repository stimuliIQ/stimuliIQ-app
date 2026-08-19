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
import { LeaveRepository, type LeaveRequestRow } from "./leave.repository";
import { halfDaysToDays, toIsoDate } from "./leave.util";

@Injectable()
export class LeaveNotificationService {
  private readonly logger = new Logger(LeaveNotificationService.name);

  constructor(
    private readonly repo: LeaveRepository,
    private readonly notifications: NotificationsService,
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

  /** Tells every active super_admin that somebody is waiting on a decision. */
  async notifyRequested(tenantId: string, row: LeaveRequestRow): Promise<void> {
    try {
      const approvers = await this.repo.listApprovers(tenantId);
      if (approvers.length === 0) {
        this.logger.warn(
          `[LeaveNotificationService] tenant ${tenantId} has no active super_admin — ` +
            `leave request ${row.id} was saved but nobody was notified.`,
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
