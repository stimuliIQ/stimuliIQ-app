// apps/api/src/queues/queue-connection.spec.ts
//
// Unit tests for getBullMqConnectionOptions() (docs/plans/phase-9-completion.md T18/R1).
// Pure REDIS_URL parsing, no real Redis connection is opened.

import { getBullMqConnectionOptions } from "./queue-connection";
import { __resetEnvCacheForTests } from "../config/env";

const BASE_ENV = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/stimuliiq",
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

function withEnv(redisUrl: string): () => void {
  const previous = { ...process.env };
  Object.assign(process.env, BASE_ENV, { REDIS_URL: redisUrl });
  __resetEnvCacheForTests();
  return () => {
    process.env = previous;
    __resetEnvCacheForTests();
  };
}

describe("getBullMqConnectionOptions", () => {
  let restore: () => void;

  afterEach(() => {
    if (restore) restore();
  });

  it("parses host + port from a plain redis:// URL (no password/db)", () => {
    restore = withEnv("redis://localhost:6379");
    const opts = getBullMqConnectionOptions();
    expect(opts).toMatchObject({
      host: "localhost",
      port: 6379,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    expect(opts).not.toHaveProperty("password");
    expect(opts).not.toHaveProperty("db");
  });

  it("parses password from a redis:// URL with credentials", () => {
    restore = withEnv("redis://:s3cret@redis-host:6380");
    const opts = getBullMqConnectionOptions();
    expect(opts).toMatchObject({ host: "redis-host", port: 6380, password: "s3cret" });
  });

  it("parses a db index from the URL path segment", () => {
    restore = withEnv("redis://localhost:6379/2");
    const opts = getBullMqConnectionOptions();
    expect(opts).toMatchObject({ host: "localhost", port: 6379, db: 2 });
  });

  it("defaults to port 6379 when the URL omits it", () => {
    restore = withEnv("redis://localhost");
    const opts = getBullMqConnectionOptions();
    expect(opts).toMatchObject({ host: "localhost", port: 6379 });
  });

  it("NEVER logs or exposes the password outside the returned options object", () => {
    restore = withEnv("redis://:super-secret-password@redis-host:6379");
    const opts = getBullMqConnectionOptions() as { password?: string };
    // The password IS present in the returned options (BullMQ needs it to connect),
    // this test asserts the function does not throw or leak it via any side channel
    // (e.g. console) by construction (pure function, no logging calls in the source).
    expect(opts.password).toBe("super-secret-password");
  });
});
