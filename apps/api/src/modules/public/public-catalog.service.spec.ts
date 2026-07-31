// apps/api/src/modules/public/public-catalog.service.spec.ts
//
// Unit tests for PublicCatalogService.
// Verifies:
//   - Public projection omits ALL forbidden fields (status, isPublic, ogImageKey raw,
//     tenantId, deletedAt, cost, margin, notes, lesson content/video/resources,
//     mentor PII, reviewer PII).
//   - Draft / non-is_public programs → 404 (no existence leak, AC-25).
//   - ogImageKey → CDN URL (raw key never in response).
//   - emiDisplay derived correctly from emi JSON.
//   - curriculumOutline: no content / video / resources in lesson stubs.
//   - mentorBios: no userId/email/phone/branchId.

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { PublicCatalogService } from "./public-catalog.service";
import { PublicRepository } from "./public.repository";
import { VIDEO_PROVIDER } from "../lms/providers/video/video-provider.interface";
import { NoopVideoProvider } from "../lms/providers/video/noop-video.provider";
import { validateEnv } from "../../config/env";

/** The public asset base the code mints against (PUBLIC_ASSET_BASE_URL or the prod CDN). */
function assetUrl(key: string): string {
  const base = (validateEnv().PUBLIC_ASSET_BASE_URL ?? "https://cdn.stimuliiq.com").replace(/\/+$/, "");
  return `${base}/${key}`;
}

// Minimal mock row that matches the repository types
const MOCK_PROGRAM_LIST_ROW = {
  id: "prog-1",
  slug: "web-dev",
  title: "Web Development",
  domain: "tech",
  level: "beginner",
  mode: "live",
  durationWeeks: 12,
  cardSummary: "Learn web dev",
  pricePaise: 1500000,
  emi: { monthly: 25000, months: 6 },
  ratingAvg: 47,
  ratingCount: 120,
  ogImageKey: "programs/web-dev/og.jpg",
};

const MOCK_PROGRAM_DETAIL_ROW = {
  ...MOCK_PROGRAM_LIST_ROW,
  seoTitle: "Web Dev SEO Title",
  seoDescription: "SEO description",
  outcomes: ["Build REST APIs", "Deploy to AWS"],
  brochureKey: "program_brochures/tenant-1/web-dev-brochure.pdf",
};

function buildMockRepository(): jest.Mocked<Partial<PublicRepository>> {
  return {
    getTenantIdBySlug: jest.fn().mockResolvedValue("tenant-1"),
    listPublicPrograms: jest.fn().mockResolvedValue({
      rows: [MOCK_PROGRAM_LIST_ROW],
      nextCursor: null,
    }),
    findPublicProgramBySlug: jest.fn().mockResolvedValue(MOCK_PROGRAM_DETAIL_ROW),
    getPublicCurriculumOutline: jest.fn().mockResolvedValue([
      {
        id: "mod-1",
        title: "Module 1",
        order: 0,
        lessons: [
          { id: "les-1", title: "Intro", type: "video", order: 0, isPreview: true },
        ],
      },
    ]),
    getPublicMentorBios: jest.fn().mockResolvedValue([
      { id: "fac-1", name: "Jane Mentor", avatarKey: "faculty/jane.jpg", expertise: ["React"], company: null, title: null },
    ]),
    getRelatedPrograms: jest.fn().mockResolvedValue([]),
    findPublicMentorById: jest.fn().mockResolvedValue({
      id: "mentor-1",
      fullName: "Asha Rao",
      externalInstitute: "Google",
      expertise: ["React", "System Design", 42], // non-strings must be filtered out
      photoKey: "mentor_photos/tenant-1/asha.jpg",
      title: "Staff Engineer",
      bio: "Builds design systems.",
      yearsExperience: 9,
      socialLinks: { linkedin: "https://linkedin.com/in/asha", junk: "x" },
    }),
  };
}

describe("PublicCatalogService", () => {
  let service: PublicCatalogService;
  let repo: ReturnType<typeof buildMockRepository>;

  beforeEach(async () => {
    repo = buildMockRepository();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublicCatalogService,
        { provide: PublicRepository, useValue: repo },
        // The anonymous lesson-preview path mints signed URLs through VIDEO_PROVIDER.
        // The noop double keeps this suite offline and deterministic.
        { provide: VIDEO_PROVIDER, useValue: new NoopVideoProvider() },
      ],
    }).compile();

    service = module.get<PublicCatalogService>(PublicCatalogService);
  });

  describe("listPrograms", () => {
    it("returns public programs with allowed fields only", async () => {
      const result = await service.listPrograms({ sort: "popularity", limit: 12 });

      expect(result.items).toHaveLength(1);
      const item = result.items[0]!;

      // Allowed fields present
      expect(item.id).toBe("prog-1");
      expect(item.slug).toBe("web-dev");
      expect(item.title).toBe("Web Development");
      expect(item.pricePaise).toBe(1500000);
      expect(item.ratingAvg).toBe(47);
      expect(item.ratingCount).toBe(120);
      expect(item.emiDisplay).toBe("₹250/month × 6"); // derived from emi JSON

      // ogImageKey → CDN URL (raw key NEVER in response)
      expect(item.ogImageUrl).toBe(assetUrl("programs/web-dev/og.jpg"));
      expect(item).not.toHaveProperty("ogImageKey");

      // Forbidden fields absent
      expect(item).not.toHaveProperty("status");
      expect(item).not.toHaveProperty("isPublic");
      expect(item).not.toHaveProperty("tenantId");
      expect(item).not.toHaveProperty("deletedAt");
      expect(item).not.toHaveProperty("createdAt");
      expect(item).not.toHaveProperty("updatedAt");
      expect(item).not.toHaveProperty("cost");
      expect(item).not.toHaveProperty("margin");
      expect(item).not.toHaveProperty("notes");
      expect(item).not.toHaveProperty("emi"); // full emi JSON forbidden; only emiDisplay
      expect(item).not.toHaveProperty("seoTitle");
      expect(item).not.toHaveProperty("seoDescription");
    });

    it("returns empty array when no public programs exist", async () => {
      (repo.listPublicPrograms as jest.Mock).mockResolvedValue({ rows: [], nextCursor: null });
      const result = await service.listPrograms({ sort: "popularity", limit: 12 });
      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
    });

    it("propagates nextCursor for pagination", async () => {
      (repo.listPublicPrograms as jest.Mock).mockResolvedValue({ rows: [MOCK_PROGRAM_LIST_ROW], nextCursor: "prog-1" });
      const result = await service.listPrograms({ sort: "newest", limit: 1 });
      expect(result.nextCursor).toBe("prog-1");
    });

    it("throws NotFoundException when tenant not found", async () => {
      (repo.getTenantIdBySlug as jest.Mock).mockResolvedValue(null);
      await expect(service.listPrograms({ sort: "popularity", limit: 12 })).rejects.toThrow(NotFoundException);
    });
  });

  describe("getProgramBySlug", () => {
    it("returns program detail with allowed fields only", async () => {
      const result = await service.getProgramBySlug("web-dev");

      // Allowed detail-only fields
      expect(result.seoTitle).toBe("Web Dev SEO Title");
      expect(result.seoDescription).toBe("SEO description");
      expect(result.outcomes).toEqual(["Build REST APIs", "Deploy to AWS"]);

      // Forbidden fields absent
      expect(result).not.toHaveProperty("status");
      expect(result).not.toHaveProperty("isPublic");
      expect(result).not.toHaveProperty("ogImageKey");
      expect(result).not.toHaveProperty("tenantId");
      expect(result).not.toHaveProperty("deletedAt");
      expect(result).not.toHaveProperty("emi"); // full JSON forbidden
    });

    it("mints brochureUrl from brochureKey and never exposes the raw key", async () => {
      const result = await service.getProgramBySlug("web-dev");

      expect(result.brochureUrl).toBe(assetUrl("program_brochures/tenant-1/web-dev-brochure.pdf"));
      expect(result).not.toHaveProperty("brochureKey");
    });

    it("returns a null brochureUrl when the program has no brochure", async () => {
      (repo.findPublicProgramBySlug as jest.Mock).mockResolvedValue({
        ...MOCK_PROGRAM_DETAIL_ROW,
        brochureKey: null,
      });

      const result = await service.getProgramBySlug("web-dev");

      expect(result.brochureUrl).toBeNull();
    });

    it("throws NotFoundException for draft/non-public slug (AC-25)", async () => {
      (repo.findPublicProgramBySlug as jest.Mock).mockResolvedValue(null);
      await expect(service.getProgramBySlug("draft-slug")).rejects.toThrow(NotFoundException);
    });

    it("curriculum outline contains only title + isPreview (no content/video)", async () => {
      const result = await service.getProgramBySlug("web-dev");
      const lesson = result.curriculumOutline[0]?.lessons[0];
      expect(lesson).toBeDefined();
      expect(lesson!.title).toBe("Intro");
      expect(lesson!.isPreview).toBe(true);
      // Forbidden
      expect(lesson).not.toHaveProperty("content");
      expect(lesson).not.toHaveProperty("providerAssetId");
      expect(lesson).not.toHaveProperty("storageKey");
    });

    it("mentor bios contain public fields only (no email/phone/userId/branchId)", async () => {
      const result = await service.getProgramBySlug("web-dev");
      const mentor = result.mentorBios[0];
      expect(mentor).toBeDefined();
      expect(mentor!.name).toBe("Jane Mentor");
      expect(mentor!.avatarUrl).toBe(assetUrl("faculty/jane.jpg"));
      // Forbidden
      expect(mentor).not.toHaveProperty("email");
      expect(mentor).not.toHaveProperty("phone");
      expect(mentor).not.toHaveProperty("userId");
      expect(mentor).not.toHaveProperty("branchId");
      expect(mentor).not.toHaveProperty("rating"); // internal rating
    });
  });

  describe("getMentorById", () => {
    it("returns the public mentor card (photoKey → CDN URL, non-string expertise/unknown social keys stripped)", async () => {
      const mentor = await service.getMentorById("mentor-1");

      expect(mentor.id).toBe("mentor-1");
      expect(mentor.fullName).toBe("Asha Rao");
      expect(mentor.externalInstitute).toBe("Google");
      expect(mentor.title).toBe("Staff Engineer");
      expect(mentor.bio).toBe("Builds design systems.");
      expect(mentor.yearsExperience).toBe(9);
      // Non-string expertise entries filtered out
      expect(mentor.expertise).toEqual(["React", "System Design"]);
      // photoKey → CDN URL; raw key never present
      expect(mentor.photoUrl).toBe(assetUrl("mentor_photos/tenant-1/asha.jpg"));
      expect(mentor).not.toHaveProperty("photoKey");
      // Only allow-listed social keys survive
      expect(mentor.socialLinks).toEqual({ linkedin: "https://linkedin.com/in/asha" });
      // Forbidden CRM-internal fields never present
      expect(mentor).not.toHaveProperty("email");
      expect(mentor).not.toHaveProperty("phone");
      expect(mentor).not.toHaveProperty("engagementStatus");
    });

    it("throws NotFoundException for an inactive/unknown id (no existence leak)", async () => {
      (repo.findPublicMentorById as jest.Mock).mockResolvedValue(null);
      await expect(service.getMentorById("nope")).rejects.toThrow(NotFoundException);
    });
  });
});
