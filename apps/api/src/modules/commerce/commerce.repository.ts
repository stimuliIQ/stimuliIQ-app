// apps/api/src/modules/commerce/commerce.repository.ts
//
// Prisma data access ONLY (docs/04-trd-architecture.md §2.1). CommerceService is the only
// caller. Every query is tenant-scoped. No business logic — raw data access + scope filters.
//
// SCOPE RESOLUTION (docs/03 §9 + prisma/seed.ts):
//   - orders/payments/invoices/refunds: Finance = all; Owner/Admin = all; BranchMgr = branch
//     (via student.user.userRoles or order's branch context, simplified to all for Finance/Admin
//     and branch-restricted view for BranchMgr — see resolveScope in service).
//   - coupons: Marketing = all; Finance view; Owner/Admin = all.
//
// IDEMPOTENCY:
//   - orders.idempotency_key (@@unique) → findByIdempotencyKey() for replay-safe create.
//   - payments.provider_payment_id (@@unique) → findPaymentByProviderPaymentId() for replay-safe
//     verify/webhook processing.
//
// ENROLLMENT HARD-RESTORE pattern (same as P1 enrollments module):
//   The @@unique([studentId, batchId]) constraint on enrollments means a student
//   soft-deleted from a batch must be RESTORED, not re-inserted. See findExistingEnrollment().

import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  OrderStatus,
  PaymentStatus,
  InvoiceStatus,
  RefundStatus,
  CouponType,
  CouponStatus,
  EnrollmentSource,
} from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

// ─────────────────────────────────────────────────────────────────────────────
// Row types (internal representations; service maps to DTO shapes)
// ─────────────────────────────────────────────────────────────────────────────

export interface OrderRow {
  id: string;
  tenantId: string;
  studentId: string;
  studentName: string;
  programId: string;
  programTitle: string;
  batchId: string;
  batchName: string;
  amountPaise: number;
  currency: string;
  discountPaise: number;
  couponId: string | null;
  couponCode: string | null;
  status: OrderStatus;
  idempotencyKey: string;
  emiPlan: unknown;
  notes: unknown;
  enrollmentId: string | null;
  enrollmentSource: EnrollmentSource | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  paymentCount: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface PaymentRow {
  id: string;
  tenantId: string;
  orderId: string;
  provider: string;
  providerPaymentId: string | null;
  providerOrderId: string | null;
  amountPaise: number;
  status: PaymentStatus;
  method: string | null;
  signatureVerified: boolean;
  isManual: boolean;
  paidAt: Date | null;
  // M-6: offline payment audit artifact (cheque/NEFT/receipt no.); null for online payments.
  reference: string | null;
  // Optional staff notes (manual payments only).
  notes: string | null;
  studentId: string;
  studentName: string;
  programId: string;
  programTitle: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface InvoiceRow {
  id: string;
  tenantId: string;
  orderId: string;
  number: string;
  storageKey: string | null;
  tax: unknown;
  status: InvoiceStatus;
  issuedAt: Date | null;
  studentId: string;
  studentName: string;
  programTitle: string;
  amountPaise: number;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface RefundRow {
  id: string;
  tenantId: string;
  paymentId: string;
  orderId: string;
  amountPaise: number;
  reason: string;
  status: RefundStatus;
  requestedById: string | null;
  requestedByName: string | null;
  approvedById: string | null;
  approvedByName: string | null;
  providerRefundId: string | null;
  processedAt: Date | null;
  studentId: string;
  studentName: string;
  programTitle: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CouponRow {
  id: string;
  tenantId: string;
  code: string;
  type: CouponType;
  value: number;
  maxUses: number | null;
  used: number;
  validFrom: Date | null;
  validTo: Date | null;
  programScope: unknown;
  status: CouponStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Repository
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class CommerceRepository {
  private readonly logger = new Logger(CommerceRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── ORDERS ──────────────────────────────────────────────────────────────

  async findOrderByIdempotencyKey(tenantId: string, key: string): Promise<OrderRow | null> {
    const row = await this.prisma.client.order.findFirst({
      where: { tenantId, idempotencyKey: key, deletedAt: null },
      include: ORDER_INCLUDE_WITH_BATCH,
    });
    return row ? toOrderRowWithBatch(row) : null;
  }

  /**
   * `restrictToBranchIds`, when supplied (BranchMgr scope — P2 M-3 fix, Phase-7 Wave 2
   * security hardening batch B, item 4), is pushed straight into the WHERE clause here —
   * the same `student.enrollments.some(...)` fragment `listOrders` already applies —
   * rather than the caller re-querying a paginated list and checking membership
   * (the prior `pageSize:1` re-query in CommerceService.getOrderById could false-404 an
   * in-scope order that wasn't the newest match). An empty `restrictToBranchIds` array
   * (BranchMgr with no branch assignment) matches ZERO rows, never "no filter".
   */
  async findOrderById(
    tenantId: string,
    id: string,
    includeDeleted = false,
    restrictToBranchIds?: string[],
  ): Promise<OrderRow | null> {
    const row = await this.prisma.client.order.findFirst({
      where: {
        id,
        tenantId,
        deletedAt: includeDeleted ? undefined : null,
        ...(restrictToBranchIds
          ? {
              student: {
                enrollments: {
                  some: {
                    batch: { branchId: { in: restrictToBranchIds } },
                    deletedAt: null,
                  },
                },
              },
            }
          : {}),
      },
      include: ORDER_INCLUDE_WITH_BATCH,
    });
    return row ? toOrderRowWithBatch(row) : null;
  }

  async listOrders(filters: {
    tenantId: string;
    status?: OrderStatus;
    studentId?: string;
    programId?: string;
    search?: string;
    from?: Date;
    to?: Date;
    restrictToBranchIds?: string[];
    page: number;
    pageSize: number;
  }): Promise<{ rows: OrderRow[]; total: number }> {
    const where: Prisma.OrderWhereInput = {
      tenantId: filters.tenantId,
      deletedAt: null,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.studentId ? { studentId: filters.studentId } : {}),
      ...(filters.programId ? { programId: filters.programId } : {}),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
      ...(filters.restrictToBranchIds
        ? {
            student: {
              enrollments: {
                some: {
                  batch: { branchId: { in: filters.restrictToBranchIds } },
                  deletedAt: null,
                },
              },
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.order.findMany({
        where,
        include: ORDER_INCLUDE_WITH_BATCH,
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.order.count({ where }),
    ]);

    return { rows: rows.map(toOrderRowWithBatch), total };
  }

  async createOrder(data: {
    tenantId: string;
    studentId: string;
    programId: string;
    amountPaise: number;
    currency: string;
    discountPaise: number;
    couponId: string | null;
    idempotencyKey: string;
    emiPlan: unknown;
    notes: string | null;
  }): Promise<{ id: string }> {
    const row = await this.prisma.client.order.create({
      data: {
        tenantId: data.tenantId,
        studentId: data.studentId,
        programId: data.programId,
        amountPaise: data.amountPaise,
        currency: data.currency,
        discountPaise: data.discountPaise,
        couponId: data.couponId,
        idempotencyKey: data.idempotencyKey,
        emiPlan: data.emiPlan as Prisma.InputJsonValue | undefined,
        notes: data.notes ? (JSON.parse(data.notes) as Prisma.InputJsonValue) : undefined,
        status: "created",
      },
    });
    return { id: row.id };
  }

  async updateOrderStatus(id: string, status: OrderStatus): Promise<void> {
    await this.prisma.client.order.update({ where: { id }, data: { status } });
  }

  async findProgramById(tenantId: string, id: string): Promise<{ id: string; title: string; pricePaise: number; currency: string; status: string } | null> {
    return this.prisma.client.program.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, title: true, pricePaise: true, currency: true, status: true },
    });
  }

  async findBatchById(
    tenantId: string,
    id: string,
  ): Promise<{ id: string; name: string; programId: string; capacity: number; status: string; branchId: string } | null> {
    return this.prisma.client.batch.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, name: true, programId: true, capacity: true, status: true, branchId: true },
    });
  }

  /**
   * Batch id → name for hydrating OPEN orders' batchName (the batch is only in
   * notes JSON until payment creates the enrollment). `deletedAt: undefined`
   * (present key) opts out of the soft-delete filter — an order pointing at a
   * since-archived batch should still display its name.
   */
  async findBatchNamesByIds(tenantId: string, ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.client.batch.findMany({
      where: { tenantId, id: { in: ids }, deletedAt: undefined },
      select: { id: true, name: true },
    });
    return new Map(rows.map((b) => [b.id, b.name]));
  }

  async countBatchEnrollments(batchId: string): Promise<number> {
    return this.prisma.client.enrollment.count({
      where: { batchId, status: { in: ["active", "completed"] }, deletedAt: null },
    });
  }

  async findStudentById(
    tenantId: string,
    id: string,
  ): Promise<{ id: string; userId: string } | null> {
    return this.prisma.client.studentProfile.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, userId: true },
    });
  }

  // ─── PAYMENTS ────────────────────────────────────────────────────────────

  async findPaymentByProviderPaymentId(providerPaymentId: string): Promise<PaymentRow | null> {
    const row = await this.prisma.client.payment.findFirst({
      where: { providerPaymentId, deletedAt: null },
      include: PAYMENT_INCLUDE,
    });
    return row ? toPaymentRow(row) : null;
  }

  async findPaymentById(tenantId: string, id: string): Promise<PaymentRow | null> {
    const row = await this.prisma.client.payment.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: PAYMENT_INCLUDE,
    });
    return row ? toPaymentRow(row) : null;
  }

  async findPaymentByProviderOrderId(providerOrderId: string): Promise<PaymentRow | null> {
    const row = await this.prisma.client.payment.findFirst({
      where: { providerOrderId, deletedAt: null },
      include: PAYMENT_INCLUDE,
    });
    return row ? toPaymentRow(row) : null;
  }

  async listPayments(filters: {
    tenantId: string;
    orderId?: string;
    studentId?: string;
    status?: PaymentStatus;
    isManual?: boolean;
    from?: Date;
    to?: Date;
    restrictToBranchIds?: string[];
    page: number;
    pageSize: number;
  }): Promise<{ rows: PaymentRow[]; total: number }> {
    const where: Prisma.PaymentWhereInput = {
      tenantId: filters.tenantId,
      deletedAt: null,
      ...(filters.orderId ? { orderId: filters.orderId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.isManual !== undefined ? { isManual: filters.isManual } : {}),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
      ...(filters.studentId
        ? { order: { studentId: filters.studentId } }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.payment.findMany({
        where,
        include: PAYMENT_INCLUDE,
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.payment.count({ where }),
    ]);

    return { rows: rows.map(toPaymentRow), total };
  }

  async createPayment(data: {
    tenantId: string;
    orderId: string;
    provider: string;
    providerOrderId: string | null;
    amountPaise: number;
    isManual: boolean;
    method?: string;
    paidAt?: Date;
    // M-6: offline payment audit artifact (cheque/NEFT/receipt no.)
    reference?: string | null;
    notes?: string | null;
  }): Promise<{ id: string }> {
    const row = await this.prisma.client.payment.create({
      data: {
        tenantId: data.tenantId,
        orderId: data.orderId,
        provider: data.provider,
        providerOrderId: data.providerOrderId,
        amountPaise: data.amountPaise,
        isManual: data.isManual,
        method: data.method ?? null,
        paidAt: data.paidAt ?? null,
        status: "created",
        signatureVerified: false,
        reference: data.reference ?? null,
        notes: data.notes ?? null,
      },
    });
    return { id: row.id };
  }

  async updatePaymentCapture(
    id: string,
    data: {
      providerPaymentId: string;
      status: PaymentStatus;
      signatureVerified: boolean;
      paidAt: Date;
      method?: string;
    },
  ): Promise<void> {
    await this.prisma.client.payment.update({
      where: { id },
      data: {
        providerPaymentId: data.providerPaymentId,
        status: data.status,
        signatureVerified: data.signatureVerified,
        paidAt: data.paidAt,
        ...(data.method ? { method: data.method } : {}),
      },
    });
  }

  async updatePaymentStatus(id: string, status: PaymentStatus): Promise<void> {
    await this.prisma.client.payment.update({ where: { id }, data: { status } });
  }

  /**
   * Sum of GROSS captured payment amounts for a date range (ledger reconciliation).
   * Includes payments that were captured AND those later refunded — a refund flips
   * the payment status "captured" → "refunded" but does NOT reduce the originally
   * captured amount (refunds are tracked/subtracted separately via sumProcessedRefunds).
   * Counting only status="captured" here would double-count a refund: it would drop
   * out of the captured gross AND be subtracted as a refund, moving net by 2× the
   * refund. Net settled = gross captured − processed refunds (docs/03 §20).
   */
  async sumCapturedPayments(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<{ totalPaise: number; count: number }> {
    const result = await this.prisma.client.payment.aggregate({
      where: {
        tenantId,
        status: { in: ["captured", "refunded"] },
        deletedAt: null,
        paidAt: { gte: from, lte: to },
      },
      _sum: { amountPaise: true },
      _count: { id: true },
    });
    return {
      totalPaise: result._sum.amountPaise ?? 0,
      count: result._count.id,
    };
  }

  /** Sum of processed refund amounts for a date range. */
  async sumProcessedRefunds(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<{ totalPaise: number; count: number }> {
    const result = await this.prisma.client.refund.aggregate({
      where: {
        tenantId,
        status: "processed",
        deletedAt: null,
        processedAt: { gte: from, lte: to },
      },
      _sum: { amountPaise: true },
      _count: { id: true },
    });
    return {
      totalPaise: result._sum.amountPaise ?? 0,
      count: result._count.id,
    };
  }

  /** Sum of paid order amounts for a date range. */
  async sumPaidOrders(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<number> {
    const result = await this.prisma.client.order.aggregate({
      where: {
        tenantId,
        status: "paid",
        deletedAt: null,
        createdAt: { gte: from, lte: to },
      },
      _sum: { amountPaise: true },
    });
    return result._sum.amountPaise ?? 0;
  }

  // ─── INVOICES ────────────────────────────────────────────────────────────

  async findInvoiceById(tenantId: string, id: string): Promise<InvoiceRow | null> {
    const row = await this.prisma.client.invoice.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: INVOICE_INCLUDE,
    });
    return row ? toInvoiceRow(row) : null;
  }

  async findInvoiceByOrderId(orderId: string): Promise<{ id: string } | null> {
    return this.prisma.client.invoice.findFirst({
      where: { orderId, deletedAt: null },
      select: { id: true },
    });
  }

  async listInvoices(filters: {
    tenantId: string;
    orderId?: string;
    studentId?: string;
    status?: InvoiceStatus;
    search?: string;
    from?: Date;
    to?: Date;
    page: number;
    pageSize: number;
  }): Promise<{ rows: InvoiceRow[]; total: number }> {
    const where: Prisma.InvoiceWhereInput = {
      tenantId: filters.tenantId,
      deletedAt: null,
      ...(filters.orderId ? { orderId: filters.orderId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
      ...(filters.studentId
        ? { order: { studentId: filters.studentId } }
        : {}),
      ...(filters.search
        ? {
            OR: [
              { number: { contains: filters.search, mode: "insensitive" } },
              { order: { student: { user: { name: { contains: filters.search, mode: "insensitive" } } } } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.invoice.findMany({
        where,
        include: INVOICE_INCLUDE,
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.invoice.count({ where }),
    ]);

    return { rows: rows.map(toInvoiceRow), total };
  }

  /**
   * Generate the next sequential invoice number for a tenant, atomically.
   *
   * APPROACH: pg_advisory_xact_lock(hashtext(tenantId)) — transaction-scoped,
   * auto-released on commit/rollback — serialises invoice creation per tenant
   * without requiring a separate counter table or a migration.
   *
   * Steps (all inside the caller's $transaction):
   *   1. Acquire a transaction-scoped advisory lock keyed on the tenantId string.
   *      Concurrent invoice creates for the same tenant block here until the
   *      first transaction commits/rolls back and releases the lock.
   *   2. Run a plain (non-FOR-UPDATE) SELECT MAX(number) to find the highest
   *      sequence suffix for this tenant+year.  The advisory lock guarantees no
   *      other transaction can be between step 1 and the subsequent INSERT at the
   *      same time, so MAX() is safe and monotonic.
   *   3. Format as INV-YYYY-NNNN and return.
   *
   * The UNIQUE constraint on invoices.number remains as the final safety net for
   * any race that somehow slips through (e.g. cross-tenant hash collisions — very
   * unlikely but the constraint catches it).
   *
   * No migration needed — pg_advisory_xact_lock is a built-in PG function.
   * Money: no money involved here; sequence numbers only.
   */
  async generateInvoiceNumber(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<string> {
    const year = new Date().getFullYear().toString();
    const prefix = `INV-${year}-`;

    // Step 1: Acquire a per-tenant transaction-scoped advisory lock.
    // hashtext() maps the tenantId string to a stable int4 key PG uses for the lock.
    // The lock is automatically released when the surrounding $transaction commits or
    // rolls back — no manual release needed.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}))`;

    // Step 2: Plain aggregate — no FOR UPDATE (which PG forbids on aggregates).
    // The advisory lock above already serialises concurrent callers, so MAX() is safe.
    const result = await tx.$queryRaw<Array<{ max_seq: string | null }>>`
      SELECT MAX(number) AS max_seq
      FROM invoices
      WHERE tenant_id = ${tenantId}::uuid
        AND number LIKE ${`INV-${year}-%`}
        AND deleted_at IS NULL
    `;

    let nextSeq = 1;
    if (result[0]?.max_seq) {
      const parts = result[0].max_seq.split("-");
      const lastPart = parts[parts.length - 1];
      if (lastPart) {
        const parsed = parseInt(lastPart, 10);
        if (!isNaN(parsed)) {
          nextSeq = parsed + 1;
        }
      }
    }

    return `${prefix}${String(nextSeq).padStart(4, "0")}`;
  }

  async createInvoice(
    tx: Prisma.TransactionClient,
    data: {
      tenantId: string;
      orderId: string;
      number: string;
      status: InvoiceStatus;
      storageKey?: string | null;
      tax?: unknown;
      issuedAt?: Date | null;
    },
  ): Promise<{ id: string }> {
    const row = await tx.invoice.create({
      data: {
        tenantId: data.tenantId,
        orderId: data.orderId,
        number: data.number,
        status: data.status,
        storageKey: data.storageKey ?? null,
        tax: data.tax ? (data.tax as Prisma.InputJsonValue) : undefined,
        issuedAt: data.issuedAt ?? null,
      },
    });
    return { id: row.id };
  }

  async updateInvoiceStatus(
    id: string,
    data: { status: InvoiceStatus; storageKey?: string | null; issuedAt?: Date | null; tax?: unknown },
  ): Promise<void> {
    await this.prisma.client.invoice.update({
      where: { id },
      data: {
        status: data.status,
        ...(data.storageKey !== undefined ? { storageKey: data.storageKey } : {}),
        ...(data.issuedAt !== undefined ? { issuedAt: data.issuedAt } : {}),
        // T27 (B8 fix, docs/plans/phase-9-completion.md): GST breakdown computed at
        // issuance time by InvoiceGenPort — see invoice-gen.seam.ts.
        ...(data.tax !== undefined ? { tax: data.tax as Prisma.InputJsonValue } : {}),
      },
    });
  }

  // ─── REFUNDS ─────────────────────────────────────────────────────────────

  async findRefundById(tenantId: string, id: string): Promise<RefundRow | null> {
    const row = await this.prisma.client.refund.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: REFUND_INCLUDE,
    });
    return row ? toRefundRow(row) : null;
  }

  async listRefunds(filters: {
    tenantId: string;
    paymentId?: string;
    orderId?: string;
    studentId?: string;
    status?: RefundStatus;
    from?: Date;
    to?: Date;
    page: number;
    pageSize: number;
  }): Promise<{ rows: RefundRow[]; total: number }> {
    const where: Prisma.RefundWhereInput = {
      tenantId: filters.tenantId,
      deletedAt: null,
      ...(filters.paymentId ? { paymentId: filters.paymentId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
      ...(filters.orderId ? { payment: { orderId: filters.orderId } } : {}),
      ...(filters.studentId ? { payment: { order: { studentId: filters.studentId } } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.refund.findMany({
        where,
        include: REFUND_INCLUDE,
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.refund.count({ where }),
    ]);

    return { rows: rows.map(toRefundRow), total };
  }

  async createRefund(data: {
    tenantId: string;
    paymentId: string;
    amountPaise: number;
    reason: string;
    requestedById: string;
    status: RefundStatus;
  }): Promise<{ id: string }> {
    const row = await this.prisma.client.refund.create({
      data: {
        tenantId: data.tenantId,
        paymentId: data.paymentId,
        amountPaise: data.amountPaise,
        reason: data.reason,
        requestedById: data.requestedById,
        status: data.status,
      },
    });
    return { id: row.id };
  }

  async updateRefundApprove(
    id: string,
    approvedById: string,
    data: { status: RefundStatus; providerRefundId?: string; processedAt?: Date | null },
  ): Promise<void> {
    await this.prisma.client.refund.update({
      where: { id },
      data: {
        approvedById,
        status: data.status,
        ...(data.providerRefundId ? { providerRefundId: data.providerRefundId } : {}),
        ...(data.processedAt !== undefined ? { processedAt: data.processedAt } : {}),
      },
    });
  }

  async updateRefundStatus(id: string, status: RefundStatus): Promise<void> {
    await this.prisma.client.refund.update({ where: { id }, data: { status } });
  }

  // ─── COUPONS ─────────────────────────────────────────────────────────────

  async findCouponById(tenantId: string, id: string, includeDeleted = false): Promise<CouponRow | null> {
    const row = await this.prisma.client.coupon.findFirst({
      where: { id, tenantId, deletedAt: includeDeleted ? undefined : null },
    });
    return row ? toCouponRow(row) : null;
  }

  async findCouponByCode(tenantId: string, code: string): Promise<CouponRow | null> {
    const row = await this.prisma.client.coupon.findFirst({
      where: { tenantId, code, deletedAt: null },
    });
    return row ? toCouponRow(row) : null;
  }

  async listCoupons(filters: {
    tenantId: string;
    status?: CouponStatus;
    type?: CouponType;
    search?: string;
    page: number;
    pageSize: number;
  }): Promise<{ rows: CouponRow[]; total: number }> {
    const where: Prisma.CouponWhereInput = {
      tenantId: filters.tenantId,
      deletedAt: null,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.search ? { code: { contains: filters.search, mode: "insensitive" } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.coupon.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.coupon.count({ where }),
    ]);

    return { rows: rows.map(toCouponRow), total };
  }

  async createCoupon(
    tenantId: string,
    data: {
      code: string;
      type: CouponType;
      value: number;
      maxUses: number | null;
      validFrom: Date | null;
      validTo: Date | null;
      programScope: string[] | null;
      status: CouponStatus;
    },
  ): Promise<{ id: string }> {
    const row = await this.prisma.client.coupon.create({
      data: {
        tenantId,
        code: data.code,
        type: data.type,
        value: data.value,
        maxUses: data.maxUses,
        validFrom: data.validFrom,
        validTo: data.validTo,
        programScope: data.programScope
          ? (data.programScope as Prisma.InputJsonValue)
          : undefined,
        status: data.status,
        used: 0,
      },
    });
    return { id: row.id };
  }

  async updateCoupon(
    id: string,
    patch: Partial<{
      maxUses: number | null;
      validFrom: Date | null;
      validTo: Date | null;
      programScope: string[] | null;
      status: CouponStatus;
    }>,
  ): Promise<void> {
    const { programScope, ...rest } = patch;
    await this.prisma.client.coupon.update({
      where: { id },
      data: {
        ...rest,
        ...(programScope !== undefined
          ? {
              programScope: programScope
                ? (programScope as Prisma.InputJsonValue)
                : Prisma.JsonNull,
            }
          : {}),
      },
    });
  }

  async softDeleteCoupon(id: string): Promise<void> {
    await this.prisma.client.coupon.delete({ where: { id } }); // soft-delete extension
  }

  /**
   * Atomically increment the coupon `used` counter with a max_uses check.
   * Uses $executeRawUnsafe to do an atomic conditional increment at the DB level —
   * avoiding a read-modify-write race in application code.
   *
   * Returns the number of rows updated (0 = max_uses already reached, 1 = success).
   */
  /**
   * Release one coupon redemption (order-cancel path — the `used` count was
   * incremented at order CREATE time, so cancelling the unpaid order must give
   * the redemption back). Floor-guarded so a double-cancel can never go negative.
   */
  async decrementCouponUsed(couponId: string): Promise<void> {
    await this.prisma.client.coupon.updateMany({
      where: { id: couponId, deletedAt: null, used: { gt: 0 } },
      data: { used: { decrement: 1 } },
    });
  }

  /**
   * Cancel an UNPAID order (order-cancel path): soft-delete the order row plus
   * any not-captured payment rows from initiated-but-abandoned checkouts, in one
   * transaction. Soft delete (deletedAt) is the platform's cancellation idiom —
   * audited by the Prisma extensions and restorable — and the OrderStatus enum
   * deliberately gains no "cancelled" value (forward-only migrations).
   */
  async softDeleteUnpaidOrder(tenantId: string, orderId: string): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      await tx.payment.updateMany({
        where: { tenantId, orderId, status: { not: "captured" }, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      await tx.order.updateMany({
        where: { tenantId, id: orderId, status: "created", deletedAt: null },
        data: { deletedAt: new Date() },
      });
    });
  }

  async incrementCouponUsed(couponId: string, maxUses: number | null): Promise<number> {
    if (maxUses === null) {
      // Unlimited usage — simple increment
      const result = await this.prisma.client.coupon.updateMany({
        where: { id: couponId, deletedAt: null },
        data: { used: { increment: 1 } },
      });
      return result.count;
    }

    // Conditional increment: only if used < max_uses
    const result = await this.prisma.client.$executeRaw`
      UPDATE coupons
      SET used = used + 1, updated_at = NOW()
      WHERE id = ${couponId}::uuid
        AND deleted_at IS NULL
        AND (max_uses IS NULL OR used < max_uses)
    `;
    return result;
  }

  // ─── ENROLLMENTS (for order→enrollment atomic) ───────────────────────────

  /**
   * Find an existing enrollment for (studentId, batchId) including soft-deleted rows.
   * Required for the hard-restore pattern: if a soft-deleted enrollment exists for this
   * combination, we RESTORE it rather than INSERT (due to @@unique([studentId, batchId])).
   */
  async findExistingEnrollment(
    studentId: string,
    batchId: string,
  ): Promise<{ id: string; deletedAt: Date | null; orderId: string | null } | null> {
    // Must read through soft-delete to detect the restore case
    return this.prisma.client.$queryRaw<
      Array<{ id: string; deleted_at: Date | null; order_id: string | null }>
    >`
      SELECT id, deleted_at, order_id
      FROM enrollments
      WHERE student_id = ${studentId}::uuid
        AND batch_id = ${batchId}::uuid
      LIMIT 1
    `.then((rows) => {
      if (rows.length === 0) return null;
      const row = rows[0]!;
      return {
        id: row.id,
        deletedAt: row.deleted_at,
        orderId: row.order_id,
      };
    });
  }

  /**
   * Create a new enrollment linked to an order. Used in the order→enrollment $transaction.
   */
  async createEnrollment(
    tx: Prisma.TransactionClient,
    data: {
      tenantId: string;
      studentId: string;
      batchId: string;
      programId: string;
      orderId: string;
      source: EnrollmentSource;
    },
  ): Promise<{ id: string }> {
    const row = await tx.enrollment.create({
      data: {
        tenantId: data.tenantId,
        studentId: data.studentId,
        batchId: data.batchId,
        programId: data.programId,
        orderId: data.orderId,
        source: data.source,
        status: "active",
      },
    });
    return { id: row.id };
  }

  /**
   * Hard-restore a soft-deleted enrollment: set deletedAt=null, status=active,
   * link the order_id + source. Used when re-enrolling a previously-withdrawn student
   * from the same order path (avoids unique-constraint violation).
   */
  async restoreEnrollment(
    tx: Prisma.TransactionClient,
    enrollmentId: string,
    orderId: string,
    source: EnrollmentSource,
  ): Promise<void> {
    await tx.enrollment.update({
      where: { id: enrollmentId },
      data: {
        deletedAt: null,
        status: "active",
        orderId,
        source,
      },
    });
  }

  /** Verify that a specific enrollment has the given orderId (prevents duplicate enrollment). */
  async findEnrollmentByOrderId(orderId: string): Promise<{ id: string } | null> {
    return this.prisma.client.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM enrollments
      WHERE order_id = ${orderId}::uuid
        AND deleted_at IS NULL
      LIMIT 1
    `.then((rows) => (rows.length > 0 ? { id: rows[0]!.id } : null));
  }

  /** Helper: list caller's branch ids from user_roles (for branch scope). */
  async listCallerBranchIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.client.userRole.findMany({
      where: { userId, branchId: { not: null }, deletedAt: null },
      select: { branchId: true },
    });
    return rows.map((r) => r.branchId).filter((id): id is string => id !== null);
  }

  /**
   * $transaction wrapper — commerce service uses this for atomic order→payment→enrollment.
   * Delegates to prisma.$transaction; exposed here so the service layer does not import prisma.
   */
  async transaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    // Prisma extended client doesn't directly expose $transaction at the type level
    // in a way that satisfies the extended client type. We access the underlying
    // transaction via the extended client's $transaction method.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma extended client $transaction typing limitation
    return (this.prisma.client as any).$transaction(fn);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Prisma include shapes
// ─────────────────────────────────────────────────────────────────────────────

const ORDER_INCLUDE_WITH_BATCH = {
  student: { include: { user: { select: { name: true } } } },
  program: { select: { title: true } },
  coupon: { select: { code: true } },
  payments: { where: { deletedAt: null }, select: { id: true } },
  invoice: { select: { id: true, number: true } },
  enrollments: {
    where: { deletedAt: null },
    select: { id: true, source: true, batchId: true, batch: { select: { name: true } } },
    take: 1,
  },
} satisfies Prisma.OrderInclude;

type OrderWithBatchIncludes = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE_WITH_BATCH }>;

export function toOrderRowWithBatch(row: OrderWithBatchIncludes): OrderRow {
  const enrollment = row.enrollments?.[0] ?? null;
  // Before payment there is no enrollment yet — the batch chosen at order-create
  // time lives in notes JSON ({ batchId }); fall back to it so an OPEN order still
  // reports which batch it will enroll into. The service hydrates batchName for
  // these rows via findBatchNamesByIds (name isn't stored in notes).
  const notesBatchId =
    typeof (row.notes as Record<string, unknown> | null)?.["batchId"] === "string"
      ? ((row.notes as Record<string, unknown>)["batchId"] as string)
      : "";
  return {
    id: row.id,
    tenantId: row.tenantId,
    studentId: row.studentId,
    studentName: row.student.user.name,
    programId: row.programId,
    programTitle: row.program.title,
    batchId: enrollment?.batchId ?? notesBatchId,
    batchName: enrollment?.batch?.name ?? "",
    amountPaise: row.amountPaise,
    currency: row.currency,
    discountPaise: row.discountPaise,
    couponId: row.couponId,
    couponCode: row.coupon?.code ?? null,
    status: row.status,
    idempotencyKey: row.idempotencyKey,
    emiPlan: row.emiPlan,
    notes: row.notes,
    enrollmentId: enrollment?.id ?? null,
    enrollmentSource: enrollment?.source ?? null,
    invoiceId: row.invoice?.id ?? null,
    invoiceNumber: row.invoice?.number ?? null,
    paymentCount: row.payments?.length ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

const PAYMENT_INCLUDE = {
  order: {
    include: {
      student: { include: { user: { select: { name: true } } } },
      program: { select: { title: true } },
    },
  },
} satisfies Prisma.PaymentInclude;

type PaymentWithIncludes = Prisma.PaymentGetPayload<{ include: typeof PAYMENT_INCLUDE }>;

function toPaymentRow(row: PaymentWithIncludes): PaymentRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    orderId: row.orderId,
    provider: row.provider,
    providerPaymentId: row.providerPaymentId,
    providerOrderId: row.providerOrderId,
    amountPaise: row.amountPaise,
    status: row.status,
    method: row.method,
    signatureVerified: row.signatureVerified,
    isManual: row.isManual,
    paidAt: row.paidAt,
    reference: row.reference,
    notes: row.notes,
    studentId: row.order.studentId,
    studentName: row.order.student.user.name,
    programId: row.order.programId,
    programTitle: row.order.program.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

const INVOICE_INCLUDE = {
  order: {
    include: {
      student: { include: { user: { select: { name: true } } } },
      program: { select: { title: true } },
    },
  },
} satisfies Prisma.InvoiceInclude;

type InvoiceWithIncludes = Prisma.InvoiceGetPayload<{ include: typeof INVOICE_INCLUDE }>;

function toInvoiceRow(row: InvoiceWithIncludes): InvoiceRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    orderId: row.orderId,
    number: row.number,
    storageKey: row.storageKey,
    tax: row.tax,
    status: row.status,
    issuedAt: row.issuedAt,
    studentId: row.order.studentId,
    studentName: row.order.student.user.name,
    programTitle: row.order.program.title,
    amountPaise: row.order.amountPaise,
    currency: row.order.currency,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

const REFUND_INCLUDE = {
  payment: {
    include: {
      order: {
        include: {
          student: { include: { user: { select: { name: true } } } },
          program: { select: { title: true } },
        },
      },
    },
  },
  requestedBy: { select: { name: true } },
  approvedBy: { select: { name: true } },
} satisfies Prisma.RefundInclude;

type RefundWithIncludes = Prisma.RefundGetPayload<{ include: typeof REFUND_INCLUDE }>;

function toRefundRow(row: RefundWithIncludes): RefundRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    paymentId: row.paymentId,
    orderId: row.payment.orderId,
    amountPaise: row.amountPaise,
    reason: row.reason,
    status: row.status,
    requestedById: row.requestedById,
    requestedByName: row.requestedBy?.name ?? null,
    approvedById: row.approvedById,
    approvedByName: row.approvedBy?.name ?? null,
    providerRefundId: row.providerRefundId,
    processedAt: row.processedAt,
    studentId: row.payment.order.studentId,
    studentName: row.payment.order.student.user.name,
    programTitle: row.payment.order.program.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

function toCouponRow(row: {
  id: string;
  tenantId: string;
  code: string;
  type: CouponType;
  value: number;
  maxUses: number | null;
  used: number;
  validFrom: Date | null;
  validTo: Date | null;
  programScope: unknown;
  status: CouponStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}): CouponRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    code: row.code,
    type: row.type,
    value: row.value,
    maxUses: row.maxUses,
    used: row.used,
    validFrom: row.validFrom,
    validTo: row.validTo,
    programScope: row.programScope,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}
