// apps/api/src/modules/commerce/receipt-gen.seam.spec.ts
//
// Unit tests for SyncReceiptGenAdapter (T27, docs/plans/phase-9-completion.md):
// skips non-existent/non-captured payments (safe no-op), renders + uploads to the
// deterministic `receipts/{tenantId}/{paymentId}.pdf` key for a captured payment.

import { SyncReceiptGenAdapter } from "./receipt-gen.seam";
import { CommerceRepository, type PaymentRow } from "./commerce.repository";
import type { StorageProvider } from "../storage/providers/storage/storage-provider.interface";
import type { ReportPdfPort } from "../exports/providers/pdf/report-pdf-port.interface";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<CommerceRepository> {
  return { findPaymentById: jest.fn() } as unknown as Mocked<CommerceRepository>;
}

function mockStorage(): Mocked<StorageProvider> {
  return {
    getSignedUploadUrl: jest.fn(),
    getSignedDownloadUrl: jest.fn(),
    putObject: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn(),
    head: jest.fn(),
  } as unknown as Mocked<StorageProvider>;
}

function mockReportPdf(): Mocked<ReportPdfPort> {
  return { render: jest.fn().mockResolvedValue({ bytes: Buffer.from("%PDF-"), contentType: "application/pdf" }) } as unknown as Mocked<ReportPdfPort>;
}

const CAPTURED_PAYMENT: PaymentRow = {
  id: "payment-1",
  tenantId: "tenant-1",
  orderId: "order-1",
  provider: "razorpay",
  providerPaymentId: "pay_test_1",
  providerOrderId: "order_test_1",
  amountPaise: 50_000,
  status: "captured",
  method: "upi",
  signatureVerified: true,
  isManual: false,
  paidAt: new Date("2026-01-05T00:00:00Z"),
  reference: null,
  notes: null,
  studentId: "student-1",
  studentName: "Asha Student",
  programId: "program-1",
  programTitle: "Full Stack Bootcamp",
  createdAt: new Date("2026-01-05T00:00:00Z"),
  updatedAt: new Date("2026-01-05T00:00:00Z"),
  deletedAt: null,
};

describe("SyncReceiptGenAdapter", () => {
  let repo: Mocked<CommerceRepository>;
  let storage: Mocked<StorageProvider>;
  let reportPdf: Mocked<ReportPdfPort>;
  let adapter: SyncReceiptGenAdapter;

  beforeEach(() => {
    repo = mockRepository();
    storage = mockStorage();
    reportPdf = mockReportPdf();
    adapter = new SyncReceiptGenAdapter(repo as unknown as CommerceRepository, storage as unknown as StorageProvider, reportPdf as unknown as ReportPdfPort);
  });

  it("is a safe no-op when the payment does not exist", async () => {
    repo.findPaymentById.mockResolvedValue(null);
    await adapter.enqueue({ paymentId: "payment-1", tenantId: "tenant-1" });
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it("skips rendering for a non-captured payment", async () => {
    repo.findPaymentById.mockResolvedValue({ ...CAPTURED_PAYMENT, status: "created" });
    await adapter.enqueue({ paymentId: "payment-1", tenantId: "tenant-1" });
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it("renders and uploads to the deterministic receipts/ key for a captured payment", async () => {
    repo.findPaymentById.mockResolvedValue(CAPTURED_PAYMENT);
    await adapter.enqueue({ paymentId: "payment-1", tenantId: "tenant-1" });
    expect(reportPdf.render).toHaveBeenCalled();
    expect(storage.putObject).toHaveBeenCalledWith(
      expect.objectContaining({ key: "receipts/tenant-1/payment-1.pdf", contentType: "application/pdf" }),
    );
  });
});
