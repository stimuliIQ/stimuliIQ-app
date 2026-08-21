// apps/api/src/modules/commerce/receipt-gen.seam.ts
//
// ReceiptGenPort — payment receipt PDF generation (T27, docs/plans/
// phase-9-completion.md). Same ADR-0020 producer/port seam as InvoiceGenPort in this
// same file's sibling (invoice-gen.seam.ts): SyncReceiptGenAdapter (QUEUE_DRIVER=sync,
// default) renders + uploads INLINE; BullMqReceiptGenAdapter (QUEUE_DRIVER=bullmq)
// enqueues and returns immediately — the worker (apps/api/src/worker.ts) constructs the
// SAME SyncReceiptGenAdapter singleton to do the actual work.
//
// UNLIKE Invoice (which has a real `storage_key` DB column), Payment carries NO
// storage-key column in the shipped schema — receipts use a DETERMINISTIC storage key
// (`receipts/{tenantId}/{paymentId}.pdf`, buildStorageKey namespace "receipts") instead
// of persisting one. `CommerceService.getReceiptDownloadUrl()` calls
// `StorageProvider.head()` against that deterministic key to decide `ready: true/false`
// (ReceiptDownloadResponseSchema) — no DB write needed for "is it ready" at all. This
// avoids a schema change (out of this task's apps/api-only scope) while still giving a
// durable, idempotent artifact location: re-running the render for the same paymentId
// always overwrites the exact same key.
//
// IDEMPOTENCY: `jobId: payload.paymentId` (BullMQ path) / re-render always targets the
// same deterministic key (sync path) — replaying is a safe overwrite, never a duplicate.

import { Inject, Injectable, Logger } from "@nestjs/common";
import { CommerceRepository } from "./commerce.repository";
import { STORAGE_PROVIDER, type StorageProvider } from "../storage/providers/storage/storage-provider.interface";
import { buildStorageKey } from "../storage/providers/storage/s3-storage.provider";
import { REPORT_PDF_PORT, type ReportPdfPort } from "../exports/providers/pdf/report-pdf-port.interface";

export interface ReceiptGenPayload {
  paymentId: string;
  tenantId: string;
}

export interface ReceiptGenPort {
  /** Renders + uploads a receipt PDF for a CAPTURED payment. Idempotent (deterministic key overwrite). */
  enqueue(payload: ReceiptGenPayload): Promise<void>;
}

export const RECEIPT_GEN_PORT = Symbol("RECEIPT_GEN_PORT");

// ─────────────────────────────────────────────────────────────────────────────
// Sync adapter (QUEUE_DRIVER=sync, default)
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class SyncReceiptGenAdapter implements ReceiptGenPort {
  private readonly logger = new Logger(SyncReceiptGenAdapter.name);

  constructor(
    private readonly repository: CommerceRepository,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(REPORT_PDF_PORT) private readonly reportPdf: ReportPdfPort,
  ) {}

  async enqueue(payload: ReceiptGenPayload): Promise<void> {
    const payment = await this.repository.findPaymentById(payload.tenantId, payload.paymentId);
    if (!payment) {
      this.logger.warn(`[ReceiptGen] payment not found paymentId=${payload.paymentId}, skipping (safe no-op).`);
      return;
    }
    if (payment.status !== "captured") {
      this.logger.warn(`[ReceiptGen] payment status="${payment.status}" (not captured), skipping receipt render.`);
      return;
    }

    const key = buildStorageKey({ namespace: "receipts", tenantId: payload.tenantId, uniqueId: payload.paymentId });

    // Payment carries no `currency` column (see file header) — INR is the platform's
    // single-market default (CLAUDE.md §0 "Primary market: India").
    const currency = "INR";
    const pdf = await this.reportPdf.render({
      title: "Payment Receipt",
      generatedAt: new Date().toISOString(),
      subtitle: `${payment.studentName} · ${payment.programTitle}`,
      headers: ["Field", "Value"],
      rows: [
        ["Receipt for payment", payment.id],
        ["Amount paid", `${currency} ${(payment.amountPaise / 100).toFixed(2)}`],
        ["Method", payment.method ?? "-"],
        ["Paid at", payment.paidAt ? payment.paidAt.toISOString() : "-"],
      ],
    });

    await this.storage.putObject({ key, body: Buffer.from(pdf.bytes), contentType: pdf.contentType });
    this.logger.log(`[ReceiptGen] receipt rendered + uploaded paymentId=${payload.paymentId} key=${key}`);
  }
}
