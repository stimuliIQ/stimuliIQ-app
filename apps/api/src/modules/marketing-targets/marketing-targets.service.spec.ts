// apps/api/src/modules/marketing-targets/marketing-targets.service.spec.ts
//
// The service's whole job is assembling a goal with progress that is recomputed every time,
// so these tests are about the JOINS BETWEEN those pieces rather than about arithmetic,
// `summariseTargetMetric` is unit-tested in @repo/types, and re-testing it here would only
// pin the same sums twice.
//
// What is actually at risk, and therefore what is covered:
//   - a person with NO target must still appear, with real completed figures
//   - the month window handed to the aggregates must be [first, next-first), inclusive of the
//     last day and exclusive of the next month's first
//   - totals must sum the rows rather than being computed some second way
//   - "met" must ignore metrics the person was never given
//   - a user id from another tenant must 404, not 403

import { NotFoundException } from "@nestjs/common";

import { MarketingTargetsService } from "./marketing-targets.service";
import type { OrgService } from "../org/org.service";
import { scopeContextStorage } from "../auth/lib/scope-context";
import type { MarketingTargetsRepository } from "./marketing-targets.repository";

const TENANT = "11111111-1111-1111-1111-111111111111";
const RAHUL = "22222222-2222-2222-2222-222222222222";
const PRIYA = "33333333-3333-3333-3333-333333333333";
const OWNER = "44444444-4444-4444-4444-444444444444";

function user(id: string, name: string) {
  return { id, name, email: `${name.toLowerCase()}@stimuliiq.test`, roleKeys: ["marketing"] };
}

function target(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    userId: RAHUL,
    periodMonth: new Date("2026-03-01T00:00:00.000Z"),
    conversionsTarget: 40,
    revenueTargetPaise: 500_000_00,
    note: null,
    createdById: OWNER,
    createdByName: "Owner",
    updatedAt: new Date("2026-03-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makeRepo() {
  return {
    findForMonth: jest.fn().mockResolvedValue([]),
    findForUserMonth: jest.fn().mockResolvedValue(null),
    findById: jest.fn().mockResolvedValue(null),
    upsert: jest.fn(),
    softDelete: jest.fn().mockResolvedValue(undefined),
    findTargetableUsers: jest.fn().mockResolvedValue([]),
    findUserById: jest.fn().mockResolvedValue(null),
    countConversionsByOwner: jest.fn().mockResolvedValue(new Map()),
    sumRevenuePaiseByOwner: jest.fn().mockResolvedValue(new Map()),
  } as unknown as jest.Mocked<MarketingTargetsRepository>;
}

/**
 * Runs `fn` with a scope context published, the way ScopeInterceptor does per request.
 * `all` is company-wide authority — what super_admin and HR hold, and what every test in
 * this file assumed implicitly before the org chart existed.
 */
function withScope<T>(scope: "all" | "own", actorId: string, fn: () => Promise<T>): Promise<T> {
  return scopeContextStorage.run(
    { permissionKey: "marketing_targets.manage", scope, actorId, tenantId: TENANT },
    fn,
  );
}

describe("MarketingTargetsService", () => {
  let repo: jest.Mocked<MarketingTargetsRepository>;
  let org: jest.Mocked<OrgService>;
  let service: MarketingTargetsService;

  beforeEach(() => {
    repo = makeRepo();
    // Nobody leads anybody by default. The existing tests all run at scope=all (company
    // -wide authority), where the org chart is never consulted — so they keep testing
    // exactly what they were written for.
    org = {
      listSubordinateUserIds: jest.fn().mockResolvedValue([]),
      resolveApprovalChain: jest.fn(),
      getPosition: jest.fn(),
      listFallbackApprovers: jest.fn(),
    } as unknown as jest.Mocked<OrgService>;
    service = new MarketingTargetsService(repo, org as unknown as OrgService);
  });

  describe("getMine", () => {
    it("returns hasTarget:false AND real progress when nobody has set a number", async () => {
      // The point of the feature for a person with no target: they still see what they closed.
      // An empty card here would read as "you have done nothing".
      repo.findUserById.mockResolvedValue(user(RAHUL, "Rahul"));
      repo.countConversionsByOwner.mockResolvedValue(new Map([[RAHUL, 6]]));
      repo.sumRevenuePaiseByOwner.mockResolvedValue(new Map([[RAHUL, 90_000_00]]));

      const result = await service.getMine(TENANT, RAHUL, "2026-03");

      expect(result.hasTarget).toBe(false);
      expect(result.progress.targetId).toBeNull();
      expect(result.progress.conversions).toMatchObject({ target: 0, completed: 6, percent: null });
      expect(result.progress.revenuePaise).toMatchObject({ target: 0, completed: 90_000_00 });
    });

    it("fills in target, completed and pending when a number is set", async () => {
      repo.findUserById.mockResolvedValue(user(RAHUL, "Rahul"));
      repo.findForUserMonth.mockResolvedValue(target());
      repo.countConversionsByOwner.mockResolvedValue(new Map([[RAHUL, 23]]));
      repo.sumRevenuePaiseByOwner.mockResolvedValue(new Map([[RAHUL, 287_500_00]]));

      const result = await service.getMine(TENANT, RAHUL, "2026-03");

      expect(result.hasTarget).toBe(true);
      expect(result.progress.conversions).toMatchObject({ target: 40, completed: 23, pending: 17, met: false });
      expect(result.progress.revenuePaise).toMatchObject({ target: 500_000_00, completed: 287_500_00 });
      expect(result.progress.setByName).toBe("Owner");
    });

    it("asks the aggregates for [1st, next 1st), the last day in, the next month out", async () => {
      repo.findUserById.mockResolvedValue(user(RAHUL, "Rahul"));

      await service.getMine(TENANT, RAHUL, "2026-03");

      const [, , from, to] = repo.countConversionsByOwner.mock.calls[0]!;
      expect((from as Date).toISOString()).toBe("2026-03-01T00:00:00.000Z");
      expect((to as Date).toISOString()).toBe("2026-04-01T00:00:00.000Z");
      // Both aggregates must use the SAME window, or conversions and revenue would be
      // measured over different periods and the card would quietly compare unlike things.
      expect(repo.sumRevenuePaiseByOwner.mock.calls[0]![2]).toEqual(from);
      expect(repo.sumRevenuePaiseByOwner.mock.calls[0]![3]).toEqual(to);
    });

    it("rolls December into the next January rather than a 13th month", async () => {
      repo.findUserById.mockResolvedValue(user(RAHUL, "Rahul"));

      await service.getMine(TENANT, RAHUL, "2026-12");

      const [, , from, to] = repo.countConversionsByOwner.mock.calls[0]!;
      expect((from as Date).toISOString()).toBe("2026-12-01T00:00:00.000Z");
      expect((to as Date).toISOString()).toBe("2027-01-01T00:00:00.000Z");
    });

    it("404s for a user that does not exist in this tenant", async () => {
      repo.findUserById.mockResolvedValue(null);
      await expect(service.getMine(TENANT, RAHUL, "2026-03")).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("list", () => {
    beforeEach(() => {
      repo.findTargetableUsers.mockResolvedValue([user(RAHUL, "Rahul"), user(PRIYA, "Priya")]);
    });

    it("includes people with NO target, so an unset number is visible rather than absent", async () => {
      repo.findForMonth.mockResolvedValue([target()]); // Rahul only
      repo.countConversionsByOwner.mockResolvedValue(new Map([[RAHUL, 23], [PRIYA, 9]]));

      const result = await withScope("all", "admin-1", () => service.list(TENANT, "2026-03"));

      expect(result.rows).toHaveLength(2);
      const priya = result.rows.find((r) => r.userId === PRIYA)!;
      expect(priya.targetId).toBeNull();
      expect(priya.conversions.completed).toBe(9); // real work, no target
    });

    it("keeps a person who holds a target but has lost the marketing role", async () => {
      // Dropping them would erase the month's history the day somebody changes roles.
      repo.findTargetableUsers.mockResolvedValue([user(PRIYA, "Priya")]);
      repo.findForMonth.mockResolvedValue([target()]); // Rahul's, and Rahul is no longer returned
      repo.findUserById.mockResolvedValue({ ...user(RAHUL, "Rahul"), roleKeys: ["counsellor"] });

      const result = await withScope("all", "admin-1", () => service.list(TENANT, "2026-03"));

      expect(result.rows.map((r) => r.userId).sort()).toEqual([PRIYA, RAHUL].sort());
    });

    it("totals are the sum of the rows, not a separately-derived number", async () => {
      repo.findForMonth.mockResolvedValue([
        target(),
        target({ id: "bbbb", userId: PRIYA, conversionsTarget: 35, revenueTargetPaise: 300_000_00 }),
      ]);
      repo.countConversionsByOwner.mockResolvedValue(new Map([[RAHUL, 23], [PRIYA, 29]]));
      repo.sumRevenuePaiseByOwner.mockResolvedValue(new Map([[RAHUL, 100_00], [PRIYA, 200_00]]));

      const result = await withScope("all", "admin-1", () => service.list(TENANT, "2026-03"));

      expect(result.totals.conversions.target).toBe(75);
      expect(result.totals.conversions.completed).toBe(52);
      expect(result.totals.revenuePaise.target).toBe(800_000_00);
      expect(result.totals.revenuePaise.completed).toBe(300_00);
      expect(result.totals.peopleWithTarget).toBe(2);
    });

    it("counts somebody as meeting their target only on the metrics they were given", async () => {
      // Priya has a REVENUE-ONLY target and smashes it, while closing no deals. She must
      // count as meeting her target: folding in a conversions number nobody set her would
      // make it unachievable.
      repo.findTargetableUsers.mockResolvedValue([user(PRIYA, "Priya")]);
      repo.findForMonth.mockResolvedValue([
        target({ userId: PRIYA, conversionsTarget: 0, revenueTargetPaise: 100_00 }),
      ]);
      repo.countConversionsByOwner.mockResolvedValue(new Map([[PRIYA, 0]]));
      repo.sumRevenuePaiseByOwner.mockResolvedValue(new Map([[PRIYA, 250_00]]));

      const result = await withScope("all", "admin-1", () => service.list(TENANT, "2026-03"));

      expect(result.totals.peopleMeetingTarget).toBe(1);
      expect(result.rows[0]!.revenuePaise.met).toBe(true);
      expect(result.rows[0]!.conversions.percent).toBeNull(); // not measured
    });

    it("does not count a person with no target at all as meeting one", async () => {
      repo.findForMonth.mockResolvedValue([]);
      const result = await withScope("all", "admin-1", () => service.list(TENANT, "2026-03"));
      expect(result.totals.peopleWithTarget).toBe(0);
      expect(result.totals.peopleMeetingTarget).toBe(0);
    });
  });

  describe("upsert", () => {
    it("normalises the month to the first and stamps the actor", async () => {
      repo.findUserById.mockResolvedValue(user(RAHUL, "Rahul"));
      repo.upsert.mockResolvedValue(target());

      await withScope("all", OWNER, () =>
        service.upsert(TENANT, OWNER, {
        userId: RAHUL,
        month: "2026-03",
        conversionsTarget: 40,
        revenueTargetPaise: 500_000_00,
        }),
      );

      expect(repo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT,
          userId: RAHUL,
          periodMonth: new Date("2026-03-01T00:00:00.000Z"),
          actorId: OWNER,
          note: null,
        }),
      );
    });

    it("stores a blank note as null rather than an empty string", async () => {
      repo.findUserById.mockResolvedValue(user(RAHUL, "Rahul"));
      repo.upsert.mockResolvedValue(target());

      await withScope("all", OWNER, () =>
        service.upsert(TENANT, OWNER, {
        userId: RAHUL,
        month: "2026-03",
        conversionsTarget: 40,
        revenueTargetPaise: 0,
        note: "   ",
        }),
      );

      expect(repo.upsert).toHaveBeenCalledWith(expect.objectContaining({ note: null }));
    });

    it("404s for a user in another tenant, never 403, which would confirm they exist", async () => {
      repo.findUserById.mockResolvedValue(null);
      await expect(
        service.upsert(TENANT, OWNER, {
          userId: RAHUL,
          month: "2026-03",
          conversionsTarget: 40,
          revenueTargetPaise: 0,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.upsert).not.toHaveBeenCalled();
    });
  });

  describe("remove", () => {
    it("soft-deletes an existing target", async () => {
      repo.findById.mockResolvedValue(target());
      await withScope("all", OWNER, () => service.remove(TENANT, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
      expect(repo.softDelete).toHaveBeenCalledWith("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    });

    it("404s rather than silently succeeding on an id from another tenant", async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.remove(TENANT, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repo.softDelete).not.toHaveBeenCalled();
    });
  });
});

// ── Team-scoped targets (P17-3, ADR-0069) ─────────────────────────────────────────────
//
// A manager sets and reads targets for their own people. The permission is the same one the
// owner holds; the ORG CHART decides whose numbers are in reach. These are the cases that
// stop that widening from becoming a leak.
describe("MarketingTargetsService, team scope", () => {
  const MANAGER = "manager-1";
  const MINE = "33333333-3333-4333-8333-333333333333";
  const THEIRS = "44444444-4444-4444-8444-444444444444";

  function repoWithTwoPeople() {
    const repo = makeRepo();
    repo.findTargetableUsers.mockResolvedValue([
      { id: MINE, name: "Anil", email: "anil@x.test" },
      { id: THEIRS, name: "Bela", email: "bela@x.test" },
    ] as never);
    return repo;
  }

  function serviceWith(repo: jest.Mocked<MarketingTargetsRepository>, subordinates: string[]) {
    const org = {
      listSubordinateUserIds: jest.fn().mockResolvedValue(subordinates),
    } as unknown as jest.Mocked<OrgService>;
    return { service: new MarketingTargetsService(repo, org as unknown as OrgService), org };
  }

  it("shows a company-wide holder everyone, exactly as before teams existed", async () => {
    const { service, org } = serviceWith(repoWithTwoPeople(), []);

    const result = await withScope("all", MANAGER, () => service.list(TENANT, "2026-03"));

    // scope=all never consults the chart — a report that quietly narrowed for the owner
    // would be a regression nobody would notice until a number went missing.
    expect(org.listSubordinateUserIds).not.toHaveBeenCalled();
    expect(result.rows.map((r) => r.userId).sort()).toEqual([MINE, THEIRS].sort());
  });

  it("narrows a manager to the people they actually lead", async () => {
    const { service } = serviceWith(repoWithTwoPeople(), [MINE]);

    const result = await withScope("own", MANAGER, () => service.list(TENANT, "2026-03"));

    expect(result.rows.map((r) => r.userId)).toEqual([MINE]);
  });

  it("gives somebody who leads nobody an empty report, not a 403", async () => {
    // A 403 on a screen the sidebar just offered is what gets reported as "the CRM is
    // broken". An empty report with a named empty state says what is actually wrong.
    const { service } = serviceWith(repoWithTwoPeople(), []);

    const result = await withScope("own", MANAGER, () => service.list(TENANT, "2026-03"));

    expect(result.rows).toEqual([]);
    expect(result.totals.peopleWithTarget).toBe(0);
  });

  it("refuses to let a manager set a number for somebody outside their team", async () => {
    // 404, not 403: a 403 confirms the person exists and is measured, which is exactly what
    // must not leak to somebody with no standing over them.
    const repo = repoWithTwoPeople();
    repo.findUserById.mockResolvedValue({ id: THEIRS, name: "Bela", email: "bela@x.test" } as never);
    const { service } = serviceWith(repo, [MINE]);

    await expect(
      withScope("own", MANAGER, () =>
        service.upsert(TENANT, MANAGER, {
          userId: THEIRS,
          month: "2026-03",
          conversionsTarget: 5,
          revenueTargetPaise: 0,
        } as never),
      ),
    ).rejects.toMatchObject({ response: { code: "marketing_targets.user_not_found" } });
  });

  it("lets a manager set a number for somebody they DO lead", async () => {
    const repo = repoWithTwoPeople();
    repo.findUserById.mockResolvedValue({ id: MINE, name: "Anil", email: "anil@x.test" } as never);
    const { service } = serviceWith(repo, [MINE]);

    await withScope("own", MANAGER, () =>
      service.upsert(TENANT, MANAGER, {
        userId: MINE,
        month: "2026-03",
        conversionsTarget: 5,
        revenueTargetPaise: 0,
      } as never),
    );

    expect(repo.upsert).toHaveBeenCalled();
  });
});
