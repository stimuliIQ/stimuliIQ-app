// apps/api/src/modules/platform/feature-flags.service.ts
//
// Business logic for feature flags (T9/T14/T23, docs/plans/phase-9-completion.md). No
// Prisma here (CLAUDE.md §3.3) — all persistence goes through FeatureFlagsRepository.
//
// CACHING (T23 DoD: "Flag eval endpoint cached"): GET /feature-flags/evaluate is a
// read-mostly, high-fanout endpoint (called by every authenticated surface — web/lms/crm
// — to gate UI). Evaluated results are cached in Redis with a short TTL
// (EVALUATE_CACHE_TTL_SECONDS) keyed by (tenantId, sorted keys) so a burst of identical
// evaluate() calls (e.g. many students loading the same dashboard) does not each hit
// Postgres. Cache is invalidated implicitly by TTL expiry (not on write) — a `flags.edit`
// write is visible to evaluate() callers within one TTL window (documented, acceptable
// staleness for a UI-gating flag, never used as a security control per the DTO's own
// file-header: "it never substitutes for a server-side permission check").

import { ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma, type FeatureFlag as FeatureFlagRow } from "@prisma/client";
import type { FeatureFlag, EvaluatedFeatureFlags, ListFeatureFlagsQuery, SetFeatureFlagRequest } from "@repo/types";
import { FeatureFlagsRepository } from "./feature-flags.repository";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext } from "../auth/lib/scope-context";
import { RedisService } from "../../redis/redis.service";

const EVALUATE_CACHE_TTL_SECONDS = 30;
/** Defensive ceiling on how many keys a single evaluate() call may request. */
const MAX_EVALUATE_KEYS = 50;

function cacheKey(tenantId: string, keys: string[]): string {
  return `flags:eval:${tenantId}:${[...keys].sort().join(",")}`;
}

function toDto(row: FeatureFlagRow): FeatureFlag {
  return {
    id: row.id,
    key: row.key,
    enabled: row.enabled,
    rollout: (row.rollout as Record<string, unknown> | null) ?? null,
    description: row.description,
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class FeatureFlagsService {
  private readonly logger = new Logger(FeatureFlagsService.name);

  constructor(
    private readonly repository: FeatureFlagsRepository,
    private readonly redis: RedisService,
  ) {}

  /** flags.* carries no branch_id/assigned/own column — only scope=all is resolvable (mirrors MentorsService precedent). */
  private assertResolvableScope(): void {
    const scope = requireScopeContext();
    if (scope.scope !== "all") {
      throw new ForbiddenException({
        code: "flags.scope_unresolvable",
        title: "Scope not supported",
        detail: `The "${scope.scope}" data-scope is not resolvable for the feature-flags module.`,
      });
    }
  }

  async list(tenantId: string, query: ListFeatureFlagsQuery): Promise<PaginatedResult<FeatureFlag>> {
    this.assertResolvableScope();
    const { rows, total } = await this.repository.list({
      tenantId,
      enabled: query.enabled,
      search: query.search,
      page: query.page,
      pageSize: query.pageSize,
    });
    return new PaginatedResult(rows.map(toDto), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  async getByKey(tenantId: string, key: string): Promise<FeatureFlag> {
    this.assertResolvableScope();
    const row = await this.repository.findByKey(tenantId, key);
    if (!row) throw new NotFoundException({ code: "flags.not_found", title: "Feature flag not found" });
    return toDto(row);
  }

  async set(tenantId: string, key: string, body: SetFeatureFlagRequest): Promise<FeatureFlag> {
    this.assertResolvableScope();
    const row = await this.repository.upsertByKey(tenantId, key, {
      enabled: body.enabled,
      rollout: body.rollout === undefined ? Prisma.JsonNull : (body.rollout as Prisma.InputJsonValue | null) ?? Prisma.JsonNull,
      description: body.description ?? null,
    });
    return toDto(row);
  }

  /**
   * GET /feature-flags/evaluate — any authenticated caller, no @RequirePermission
   * (mirrors GET /me: "no specific module.action permission beyond being authenticated",
   * per the DTO file header this is a UI-gating read, never a security boundary).
   */
  async evaluate(tenantId: string, rawKeys: string): Promise<EvaluatedFeatureFlags> {
    const keys = [...new Set(rawKeys.split(",").map((k) => k.trim()).filter(Boolean))].slice(0, MAX_EVALUATE_KEYS);
    if (keys.length === 0) return {};

    const ck = cacheKey(tenantId, keys);
    try {
      const cached = await this.redis.client.get(ck);
      if (cached) return JSON.parse(cached) as EvaluatedFeatureFlags;
    } catch (err) {
      // Cache is a pure optimization — a Redis error must never break flag evaluation.
      this.logger.warn(`[FeatureFlagsService] evaluate() cache read failed — falling through to DB: ${String(err)}`);
    }

    const rows = await this.repository.findByKeys(tenantId, keys);
    const byKey = new Map(rows.map((r) => [r.key, r.enabled]));
    const result: EvaluatedFeatureFlags = {};
    for (const key of keys) {
      result[key] = byKey.get(key) ?? false; // unknown key defaults to disabled — fail closed on UI gating too.
    }

    try {
      await this.redis.client.set(ck, JSON.stringify(result), "EX", EVALUATE_CACHE_TTL_SECONDS);
    } catch (err) {
      this.logger.warn(`[FeatureFlagsService] evaluate() cache write failed (non-fatal): ${String(err)}`);
    }

    return result;
  }
}
