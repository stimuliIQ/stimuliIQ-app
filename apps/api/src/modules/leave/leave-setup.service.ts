// apps/api/src/modules/leave/leave-setup.service.ts
//
// The configuration half of leave: leave types, yearly allowances, public holidays and the
// working week. Split from leave.service.ts because it is a different audience with a
// different permission — every member of staff applies for leave, but only the super admin
// decides what the categories are and how many days each one is worth.
//
// The READS here are open to anyone holding `leave.view`: the apply form needs the types, and
// the calendar needs the holidays and the working week. Only the WRITES require
// `leave.manage`, which is seeded to super_admin alone (prisma/seed.ts).

import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type {
  CreateHolidayRequest,
  CreateLeaveTypeRequest,
  Holiday,
  LeaveQuota,
  LeaveSetting,
  LeaveType,
  SaveLeaveQuotasRequest,
  UpdateHolidayRequest,
  UpdateLeaveSettingRequest,
  UpdateLeaveTypeRequest,
} from "@repo/types";

import { LeaveRepository } from "./leave.repository";
import { daysToHalfDays, fromIsoDate, toHolidayDto, toLeaveQuotaDto, toLeaveTypeDto } from "./leave.util";

/**
 * Sundays off, used when a tenant has never configured a working week.
 *
 * Supplied by this layer rather than as a database default so that "nobody has set this up"
 * and "somebody chose Sundays" stay distinguishable in the row itself — the repository
 * returns null for the former, and the setup screen can say so.
 */
export const DEFAULT_WEEKLY_OFF_DAYS: readonly number[] = [0];

@Injectable()
export class LeaveSetupService {
  constructor(private readonly repo: LeaveRepository) {}

  // ── Leave types ─────────────────────────────────────────────────────────

  async listTypes(tenantId: string, activeOnly: boolean): Promise<LeaveType[]> {
    const rows = await this.repo.listLeaveTypes(tenantId, activeOnly);
    return rows.map(toLeaveTypeDto);
  }

  async createType(tenantId: string, body: CreateLeaveTypeRequest): Promise<LeaveType> {
    const clash = await this.repo.findLeaveTypeByKey(tenantId, body.key);
    if (clash) {
      throw new ConflictException({
        code: "leave.type_key_taken",
        title: "That key is already in use",
        detail: `A leave type with the key "${body.key}" already exists.`,
      });
    }

    const row = await this.repo.createLeaveType(tenantId, {
      key: body.key,
      name: body.name,
      description: body.description ?? null,
      paid: body.paid,
      allowHalfDay: body.allowHalfDay,
      active: body.active,
      sortOrder: body.sortOrder,
    });
    return toLeaveTypeDto(row);
  }

  async updateType(tenantId: string, id: string, body: UpdateLeaveTypeRequest): Promise<LeaveType> {
    const row = await this.repo.updateLeaveType(tenantId, id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description ?? null } : {}),
      ...(body.paid !== undefined ? { paid: body.paid } : {}),
      ...(body.allowHalfDay !== undefined ? { allowHalfDay: body.allowHalfDay } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
    });
    if (!row) throw this.typeNotFound();
    return toLeaveTypeDto(row);
  }

  /**
   * Delete a leave type.
   *
   * Refused outright once any request references it, even though the delete is a soft one and
   * the row would survive. The alternative reads fine and behaves badly: past leave would keep
   * its label (the FK still resolves) but the type would vanish from the balance screen's
   * active list, so somebody's deducted days would have no line explaining them. Deactivating
   * is what the person actually wants here — it takes the type off the apply form and leaves
   * history intact — so the error says so.
   */
  async deleteType(tenantId: string, id: string): Promise<void> {
    const inUse = await this.repo.countRequestsForLeaveType(tenantId, id);
    if (inUse > 0) {
      throw new ConflictException({
        code: "leave.type_in_use",
        title: "This leave type is in use",
        detail:
          `${inUse} leave request(s) use this type, so deleting it would leave them unexplained. ` +
          "Switch it off instead — it disappears from the apply form and the history stays readable.",
      });
    }
    const deleted = await this.repo.deleteLeaveType(tenantId, id);
    if (!deleted) throw this.typeNotFound();
  }

  // ── Yearly allowances ───────────────────────────────────────────────────

  async listQuotas(tenantId: string, year: number): Promise<LeaveQuota[]> {
    const rows = await this.repo.listQuotas(tenantId, year);
    return rows.map(toLeaveQuotaDto);
  }

  /**
   * Save a whole year's allowances in one go — the setup screen edits the year as a grid, and
   * a per-row save would leave a half-applied year behind on the first network failure with
   * nobody able to tell which half.
   */
  async saveQuotas(tenantId: string, body: SaveLeaveQuotasRequest): Promise<LeaveQuota[]> {
    const types = await this.repo.listLeaveTypes(tenantId, false);
    const validIds = new Set(types.map((t) => t.id));

    for (const allocation of body.allocations) {
      if (!validIds.has(allocation.leaveTypeId)) {
        throw new UnprocessableEntityException({
          code: "leave.type_not_found",
          title: "Unknown leave type",
          detail: "One of the allowances refers to a leave type that no longer exists. Reload and try again.",
        });
      }
    }

    const seen = new Set<string>();
    for (const allocation of body.allocations) {
      if (seen.has(allocation.leaveTypeId)) {
        throw new UnprocessableEntityException({
          code: "leave.duplicate_allocation",
          title: "Duplicate allowance",
          detail: "The same leave type appears twice in this year's allowances.",
        });
      }
      seen.add(allocation.leaveTypeId);
    }

    await this.repo.saveQuotas(
      tenantId,
      body.year,
      body.allocations.map((a) => ({ leaveTypeId: a.leaveTypeId, halfDays: daysToHalfDays(a.days) })),
    );

    return this.listQuotas(tenantId, body.year);
  }

  // ── Holidays ────────────────────────────────────────────────────────────

  async listHolidays(tenantId: string, year: number): Promise<Holiday[]> {
    const rows = await this.repo.listHolidays(tenantId, year);
    return rows.map(toHolidayDto);
  }

  async createHoliday(tenantId: string, body: CreateHolidayRequest): Promise<Holiday> {
    const date = fromIsoDate(body.date);
    const clash = await this.repo.findHolidayOnDate(tenantId, date);
    if (clash) {
      throw new ConflictException({
        code: "leave.holiday_date_taken",
        title: "There's already a holiday on that date",
        detail: `${body.date} is already marked as a holiday. Edit that one instead of adding a second.`,
      });
    }

    const row = await this.repo.createHoliday(tenantId, {
      date,
      name: body.name,
      description: body.description ?? null,
      optional: body.optional,
    });
    return toHolidayDto(row);
  }

  async updateHoliday(tenantId: string, id: string, body: UpdateHolidayRequest): Promise<Holiday> {
    if (body.date) {
      const clash = await this.repo.findHolidayOnDate(tenantId, fromIsoDate(body.date));
      if (clash && clash.id !== id) {
        throw new ConflictException({
          code: "leave.holiday_date_taken",
          title: "There's already a holiday on that date",
          detail: `${body.date} is already marked as a holiday.`,
        });
      }
    }

    const row = await this.repo.updateHoliday(tenantId, id, {
      ...(body.date !== undefined ? { date: fromIsoDate(body.date) } : {}),
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description ?? null } : {}),
      ...(body.optional !== undefined ? { optional: body.optional } : {}),
    });
    if (!row) {
      throw new NotFoundException({
        code: "leave.holiday_not_found",
        title: "Not found",
        detail: "No such holiday.",
      });
    }
    return toHolidayDto(row);
  }

  /**
   * Deleting a holiday does NOT recompute leave already taken across it.
   *
   * That is deliberate. `leave_requests.half_days` is computed and stored at apply time, so
   * removing a holiday somebody's approved leave spanned leaves their duration exactly as it
   * was agreed. Retroactively lengthening leave people have already taken, because the
   * calendar was corrected in November, is not a correction anybody wants.
   */
  async deleteHoliday(tenantId: string, id: string): Promise<void> {
    const deleted = await this.repo.deleteHoliday(tenantId, id);
    if (!deleted) {
      throw new NotFoundException({
        code: "leave.holiday_not_found",
        title: "Not found",
        detail: "No such holiday.",
      });
    }
  }

  // ── Working week ────────────────────────────────────────────────────────

  async getSetting(tenantId: string): Promise<LeaveSetting> {
    return { weeklyOffDays: await this.getWeeklyOffDays(tenantId) };
  }

  /** The configured working week, or the default when a tenant has never set one. */
  async getWeeklyOffDays(tenantId: string): Promise<number[]> {
    const row = await this.repo.findSetting(tenantId);
    return row ? row.weeklyOffDays : [...DEFAULT_WEEKLY_OFF_DAYS];
  }

  async updateSetting(tenantId: string, body: UpdateLeaveSettingRequest): Promise<LeaveSetting> {
    // De-duplicated and sorted before saving so `[6, 0, 0]` and `[0, 6]` are the same row.
    // Both are the same working week, and storing them differently would make the audit trail
    // show a change where none happened.
    const weeklyOffDays = [...new Set(body.weeklyOffDays)].sort((a, b) => a - b);
    const saved = await this.repo.saveSetting(tenantId, weeklyOffDays);
    return { weeklyOffDays: saved.weeklyOffDays };
  }

  private typeNotFound(): NotFoundException {
    return new NotFoundException({
      code: "leave.type_not_found",
      title: "Not found",
      detail: "No such leave type.",
    });
  }
}
