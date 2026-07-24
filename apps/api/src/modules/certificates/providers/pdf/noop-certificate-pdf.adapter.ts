// apps/api/src/modules/certificates/providers/pdf/noop-certificate-pdf.adapter.ts
//
// Test / sandbox double for CertificatePdfPort (docs/plans/phase-4.md task #4).
//
// Used in:
//   - Unit tests: inject directly via { provide: CERTIFICATE_PDF_PORT, useValue: noop }
//   - Integration tests: selected by CertificatePdfModule when NODE_ENV=test
//   - Local dev (no PDF rendering overhead or heavy deps needed)
//
// BEHAVIOUR:
//   - render() returns DETERMINISTIC stub bytes — the same fixed pseudo-PDF byte
//     sequence every time, regardless of input.  Tests that check "is a non-empty
//     PDF returned" should use this adapter; tests that need a real parseable PDF
//     must use SyncCertificatePdfAdapter (or skip in CI via a guard).
//   - The stub bytes begin with "%PDF-" to mimic a real PDF header, making them
//     distinguishable from a zero-byte or null response.
//   - No real @react-pdf/renderer call is made — this adapter is intentionally
//     lightweight so the full test suite runs offline and fast.
//
// DETERMINISM CONTRACT:
//   NoopCertificatePdfAdapter.STUB_BYTES is a frozen Buffer constant.
//   Multiple calls with different inputs return the SAME bytes.
//   This makes it safe to assert `result.bytes === NoopCertificatePdfAdapter.STUB_BYTES`
//   in tests (by reference) or to compare contents via Buffer.equals().
//
// SECURITY:
//   These stub bytes MUST NEVER be stored in a production StorageProvider bucket
//   or returned to a real user.  CertificatePdfModule selects the Noop only in
//   non-production environments (NODE_ENV !== 'production').

import { Injectable, Logger } from "@nestjs/common";
import type {
  CertificatePdfPort,
  CertificatePdfInput,
  CertificatePdfResult,
} from "./certificate-pdf-port.interface";

// ─────────────────────────────────────────────────────────────────────────────
// Stub bytes
//
// A minimal pseudo-PDF byte sequence:
//   %PDF-1.4\n%%Noop-CertificatePdfAdapter\n%%stimuliiq-test-stub\n%%EOF
//
// This is NOT a valid PDF (it has no object table or trailer), but it:
//   1. Starts with the "%PDF-" magic bytes (so content-type checks pass).
//   2. Is non-empty (so "bytes have content" assertions pass).
//   3. Is deterministic (the same Buffer every time).
//
// ─────────────────────────────────────────────────────────────────────────────

const STUB_PDF_CONTENT =
  "%PDF-1.4\n%%Noop-CertificatePdfAdapter\n%%stimuliiq-test-stub\n%%EOF\n";

@Injectable()
export class NoopCertificatePdfAdapter implements CertificatePdfPort {
  private readonly logger = new Logger(NoopCertificatePdfAdapter.name);

  /**
   * The deterministic stub bytes returned by this adapter.
   * Exposed as a static constant so tests can reference it without constructing
   * a provider instance.
   *
   *   import { NoopCertificatePdfAdapter } from './noop-certificate-pdf.adapter';
   *   expect(result.bytes).toEqual(NoopCertificatePdfAdapter.STUB_BYTES);
   */
  static readonly STUB_BYTES: Buffer = Buffer.from(STUB_PDF_CONTENT, "utf-8");

  constructor() {
    this.logger.warn(
      "[NoopCertificatePdfAdapter] Running with the no-op/test PDF adapter. " +
        "Rendered certificates are STUB BYTES and are not real PDFs. " +
        "Set NODE_ENV=production or bind SyncCertificatePdfAdapter for real output.",
    );
  }

  /**
   * Returns deterministic stub PDF bytes — no rendering, no I/O, no heavy deps.
   *
   * The same fixed Buffer is returned regardless of the input template or fields.
   * Call-site logs the holder name at debug level for test observability without
   * leaking certUid (the SECURITY contract from the port interface).
   */
  async render(input: CertificatePdfInput): Promise<CertificatePdfResult> {
    // Log at debug level — holder name is safe to log; certUid is NOT logged.
    this.logger.debug(
      `[NoopCertificatePdfAdapter] render() called for holderName="${input.fields.holderName}" ` +
        `program="${input.fields.programName}" (returning stub bytes, no real PDF generated)`,
    );

    return {
      bytes: NoopCertificatePdfAdapter.STUB_BYTES,
      contentType: "application/pdf",
    };
  }
}
