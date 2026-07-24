// apps/api/src/modules/commerce/invoice-gen.seam.spec.ts
//
// Unit tests for SyncInvoiceGenAdapter (T27, docs/plans/phase-9-completion.md, B8 fix):
// real PDF render + StorageProvider upload + storage_key set (never null on success),
// GST breakdown stored on `tax`, idempotent no-op when already issued, and fail-closed
// (status stays draft, error re-thrown) when render/upload fails.

import { SyncInvoiceGenAdapter } from "./invoice-gen.seam";
import { CommerceRepository, type InvoiceRow } from "./commerce.repository";
import type { StorageProvider } from "../storage/providers/storage/storage-provider.interface";
import type { ReportPdfPort } from "../exports/providers/pdf/report-pdf-port.interface";
import type { CompanyProfileService, CompanyProfile } from "../platform/company-profile.service";

const COMPANY_PROFILE: CompanyProfile = {
  legalName: "Acme Learning Pvt. Ltd.",
  supportEmail: "help@acme.test",
  supportPhone: null,
  websiteUrl: null,
  address: null,
};

function mockCompanyProfile(): Mocked<CompanyProfileService> {
  return { resolve: jest.fn().mockResolvedValue(COMPANY_PROFILE) } as unknown as Mocked<CompanyProfileService>;
}

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<CommerceRepository> {
  return {
    findInvoiceById: jest.fn(),
    updateInvoiceStatus: jest.fn(),
  } as unknown as Mocked<CommerceRepository>;
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

const DRAFT_INVOICE: InvoiceRow = {
  id: "invoice-1",
  tenantId: "tenant-1",
  orderId: "order-1",
  number: "INV-2026-0001",
  storageKey: null,
  tax: null,
  status: "draft",
  issuedAt: null,
  studentId: "student-1",
  studentName: "Asha Student",
  programTitle: "Full Stack Bootcamp",
  amountPaise: 118_000,
  currency: "INR",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  deletedAt: null,
};

describe("SyncInvoiceGenAdapter", () => {
  let repo: Mocked<CommerceRepository>;
  let storage: Mocked<StorageProvider>;
  let reportPdf: Mocked<ReportPdfPort>;
  let companyProfile: Mocked<CompanyProfileService>;
  let adapter: SyncInvoiceGenAdapter;

  beforeEach(() => {
    repo = mockRepository();
    storage = mockStorage();
    reportPdf = mockReportPdf();
    companyProfile = mockCompanyProfile();
    adapter = new SyncInvoiceGenAdapter(
      repo as unknown as CommerceRepository,
      storage as unknown as StorageProvider,
      reportPdf as unknown as ReportPdfPort,
      companyProfile as unknown as CompanyProfileService,
    );
  });

  it("is a no-op if the invoice row is missing (voided/tenant mismatch)", async () => {
    repo.findInvoiceById.mockResolvedValue(null);
    await adapter.enqueue({ invoiceId: "invoice-1", orderId: "order-1", tenantId: "tenant-1" });
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it("is idempotent — already-issued invoices are skipped", async () => {
    repo.findInvoiceById.mockResolvedValue({ ...DRAFT_INVOICE, status: "issued" });
    await adapter.enqueue({ invoiceId: "invoice-1", orderId: "order-1", tenantId: "tenant-1" });
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(repo.updateInvoiceStatus).not.toHaveBeenCalled();
  });

  it("renders a real PDF, uploads it, and sets a REAL (non-null) storage_key + GST tax (B8 fix)", async () => {
    repo.findInvoiceById.mockResolvedValue(DRAFT_INVOICE);

    await adapter.enqueue({ invoiceId: "invoice-1", orderId: "order-1", tenantId: "tenant-1" });

    expect(reportPdf.render).toHaveBeenCalled();
    // The configured company identity (Settings → Company) is stamped on the invoice.
    expect(companyProfile.resolve).toHaveBeenCalledWith("tenant-1");
    expect(reportPdf.render).toHaveBeenCalledWith(
      expect.objectContaining({ subtitle: expect.stringContaining("Acme Learning Pvt. Ltd.") }),
    );
    expect(storage.putObject).toHaveBeenCalledWith(
      expect.objectContaining({ key: "invoices/tenant-1/invoice-1.pdf", contentType: "application/pdf" }),
    );
    expect(repo.updateInvoiceStatus).toHaveBeenCalledWith(
      "invoice-1",
      expect.objectContaining({
        status: "issued",
        storageKey: "invoices/tenant-1/invoice-1.pdf",
        tax: expect.objectContaining({ taxRate: 18, totalAmountPaise: 118_000 }),
      }),
    );
  });

  it("fails closed — leaves the invoice draft (never marks issued) when the PDF/upload step throws", async () => {
    repo.findInvoiceById.mockResolvedValue(DRAFT_INVOICE);
    storage.putObject.mockRejectedValue(new Error("S3 unavailable"));

    await expect(adapter.enqueue({ invoiceId: "invoice-1", orderId: "order-1", tenantId: "tenant-1" })).rejects.toThrow("S3 unavailable");
    expect(repo.updateInvoiceStatus).not.toHaveBeenCalled();
  });
});
