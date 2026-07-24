// apps/api/src/prisma/prisma.service.ts
//
// NestJS-injectable Prisma client, extended with soft-delete + audit behavior
// (docs/05-database-design.md §5/§6). Inject `PrismaService` anywhere a repository/
// service needs DB access — never instantiate `PrismaClient` directly elsewhere, so
// every query benefits from both extensions.

import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { softDeleteExtension } from "./soft-delete.extension";
import { auditExtension } from "./audit.extension";

// Order matters: `auditExtension` must be applied FIRST (innermost) and
// `softDeleteExtension` SECOND (outermost). `softDeleteExtension` redirects
// `delete`/`deleteMany` into `update`/`updateMany` by calling back into the `client`
// closure it was defined with — for that redirected call to still be observed (and
// audited) by `auditExtension`, the audit layer must already be "underneath" by the
// time soft-delete's redirect re-enters the client. Applying them in the opposite
// order would let a `delete` bypass the audit log entirely (the redirect would only
// ever reach the un-audited base client).
const extendedPrisma = () => new PrismaClient().$extends(auditExtension).$extends(softDeleteExtension);

// The NON-AUDITED client carries only the soft-delete extension (no audit layer).
// Use this ONLY for high-frequency writes where audit rows would create unacceptable
// churn — specifically:
//   - LessonProgress position pings (PUT /me/lessons/:id/progress):
//     The video player reports position every few seconds. Writing an audit row on
//     each heartbeat would generate thousands of rows per session. The db-architect's
//     decision (audit.extension.ts LessonProgress comment) is: position-ping path
//     uses this non-audited client; the completion transition uses `client` (audited).
// Never use this client for anything other than the documented high-frequency cases.
const nonAuditedPrisma = () => new PrismaClient().$extends(softDeleteExtension);

export type ExtendedPrismaClient = ReturnType<typeof extendedPrisma>;
export type NonAuditedPrismaClient = ReturnType<typeof nonAuditedPrisma>;

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  /** The extended client — soft-delete filtering + audit logging applied to every call. */
  public readonly client: ExtendedPrismaClient;

  /**
   * Non-audited client — soft-delete filtering applied, NO audit logging.
   * USE ONLY for high-frequency writes where audit-log churn is prohibitive
   * (per db-architect decision: LessonProgress position pings).
   * See audit.extension.ts §LessonProgress comment for full rationale.
   */
  public readonly baseClient: NonAuditedPrismaClient;

  constructor() {
    this.client = extendedPrisma();
    this.baseClient = nonAuditedPrisma();
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
    await this.baseClient.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
    await this.baseClient.$disconnect();
  }
}
