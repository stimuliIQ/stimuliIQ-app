// apps/api/src/common/rate-limit/redis-window-rate-limiter.spec.ts
//
// Unit tests for the shared fixed-window Redis rate-limit core (Phase-7 Wave 2 security
// hardening batch A, item 1, generalizes login-rate-limiter.ts /
// public-booking-rate-limiter.ts / health-rate-limit.guard.ts's shared logic).

import { hitRedisWindow } from "./redis-window-rate-limiter";

function makeRedisMock(overrides: Partial<{ incr: jest.Mock; expire: jest.Mock }> = {}) {
  return {
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("hitRedisWindow", () => {
  it("allows the first request and sets the TTL on first increment", async () => {
    const redis = makeRedisMock({ incr: jest.fn().mockResolvedValue(1) });

    const result = await hitRedisWindow(redis, "test:key", {
      windowSeconds: 60,
      maxAttempts: 5,
      failClosed: true,
    });

    expect(result.limited).toBe(false);
    expect(result.retryAfterSeconds).toBe(60);
    expect(redis.expire).toHaveBeenCalledWith("test:key", 60);
  });

  it("does NOT reset the TTL on subsequent increments within the window", async () => {
    const redis = makeRedisMock({ incr: jest.fn().mockResolvedValue(3) });

    await hitRedisWindow(redis, "test:key", { windowSeconds: 60, maxAttempts: 5, failClosed: true });

    expect(redis.expire).not.toHaveBeenCalled();
  });

  it("reports limited=true once count exceeds maxAttempts", async () => {
    const redis = makeRedisMock({ incr: jest.fn().mockResolvedValue(6) });

    const result = await hitRedisWindow(redis, "test:key", {
      windowSeconds: 60,
      maxAttempts: 5,
      failClosed: true,
    });

    expect(result.limited).toBe(true);
  });

  it("reports limited=false at exactly maxAttempts (boundary)", async () => {
    const redis = makeRedisMock({ incr: jest.fn().mockResolvedValue(5) });

    const result = await hitRedisWindow(redis, "test:key", {
      windowSeconds: 60,
      maxAttempts: 5,
      failClosed: true,
    });

    expect(result.limited).toBe(false);
  });

  it("FAIL CLOSED: a Redis error is reported as limited=true when failClosed=true", async () => {
    const redis = makeRedisMock({ incr: jest.fn().mockRejectedValue(new Error("ECONNREFUSED")) });

    const result = await hitRedisWindow(redis, "test:key", {
      windowSeconds: 60,
      maxAttempts: 5,
      failClosed: true,
    });

    expect(result.limited).toBe(true);
  });

  it("FAIL OPEN: a Redis error is reported as limited=false when failClosed=false", async () => {
    const redis = makeRedisMock({ incr: jest.fn().mockRejectedValue(new Error("ECONNREFUSED")) });

    const result = await hitRedisWindow(redis, "test:key", {
      windowSeconds: 60,
      maxAttempts: 5,
      failClosed: false,
    });

    expect(result.limited).toBe(false);
  });

  it("never throws even when the logger is omitted and Redis errors", async () => {
    const redis = makeRedisMock({ incr: jest.fn().mockRejectedValue(new Error("boom")) });

    await expect(
      hitRedisWindow(redis, "test:key", { windowSeconds: 60, maxAttempts: 5, failClosed: false }),
    ).resolves.toEqual({ limited: false, retryAfterSeconds: 60 });
  });
});
