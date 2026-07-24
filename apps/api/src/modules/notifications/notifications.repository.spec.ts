// apps/api/src/modules/notifications/notifications.repository.spec.ts
//
// Unit tests for NotificationsRepository#createSuppression's idempotency (Phase-7 Wave 2
// security hardening batch A, item 2b — AC-60). Before migration
// 20260707070000_security_hardening_suppression_unique, `notification_suppressions` had
// NO unique constraint, so this method's doc comment ("duplicate is harmless") was true
// only by accident (a duplicate INSERT always succeeded, silently creating a second
// row). Now that the partial-unique index exists, a P2002 must be caught and resolved to
// the existing row rather than thrown — this test proves that fix (found via a real
// integration-suite regression on POST /unsubscribe/:token → 500 once the constraint
// was added, see p6-engagement.integration-spec.ts N-9 AC-22).

import { Prisma } from "@prisma/client";
import { NotificationsRepository } from "./notifications.repository";
import type { PrismaService } from "../../prisma/prisma.service";

function makeP2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "5.0.0",
    meta: { target: ["tenant_id", "channel", "email"] },
  });
}

const TENANT_ID = "tenant-1";
const NOW = new Date("2026-07-07T00:00:00Z");

function makePrismaMock(overrides: {
  create?: jest.Mock;
  findFirst?: jest.Mock;
} = {}) {
  return {
    client: {
      notificationSuppression: {
        create: overrides.create ?? jest.fn(),
        findFirst: overrides.findFirst ?? jest.fn(),
      },
    },
  } as unknown as PrismaService;
}

describe("NotificationsRepository#createSuppression — AC-60 idempotency", () => {
  it("returns the newly created row on the happy path (no existing suppression)", async () => {
    const created = {
      id: "sup-1",
      tenantId: TENANT_ID,
      userId: "user-1",
      email: "alice@example.com",
      phone: null,
      channel: "email",
      reason: "unsubscribe",
      createdAt: NOW,
    };
    const prisma = makePrismaMock({ create: jest.fn().mockResolvedValue(created) });
    const repo = new NotificationsRepository(prisma);

    const result = await repo.createSuppression({
      tenantId: TENANT_ID,
      userId: "user-1",
      email: "alice@example.com",
      channel: "email",
      reason: "unsubscribe",
    });

    expect(result.id).toBe("sup-1");
  });

  it("a P2002 (duplicate active suppression) is caught and resolves to the EXISTING row, not thrown", async () => {
    const existing = {
      id: "sup-existing",
      tenantId: TENANT_ID,
      userId: "user-1",
      email: "alice@example.com",
      phone: null,
      channel: "email",
      reason: "unsubscribe",
      createdAt: NOW,
    };
    const prisma = makePrismaMock({
      create: jest.fn().mockRejectedValue(makeP2002()),
      findFirst: jest.fn().mockResolvedValue(existing),
    });
    const repo = new NotificationsRepository(prisma);

    const result = await repo.createSuppression({
      tenantId: TENANT_ID,
      userId: "user-1",
      email: "alice@example.com",
      channel: "email",
      reason: "unsubscribe",
    });

    expect(result.id).toBe("sup-existing");
  });

  it("re-throws a P2002 if the existing row genuinely cannot be found (defensive — should not happen in practice)", async () => {
    const prisma = makePrismaMock({
      create: jest.fn().mockRejectedValue(makeP2002()),
      findFirst: jest.fn().mockResolvedValue(null),
    });
    const repo = new NotificationsRepository(prisma);

    await expect(
      repo.createSuppression({
        tenantId: TENANT_ID,
        userId: "user-1",
        email: "alice@example.com",
        channel: "email",
        reason: "unsubscribe",
      }),
    ).rejects.toThrow();
  });

  it("a non-P2002 error is propagated (never silently swallowed)", async () => {
    const prisma = makePrismaMock({ create: jest.fn().mockRejectedValue(new Error("connection lost")) });
    const repo = new NotificationsRepository(prisma);

    await expect(
      repo.createSuppression({
        tenantId: TENANT_ID,
        userId: "user-1",
        email: "alice@example.com",
        channel: "email",
        reason: "unsubscribe",
      }),
    ).rejects.toThrow("connection lost");
  });
});
