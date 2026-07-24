// apps/api/src/modules/dpdp/dpdp-erasure.integration.spec.ts
//
// Integration test proving DpdpService.eraseSubjectPii scrubs a subject's PII from
// REAL, PRE-EXISTING audit_logs rows (Phase-7 Wave 2 security hardening batch B, item 2b
// — AC-64). Follows the same lightweight "ambient dev DB, skip if DATABASE_URL absent"
// pattern as apps/api/src/prisma/soft-delete-audit.integration.spec.ts — no new infra
// dependency, no testcontainers.
//
// The historical rows are inserted via the RAW (base) PrismaClient — deliberately NOT
// through the audit extension — to simulate audit_logs rows written BEFORE the
// write-time PII masking (audit.extension.ts's PII_FIELD_REGISTRY) existed. This is
// exactly the population the erasure job exists to catch up.

import { PrismaClient } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { DpdpService } from "./dpdp.service";
import { DpdpRepository } from "./dpdp.repository";

const hasDatabase = !!process.env.DATABASE_URL;
const describeIfDb = hasDatabase ? describe : describe.skip;

describeIfDb("DpdpService.eraseSubjectPii (integration, AC-64)", () => {
  const raw = new PrismaClient();
  let prismaService: PrismaService;
  let service: DpdpService;

  let tenantId: string;
  let subjectUserId: string;
  let actorId: string;

  const RAW_EMAIL = "dpdp-erasure-subject@example.invalid";
  const RAW_PHONE = "+919812345678";
  const RAW_NAME = "Erasure Test Subject";

  beforeAll(async () => {
    await raw.$connect();
    prismaService = new PrismaService();
    const repo = new DpdpRepository(prismaService);
    service = new DpdpService(repo);

    const tenant = await raw.tenant.upsert({
      where: { slug: "stimuliiq-dpdp-erasure-test" },
      update: {},
      create: { slug: "stimuliiq-dpdp-erasure-test", name: "DPDP Erasure Test Tenant" },
    });
    tenantId = tenant.id;

    const subject = await raw.user.create({
      data: {
        tenantId,
        email: RAW_EMAIL,
        phone: RAW_PHONE,
        name: RAW_NAME,
        passwordHash: "not-a-real-hash",
        status: "active",
      },
    });
    subjectUserId = subject.id;

    const actor = await raw.user.create({
      data: {
        tenantId,
        email: "dpdp-erasure-admin@example.invalid",
        name: "Erasure Test Admin",
        passwordHash: "not-a-real-hash",
        status: "active",
      },
    });
    actorId = actor.id;
  });

  afterAll(async () => {
    await raw.auditLog.deleteMany({ where: { tenantId } });
    await raw.user.deleteMany({ where: { tenantId } });
    await raw.tenant.delete({ where: { id: tenantId } });
    await prismaService.onModuleDestroy();
    await raw.$disconnect();
  });

  it("redacts raw PII from a HISTORICAL User audit row without deleting the row", async () => {
    const historicalRow = await raw.auditLog.create({
      data: {
        tenantId,
        actorId,
        entity: "User",
        entityId: subjectUserId,
        action: "update",
        before: { id: subjectUserId, tenantId, email: RAW_EMAIL, phone: RAW_PHONE, name: RAW_NAME, status: "invited" },
        after: { id: subjectUserId, tenantId, email: RAW_EMAIL, phone: RAW_PHONE, name: RAW_NAME, status: "active" },
      },
    });

    // A correlated Lead row (a prospective-student record this same person also created,
    // matched by raw email — NOT by entityId, since entityId here is the Lead's own id).
    const leadRow = await raw.auditLog.create({
      data: {
        tenantId,
        actorId,
        entity: "Lead",
        entityId: "00000000-0000-0000-0000-0000000000aa",
        action: "create",
        after: { id: "00000000-0000-0000-0000-0000000000aa", tenantId, name: RAW_NAME, email: RAW_EMAIL, phone: RAW_PHONE, stage: "new" },
      },
    });

    // An UNRELATED row for a different person — must survive untouched.
    const unrelatedRow = await raw.auditLog.create({
      data: {
        tenantId,
        actorId,
        entity: "Lead",
        entityId: "00000000-0000-0000-0000-0000000000bb",
        action: "create",
        after: { id: "00000000-0000-0000-0000-0000000000bb", tenantId, name: "Completely Different Person", email: "unrelated@example.invalid", stage: "new" },
      },
    });

    const result = await service.eraseSubjectPii(tenantId, actorId, subjectUserId, "203.0.113.5");

    expect(result.redactedRowCount).toBe(2);
    expect(result.alreadyRedacted).toBe(false);

    const refetchedUserRow = await raw.auditLog.findUniqueOrThrow({ where: { id: historicalRow.id } });
    // Row is NOT deleted (Rule H-5 append-only integrity).
    expect(refetchedUserRow).not.toBeNull();
    const beforeSnap = refetchedUserRow.before as Record<string, unknown>;
    const afterSnap = refetchedUserRow.after as Record<string, unknown>;
    expect(JSON.stringify(beforeSnap)).not.toContain(RAW_EMAIL);
    expect(JSON.stringify(beforeSnap)).not.toContain(RAW_NAME);
    expect(JSON.stringify(afterSnap)).not.toContain(RAW_EMAIL);
    expect(JSON.stringify(afterSnap)).not.toContain(RAW_PHONE);
    expect(JSON.stringify(afterSnap)).not.toContain(RAW_NAME);
    // Non-PII field survives unredacted.
    expect(afterSnap["status"]).toBe("active");

    const refetchedLeadRow = await raw.auditLog.findUniqueOrThrow({ where: { id: leadRow.id } });
    const leadAfter = refetchedLeadRow.after as Record<string, unknown>;
    expect(JSON.stringify(leadAfter)).not.toContain(RAW_EMAIL);
    expect(JSON.stringify(leadAfter)).not.toContain(RAW_NAME);
    expect(leadAfter["stage"]).toBe("new"); // non-PII field survives

    const refetchedUnrelatedRow = await raw.auditLog.findUniqueOrThrow({ where: { id: unrelatedRow.id } });
    const unrelatedAfter = refetchedUnrelatedRow.after as Record<string, unknown>;
    // Untouched — the unrelated person's data must survive exactly as written.
    expect(unrelatedAfter["email"]).toBe("unrelated@example.invalid");
    expect(unrelatedAfter["name"]).toBe("Completely Different Person");

    // The erasure ACTION itself wrote its own audit_logs row (AC-64).
    const erasureAuditRow = await raw.auditLog.findFirst({
      where: { tenantId, entity: "DpdpErasure", entityId: subjectUserId, action: "erasure" },
      orderBy: { createdAt: "desc" },
    });
    expect(erasureAuditRow).not.toBeNull();
    expect(erasureAuditRow?.actorId).toBe(actorId);
    expect((erasureAuditRow?.after as Record<string, unknown>)?.["redactedRowCount"]).toBe(2);
  });

  it("is idempotent — running the erasure again over already-redacted rows changes nothing further", async () => {
    const result = await service.eraseSubjectPii(tenantId, actorId, subjectUserId);
    expect(result.redactedRowCount).toBe(0);
    expect(result.alreadyRedacted).toBe(true);
  });
});
