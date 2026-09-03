// apps/api/src/common/rate-limit/webhook-ip-rate-limit.guard.spec.ts
//
// Unit tests for WebhookIpRateLimitGuard (Phase-7 Wave 2 security hardening batch A,
// AC-58): "Webhook endpoints are rate-limited per source IP ... independent of HMAC
// signature validity (the rate limit is a pre-check)."

import { ExecutionContext, HttpException, HttpStatus } from "@nestjs/common";
import { WebhookIpRateLimitGuard } from "./webhook-ip-rate-limit.guard";
import type { RedisService } from "../../redis/redis.service";
import { __resetEnvCacheForTests } from "../../config/env";

const REQUIRED_ENV: NodeJS.ProcessEnv = {
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

function buildContext(opts: { ip?: string; className?: string; setHeader?: jest.Mock } = {}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ ip: opts.ip ?? "198.51.100.20" }),
      getResponse: () => ({ setHeader: opts.setHeader ?? jest.fn() }),
    }),
    getHandler: () => function handleWebhook() {},
    getClass: () => ({ name: opts.className ?? "WebhookController" }),
  } as unknown as ExecutionContext;
}

describe("WebhookIpRateLimitGuard, AC-58", () => {
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

  it("allows requests under the configured per-IP threshold, independent of signature validity", async () => {
    const redis = {
      client: { incr: jest.fn().mockResolvedValue(1), expire: jest.fn().mockResolvedValue(1) },
    } as unknown as RedisService;
    const guard = new WebhookIpRateLimitGuard(redis);

    await expect(guard.canActivate(buildContext())).resolves.toBe(true);
  });

  it("throws 429 once the per-IP window threshold is exceeded", async () => {
    // WEBHOOK_IP_RATE_LIMIT_MAX_ATTEMPTS default is 300, simulate the 301st attempt.
    const redis = {
      client: { incr: jest.fn().mockResolvedValue(301), expire: jest.fn() },
    } as unknown as RedisService;
    const guard = new WebhookIpRateLimitGuard(redis);
    const setHeader = jest.fn();

    const promise = guard.canActivate(buildContext({ setHeader }));
    await expect(promise).rejects.toThrow(HttpException);
    await promise.catch((err: HttpException) => {
      expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    });
    expect(setHeader).toHaveBeenCalledWith("Retry-After", expect.any(String));
  });

  it("buckets by controller class name, payment webhook flood does not exhaust the campaign webhook's budget", async () => {
    const incr = jest.fn().mockResolvedValue(1);
    const redis = { client: { incr, expire: jest.fn() } } as unknown as RedisService;
    const guard = new WebhookIpRateLimitGuard(redis);

    await guard.canActivate(buildContext({ className: "WebhookController", ip: "10.0.0.5" }));
    await guard.canActivate(buildContext({ className: "CampaignWebhookController", ip: "10.0.0.5" }));

    expect(incr).toHaveBeenNthCalledWith(1, "webhook:ip-rl:WebhookController:10.0.0.5");
    expect(incr).toHaveBeenNthCalledWith(2, "webhook:ip-rl:CampaignWebhookController:10.0.0.5");
  });

  it("FAILS OPEN when Redis errors, HMAC signature verification remains the primary control", async () => {
    const redis = {
      client: { incr: jest.fn().mockRejectedValue(new Error("Redis unreachable")), expire: jest.fn() },
    } as unknown as RedisService;
    const guard = new WebhookIpRateLimitGuard(redis);

    await expect(guard.canActivate(buildContext())).resolves.toBe(true);
  });
});
