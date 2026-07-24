// apps/api/src/modules/leads/lib/public-booking-rate-limiter.spec.ts
//
// Unit tests for PublicBookingRateLimiter — covers:
//   - Normal operation: allows requests up to MAX_ATTEMPTS per IP per window
//   - Rate-limited: 6th request in the same window → rate-limited (true)
//   - H-1 FIX: Redis error → fail CLOSED (returns true, rejects the request)
//
// The fail-closed behaviour is the critical security property: the only unauthenticated
// write path MUST NOT lose its abuse protection on a Redis blip.

import { PublicBookingRateLimiter } from "./public-booking-rate-limiter";

const TEST_IP = "203.0.113.42"; // RFC-5737 documentation range

function makeMockRedis(options: {
  incrFn?: () => Promise<number>;
  expireFn?: () => Promise<void>;
  shouldThrow?: boolean;
  throwOn?: "incr" | "expire";
}) {
  const incr = options.shouldThrow && options.throwOn === "incr"
    ? jest.fn().mockRejectedValue(new Error("Redis INCR failed"))
    : options.shouldThrow
      ? jest.fn().mockRejectedValue(new Error("Redis error"))
      : options.incrFn
        ? jest.fn().mockImplementation(options.incrFn)
        : jest.fn().mockResolvedValue(1);

  const expire = options.throwOn === "expire"
    ? jest.fn().mockRejectedValue(new Error("Redis EXPIRE failed"))
    : options.expireFn
      ? jest.fn().mockImplementation(options.expireFn)
      : jest.fn().mockResolvedValue(1);

  return {
    client: { incr, expire },
  };
}

function makeRateLimiter(redisService: ReturnType<typeof makeMockRedis>) {
  return new PublicBookingRateLimiter(redisService as never);
}

describe("PublicBookingRateLimiter", () => {
  describe("normal operation", () => {
    it("returns false for the first 5 requests (under the limit)", async () => {
      // Each call to incr returns 1..5 in sequence
      let count = 0;
      const redis = makeMockRedis({ incrFn: async () => ++count });
      const limiter = makeRateLimiter(redis);

      for (let i = 0; i < 5; i++) {
        const limited = await limiter.hit(TEST_IP);
        expect(limited).toBe(false);
      }
    });

    it("returns true on the 6th request (exceeds MAX_ATTEMPTS=5)", async () => {
      let count = 5; // already at 5
      const redis = makeMockRedis({ incrFn: async () => ++count });
      const limiter = makeRateLimiter(redis);

      const limited = await limiter.hit(TEST_IP);
      expect(limited).toBe(true);
    });

    it("sets expire only on the first incr (count === 1)", async () => {
      let count = 0;
      const redis = makeMockRedis({ incrFn: async () => ++count });
      const limiter = makeRateLimiter(redis);

      // First hit: count becomes 1 → expire should be called
      await limiter.hit(TEST_IP);
      expect(redis.client.expire).toHaveBeenCalledTimes(1);

      // Second hit: count becomes 2 → expire should NOT be called again
      await limiter.hit(TEST_IP);
      expect(redis.client.expire).toHaveBeenCalledTimes(1);
    });
  });

  describe("H-1: fail-closed on Redis error", () => {
    it("returns true (rate-limited) when Redis incr throws", async () => {
      const redis = makeMockRedis({ shouldThrow: true, throwOn: "incr" });
      const limiter = makeRateLimiter(redis);

      // Must fail CLOSED — treat as rate-limited, not allow-through
      const limited = await limiter.hit(TEST_IP);
      expect(limited).toBe(true);
    });

    it("returns true (rate-limited) when Redis expire throws (after successful incr)", async () => {
      const redis = {
        client: {
          incr: jest.fn().mockResolvedValue(1),
          expire: jest.fn().mockRejectedValue(new Error("Redis EXPIRE failed")),
        },
      };
      const limiter = new PublicBookingRateLimiter(redis as never);

      // expire failure should still fail closed
      const limited = await limiter.hit(TEST_IP);
      expect(limited).toBe(true);
    });

    it("does NOT throw when Redis errors (error is swallowed and fail-closed)", async () => {
      const redis = makeMockRedis({ shouldThrow: true, throwOn: "incr" });
      const limiter = makeRateLimiter(redis);

      // Must not propagate the error — the caller should receive a boolean, not an exception
      await expect(limiter.hit(TEST_IP)).resolves.toBe(true);
    });
  });
});
