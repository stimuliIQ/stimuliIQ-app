// apps/api/src/modules/exports/providers/pdf/report-pdf.queue-driver-gate.spec.ts
//
// Verifies ReportPdfModule's QUEUE_DRIVER gate (docs/plans/phase-9-completion.md
// T18/R1), mirrors certificate-pdf.queue-driver-gate.spec.ts. `bullmq` is mocked,
// no real Redis connection is opened.

jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation((name: string) => ({ name, add: jest.fn() })),
  QueueEvents: jest.fn().mockImplementation((name: string) => ({ name })),
}));

import { Test } from "@nestjs/testing";
import { ReportPdfModule } from "./report-pdf.module";
import { REPORT_PDF_PORT } from "./report-pdf-port.interface";
import { SyncReportPdfAdapter } from "./sync-report-pdf.adapter";
import { BullMqReportPdfAdapter } from "./bullmq-report-pdf.adapter";
import { NoopReportPdfAdapter } from "./noop-report-pdf.adapter";
import { __resetEnvCacheForTests } from "../../../../config/env";

const BASE_ENV = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/stimuliiq",
  REDIS_URL: "redis://localhost:6379",
  JWT_PRIVATE_KEY_PATH: "./keys/jwt-private.pem",
  JWT_PUBLIC_KEY_PATH: "./keys/jwt-public.pem",
  COOKIE_SECRET: "a".repeat(32),
  CSRF_SECRET: "b".repeat(32),
};

async function bootWith(env: Record<string, string | undefined>): Promise<unknown> {
  const previous = { ...process.env };
  Object.assign(process.env, BASE_ENV, env);
  __resetEnvCacheForTests();
  try {
    const moduleRef = await Test.createTestingModule({ imports: [ReportPdfModule] }).compile();
    const port = moduleRef.get(REPORT_PDF_PORT);
    await moduleRef.close();
    return port;
  } finally {
    process.env = previous;
    __resetEnvCacheForTests();
  }
}

describe("ReportPdfModule QUEUE_DRIVER gate", () => {
  it("NODE_ENV=test always wins with NoopReportPdfAdapter regardless of QUEUE_DRIVER", async () => {
    const port = await bootWith({ NODE_ENV: "test", QUEUE_DRIVER: "bullmq" });
    expect(port).toBeInstanceOf(NoopReportPdfAdapter);
  });

  it("QUEUE_DRIVER=sync (non-test NODE_ENV) binds SyncReportPdfAdapter", async () => {
    const port = await bootWith({ NODE_ENV: "development", QUEUE_DRIVER: "sync" });
    expect(port).toBeInstanceOf(SyncReportPdfAdapter);
  });

  it("QUEUE_DRIVER=bullmq (non-test NODE_ENV) binds BullMqReportPdfAdapter", async () => {
    const port = await bootWith({ NODE_ENV: "development", QUEUE_DRIVER: "bullmq" });
    expect(port).toBeInstanceOf(BullMqReportPdfAdapter);
  });
});
