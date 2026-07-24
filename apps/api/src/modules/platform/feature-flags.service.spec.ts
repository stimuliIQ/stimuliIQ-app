// apps/api/src/modules/platform/feature-flags.service.spec.ts
//
// Unit tests for FeatureFlagsService: scope resolution (only "all" resolvable — no
// branch_id column), evaluate() cache hit/miss + fail-open on Redis error, unknown-key
// default (false).

import { ForbiddenException } from "@nestjs/common";
import type { FeatureFlag as FeatureFlagRow } from "@prisma/client";
import { FeatureFlagsService } from "./feature-flags.service";
import { FeatureFlagsRepository } from "./feature-flags.repository";
import { RedisService } from "../../redis/redis.service";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<FeatureFlagsRepository> {
  return {
    list: jest.fn(),
    findByKey: jest.fn(),
    findByKeys: jest.fn(),
    upsertByKey: jest.fn(),
  } as unknown as Mocked<FeatureFlagsRepository>;
}

function mockRedis(): Mocked<RedisService> {
  return {
    client: {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue("OK"),
    },
  } as unknown as Mocked<RedisService>;
}

const ROW: FeatureFlagRow = {
  id: "flag-1",
  tenantId: "tenant-1",
  key: "new_dashboard",
  enabled: true,
  rollout: null,
  description: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  deletedAt: null,
};

function runWithScope<T>(scope: ScopeContext["scope"], fn: () => T): T {
  const ctx: ScopeContext = { permissionKey: "flags.view", scope, actorId: "actor-1", tenantId: "tenant-1" };
  return scopeContextStorage.run(ctx, fn);
}

describe("FeatureFlagsService", () => {
  let service: FeatureFlagsService;
  let repo: Mocked<FeatureFlagsRepository>;
  let redis: Mocked<RedisService>;

  beforeEach(() => {
    repo = mockRepository();
    redis = mockRedis();
    service = new FeatureFlagsService(repo as unknown as FeatureFlagsRepository, redis as unknown as RedisService);
  });

  describe("scope resolution", () => {
    it("allows scope=all", async () => {
      repo.list.mockResolvedValue({ rows: [ROW], total: 1 });
      const result = await runWithScope("all", () => service.list("tenant-1", { page: 1, pageSize: 20 }));
      expect(result.items).toHaveLength(1);
    });

    it("rejects scope=branch (flags has no branch_id column)", async () => {
      await expect(runWithScope("branch", () => service.list("tenant-1", { page: 1, pageSize: 20 }))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe("evaluate()", () => {
    it("returns cached result on cache hit without touching the repository", async () => {
      (redis.client.get as jest.Mock).mockResolvedValueOnce(JSON.stringify({ a: true }));
      const result = await service.evaluate("tenant-1", "a");
      expect(result).toEqual({ a: true });
      expect(repo.findByKeys).not.toHaveBeenCalled();
    });

    it("falls through to the DB and caches on a cache miss", async () => {
      repo.findByKeys.mockResolvedValue([ROW]);
      const result = await service.evaluate("tenant-1", "new_dashboard,unknown_flag");
      expect(result).toEqual({ new_dashboard: true, unknown_flag: false });
      expect(redis.client.set).toHaveBeenCalled();
    });

    it("fails open (falls through to DB) when Redis read throws", async () => {
      (redis.client.get as jest.Mock).mockRejectedValueOnce(new Error("redis down"));
      repo.findByKeys.mockResolvedValue([ROW]);
      const result = await service.evaluate("tenant-1", "new_dashboard");
      expect(result).toEqual({ new_dashboard: true });
    });

    it("returns {} for an empty keys string", async () => {
      const result = await service.evaluate("tenant-1", "  ");
      expect(result).toEqual({});
      expect(repo.findByKeys).not.toHaveBeenCalled();
    });
  });
});
