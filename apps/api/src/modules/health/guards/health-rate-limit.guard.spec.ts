import { ExecutionContext, HttpException } from "@nestjs/common";
import { HealthRateLimitGuard } from "./health-rate-limit.guard";
import type { RedisService } from "../../../redis/redis.service";

function buildContext(ip = "203.0.113.5"): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ ip }),
    }),
  } as unknown as ExecutionContext;
}

describe("HealthRateLimitGuard, AC-49", () => {
  it("allows requests under the configured threshold", async () => {
    const redis = {
      client: { incr: jest.fn().mockResolvedValue(1), expire: jest.fn().mockResolvedValue(1) },
    } as unknown as RedisService;
    const guard = new HealthRateLimitGuard(redis);

    await expect(guard.canActivate(buildContext())).resolves.toBe(true);
    expect(redis.client.expire).toHaveBeenCalled();
  });

  it("throws 429 once the per-IP window threshold is exceeded", async () => {
    const redis = {
      client: { incr: jest.fn().mockResolvedValue(121), expire: jest.fn() },
    } as unknown as RedisService;
    const guard = new HealthRateLimitGuard(redis);

    await expect(guard.canActivate(buildContext())).rejects.toThrow(HttpException);
  });

  it("FAILS OPEN when Redis errors, a health-probe outage signal must not be hidden by the rate limiter itself", async () => {
    const redis = {
      client: {
        incr: jest.fn().mockRejectedValue(new Error("Redis unreachable")),
        expire: jest.fn(),
      },
    } as unknown as RedisService;
    const guard = new HealthRateLimitGuard(redis);

    await expect(guard.canActivate(buildContext())).resolves.toBe(true);
  });
});
