// apps/api/src/modules/commerce/invoice-gen.seam.ts
//
// Invoice generation port / seam (docs/04-trd-architecture.md §2.8).
//
// BullMQ STATUS (updated — docs/plans/phase-9-completion.md T18/R1, ADR-0056):
// BullMQ IS installed and wired. InvoiceGenPort is bound to SyncInvoiceGenAdapter
// (QUEUE_DRIVER=sync, default — required for the Jest unit suite) or
// BullMqInvoiceGenAdapter (QUEUE_DRIVER=bullmq) via a useFactory gate in
// commerce.module.ts. See bullmq-invoice-gen.adapter.ts for the real adapter and
// apps/api/src/worker.ts for the worker process that consumes the queue.
//
// DECISION (historical — P2, superseded by ADR-0056 for the driver selection, the
// port/adapter SHAPE below is unchanged):
//   - InvoiceGenPort is the interface both SyncInvoiceGenAdapter (inline) and
//     BullMqInvoiceGenAdapter (enqueue) implement.
//   - The seam: rebinding INVOICE_GEN_PORT via QUEUE_DRIVER requires zero changes to
//     CommerceService either way.
//
// WEBHOOK PROCESSING follows the same pattern — see WebhookProcessorPort.

import { Inject, Injectable, Logger } from "@nestjs/common";
// NOTE: must be a value import (not `import type`) — Nest's DI relies on
// `emitDecoratorMetadata`'s `design:paramtypes`, which only captures a real
// class reference at runtime when the import is a value import. A type-only
// import erases the class reference, so the constructor param resolves to
// the bare `Object` type and Nest cannot inject it (this was the root cause
// of "Nest can't resolve dependencies of the SyncInvoiceGenAdapter (?)").
import { CommerceRepository } from "./commerce.repository";
import { STORAGE_PROVIDER, type StorageProvider } from "../storage/providers/storage/storage-provider.interface";
import { buildStorageKey } from "../storage/providers/storage/s3-storage.provider";
import { REPORT_PDF_PORT, type ReportPdfPort } from "../exports/providers/pdf/report-pdf-port.interface";
// Value import (not `import type`) — see the DI/emitDecoratorMetadata note above: a
// type-only import erases the class ref and Nest can't inject it.
import { CompanyProfileService } from "../platform/company-profile.service";
import { computeGstBreakdown } from "./lib/gst";

// ─────────────────────────────────────────────────────────────────────────────
// Invoice gen port
// ─────────────────────────────────────────────────────────────────────────────

export interface InvoiceGenPayload {
  /** Invoice row id (used as BullMQ jobId for idempotency when real queue is added). */
  invoiceId: string;
  orderId: string;
  tenantId: string;
}

export interface InvoiceGenPort {
  /**
   * Enqueue (or synchronously process) invoice generation for a paid order.
   * Idempotent: calling twice with the same invoiceId is a safe no-op.
   */
  enqueue(payload: InvoiceGenPayload): Promise<void>;
}

export const INVOICE_GEN_PORT = Symbol("INVOICE_GEN_PORT");

// ─────────────────────────────────────────────────────────────────────────────
// Synchronous stub adapter (P2 — BullMQ not yet installed)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Real invoice generation adapter (T27, docs/plans/phase-9-completion.md, B8 fix).
 *
 * Renders a real PDF via the shared ReportPdfPort (title + metadata + tabular-rows —
 * same generic renderer ExportsService uses, see report-pdf-port.interface.ts file
 * header), uploads it via StorageProvider.putObject() (server-side write, no presigned
 * round-trip — see storage-provider.interface.ts's PutObjectInput doc comment), and
 * sets `invoices.storage_key` to the REAL key (never null after this call succeeds) —
 * this is the B8 fix: `storage_key` was previously left null forever.
 *
 * GST fields: computed via computeGstBreakdown() (lib/gst.ts) and stored in
 * `invoices.tax` (InvoiceTaxSchema's open JSON shape).
 *
 * BullMQ migration: replace with BullMqInvoiceGenAdapter (see file header) — the
 * worker resolves this SAME class via app.get(SyncInvoiceGenAdapter).
 */
@Injectable()
export class SyncInvoiceGenAdapter implements InvoiceGenPort {
  private readonly logger = new Logger(SyncInvoiceGenAdapter.name);

  // NOTE: dependencies injected via the module's provider list (bare-registered so the
  // worker can resolve the SAME singleton via app.get() — see commerce.module.ts).
  constructor(
    private readonly repository: CommerceRepository,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(REPORT_PDF_PORT) private readonly reportPdf: ReportPdfPort,
    // Stamps the invoice with the tenant's configured company name (Settings → Company).
    private readonly companyProfile: CompanyProfileService,
  ) {}

  async enqueue(payload: InvoiceGenPayload): Promise<void> {
    // Idempotency check: if invoice is already issued, skip.
    const invoice = await this.repository.findInvoiceById(payload.tenantId, payload.invoiceId);
    if (!invoice) return; // Row may have been voided or tenant mismatch
    if (invoice.status === "issued") return; // Already processed — idempotent no-op

    const gst = computeGstBreakdown(invoice.amountPaise);
    const issuedAt = new Date();

    // Company identity from Settings → Company (falls back to the platform brand). Read
    // outside any request scope — this may run in the BullMQ worker (see service header).
    const company = await this.companyProfile.resolve(payload.tenantId);
    const issuer = company.supportEmail ? `${company.legalName} · ${company.supportEmail}` : company.legalName;

    const key = buildStorageKey({ namespace: "invoices", tenantId: payload.tenantId, uniqueId: payload.invoiceId });

    try {
      const pdf = await this.reportPdf.render({
        title: `Tax Invoice ${invoice.number}`,
        generatedAt: issuedAt.toISOString(),
        subtitle: `Issued by ${issuer} · ${invoice.studentName} · ${invoice.programTitle}`,
        headers: ["Description", "Amount"],
        rows: [
          ["Taxable amount", formatPaise(gst.taxableAmountPaise, invoice.currency)],
          [`CGST @ ${gst.taxRate / 2}%`, formatPaise(gst.cgstPaise, invoice.currency)],
          [`SGST @ ${gst.taxRate / 2}%`, formatPaise(gst.sgstPaise, invoice.currency)],
          ["Total (incl. GST)", formatPaise(gst.totalAmountPaise, invoice.currency)],
        ],
      });

      await this.storage.putObject({ key, body: Buffer.from(pdf.bytes), contentType: pdf.contentType });

      await this.repository.updateInvoiceStatus(payload.invoiceId, {
        status: "issued",
        storageKey: key,
        issuedAt,
        tax: gst,
      });
    } catch (err) {
      // FAIL-CLOSED for the storage_key contract (B8): never mark `issued` with a
      // dangling/absent PDF. Leave status=draft (unchanged) so the caller sees the
      // invoice is not yet ready and this job can be safely retried (BullMQ path) or
      // re-triggered.
      this.logger.error(
        `[SyncInvoiceGenAdapter] PDF render/upload failed invoiceId=${payload.invoiceId}: ${err instanceof Error ? err.message : "unknown error"}`,
      );
      throw err;
    }
  }
}

function formatPaise(paise: number, currency: string): string {
  return `${currency} ${(paise / 100).toFixed(2)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook processing port
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Razorpay webhook event payload (loosely typed — Razorpay controls the schema).
 * The 'event' field is the discriminant for known event types.
 */
export interface WebhookEventPayload {
  event?: string;
  payload?: {
    payment?: {
      entity?: {
        id?: string;
        order_id?: string;
        status?: string;
        method?: string;
        amount?: number;
      };
    };
    refund?: {
      entity?: {
        id?: string;
        payment_id?: string;
        status?: string;
        amount?: number;
      };
    };
  };
  [key: string]: unknown;
}

export interface WebhookProcessorPort {
  /**
   * Process a verified Razorpay webhook event. Idempotent by provider_payment_id unique.
   *
   * BullMQ migration: replace sync call with queue.add() and handle in a worker.
   * The HMAC verification already happened in the controller — this method trusts
   * the payload is authentic.
   */
  process(payload: WebhookEventPayload): Promise<void>;
}

export const WEBHOOK_PROCESSOR_PORT = Symbol("WEBHOOK_PROCESSOR_PORT");
