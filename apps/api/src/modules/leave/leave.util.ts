// apps/api/src/modules/leave/leave.util.ts
//
// Row → DTO mappers, and the two unit conversions this feature depends on.
//
// EVERY DATE CONVERSION IN THIS MODULE HAPPENS HERE, ONCE. `start_date`, `end_date` and
// `holidays.date` are Postgres DATE columns; Prisma hands them back as UTC-midnight `Date`
// objects. Handing one of those to the response envelope serialises it as
// "2026-01-05T00:00:00.000Z", and a browser in any timezone west of UTC then renders it as
// 4 January — leave that silently starts a day early. So a `Date` never leaves this module;
// it becomes "YYYY-MM-DD" here or not at all.
//
// HALF-DAYS: the database stores integer half-day units and the API speaks days. The
// division happens here and nowhere else, so there is exactly one place where the unit can
// be got wrong.

import type {
  Holiday,
  LeaveCalendarEntry,
  LeaveQuota,
  LeaveRequestDetail,
  LeaveRequestSummary,
  LeaveType,
} from "@repo/types";

import type {
  HolidayRow,
  LeaveCalendarRow,
  LeaveQuotaRow,
  LeaveRequestRow,
  LeaveTypeRow,
} from "./leave.repository";

/** A Postgres DATE as "YYYY-MM-DD". Reads the UTC components — never the local ones. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" → the UTC-midnight Date that Postgres DATE columns round-trip cleanly. */
export function fromIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Integer half-day units → days for display. The only place this division happens. */
export function halfDaysToDays(halfDays: number): number {
  return halfDays / 2;
}

/** Days (whole or half) → integer half-day units. The only place this multiplication happens. */
export function daysToHalfDays(days: number): number {
  return Math.round(days * 2);
}

export function toLeaveTypeDto(row: LeaveTypeRow): LeaveType {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    paid: row.paid,
    allowHalfDay: row.allowHalfDay,
    active: row.active,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toHolidayDto(row: HolidayRow): Holiday {
  return {
    id: row.id,
    date: toIsoDate(row.date),
    name: row.name,
    description: row.description,
    optional: row.optional,
  };
}

export function toLeaveQuotaDto(row: LeaveQuotaRow): LeaveQuota {
  return {
    id: row.id,
    leaveTypeId: row.leaveTypeId,
    leaveTypeName: row.leaveType.name,
    year: row.year,
    halfDays: row.halfDays,
    days: halfDaysToDays(row.halfDays),
  };
}

export function toLeaveRequestSummaryDto(row: LeaveRequestRow): LeaveRequestSummary {
  return {
    id: row.id,
    userId: row.userId,
    userName: row.user.name,
    leaveTypeId: row.leaveTypeId,
    leaveTypeName: row.leaveType.name,
    startDate: toIsoDate(row.startDate),
    endDate: toIsoDate(row.endDate),
    startDayPart: row.startDayPart,
    endDayPart: row.endDayPart,
    halfDays: row.halfDays,
    days: halfDaysToDays(row.halfDays),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toLeaveRequestDetailDto(row: LeaveRequestRow): LeaveRequestDetail {
  return {
    ...toLeaveRequestSummaryDto(row),
    userEmail: row.user.email,
    reason: row.reason,
    reviewedById: row.reviewedById,
    reviewedByName: row.reviewedBy?.name ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewNote: row.reviewNote,
    leadApprovedById: row.leadApprovedById,
    leadApprovedByName: row.leadApprovedBy?.name ?? null,
    leadApprovedAt: row.leadApprovedAt?.toISOString() ?? null,
    leadApprovalNote: row.leadApprovalNote,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The calendar entry. There is no `reason` on `LeaveCalendarRow` to copy even by accident —
 * the repository's select never fetches it. Keep it that way: the calendar is visible to
 * every member of staff, and why somebody is off is between them and the approver.
 */
export function toLeaveCalendarEntryDto(row: LeaveCalendarRow, actorId: string): LeaveCalendarEntry {
  return {
    id: row.id,
    userId: row.userId,
    userName: row.user.name,
    leaveTypeName: row.leaveType.name,
    startDate: toIsoDate(row.startDate),
    endDate: toIsoDate(row.endDate),
    startDayPart: row.startDayPart,
    endDayPart: row.endDayPart,
    status: row.status,
    isSelf: row.userId === actorId,
  };
}
