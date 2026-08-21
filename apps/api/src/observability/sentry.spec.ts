import type { ErrorEvent } from "@sentry/node";
import { __resetEnvCacheForTests } from "../config/env";
import {
  scrubSentryEvent,
  initSentry,
  isSentryInitialized,
  captureException,
  __resetSentryForTests,
} from "./sentry";

// REQUIRED_ENV mirrors the pattern used by every other provider-module spec (e.g.
// mail-provider.spec.ts), the minimal set of vars `validateEnv()` requires with no
// default, needed here only because `initSentry()` now calls `isProductionEnv()` (which
// defaults to `validateEnv()`) to decide whether to warn on a missing SENTRY_DSN.
const REQUIRED_ENV: Record<string, string> = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  REDIS_URL: "redis://localhost:6379",
  JWT_PRIVATE_KEY_PATH: "./keys/jwt-private.pem",
  JWT_PUBLIC_KEY_PATH: "./keys/jwt-public.pem",
  COOKIE_SECRET: "test-cookie-secret-at-least-32-chars-long!!",
  CSRF_SECRET: "test-csrf-secret-at-least-32-chars-long!!!",
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

describe("scrubSentryEvent, AC-43 PII scrubbing", () => {
  it("strips the Authorization and Cookie request headers outright", () => {
    const event: ErrorEvent = {
      type: undefined,
      request: {
        headers: { authorization: "Bearer secret-token", cookie: "access_token=abc", "user-agent": "jest" },
      },
    };

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.request?.headers?.authorization).toBeUndefined();
    expect(scrubbed.request?.headers?.cookie).toBeUndefined();
    expect(scrubbed.request?.headers?.["user-agent"]).toBe("jest");
  });

  it("removes request.cookies entirely", () => {
    const event: ErrorEvent = { type: undefined, request: { cookies: { csrf_token: "abc123" } } };
    const scrubbed = scrubSentryEvent(event);
    expect(scrubbed.request?.cookies).toBeUndefined();
  });

  it("strips the user's email outright", () => {
    const event: ErrorEvent = { type: undefined, user: { id: "u1", email: "jane@example.com" } };
    const scrubbed = scrubSentryEvent(event);
    expect(scrubbed.user?.email).toBeUndefined();
    expect(scrubbed.user?.id).toBe("u1");
  });

  it("masks a phone number embedded in the user object's custom fields", () => {
    const event: ErrorEvent = { type: undefined, user: { id: "u1", phone: "+919876541234" } as ErrorEvent["user"] };
    const scrubbed = scrubSentryEvent(event);
    expect(JSON.stringify(scrubbed.user)).not.toContain("9876541234");
  });

  it("masks PII found in event.extra", () => {
    const event: ErrorEvent = { type: undefined, extra: { contactEmail: "jane@example.com" } };
    const scrubbed = scrubSentryEvent(event);
    expect(JSON.stringify(scrubbed.extra)).not.toContain("jane@example.com");
  });

  it("masks PII found in the exception message text", () => {
    const event: ErrorEvent = {
      type: undefined,
      exception: { values: [{ type: "Error", value: "Failed to notify jane@example.com" }] },
    };
    const scrubbed = scrubSentryEvent(event);
    expect(scrubbed.exception?.values?.[0]?.value).not.toContain("jane@example.com");
  });

  it("masks PII found in breadcrumb messages/data", () => {
    const event: ErrorEvent = {
      type: undefined,
      breadcrumbs: [{ message: "emailed jane@example.com", data: { to: "jane@example.com" } }],
    };
    const scrubbed = scrubSentryEvent(event);
    expect(JSON.stringify(scrubbed.breadcrumbs)).not.toContain("jane@example.com");
  });

  it("masks PII found in event.message", () => {
    const event: ErrorEvent = { type: undefined, message: "OTP sent to +919876541234" };
    const scrubbed = scrubSentryEvent(event);
    expect(scrubbed.message).not.toContain("9876541234");
  });
});

describe("initSentry / captureException, no-op-safety", () => {
  const originalDsn = process.env.SENTRY_DSN;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAppEnv = process.env.APP_ENV;

  afterEach(() => {
    // NOTE: `process.env.X = undefined` coerces to the STRING "undefined" in Node (env
    // vars can only ever be strings), always `delete` rather than assign `undefined`,
    // or a later spec file sharing this Jest worker's process.env will fail schema
    // validation on a literal "undefined" string.
    restoreEnvVar("SENTRY_DSN", originalDsn);
    restoreEnvVar("NODE_ENV", originalNodeEnv);
    restoreEnvVar("APP_ENV", originalAppEnv);
    for (const key of Object.keys(REQUIRED_ENV)) delete process.env[key];
    __resetSentryForTests();
    __resetEnvCacheForTests();
  });

  it("stays uninitialized when SENTRY_DSN is unset", () => {
    delete process.env.SENTRY_DSN;
    initSentry();
    expect(isSentryInitialized()).toBe(false);
  });

  it("stays uninitialized in NODE_ENV=test even if SENTRY_DSN is set", () => {
    process.env.SENTRY_DSN = "https://fake@o0.ingest.sentry.io/0";
    process.env.NODE_ENV = "test";
    initSentry();
    expect(isSentryInitialized()).toBe(false);
  });

  it("captureException() is a silent no-op when uninitialized", () => {
    __resetSentryForTests();
    expect(() => captureException(new Error("boom"))).not.toThrow();
  });
});

describe("initSentry, T4/B11: loud WARN when SENTRY_DSN is unset in production", () => {
  const originalDsn = process.env.SENTRY_DSN;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAppEnv = process.env.APP_ENV;

  beforeEach(() => {
    Object.assign(process.env, REQUIRED_ENV);
    __resetEnvCacheForTests();
  });

  afterEach(() => {
    restoreEnvVar("SENTRY_DSN", originalDsn);
    restoreEnvVar("NODE_ENV", originalNodeEnv);
    restoreEnvVar("APP_ENV", originalAppEnv);
    for (const key of Object.keys(REQUIRED_ENV)) delete process.env[key];
    __resetSentryForTests();
    __resetEnvCacheForTests();
  });

  it("logs a WARN (does not throw) when APP_ENV=production and SENTRY_DSN is absent", () => {
    delete process.env.SENTRY_DSN;
    process.env.NODE_ENV = "production";
    process.env.APP_ENV = "production";
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(() => initSentry()).not.toThrow();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("SENTRY_DSN is not set"));
    expect(isSentryInitialized()).toBe(false);
    warnSpy.mockRestore();
  });

  it("stays silent (no WARN) when SENTRY_DSN is absent outside production", () => {
    delete process.env.SENTRY_DSN;
    process.env.NODE_ENV = "development";
    process.env.APP_ENV = "local";
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    initSentry();

    expect(warnSpy).not.toHaveBeenCalled();
    expect(isSentryInitialized()).toBe(false);
    warnSpy.mockRestore();
  });
});
