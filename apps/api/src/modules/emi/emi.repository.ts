// apps/api/src/modules/emi/emi.repository.ts
//
// Prisma data access ONLY for `emi_plans` / `emi_installments` (CLAUDE.md §3.3).
// EmiService is the only caller. Soft-delete + audit are handled transparently by the
// Prisma client extensions (EmiPlan/EmiInstallment already registered in both).
//
// Reads `orders`/`student_profiles`/`users`/`payments`/`leads` directly for FK
// validation + display fields (the same narrow, read-only cross-model precedent as
// MentorsRepository reading Batch/Program, ReferralsRepository reading Lead/User).

import { Injectable } from "@nestjs/common";
import type { Prisma, EmiPlan as EmiPlanRow, EmiInstallment as EmiInstallmentRow, EmiPlanStatus, EmiInstallmentStatus, PaymentStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export interface ListEmiPlansFilters {
  tenantId: string;
  orderId?: string;
  status?: EmiPlanStatus;
  search?: string;
  /** "own" scope (student self-view or counsellor-owned-leads view) — see EmiService for who is which. */
  studentUserId?: string;
  leadOwnerId?: string;
  page: number;
  pageSize: number;
}

export interface EmiPlanWithStudent extends EmiPlanRow {
  order: { id: string; studentId: string; student: { user: { name: string; email: string } } };
}

export interface EmiPlanWithInstallments extends EmiPlanWithStudent {
  installments: EmiInstallmentRow[];
}

export interface InstallmentSeed {
  installmentNo: number;
  amountPaise: number;
  dueDate: Date;
}

const PLAN_INCLUDE_STUDENT = {
  order: { include: { student: { include: { user: { select: { name: true, email: true } } } } } },
} satisfies Prisma.EmiPlanInclude;

const PLAN_INCLUDE_FULL = {
  ...PLAN_INCLUDE_STUDENT,
  installments: { orderBy: { installmentNo: "asc" as const } },
} satisfies Prisma.EmiPlanInclude;

@Injectable()
export class EmiRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Order validation ─────────────────────────────────────────────────────

  findOrderForPlan(
    tenantId: string,
    orderId: string,
  ): Promise<{
    id: string;
    studentId: string;
    /** The order's own total. The plan's schedule is derived from THIS, never from the request body. */
    amountPaise: number;
    currency: string;
    studentEmail: string;
    studentName: string;
  } | null> {
    return this.prisma.client.order
      .findFirst({
        where: { id: orderId, tenantId },
        include: { student: { include: { user: { select: { email: true, name: true } } } } },
      })
      .then((row) =>
        row
          ? {
              id: row.id,
              studentId: row.studentId,
              amountPaise: row.amountPaise,
              currency: row.currency,
              studentEmail: row.student.user.email,
              studentName: row.student.user.name,
            }
          : null,
      );
  }

  findActivePlanByOrderId(tenantId: string, orderId: string): Promise<EmiPlanRow | null> {
    return this.prisma.client.emiPlan.findFirst({ where: { tenantId, orderId } });
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async createPlanWithInstallments(
    tenantId: string,
    data: {
      orderId: string;
      totalAmountPaise: number;
      currency: string;
      numInstallments: number;
      startDate: Date;
      installments: InstallmentSeed[];
    },
  ): Promise<string> {
    const plan = await this.prisma.client.emiPlan.create({
      data: {
        tenantId,
        orderId: data.orderId,
        totalAmountPaise: data.totalAmountPaise,
        currency: data.currency,
        numInstallments: data.numInstallments,
        startDate: data.startDate,
        status: "active",
        installments: {
          create: data.installments.map((i) => ({
            tenantId,
            installmentNo: i.installmentNo,
            amountPaise: i.amountPaise,
            dueDate: i.dueDate,
            status: "pending",
          })),
        },
      },
    });
    return plan.id;
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async list(filters: ListEmiPlansFilters): Promise<{ rows: EmiPlanWithStudent[]; total: number }> {
    const where: Prisma.EmiPlanWhereInput = {
      tenantId: filters.tenantId,
      ...(filters.orderId ? { orderId: filters.orderId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.studentUserId ? { order: { student: { userId: filters.studentUserId } } } : {}),
      ...(filters.leadOwnerId ? { order: { student: { convertedFromLead: { ownerId: filters.leadOwnerId } } } } : {}),
      ...(filters.search
        ? { order: { student: { user: { name: { contains: filters.search, mode: "insensitive" } } } } }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.emiPlan.findMany({
        where,
        include: PLAN_INCLUDE_STUDENT,
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.emiPlan.count({ where }),
    ]);

    return { rows, total };
  }

  /**
   * `restrictTo` narrows a single-plan read the same way `list()`'s `leadOwnerId` /
   * `studentUserId` narrow the list. Without it the detail route was wider than the list
   * route it is reached from: `emi.view` is seeded at scope `own` for counsellor AND for
   * student, so anyone holding a plan uuid could read a plan the list would never have
   * shown them — the customer's name, the order total and the whole installment schedule.
   * A row outside the restriction comes back null, which the service turns into a 404
   * (never a 403 — that would confirm the id exists).
   */
  findById(
    tenantId: string,
    id: string,
    restrictTo?: { leadOwnerId?: string; studentUserId?: string },
  ): Promise<EmiPlanWithInstallments | null> {
    const ownership =
      restrictTo?.leadOwnerId || restrictTo?.studentUserId
        ? {
            order: {
              student: {
                OR: [
                  ...(restrictTo.leadOwnerId ? [{ convertedFromLead: { ownerId: restrictTo.leadOwnerId } }] : []),
                  ...(restrictTo.studentUserId ? [{ userId: restrictTo.studentUserId }] : []),
                ],
              },
            },
          }
        : {};
    return this.prisma.client.emiPlan.findFirst({
      where: { id, tenantId, ...ownership },
      include: PLAN_INCLUDE_FULL,
    });
  }

  findInstallment(tenantId: string, planId: string, installmentId: string): Promise<EmiInstallmentRow | null> {
    return this.prisma.client.emiInstallment.findFirst({ where: { id: installmentId, emiPlanId: planId, tenantId } });
  }

  // ── Payment linkage (T24: mark-paid / server-initiated charge) ─────────────

  findCapturedPayment(
    tenantId: string,
    orderId: string,
    paymentId: string,
  ): Promise<{ id: string; amountPaise: number; status: PaymentStatus } | null> {
    return this.prisma.client.payment.findFirst({
      where: { id: paymentId, tenantId, orderId },
      select: { id: true, amountPaise: true, status: true },
    });
  }

  async createPendingPayment(data: {
    tenantId: string;
    orderId: string;
    providerOrderId: string;
    amountPaise: number;
  }): Promise<{ id: string }> {
    return this.prisma.client.payment.create({
      data: {
        tenantId: data.tenantId,
        orderId: data.orderId,
        provider: "razorpay",
        providerOrderId: data.providerOrderId,
        amountPaise: data.amountPaise,
        status: "created",
        isManual: false,
      },
      select: { id: true },
    });
  }

  async markInstallmentPaid(installmentId: string, paymentId: string, paidAt: Date): Promise<EmiInstallmentRow> {
    return this.prisma.client.emiInstallment.update({
      where: { id: installmentId },
      data: { status: "paid", paymentId, paidAt },
    });
  }

  async linkPendingPayment(installmentId: string, paymentId: string): Promise<EmiInstallmentRow> {
    return this.prisma.client.emiInstallment.update({ where: { id: installmentId }, data: { paymentId } });
  }

  // ── Dunning ───────────────────────────────────────────────────────────────

  async recordDunningAttempt(installmentId: string, status: EmiInstallmentStatus): Promise<EmiInstallmentRow> {
    return this.prisma.client.emiInstallment.update({
      where: { id: installmentId },
      data: { status, dunningAttempts: { increment: 1 }, lastDunningAt: new Date() },
    });
  }

  /** System-wide scan (no tenant filter — mirrors ReportSchedulesRepository.findDueCandidates precedent). */
  findOverdueCandidates(now: Date, maxDunningAttempts: number, limit: number): Promise<(EmiInstallmentRow & { emiPlan: EmiPlanWithStudent })[]> {
    return this.prisma.client.emiInstallment.findMany({
      where: {
        status: { in: ["pending", "overdue"] },
        dueDate: { lt: now },
        dunningAttempts: { lt: maxDunningAttempts },
      },
      include: { emiPlan: { include: PLAN_INCLUDE_STUDENT } },
      take: limit,
      orderBy: { dueDate: "asc" },
    });
  }
}
