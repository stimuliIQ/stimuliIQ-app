// apps/api/src/modules/lms/video-library.service.spec.ts
//
// Unit tests for VideoLibraryService: scope resolution (all vs. assigned-faculty via
// EnrollmentScopeRepository), ingest creates a NEW video for a lesson with none,
// replace-in-place for a lesson that already has one (hard-unique lessonId — see
// video-library.repository.ts file header), IDOR -> 404 for an out-of-scope lesson.

import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Video as VideoRow } from "@prisma/client";
import { VideoLibraryService } from "./video-library.service";
import { VideoLibraryRepository, type VideoWithLesson } from "./video-library.repository";
import { EnrollmentScopeRepository } from "../common-scope/enrollment-scope.repository";
import type { VideoProvider } from "./providers/video/video-provider.interface";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";

// qa-engineer Wave 5 (docs/plans/phase-9-completion.md T41 item 1 — cold-validateEnv
// test-hygiene): this spec is a pure unit test (every collaborator above is mocked) and
// only needs `VideoLibraryService.providerKey()` (video-library.service.ts) to resolve
// SOME value for `VIDEO_PROVIDER` — it never asserts anything about env validation
// itself. Previously it called the REAL `validateEnv()` with no env set up at all, which
// only passed when an earlier spec in the same Jest worker had already warmed the
// module-level cache via ambient exported env vars (DATABASE_URL etc. have no schema
// default — see config/env.ts). Mocking the module at the same specifier every importer
// resolves (this file and video-library.service.ts both `require("../../config/env")`
// from the same `src/modules/lms/` directory, so Jest's module registry treats them as
// the same mocked module) makes this file self-contained with no dependency on
// process.env at all.
jest.mock("../../config/env", () => ({
  validateEnv: () => ({ VIDEO_PROVIDER: "noop" }),
}));

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<VideoLibraryRepository> {
  return {
    findLessonForIngest: jest.fn(),
    promoteLessonToVideo: jest.fn(),
    findActiveVideoByLessonId: jest.fn(),
    createVideo: jest.fn(),
    replaceVideo: jest.fn(),
    updateCaptions: jest.fn(),
    list: jest.fn(),
    findById: jest.fn(),
    findOwnFacultyProfileId: jest.fn(),
  } as unknown as Mocked<VideoLibraryRepository>;
}

function mockScopeRepository(): Mocked<EnrollmentScopeRepository> {
  return { resolveProgramIdsForFaculty: jest.fn() } as unknown as Mocked<EnrollmentScopeRepository>;
}

function mockVideoProvider(): Mocked<VideoProvider> {
  return {
    mintSignedHlsUrl: jest.fn(),
    verifyWebhookSignature: jest.fn(),
    parseTranscodeEvent: jest.fn(),
    createUploadTarget: jest.fn(),
  } as unknown as Mocked<VideoProvider>;
}

const VIDEO_ROW: VideoRow = {
  id: "video-1",
  tenantId: "tenant-1",
  lessonId: "lesson-1",
  provider: "noop",
  providerAssetId: "asset-1",
  durationS: null,
  status: "processing",
  captions: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  deletedAt: null,
};

const VIDEO_WITH_LESSON: VideoWithLesson = {
  ...VIDEO_ROW,
  lesson: { id: "lesson-1", title: "Intro to CSS", module: { programId: "program-1" } },
};

function runWithScope<T>(scope: ScopeContext["scope"], fn: () => T): T {
  const ctx: ScopeContext = { permissionKey: "videolib.upload", scope, actorId: "faculty-user-1", tenantId: "tenant-1" };
  return scopeContextStorage.run(ctx, fn);
}

describe("VideoLibraryService", () => {
  let service: VideoLibraryService;
  let repo: Mocked<VideoLibraryRepository>;
  let scopeRepo: Mocked<EnrollmentScopeRepository>;
  let videoProvider: Mocked<VideoProvider>;

  beforeEach(() => {
    repo = mockRepository();
    scopeRepo = mockScopeRepository();
    videoProvider = mockVideoProvider();
    service = new VideoLibraryService(
      repo as unknown as VideoLibraryRepository,
      scopeRepo as unknown as EnrollmentScopeRepository,
      videoProvider as unknown as VideoProvider,
    );
  });

  describe("scope resolution", () => {
    it("rejects an unresolvable scope (e.g. own)", async () => {
      await expect(runWithScope("own", () => service.list("tenant-1", "actor-1", { page: 1, pageSize: 20 }))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it("fails closed to zero programs when the assigned-scope caller has no faculty profile", async () => {
      repo.findOwnFacultyProfileId.mockResolvedValue(null);
      repo.list.mockResolvedValue({ rows: [], total: 0 });

      await runWithScope("assigned", () => service.list("tenant-1", "faculty-user-1", { page: 1, pageSize: 20 }));
      expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ restrictToProgramIds: [] }));
    });
  });

  describe("create() — ingest", () => {
    it("404s (IDOR) when the lesson does not exist", async () => {
      repo.findLessonForIngest.mockResolvedValue(null);
      await expect(
        runWithScope("all", () => service.create("tenant-1", "actor-1", { lessonId: "missing-lesson" })),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("404s (IDOR) when the lesson's program is outside the faculty caller's assigned programs", async () => {
      repo.findOwnFacultyProfileId.mockResolvedValue("faculty-1");
      scopeRepo.resolveProgramIdsForFaculty.mockResolvedValue(["other-program"]);
      repo.findLessonForIngest.mockResolvedValue({ id: "lesson-1", title: "Intro to CSS", programId: "program-1" });

      await expect(
        runWithScope("assigned", () => service.create("tenant-1", "faculty-user-1", { lessonId: "lesson-1" })),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("creates a NEW video row when the lesson has none yet", async () => {
      repo.findLessonForIngest.mockResolvedValue({ id: "lesson-1", title: "Intro to CSS", programId: "program-1" });
      repo.findActiveVideoByLessonId.mockResolvedValue(null);
      videoProvider.createUploadTarget.mockResolvedValue({ uploadUrl: "https://upload.example/1", providerAssetId: "asset-1" });
      repo.createVideo.mockResolvedValue(VIDEO_ROW);
      repo.findById.mockResolvedValue(VIDEO_WITH_LESSON);

      const result = await runWithScope("all", () => service.create("tenant-1", "actor-1", { lessonId: "lesson-1" }));
      expect(result.uploadUrl).toBe("https://upload.example/1");
      expect(repo.createVideo).toHaveBeenCalled();
      expect(repo.replaceVideo).not.toHaveBeenCalled();
    });

    // The LMS renders a player only for `type === "video"` (lesson-detail-content.tsx), and
    // the CRM lets an author attach to ANY lesson — so without this the upload completes,
    // the transcode finishes, and the student sees a reading page with no video on it.
    it("makes the lesson a video lesson, so the upload is actually visible to students", async () => {
      repo.findLessonForIngest.mockResolvedValue({ id: "lesson-1", title: "Intro to CSS", programId: "program-1" });
      repo.findActiveVideoByLessonId.mockResolvedValue(null);
      videoProvider.createUploadTarget.mockResolvedValue({ uploadUrl: "https://upload.example/1", providerAssetId: "asset-1" });
      repo.createVideo.mockResolvedValue(VIDEO_ROW);
      repo.findById.mockResolvedValue(VIDEO_WITH_LESSON);

      await runWithScope("all", () => service.create("tenant-1", "actor-1", { lessonId: "lesson-1" }));

      expect(repo.promoteLessonToVideo).toHaveBeenCalledWith("lesson-1");
    });

    // Promotion must never run for a lesson the caller isn't allowed to touch.
    it("does not touch the lesson when the ingest is refused for scope", async () => {
      repo.findLessonForIngest.mockResolvedValue({ id: "lesson-x", title: "Other course", programId: "program-999" });

      await expect(
        runWithScope("assigned", () => service.create("tenant-1", "actor-1", { lessonId: "lesson-x" })),
      ).rejects.toBeTruthy();

      expect(repo.promoteLessonToVideo).not.toHaveBeenCalled();
    });

    it("REPLACES IN PLACE (never creates a second row) when the lesson already has an active video", async () => {
      repo.findLessonForIngest.mockResolvedValue({ id: "lesson-1", title: "Intro to CSS", programId: "program-1" });
      repo.findActiveVideoByLessonId.mockResolvedValue(VIDEO_ROW);
      videoProvider.createUploadTarget.mockResolvedValue({ uploadUrl: "https://upload.example/2", providerAssetId: "asset-2" });
      repo.replaceVideo.mockResolvedValue({ ...VIDEO_ROW, providerAssetId: "asset-2" });
      repo.findById.mockResolvedValue(VIDEO_WITH_LESSON);

      await runWithScope("all", () => service.create("tenant-1", "actor-1", { lessonId: "lesson-1" }));
      expect(repo.replaceVideo).toHaveBeenCalledWith("video-1", expect.objectContaining({ providerAssetId: "asset-2" }));
      expect(repo.createVideo).not.toHaveBeenCalled();
    });
  });

  describe("attachCaptions()", () => {
    it("404s for a video outside the caller's scope", async () => {
      repo.findOwnFacultyProfileId.mockResolvedValue("faculty-1");
      scopeRepo.resolveProgramIdsForFaculty.mockResolvedValue(["other-program"]);
      repo.findById.mockResolvedValue(VIDEO_WITH_LESSON);

      await expect(
        runWithScope("assigned", () => service.attachCaptions("tenant-1", "faculty-user-1", "video-1", { captions: [] })),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("updates captions when in scope", async () => {
      repo.findById.mockResolvedValue(VIDEO_WITH_LESSON);
      repo.updateCaptions.mockResolvedValue(VIDEO_ROW);

      const captions = [{ language: "en", url: "https://cdn.example/en.vtt" }];
      await runWithScope("all", () => service.attachCaptions("tenant-1", "actor-1", "video-1", { captions }));
      expect(repo.updateCaptions).toHaveBeenCalledWith("video-1", captions);
    });
  });
});
