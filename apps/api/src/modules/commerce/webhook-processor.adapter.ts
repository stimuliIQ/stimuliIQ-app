// apps/api/src/modules/commerce/webhook-processor.adapter.ts
//
// Synchronous webhook event processor (P2 BullMQ seam — see invoice-gen.seam.ts).
//
// Processes Razorpay webhook events SYNCHRONOUSLY and IDEMPOTENTLY.
// BullMQ MIGRATION: replace the synchronous processing in process() with
// a queue.add() call and handle in a Worker with:
//   { jobId: eventKey, attempts: 5, backoff: { type: 'exponential' } }
//
// KNOWN EVENTS handled:
//   payment.captured  → same idempotent path as verify-payment (capture + enroll + invoice)
//   payment.failed    → mark payment failed (idempotent)
//   refund.processed  → mark refund processed (idempotent)
//
// ALL OTHER EVENTS → silently ignored (safe-by-default).
//
// SECURITY: The controller verifies the HMAC signature BEFORE calling this.
// This processor trusts the payload is authentic.
//
// IDEMPOTENCY: Every path checks existing state before mutating.
//   - payment.captured: idempotent by provider_payment_id unique.
//   - payment.failed: idempotent (already failed = no-op).
//   - refund.processed: idempotent by providerRefundId.

import { Injectable, Logger } from "@nestjs/common";
import type { WebhookProcessorPort, WebhookEventPayload } from "./invoice-gen.seam";
import { INVOICE_GEN_PORT, type InvoiceGenPort } from "./invoice-gen.seam";
import { CommerceRepository } from "./commerce.repository";
import { Inject } from "@nestjs/common";
import { LmsAccountProvisioningService } from "../students/lms-account-provisioning.service";

@Injectable()
export class SyncWebhookProcessorAdapter implements WebhookProcessorPort {
  private readonly logger = new Logger(SyncWebhookProcessorAdapter.name);

  constructor(
    private readonly repository: CommerceRepository,
    @Inject(INVOICE_GEN_PORT) private readonly invoiceGen: InvoiceGenPort,
    // lifecycle-redesign P3: provision the LMS login once payment is captured and the
    // enrollment is created (idempotent — safe alongside the manual-enroll path).
    private readonly lmsProvisioning: LmsAccountProvisioningService,
  ) {}

  async process(payload: WebhookEventPayload): Promise<void> {
    const event = payload.event;

    if (!event) {
      this.logger.warn("[Webhook] Received payload with no event field — ignoring");
      return;
    }

    this.logger.log(`[Webhook] Processing event: ${event}`);

    switch (event) {
      case "payment.captured":
        await this.handlePaymentCaptured(payload);
        break;

      case "payment.failed":
        await this.handlePaymentFailed(payload);
        break;

      case "refund.processed":
        await this.handleRefundProcessed(payload);
        break;

      default:
        // Unknown event — safe-by-default ignore
        this.logger.debug(`[Webhook] Unknown event type "${event}" — ignoring`);
        break;
    }
  }

  private async handlePaymentCaptured(payload: WebhookEventPayload): Promise<void> {
    const entity = payload.payload?.payment?.entity;
    if (!entity?.id) {
      this.logger.warn("[Webhook] payment.captured missing entity.id — ignoring");
      return;
    }

    const providerPaymentId = entity.id;
    const providerOrderId = entity.order_id;

    // Idempotency: if already captured, skip
    const existing = await this.repository.findPaymentByProviderPaymentId(providerPaymentId);
    if (existing && existing.status === "captured") {
      this.logger.log(`[Webhook] payment.captured idempotent no-op for ${providerPaymentId}`);
      return;
    }

    // Find payment by provider order id (created during /pay step)
    const payment = providerOrderId
      ? await this.repository.findPaymentByProviderOrderId(providerOrderId)
      : null;

    if (!payment) {
      this.logger.warn(
        `[Webhook] payment.captured — no payment row found for order_id=${providerOrderId ?? "unknown"}`,
      );
      return;
    }

    // Fetch order context for enrollment
    const order = await this.repository.findOrderById(payment.tenantId, payment.orderId);
    if (!order) {
      this.logger.warn(`[Webhook] payment.captured — order ${payment.orderId} not found`);
      return;
    }

    const notesJson = order.notes as Record<string, unknown> | null;
    const batchId = (notesJson?.batchId as string | undefined) ?? order.batchId;

    if (!batchId) {
      this.logger.warn(`[Webhook] payment.captured — order ${payment.orderId} has no batchId`);
      return;
    }

    // Atomic capture
    let invoiceId: string | null = null;
    try {
      await this.repository.transaction(async (tx) => {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            providerPaymentId,
            status: "captured",
            signatureVerified: false, // webhook path — no checkout signature
            paidAt: new Date(),
            ...(entity.method ? { method: entity.method } : {}),
          },
        });

        await tx.order.update({
          where: { id: payment.orderId },
          data: { status: "paid" },
        });

        // Create/restore enrollment
        const existingEnrollment = await this.repository.findExistingEnrollment(
          order.studentId,
          batchId,
        );
        if (!existingEnrollment) {
          await this.repository.createEnrollment(tx, {
            tenantId: payment.tenantId,
            studentId: order.studentId,
            batchId,
            programId: order.programId,
            orderId: payment.orderId,
            source: "order",
          });
        } else if (existingEnrollment.deletedAt !== null) {
          await this.repository.restoreEnrollment(tx, existingEnrollment.id, payment.orderId, "order");
        }
        // If already active with same order — idempotent no-op

        // Invoice
        const existingInvoice = await tx.invoice.findFirst({
          where: { orderId: payment.orderId },
          select: { id: true },
        });
        if (!existingInvoice) {
          const invoiceNumber = await this.repository.generateInvoiceNumber(tx, payment.tenantId);
          const inv = await this.repository.createInvoice(tx, {
            tenantId: payment.tenantId,
            orderId: payment.orderId,
            number: invoiceNumber,
            status: "draft",
          });
          invoiceId = inv.id;
        } else {
          invoiceId = existingInvoice.id;
        }
      });
    } catch (err) {
      this.logger.error(`[Webhook] payment.captured transaction failed: ${String(err)}`);
      return;
    }

    // Provision the LMS login AFTER the enrollment transaction commits (email send is an
    // external call — never hold it inside the DB transaction). Best-effort + idempotent:
    // a failure here does not undo the captured payment/enrollment.
    try {
      await this.lmsProvisioning.provisionForStudentProfile(payment.tenantId, order.studentId);
    } catch (err) {
      this.logger.error(`[Webhook] LMS provisioning failed for student=${order.studentId}: ${String(err)}`);
    }

    if (invoiceId) {
      try {
        await this.invoiceGen.enqueue({
          invoiceId,
          orderId: payment.orderId,
          tenantId: payment.tenantId,
        });
      } catch (err) {
        this.logger.error(`[Webhook] Invoice gen failed: ${String(err)}`);
      }
    }
  }

  private async handlePaymentFailed(payload: WebhookEventPayload): Promise<void> {
    const entity = payload.payload?.payment?.entity;
    if (!entity?.id) return;

    const providerPaymentId = entity.id;
    const providerOrderId = entity.order_id;

    // Find payment
    const payment = providerOrderId
      ? await this.repository.findPaymentByProviderOrderId(providerOrderId)
      : null;

    if (!payment) {
      this.logger.warn(`[Webhook] payment.failed — no payment found for provider_id=${providerPaymentId}`);
      return;
    }

    if (payment.status === "failed") {
      // Already failed — idempotent no-op
      return;
    }

    await this.repository.updatePaymentStatus(payment.id, "failed");
    this.logger.log(`[Webhook] Marked payment ${payment.id} as failed`);
  }

  private async handleRefundProcessed(payload: WebhookEventPayload): Promise<void> {
    const entity = payload.payload?.refund?.entity;
    if (!entity?.id || !entity?.payment_id) return;

    const providerRefundId = entity.id as string;
    const providerPaymentId = entity.payment_id as string;
    // Razorpay sends refund amount in paise (integer). Used to determine full vs partial.
    const refundAmountPaise = typeof entity.amount === "number" ? entity.amount : null;

    // Find the payment
    const payment = await this.repository.findPaymentByProviderPaymentId(providerPaymentId);
    if (!payment) {
      this.logger.warn(`[Webhook] refund.processed — payment not found for ${providerPaymentId}`);
      return;
    }

    // H-2 FIX: STRICT match by providerRefundId ONLY.
    // The || r.status === "approved" fallback was removed — it matched ANY approved refund on
    // the payment, which could corrupt the ledger by marking the wrong row processed.
    // Search all approved refunds on this payment and match strictly.
    const { rows } = await this.repository.listRefunds({
      tenantId: payment.tenantId,
      paymentId: payment.id,
      status: "approved",
      page: 1,
      pageSize: 50,
    });

    const refund = rows.find((r) => r.providerRefundId === providerRefundId);
    if (!refund) {
      // No row matches this providerRefundId — log warning and NO-OP.
      // Do NOT fall back to any other row.
      this.logger.warn(
        `[Webhook] refund.processed — no refund row with providerRefundId=${providerRefundId} found ` +
          `for payment ${payment.id}. No-op to avoid corrupting wrong row.`,
      );
      return;
    }

    // Idempotency: if already processed, early return — no second mutation
    if (refund.status === "processed") {
      this.logger.log(
        `[Webhook] refund.processed idempotent no-op — refund ${refund.id} already processed`,
      );
      return;
    }

    // Determine full vs partial refund for payment status update.
    // NOTE: there is no "partially_refunded" enum value in PaymentStatus. For a partial refund
    // we leave payment.status as "captured" and only mark the refund row processed.
    // Only a full refund (refundAmount >= payment.capturedAmount) flips payment to "refunded".
    const isFullRefund =
      refundAmountPaise !== null
        ? refundAmountPaise >= payment.amountPaise
        : refund.amountPaise >= payment.amountPaise;

    // Wrap all DB writes in a single transaction so a crash cannot leave the refund row
    // updated but the payment status inconsistent (or vice-versa).
    await this.repository.transaction(async (tx) => {
      await tx.refund.update({
        where: { id: refund.id },
        data: {
          status: "processed",
          providerRefundId,
          processedAt: new Date(),
        },
      });

      if (isFullRefund) {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: "refunded" },
        });
      }
      // Partial refund: payment stays "captured"; no partially_refunded enum value exists.
    });

    this.logger.log(
      `[Webhook] Refund ${refund.id} marked as processed (${isFullRefund ? "full" : "partial"} refund)`,
    );
  }
}
