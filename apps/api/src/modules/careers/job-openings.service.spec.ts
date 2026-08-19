// apps/api/src/modules/careers/job-openings.service.spec.ts
//
// Unit tests for JobOpeningsService (docs/specs/careers-hiring.md, ADR-0066). Covers the
// things that would be silently wrong rather than loudly broken:
//   - the public projection LEAKS NOTHING CRM-only (status, applicant counts);
//   - `closesOn` is INCLUSIVE, and a lapsed opening drops off the site without its status
//     changing — the whole point of having a closing date at all;
//   - slug derivation + collision handling (a 422 naming the clash, never a silent suffix);
//   - `publishedAt` is stamped once and never re-stamped;
//   - scope=all-only, and 404s on unknown ids.

import { ForbiddenException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { JobOpeningsService } from "./job-openings.service";
import { JobOpeningsRepository, type JobOpeningRow } from "./job-openings.repository";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<JobOpeningsRepository> {
  return {
    list: jest.fn(),
    listPublic: jest.fn().mockResolvedValue([]),
    findById: jest.fn(),
    findBySlug: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: "opening-1" }),
    update: jest.fn().mockResolvedValue(undefined),
    softDelete: jest.fn().mockResolvedValue(undefined),
    countApplicationsByOpening: jest.fn().mockResolvedValue(new Map()),
    getTenantIdBySlug: jest.fn().mockResolvedValue("tenant-1"),
  } as unknown as Mocked<JobOpeningsRepository>;
}

function makeRow(overrides: Partial<JobOpeningRow> = {}): JobOpeningRow {
  return {
    id: "opening-1",
    tenantId: "tenant-1",
    title: "Senior Counsellor",
    slug: "senior-counsellor",
    department: "Admissions",
    employmentType: "Full-time",
    location: "Visakhapatnam",
    workMode: "onsite",
    experienceLevel: "2–4 years",
    summary: "Guide prospective students through programme selection.",
    description: "A longer description.",
    responsibilities: ["Counsel students"],
    requirements: ["2 years experience"],
    compensationNote: "₹4–6 LPA",
    status: "published",
    order: 0,
    openingsCount: 2,
    closesOn: null,
    publishedAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2025-12-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function runWithScope<T>(scope: ScopeContext["scope"], fn: () => T): T {
  const ctx: ScopeContext = { permissionKey: "careers.view", scope, actorId: "actor-1", tenantId: "tenant-1" };
  return scopeContextStorage.run(ctx, fn);
}

describe("JobOpeningsService", () => {
  let repo: Mocked<JobOpeningsRepository>;
  let service: JobOpeningsService;

  beforeEach(() => {
    repo = mockRepository();
    service = new JobOpeningsService(repo as unknown as JobOpeningsRepository);
  });

  describe("public projection", () => {
    it("exposes no CRM-only field — a marketing page must never receive status or applicant counts", async () => {
      repo.listPublic.mockResolvedValue([makeRow()]);
      const [opening] = await service.listPublic({ limit: 30 });

      expect(opening).toBeDefined();
      expect(opening).not.toHaveProperty("status");
      expect(opening).not.toHaveProperty("applicationCount");
      expect(opening).not.toHaveProperty("pendingApplicationCount");
      expect(opening).not.toHaveProperty("isLive");
      expect(opening).not.toHaveProperty("order");
      expect(opening!.title).toBe("Senior Counsellor");
    });

    it("falls back to createdAt for postedAt when the opening has never been published", async () => {
      repo.listPublic.mockResolvedValue([makeRow({ publishedAt: null })]);
      const [opening] = await service.listPublic({ limit: 30 });
      expect(opening!.postedAt).toBe(new Date("2025-12-01T00:00:00Z").toISOString());
    });

    it("degrades a malformed responsibilities/requirements column to an empty list rather than throwing mid-render", async () => {
      repo.listPublic.mockResolvedValue([
        makeRow({ responsibilities: "not an array" as never, requirements: [1, "ok", null] as never }),
      ]);
      const [opening] = await service.listPublic({ limit: 30 });
      expect(opening!.responsibilities).toEqual([]);
      expect(opening!.requirements).toEqual(["ok"]);
    });
  });

  describe("closesOn is inclusive and self-enforcing", () => {
    it("passes today (midnight UTC) to the repository so the closing day itself still accepts applications", async () => {
      await service.listPublic({ limit: 30 });
      const args = repo.listPublic.mock.calls[0][0];
      expect(args.today.toISOString()).toBe(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    });

    it("findLiveOpeningForApply refuses an opening whose closing date has passed, WITHOUT its status having changed", async () => {
      repo.findById.mockResolvedValue(makeRow({ status: "published", closesOn: new Date("2020-01-01T00:00:00Z") }));
      await expect(service.findLiveOpeningForApply("tenant-1", "opening-1")).resolves.toBeNull();
    });

    it("findLiveOpeningForApply refuses a draft and a closed opening", async () => {
      repo.findById.mockResolvedValue(makeRow({ status: "draft" }));
      await expect(service.findLiveOpeningForApply("tenant-1", "opening-1")).resolves.toBeNull();

      repo.findById.mockResolvedValue(makeRow({ status: "closed" }));
      await expect(service.findLiveOpeningForApply("tenant-1", "opening-1")).resolves.toBeNull();
    });

    it("findLiveOpeningForApply accepts a published opening with no closing date", async () => {
      repo.findById.mockResolvedValue(makeRow({ closesOn: null }));
      await expect(service.findLiveOpeningForApply("tenant-1", "opening-1")).resolves.not.toBeNull();
    });

    it("the CRM row reports isLive=false for a lapsed opening while still reporting status=published (the honest state)", async () => {
      const lapsed = makeRow({ status: "published", closesOn: new Date("2020-01-01T00:00:00Z") });
      repo.list.mockResolvedValue({ rows: [lapsed], total: 1 });
      const result = await runWithScope("all", () => service.list("tenant-1", { page: 1, pageSize: 20 }));
      expect(result.items[0]!.status).toBe("published");
      expect(result.items[0]!.isLive).toBe(false);
    });
  });

  describe("slugs", () => {
    it("derives the slug from the title when none is supplied", async () => {
      repo.findById.mockResolvedValue(makeRow());
      await runWithScope("all", () =>
        service.create("tenant-1", {
          title: "Senior Counsellor",
          employmentType: "Full-time",
          location: "Visakhapatnam",
          summary: "Summary.",
          responsibilities: [],
          requirements: [],
          status: "draft",
          order: 0,
          openingsCount: 1,
        }),
      );
      expect(repo.create.mock.calls[0][1].slug).toBe("senior-counsellor");
    });

    it("rejects a collision with a 422 naming the clashing opening, rather than silently suffixing", async () => {
      repo.findBySlug.mockResolvedValue(makeRow({ title: "Existing Role" }));
      await expect(
        runWithScope("all", () =>
          service.create("tenant-1", {
            title: "Senior Counsellor",
            employmentType: "Full-time",
            location: "Visakhapatnam",
            summary: "Summary.",
            responsibilities: [],
            requirements: [],
            status: "draft",
            order: 0,
            openingsCount: 1,
          }),
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it("does NOT re-derive the slug on an unrelated PATCH — bumping `order` must not renumber a live public URL", async () => {
      repo.findById.mockResolvedValue(makeRow());
      await runWithScope("all", () => service.update("tenant-1", "opening-1", { order: 5 }));
      expect(repo.findBySlug).not.toHaveBeenCalled();
      expect(repo.update.mock.calls[0][1]).not.toHaveProperty("slug");
    });

    it("422s when a title contains nothing usable in a URL", async () => {
      await expect(
        runWithScope("all", () =>
          service.create("tenant-1", {
            title: "！！！",
            employmentType: "Full-time",
            location: "Visakhapatnam",
            summary: "Summary.",
            responsibilities: [],
            requirements: [],
            status: "draft",
            order: 0,
            openingsCount: 1,
          }),
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  describe("publishedAt", () => {
    it("is stamped on a create that goes straight to published", async () => {
      repo.findById.mockResolvedValue(makeRow());
      await runWithScope("all", () =>
        service.create("tenant-1", {
          title: "Role",
          employmentType: "Full-time",
          location: "Vizag",
          summary: "Summary.",
          responsibilities: [],
          requirements: [],
          status: "published",
          order: 0,
          openingsCount: 1,
        }),
      );
      expect(repo.create.mock.calls[0][1].publishedAt).toBeInstanceOf(Date);
    });

    it("is NOT stamped on a draft create", async () => {
      repo.findById.mockResolvedValue(makeRow());
      await runWithScope("all", () =>
        service.create("tenant-1", {
          title: "Role",
          employmentType: "Full-time",
          location: "Vizag",
          summary: "Summary.",
          responsibilities: [],
          requirements: [],
          status: "draft",
          order: 0,
          openingsCount: 1,
        }),
      );
      expect(repo.create.mock.calls[0][1].publishedAt).toBeNull();
    });

    it("is NOT re-stamped when an already-published-once opening is re-published — that is the same advert, not a new one", async () => {
      repo.findById.mockResolvedValue(makeRow({ status: "closed", publishedAt: new Date("2026-01-01T00:00:00Z") }));
      await runWithScope("all", () => service.update("tenant-1", "opening-1", { status: "published" }));
      expect(repo.update.mock.calls[0][1]).not.toHaveProperty("publishedAt");
    });

    it("IS stamped the first time a draft goes live", async () => {
      repo.findById.mockResolvedValue(makeRow({ status: "draft", publishedAt: null }));
      await runWithScope("all", () => service.update("tenant-1", "opening-1", { status: "published" }));
      expect(repo.update.mock.calls[0][1].publishedAt).toBeInstanceOf(Date);
    });
  });

  describe("applicant counts", () => {
    it("defaults an opening with no applications to zero rather than expecting the repository to fabricate a row", async () => {
      repo.list.mockResolvedValue({ rows: [makeRow()], total: 1 });
      repo.countApplicationsByOpening.mockResolvedValue(new Map());
      const result = await runWithScope("all", () => service.list("tenant-1", { page: 1, pageSize: 20 }));
      expect(result.items[0]!.applicationCount).toBe(0);
      expect(result.items[0]!.pendingApplicationCount).toBe(0);
    });

    it("asks for counts in ONE batched call, not one per row", async () => {
      repo.list.mockResolvedValue({ rows: [makeRow({ id: "a" }), makeRow({ id: "b" })], total: 2 });
      await runWithScope("all", () => service.list("tenant-1", { page: 1, pageSize: 20 }));
      expect(repo.countApplicationsByOpening).toHaveBeenCalledTimes(1);
      expect(repo.countApplicationsByOpening.mock.calls[0][1]).toEqual(["a", "b"]);
    });
  });

  describe("guards", () => {
    it.each(["own", "branch", "assigned"] as const)("refuses the %s data-scope fail-closed", async (scope) => {
      await expect(runWithScope(scope, () => service.list("tenant-1", { page: 1, pageSize: 20 }))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it("404s on an unknown id for get/update/delete", async () => {
      repo.findById.mockResolvedValue(null);
      await expect(runWithScope("all", () => service.getById("tenant-1", "nope"))).rejects.toBeInstanceOf(NotFoundException);
      await expect(runWithScope("all", () => service.update("tenant-1", "nope", { order: 1 }))).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(runWithScope("all", () => service.softDelete("tenant-1", "nope"))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
