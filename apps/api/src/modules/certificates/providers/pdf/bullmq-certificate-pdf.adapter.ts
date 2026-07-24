// apps/api/src/modules/certificates/providers/pdf/bullmq-certificate-pdf.adapter.ts
//
// BullMQ-backed CertificatePdfPort adapter (docs/plans/phase-9-completion.md T18 / R1).
// Bound in place of SyncCertificatePdfAdapter when QUEUE_DRIVER=bullmq
// (certificate-pdf.module.ts).
//
// RPC-STYLE QUEUE USAGE: unlike the fire-and-forget adapters (notification dispatch,
// campaign send, invoice gen, webhook processors), CertificatesService's call sites
// need the RENDERED PDF BYTES back synchronously to upload via StorageProvider and set
// `certificates.storage_key` — so render() here ENQUEUES the job and AWAITS its result
// via `job.waitUntilFinished(queueEvents)` (a documented BullMQ pattern for RPC-style
// queue usage: https://docs.bullmq.io/patterns/process-step-jobs is the doc rendering-
// process analog; waitUntilFinished is the return-path). This moves the CPU-heavy
// @react-pdf/renderer work OFF the API process's event loop into the separate worker
// process (apps/api/src/worker.ts, CertificateGenProcessor) — the HTTP request still
// waits for completion (same latency contract as the sync adapter), but the actual
// rendering no longer blocks THIS process's ability to serve other requests.
//
// SERIALISATION: PDF bytes are not directly JSON-serialisable in a lossless way through
// BullMQ's job-data/return-value channel, so the worker returns { bytesBase64,
// contentType } and this adapter decodes the base64 back to a Buffer.
//
// TIMEOUT: RPC_JOB_TIMEOUT_MS (30s) — if the worker doesn't finish in time,
// waitUntilFinished rejects and CertificatesService's existing catch-and-503 behaviour
// (same as the sync adapter's render() throwing) applies unchanged.

import { Injectable, Logger } from "@nestjs/common";
import { Queue, QueueEvents } from "bullmq";
import { getBullMqConnectionOptions } from "../../../../queues/queue-connection";
import { QUEUE_NAMES } from "../../../../queues/queue-names";
import { RPC_JOB_OPTIONS, RPC_JOB_TIMEOUT_MS } from "../../../../queues/job-options";
import type { CertificatePdfPort, CertificatePdfInput, CertificatePdfResult } from "./certificate-pdf-port.interface";

interface CertificateGenJobResult {
  bytesBase64: string;
  contentType: "application/pdf";
}

@Injectable()
export class BullMqCertificatePdfAdapter implements CertificatePdfPort {
  private readonly logger = new Logger(BullMqCertificatePdfAdapter.name);
  private readonly queue: Queue<CertificatePdfInput, CertificateGenJobResult>;
  private readonly queueEvents: QueueEvents;

  constructor() {
    const connection = getBullMqConnectionOptions();
    this.queue = new Queue<CertificatePdfInput, CertificateGenJobResult>(QUEUE_NAMES.CERTIFICATE_GEN, {
      connection,
    });
    this.queueEvents = new QueueEvents(QUEUE_NAMES.CERTIFICATE_GEN, { connection });
  }

  async render(input: CertificatePdfInput): Promise<CertificatePdfResult> {
    // SECURITY (port contract): never log input.fields.certUid.
    this.logger.debug(`[BullMqCertificatePdf] enqueue render holderName="${input.fields.holderName}"`);

    const job = await this.queue.add("render", input, RPC_JOB_OPTIONS);
    const result = await job.waitUntilFinished(this.queueEvents, RPC_JOB_TIMEOUT_MS);

    return {
      bytes: Buffer.from(result.bytesBase64, "base64"),
      contentType: result.contentType,
    };
  }
}
