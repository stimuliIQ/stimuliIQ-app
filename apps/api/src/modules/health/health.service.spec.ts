import { HealthService } from "./health.service";
import type { PrismaService } from "../../prisma/prisma.service";
import type { RedisService } from "../../redis/redis.service";

function buildService(opts: { dbOk: boolean; redisOk: boolean }): HealthService {
  const prisma = {
    client: {
      $queryRaw: opts.dbOk ? jest.fn().mockResolvedValue([{ "?column?": 1 }]) : jest.fn().mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5432")),
    },
  } as unknown as PrismaService;

  const redis = {
    client: {
      ping: opts.redisOk ? jest.fn().mockResolvedValue("PONG") : jest.fn().mockRejectedValue(new Error("Redis connection lost")),
    },
  } as unknown as RedisService;

  return new HealthService(prisma, redis);
}

describe("HealthService", () => {
  it("liveness() reports {status:'ok'} unconditionally, without touching DB/Redis", () => {
    const service = buildService({ dbOk: true, redisOk: true });
    expect(service.liveness()).toEqual({ status: "ok" });
  });

  it("readiness() reports ok/ok + healthy=true when both dependencies respond", async () => {
    const service = buildService({ dbOk: true, redisOk: true });

    const result = await service.readiness();

    expect(result.healthy).toBe(true);
    expect(result.body).toEqual({ status: "ok", db: "ok", redis: "ok" });
  });

  it("readiness() reports db:'down' + healthy=false when Postgres is unreachable — never throws", async () => {
    const service = buildService({ dbOk: false, redisOk: true });

    const result = await service.readiness();

    expect(result.healthy).toBe(false);
    expect(result.body).toEqual({ status: "degraded", db: "down", redis: "ok" });
  });

  it("readiness() reports redis:'down' + healthy=false when Redis is unreachable — never throws", async () => {
    const service = buildService({ dbOk: true, redisOk: false });

    const result = await service.readiness();

    expect(result.healthy).toBe(false);
    expect(result.body).toEqual({ status: "degraded", db: "ok", redis: "down" });
  });

  it("readiness() body never leaks the underlying driver error text (Rule H-3)", async () => {
    const service = buildService({ dbOk: false, redisOk: false });

    const result = await service.readiness();

    const serialized = JSON.stringify(result.body);
    expect(serialized).not.toContain("ECONNREFUSED");
    expect(serialized).not.toContain("127.0.0.1");
    expect(serialized).not.toContain("Redis connection lost");
  });
});
