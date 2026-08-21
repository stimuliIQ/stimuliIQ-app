// apps/api/src/modules/certificates/providers/pdf/bullmq-certificate-pdf.adapter.spec.ts
//
// Unit test for BullMqCertificatePdfAdapter (docs/plans/phase-9-completion.md T18/R1).
// `bullmq`'s `Queue`/`QueueEvents` classes are MOCKED, this suite asserts the RPC-style
// producer contract (enqueue, await job.waitUntilFinished(), decode base64 back to
// Buffer) WITHOUT opening any real Redis connection or rendering a real PDF.

const FAKE_PDF_BYTES = Buffer.from("fake-pdf-bytes");
const waitUntilFinishedMock = jest.fn().mockResolvedValue({
  bytesBase64: FAKE_PDF_BYTES.toString("base64"),
  contentType: "application/pdf",
});
const addMock = jest.fn().mockResolvedValue({ id: "job-1", waitUntilFinished: waitUntilFinishedMock });

jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation((name: string) => ({ name, add: addMock })),
  QueueEvents: jest.fn().mockImplementation((name: string) => ({ name })),
}));

jest.mock("../../../../config/env", () => ({
  validateEnv: () => ({ REDIS_URL: "redis://localhost:6379" }),
}));

import { Logger } from "@nestjs/common";
import { BullMqCertificatePdfAdapter } from "./bullmq-certificate-pdf.adapter";
import type { CertificatePdfInput } from "./certificate-pdf-port.interface";

describe("BullMqCertificatePdfAdapter", () => {
  beforeEach(() => {
    addMock.mockClear();
    waitUntilFinishedMock.mockClear();
  });

  it("enqueues a render job and returns the decoded PDF bytes from the worker's result", async () => {
    const adapter = new BullMqCertificatePdfAdapter();
    const input: CertificatePdfInput = {
      design: {},
      fields: {
        holderName: "Jane Doe",
        programName: "Full Stack",
        issuedAt: new Date("2026-01-01"),
        certUid: "SECRET-UID-NEVER-LOGGED",
        serial: "STMQ-2026-7F3K-9QX2",
        verifyUrl: "https://stimuliiq.com/verify/abc",
      },
    };

    const result = await adapter.render(input);

    expect(addMock).toHaveBeenCalledWith("render", input, expect.objectContaining({ attempts: expect.any(Number) }));
    expect(waitUntilFinishedMock).toHaveBeenCalledTimes(1);
    expect(result.contentType).toBe("application/pdf");
    expect(Buffer.compare(Buffer.from(result.bytes), FAKE_PDF_BYTES)).toBe(0);
  });

  it("never logs certUid (SECURITY port contract)", async () => {
    const logSpy = jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
    const adapter = new BullMqCertificatePdfAdapter();
    await adapter.render({
      design: {},
      fields: {
        holderName: "Jane Doe",
        programName: "Full Stack",
        issuedAt: new Date(),
        certUid: "TOP-SECRET-CERT-UID",
        serial: "STMQ-2026-7F3K-9QX2",
        verifyUrl: "https://stimuliiq.com/verify/abc",
      },
    });
    const logged = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).not.toContain("TOP-SECRET-CERT-UID");
    logSpy.mockRestore();
  });
});
