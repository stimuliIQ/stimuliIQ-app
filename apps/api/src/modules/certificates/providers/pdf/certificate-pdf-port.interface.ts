// apps/api/src/modules/certificates/providers/pdf/certificate-pdf-port.interface.ts
//
// CertificatePdfPort — the internal seam that isolates the PDF-generation library
// from the certificate feature module (docs/04-trd-architecture.md §2.11,
// docs/plans/phase-4.md §3 "New provider interfaces", task #4).
//
// WHY A PORT (not a full vendor provider)?
//   PDF generation is not a swappable *vendor* adapter (we own the output format),
//   but the library choice IS swappable (plan §6 Risk #4). Wrapping it behind a port
//   lets us:
//     1. Swap @react-pdf/renderer → puppeteer/pdfkit/pdf-lib without changing the
//        certificate feature module.
//     2. Inject NoopCertificatePdfAdapter in tests/CI without heavy rendering.
//     3. Defer the BullMQ `certificate-gen` worker behind the same port (ADR-0020
//        pattern) — the port stays, only the adapter bound to it changes.
//
// DESIGN FIELD SHAPES:
//   `design` matches the `certificate_templates.design` JSON column in the DB (prisma
//   schema). It carries the visual layout directives for the renderer.
//
//   `fields` matches the `certificate_templates.fields` JSON column — the list of
//   dynamic field keys the template declares.  The renderer merges `design` + the
//   resolved field values from `CertificateRenderFields` to produce the final PDF.
//
//   Both shapes are intentionally kept as loose `Record<string, unknown>` at the port
//   boundary (the design/fields JSON is opaque to the feature module), with a separate
//   `CertificateRenderFields` typed struct for the typed data the adapter reads.
//
// SECURITY CONTRACT:
//   1. The adapter MUST NOT log or embed `certUid` or any signing secret in the PDF
//      metadata or in any log line emitted during rendering.
//   2. `verifyUrl` is the ONLY public-facing identifier embedded in the PDF — it is
//      derived from `certUid` by the caller before invocation.
//   3. The returned `bytes` are raw PDF bytes — the caller (CertificatesService)
//      stores them via StorageProvider and returns a signed download URL to the client.
//      Raw bytes NEVER leave the server directly.
//
// DI TOKEN:
//   CERTIFICATE_PDF_PORT — import from this file to inject in feature modules.
//   CertificatePdfModule exports only this token; never export the concrete adapter.
//
// BULLMQ SEAM (updated — docs/plans/phase-9-completion.md T18/R1, ADR-0056): BullMQ IS
// installed and wired. CERTIFICATE_PDF_PORT is bound to SyncCertificatePdfAdapter
// (QUEUE_DRIVER=sync, default, or NODE_ENV=test → NoopCertificatePdfAdapter) or
// BullMqCertificatePdfAdapter (QUEUE_DRIVER=bullmq) via a useFactory gate in
// certificate-pdf.module.ts. Zero changes to CertificatesService either way.
//
// BullMqCertificatePdfAdapter uses an RPC-style queue pattern: render() enqueues the
// job and AWAITS the result via job.waitUntilFinished(queueEvents) — CertificatesService
// still gets real PDF bytes back synchronously to upload via StorageProvider, but the
// actual @react-pdf/renderer CPU work runs in the separate worker process
// (apps/api/src/worker.ts), not on the API process's event loop. See
// bullmq-certificate-pdf.adapter.ts for the full rationale.

// ─────────────────────────────────────────────────────────────────────────────
// Design + fields shapes (mirror the DB JSON columns)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The award a template issues. See `CertificateDesign.certificateKind`.
 *
 * Kept as a string union rather than a Prisma enum: it is a RENDERING directive read out
 * of the template's `design` JSON, not a queryable column, so adding a third kind must
 * not require a migration.
 */
export type CertificateKind = "internship" | "training" | "course";

/**
 * The visual layout configuration stored in `certificate_templates.design`.
 *
 * Consumed by the adapter to control layout (orientation, colours, fonts,
 * border, logo URL, background URL, etc.).  Fields marked optional are
 * gracefully defaulted by the adapter when absent.
 *
 * This is the shape the SyncCertificatePdfAdapter reads from `design`.
 * The seeded templates in prisma/seed.ts must conform to this interface.
 */
export interface CertificateDesign {
  /** Page orientation. Default: "landscape". */
  orientation?: "landscape" | "portrait";

  /**
   * WHICH of the two awards this template issues — the only difference between the two
   * approved artworks in `docs/sample certificate/`.
   *
   *   "internship" → ribbon reads INTERNSHIP CERTIFICATE; body says "...COMPLETED
   *                  HIS/HER INTERNSHIP IN <programme>... THROUGHOUT THE INTERNSHIP PERIOD."
   *   "training"   → the same sentence with TRAINING throughout.
   *   "course"     → the neutral PROGRAM wording (the pre-existing default, kept so
   *                  templates seeded before this field existed render unchanged).
   *
   * A student can be awarded both; each award is a separate certificate issued against
   * the matching template, so the kind rides on the template rather than on the
   * certificate row. Unknown/absent values fall back to "course".
   */
  certificateKind?: CertificateKind;

  /** Border colour as a CSS hex string (e.g. "#b8860b"). Default: "#b8860b" (gold). */
  borderColor?: string;

  /** Border width in pt. Default: 8. */
  borderWidth?: number;

  /** Primary accent colour (used for headings). Default: "#1a1a2e". */
  accentColor?: string;

  /** Secondary colour (used for body text). Default: "#333333". */
  textColor?: string;

  /** Background colour of the certificate page. Default: "#fffdf7". */
  backgroundColor?: string;

  /** Organisation / issuer name shown at the top of the certificate. */
  orgName?: string;

  /**
   * URL of the organisation logo (fetched at render time by the adapter).
   * The adapter uses Image from @react-pdf/renderer — must be an accessible
   * public URL at render time (use a CDN-hosted logo for production).
   * Omit to render without a logo.
   */
  logoUrl?: string;

  /**
   * URL of the background watermark / crest image (optional, low opacity).
   * Omit to render without a background image.
   */
  backgroundImageUrl?: string;

  /**
   * Custom tagline below the org name (e.g. "Empowering India's Next Generation").
   */
  tagline?: string;

  /**
   * Custom footer lines (e.g. ["www.stimuliiq.com", "ISO 9001:2015 Certified"]).
   */
  footerLines?: string[];

  // ── Private print assets ────────────────────────────────────────────────────
  //
  // These name a file inside the API's PRIVATE `assets/certificate/` directory —
  // they are NOT URLs, and nothing here is ever served over HTTP. That is the point
  // for `signatureFileName`: a scanned signature reachable by URL could be lifted and
  // pasted onto a forgery, so the image is read from disk inside the API process and
  // embedded straight into the PDF bytes.
  //
  // UNTRUSTED INPUT: `design` is a CRM-editable JSON column, so every name below is
  // sanitised by `safeAssetName()` (basename only, strict charset, image extension)
  // before it reaches the filesystem — see certificate-assets.ts. Omit any of them to
  // take the default file name; a file that is absent is simply not drawn.

  /** Authorised signature image. Default: `ceo-signature.png`. */
  signatureFileName?: string;

  /** Issuer wordmark printed at the head of the certificate. Default: `logo.png`. */
  logoFileName?: string;

  /** Optional accreditation marks shown beside the Certificate ID. */
  isoBadgeFileName?: string;
  msmeBadgeFileName?: string;

  /**
   * Authorised signatory printed under the signature line, e.g. "Chandra Shekar" /
   * "Founder". Issuer-level, so it belongs on the template rather than being repeated on
   * every certificate — but `CertificateRenderFields.signatoryName` still wins when a
   * caller supplies one, which is what lets a single template cover a co-signed award.
   */
  signatoryName?: string;
  signatoryDesignation?: string;
}

/**
 * A single field descriptor from `certificate_templates.fields`.
 *
 * `key` matches a property on CertificateRenderFields; `label` is the human
 * label shown above or beside the field on the certificate face.
 */
export interface CertificateFieldDescriptor {
  key: string;
  label: string;
  /** Whether to emphasise this field (e.g. render the holder name in larger type). */
  emphasis?: boolean;
}

/**
 * The resolved, typed data values merged into the template at render time.
 *
 * These are the ONLY values the adapter may embed in the rendered PDF.
 * The adapter MUST NOT read any other source (e.g. env vars, DB, external HTTP)
 * during a `render()` call — all data is supplied by the caller.
 *
 * SECURITY: `certUid` is embedded in the PDF only through `verifyUrl` (which the
 * caller constructs as e.g. `https://stimuliiq.com/verify/<certUid>`).
 * The raw `certUid` value itself MUST NOT be logged during rendering.
 */
export interface CertificateRenderFields {
  /** Full name of the certificate holder. */
  holderName: string;

  /** Full name of the program / course. */
  programName: string;

  /**
   * Certificate issuance date.  Formatted as a human-readable string by the
   * adapter (e.g. "12 June 2026").  Callers should pass a Date or ISO string;
   * the adapter formats it for display.
   */
  issuedAt: string | Date;

  /**
   * The signed cert_uid value.  Used to construct the QR code / verify URL text.
   * SECURITY: never embed this in a log line inside the adapter.
   */
  certUid: string;

  /**
   * The SHORT, human-typeable certificate serial (STMQ-YYYY-XXXX-XXXX).  Printed on the
   * certificate face so a reader can type it into /verify (the long verifyUrl is for the
   * QR/link).  Non-secret and safe to render; unlike certUid it need not be hidden, but
   * there is no reason to log it either.
   */
  serial: string;

  /**
   * The full public verification URL (e.g. "https://stimuliiq.com/verify/<certUid>").
   * This is the ONLY form of `certUid` that appears in the rendered PDF body.
   */
  verifyUrl: string;

  /**
   * Name of the authorised signatory (e.g. CEO or Academic Director).
   * Rendered in the signature area of the certificate.
   */
  signatoryName?: string;

  /**
   * Designation of the signatory (e.g. "Director, stimuliIQ").
   */
  signatoryDesignation?: string;

  /**
   * Any additional free-form fields declared in `certificate_templates.fields`
   * but not mapped to a named property above.
   */
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Port input / output
// ─────────────────────────────────────────────────────────────────────────────

export interface CertificatePdfInput {
  /**
   * The visual layout configuration from `certificate_templates.design`.
   * The adapter MUST handle missing / partially-specified designs gracefully
   * by applying sensible defaults.
   */
  design: CertificateDesign;

  /**
   * The field descriptors from `certificate_templates.fields`.
   * Used by the adapter to understand which fields the template author declared.
   */
  fieldDescriptors?: CertificateFieldDescriptor[];

  /**
   * The resolved, typed field values to embed in the PDF.
   */
  fields: CertificateRenderFields;
}

export interface CertificatePdfResult {
  /**
   * The raw PDF file bytes.
   *
   * Real adapter: output of @react-pdf/renderer's `renderToBuffer()` (a real PDF).
   * Noop adapter:  a deterministic, minimal, valid-enough byte sequence (fixed stub).
   *
   * SECURITY: these bytes are never returned to the client directly.  The caller
   * (CertificatesService) uploads them to StorageProvider and mints a signed GET URL.
   */
  bytes: Buffer | Uint8Array;

  /**
   * Always "application/pdf" — typed explicitly so the StorageProvider upload
   * can set the correct Content-Type header.
   */
  contentType: "application/pdf";
}

// ─────────────────────────────────────────────────────────────────────────────
// Port interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Internal seam for certificate PDF rendering.
 *
 * Feature modules (CertificatesService) inject this via CERTIFICATE_PDF_PORT.
 * The concrete implementation is selected in CertificatePdfModule via useFactory.
 *
 * Implementations:
 *   SyncCertificatePdfAdapter  — renders inline with @react-pdf/renderer.
 *   NoopCertificatePdfAdapter  — returns deterministic stub bytes (tests/CI).
 *
 * The BullMQ `certificate-gen` worker (deferred — plan LOCK-4) will be bound
 * behind the same port when BullMQ is installed (ADR-0020 pattern).
 */
export interface CertificatePdfPort {
  /**
   * Renders a certificate PDF from the given design + fields.
   *
   * @param input  Template design, field descriptors, and resolved field values.
   * @returns      Raw PDF bytes + "application/pdf" content-type.
   *
   * @throws {Error}  If rendering fails (adapter-specific).  The caller
   *                  (CertificatesService) surfaces this as HTTP 500.
   *
   * SECURITY contract:
   *   - Do NOT log `input.fields.certUid` or any signing secret.
   *   - Do NOT make external HTTP calls beyond fetching `design.logoUrl` or
   *     `design.backgroundImageUrl` (if provided).
   *   - Do NOT read `process.env` — all configuration comes via the input.
   */
  render(input: CertificatePdfInput): Promise<CertificatePdfResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// DI token
// ─────────────────────────────────────────────────────────────────────────────

/**
 * NestJS DI injection token for the CertificatePdfPort.
 *
 * Feature modules import and inject this token — NEVER import the concrete
 * adapter class from a feature module.
 *
 * Usage in certificates.service.ts:
 *
 *   import { Inject } from '@nestjs/common';
 *   import { CERTIFICATE_PDF_PORT, CertificatePdfPort }
 *     from '../providers/pdf/certificate-pdf-port.interface';
 *
 *   @Injectable()
 *   export class CertificatesService {
 *     constructor(
 *       @Inject(CERTIFICATE_PDF_PORT) private readonly pdfPort: CertificatePdfPort,
 *     ) {}
 *   }
 *
 * Test wiring (unit tests — bind the Noop directly):
 *
 *   import { NoopCertificatePdfAdapter }
 *     from '../providers/pdf/noop-certificate-pdf.adapter';
 *
 *   const noop = new NoopCertificatePdfAdapter();
 *   const module = await Test.createTestingModule({
 *     providers: [
 *       CertificatesService,
 *       { provide: CERTIFICATE_PDF_PORT, useValue: noop },
 *     ],
 *   }).compile();
 */
export const CERTIFICATE_PDF_PORT = Symbol("CERTIFICATE_PDF_PORT");
