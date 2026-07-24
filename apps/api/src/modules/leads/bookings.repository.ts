// apps/api/src/modules/leads/bookings.repository.ts
//
// Prisma data access ONLY for `bookings` (demo/slot bookings — docs/03-prd-crm.md §7.12).
// BookingsService is the only caller.
//
// SCOPE INHERITANCE: a booking has no owner/branch column of its own — visibility is
// inherited via its parent `lead` (`leadId` -> the lead's owner/branch). A booking with no
// `leadId` (program-only enquiry slot, e.g. from the public intake before a counsellor is
// assigned) is visible tenant-wide to any caller whose scope is "all"/"branch", and to NO
// "own"/"assigned" caller until a lead is attached — BookingsService resolves this and
// passes the final `scopeWhere` down; this repository never decides scope itself.

import { Injectable } from "@nestjs/common";
import { Prisma, type BookingStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export type BookingScopeWhere = Prisma.BookingWhereInput;

export interface ListBookingsFilters {
  tenantId: string;
  leadId?: string;
  programId?: string;
  status?: BookingStatus;
  page: number;
  pageSize: number;
  scopeWhere: BookingScopeWhere;
}

export interface BookingRow {
  id: string;
  tenantId: string;
  leadId: string | null;
  leadName: string | null;
  programId: string | null;
  programTitle: string | null;
  slotAt: Date;
  status: BookingStatus;
  source: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

const BOOKING_INCLUDE = {
  lead: { select: { name: true } },
  program: { select: { title: true } },
} satisfies Prisma.BookingInclude;

type BookingWithRelations = Prisma.BookingGetPayload<{ include: typeof BOOKING_INCLUDE }>;

function toBookingRow(row: BookingWithRelations): BookingRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    leadId: row.leadId,
    leadName: row.lead?.name ?? null,
    programId: row.programId,
    programTitle: row.program?.title ?? null,
    slotAt: row.slotAt,
    status: row.status,
    source: row.source,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

@Injectable()
export class BookingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: ListBookingsFilters): Promise<{ rows: BookingRow[]; total: number }> {
    const where: Prisma.BookingWhereInput = {
      tenantId: filters.tenantId,
      deletedAt: null,
      ...filters.scopeWhere,
      ...(filters.leadId ? { leadId: filters.leadId } : {}),
      ...(filters.programId ? { programId: filters.programId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.booking.findMany({
        where,
        include: BOOKING_INCLUDE,
        orderBy: { slotAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.booking.count({ where }),
    ]);

    return { rows: rows.map(toBookingRow), total };
  }

  async findById(tenantId: string, id: string, scopeWhere: BookingScopeWhere = {}): Promise<BookingRow | null> {
    const row = await this.prisma.client.booking.findFirst({
      where: { id, tenantId, deletedAt: null, ...scopeWhere },
      include: BOOKING_INCLUDE,
    });
    return row ? toBookingRow(row) : null;
  }

  async create(data: {
    tenantId: string;
    leadId?: string;
    programId?: string;
    slotAt: Date;
    status?: BookingStatus;
    source: string;
    consent?: Prisma.InputJsonValue;
  }): Promise<{ id: string }> {
    const row = await this.prisma.client.booking.create({
      data: {
        tenantId: data.tenantId,
        leadId: data.leadId,
        programId: data.programId,
        slotAt: data.slotAt,
        status: data.status ?? "requested",
        source: data.source,
        ...(data.consent !== undefined ? { consent: data.consent } : {}),
      },
    });
    return { id: row.id };
  }

  async update(id: string, patch: Partial<{ slotAt: Date; programId: string | null; source: string }>): Promise<void> {
    await this.prisma.client.booking.update({
      where: { id },
      data: {
        ...(patch.slotAt !== undefined ? { slotAt: patch.slotAt } : {}),
        ...(patch.programId !== undefined ? { programId: patch.programId } : {}),
        ...(patch.source !== undefined ? { source: patch.source } : {}),
      },
    });
  }

  async moveStatus(id: string, status: BookingStatus): Promise<void> {
    await this.prisma.client.booking.update({ where: { id }, data: { status } });
  }

  /**
   * PUBLIC INTAKE ONLY: creates a `new`-stage lead + a `requested` booking in ONE
   * transaction (docs/plans/phase-2.md task #6, "creates a LEAD ... + a BOOKING ...
   * in one txn"). Bypasses the authenticated scope machinery entirely — there is no
   * caller scope for an unauthenticated request. Tenant is resolved by the caller
   * (LeadsService.createPublicBooking) via the same `TENANT_SLUG` mechanism auth uses.
   */
  async createPublicLeadAndBooking(data: {
    tenantId: string;
    name: string;
    phone: string;
    email?: string;
    programId?: string;
    slotAt: Date;
    source: string;
    utm?: unknown;
    consent?: Prisma.InputJsonValue;
  }): Promise<{ leadId: string; bookingId: string; slotAt: Date; status: BookingStatus }> {
    return this.prisma.client.$transaction(async (tx) => {
      const lead = await tx.lead.create({
        data: {
          tenantId: data.tenantId,
          name: data.name,
          phone: data.phone,
          email: data.email,
          programInterestId: data.programId,
          source: data.source,
          utm: data.utm as Prisma.InputJsonValue | undefined,
          stage: "new",
        },
      });

      const booking = await tx.booking.create({
        data: {
          tenantId: data.tenantId,
          leadId: lead.id,
          programId: data.programId,
          slotAt: data.slotAt,
          status: "requested",
          source: data.source,
          ...(data.consent !== undefined ? { consent: data.consent } : {}),
        },
      });

      return { leadId: lead.id, bookingId: booking.id, slotAt: booking.slotAt, status: booking.status };
    });
  }
}
