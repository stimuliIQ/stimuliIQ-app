// apps/api/src/modules/lms/lms.service.spec.ts
//
// Unit tests for the LMS content module (docs/04 §2.1 DoD rule 10).
//
// CRITICAL TESTS (docs/plans/phase-3.md task #5 DoD):
//   1. resolveEnrollmentForLesson — the enrollment-scope gate.
//      a. Enrolled student + non-preview → returns enrollment.
//      b. Not enrolled + non-preview → returns null (caller 404s).
//      c. Not enrolled + preview lesson → returns gate with enrollment=null.
//      d. Another student's enrollment cannot satisfy the gate for userId.
//   2. stream-url — the security-critical mint flow.
//      a. Enrolled student + ready video → mints via Noop, returns url/expiresAt/watermark.
//      b. Not enrolled → NotFoundException (404).
//      c. Video not ready → ConflictException (409).
//      d. Provider throws → ServiceUnavailableException (503, NOT a raw URL).
//      e. Response contains no provider_asset_id, no raw/unsigned URL.
//   3. curriculum/dashboard enrollment-scoping:
//      a. getCurriculum for wrong student → NotFoundException.
//      b. getDashboard returns only this student's enrollments.
//   4. Webhook fail-closed + idempotent:
//      a. Invalid signature → 401.
//      b. Valid signature + ready event → updates video status.
//      c. Replayed event with same status → no-op.

import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { resolveEnrollmentForLesson } from "./lms-enrollment-gate";
import { LmsService } from "./lms.service";
import type { LmsRepository, EnrollmentRow, VideoRow, LessonRow } from "./lms.repository";
import { NoopVideoProvider } from "./providers/video/noop-video.provider";
import { NoopStorageProvider } from "../storage/providers/storage/noop-storage.provider";
import { SyncVideoWebhookProcessorAdapter } from "./lms-video-webhook.seam";
import { VideoWebhookController } from "./video-webhook.controller";
import { UnauthorizedException } from "@nestjs/common";
import type { VideoProvider } from "./providers/video/video-provider.interface";
import type { PrismaService } from "../../prisma/prisma.service";

// ─── Test helpers ──────────────────────────────────────────────────────────────

type MockRepo = jest.Mocked<LmsRepository>;
type MockPrisma = { client: { auditLog: { create: jest.Mock } } };

function makeRepo(): MockRepo {
  return {
    findLessonById: jest.fn(),
    findStudentProfileId: jest.fn(),
    findActiveEnrollmentForProgram: jest.fn(),
    findEnrollmentByIdForStudent: jest.fn(),
    listEnrollmentsForStudent: jest.fn(),
    getCurriculumForProgram: jest.fn(),
    getLessonProgressForEnrollment: jest.fn(),
    getLessonProgress: jest.fn(),
    getMostRecentInProgressLesson: jest.fn(),
    countLessonsForProgram: jest.fn(),
    countCompletedLessonsForEnrollment: jest.fn(),
    getNextUnstartedLesson: jest.fn(),
    findVideoByProviderAssetId: jest.fn(),
    findVideoForLesson: jest.fn(),
    updateVideoTranscodeStatus: jest.fn(),
    getStudentDisplayInfo: jest.fn(),
    findAdjacentLessons: jest.fn(),
    findResourceById: jest.fn(),
  } as unknown as MockRepo;
}

function makePrisma(): MockPrisma {
  return {
    client: {
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    },
  };
}

const TENANT_ID = "tenant-aaa";
const USER_ID = "user-111";
const STUDENT_ID = "student-111";
const LESSON_ID = "lesson-aaa";
const MODULE_ID = "module-aaa";
const PROGRAM_ID = "program-aaa";
const ENROLLMENT_ID = "enrollment-aaa";

function makeLesson(override: Partial<{ isPreview: boolean }> = {}): LessonRow {
  return {
    id: LESSON_ID,
    moduleId: MODULE_ID,
    title: "Test Lesson",
    type: "video",
    order: 1,
    content: null,
    isPreview: override.isPreview ?? false,
    module: {
      id: MODULE_ID,
      title: "Module 1",
      order: 0,
      program: {
        id: PROGRAM_ID,
        title: "Full-Stack Program",
        slug: "fullstack",
        durationWeeks: 12,
        level: "beginner",
        domain: "web",
      },
    },
    video: {
      id: "video-aaa",
      lessonId: LESSON_ID,
      provider: "noop",
      providerAssetId: "noop-asset-123",
      durationS: 120,
      status: "ready",
      captions: null,
    },
    resources: [],
  };
}

function makeEnrollment(): EnrollmentRow {
  return {
    id: ENROLLMENT_ID,
    tenantId: TENANT_ID,
    studentId: STUDENT_ID,
    batchId: "batch-aaa",
    programId: PROGRAM_ID,
    status: "active",
    progressPct: 0,
    enrolledAt: new Date("2026-01-01"),
    completedAt: null,
    source: "manual",
    batch: {
      id: "batch-aaa",
      name: "HYD-01",
      startDate: new Date("2026-01-12"),
      endDate: null,
    },
    program: {
      id: PROGRAM_ID,
      title: "Full-Stack Program",
      slug: "fullstack",
      domain: "web",
      level: "beginner",
      durationWeeks: 12,
      mode: "hybrid",
      ogImageKey: null,
    },
  };
}

function makeVideo(status: "processing" | "ready" | "errored" = "ready"): VideoRow {
  return {
    id: "video-aaa",
    lessonId: LESSON_ID,
    provider: "noop",
    providerAssetId: "noop-asset-123",
    durationS: 120,
    status,
    captions: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. resolveEnrollmentForLesson gate tests
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveEnrollmentForLesson (enrollment-scope gate)", () => {
  let repo: MockRepo;

  beforeEach(() => {
    repo = makeRepo();
  });

  it("returns enrollment for an enrolled student on a non-preview lesson", async () => {
    repo.findLessonById.mockResolvedValue(makeLesson({ isPreview: false }));
    repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
    repo.findActiveEnrollmentForProgram.mockResolvedValue(makeEnrollment());

    const result = await resolveEnrollmentForLesson(USER_ID, TENANT_ID, LESSON_ID, repo);

    expect(result).not.toBeNull();
    expect(result!.enrollment).not.toBeNull();
    expect(result!.enrollment!.id).toBe(ENROLLMENT_ID);
    expect(result!.isPreview).toBe(false);
  });

  it("returns null for a non-enrolled student on a non-preview lesson (→ caller 404s)", async () => {
    repo.findLessonById.mockResolvedValue(makeLesson({ isPreview: false }));
    repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
    repo.findActiveEnrollmentForProgram.mockResolvedValue(null); // not enrolled

    const result = await resolveEnrollmentForLesson(USER_ID, TENANT_ID, LESSON_ID, repo);

    expect(result).toBeNull(); // caller must 404
  });

  it("returns gate with enrollment=null for preview lessons (no enrollment required)", async () => {
    repo.findLessonById.mockResolvedValue(makeLesson({ isPreview: true }));
    repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
    repo.findActiveEnrollmentForProgram.mockResolvedValue(null); // not enrolled

    const result = await resolveEnrollmentForLesson(USER_ID, TENANT_ID, LESSON_ID, repo);

    expect(result).not.toBeNull();
    expect(result!.enrollment).toBeNull(); // no enrollment, but preview = open
    expect(result!.isPreview).toBe(true);
  });

  it("returns null if lesson does not exist", async () => {
    repo.findLessonById.mockResolvedValue(null);

    const result = await resolveEnrollmentForLesson(USER_ID, TENANT_ID, LESSON_ID, repo);

    expect(result).toBeNull();
  });

  it("gates on the requesting userId — another student's enrollment does not grant access", async () => {
    // USER_ID resolves to no student profile (not a student in this tenant).
    repo.findLessonById.mockResolvedValue(makeLesson({ isPreview: false }));
    repo.findStudentProfileId.mockResolvedValue(null); // no profile for this user
    // Even if there IS an enrollment for a different student, it won't be found
    // because the query is on (tenantId, studentId = null which won't be used).

    const result = await resolveEnrollmentForLesson(USER_ID, TENANT_ID, LESSON_ID, repo);

    expect(result).toBeNull();
    // findActiveEnrollmentForProgram should NOT have been called (no studentId).
    expect(repo.findActiveEnrollmentForProgram).not.toHaveBeenCalled();
  });

  it("gates on own enrollment in the lesson's program — cross-program enrollment does not grant access", async () => {
    repo.findLessonById.mockResolvedValue(makeLesson({ isPreview: false }));
    repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
    repo.findActiveEnrollmentForProgram.mockResolvedValue(null); // enrolled in a DIFFERENT program

    const result = await resolveEnrollmentForLesson(USER_ID, TENANT_ID, LESSON_ID, repo);

    expect(result).toBeNull(); // caller 404s
    // Verify the query was for the lesson's program, not a client-supplied one.
    expect(repo.findActiveEnrollmentForProgram).toHaveBeenCalledWith(TENANT_ID, STUDENT_ID, PROGRAM_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. stream-url mint flow (the security-critical endpoint)
// ─────────────────────────────────────────────────────────────────────────────

describe("LmsService.mintStreamUrl (stream-url security-critical flow)", () => {
  let repo: MockRepo;
  let prisma: MockPrisma;
  let noopProvider: NoopVideoProvider;
  let service: LmsService;

  beforeEach(() => {
    repo = makeRepo();
    prisma = makePrisma();
    noopProvider = new NoopVideoProvider();
    service = new LmsService(
      repo as unknown as LmsRepository,
      prisma as unknown as PrismaService,
      noopProvider,
      new NoopStorageProvider(),
    );
  });

  it("enrolled student + ready video → mints URL via NoopProvider and returns url/expiresAt/watermark", async () => {
    repo.findLessonById.mockResolvedValue(makeLesson({ isPreview: false }));
    repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
    repo.findActiveEnrollmentForProgram.mockResolvedValue(makeEnrollment());
    repo.findVideoForLesson.mockResolvedValue(makeVideo("ready"));
    repo.getStudentDisplayInfo.mockResolvedValue({ id: USER_ID, name: "Ananya Gupta" });

    const result = await service.mintStreamUrl(USER_ID, TENANT_ID, LESSON_ID);

    // Must have a url, expiresAt, provider, and watermark.
    expect(result.url).toBeTruthy();
    expect(result.expiresAt).toBeTruthy();
    expect(result.provider).toBe("noop");
    expect(result.watermark).toBeDefined();
    expect(result.watermark.text).toContain("Ananya Gupta");
    expect(result.watermark.studentId).toBe(USER_ID);
  });

  it("enrolled student + ready video → StreamUrlResponse never exposes provider_asset_id as a top-level field", async () => {
    repo.findLessonById.mockResolvedValue(makeLesson({ isPreview: false }));
    repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
    repo.findActiveEnrollmentForProgram.mockResolvedValue(makeEnrollment());
    repo.findVideoForLesson.mockResolvedValue(makeVideo("ready"));
    repo.getStudentDisplayInfo.mockResolvedValue({ id: USER_ID, name: "Ananya Gupta" });

    const result = await service.mintStreamUrl(USER_ID, TENANT_ID, LESSON_ID);

    // The response object must never have a 'providerAssetId' field.
    // (The Noop provider embeds the assetId in the URL path — that's its fake-URL format.
    // The real security property is that the raw DB `providerAssetId` is NEVER returned
    // as a top-level response field or key; only the signed URL from the provider is returned.)
    expect(result).not.toHaveProperty("providerAssetId");
    expect(result).not.toHaveProperty("assetId");
    // The URL IS a (fake) signed URL from the provider — that's the expected output.
    expect(result.url).toMatch(/^https:\/\/noop\.video\.local\/hls\//);
    // It has the expected token shape (user+lesson scoped).
    expect(result.url).toContain(`noop-signed-${USER_ID}-${LESSON_ID}`);
  });

  it("not enrolled → throws NotFoundException (404, no existence disclosure)", async () => {
    repo.findLessonById.mockResolvedValue(makeLesson({ isPreview: false }));
    repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
    repo.findActiveEnrollmentForProgram.mockResolvedValue(null); // not enrolled

    await expect(service.mintStreamUrl(USER_ID, TENANT_ID, LESSON_ID))
      .rejects.toThrow(NotFoundException);
  });

  it("video not ready (processing) → throws ConflictException (409), never mints", async () => {
    repo.findLessonById.mockResolvedValue(makeLesson({ isPreview: false }));
    repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
    repo.findActiveEnrollmentForProgram.mockResolvedValue(makeEnrollment());
    repo.findVideoForLesson.mockResolvedValue(makeVideo("processing")); // not ready

    await expect(service.mintStreamUrl(USER_ID, TENANT_ID, LESSON_ID))
      .rejects.toThrow(ConflictException);
  });

  it("video not ready (errored) → throws ConflictException (409), never mints", async () => {
    repo.findLessonById.mockResolvedValue(makeLesson({ isPreview: false }));
    repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
    repo.findActiveEnrollmentForProgram.mockResolvedValue(makeEnrollment());
    repo.findVideoForLesson.mockResolvedValue(makeVideo("errored")); // errored

    await expect(service.mintStreamUrl(USER_ID, TENANT_ID, LESSON_ID))
      .rejects.toThrow(ConflictException);
  });

  it("no video row → throws ConflictException (409), never mints", async () => {
    repo.findLessonById.mockResolvedValue(makeLesson({ isPreview: false }));
    repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
    repo.findActiveEnrollmentForProgram.mockResolvedValue(makeEnrollment());
    repo.findVideoForLesson.mockResolvedValue(null); // no video

    await expect(service.mintStreamUrl(USER_ID, TENANT_ID, LESSON_ID))
      .rejects.toThrow(ConflictException);
  });

  it("provider throws (keys absent/unconfigured) → throws ServiceUnavailableException (503), NEVER a raw URL", async () => {
    repo.findLessonById.mockResolvedValue(makeLesson({ isPreview: false }));
    repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
    repo.findActiveEnrollmentForProgram.mockResolvedValue(makeEnrollment());
    repo.findVideoForLesson.mockResolvedValue(makeVideo("ready"));
    repo.getStudentDisplayInfo.mockResolvedValue({ id: USER_ID, name: "Ananya Gupta" });

    // Mock a provider that throws (simulating unconfigured keys).
    const failingProvider: VideoProvider = {
      mintSignedHlsUrl: jest.fn().mockRejectedValue(new Error("Video signing key not configured")),
      verifyWebhookSignature: jest.fn().mockReturnValue(false),
      parseTranscodeEvent: jest.fn().mockReturnValue(null),
      createUploadTarget: jest.fn().mockRejectedValue(new Error("not implemented")),
    };

    const failingService = new LmsService(
      repo as unknown as LmsRepository,
      prisma as unknown as PrismaService,
      failingProvider,
      new NoopStorageProvider(),
    );

    await expect(failingService.mintStreamUrl(USER_ID, TENANT_ID, LESSON_ID))
      .rejects.toThrow(ServiceUnavailableException);
  });

  it("preview lesson + enrolled → mints URL (preview is open with OR without enrollment)", async () => {
    repo.findLessonById.mockResolvedValue(makeLesson({ isPreview: true }));
    repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
    repo.findActiveEnrollmentForProgram.mockResolvedValue(makeEnrollment()); // enrolled (both are fine)
    repo.findVideoForLesson.mockResolvedValue(makeVideo("ready"));
    repo.getStudentDisplayInfo.mockResolvedValue({ id: USER_ID, name: "Ananya Gupta" });

    const result = await service.mintStreamUrl(USER_ID, TENANT_ID, LESSON_ID);
    expect(result.url).toBeTruthy();
  });

  it("audit log is written after successful mint", async () => {
    repo.findLessonById.mockResolvedValue(makeLesson({ isPreview: false }));
    repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
    repo.findActiveEnrollmentForProgram.mockResolvedValue(makeEnrollment());
    repo.findVideoForLesson.mockResolvedValue(makeVideo("ready"));
    repo.getStudentDisplayInfo.mockResolvedValue({ id: USER_ID, name: "Ananya Gupta" });

    await service.mintStreamUrl(USER_ID, TENANT_ID, LESSON_ID);

    expect(prisma.client.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "video.stream_url_minted",
          entity: "Lesson",
          entityId: LESSON_ID,
          actorId: USER_ID,
        }),
      }),
    );

    // Verify the signed URL is NOT in the audit log.
    const auditCall = prisma.client.auditLog.create.mock.calls[0][0];
    expect(JSON.stringify(auditCall)).not.toMatch(/noop-signed/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Curriculum + dashboard enrollment scoping
// ─────────────────────────────────────────────────────────────────────────────

describe("LmsService — curriculum enrollment scoping (IDOR prevention)", () => {
  let repo: MockRepo;
  let service: LmsService;

  beforeEach(() => {
    repo = makeRepo();
    const prisma = makePrisma();
    service = new LmsService(
      repo as unknown as LmsRepository,
      prisma as unknown as PrismaService,
      new NoopVideoProvider(),
      new NoopStorageProvider(),
    );
  });

  it("getCurriculum → 404 if enrollment belongs to a different student", async () => {
    repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
    repo.findEnrollmentByIdForStudent.mockResolvedValue(null); // doesn't belong to this student

    await expect(service.getCurriculum(USER_ID, TENANT_ID, ENROLLMENT_ID))
      .rejects.toThrow(NotFoundException);
  });

  it("getCurriculum → success when enrollment belongs to the correct student", async () => {
    repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
    repo.findEnrollmentByIdForStudent.mockResolvedValue(makeEnrollment());
    repo.getCurriculumForProgram.mockResolvedValue({
      id: PROGRAM_ID,
      title: "Full-Stack Program",
      slug: "fullstack",
      modules: [],
    });
    repo.getLessonProgressForEnrollment.mockResolvedValue([]);

    const result = await service.getCurriculum(USER_ID, TENANT_ID, ENROLLMENT_ID);
    expect(result.enrollmentId).toBe(ENROLLMENT_ID);
    expect(result.programId).toBe(PROGRAM_ID);
  });

  it("getEnrollmentById → 404 if enrollment belongs to a different student", async () => {
    repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
    repo.findEnrollmentByIdForStudent.mockResolvedValue(null); // IDOR → null

    await expect(service.getEnrollmentById(USER_ID, TENANT_ID, ENROLLMENT_ID))
      .rejects.toThrow(NotFoundException);
  });

  it("getDashboard → returns only the student's own enrollments", async () => {
    repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
    repo.listEnrollmentsForStudent.mockResolvedValue({
      rows: [makeEnrollment()],
      total: 1,
    });
    repo.getMostRecentInProgressLesson.mockResolvedValue(null);
    repo.countLessonsForProgram.mockResolvedValue(10);
    repo.countCompletedLessonsForEnrollment.mockResolvedValue(3);
    repo.getLessonProgressForEnrollment.mockResolvedValue([]);
    repo.getNextUnstartedLesson.mockResolvedValue(null);

    const result = await service.getDashboard(USER_ID, TENANT_ID);

    // Verify the listEnrollmentsForStudent was called for this studentId only.
    expect(repo.listEnrollmentsForStudent).toHaveBeenCalledWith(
      TENANT_ID,
      STUDENT_ID,
      expect.any(Object),
    );
    expect(result.enrollments).toHaveLength(1);
    expect(result.totalEnrollments).toBe(1);
  });

  it("getDashboard → empty dashboard when user has no student profile", async () => {
    repo.findStudentProfileId.mockResolvedValue(null); // not a student

    const result = await service.getDashboard(USER_ID, TENANT_ID);

    expect(result.enrollments).toHaveLength(0);
    expect(result.continueLearning).toBeNull();
    expect(result.totalEnrollments).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3b. getResourceDownloadUrl — closes the P4 follow-up TODO (Phase-9-completion gap #2)
// ─────────────────────────────────────────────────────────────────────────────

describe("LmsService.getResourceDownloadUrl (signed download URL mint)", () => {
  let repo: MockRepo;
  let prisma: MockPrisma;
  let service: LmsService;
  const RESOURCE_ID = "resource-aaa";

  beforeEach(() => {
    repo = makeRepo();
    prisma = makePrisma();
    service = new LmsService(
      repo as unknown as LmsRepository,
      prisma as unknown as PrismaService,
      new NoopVideoProvider(),
      new NoopStorageProvider(),
    );
  });

  it("enrolled student + valid resource → mints a signed URL, never the raw storage key", async () => {
    repo.findLessonById.mockResolvedValue(makeLesson({ isPreview: false }));
    repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
    repo.findActiveEnrollmentForProgram.mockResolvedValue(makeEnrollment());
    repo.findResourceById.mockResolvedValue({
      id: RESOURCE_ID,
      title: "Week 1 slides.pdf",
      type: "slide",
      storageKey: "resources/tenant-aaa/lesson-aaa/week1.pdf",
    });

    const result = await service.getResourceDownloadUrl(USER_ID, TENANT_ID, LESSON_ID, RESOURCE_ID);

    expect(result.downloadUrl).toBeTruthy();
    expect(result.expiresAt).toBeTruthy();
    expect(result.filename).toBe("Week 1 slides.pdf");
    expect(result).not.toHaveProperty("storageKey");
    expect(JSON.stringify(result)).not.toContain("resources/tenant-aaa/lesson-aaa/week1.pdf");
  });

  it("preview lesson (no enrollment required) → still mints a URL", async () => {
    repo.findLessonById.mockResolvedValue(makeLesson({ isPreview: true }));
    repo.findStudentProfileId.mockResolvedValue(null);
    repo.findResourceById.mockResolvedValue({
      id: RESOURCE_ID,
      title: "Free preview handout.pdf",
      type: "pdf",
      storageKey: "resources/tenant-aaa/lesson-aaa/preview.pdf",
    });

    const result = await service.getResourceDownloadUrl(USER_ID, TENANT_ID, LESSON_ID, RESOURCE_ID);
    expect(result.downloadUrl).toBeTruthy();
  });

  it("not enrolled and not preview → NotFoundException (404, no existence disclosure)", async () => {
    repo.findLessonById.mockResolvedValue(makeLesson({ isPreview: false }));
    repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
    repo.findActiveEnrollmentForProgram.mockResolvedValue(null);

    await expect(service.getResourceDownloadUrl(USER_ID, TENANT_ID, LESSON_ID, RESOURCE_ID)).rejects.toThrow(
      NotFoundException,
    );
    expect(repo.findResourceById).not.toHaveBeenCalled();
  });

  it("resource does not belong to this lesson → NotFoundException (404)", async () => {
    repo.findLessonById.mockResolvedValue(makeLesson({ isPreview: false }));
    repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
    repo.findActiveEnrollmentForProgram.mockResolvedValue(makeEnrollment());
    repo.findResourceById.mockResolvedValue(null);

    await expect(service.getResourceDownloadUrl(USER_ID, TENANT_ID, LESSON_ID, RESOURCE_ID)).rejects.toThrow(
      NotFoundException,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Webhook controller — fail-closed + idempotency via SyncAdapter
// ─────────────────────────────────────────────────────────────────────────────

describe("VideoWebhookController — fail-closed + idempotency", () => {
  let repo: MockRepo;
  let noopProvider: NoopVideoProvider;
  let webhookAdapter: SyncVideoWebhookProcessorAdapter;
  let controller: VideoWebhookController;

  beforeEach(() => {
    repo = makeRepo();
    noopProvider = new NoopVideoProvider();
    webhookAdapter = new SyncVideoWebhookProcessorAdapter(repo as unknown as LmsRepository);
    controller = new VideoWebhookController(noopProvider, webhookAdapter);
  });

  it("invalid signature → UnauthorizedException (401, fail closed)", async () => {
    const rawBody = Buffer.from('{"uid":"asset-1","readyToStream":true}');
    const invalidSig = "definitely-invalid-signature";

    const req = { rawBody, body: {} } as unknown as import("@nestjs/common").RawBodyRequest<import("express").Request>;

    await expect(
      controller.handleTranscodeWebhook(req, invalidSig, undefined),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("valid signature → processes the event and returns { received: true }", async () => {
    const rawBody = Buffer.from(JSON.stringify({ uid: "asset-123", readyToStream: true, duration: 90 }));
    const validSig = NoopVideoProvider.makeWebhookSignature(rawBody);

    repo.findVideoByProviderAssetId.mockResolvedValue({
      id: "video-aaa",
      status: "processing",
      durationS: null,
    });
    repo.updateVideoTranscodeStatus.mockResolvedValue(undefined);

    const req = {
      rawBody,
      body: JSON.parse(rawBody.toString()),
    } as unknown as import("@nestjs/common").RawBodyRequest<import("express").Request>;

    const result = await controller.handleTranscodeWebhook(req, validSig, undefined);

    expect(result).toEqual({ received: true });
    expect(repo.updateVideoTranscodeStatus).toHaveBeenCalledWith(
      "video-aaa",
      expect.objectContaining({ status: "ready" }),
    );
  });

  it("idempotency — replaying the same event with same status → no DB update", async () => {
    const rawBody = Buffer.from(JSON.stringify({ uid: "asset-123", readyToStream: true }));
    const validSig = NoopVideoProvider.makeWebhookSignature(rawBody);

    // Video is ALREADY in the ready state.
    repo.findVideoByProviderAssetId.mockResolvedValue({
      id: "video-aaa",
      status: "ready",
      durationS: null,
    });

    const req = {
      rawBody,
      body: JSON.parse(rawBody.toString()),
    } as unknown as import("@nestjs/common").RawBodyRequest<import("express").Request>;

    await controller.handleTranscodeWebhook(req, validSig, undefined);

    // No update should have been called.
    expect(repo.updateVideoTranscodeStatus).not.toHaveBeenCalled();
  });

  it("absent rawBody → BadRequestException", async () => {
    const { BadRequestException } = await import("@nestjs/common");

    const req = {
      rawBody: undefined,
      body: {},
    } as unknown as import("@nestjs/common").RawBodyRequest<import("express").Request>;

    await expect(
      controller.handleTranscodeWebhook(req, "some-sig", undefined),
    ).rejects.toThrow(BadRequestException);
  });

  it("non-transcode event → ignores safely (received: true, no DB update)", async () => {
    const rawBody = Buffer.from(JSON.stringify({ type: "some.other.event", data: {} }));
    const validSig = NoopVideoProvider.makeWebhookSignature(rawBody);

    const req = {
      rawBody,
      body: JSON.parse(rawBody.toString()),
    } as unknown as import("@nestjs/common").RawBodyRequest<import("express").Request>;

    const result = await controller.handleTranscodeWebhook(req, validSig, undefined);

    expect(result).toEqual({ received: true });
    expect(repo.updateVideoTranscodeStatus).not.toHaveBeenCalled();
  });

  it("fail-closed when webhook secret is absent (simulated via simulateWebhookSecretAbsent)", async () => {
    const failClosedProvider = new NoopVideoProvider({ simulateWebhookSecretAbsent: true });
    const failClosedController = new VideoWebhookController(
      failClosedProvider,
      webhookAdapter,
    );

    const rawBody = Buffer.from(JSON.stringify({ uid: "asset-1", readyToStream: true }));
    const validSigForDefaultSecret = NoopVideoProvider.makeWebhookSignature(rawBody);

    const req = {
      rawBody,
      body: JSON.parse(rawBody.toString()),
    } as unknown as import("@nestjs/common").RawBodyRequest<import("express").Request>;

    // Even with a "valid" sig for the default secret, fail-closed provider rejects.
    await expect(
      failClosedController.handleTranscodeWebhook(req, validSigForDefaultSecret, undefined),
    ).rejects.toThrow(UnauthorizedException);
  });
});

describe("LmsService.getLearningPath (own-scope next-up steps)", () => {
  let repo: MockRepo;
  let service: LmsService;

  beforeEach(() => {
    repo = makeRepo();
    service = new LmsService(
      repo as unknown as LmsRepository,
      makePrisma() as unknown as PrismaService,
      new NoopVideoProvider(),
      new NoopStorageProvider(),
    );
  });

  it("returns one next-up step per active enrollment (marked isNextUp)", async () => {
    repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
    repo.listEnrollmentsForStudent.mockResolvedValue({ rows: [makeEnrollment()], total: 1 });
    repo.getLessonProgressForEnrollment.mockResolvedValue([]);
    repo.getNextUnstartedLesson.mockResolvedValue({
      id: LESSON_ID,
      title: "Test Lesson",
      moduleId: MODULE_ID,
      moduleTitle: "Module 1",
      order: 2,
      type: "video",
      durationS: 120,
      hasVideo: true,
    });

    const result = await service.getLearningPath(USER_ID, TENANT_ID);

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({
      enrollmentId: ENROLLMENT_ID,
      programId: PROGRAM_ID,
      programTitle: "Full-Stack Program",
      lessonId: LESSON_ID,
      moduleTitle: "Module 1",
      status: "not_started",
      isNextUp: true,
    });
  });

  it("returns an empty path when the user is not a student", async () => {
    repo.findStudentProfileId.mockResolvedValue(null);
    const result = await service.getLearningPath(USER_ID, TENANT_ID);
    expect(result.steps).toEqual([]);
    expect(repo.listEnrollmentsForStudent).not.toHaveBeenCalled();
  });

  it("skips enrollments with no next lesson (fully completed) and non-active enrollments", async () => {
    repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
    repo.listEnrollmentsForStudent.mockResolvedValue({
      rows: [makeEnrollment(), { ...makeEnrollment(), id: "enrollment-done", status: "completed" }],
      total: 2,
    });
    repo.getLessonProgressForEnrollment.mockResolvedValue([]);
    repo.getNextUnstartedLesson.mockResolvedValue(null); // active enrollment fully completed

    const result = await service.getLearningPath(USER_ID, TENANT_ID);

    expect(result.steps).toEqual([]);
    // Only the active enrollment is probed for a next lesson; the completed one is skipped.
    expect(repo.getNextUnstartedLesson).toHaveBeenCalledTimes(1);
  });
});
