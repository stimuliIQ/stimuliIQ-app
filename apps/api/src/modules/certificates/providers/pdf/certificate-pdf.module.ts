// apps/api/src/modules/certificates/providers/pdf/certificate-pdf.module.ts
//
// Binds CERTIFICATE_PDF_PORT → the adapter selected for the current environment,
// and exports the token for CertificatesModule (task #8) to consume.
//
// Selection:
//   NODE_ENV=test              → NoopCertificatePdfAdapter (deterministic stub bytes;
//                                keeps the test suite offline + fast, no real rendering)
//   QUEUE_DRIVER=bullmq (non-test) → BullMqCertificatePdfAdapter (docs/plans/
//     phase-9-completion.md T18/R1 — enqueues + awaits the render job via
//     job.waitUntilFinished(), moving @react-pdf/renderer's CPU work into the
//     separate worker process, apps/api/src/worker.ts)
//   otherwise (dev/staging/prod, QUEUE_DRIVER=sync) → SyncCertificatePdfAdapter
//     (@react-pdf/renderer, inline PDF generation)
//
// Bound via `useFactory` (ADR-0023 / DEFECT-1): the adapters may carry optional
// constructor params whose emitted design-type is `Object`; a `useClass` binding
// would make Nest try to inject a provider of type `Object` and crash AppModule boot.
// The factory `new`s the class directly, bypassing DI reflection.

import { Module, Logger } from "@nestjs/common";
import { validateEnv } from "../../../../config/env";
import { CERTIFICATE_PDF_PORT, type CertificatePdfPort } from "./certificate-pdf-port.interface";
import { NoopCertificatePdfAdapter } from "./noop-certificate-pdf.adapter";
import { SyncCertificatePdfAdapter } from "./sync-certificate-pdf.adapter";
import { BullMqCertificatePdfAdapter } from "./bullmq-certificate-pdf.adapter";

const bootLogger = new Logger("CertificatePdfModule");

function createCertificatePdfAdapter(): CertificatePdfPort {
  const env = validateEnv();

  if (env.NODE_ENV === "test") {
    bootLogger.warn(
      "[CertificatePdfModule] NODE_ENV=test. Binding NoopCertificatePdfAdapter (stub bytes, no real PDF).",
    );
    return new NoopCertificatePdfAdapter();
  }

  if (env.QUEUE_DRIVER === "bullmq") {
    bootLogger.log(
      "[CertificatePdfModule] QUEUE_DRIVER=bullmq. Binding BullMqCertificatePdfAdapter (renders in worker process).",
    );
    return new BullMqCertificatePdfAdapter();
  }

  bootLogger.log(
    "[CertificatePdfModule] binding SyncCertificatePdfAdapter (@react-pdf/renderer, inline PDF generation).",
  );
  return new SyncCertificatePdfAdapter();
}

@Module({
  providers: [
    {
      provide: CERTIFICATE_PDF_PORT,
      useFactory: createCertificatePdfAdapter,
    },
  ],
  // Export only the token — consumers inject CERTIFICATE_PDF_PORT, never the concrete class.
  exports: [CERTIFICATE_PDF_PORT],
})
export class CertificatePdfModule {}
