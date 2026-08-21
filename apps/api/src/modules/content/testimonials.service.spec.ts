// apps/api/src/modules/content/testimonials.service.spec.ts
//
// Unit tests for TestimonialsService. Focus: the PUBLIC projection, which is what the
// marketing homepage's "What Our Students Say" carousel consumes.
//
// The homepage renders that section ONLY from CRM-published testimonials (there is no
// hardcoded stand-in, see apps/web/.../fallbacks/home-fallback.tsx), so this projection
// is the whole contract between the CRM and what a visitor sees. Two things it must get
// right and had wrong before: carrying the joined program title through, and never
// leaking draft/archived rows.

import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { TestimonialsService } from "./testimonials.service";
import { TestimonialsRepository, type PublishedTestimonialRow } from "./testimonials.repository";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<TestimonialsRepository> {
  return {
    list: jest.fn(),
    findById: jest.fn(),
    listPublished: jest.fn(),
    findManyPublishedByIds: jest.fn(),
    listPublishedFiltered: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    getTenantIdBySlug: jest.fn(),
  } as unknown as Mocked<TestimonialsRepository>;
}

const PUBLISHED_ROW: PublishedTestimonialRow = {
  id: "11111111-1111-4111-8111-111111111111",
  programId: "22222222-2222-4222-8222-222222222222",
  programTitle: "Neurology Workshop",
  studentName: "Aditya R.",
  studentPhotoKey: null,
  quote: "The case discussions changed how I reason through a patient's history.",
  rating: 50,
  status: "published",
  order: 0,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
};

const ALL_SCOPE: ScopeContext = { scope: "all" } as ScopeContext;

describe("TestimonialsService, public projection", () => {
  let repository: Mocked<TestimonialsRepository>;
  let service: TestimonialsService;

  beforeEach(() => {
    repository = mockRepository();
    service = new TestimonialsService(repository as unknown as TestimonialsRepository);
    repository.getTenantIdBySlug.mockResolvedValue("tenant-1");
  });

  it("carries the joined program title into the public DTO", async () => {
    repository.listPublished.mockResolvedValue([PUBLISHED_ROW]);

    const [dto] = await service.listPublic();

    // The card renders this under the student's name. Before it was exposed the public
    // DTO had no program field at all, so live testimonials lost that line entirely.
    expect(dto?.programTitle).toBe("Neurology Workshop");
    expect(dto?.studentName).toBe("Aditya R.");
    expect(dto?.rating).toBe(50); // 0-50 x10 scale; the web layer divides to get stars.
  });

  it("returns programTitle: null for a testimonial with no linked program", async () => {
    repository.listPublished.mockResolvedValue([
      { ...PUBLISHED_ROW, programId: null, programTitle: null },
    ]);

    const [dto] = await service.listPublic();

    // programId is optional in the CRM form, so this is a normal record, not an error,
    // the card just omits the program line.
    expect(dto?.programTitle).toBeNull();
  });

  it("never exposes programId to the public surface", async () => {
    repository.listPublished.mockResolvedValue([PUBLISHED_ROW]);

    const [dto] = await service.listPublic();

    // An internal handle a marketing page has no use for; exposing it invites the web app
    // to fetch the program separately just to render one string.
    expect(dto).not.toHaveProperty("programId");
  });

  it("returns an empty list when nothing is published, the homepage then omits the section", async () => {
    repository.listPublished.mockResolvedValue([]);

    await expect(service.listPublic()).resolves.toEqual([]);
  });

  it("delegates the published-only filter to the repository rather than filtering in memory", async () => {
    repository.listPublished.mockResolvedValue([]);

    await service.listPublic("33333333-3333-4333-8333-333333333333");

    // Draft/archived exclusion is a WHERE clause (repository.listPublished), not a
    // post-fetch .filter(), an unpublished quote must never leave the database.
    expect(repository.listPublished).toHaveBeenCalledWith(
      "tenant-1",
      "33333333-3333-4333-8333-333333333333",
    );
  });
});

describe("TestimonialsService, CRM surface", () => {
  let repository: Mocked<TestimonialsRepository>;
  let service: TestimonialsService;

  beforeEach(() => {
    repository = mockRepository();
    service = new TestimonialsService(repository as unknown as TestimonialsRepository);
  });

  it("create() never publishes directly, a new testimonial lands as a draft", async () => {
    repository.create.mockResolvedValue({ id: PUBLISHED_ROW.id });
    repository.findById.mockResolvedValue({ ...PUBLISHED_ROW, status: "draft" });

    await scopeContextStorage.run(ALL_SCOPE, () =>
      service.create("tenant-1", {
        studentName: "Aditya R.",
        quote: "…",
        status: "published",
        order: 0,
      }),
    );

    // This is the publish gate: staff must explicitly publish, so nothing reaches the
    // public homepage as a side effect of creating it.
    expect(repository.create).toHaveBeenCalledWith(
      "tenant-1",
      expect.objectContaining({ status: "draft" }),
    );
  });

  // ── The publish path ──────────────────────────────────────────────────────
  //
  // The bug this pins: update() used to DROP `status: "published"` from the patch and
  // return 200. The CRM's status dropdown offered "published", the toast said
  // "Testimonial updated", and the row stayed a draft, so nothing staff marked as
  // published ever reached the homepage, with no error anywhere to explain why.

  it("rejects publishing via update() instead of silently ignoring it", async () => {
    repository.findById.mockResolvedValue({ ...PUBLISHED_ROW, status: "draft" });

    await expect(
      scopeContextStorage.run(ALL_SCOPE, () =>
        service.update("tenant-1", PUBLISHED_ROW.id, { status: "published" }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    // The critical half of the assertion: it must not have written a partial update and
    // reported success. Nothing is persisted at all.
    expect(repository.update).not.toHaveBeenCalled();
  });

  it("allows UNPUBLISHING via update(), hiding a live testimonial is a plain patch", async () => {
    repository.findById.mockResolvedValue({ ...PUBLISHED_ROW, status: "draft" });

    await scopeContextStorage.run(ALL_SCOPE, () =>
      service.update("tenant-1", PUBLISHED_ROW.id, { status: "draft" }),
    );

    expect(repository.update).toHaveBeenCalledWith(
      PUBLISHED_ROW.id,
      expect.objectContaining({ status: "draft" }),
    );
  });

  it("publish() is what actually sets status to published", async () => {
    repository.findById.mockResolvedValue({ ...PUBLISHED_ROW, status: "draft" });

    await scopeContextStorage.run(ALL_SCOPE, () => service.publish("tenant-1", PUBLISHED_ROW.id));

    expect(repository.update).toHaveBeenCalledWith(PUBLISHED_ROW.id, { status: "published" });
  });

  it("rejects a non-'all' data scope", async () => {
    await expect(
      scopeContextStorage.run({ scope: "own" } as ScopeContext, () =>
        service.list("tenant-1", { page: 1, pageSize: 20 }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
