import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { MetricsAuthGuard } from "./metrics-auth.guard";
import { __resetEnvCacheForTests } from "../../config/env";

function buildContext(token?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ header: (name: string) => (name === "X-Metrics-Token" ? token : undefined) }),
    }),
  } as unknown as ExecutionContext;
}

const REQUIRED_ENV = {
  DATABASE_URL: "postgres://test",
  REDIS_URL: "redis://test",
  JWT_PRIVATE_KEY_PATH: "/tmp/private.pem",
  JWT_PUBLIC_KEY_PATH: "/tmp/public.pem",
  COOKIE_SECRET: "a".repeat(32),
  CSRF_SECRET: "b".repeat(32),
};

describe("MetricsAuthGuard", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    __resetEnvCacheForTests();
    process.env = { ...originalEnv, ...REQUIRED_ENV };
  });

  afterEach(() => {
    process.env = originalEnv;
    __resetEnvCacheForTests();
  });

  it("allows an unauthenticated scrape in dev/local when METRICS_TOKEN is unset", () => {
    process.env.APP_ENV = "local";
    delete process.env.METRICS_TOKEN;

    const guard = new MetricsAuthGuard();
    expect(guard.canActivate(buildContext())).toBe(true);
  });

  it("FAILS CLOSED (403) in production when METRICS_TOKEN is unset", () => {
    process.env.APP_ENV = "production";
    delete process.env.METRICS_TOKEN;

    const guard = new MetricsAuthGuard();
    expect(() => guard.canActivate(buildContext())).toThrow(ForbiddenException);
  });

  it("FAILS CLOSED (403) in staging when METRICS_TOKEN is unset", () => {
    process.env.APP_ENV = "staging";
    delete process.env.METRICS_TOKEN;

    const guard = new MetricsAuthGuard();
    expect(() => guard.canActivate(buildContext())).toThrow(ForbiddenException);
  });

  it("rejects a missing/incorrect token once METRICS_TOKEN is configured", () => {
    process.env.APP_ENV = "production";
    process.env.METRICS_TOKEN = "correct-token-1234567890";

    const guard = new MetricsAuthGuard();
    expect(() => guard.canActivate(buildContext())).toThrow(ForbiddenException);
    expect(() => guard.canActivate(buildContext("wrong-token"))).toThrow(ForbiddenException);
  });

  it("allows the request when the correct token is presented", () => {
    process.env.APP_ENV = "production";
    process.env.METRICS_TOKEN = "correct-token-1234567890";

    const guard = new MetricsAuthGuard();
    expect(guard.canActivate(buildContext("correct-token-1234567890"))).toBe(true);
  });
});
