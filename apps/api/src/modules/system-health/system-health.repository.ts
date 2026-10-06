// apps/api/src/modules/system-health/system-health.repository.ts
//
// Prisma data access ONLY (docs/04-trd-architecture.md §2.1). Read-only: this module never
// writes. Every query goes through `PrismaService.client`, so the soft-delete extension already
// hides deleted rows at the top level; the nested `user` filters below add `deletedAt: null`
// by hand because that extension does not reach into relation filters.

import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

export interface DatabaseInfo {
  version: string | null;
  sizeBytes: number | null;
  connections: number | null;
}

export interface StudentCounts {
  total: number;
  activeAccounts: number;
  signedInLast24h: number;
  signedInLast7d: number;
  neverSignedIn: number;
  newLast7d: number;
  newLast30d: number;
}

@Injectable()
export class SystemHealthRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The liveness probe itself: throws when Postgres is unreachable. */
  async ping(): Promise<void> {
    await this.prisma.client.$queryRaw`SELECT 1`;
  }

  /**
   * Version, size and open-connection count. Each is fetched independently and degrades to
   * null on its own: a managed Postgres can refuse `pg_stat_activity` to a restricted role, and
   * that must not turn a working database into a red tile.
   */
  async databaseInfo(): Promise<DatabaseInfo> {
    const [version, size, connections] = await Promise.all([
      this.prisma.client
        .$queryRaw<Array<{ server_version: string }>>`SHOW server_version`
        .then((rows) => rows[0]?.server_version ?? null)
        .catch(() => null),
      this.prisma.client
        .$queryRaw<Array<{ size: bigint }>>`SELECT pg_database_size(current_database()) AS size`
        .then((rows) => (rows[0] ? Number(rows[0].size) : null))
        .catch(() => null),
      this.prisma.client
        .$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()`
        .then((rows) => rows[0]?.n ?? null)
        .catch(() => null),
    ]);
    return { version, sizeBytes: size, connections };
  }

  async studentCounts(tenantId: string, now: Date): Promise<StudentCounts> {
    const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const liveUser = { deletedAt: null } as const;
    const base = { tenantId };

    const [total, activeAccounts, signedInLast24h, signedInLast7d, neverSignedIn, newLast7d, newLast30d] =
      await Promise.all([
        this.prisma.client.studentProfile.count({ where: base }),
        this.prisma.client.studentProfile.count({ where: { ...base, user: { ...liveUser, status: "active" } } }),
        this.prisma.client.studentProfile.count({
          where: { ...base, user: { ...liveUser, lastLoginAt: { gte: daysAgo(1) } } },
        }),
        this.prisma.client.studentProfile.count({
          where: { ...base, user: { ...liveUser, lastLoginAt: { gte: daysAgo(7) } } },
        }),
        this.prisma.client.studentProfile.count({ where: { ...base, user: { ...liveUser, lastLoginAt: null } } }),
        this.prisma.client.studentProfile.count({ where: { ...base, createdAt: { gte: daysAgo(7) } } }),
        this.prisma.client.studentProfile.count({ where: { ...base, createdAt: { gte: daysAgo(30) } } }),
      ]);

    return { total, activeAccounts, signedInLast24h, signedInLast7d, neverSignedIn, newLast7d, newLast30d };
  }

  liveSessions(tenantId: string, now: Date): Promise<number> {
    return this.prisma.client.session.count({
      where: { tenantId, revokedAt: null, expiresAt: { gt: now } },
    });
  }
}
