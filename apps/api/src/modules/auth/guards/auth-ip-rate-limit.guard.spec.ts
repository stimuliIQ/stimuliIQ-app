// apps/api/src/modules/auth/guards/auth-ip-rate-limit.guard.spec.ts
//
// Unit tests for AuthIpRateLimitGuard (Phase-7 Wave 2 security hardening batch A,
// AC-57): "Auth endpoints gain an IP-dimension rate limit ... regardless of which
// account is targeted."

import { ExecutionContext, HttpException, HttpStatus } from "@nestjs/common";
import { AuthIpRateLimitGuard } from "./auth-ip-rate-limit.guard";
import type { RedisService } from "../../../redis/redis.service";
import { __resetEnvCacheForTests } from "../../../config/env";

const REQUIRED_ENV: NodeJS.ProcessEnv = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/stimuliiq",
  REDIS_URL: "redis://localhost:6379",
  JWT_PRIVATE_KEY_PATH: "./keys/jwt-private.pem",
  JWT_PUBLIC_KEY_PATH: "./keys/jwt-public.pem",
  COOKIE_SECRET: "a".repeat(32),
  CSRF_SECRET: "b".repeat(32),
};

function buildContext(opts: { ip?: string; handlerName?: string; setHeader?: jest.Mock } = {}): ExecutionContext {
  function login() {
    /* named function so context.getHandler().name === "login" */
  }
  const handler = opts.handlerName
    ? Object.defineProperty(() => undefined, "name", { value: opts.handlerName })
    : login;

  return {
    switchToHttp: () => ({
      getRequest: () => ({ ip: opts.ip ?? "198.51.100.10" }),
      getResponse: () => ({ setHeader: opts.setHeader ?? jest.fn() }),
    }),
    getHandler: () => handler,
    getClass: () => ({ name: "AuthController" }),
  } as unknown as ExecutionContext;
}

describe("AuthIpRateLimitGuard — AC-57", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env = { ...REQUIRED_ENV };
    __resetEnvCacheForTests();
  });

  afterEach(() => {
    process.env = originalEnv;
    __resetEnvCacheForTests();
  });

  it("allows requests under the configured per-IP threshold", async () => {
    const redis = {
      client: { incr: jest.fn().mockResolvedValue(1), expire: jest.fn().mockResolvedValue(1) },
    } as unknown as RedisService;
    const guard = new AuthIpRateLimitGuard(redis);

    await expect(guard.canActivate(buildContext())).resolves.toBe(true);
  });

  it("throws 429 once the per-IP window threshold is exceeded, regardless of which account is targeted", async () => {
    // AUTH_IP_RATE_LIMIT_MAX_ATTEMPTS default is 20 — simulate the 21st attempt.
    const redis = {
      client: { incr: jest.fn().mockResolvedValue(21), expire: jest.fn() },
    } as unknown as RedisService;
    const guard = new AuthIpRateLimitGuard(redis);
    const setHeader = jest.fn();

    const promise = guard.canActivate(buildContext({ setHeader }));
    await expect(promise).rejects.toThrow(HttpException);
    await promise.catch((err: HttpException) => {
      expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    });
    expect(setHeader).toHaveBeenCalledWith("Retry-After", expect.any(String));
  });

  it("buckets by handler name — a flood on one auth route does not exhaust another route's budget", async () => {
    const incr = jest.fn().mockResolvedValue(1);
    const redis = { client: { incr, expire: jest.fn() } } as unknown as RedisService;
    const guard = new AuthIpRateLimitGuard(redis);

    await guard.canActivate(buildContext({ handlerName: "login", ip: "10.0.0.1" }));
    await guard.canActivate(buildContext({ handlerName: "requestOtp", ip: "10.0.0.1" }));

    expect(incr).toHaveBeenNthCalledWith(1, "auth:ip-rl:login:10.0.0.1");
    expect(incr).toHaveBeenNthCalledWith(2, "auth:ip-rl:requestOtp:10.0.0.1");
  });

  it("FAILS CLOSED when Redis errors — this is the only defense against distributed credential-stuffing here", async () => {
    const redis = {
      client: { incr: jest.fn().mockRejectedValue(new Error("Redis unreachable")), expire: jest.fn() },
    } as unknown as RedisService;
    const guard = new AuthIpRateLimitGuard(redis);

    await expect(guard.canActivate(buildContext())).rejects.toThrow(HttpException);
  });

  it("respects a configured AUTH_IP_RATE_LIMIT_MAX_ATTEMPTS override", async () => {
    process.env = { ...REQUIRED_ENV, AUTH_IP_RATE_LIMIT_MAX_ATTEMPTS: "2" };
    __resetEnvCacheForTests();
    const redis = {
      client: { incr: jest.fn().mockResolvedValue(3), expire: jest.fn() },
    } as unknown as RedisService;
    const guard = new AuthIpRateLimitGuard(redis);

    await expect(guard.canActivate(buildContext())).rejects.toThrow(HttpException);
  });
});
