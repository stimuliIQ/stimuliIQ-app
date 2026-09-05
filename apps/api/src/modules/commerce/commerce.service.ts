// apps/api/src/modules/commerce/commerce.service.ts
//
// Business logic for Commerce (docs/04-trd-architecture.md §2.1).
// Owns: transactions ($transaction), idempotency, domain event dispatch,
// scope resolution, provider calls (via PAYMENT_PROVIDER token), audit.
//
// Layering rules (CLAUDE.md §3.3):
//   - Never imports Prisma directly (only via CommerceRepository).
//   - Never calls vendor SDKs directly (only via PaymentProvider interface).
//   - Never puts HTTP concepts here (no Request/Response imports).
//
// IDEMPOTENCY:
//   - Orders: orders.idempotency_key (@@unique). Replay returns cached order.
//   - Payment capture: payments.provider_payment_id (@@unique). Replay is no-op.
//   - Webhook: same provider_payment_id idempotency. Unknown events silently ignored.
//   - Refunds: provider-level idempotencyKey derived from refund row id.
//
// ORDER→ENROLLMENT $TRANSACTION (docs/plans/phase-2.md §"Success criteria 2"):
//   A single $transaction atomically:
//     1. Sets payment.status=captured, signature_verified, paid_at, provider_payment_id.
//     2. Sets order.status=paid.
//     3. Creates/hard-restores the enrollment (order_id, source=order).
//     4. Creates the invoice stub row (sequential number, status=draft).
//   Post-transaction: enqueues (or synchronously runs) invoice generation.
//
// MONEY: ALL computations in INTEGER PAISE. No floats (CLAUDE.md §3.6).
//   pct coupon: discount = Math.floor(pricePaise * value / 100)
//   flat coupon: discount = value (already paise)
//   Net amount: pricePaise - discountPaise (min 0).

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type {
  OrderDetail,
  OrderSummary,
  PaymentDetail,
  PaymentSummary,
  InvoiceDetail,
  InvoiceSummary,
  InvoiceDownloadResponse,
  ReceiptDownloadResponse,
  RefundDetail,
  RefundSummary,
  CouponDetail,
  CouponSummary,
  ValidateCouponResponse,
  LedgerReconciliation,
  CreateRazorpayOrderResponse,
  CreatePaymentLinkResponse,
  SendPaymentLinksRequest,
  SendPaymentLinksResponse,
} from "@repo/types";
import { signPayLinkToken } from "./pay-link.util";
import { PAYMENT_PROVIDER, type PaymentProvider } from "./providers/payment/payment-provider.interface";
import { CommerceRepository } from "./commerce.repository";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext } from "../auth/lib/scope-context";
import {
  INVOICE_GEN_PORT,
  WEBHOOK_PROCESSOR_PORT,
  type InvoiceGenPort,
  type WebhookProcessorPort,
  type WebhookEventPayload,
} from "./invoice-gen.seam";
import { RECEIPT_GEN_PORT, type ReceiptGenPort } from "./receipt-gen.seam";
import { STORAGE_PROVIDER, type StorageProvider } from "../storage/providers/storage/storage-provider.interface";
import { buildStorageKey } from "../storage/providers/storage/s3-storage.provider";
import { validateEnv } from "../../config/env";
import { NotificationsService } from "../notifications/notifications.service";
import { StudentsRepository } from "../students/students.repository";
import { LmsAccountProvisioningService } from "../students/lms-account-provisioning.service";
import { MAIL_PROVIDER, type MailProvider } from "../notifications/providers/mail/mail-provider.interface";
import { renderBrandedEmail, escapeEmailHtml } from "../notifications/dispatch/email-layout";
import { EmailTemplatesService } from "../notifications/email-templates/email-templates.service";
import { computeReprice, formatPaise } from "./order-price.helper";
import type {
  CreateOrderRequest,
  ListOrdersQuery,
  ListPaymentsQuery,
  VerifyPaymentRequest,
  ManualPaymentRequest,
  ListInvoicesQuery,
  RequestRefundRequest,
  ApproveRefundRequest,
  RejectRefundRequest,
  ListRefundsQuery,
  CreateCouponRequest,
  UpdateCouponRequest,
  ListCouponsQuery,
  ValidateCouponRequest,
} from "./dto";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute coupon discount in INTEGER PAISE — NO floats.
 *   pct:  floor(pricePaise * pctValue / 100)
 *   flat: coupon.value (already paise)
 * Returns 0 for unknown types (safe default).
 */
function computeDiscountPaise(
  type: "pct" | "flat",
  value: number,
  pricePaise: number,
): number {
  if (type === "pct") {
    return Math.floor((pricePaise * value) / 100);
  }
  if (type === "flat") {
    return Math.min(value, pricePaise); // flat can't exceed the price
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class CommerceService {
  private readonly logger = new Logger(CommerceService.name);

  constructor(
    private readonly repository: CommerceRepository,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
    @Inject(INVOICE_GEN_PORT) private readonly invoiceGen: InvoiceGenPort,
    @Inject(WEBHOOK_PROCESSOR_PORT) private readonly webhookProcessor: WebhookProcessorPort,
    @Inject(RECEIPT_GEN_PORT) private readonly receiptGen: ReceiptGenPort,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly notifSvc: NotificationsService,
    private readonly emailTemplates: EmailTemplatesService,
    private readonly studentsRepository: StudentsRepository,
    private readonly lmsProvisioning: LmsAccountProvisioningService,
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
  ) {}

  /**
   * Best-effort LMS provisioning after a payment-completed enrollment. The webhook
   * path (webhook-processor.adapter) already provisions; the two synchronous capture
   * paths (verifyPayment / recordManualPayment) create the enrollment inline and MUST
   * do the same — a manual/offline payment never gets a Razorpay webhook, so without
   * this the paying student stayed `invited` with no password and no credentials
   * email (2026-07-26 prod: paid + enrolled, never provisioned). Idempotent
   * (only ever acts on a never-provisioned account) and never fails the payment op.
   *
   * QUIET variant: no standalone welcome email — the returned credentials are
   * embedded in the combined receipt email (one message, everything inside).
   * Null when the account already had a login (nothing credential-wise to send).
   */
  private async provisionLmsBestEffort(
    tenantId: string,
    studentProfileId: string,
  ): Promise<{ email: string; name: string; tempPassword: string } | null> {
    try {
      return await this.lmsProvisioning.provisionQuiet(tenantId, studentProfileId);
    } catch (err) {
      this.logger.error(`[Commerce] LMS provisioning failed for student ${studentProfileId}: ${String(err)}`);
      return null;
    }
  }

  // ─── SCOPE RESOLUTION ──────────────────────────────────────────────────

  /**
   * Resolves data scope for Commerce list endpoints.
   * Finance/Owner/Admin = all; BranchMgr = branch; others = fail-closed.
   */
  private async resolveListRestriction(
    actorId: string,
  ): Promise<{ restrictToBranchIds?: string[] }> {
    const scope = requireScopeContext();
    switch (scope.scope) {
      case "all":
        return {};
      case "branch": {
        const branchIds = await this.repository.listCallerBranchIds(actorId);
        return { restrictToBranchIds: branchIds };
      }
      case "assigned":
      case "own":
      default:
        throw new ForbiddenException({
          code: "commerce.scope_unresolvable",
          title: "Scope not supported for commerce",
          detail: `Scope "${scope.scope}" is not supported for Commerce modules. Finance/Owner/Admin required.`,
        });
    }
  }

  // ─── ORDERS ──────────────────────────────────────────────────────────────

  async createOrder(
    tenantId: string,
    actorId: string,
    idempotencyKey: string,
    body: CreateOrderRequest,
  ): Promise<OrderDetail> {
    // Idempotency check FIRST — replay with same key returns cached order
    const existing = await this.repository.findOrderByIdempotencyKey(tenantId, idempotencyKey);
    if (existing) {
      this.logger.log(`[Commerce] Order create replay, idempotency_key=${idempotencyKey}`);
      return toOrderDetail(existing);
    }

    // Validate program
    const program = await this.repository.findProgramById(tenantId, body.programId);
    if (!program) {
      throw new NotFoundException({ code: "commerce.program_not_found", title: "Program not found" });
    }
    if (program.status !== "published") {
      throw new BadRequestException({ code: "commerce.program_not_published", title: "Program is not published" });
    }

    // Validate batch
    const batch = await this.repository.findBatchById(tenantId, body.batchId);
    if (!batch) {
      throw new NotFoundException({ code: "commerce.batch_not_found", title: "Batch not found" });
    }
    if (batch.programId !== body.programId) {
      throw new BadRequestException({
        code: "commerce.batch_program_mismatch",
        title: "Batch does not belong to this program",
      });
    }
    if (batch.status !== "planned" && batch.status !== "active") {
      throw new BadRequestException({
        code: "commerce.batch_not_accepting",
        title: "Batch is not accepting enrollments",
      });
    }

    // Capacity check
    const enrolledCount = await this.repository.countBatchEnrollments(body.batchId);
    if (enrolledCount >= batch.capacity) {
      throw new ConflictException({ code: "commerce.batch_full", title: "Batch is at capacity" });
    }

    // Validate student
    const student = await this.repository.findStudentById(tenantId, body.studentId);
    if (!student) {
      throw new NotFoundException({ code: "commerce.student_not_found", title: "Student not found" });
    }

    // ── Duplicate-order guard ────────────────────────────────────────────────
    //
    // `idempotencyKey` above only collapses a REPLAY of one request (same key). It does
    // nothing about a second deliberate click, which mints a fresh key — so "Add program"
    // pressed twice produced two identical open orders for the same student/program/batch
    // (observed in production 2026-08-06, 30 seconds apart). Left alone that is a
    // double-charge waiting to happen: both orders are payable, but the SECOND payment's
    // enrollment insert would then violate the `enrollments_active_student_batch_key`
    // partial-unique index — i.e. money taken with no enrollment to show for it.
    //
    // Checked AFTER student/program/batch validation (so a genuinely bad request still
    // gets its specific 404/400) and BEFORE the coupon `used` increment (so a rejected
    // duplicate never burns a redemption).
    const openOrders = await this.repository.findOpenOrdersForProgram(
      tenantId,
      body.studentId,
      body.programId,
    );
    if (openOrders.some((o) => o.batchId === body.batchId)) {
      throw new ConflictException({
        code: "commerce.duplicate_open_order",
        title: "This student already has an open order for this program and batch",
        detail:
          "An unpaid order for this exact program and batch is already awaiting payment. Record its payment, or cancel it before creating another.",
      });
    }

    // Scoped to the SAME batch, not the whole program: an open order on batch A while
    // staff line up a move to batch B is a real workflow, and blocking it would be a
    // product decision beyond fixing the duplicate.
    //
    // Already enrolled? Checked on the ENROLLMENT, not on "is there a paid order" —
    // re-enrolling into a batch whose enrollment was soft-deleted is supported and
    // hard-restores the old row (`enrollments_active_student_batch_key`). Guarding on the
    // paid order would break that restore path.
    if (await this.repository.hasActiveEnrollment(body.studentId, body.batchId)) {
      throw new ConflictException({
        code: "commerce.already_enrolled_in_batch",
        title: "This student is already enrolled in this batch",
        detail: "They already have a live enrollment in this batch. Pick a different batch.",
      });
    }

    // Coupon validation and discount computation — all in INTEGER PAISE
    let discountPaise = 0;
    let couponId: string | null = null;

    if (body.couponCode) {
      const coupon = await this.repository.findCouponByCode(tenantId, body.couponCode);
      if (!coupon) {
        throw new BadRequestException({ code: "commerce.coupon_not_found", title: "Coupon not found" });
      }
      const validation = validateCoupon(coupon, body.programId);
      if (!validation.valid) {
        // Exhausted coupon → 409 Conflict per spec (commerce.coupon_exhausted).
        // All other invalidity reasons (expired, not-yet-valid, inactive, wrong program) → 400.
        if (validation.reason === "max_uses_reached") {
          throw new ConflictException({
            code: "commerce.coupon_exhausted",
            title: "Coupon has reached its maximum use limit",
            detail: "This coupon has been fully redeemed and is no longer available.",
          });
        }
        throw new BadRequestException({
          code: "commerce.coupon_invalid",
          title: "Coupon is not valid",
          detail: validation.reason ?? "Coupon cannot be applied",
        });
      }
      discountPaise = computeDiscountPaise(coupon.type as "pct" | "flat", coupon.value, program.pricePaise);
      couponId = coupon.id;
    }

    // Net amount — NEVER trust client (CLAUDE.md §3.6 + phase-2.md)
    const amountPaise = Math.max(0, program.pricePaise - discountPaise);

    // Coupon max_uses atomic increment (if coupon applied)
    if (couponId) {
      const coupon = await this.repository.findCouponByCode(tenantId, body.couponCode!);
      if (!coupon) {
        throw new ConflictException({ code: "commerce.coupon_race", title: "Coupon no longer available" });
      }
      const updated = await this.repository.incrementCouponUsed(couponId, coupon.maxUses ?? null);
      if (updated === 0) {
        throw new ConflictException({
          code: "commerce.coupon_exhausted",
          title: "Coupon has reached its maximum use limit",
        });
      }
    }

    // Create order — store batchId in notes JSON so the verify/manual payment flows
    // can look up the target batch without adding a new column to the orders table.
    // The batchId is validated above (belongs to program, has capacity, active status).
    const notesJson: Record<string, unknown> = { batchId: body.batchId };
    if (body.notes) notesJson["text"] = body.notes;

    const order = await this.repository.createOrder({
      tenantId,
      studentId: body.studentId,
      programId: body.programId,
      amountPaise,
      currency: program.currency,
      discountPaise,
      couponId,
      idempotencyKey,
      emiPlan: body.emiPlan ?? null,
      notes: JSON.stringify(notesJson),
    });

    const row = await this.repository.findOrderById(tenantId, order.id);
    if (!row) throw new NotFoundException({ code: "commerce.order_not_found", title: "Order not found after creation" });

    // Augment with batch info (batchId is on enrollment, but for a new order we carry it separately)
    // For the response, enrich with batchId/batchName from the order context
    const enrichedRow: OrderRow = { ...row, batchId: body.batchId, batchName: batch.name };
    return toOrderDetail(enrichedRow);
  }

  async listOrders(
    tenantId: string,
    actorId: string,
    query: ListOrdersQuery,
  ): Promise<PaginatedResult<OrderSummary>> {
    const restriction = await this.resolveListRestriction(actorId);
    const { rows, total } = await this.repository.listOrders({
      tenantId,
      status: query.status,
      studentId: query.studentId,
      programId: query.programId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      restrictToBranchIds: restriction.restrictToBranchIds,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
    });

    await this.hydrateOpenOrderBatchNames(tenantId, rows);
    return new PaginatedResult(rows.map(toOrderSummary), {
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
      total,
      hasMore: (query.page ?? 1) * (query.pageSize ?? 20) < total,
    });
  }

  /**
   * P2 M-3 fix (Phase-7 Wave 2 security hardening batch B, item 4): the branch-scope
   * restriction is now pushed directly into `findOrderById`'s own WHERE clause (via
   * `restrictToBranchIds`), rather than re-querying a `pageSize:1` list and checking
   * `rows.some(...)` for membership — the prior approach could false-404 an in-scope
   * order that wasn't the single newest match returned by the list query.
   */
  async getOrderById(tenantId: string, actorId: string, id: string): Promise<OrderDetail> {
    const restriction = await this.resolveListRestriction(actorId);
    const row = await this.repository.findOrderById(tenantId, id, false, restriction.restrictToBranchIds);
    if (!row) throw new NotFoundException({ code: "commerce.order_not_found", title: "Order not found" });

    await this.hydrateOpenOrderBatchNames(tenantId, [row]);
    return toOrderDetail(row);
  }

  /**
   * DELETE /commerce/orders/:id — cancel an UNPAID (status=created) order:
   * un-assign a program that was opened by mistake or that the student walked
   * away from. Soft-deletes the order + its never-captured payment rows and
   * releases the coupon redemption taken at create time. A paid order can NOT
   * be cancelled here — that is the refund flow's job.
   */
  /**
   * PATCH /crm/orders/:id/price — sell a programme for less than its list price.
   *
   * Recorded as a DISCOUNT: `amountPaise` becomes what is charged, `discountPaise` the gap
   * to the list price, and `discountReason` why. See order-price.helper.ts for why the
   * amount is not simply overwritten.
   *
   * TWO GUARDS, BOTH LOAD-BEARING:
   *
   *   1. `status === "created"`. A paid order's price is settled; reducing it afterwards is a
   *      REFUND, which exists and leaves its own trail.
   *   2. NO LIVE PAYMENTS. The status check alone is not enough — an order stays `created`
   *      while a payment is authorised but not captured, and repricing under one leaves the
   *      ledger disagreeing with the order it belongs to. The repository's updateMany
   *      re-checks the status in its WHERE, so two staff repricing at once cannot both win.
   *
   * OVERSIGHT, NOT APPROVAL. Discounting is the one commerce action with no second signature,
   * so every change notifies every active super_admin — except the person who made it, since
   * telling somebody what they just did is noise, and noise is how a feed stops being read.
   * The notification is best-effort: it must never roll back a reprice that already committed,
   * because a half-applied discount is worse than an unwatched one. The AUDIT row is the
   * durable record and it is written by the Prisma audit extension regardless.
   */
  async updateOrderPrice(
    tenantId: string,
    actorId: string,
    id: string,
    body: { amountPaise: number; reason: string },
  ): Promise<OrderDetail> {
    const restriction = await this.resolveListRestriction(actorId);
    const order = await this.repository.findOrderById(tenantId, id, false, restriction.restrictToBranchIds);
    if (!order) throw new NotFoundException({ code: "commerce.order_not_found", title: "Order not found" });

    if (order.status !== "created") {
      throw new UnprocessableEntityException({
        code: "commerce.order_not_repriceable",
        title: "Only an unpaid order can be repriced",
        detail: `This order is "${order.status}". Reducing what a student has already paid is a refund, not a price change.`,
      });
    }

    const livePayments = await this.repository.countLivePaymentsForOrder(tenantId, id);
    if (livePayments > 0) {
      throw new UnprocessableEntityException({
        code: "commerce.order_has_payments",
        title: "This order already has a payment against it",
        detail:
          "Changing the price under a recorded payment would break the ledger, the invoice and reconciliation. Refund the payment first, or raise a new order.",
      });
    }

    const outcome = computeReprice(
      { amountPaise: order.amountPaise, discountPaise: order.discountPaise },
      body.amountPaise,
    );
    if (!outcome.ok) {
      if (outcome.reason.code === "above_list_price") {
        throw new UnprocessableEntityException({
          code: "commerce.price_above_list",
          title: "The new price is above the list price",
          detail: `This order's list price is ${formatPaise(outcome.reason.listPricePaise)}. A price change can only reduce it.`,
        });
      }
      throw new UnprocessableEntityException({
        code: "commerce.price_unchanged",
        title: "That is already the price",
        detail: "Nothing was changed, so no discount, audit entry or notification was recorded.",
      });
    }

    const updated = await this.repository.updateOrderPrice(tenantId, id, {
      amountPaise: outcome.next.amountPaise,
      discountPaise: outcome.next.discountPaise,
      reason: body.reason,
    });
    if (updated === 0) {
      // Lost a race: the order stopped being `created` between the read above and this write.
      throw new UnprocessableEntityException({
        code: "commerce.order_not_repriceable",
        title: "This order changed while you were editing it",
        detail: "Reload the order and try again.",
      });
    }

    await this.notifyOrderRepriced(tenantId, actorId, {
      orderId: id,
      studentName: order.studentName,
      programTitle: order.programTitle,
      fromPaise: order.amountPaise,
      toPaise: outcome.next.amountPaise,
      reason: body.reason,
    });

    return this.getOrderById(tenantId, actorId, id);
  }

  /** Best-effort super-admin fan-out for a reprice. Never throws into the caller. */
  private async notifyOrderRepriced(
    tenantId: string,
    actorId: string,
    args: {
      orderId: string;
      studentName: string;
      programTitle: string;
      fromPaise: number;
      toPaise: number;
      reason: string;
    },
  ): Promise<void> {
    try {
      const superAdmins = await this.repository.listActiveSuperAdmins(tenantId);
      // Excluding the actor is the point: a super admin repricing an order does not need to
      // be told they did. It also means a single-super-admin tenant notifies nobody, which is
      // correct — the audit row still exists, and there is no second person to inform.
      const recipients = superAdmins.filter((u) => u.id !== actorId);
      if (recipients.length === 0) return;

      const payload = {
        orderId: args.orderId,
        studentName: args.studentName,
        programTitle: args.programTitle,
        fromAmount: formatPaise(args.fromPaise),
        toAmount: formatPaise(args.toPaise),
        reason: args.reason,
      };
      for (const recipient of recipients) {
        await this.notifSvc.notify(recipient.id, tenantId, "order_price_changed", payload, {});
      }
    } catch (err) {
      this.logger.warn(`[Commerce] order_price_changed notification failed (non-fatal): ${String(err)}`);
    }
  }

  async cancelOrder(tenantId: string, actorId: string, id: string): Promise<void> {
    const restriction = await this.resolveListRestriction(actorId);
    const order = await this.repository.findOrderById(tenantId, id, false, restriction.restrictToBranchIds);
    if (!order) throw new NotFoundException({ code: "commerce.order_not_found", title: "Order not found" });
    if (order.status !== "created") {
      throw new UnprocessableEntityException({
        code: "commerce.order_not_cancellable",
        title: "Only unpaid orders can be cancelled",
        detail: `This order is "${order.status}". A paid order goes through the refund flow instead.`,
      });
    }

    await this.repository.softDeleteUnpaidOrder(tenantId, id);
    if (order.couponId) {
      await this.repository.decrementCouponUsed(order.couponId);
    }
  }

  /**
   * Fill batchName on OPEN orders in place. Until payment creates the enrollment,
   * an order's batch exists only as notes.batchId (toOrderRowWithBatch surfaces it
   * as row.batchId) — the batch NAME needs this one extra lookup. Paid orders
   * resolve their batch through the enrollment include and are left untouched.
   */
  private async hydrateOpenOrderBatchNames(tenantId: string, rows: OrderRow[]): Promise<void> {
    const missing = rows.filter((r) => r.batchId && !r.batchName);
    if (missing.length === 0) return;
    const names = await this.repository.findBatchNamesByIds(tenantId, [...new Set(missing.map((r) => r.batchId))]);
    for (const row of missing) {
      row.batchName = names.get(row.batchId) ?? "";
    }
  }

  // ─── PAYMENTS: Razorpay Flow ──────────────────────────────────────────────

  /**
   * POST /commerce/orders/:id/pay — Create Razorpay order and a payment row.
   * Returns { razorpayOrderId, keyId (PUBLIC only), amountPaise, currency, orderId }.
   */
  async initiateRazorpayCheckout(
    tenantId: string,
    actorId: string,
    orderId: string,
  ): Promise<CreateRazorpayOrderResponse> {
    const order = await this.repository.findOrderById(tenantId, orderId);
    if (!order) throw new NotFoundException({ code: "commerce.order_not_found", title: "Order not found" });

    if (order.status !== "created") {
      if (order.status === "paid") {
        throw new ConflictException({ code: "commerce.order_already_paid", title: "Order is already paid" });
      }
      throw new BadRequestException({
        code: "commerce.order_invalid_state",
        title: "Order cannot be checked out in its current state",
      });
    }

    // Create Razorpay order via provider
    const result = await this.paymentProvider.createOrder({
      amountPaise: order.amountPaise,
      currency: order.currency,
      receipt: orderId.slice(0, 40), // max 40 chars per Razorpay
      notes: { order_id: orderId, tenant_id: tenantId },
    });

    // Create payment row (status=created, providerOrderId set)
    await this.repository.createPayment({
      tenantId,
      orderId,
      provider: "razorpay",
      providerOrderId: result.providerOrderId,
      amountPaise: order.amountPaise,
      isManual: false,
    });

    // Return PUBLIC key only — never the secret
    const env = validateEnv();
    return {
      razorpayOrderId: result.providerOrderId,
      keyId: env.RAZORPAY_KEY_ID ?? "",
      amountPaise: order.amountPaise,
      currency: order.currency,
      orderId,
    };
  }

  /**
   * POST /commerce/payments/verify — Verify Razorpay signature + atomic order→enrollment.
   *
   * IDEMPOTENCY: If provider_payment_id already exists in payments table (captured),
   * return the existing payment row — do NOT double-capture or double-enroll.
   *
   * ATOMICITY: The $transaction atomically:
   *   1. Sets payment.status=captured + signature_verified=true + paid_at + provider_payment_id.
   *   2. Sets order.status=paid.
   *   3. Creates/restores enrollment (source=order) — hard-restore if soft-deleted row exists.
   *   4. Creates invoice row (sequential number, status=draft).
   * Post-transaction: invoice generation runs (sync in P2, BullMQ seam for later).
   */
  async verifyPayment(
    tenantId: string,
    actorId: string,
    body: VerifyPaymentRequest,
  ): Promise<PaymentDetail> {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;

    // Idempotency: check if already captured
    const existing = await this.repository.findPaymentByProviderPaymentId(razorpay_payment_id);
    if (existing) {
      if (existing.status === "captured") {
        this.logger.log(`[Commerce] verify replay, provider_payment_id=${razorpay_payment_id}`);
        return toPaymentDetail(existing);
      }
    }

    // Find the payment row by provider_order_id
    const payment = await this.repository.findPaymentByProviderOrderId(razorpay_order_id);
    if (!payment) {
      throw new NotFoundException({
        code: "commerce.payment_not_found",
        title: "Payment record not found for this Razorpay order",
      });
    }
    if (payment.tenantId !== tenantId) {
      throw new NotFoundException({ code: "commerce.payment_not_found", title: "Payment not found" });
    }

    // Verify signature — FAIL CLOSED on mismatch (400, mark failed)
    const verified = this.paymentProvider.verifyPaymentSignature({
      providerOrderId: razorpay_order_id,
      providerPaymentId: razorpay_payment_id,
      signature: razorpay_signature,
    });

    if (!verified) {
      // Mark payment as failed (idempotent — may already be failed)
      await this.repository.updatePaymentStatus(payment.id, "failed");
      throw new UnprocessableEntityException({
        code: "payments.signature_invalid",
        title: "Payment signature verification failed",
        detail: "The Razorpay payment signature is invalid. Possible tampering detected.",
      });
    }

    // Fetch order to get batch info for enrollment
    const order = await this.repository.findOrderById(tenantId, payment.orderId);
    if (!order) {
      throw new NotFoundException({ code: "commerce.order_not_found", title: "Order not found" });
    }

    // Find the batch from the enrollment (if exists) or from order data
    // We need batchId for enrollment. The order row carries batchId via enrollment or
    // we need another approach. For verify flow, the batch is tracked from order creation.
    // We query the order's batch from existing enrollment or use the first batch of the program.
    // Since batchId was tracked at order-create time, we find it from any existing enrollment
    // or from order notes. We need to store batchId on the order.
    // NOTE: The schema doesn't have batchId on orders directly. The batchId is validated
    // at order-create time and carried via the enrollment. For verify, we look at the
    // order's existing enrollment (if any) or we need to find it from the order context.
    // Decision: store batchId in order notes JSON at create time (workaround for missing column).
    const notesJson = order.notes as Record<string, unknown> | null;
    const batchId = (notesJson?.batchId as string | undefined) ?? order.batchId;

    if (!batchId) {
      throw new BadRequestException({
        code: "commerce.order_missing_batch",
        title: "Order is missing batch context, cannot create enrollment",
      });
    }

    const batch = await this.repository.findBatchById(tenantId, batchId);
    if (!batch) {
      throw new NotFoundException({ code: "commerce.batch_not_found", title: "Batch not found" });
    }

    // Atomic $transaction: capture payment + mark order paid + create/restore enrollment + create invoice
    let invoiceId: string | null = null;

    await this.repository.transaction(async (tx) => {
      // 1. Capture payment
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          providerPaymentId: razorpay_payment_id,
          status: "captured",
          signatureVerified: true,
          paidAt: new Date(),
        },
      });

      // 2. Mark order as paid
      await tx.order.update({ where: { id: payment.orderId }, data: { status: "paid" } });

      // 3. Create or hard-restore enrollment
      await this.createOrRestoreEnrollmentInTx(tx, {
        tenantId,
        studentId: order.studentId,
        batchId,
        programId: order.programId,
        orderId: payment.orderId,
        source: "order",
      });

      // 4. Create invoice row (idempotent: check first)
      const existingInvoice = await tx.invoice.findFirst({
        where: { orderId: payment.orderId },
        select: { id: true },
      });
      if (!existingInvoice) {
        const invoiceNumber = await this.repository.generateInvoiceNumber(tx, tenantId);
        const inv = await this.repository.createInvoice(tx, {
          tenantId,
          orderId: payment.orderId,
          number: invoiceNumber,
          status: "draft",
          issuedAt: null,
        });
        invoiceId = inv.id;
      } else {
        invoiceId = existingInvoice.id;
      }
    });

    // Post-transaction: trigger invoice generation (sync stub in P2, BullMQ seam)
    if (invoiceId) {
      try {
        await this.invoiceGen.enqueue({ invoiceId, orderId: payment.orderId, tenantId });
      } catch (err) {
        // Invoice gen failure is non-fatal — the order is paid and enrollment created.
        // The invoice can be regenerated later. Log + continue.
        this.logger.error(`[Commerce] Invoice gen failed for invoice ${invoiceId}: ${String(err)}`);
      }
    }

    // Phase-9 Completion T31 / R3: wire the (previously orphaned) payment-receipt
    // notifier at its real event site. Best-effort — a notification failure must never
    // fail the payment-verify response (the payment/enrollment are already committed).
    // Enrollment just materialized above — issue the LMS login right away instead
    // of waiting on the webhook. Quiet: the credentials ride inside the receipt
    // email (one message: receipt + username + temp password + sign-in button).
    const creds = await this.provisionLmsBestEffort(tenantId, order.studentId);

    await this.sendPaymentReceiptBestEffort(
      tenantId,
      order.studentId,
      {
        orderId: payment.orderId,
        amountPaise: payment.amountPaise,
        currency: order.currency,
        invoiceId,
      },
      creds,
    );

    const updated = await this.repository.findPaymentByProviderPaymentId(razorpay_payment_id);
    if (!updated) throw new NotFoundException({ code: "commerce.payment_not_found", title: "Payment not found after capture" });
    return toPaymentDetail(updated);
  }

  /**
   * Create or hard-restore an enrollment within a $transaction.
   *
   * The @@unique([studentId, batchId]) constraint on enrollments means:
   *   - If no existing row → create new.
   *   - If soft-deleted row exists → hard-restore (set deletedAt=null, link orderId).
   *   - If active row already exists with this orderId → no-op (already enrolled from this order).
   *   - If active row exists with a DIFFERENT orderId → throw ConflictException.
   */
  private async createOrRestoreEnrollmentInTx(
    tx: Parameters<Parameters<CommerceRepository["transaction"]>[0]>[0],
    data: {
      tenantId: string;
      studentId: string;
      batchId: string;
      programId: string;
      orderId: string;
      source: "order" | "conversion" | "manual";
    },
  ): Promise<void> {
    // An enrolled student is no longer an "admissions" record: promote the coarse
    // profile status lead → active in the same transaction (converted-lead students
    // start as "lead" and otherwise stay in the directory's Admissions bucket even
    // after paying — mirrors enrollments.repository.enrollOrRestore).
    const promoteProfile = () =>
      tx.studentProfile.updateMany({
        where: { id: data.studentId, tenantId: data.tenantId, status: "lead" },
        data: { status: "active" },
      });

    // Look for existing enrollment including soft-deleted
    const existing = await this.repository.findExistingEnrollment(data.studentId, data.batchId);

    if (!existing) {
      // New enrollment
      await this.repository.createEnrollment(tx, data);
      await promoteProfile();
      return;
    }

    if (existing.deletedAt !== null) {
      // Soft-deleted — hard-restore
      await this.repository.restoreEnrollment(tx, existing.id, data.orderId, data.source);
      await promoteProfile();
      return;
    }

    // Active enrollment exists
    if (existing.orderId === data.orderId) {
      // Same order — idempotent no-op (already enrolled from this order)
      return;
    }

    // Active enrollment linked to a DIFFERENT order — this is a real conflict
    throw new ConflictException({
      code: "commerce.already_enrolled",
      title: "Student is already enrolled in this batch",
      detail: "The student has an active enrollment in this batch from a different order.",
    });
  }

  /**
   * POST /commerce/payments/webhook — process Razorpay server-to-server webhook.
   *
   * SECURITY: Raw body + X-Razorpay-Signature HMAC verification happens in the CONTROLLER
   * before this method is called. This method receives the ALREADY-VERIFIED payload.
   * (The controller calls paymentProvider.verifyWebhookSignature first — if it fails,
   * the controller throws 401 and never calls this method.)
   *
   * IDEMPOTENCY: The webhook processor (SyncWebhookProcessor) is idempotent by
   * provider_payment_id unique constraint — duplicate events are no-ops.
   */
  async enqueueWebhookEvent(payload: Record<string, unknown>): Promise<void> {
    await this.webhookProcessor.process(payload as WebhookEventPayload);
  }

  /**
   * POST /commerce/payments/manual — Finance: record offline payment.
   *
   * Creates payment row with is_manual=true, captured status, and triggers
   * the same order→enrollment atomic transaction.
   */
  async recordManualPayment(
    tenantId: string,
    actorId: string,
    idempotencyKey: string,
    body: ManualPaymentRequest,
  ): Promise<PaymentDetail> {
    // Order must exist and be in 'created' state
    const order = await this.repository.findOrderById(tenantId, body.orderId);
    if (!order) throw new NotFoundException({ code: "commerce.order_not_found", title: "Order not found" });
    if (order.tenantId !== tenantId) throw new NotFoundException({ code: "commerce.order_not_found", title: "Order not found" });

    if (order.status === "paid") {
      // Already paid — return existing payment
      const payments = await this.repository.listPayments({
        tenantId,
        orderId: body.orderId,
        status: "captured",
        page: 1,
        pageSize: 1,
      });
      if (payments.rows.length > 0) {
        return toPaymentDetail(payments.rows[0]!);
      }
    }
    if (order.status !== "created") {
      throw new BadRequestException({
        code: "commerce.order_invalid_state",
        title: "Order is not in a payable state",
      });
    }

    // Validate amount: manual payment should cover the order amount
    if (body.amountPaise !== order.amountPaise) {
      throw new BadRequestException({
        code: "commerce.manual_payment_amount_mismatch",
        title: "Manual payment amount does not match order amount",
        detail: `Order amount is ${order.amountPaise} paise, but ${body.amountPaise} paise was provided.`,
      });
    }

    // Create manual payment row
    // M-6: persist reference (cheque/NEFT/receipt no.) and notes — key audit artifact for
    // offline money-in events. ManualPaymentRequestSchema.reference is required but was
    // previously discarded here; now stored in payments.reference (nullable column, forward
    // migration 20260702000000_payment_reference).
    const paymentResult = await this.repository.createPayment({
      tenantId,
      orderId: body.orderId,
      provider: "manual",
      providerOrderId: null,
      amountPaise: body.amountPaise,
      isManual: true,
      method: body.method,
      paidAt: body.paidAt ? new Date(body.paidAt) : new Date(),
      reference: body.reference,
      notes: body.notes ?? null,
    });

    // Get batch from order's notes or enrollment
    const notesJson = order.notes as Record<string, unknown> | null;
    const batchId = (notesJson?.batchId as string | undefined) ?? order.batchId;
    if (!batchId) {
      throw new BadRequestException({ code: "commerce.order_missing_batch", title: "Order has no batch context" });
    }

    // Atomic: mark payment captured + order paid + enrollment + invoice
    let invoiceId: string | null = null;
    const manualProviderPaymentId = `manual_${paymentResult.id}`;

    await this.repository.transaction(async (tx) => {
      // Capture manual payment
      await tx.payment.update({
        where: { id: paymentResult.id },
        data: {
          providerPaymentId: manualProviderPaymentId,
          status: "captured",
          signatureVerified: false, // manual — no signature
          paidAt: body.paidAt ? new Date(body.paidAt) : new Date(),
        },
      });

      // Mark order paid
      await tx.order.update({ where: { id: body.orderId }, data: { status: "paid" } });

      // Create/restore enrollment
      await this.createOrRestoreEnrollmentInTx(tx, {
        tenantId,
        studentId: order.studentId,
        batchId,
        programId: order.programId,
        orderId: body.orderId,
        source: "order",
      });

      // Invoice
      const existingInvoice = await tx.invoice.findFirst({
        where: { orderId: body.orderId },
        select: { id: true },
      });
      if (!existingInvoice) {
        const invoiceNumber = await this.repository.generateInvoiceNumber(tx, tenantId);
        const inv = await this.repository.createInvoice(tx, {
          tenantId,
          orderId: body.orderId,
          number: invoiceNumber,
          status: "draft",
        });
        invoiceId = inv.id;
      } else {
        invoiceId = existingInvoice.id;
      }
    });

    if (invoiceId) {
      try {
        await this.invoiceGen.enqueue({ invoiceId, orderId: body.orderId, tenantId });
      } catch (err) {
        this.logger.error(`[Commerce] Invoice gen failed for manual payment invoice ${invoiceId}: ${String(err)}`);
      }
    }

    // Same receipt email the Razorpay verify path sends — an offline (cash/NEFT)
    // payer deserves the same invoice confirmation (lifecycle-redesign).
    // Manual/offline payments never get a Razorpay webhook — this is the ONLY place
    // their LMS login can be issued (see provisionLmsBestEffort). Quiet: credentials
    // ride inside the combined receipt email.
    const creds = await this.provisionLmsBestEffort(tenantId, order.studentId);

    await this.sendPaymentReceiptBestEffort(
      tenantId,
      order.studentId,
      {
        orderId: body.orderId,
        amountPaise: body.amountPaise,
        currency: order.currency,
        invoiceId,
      },
      creds,
    );

    const updated = await this.repository.findPaymentByProviderPaymentId(manualProviderPaymentId);
    if (!updated) throw new NotFoundException({ code: "commerce.payment_not_found", title: "Payment not found after creation" });
    return toPaymentDetail(updated);
  }

  /**
   * Best-effort payment-receipt notification (email/in-app) with the invoice
   * number resolved — shared by the Razorpay-verify, manual-payment and pay-link
   * capture paths. Never throws: the payment/enrollment are already committed and
   * a notification failure must not fail the request.
   *
   * FIRST payment (freshly provisioned LMS login, `creds` present): the student
   * gets ONE combined email — receipt + LMS username/temporary password + sign-in
   * button — instead of two separate messages. The fan-out notification still runs
   * for the in-app/SMS channels but with NO email address, so its email channel is
   * skipped (no duplicate receipt).
   */
  private async sendPaymentReceiptBestEffort(
    tenantId: string,
    studentId: string,
    args: { orderId: string; amountPaise: number; currency: string; invoiceId: string | null },
    creds?: { email: string; name: string; tempPassword: string } | null,
  ): Promise<void> {
    try {
      const student = await this.studentsRepository.findById(tenantId, studentId);
      if (!student) return;
      let invoiceNumber: string | undefined;
      if (args.invoiceId) {
        const invoice = await this.repository.findInvoiceById(tenantId, args.invoiceId);
        invoiceNumber = invoice?.number ?? undefined;
      }

      if (creds) {
        await this.sendCredentialsWelcomeEmail(tenantId, student.email, {
          studentName: student.name,
          username: creds.email,
          tempPassword: creds.tempPassword,
        });
      }

      await this.notifSvc.notifyPaymentReceipt(
        student.userId,
        tenantId,
        {
          orderId: args.orderId,
          amountPaise: args.amountPaise,
          currency: args.currency,
          studentName: student.name,
          invoiceNumber,
        },
        // NO PAYMENT-RECEIPT EMAIL, EVER — `toEmail` is unconditionally omitted.
        //
        // This used to send one whenever `creds` was null, i.e. to a student whose LMS
        // account already existed. In practice that is every repeat payment: a second
        // instalment, or a second programme. The owner's call is that paying should not
        // generate a receipt email at all; the enrolment welcome above is the only email a
        // payment produces, and it fires once, on the first payment, when there are actually
        // credentials to deliver.
        //
        // The fan-out itself is deliberately still called. The IN-APP notification is the
        // student's record of the payment inside the LMS and costs nothing, and SMS/WhatsApp
        // stay available for when DLT registration lands. Only the email channel is dropped,
        // which is what "no payment email" means.
        { toEmail: undefined, toPhone: student.phone ?? undefined },
      );
    } catch (err) {
      this.logger.warn(`[Commerce] notifyPaymentReceipt failed (non-fatal): ${String(err)}`);
    }
  }

  /**
   * The single first-payment email: welcome + LMS credentials + sign-in CTA.
   *
   * DELIBERATELY NOT A RECEIPT. It used to open with "We've received your payment of
   * ₹14,999.00" and list Order ID, Invoice number and Amount above the login details. The
   * money is left out entirely, on the owner's instruction: the first thing a student reads
   * after paying should welcome them and get them signed in, not restate what they were
   * just charged. The amount, order and invoice all still exist and are unchanged in the
   * CRM — this only stops repeating them here.
   *
   * CONSEQUENCE WORTH KNOWING: `invoices.view` is a STAFF permission and there is no
   * student-facing invoice screen in the LMS, so the invoice number in this email was the
   * only reference a student had to their GST invoice. If students should be able to fetch
   * their own, that needs an LMS surface, not a line in an email that is no longer about
   * money.
   *
   * The wording now comes from EmailTemplatesService, so CRM ▸ Settings ▸ Email templates
   * shows and edits the text this actually sends. The credentials table and the sign-in
   * button stay HERE and are passed in as fixed parts: an editor that can delete somebody's
   * password out of the one email containing it is not a feature.
   */
  private async sendCredentialsWelcomeEmail(
    tenantId: string,
    to: string,
    data: {
      studentName: string;
      username: string;
      tempPassword: string;
    },
  ): Promise<void> {
    const env = validateEnv();
    const { subject, html } = await this.emailTemplates.renderForSend(
      tenantId,
      "enrollment_welcome",
      { studentName: data.studentName },
      {
        details: [
          { label: "LMS username", value: escapeEmailHtml(data.username) },
          { label: "Temporary password", value: escapeEmailHtml(data.tempPassword) },
        ],
        button: { label: "Sign in to the LMS", url: `${env.LMS_APP_URL}/login` },
      },
    );

    await this.mail.send({
      to,
      subject,
      html,
      tags: [{ name: "category", value: "enrollment_welcome_credentials" }],
    });
  }

  /**
   * Mint a signed public payment link for an OPEN order (lifecycle-redesign:
   * "send the student a link to pay"). The token embeds (tenantId, orderId,
   * expiry) + HMAC — see pay-link.util.ts for the full authorization contract.
   * Scope/branch restriction mirrors getOrderById.
   */
  async mintPaymentLink(tenantId: string, actorId: string, orderId: string): Promise<CreatePaymentLinkResponse> {
    const restriction = await this.resolveListRestriction(actorId);
    const order = await this.repository.findOrderById(tenantId, orderId, false, restriction.restrictToBranchIds);
    if (!order) throw new NotFoundException({ code: "commerce.order_not_found", title: "Order not found" });
    if (order.status !== "created") {
      throw new UnprocessableEntityException({
        code: "commerce.order_not_payable",
        title: "Order is not payable",
        detail: `Only open orders can be paid via a link (current status: "${order.status}").`,
      });
    }

    const { token, expiresAt } = signPayLinkToken({ tenantId, orderId });
    const base = validateEnv().WEB_APP_URL.replace(/\/$/, "");
    return { url: `${base}/pay/${token}`, token, expiresAt: expiresAt.toISOString() };
  }

  /**
   * POST /commerce/orders/payment-links/send — EMAIL payment link(s) to the student
   * instead of relying on staff to copy-paste them. One order → a single-payment
   * email; several → ONE email listing every pending program with its own Pay
   * button plus the grand total, so the student can settle each individually from
   * the same message. Validation: every order must exist (scope-checked like
   * getOrder), be payable (status=created), and belong to the SAME student.
   */
  async sendPaymentLinks(
    tenantId: string,
    actorId: string,
    body: SendPaymentLinksRequest,
  ): Promise<SendPaymentLinksResponse> {
    const restriction = await this.resolveListRestriction(actorId);
    const orders: OrderRow[] = [];
    for (const id of [...new Set(body.orderIds)]) {
      const row = await this.repository.findOrderById(tenantId, id, false, restriction.restrictToBranchIds);
      if (!row) throw new NotFoundException({ code: "commerce.order_not_found", title: "Order not found" });
      if (row.status !== "created") {
        throw new UnprocessableEntityException({
          code: "commerce.order_not_payable",
          title: "Order is not payable",
          detail: `Order for "${row.programTitle}" is "${row.status}". Only open orders can be paid via a link.`,
        });
      }
      orders.push(row);
    }
    if (new Set(orders.map((o) => o.studentId)).size > 1) {
      throw new BadRequestException({
        code: "commerce.mixed_students",
        title: "All orders must belong to the same student",
      });
    }

    const student = await this.studentsRepository.findById(tenantId, orders[0]!.studentId);
    if (!student) throw new NotFoundException({ code: "students.not_found", title: "Student not found" });

    await this.hydrateOpenOrderBatchNames(tenantId, orders);
    const base = validateEnv().WEB_APP_URL.replace(/\/$/, "");
    const links = orders.map((order) => {
      const { token, expiresAt } = signPayLinkToken({ tenantId, orderId: order.id });
      return { order, url: `${base}/pay/${token}`, expiresAt };
    });
    const totalAmountPaise = orders.reduce((sum, o) => sum + o.amountPaise, 0);
    const fmt = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
    // Inline-styled anchor "button" — same look as the layout's primary CTA; the
    // shared layout supports one button, and a multi-order email needs one per program.
    const payButton = (url: string, label: string) =>
      `<a href="${url}" target="_blank" style="display:inline-block;padding:10px 22px;font-size:14px;font-weight:600;` +
      `color:#ffffff;text-decoration:none;border-radius:6px;background:#047857;">${label}</a>`;

    const single = links.length === 1;
    const html = renderBrandedEmail({
      title: single ? "Complete your payment" : "Complete your payments",
      greeting: `Hi ${escapeEmailHtml(student.name)},`,
      paragraphs: single
        ? [
            `Your enrollment for <strong>${escapeEmailHtml(links[0]!.order.programTitle)}</strong>` +
              `${links[0]!.order.batchName ? ` (${escapeEmailHtml(links[0]!.order.batchName)})` : ""} is one step away, ` +
              `complete the payment of <strong>${fmt(links[0]!.order.amountPaise)}</strong> below.`,
            `<div style="margin:4px 0 6px;">${payButton(links[0]!.url, `Pay ${fmt(links[0]!.order.amountPaise)} securely`)}</div>`,
          ]
        : [
            `You have ${links.length} program payments pending. Pay each one below, in any order.`,
            ...links.map(
              ({ order, url }) =>
                `<strong>${escapeEmailHtml(order.programTitle)}</strong>` +
                `${order.batchName ? ` · ${escapeEmailHtml(order.batchName)}` : ""}<br/>` +
                `<div style="margin:6px 0 10px;">${payButton(url, `Pay ${fmt(order.amountPaise)}`)}</div>`,
            ),
          ],
      details: single
        ? [
            { label: "Program", value: escapeEmailHtml(links[0]!.order.programTitle) },
            ...(links[0]!.order.batchName ? [{ label: "Batch", value: escapeEmailHtml(links[0]!.order.batchName) }] : []),
            { label: "Amount", value: fmt(links[0]!.order.amountPaise) },
          ]
        : [
            ...links.map(({ order }) => ({
              label: escapeEmailHtml(order.programTitle),
              value: fmt(order.amountPaise),
            })),
            { label: "Total", value: `<strong>${fmt(totalAmountPaise)}</strong>` },
          ],
      footnote:
        "Payments are processed securely by Razorpay. " +
        `Each link expires on ${links[0]!.expiresAt.toLocaleDateString("en-IN")}. Ask us for a fresh one anytime.`,
    });

    try {
      await this.mail.send({
        to: student.email,
        subject: single
          ? `Complete your payment · ${links[0]!.order.programTitle}`
          : `Complete your payments · ${links.length} programs pending (${fmt(totalAmountPaise)})`,
        html,
        tags: [{ name: "category", value: "payment_link" }],
      });
    } catch (err) {
      this.logger.error(`[Commerce] payment-link email failed for order(s) ${body.orderIds.join(", ")}: ${String(err)}`);
      throw new UnprocessableEntityException({
        code: "commerce.payment_link_email_failed",
        title: "Couldn't send the payment email",
        detail: "The mail provider rejected the send. The links are unaffected; try again or copy the link instead.",
      });
    }

    return { email: student.email, count: links.length, totalAmountPaise };
  }

  async listPayments(
    tenantId: string,
    actorId: string,
    query: ListPaymentsQuery,
  ): Promise<PaginatedResult<PaymentSummary>> {
    const restriction = await this.resolveListRestriction(actorId);
    const { rows, total } = await this.repository.listPayments({
      tenantId,
      orderId: query.orderId,
      studentId: query.studentId,
      status: query.status,
      isManual: query.isManual,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      restrictToBranchIds: restriction.restrictToBranchIds,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
    });

    return new PaginatedResult(rows.map(toPaymentSummary), {
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
      total,
      hasMore: (query.page ?? 1) * (query.pageSize ?? 20) < total,
    });
  }

  async getPaymentById(tenantId: string, actorId: string, id: string): Promise<PaymentDetail> {
    const row = await this.repository.findPaymentById(tenantId, id);
    if (!row) throw new NotFoundException({ code: "commerce.payment_not_found", title: "Payment not found" });
    return toPaymentDetail(row);
  }

  async getLedgerReconciliation(
    tenantId: string,
    from: string,
    to: string,
  ): Promise<LedgerReconciliation> {
    const fromDate = new Date(from);
    const toDate = new Date(to);

    const [captured, refunds, orderPaid] = await Promise.all([
      this.repository.sumCapturedPayments(tenantId, fromDate, toDate),
      this.repository.sumProcessedRefunds(tenantId, fromDate, toDate),
      this.repository.sumPaidOrders(tenantId, fromDate, toDate),
    ]);

    const netAmountPaise = captured.totalPaise - refunds.totalPaise;
    return {
      from,
      to,
      capturedAmountPaise: captured.totalPaise,
      processedRefundAmountPaise: refunds.totalPaise,
      netAmountPaise,
      orderPaidTotalPaise: orderPaid,
      reconcilesOk: netAmountPaise === orderPaid,
      captureCount: captured.count,
      refundCount: refunds.count,
    };
  }

  // ─── INVOICES ────────────────────────────────────────────────────────────

  async listInvoices(
    tenantId: string,
    actorId: string,
    query: ListInvoicesQuery,
  ): Promise<PaginatedResult<InvoiceSummary>> {
    // Finance/Owner/Admin only — resolveListRestriction enforces scope
    await this.resolveListRestriction(actorId);
    const { rows, total } = await this.repository.listInvoices({
      tenantId,
      orderId: query.orderId,
      studentId: query.studentId,
      status: query.status,
      search: query.search,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
    });

    return new PaginatedResult(rows.map(toInvoiceSummary), {
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
      total,
      hasMore: (query.page ?? 1) * (query.pageSize ?? 20) < total,
    });
  }

  async getInvoiceById(tenantId: string, actorId: string, id: string): Promise<InvoiceDetail> {
    await this.resolveListRestriction(actorId);
    const row = await this.repository.findInvoiceById(tenantId, id);
    if (!row) throw new NotFoundException({ code: "commerce.invoice_not_found", title: "Invoice not found" });
    return toInvoiceDetail(row);
  }

  /**
   * T27 (B8 fix, docs/plans/phase-9-completion.md): real signed-download implementation.
   * `stubMode: true` is now reserved ONLY for a legacy invoice row whose PDF generation
   * failed/never ran (storageKey still null) — real invoices always carry a storageKey
   * after InvoiceGenPort.enqueue() succeeds (invoice-gen.seam.ts).
   */
  async getInvoiceDownloadUrl(tenantId: string, actorId: string, invoiceId: string): Promise<InvoiceDownloadResponse> {
    await this.resolveListRestriction(actorId); // Finance/Owner/Admin only (invoices.view is never own-scope — see file header).
    const invoice = await this.repository.findInvoiceById(tenantId, invoiceId);
    if (!invoice) throw new NotFoundException({ code: "commerce.invoice_not_found", title: "Invoice not found" });

    if (!invoice.storageKey) {
      return { url: null, expiresAt: null, stubMode: true };
    }

    const signed = await this.storage.getSignedDownloadUrl({ key: invoice.storageKey });
    return { url: signed.url, expiresAt: signed.expiresAt.toISOString(), stubMode: false };
  }

  // ─── RECEIPTS (T27, docs/plans/phase-9-completion.md) ───────────────────

  /**
   * GET /api/v1/commerce/payments/:id/receipt — owner (the paying student, own-scope)
   * or Finance/Admin (all-scope). Receipts use a DETERMINISTIC storage key (no DB
   * column — see receipt-gen.seam.ts file header); `StorageProvider.head()` IS the
   * "ready" check. Triggers generation on first call if not yet rendered (fire-and-forget
   * via RECEIPT_GEN_PORT — QUEUE_DRIVER gate).
   */
  async getReceiptDownloadUrl(tenantId: string, actorId: string, paymentId: string): Promise<ReceiptDownloadResponse> {
    const scope = requireScopeContext();
    const payment = await this.repository.findPaymentById(tenantId, paymentId);
    if (!payment) throw new NotFoundException({ code: "commerce.payment_not_found", title: "Payment not found" });

    if (scope.scope === "all") {
      // Finance/Admin — no restriction.
    } else if (scope.scope === "branch") {
      const branchIds = await this.repository.listCallerBranchIds(actorId);
      const restricted = await this.repository.findOrderById(tenantId, payment.orderId, false, branchIds);
      if (!restricted) throw new NotFoundException({ code: "commerce.payment_not_found", title: "Payment not found" }); // IDOR -> 404
    } else if (scope.scope === "own") {
      const student = await this.repository.findStudentById(tenantId, payment.studentId);
      if (!student || student.userId !== actorId) {
        throw new NotFoundException({ code: "commerce.payment_not_found", title: "Payment not found" }); // IDOR -> 404
      }
    } else {
      throw new ForbiddenException({ code: "commerce.scope_unresolvable", title: "Scope not supported for commerce" });
    }

    if (payment.status !== "captured") {
      return { url: null, expiresAt: null, ready: false };
    }

    const key = buildStorageKey({ namespace: "receipts", tenantId, uniqueId: paymentId });
    const head = await this.storage.head({ key });
    if (!head.exists) {
      try {
        await this.receiptGen.enqueue({ paymentId, tenantId });
      } catch (err) {
        this.logger.error(`[Commerce] Receipt gen enqueue failed paymentId=${paymentId}: ${String(err)}`);
      }
      return { url: null, expiresAt: null, ready: false };
    }

    const signed = await this.storage.getSignedDownloadUrl({ key });
    return { url: signed.url, expiresAt: signed.expiresAt.toISOString(), ready: true };
  }

  // ─── REFUNDS ─────────────────────────────────────────────────────────────

  async requestRefund(
    tenantId: string,
    actorId: string,
    idempotencyKey: string,
    body: RequestRefundRequest,
  ): Promise<RefundDetail> {
    const payment = await this.repository.findPaymentById(tenantId, body.paymentId);
    if (!payment) throw new NotFoundException({ code: "commerce.payment_not_found", title: "Payment not found" });
    if (payment.tenantId !== tenantId) throw new NotFoundException({ code: "commerce.payment_not_found", title: "Payment not found" });

    if (payment.status !== "captured") {
      throw new BadRequestException({
        code: "commerce.payment_not_captured",
        title: "Cannot request refund for a payment that is not captured",
      });
    }

    // The ceiling is the payment total MINUS what other live refunds have already claimed,
    // not the payment total on its own. Checking only this one request let two refunds of
    // the full amount both be raised and both be approved — the maker-checker rule at
    // `approveRefund` is satisfied as long as a different person signs each one, so
    // nothing downstream noticed. Razorpay would reject the second, but as a provider
    // error after the row said "approved", not as a clean refusal here.
    const alreadyClaimedPaise = await this.repository.sumLiveRefundsForPayment(tenantId, body.paymentId);
    const refundablePaise = payment.amountPaise - alreadyClaimedPaise;
    if (body.amountPaise > refundablePaise) {
      throw new BadRequestException({
        code: "commerce.refund_exceeds_payment",
        title: "Refund amount exceeds the refundable balance",
        detail:
          alreadyClaimedPaise > 0
            ? `Payment amount is ${payment.amountPaise} paise, of which ${alreadyClaimedPaise} paise is already ` +
              `covered by an open or completed refund. At most ${refundablePaise} paise can still be refunded; ` +
              `${body.amountPaise} paise was requested.`
            : `Payment amount is ${payment.amountPaise} paise; requested refund is ${body.amountPaise} paise.`,
      });
    }

    const result = await this.repository.createRefund({
      tenantId,
      paymentId: body.paymentId,
      amountPaise: body.amountPaise,
      reason: body.reason,
      requestedById: actorId,
      status: "requested",
    });

    const row = await this.repository.findRefundById(tenantId, result.id);
    if (!row) throw new NotFoundException({ code: "commerce.refund_not_found", title: "Refund not found after creation" });
    return toRefundDetail(row);
  }

  async approveRefund(
    tenantId: string,
    actorId: string,
    refundId: string,
    _body: ApproveRefundRequest,
  ): Promise<RefundDetail> {
    const refund = await this.repository.findRefundById(tenantId, refundId);
    if (!refund) throw new NotFoundException({ code: "commerce.refund_not_found", title: "Refund not found" });
    if (refund.tenantId !== tenantId) throw new NotFoundException({ code: "commerce.refund_not_found", title: "Refund not found" });

    // M-2: Maker-checker — the requester cannot approve their own refund.
    // Prevent self-approval regardless of role/permission.
    if (refund.requestedById === actorId) {
      throw new ForbiddenException({
        code: "commerce.refund_self_approval",
        title: "Self-approval not permitted",
        detail: "The user who requested the refund cannot also approve it. A different authorised user must approve.",
      });
    }

    // M-1 (a): Guard on non-approvable state (must precede idempotent early-return check)
    if (refund.status !== "requested" && refund.status !== "approved" && refund.status !== "processed") {
      throw new ConflictException({
        code: "commerce.refund_not_approvable",
        title: "Refund cannot be approved in its current state",
        detail: `Refund status is "${refund.status}". Only 'requested' refunds can be approved.`,
      });
    }

    // M-1 (a): EARLY RETURN for already-processed refund — idempotent no-op.
    // Previously this was an empty `if` block that fell through and called the provider again.
    if (refund.status === "processed") {
      this.logger.log(`[Commerce] approveRefund idempotent no-op, refund ${refundId} already processed`);
      return toRefundDetail(refund);
    }

    // Only "requested" refunds can be approved (not "approved" — that is an internal state
    // that the approve path sets before calling the provider; if we ever need to retry a
    // previously-approved-but-not-yet-provider-processed refund, handle separately).
    if (refund.status !== "requested") {
      throw new ConflictException({
        code: "commerce.refund_not_approvable",
        title: "Refund cannot be approved in its current state",
        detail: `Refund status is "${refund.status}". Only 'requested' refunds can be approved.`,
      });
    }

    // Fetch the payment to get the provider payment id
    const payment = await this.repository.findPaymentById(tenantId, refund.paymentId);
    if (!payment || !payment.providerPaymentId) {
      throw new BadRequestException({
        code: "commerce.payment_no_provider_id",
        title: "Cannot process refund. Payment has no provider payment id",
        detail: "Manual payments may need to be refunded offline.",
      });
    }

    // Re-check the aggregate ceiling immediately before money moves. `requestRefund` already
    // counts open requests, but two of them can be raised concurrently and each pass that
    // check against a stale total; this is the last point at which refusing is free.
    const otherLiveRefundsPaise = await this.repository.sumLiveRefundsForPayment(
      tenantId,
      refund.paymentId,
      refundId,
    );
    if (otherLiveRefundsPaise + refund.amountPaise > payment.amountPaise) {
      throw new ConflictException({
        code: "commerce.refund_exceeds_payment",
        title: "Refund amount exceeds the refundable balance",
        detail:
          `Other refunds on this payment already account for ${otherLiveRefundsPaise} of ${payment.amountPaise} paise, ` +
          `so this ${refund.amountPaise}-paise refund would over-refund it. Reject this request and raise one for the remainder.`,
      });
    }

    let providerRefundId: string | null = null;

    // M-1 (b): Provider call is OUTSIDE the transaction — it's an external side-effect that
    // is already idempotent at the provider layer via idempotencyKey=refundId (stable per row).
    // We call it first, then wrap the DB writes in a single transaction so a crash after the
    // provider call succeeds but before the DB writes cannot leave money refunded at Razorpay
    // with the row still in "requested" state.
    try {
      const result = await this.paymentProvider.refund({
        providerPaymentId: payment.providerPaymentId,
        amountPaise: refund.amountPaise,
        idempotencyKey: refundId, // stable per refund row — safe to retry
        notes: { refund_id: refundId, reason: refund.reason.slice(0, 200) },
      });
      providerRefundId = result.providerRefundId;
    } catch (err) {
      // Provider refund failed — mark the refund row failed so it can be retried
      await this.repository.updateRefundApprove(refundId, actorId, { status: "failed" });
      this.logger.error(`[Commerce] Refund provider call failed for refund ${refundId}: ${String(err)}`);
      throw new BadRequestException({
        code: "commerce.refund_provider_failed",
        title: "Refund processing failed at the payment provider",
        detail: "The refund was approved but the provider returned an error. Status set to failed, retry to reprocess.",
      });
    }

    // M-1 (b): All post-provider DB writes in a single transaction.
    // A crash after provider.refund() succeeds but before this txn commits would leave
    // money refunded at Razorpay but the row still "requested". On a retry the provider
    // call is idempotent (same idempotencyKey) so it would return the same providerRefundId
    // and the txn would then succeed.
    const isFullRefund = refund.amountPaise >= payment.amountPaise;
    await this.repository.transaction(async (tx) => {
      // Mark refund processed with provider id
      await tx.refund.update({
        where: { id: refundId },
        data: {
          approvedById: actorId,
          status: "processed",
          providerRefundId,
          processedAt: new Date(),
        },
      });

      // Always mark payment as refunded (the partial-refund note applies to the webhook path;
      // for staff-initiated approve, a full-refund check is still appropriate)
      if (isFullRefund) {
        await tx.payment.update({
          where: { id: refund.paymentId },
          data: { status: "refunded" },
        });
        await tx.order.update({
          where: { id: payment.orderId },
          data: { status: "refunded" },
        });
      }
      // Partial refund: payment stays "captured" — no partially_refunded enum value exists.
    });

    const updated = await this.repository.findRefundById(tenantId, refundId);
    if (!updated) throw new NotFoundException({ code: "commerce.refund_not_found", title: "Refund not found after approval" });
    return toRefundDetail(updated);
  }

  async rejectRefund(
    tenantId: string,
    actorId: string,
    refundId: string,
    _body: RejectRefundRequest,
  ): Promise<RefundDetail> {
    const refund = await this.repository.findRefundById(tenantId, refundId);
    if (!refund) throw new NotFoundException({ code: "commerce.refund_not_found", title: "Refund not found" });
    if (refund.tenantId !== tenantId) throw new NotFoundException({ code: "commerce.refund_not_found", title: "Refund not found" });

    if (refund.status !== "requested") {
      throw new ConflictException({
        code: "commerce.refund_not_rejectable",
        title: "Refund cannot be rejected in its current state",
        detail: `Refund status is "${refund.status}". Only 'requested' refunds can be rejected.`,
      });
    }

    await this.repository.updateRefundApprove(refundId, actorId, { status: "rejected" });

    const updated = await this.repository.findRefundById(tenantId, refundId);
    if (!updated) throw new NotFoundException({ code: "commerce.refund_not_found", title: "Refund not found after rejection" });
    return toRefundDetail(updated);
  }

  async listRefunds(
    tenantId: string,
    actorId: string,
    query: ListRefundsQuery,
  ): Promise<PaginatedResult<RefundSummary>> {
    await this.resolveListRestriction(actorId);
    const { rows, total } = await this.repository.listRefunds({
      tenantId,
      paymentId: query.paymentId,
      orderId: query.orderId,
      studentId: query.studentId,
      status: query.status,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
    });

    return new PaginatedResult(rows.map(toRefundSummary), {
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
      total,
      hasMore: (query.page ?? 1) * (query.pageSize ?? 20) < total,
    });
  }

  async getRefundById(tenantId: string, actorId: string, id: string): Promise<RefundDetail> {
    await this.resolveListRestriction(actorId);
    const row = await this.repository.findRefundById(tenantId, id);
    if (!row) throw new NotFoundException({ code: "commerce.refund_not_found", title: "Refund not found" });
    return toRefundDetail(row);
  }

  // ─── COUPONS ─────────────────────────────────────────────────────────────

  async createCoupon(
    tenantId: string,
    actorId: string,
    idempotencyKey: string,
    body: CreateCouponRequest,
  ): Promise<CouponDetail> {
    // Type-level validation already done by Zod schema in dto; additional server check:
    if (body.type === "pct" && body.value > 100) {
      throw new BadRequestException({
        code: "commerce.coupon_invalid_pct",
        title: "Percentage coupon value must be 1–100",
      });
    }

    // Check uniqueness (tenant + code)
    const existing = await this.repository.findCouponByCode(tenantId, body.code);
    if (existing) {
      throw new ConflictException({ code: "commerce.coupon_duplicate_code", title: "Coupon code already exists for this tenant" });
    }

    const result = await this.repository.createCoupon(tenantId, {
      code: body.code,
      type: body.type,
      value: body.value,
      maxUses: body.maxUses ?? null,
      validFrom: body.validFrom ? new Date(body.validFrom) : null,
      validTo: body.validTo ? new Date(body.validTo) : null,
      programScope: body.programScope ?? null,
      status: body.status ?? "active",
    });

    const row = await this.repository.findCouponById(tenantId, result.id);
    if (!row) throw new NotFoundException({ code: "commerce.coupon_not_found", title: "Coupon not found after creation" });
    return toCouponDetail(row);
  }

  async updateCoupon(
    tenantId: string,
    actorId: string,
    id: string,
    body: UpdateCouponRequest,
  ): Promise<CouponDetail> {
    const existing = await this.repository.findCouponById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "commerce.coupon_not_found", title: "Coupon not found" });

    await this.repository.updateCoupon(id, {
      ...(body.maxUses !== undefined ? { maxUses: body.maxUses } : {}),
      ...(body.validFrom !== undefined ? { validFrom: body.validFrom ? new Date(body.validFrom) : null } : {}),
      ...(body.validTo !== undefined ? { validTo: body.validTo ? new Date(body.validTo) : null } : {}),
      ...(body.programScope !== undefined ? { programScope: body.programScope ?? null } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
    });

    const updated = await this.repository.findCouponById(tenantId, id);
    if (!updated) throw new NotFoundException({ code: "commerce.coupon_not_found", title: "Coupon not found after update" });
    return toCouponDetail(updated);
  }

  async listCoupons(
    tenantId: string,
    actorId: string,
    query: ListCouponsQuery,
  ): Promise<PaginatedResult<CouponSummary>> {
    // No strict scope for coupons in list — Finance/Marketing/Admin can all view
    // requireScopeContext() is called by the interceptor path; service doesn't re-check here
    const { rows, total } = await this.repository.listCoupons({
      tenantId,
      status: query.status,
      type: query.type,
      search: query.search,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
    });

    return new PaginatedResult(rows.map(toCouponSummary), {
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
      total,
      hasMore: (query.page ?? 1) * (query.pageSize ?? 20) < total,
    });
  }

  async getCouponById(tenantId: string, actorId: string, id: string): Promise<CouponDetail> {
    const row = await this.repository.findCouponById(tenantId, id);
    if (!row) throw new NotFoundException({ code: "commerce.coupon_not_found", title: "Coupon not found" });
    return toCouponDetail(row);
  }

  async deleteCoupon(tenantId: string, actorId: string, id: string): Promise<CouponDetail> {
    const row = await this.repository.findCouponById(tenantId, id);
    if (!row) throw new NotFoundException({ code: "commerce.coupon_not_found", title: "Coupon not found" });
    await this.repository.softDeleteCoupon(id);
    const deleted = await this.repository.findCouponById(tenantId, id, true);
    if (!deleted) throw new NotFoundException({ code: "commerce.coupon_not_found", title: "Coupon not found after deletion" });
    return toCouponDetail(deleted);
  }

  async validateCoupon(
    tenantId: string,
    body: ValidateCouponRequest,
  ): Promise<ValidateCouponResponse> {
    const coupon = await this.repository.findCouponByCode(tenantId, body.code);
    if (!coupon) {
      return {
        valid: false,
        couponId: null,
        code: body.code,
        type: null,
        discountPaise: null,
        invalidReason: "not_found",
      };
    }

    const program = await this.repository.findProgramById(tenantId, body.programId);
    const pricePaise = program?.pricePaise ?? 0;

    const validation = validateCoupon(coupon, body.programId);
    if (!validation.valid) {
      return {
        valid: false,
        couponId: coupon.id,
        code: coupon.code,
        type: coupon.type as "pct" | "flat",
        discountPaise: null,
        invalidReason: validation.reason ?? "invalid",
      };
    }

    const discountPaise = computeDiscountPaise(coupon.type as "pct" | "flat", coupon.value, pricePaise);
    return {
      valid: true,
      couponId: coupon.id,
      code: coupon.code,
      type: coupon.type as "pct" | "flat",
      discountPaise,
      invalidReason: null,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Coupon validation helper (pure, no DB)
// ─────────────────────────────────────────────────────────────────────────────

interface CouponValidationResult {
  valid: boolean;
  reason?: string;
}

function validateCoupon(
  coupon: {
    status: string;
    validFrom: Date | null;
    validTo: Date | null;
    maxUses: number | null;
    used: number;
    programScope: unknown;
  },
  programId: string,
): CouponValidationResult {
  const now = new Date();

  if (coupon.status !== "active") {
    return { valid: false, reason: "not_active" };
  }
  if (coupon.validFrom && now < coupon.validFrom) {
    return { valid: false, reason: "not_yet_valid" };
  }
  if (coupon.validTo && now > coupon.validTo) {
    return { valid: false, reason: "expired" };
  }
  if (coupon.maxUses !== null && coupon.used >= coupon.maxUses) {
    return { valid: false, reason: "max_uses_reached" };
  }

  // Program scope check
  if (coupon.programScope !== null && coupon.programScope !== undefined) {
    const scope = coupon.programScope as string[] | unknown;
    if (Array.isArray(scope) && scope.length > 0) {
      if (!scope.includes(programId)) {
        return { valid: false, reason: "wrong_program" };
      }
    }
  }

  return { valid: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// DTO mappers (OrderRow/PaymentRow/etc. → DTO shape)
// ─────────────────────────────────────────────────────────────────────────────

import type { OrderRow, PaymentRow, InvoiceRow, RefundRow, CouponRow } from "./commerce.repository";

function toOrderSummary(row: OrderRow): OrderSummary {
  return {
    // Derived, not stored — see commerce.repository.ts. The order's own two numbers stay the
    // single source of truth for what it was worth.
    listPricePaise: row.amountPaise + row.discountPaise,
    discountReason: row.discountReason ?? null,
    id: row.id,
    studentId: row.studentId,
    studentName: row.studentName,
    programId: row.programId,
    programTitle: row.programTitle,
    batchId: row.batchId,
    batchName: row.batchName,
    amountPaise: row.amountPaise,
    currency: row.currency,
    discountPaise: row.discountPaise,
    status: row.status as OrderSummary["status"],
    couponCode: row.couponCode,
    invoiceId: row.invoiceId,
    invoiceNumber: row.invoiceNumber,
    createdAt: row.createdAt.toISOString(),
  };
}

function toOrderDetail(row: OrderRow): OrderDetail {
  // Notes are stored as JSON { batchId, text? }. Extract the text portion for the DTO.
  let notesText: string | null = null;
  const rawNotes = row.notes as Record<string, unknown> | null;
  if (rawNotes && typeof rawNotes["text"] === "string") {
    notesText = rawNotes["text"] as string;
  }

  return {
    ...toOrderSummary(row),
    couponId: row.couponId,
    emiPlan: row.emiPlan as OrderDetail["emiPlan"],
    notes: notesText,
    enrollmentId: row.enrollmentId,
    enrollmentSource: row.enrollmentSource as OrderDetail["enrollmentSource"],
    invoiceId: row.invoiceId,
    invoiceNumber: row.invoiceNumber,
    paymentCount: row.paymentCount,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toPaymentSummary(row: PaymentRow): PaymentSummary {
  return {
    id: row.id,
    orderId: row.orderId,
    provider: row.provider,
    providerPaymentId: row.providerPaymentId,
    amountPaise: row.amountPaise,
    status: row.status as PaymentSummary["status"],
    method: row.method,
    isManual: row.isManual,
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toPaymentDetail(row: PaymentRow): PaymentDetail {
  return {
    ...toPaymentSummary(row),
    providerOrderId: row.providerOrderId,
    signatureVerified: row.signatureVerified,
    studentId: row.studentId,
    studentName: row.studentName,
    programId: row.programId,
    programTitle: row.programTitle,
    updatedAt: row.updatedAt.toISOString(),
    // M-6: include reference/notes for manual payments; null for online payments.
    reference: row.reference ?? null,
    notes: row.notes ?? null,
  };
}

function toInvoiceSummary(row: InvoiceRow): InvoiceSummary {
  return {
    id: row.id,
    orderId: row.orderId,
    number: row.number,
    status: row.status as InvoiceSummary["status"],
    issuedAt: row.issuedAt ? row.issuedAt.toISOString() : null,
    studentName: row.studentName,
    programTitle: row.programTitle,
    amountPaise: row.amountPaise,
    currency: row.currency,
    createdAt: row.createdAt.toISOString(),
  };
}

function toInvoiceDetail(row: InvoiceRow): InvoiceDetail {
  return {
    ...toInvoiceSummary(row),
    studentId: row.studentId,
    tax: row.tax as InvoiceDetail["tax"],
    storageKey: row.storageKey,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toRefundSummary(row: RefundRow): RefundSummary {
  return {
    id: row.id,
    paymentId: row.paymentId,
    orderId: row.orderId,
    amountPaise: row.amountPaise,
    reason: row.reason,
    status: row.status as RefundSummary["status"],
    requestedById: row.requestedById,
    requestedByName: row.requestedByName,
    approvedById: row.approvedById,
    approvedByName: row.approvedByName,
    createdAt: row.createdAt.toISOString(),
  };
}

function toRefundDetail(row: RefundRow): RefundDetail {
  return {
    ...toRefundSummary(row),
    providerRefundId: row.providerRefundId,
    processedAt: row.processedAt ? row.processedAt.toISOString() : null,
    studentId: row.studentId,
    studentName: row.studentName,
    programTitle: row.programTitle,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toCouponSummary(row: CouponRow): CouponSummary {
  return {
    id: row.id,
    code: row.code,
    type: row.type as CouponSummary["type"],
    value: row.value,
    maxUses: row.maxUses,
    used: row.used,
    validFrom: row.validFrom ? row.validFrom.toISOString() : null,
    validTo: row.validTo ? row.validTo.toISOString() : null,
    status: row.status as CouponSummary["status"],
    createdAt: row.createdAt.toISOString(),
  };
}

function toCouponDetail(row: CouponRow): CouponDetail {
  return {
    ...toCouponSummary(row),
    programScope: Array.isArray(row.programScope) ? (row.programScope as string[]) : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}
