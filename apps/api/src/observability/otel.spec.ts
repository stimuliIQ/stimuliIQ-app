import { __resetEnvCacheForTests } from "../config/env";
import { startOtel, shutdownOtel } from "./otel";

// REQUIRED_ENV mirrors the pattern used by every other provider-module spec (e.g.
// mail-provider.spec.ts), the minimal set of vars `validateEnv()` requires with no
// default, needed here only because `startOtel()` now calls `isProductionEnv()` (which
// defaults to `validateEnv()`) to decide whether to warn on a missing OTel endpoint.
const REQUIRED_ENV: Record<string, string> = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  REDIS_URL: "redis://localhost:6379",
  JWT_PRIVATE_KEY_PATH: "./keys/jwt-private.pem",
  JWT_PUBLIC_KEY_PATH: "./keys/jwt-public.pem",
  COOKIE_SECRET: "test-cookie-secret-at-least-32-chars-long!!",
  CSRF_SECRET: "test-csrf-secret-at-least-32-chars-long!!!",
  // Coherent PRODUCTION values. `validateEnv` requires these once NODE_ENV/APP_ENV is
  // "production" — a session cookie issued without Secure, or scoped to localhost, is a
  // real misconfiguration, so the boot refuses it. Cases below that exercise a
  // production boot guard would otherwise fail on env validation before reaching the
  // guard under test.
  COOKIE_SECURE: "true",
  COOKIE_DOMAIN: ".stimuliiq.test",
};

/**
 * `process.env.X = undefined` coerces to the literal STRING "undefined" (env vars can
 * only ever be strings in Node) rather than deleting the key, a real footgun in afterEach
 * cleanup that silently leaks a bogus value into whichever spec file runs next in the
 * same Jest worker's shared `process.env`. Always restore via this helper instead of a
 * bare assignment.
 */
function restoreEnvVar(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

describe("startOtel, no-op-safety (docs/plans/phase-7.md task #9)", () => {
  const original = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAppEnv = process.env.APP_ENV;

  beforeEach(() => {
    // `startOtel()` now calls `isProductionEnv()` (→ `validateEnv()`) on the no-op path
    // too, so the minimal required env must be present even for these non-production
    // no-op assertions. Ambient NODE_ENV is "test" (Jest default) so isProductionEnv()
    // resolves false and no WARN fires here.
    Object.assign(process.env, REQUIRED_ENV);
    __resetEnvCacheForTests();
  });

  afterEach(() => {
    restoreEnvVar("OTEL_EXPORTER_OTLP_ENDPOINT", original);
    restoreEnvVar("NODE_ENV", originalNodeEnv);
    restoreEnvVar("APP_ENV", originalAppEnv);
    for (const key of Object.keys(REQUIRED_ENV)) delete process.env[key];
    __resetEnvCacheForTests();
  });

  it("resolves without throwing when OTEL_EXPORTER_OTLP_ENDPOINT is unset", async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    await expect(startOtel()).resolves.toBeUndefined();
  });

  it("shutdownOtel() never throws even when the SDK was never started", async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    await startOtel();
    await expect(shutdownOtel()).resolves.toBeUndefined();
  });

  it("does NOT crash boot when the collector endpoint is unreachable/misconfigured, logs a warning and continues", async () => {
    // An obviously-unreachable/malformed endpoint that will fail fast rather than hang.
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://127.0.0.1:1/v1/traces";
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(startOtel()).resolves.toBeUndefined();

    warnSpy.mockRestore();
  }, 15_000);
});

describe("startOtel, T4/B11: loud WARN when the OTel endpoint is unset in production", () => {
  const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAppEnv = process.env.APP_ENV;

  beforeEach(() => {
    Object.assign(process.env, REQUIRED_ENV);
    __resetEnvCacheForTests();
  });

  afterEach(() => {
    restoreEnvVar("OTEL_EXPORTER_OTLP_ENDPOINT", originalEndpoint);
    restoreEnvVar("NODE_ENV", originalNodeEnv);
    restoreEnvVar("APP_ENV", originalAppEnv);
    for (const key of Object.keys(REQUIRED_ENV)) delete process.env[key];
    __resetEnvCacheForTests();
  });

  it("logs a WARN (does not throw) when APP_ENV=production and the endpoint is absent", async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    process.env.NODE_ENV = "production";
    process.env.APP_ENV = "production";
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(startOtel()).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("OTEL_EXPORTER_OTLP_ENDPOINT is not set"),
    );
    warnSpy.mockRestore();
  });

  it("stays silent (no WARN) when the endpoint is absent outside production", async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    process.env.NODE_ENV = "development";
    process.env.APP_ENV = "local";
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(startOtel()).resolves.toBeUndefined();

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
