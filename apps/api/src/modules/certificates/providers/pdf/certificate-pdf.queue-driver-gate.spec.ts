// apps/api/src/modules/certificates/providers/pdf/certificate-pdf.queue-driver-gate.spec.ts
//
// Verifies CertificatePdfModule's QUEUE_DRIVER gate (docs/plans/phase-9-completion.md
// T18/R1): QUEUE_DRIVER=bullmq binds BullMqCertificatePdfAdapter instead of
// SyncCertificatePdfAdapter (outside NODE_ENV=test, which always wins with Noop).
// `bullmq` is mocked, no real Redis connection is opened.

jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation((name: string) => ({ name, add: jest.fn() })),
  QueueEvents: jest.fn().mockImplementation((name: string) => ({ name })),
}));

import { Test } from "@nestjs/testing";
import { CertificatePdfModule } from "./certificate-pdf.module";
import { CERTIFICATE_PDF_PORT } from "./certificate-pdf-port.interface";
import { SyncCertificatePdfAdapter } from "./sync-certificate-pdf.adapter";
import { BullMqCertificatePdfAdapter } from "./bullmq-certificate-pdf.adapter";
import { NoopCertificatePdfAdapter } from "./noop-certificate-pdf.adapter";
import { __resetEnvCacheForTests } from "../../../../config/env";

const BASE_ENV = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/stimuliiq",
  REDIS_URL: "redis://localhost:6379",
  JWT_PRIVATE_KEY_PATH: "./keys/jwt-private.pem",
  JWT_PUBLIC_KEY_PATH: "./keys/jwt-public.pem",
  COOKIE_SECRET: "a".repeat(32),
  CSRF_SECRET: "b".repeat(32),
  // Coherent PRODUCTION values. `validateEnv` requires these once NODE_ENV/APP_ENV is
  // "production" (a session cookie without Secure, or scoped to localhost, is a real
  // misconfiguration) — and every case below that exercises a production boot guard
  // sets exactly that. Without them the spec would fail on env validation before ever
  // reaching the guard it is testing.
  COOKIE_SECURE: "true",
  COOKIE_DOMAIN: ".stimuliiq.test",
};

async function bootWith(env: Record<string, string | undefined>): Promise<unknown> {
  const previous = { ...process.env };
  Object.assign(process.env, BASE_ENV, env);
  __resetEnvCacheForTests();
  try {
    const moduleRef = await Test.createTestingModule({ imports: [CertificatePdfModule] }).compile();
    const port = moduleRef.get(CERTIFICATE_PDF_PORT);
    await moduleRef.close();
    return port;
  } finally {
    process.env = previous;
    __resetEnvCacheForTests();
  }
}

describe("CertificatePdfModule QUEUE_DRIVER gate", () => {
  it("NODE_ENV=test always wins with NoopCertificatePdfAdapter regardless of QUEUE_DRIVER", async () => {
    const port = await bootWith({ NODE_ENV: "test", QUEUE_DRIVER: "bullmq" });
    expect(port).toBeInstanceOf(NoopCertificatePdfAdapter);
  });

  it("QUEUE_DRIVER=sync (non-test NODE_ENV) binds SyncCertificatePdfAdapter", async () => {
    const port = await bootWith({ NODE_ENV: "development", QUEUE_DRIVER: "sync" });
    expect(port).toBeInstanceOf(SyncCertificatePdfAdapter);
  });

  it("QUEUE_DRIVER=bullmq (non-test NODE_ENV) binds BullMqCertificatePdfAdapter", async () => {
    const port = await bootWith({ NODE_ENV: "development", QUEUE_DRIVER: "bullmq" });
    expect(port).toBeInstanceOf(BullMqCertificatePdfAdapter);
  });
});
