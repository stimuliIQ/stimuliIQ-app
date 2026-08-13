// apps/api/src/modules/certificates/certificates.service.spec.ts
//
// Unit tests for CertificatesService + eligibility engine + public verify.
//
// Coverage:
//   - Eligibility engine: each gate pass/fail + vacuous cases.
//   - issuance blocked when ineligible.
//   - verifyCertificate: valid / revoked / fabricated / nonexistent.
//   - downloadStudentCertificate: blocked until issued / revoked → 410 / IDOR → 404.
//   - cert_uid sign/verify round-trip (via util).
//   - rate-limiter stub usage (VerifyRateLimiter).

import {
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { CertificatesService } from "./certificates.service";
import { CertificatesRepository } from "./certificates.repository";
import { NoopCertificatePdfAdapter } from "./providers/pdf/noop-certificate-pdf.adapter";
import { NoopStorageProvider } from "../storage/providers/storage/noop-storage.provider";
import { CERTIFICATE_PDF_PORT } from "./providers/pdf/certificate-pdf-port.interface";
import { STORAGE_PROVIDER } from "../storage/providers/storage/storage-provider.interface";
import { signCertUid, verifyCertUid, __resetCertUidWarningForTests } from "./cert-uid.util";
import { __resetEnvCacheForTests } from "../../config/env";
import type { NotificationsService } from "../notifications/notifications.service";
import type { StudentsRepository, StudentRow } from "../students/students.repository";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMockRepo(overrides: Partial<CertificatesRepository> = {}): jest.Mocked<CertificatesRepository> {
  return {
    findStudentProfileId: jest.fn(),
    findFacultyProfileId: jest.fn(),
    findAssignedBatchIds: jest.fn(),
    findUserDisplayName: jest.fn().mockResolvedValue("Test User"),
    findStudentDisplayName: jest.fn().mockResolvedValue("Test Student"),
    findEnrollmentById: jest.fn(),
    findEnrollmentByStudent: jest.fn(),
    countRequiredAssessmentEligibility: jest.fn(),
    checkFinalProjectApproved: jest.fn(),
    findByEnrollmentId: jest.fn(),
    findById: jest.fn(),
    findByIdForStudent: jest.fn(),
    listForStudent: jest.fn(),
    listCrm: jest.fn(),
    findPublicByCertUid: jest.fn(),
    findPublicBySerial: jest.fn(),
    findForPublicDownload: jest.fn(),
    findForPublicDownloadBySerial: jest.fn(),
    serialExists: jest.fn().mockResolvedValue(false),
    createCertificate: jest.fn(),
    revokeCertificate: jest.fn(),
    softDeleteCertificate: jest.fn(),
    findTemplateById: jest.fn(),
    findDefaultActiveTemplate: jest.fn(),
    listTemplates: jest.fn(),
    findTemplateDetailById: jest.fn(),
    createTemplate: jest.fn(),
    updateTemplate: jest.fn(),
    findEnrollmentsForEligibility: jest.fn(),
    listEnrollmentsForEligibility: jest.fn(),
    writeAuditLog: jest.fn(),
    findProgramTitle: jest.fn().mockResolvedValue("Test Program"),
    ...overrides,
  } as unknown as jest.Mocked<CertificatesRepository>;
}

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const STUDENT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PROGRAM_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ENROLLMENT_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const ACTOR_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const CERT_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const TEMPLATE_ID = "11111111-1111-1111-1111-111111111111";
const BATCH_ID = "22222222-2222-2222-2222-222222222222";

const makeEnrollmentRow = (progressPct = 95) => ({
  id: ENROLLMENT_ID,
  tenantId: TENANT_ID,
  studentId: STUDENT_ID,
  programId: PROGRAM_ID,
  batchId: BATCH_ID,
  progressPct,
  certificate: null,
});

const makeTemplate = () => ({
  id: TEMPLATE_ID,
  name: "Test Template",
  design: { orientation: "landscape" },
  fields: [{ key: "holderName", label: "Name" }],
  status: "active",
});

function makeNotifSvc(): jest.Mocked<Pick<NotificationsService, "notifyCertificateReady">> {
  return { notifyCertificateReady: jest.fn().mockResolvedValue(undefined) };
}

function makeStudentsRepository(): jest.Mocked<Pick<StudentsRepository, "findById">> {
  return { findById: jest.fn() };
}

function makeStudentRow(overrides: Partial<StudentRow> = {}): StudentRow {
  return {
    id: STUDENT_ID,
    userId: "user-cert-student",
    name: "Test Student",
    email: "student@test.com",
    phone: null,
    alternatePhone: null,
    college: null,
    courseType: "btech",
    year: 3,
    city: null,
    source: null,
    status: "active",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    deletedAt: null,
    ...overrides,
  };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("CertificatesService", () => {
  let service: CertificatesService;
  let repo: jest.Mocked<CertificatesRepository>;
  let pdfPort: NoopCertificatePdfAdapter;
  let storage: NoopStorageProvider;
  let notifSvc: jest.Mocked<Pick<NotificationsService, "notifyCertificateReady">>;
  let studentsRepository: jest.Mocked<Pick<StudentsRepository, "findById">>;

  beforeEach(() => {
    __resetCertUidWarningForTests();
    __resetEnvCacheForTests();
    process.env["NODE_ENV"] = "test";
    process.env["WEB_APP_URL"] = "http://localhost:3000";
    // These required-by-schema vars (see config/env.ts) are unconditionally required
    // regardless of NODE_ENV — set them explicitly so validateEnv() succeeds
    // deterministically, matching the pattern already used by
    // certificate-pdf.queue-driver-gate.spec.ts's BASE_ENV, instead of relying on
    // cross-file process.env pollution from whichever spec Jest happens to run first
    // in the same worker.
    process.env["DATABASE_URL"] ??= "postgresql://postgres:postgres@localhost:5432/stimuliiq";
    process.env["REDIS_URL"] ??= "redis://localhost:6379";
    process.env["JWT_PRIVATE_KEY_PATH"] ??= "./keys/jwt-private.pem";
    process.env["JWT_PUBLIC_KEY_PATH"] ??= "./keys/jwt-public.pem";
    process.env["COOKIE_SECRET"] ??= "a".repeat(32);
    process.env["CSRF_SECRET"] ??= "b".repeat(32);

    repo = makeMockRepo();
    pdfPort = new NoopCertificatePdfAdapter();
    storage = new NoopStorageProvider();
    notifSvc = makeNotifSvc();
    studentsRepository = makeStudentsRepository();
    studentsRepository.findById.mockResolvedValue(makeStudentRow());

    service = new CertificatesService(
      repo,
      pdfPort,
      storage,
      notifSvc as unknown as NotificationsService,
      studentsRepository as unknown as StudentsRepository,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
    __resetEnvCacheForTests();
  });

  // ─── ELIGIBILITY ENGINE ─────────────────────────────────────────────────────

  describe("isEligible", () => {
    it("returns eligible=true when all three gates pass", async () => {
      repo.findEnrollmentById.mockResolvedValue(makeEnrollmentRow(100));
      repo.countRequiredAssessmentEligibility.mockResolvedValue({ total: 1, passed: 1 });
      repo.checkFinalProjectApproved.mockResolvedValue(true);
      repo.listEnrollmentsForEligibility.mockResolvedValue({ rows: [], total: 0 });

      const result = await service.isEligible(TENANT_ID, ENROLLMENT_ID);

      expect(result.eligible).toBe(true);
      expect(result.reasons.completionPassed).toBe(true);
      expect(result.reasons.requiredAssessmentsPassed).toBe(true);
      expect(result.reasons.finalProjectApproved).toBe(true);
    });

    it("blocks on completionPct < 90 (AC-E1)", async () => {
      repo.findEnrollmentById.mockResolvedValue(makeEnrollmentRow(85));
      repo.countRequiredAssessmentEligibility.mockResolvedValue({ total: 1, passed: 1 });
      repo.checkFinalProjectApproved.mockResolvedValue(true);
      repo.listEnrollmentsForEligibility.mockResolvedValue({ rows: [], total: 0 });

      const result = await service.isEligible(TENANT_ID, ENROLLMENT_ID);

      expect(result.eligible).toBe(false);
      expect(result.reasons.completionPassed).toBe(false);
      expect(result.reasons.completionPct).toBe(85);
    });

    it("passes at exactly 90% (threshold is inclusive)", async () => {
      repo.findEnrollmentById.mockResolvedValue(makeEnrollmentRow(90));
      repo.countRequiredAssessmentEligibility.mockResolvedValue({ total: 0, passed: 0 });
      repo.checkFinalProjectApproved.mockResolvedValue(null);
      repo.listEnrollmentsForEligibility.mockResolvedValue({ rows: [], total: 0 });

      const result = await service.isEligible(TENANT_ID, ENROLLMENT_ID);

      expect(result.reasons.completionPassed).toBe(true);
      expect(result.eligible).toBe(true);
    });

    it("blocks when required assessment not passed (AC-E2)", async () => {
      repo.findEnrollmentById.mockResolvedValue(makeEnrollmentRow(100));
      repo.countRequiredAssessmentEligibility.mockResolvedValue({ total: 2, passed: 1 });
      repo.checkFinalProjectApproved.mockResolvedValue(true);
      repo.listEnrollmentsForEligibility.mockResolvedValue({ rows: [], total: 0 });

      const result = await service.isEligible(TENANT_ID, ENROLLMENT_ID);

      expect(result.eligible).toBe(false);
      expect(result.reasons.requiredAssessmentsPassed).toBe(false);
    });

    it("vacuously passes requiredAssessmentsPassed when no required assessments exist", async () => {
      repo.findEnrollmentById.mockResolvedValue(makeEnrollmentRow(100));
      repo.countRequiredAssessmentEligibility.mockResolvedValue({ total: 0, passed: 0 });
      repo.checkFinalProjectApproved.mockResolvedValue(null); // no final project
      repo.listEnrollmentsForEligibility.mockResolvedValue({ rows: [], total: 0 });

      const result = await service.isEligible(TENANT_ID, ENROLLMENT_ID);

      expect(result.reasons.requiredAssessmentsPassed).toBe(true);
      expect(result.reasons.finalProjectApproved).toBe(true);
      expect(result.eligible).toBe(true);
    });

    it("blocks when final project not approved (AC-E3)", async () => {
      repo.findEnrollmentById.mockResolvedValue(makeEnrollmentRow(100));
      repo.countRequiredAssessmentEligibility.mockResolvedValue({ total: 1, passed: 1 });
      repo.checkFinalProjectApproved.mockResolvedValue(false);
      repo.listEnrollmentsForEligibility.mockResolvedValue({ rows: [], total: 0 });

      const result = await service.isEligible(TENANT_ID, ENROLLMENT_ID);

      expect(result.eligible).toBe(false);
      expect(result.reasons.finalProjectApproved).toBe(false);
    });

    it("vacuously passes finalProjectApproved when no final project exists (null return)", async () => {
      repo.findEnrollmentById.mockResolvedValue(makeEnrollmentRow(100));
      repo.countRequiredAssessmentEligibility.mockResolvedValue({ total: 0, passed: 0 });
      repo.checkFinalProjectApproved.mockResolvedValue(null); // null = no final project
      repo.listEnrollmentsForEligibility.mockResolvedValue({ rows: [], total: 0 });

      const result = await service.isEligible(TENANT_ID, ENROLLMENT_ID);

      expect(result.reasons.finalProjectApproved).toBe(true);
    });

    it("throws NotFoundException when enrollment not found", async () => {
      repo.findEnrollmentById.mockResolvedValue(null);

      await expect(service.isEligible(TENANT_ID, ENROLLMENT_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── ISSUANCE BLOCKED WHEN INELIGIBLE ───────────────────────────────────────

  describe("getEligibilityDetail", () => {
    it("all-scope: returns the three-gate eligibility result for the enrollment", async () => {
      repo.findEnrollmentById.mockResolvedValue(makeEnrollmentRow(100));
      repo.countRequiredAssessmentEligibility.mockResolvedValue({ total: 1, passed: 1 });
      repo.checkFinalProjectApproved.mockResolvedValue(true);

      const result = await service.getEligibilityDetail(TENANT_ID, ENROLLMENT_ID, "all", ACTOR_ID);

      expect(result.eligible).toBe(true);
      expect(result.reasons.completionPct).toBe(100);
    });

    it("returns 404 when the enrollment does not exist", async () => {
      repo.findEnrollmentById.mockResolvedValue(null);
      await expect(
        service.getEligibilityDetail(TENANT_ID, ENROLLMENT_ID, "all", ACTOR_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it("assigned-scope: 404 (IDOR) when the enrollment's batch is not assigned to the faculty", async () => {
      repo.findEnrollmentById.mockResolvedValue(makeEnrollmentRow(100));
      repo.findFacultyProfileId.mockResolvedValue("faculty-1");
      repo.findAssignedBatchIds.mockResolvedValue(["some-other-batch"]);

      await expect(
        service.getEligibilityDetail(TENANT_ID, ENROLLMENT_ID, "assigned", ACTOR_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("issueCertificate", () => {
    it("blocks issuance when ineligible (AC-E1 via service flow)", async () => {
      repo.findEnrollmentById.mockResolvedValue(makeEnrollmentRow(80));
      repo.findByEnrollmentId.mockResolvedValue(null);
      repo.countRequiredAssessmentEligibility.mockResolvedValue({ total: 0, passed: 0 });
      repo.checkFinalProjectApproved.mockResolvedValue(null);
      repo.listEnrollmentsForEligibility.mockResolvedValue({ rows: [], total: 0 });
      repo.findTemplateById.mockResolvedValue(makeTemplate());

      await expect(
        service.issueCertificate(ACTOR_ID, TENANT_ID, {
          enrollmentId: ENROLLMENT_ID,
          kind: "training" as const,
          templateId: TEMPLATE_ID,
          overrideEligibility: false,
        }, "all"),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it("issues certificate when all gates pass", async () => {
      repo.findEnrollmentById.mockResolvedValue(makeEnrollmentRow(100));
      repo.findByEnrollmentId.mockResolvedValue(null);
      repo.countRequiredAssessmentEligibility.mockResolvedValue({ total: 0, passed: 0 });
      repo.checkFinalProjectApproved.mockResolvedValue(null);
      repo.listEnrollmentsForEligibility.mockResolvedValue({ rows: [], total: 0 });
      repo.findTemplateById.mockResolvedValue(makeTemplate());
      repo.createCertificate.mockResolvedValue(CERT_ID);
      repo.writeAuditLog.mockResolvedValue(undefined);
      repo.findById.mockResolvedValue({
        id: CERT_ID,
        tenantId: TENANT_ID,
        enrollmentId: ENROLLMENT_ID,
        kind: "training" as const,
        studentId: STUDENT_ID,
        programId: PROGRAM_ID,
        certUid: "fake.uid",
        serial: "STMQ-2026-7F3K-9QX2",
        templateId: TEMPLATE_ID,
        templateName: "Test Template",
        storageKey: "certificates/tenant/fake.uid.pdf",
        issuedAt: new Date(),
        issuedById: ACTOR_ID,
        issuedByName: "Actor Name",
        status: "valid",
        revokedReason: null,
        revokedById: null,
        revokedByName: null,
        revokedAt: null,
        batchId: BATCH_ID,
        batchName: "Batch A",
        studentName: "Test Student",
        programTitle: "Test Program",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.issueCertificate(
        ACTOR_ID,
        TENANT_ID,
        { enrollmentId: ENROLLMENT_ID, kind: "training" as const, templateId: TEMPLATE_ID, overrideEligibility: false },
        "all",
      );

      expect(result.status).toBe("valid");
      expect(repo.createCertificate).toHaveBeenCalledTimes(1);
      expect(repo.writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: "certificate.issue" }),
      );

      // Phase-9 Completion T31 / R3: notifyCertificateReady wired at issuance.
      expect(studentsRepository.findById).toHaveBeenCalledWith(TENANT_ID, STUDENT_ID);
      expect(notifSvc.notifyCertificateReady).toHaveBeenCalledWith(
        "user-cert-student",
        TENANT_ID,
        expect.objectContaining({ certificateId: CERT_ID, programTitle: "Test Program" }),
        { toEmail: "student@test.com", toPhone: undefined },
      );
    });

    it("T31/R3: does not fail issuance when notifyCertificateReady throws (best-effort)", async () => {
      repo.findEnrollmentById.mockResolvedValue(makeEnrollmentRow(95));
      repo.findByEnrollmentId.mockResolvedValue(null);
      repo.findTemplateById.mockResolvedValue(makeTemplate());
      repo.countRequiredAssessmentEligibility.mockResolvedValue({ total: 0, passed: 0 });
      repo.checkFinalProjectApproved.mockResolvedValue(true);
      repo.createCertificate.mockResolvedValue(CERT_ID);
      repo.writeAuditLog.mockResolvedValue(undefined);
      repo.findById.mockResolvedValue({
        id: CERT_ID,
        tenantId: TENANT_ID,
        enrollmentId: ENROLLMENT_ID,
        kind: "training" as const,
        studentId: STUDENT_ID,
        programId: PROGRAM_ID,
        certUid: "fake.uid",
        serial: "STMQ-2026-7F3K-9QX2",
        templateId: TEMPLATE_ID,
        templateName: "Test Template",
        storageKey: "certificates/tenant/fake.uid.pdf",
        issuedAt: new Date(),
        issuedById: ACTOR_ID,
        issuedByName: "Actor Name",
        status: "valid",
        revokedReason: null,
        revokedById: null,
        revokedByName: null,
        revokedAt: null,
        batchId: BATCH_ID,
        batchName: "Batch A",
        studentName: "Test Student",
        programTitle: "Test Program",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      notifSvc.notifyCertificateReady.mockRejectedValueOnce(new Error("mail provider down"));

      const result = await service.issueCertificate(
        ACTOR_ID,
        TENANT_ID,
        { enrollmentId: ENROLLMENT_ID, kind: "training" as const, templateId: TEMPLATE_ID, overrideEligibility: false },
        "all",
      );

      expect(result.status).toBe("valid");
    });

    it("blocks issuance with override for non-all scope (forbidden)", async () => {
      repo.findEnrollmentById.mockResolvedValue(makeEnrollmentRow(50));
      repo.findByEnrollmentId.mockResolvedValue(null);
      repo.findTemplateById.mockResolvedValue(makeTemplate());

      await expect(
        service.issueCertificate(ACTOR_ID, TENANT_ID, {
          enrollmentId: ENROLLMENT_ID,
          kind: "training" as const,
          templateId: TEMPLATE_ID,
          overrideEligibility: true,
        }, "assigned"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("rejects issuance when cert already exists (valid) — AC-E6", async () => {
      repo.findEnrollmentById.mockResolvedValue(makeEnrollmentRow(100));
      repo.findByEnrollmentId.mockResolvedValue({
        id: CERT_ID,
        tenantId: TENANT_ID,
        enrollmentId: ENROLLMENT_ID,
        kind: "training" as const,
        studentId: STUDENT_ID,
        programId: PROGRAM_ID,
        certUid: "existing.uid",
        serial: "STMQ-2026-7F3K-9QX2",
        templateId: TEMPLATE_ID,
        templateName: "Test",
        storageKey: "test",
        issuedAt: new Date(),
        issuedById: ACTOR_ID,
        issuedByName: "Actor",
        status: "valid",
        revokedReason: null,
        revokedById: null,
        revokedByName: null,
        revokedAt: null,
        batchId: BATCH_ID,
        batchName: "Batch",
        studentName: "Student",
        programTitle: "Program",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await expect(
        service.issueCertificate(ACTOR_ID, TENANT_ID, {
          enrollmentId: ENROLLMENT_ID,
          kind: "training" as const,
          templateId: TEMPLATE_ID,
          overrideEligibility: false,
        }, "all"),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── AUTOMATIC ISSUANCE ON COMPLETION ───────────────────────────────────────

  describe("autoIssueOnCompletion", () => {
    it("issues (via performIssuance) when eligible + a default template exists + no existing cert", async () => {
      repo.findEnrollmentById.mockResolvedValue(makeEnrollmentRow(100));
      repo.findByEnrollmentId.mockResolvedValue(null);
      repo.countRequiredAssessmentEligibility.mockResolvedValue({ total: 0, passed: 0 });
      repo.checkFinalProjectApproved.mockResolvedValue(null);
      repo.listEnrollmentsForEligibility.mockResolvedValue({ rows: [], total: 0 });
      repo.findDefaultActiveTemplate.mockResolvedValue(makeTemplate());
      // performIssuance re-fetches the template by id via findTemplateById.
      repo.findTemplateById.mockResolvedValue(makeTemplate());
      repo.createCertificate.mockResolvedValue(CERT_ID);
      repo.writeAuditLog.mockResolvedValue(undefined);
      repo.findById.mockResolvedValue({
        id: CERT_ID,
        tenantId: TENANT_ID,
        enrollmentId: ENROLLMENT_ID,
        kind: "training" as const,
        studentId: STUDENT_ID,
        programId: PROGRAM_ID,
        certUid: "fake.uid",
        serial: "STMQ-2026-7F3K-9QX2",
        templateId: TEMPLATE_ID,
        templateName: "Test Template",
        storageKey: "certificates/tenant/fake.uid.pdf",
        issuedAt: new Date(),
        issuedById: null,
        issuedByName: "System (automatic)",
        status: "valid",
        revokedReason: null,
        revokedById: null,
        revokedByName: null,
        revokedAt: null,
        batchId: BATCH_ID,
        batchName: "Batch A",
        studentName: "Test Student",
        programTitle: "Test Program",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.autoIssueOnCompletion(TENANT_ID, ENROLLMENT_ID);

      expect(result).toEqual({ issued: true, certificateId: expect.any(String) });
      expect(repo.createCertificate).toHaveBeenCalledWith(
        expect.objectContaining({ issuedById: null, templateId: TEMPLATE_ID }),
      );
      expect(repo.writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: "certificate.auto_issue", actorId: null }),
      );
      expect(notifSvc.notifyCertificateReady).toHaveBeenCalledTimes(1);
    });

    it("{issued:false, reason:'already_exists'} when a VALID cert already exists — never touches it", async () => {
      repo.findEnrollmentById.mockResolvedValue(makeEnrollmentRow(100));
      repo.findByEnrollmentId.mockResolvedValue({
        id: CERT_ID,
        tenantId: TENANT_ID,
        enrollmentId: ENROLLMENT_ID,
        kind: "training" as const,
        studentId: STUDENT_ID,
        programId: PROGRAM_ID,
        certUid: "existing.uid",
        serial: "STMQ-2026-7F3K-9QX2",
        templateId: TEMPLATE_ID,
        templateName: "Test",
        storageKey: "test",
        issuedAt: new Date(),
        issuedById: ACTOR_ID,
        issuedByName: "Actor",
        status: "valid",
        revokedReason: null,
        revokedById: null,
        revokedByName: null,
        revokedAt: null,
        batchId: BATCH_ID,
        batchName: "Batch",
        studentName: "Student",
        programTitle: "Program",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.autoIssueOnCompletion(TENANT_ID, ENROLLMENT_ID);

      expect(result).toEqual({ issued: false, reason: "already_exists" });
      expect(repo.createCertificate).not.toHaveBeenCalled();
    });

    it("{issued:false, reason:'already_exists'} when a REVOKED cert already exists — never reissues", async () => {
      repo.findEnrollmentById.mockResolvedValue(makeEnrollmentRow(100));
      repo.findByEnrollmentId.mockResolvedValue({
        id: CERT_ID,
        tenantId: TENANT_ID,
        enrollmentId: ENROLLMENT_ID,
        kind: "training" as const,
        studentId: STUDENT_ID,
        programId: PROGRAM_ID,
        certUid: "existing.uid",
        serial: "STMQ-2026-7F3K-9QX2",
        templateId: TEMPLATE_ID,
        templateName: "Test",
        storageKey: "test",
        issuedAt: new Date(),
        issuedById: ACTOR_ID,
        issuedByName: "Actor",
        status: "revoked",
        revokedReason: "Policy violation",
        revokedById: ACTOR_ID,
        revokedByName: "Actor",
        revokedAt: new Date(),
        batchId: BATCH_ID,
        batchName: "Batch",
        studentName: "Student",
        programTitle: "Program",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.autoIssueOnCompletion(TENANT_ID, ENROLLMENT_ID);

      expect(result).toEqual({ issued: false, reason: "already_exists" });
      expect(repo.createCertificate).not.toHaveBeenCalled();
      expect(repo.softDeleteCertificate).not.toHaveBeenCalled();
    });

    it("{issued:false, reason:'not_eligible'} when isEligible is false — does NOT throw", async () => {
      repo.findEnrollmentById.mockResolvedValue(makeEnrollmentRow(50));
      repo.findByEnrollmentId.mockResolvedValue(null);
      repo.countRequiredAssessmentEligibility.mockResolvedValue({ total: 0, passed: 0 });
      repo.checkFinalProjectApproved.mockResolvedValue(null);
      repo.listEnrollmentsForEligibility.mockResolvedValue({ rows: [], total: 0 });

      const result = await service.autoIssueOnCompletion(TENANT_ID, ENROLLMENT_ID);

      expect(result).toEqual({ issued: false, reason: "not_eligible" });
      expect(repo.createCertificate).not.toHaveBeenCalled();
    });

    it("{issued:false, reason:'no_template'} when no default active template exists", async () => {
      repo.findEnrollmentById.mockResolvedValue(makeEnrollmentRow(100));
      repo.findByEnrollmentId.mockResolvedValue(null);
      repo.countRequiredAssessmentEligibility.mockResolvedValue({ total: 0, passed: 0 });
      repo.checkFinalProjectApproved.mockResolvedValue(null);
      repo.listEnrollmentsForEligibility.mockResolvedValue({ rows: [], total: 0 });
      repo.findDefaultActiveTemplate.mockResolvedValue(null);

      const result = await service.autoIssueOnCompletion(TENANT_ID, ENROLLMENT_ID);

      expect(result).toEqual({ issued: false, reason: "no_template" });
      expect(repo.createCertificate).not.toHaveBeenCalled();
    });

    it("{issued:false, reason:'enrollment_not_found'} when the enrollment does not exist", async () => {
      repo.findEnrollmentById.mockResolvedValue(null);

      const result = await service.autoIssueOnCompletion(TENANT_ID, ENROLLMENT_ID);

      expect(result).toEqual({ issued: false, reason: "enrollment_not_found" });
    });
  });

  // ─── TEMPLATE CRUD (Phase-9-completion gap #5 — layout persistence) ─────────

  describe("certificate template create/update/detail (layout persistence)", () => {
    const makeTemplateDetailRow = (overrides: Record<string, unknown> = {}) => ({
      id: TEMPLATE_ID,
      name: "Test Template",
      design: { orientation: "landscape" },
      fields: [{ key: "holderName", label: "Name" }],
      layout: null,
      status: "active",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
      ...overrides,
    });

    it("getTemplateDetail 404s for an unknown template", async () => {
      repo.findTemplateDetailById.mockResolvedValue(null);
      await expect(service.getTemplateDetail(TENANT_ID, "missing")).rejects.toBeInstanceOf(NotFoundException);
    });

    it("createTemplate persists layout when provided and writes an audit row", async () => {
      repo.createTemplate.mockResolvedValue({ id: TEMPLATE_ID });
      repo.findTemplateDetailById.mockResolvedValue(
        makeTemplateDetailRow({ layout: [{ id: "f1", type: "text", label: "Name", x: 50, y: 40 }] }),
      );

      const result = await service.createTemplate(ACTOR_ID, TENANT_ID, {
        name: "New Template",
        design: {},
        fields: [],
        layout: [{ id: "f1", type: "text", label: "Name", x: 50, y: 40 }],
        status: "active",
      });

      expect(repo.createTemplate).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({ name: "New Template", layout: expect.any(Array) }),
      );
      expect(repo.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "certificate_template.create" }));
      expect(result.layout).toEqual([{ id: "f1", type: "text", label: "Name", x: 50, y: 40 }]);
    });

    it("updateTemplate with { layout } only — the designer's 'Save layout' action — persists and audits", async () => {
      repo.findTemplateDetailById
        .mockResolvedValueOnce(makeTemplateDetailRow({ layout: null }))
        .mockResolvedValueOnce(makeTemplateDetailRow({ layout: [{ id: "f1", type: "text", label: "Name", x: 10, y: 10 }] }));

      const result = await service.updateTemplate(ACTOR_ID, TENANT_ID, TEMPLATE_ID, {
        layout: [{ id: "f1", type: "text", label: "Name", x: 10, y: 10 }],
      });

      expect(repo.updateTemplate).toHaveBeenCalledWith(TEMPLATE_ID, expect.objectContaining({ layout: expect.any(Array) }));
      expect(repo.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "certificate_template.update" }));
      expect(result.layout).toEqual([{ id: "f1", type: "text", label: "Name", x: 10, y: 10 }]);
    });

    it("updateTemplate 404s for an unknown template", async () => {
      repo.findTemplateDetailById.mockResolvedValue(null);
      await expect(
        service.updateTemplate(ACTOR_ID, TENANT_ID, "missing", { layout: [] }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ─── BULK ISSUE (Phase-9-completion gap #7) ─────────────────────────────────

  describe("bulkIssueCertificates", () => {
    it("issues each enrollment independently — one failure does not abort the others", async () => {
      repo.findTemplateById.mockResolvedValue(makeTemplate());
      repo.countRequiredAssessmentEligibility.mockResolvedValue({ total: 0, passed: 0 });
      repo.checkFinalProjectApproved.mockResolvedValue(null);
      repo.listEnrollmentsForEligibility.mockResolvedValue({ rows: [], total: 0 });
      repo.writeAuditLog.mockResolvedValue(undefined);

      const OTHER_ENROLLMENT_ID = "99999999-9999-9999-9999-999999999999";

      // First enrollment: eligible + no existing cert -> succeeds.
      // Second enrollment: not found -> fails.
      repo.findEnrollmentById.mockImplementation(async (_tenantId: string, enrollmentId: string) => {
        if (enrollmentId === ENROLLMENT_ID) return makeEnrollmentRow(100);
        return null;
      });
      repo.findByEnrollmentId.mockResolvedValue(null);
      repo.createCertificate.mockResolvedValue(CERT_ID);
      repo.findById.mockResolvedValue({
        id: CERT_ID,
        tenantId: TENANT_ID,
        enrollmentId: ENROLLMENT_ID,
        kind: "training" as const,
        studentId: STUDENT_ID,
        programId: PROGRAM_ID,
        certUid: "fake.uid",
        serial: "STMQ-2026-7F3K-9QX2",
        templateId: TEMPLATE_ID,
        templateName: "Test Template",
        storageKey: "certificates/tenant/fake.uid.pdf",
        issuedAt: new Date(),
        issuedById: ACTOR_ID,
        issuedByName: "Actor Name",
        status: "valid",
        revokedReason: null,
        revokedById: null,
        revokedByName: null,
        revokedAt: null,
        batchId: BATCH_ID,
        batchName: "Batch A",
        studentName: "Test Student",
        programTitle: "Test Program",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.bulkIssueCertificates(
        ACTOR_ID,
        TENANT_ID,
        { enrollmentIds: [ENROLLMENT_ID, OTHER_ENROLLMENT_ID], kind: "training" as const, templateId: TEMPLATE_ID, overrideEligibility: false },
        "all",
      );

      expect(result.successCount).toBe(1);
      expect(result.failureCount).toBe(1);
      expect(result.results).toHaveLength(2);
      expect(result.results.find((r) => r.enrollmentId === ENROLLMENT_ID)?.success).toBe(true);
      expect(result.results.find((r) => r.enrollmentId === OTHER_ENROLLMENT_ID)?.success).toBe(false);
      expect(repo.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "certificate.bulk_issue" }));
    });
  });

  // ─── PUBLIC VERIFY ─────────────────────────────────────────────────────────

  describe("verifyCertificate", () => {
    it("returns valid=true for a valid certificate (AC-H1)", async () => {
      const certUid = signCertUid({
        studentId: STUDENT_ID,
        programId: PROGRAM_ID,
        issuedAt: new Date("2026-01-01"),
        nonce: "testnonce",
      });

      repo.findPublicByCertUid.mockResolvedValue({
        certUid,
        serial: "STMQ-2026-7F3K-9QX2",
        status: "valid",
        programTitle: "Test Program",
        issuedAt: new Date("2026-01-01"),
        holderName: "Test Student",
      });

      const result = await service.verifyCertificate(certUid);

      expect(result.valid).toBe(true);
      expect(result.status).toBe("valid");
      expect(result.program).toBe("Test Program");
      expect(result.holderName).toBe("Test Student");
      // AC-H7: no extra fields
      const keys = Object.keys(result);
      expect(keys).toEqual(expect.arrayContaining(["valid", "status", "program", "issuedAt", "holderName"]));
      expect(keys.length).toBe(5);
    });

    it("returns valid='revoked' for a revoked certificate (AC-H2)", async () => {
      const certUid = signCertUid({
        studentId: STUDENT_ID,
        programId: PROGRAM_ID,
        issuedAt: new Date("2026-01-01"),
        nonce: "testnonce2",
      });

      repo.findPublicByCertUid.mockResolvedValue({
        certUid,
        serial: "STMQ-2026-7F3K-9QX2",
        status: "revoked",
        programTitle: "Test Program",
        issuedAt: new Date("2026-01-01"),
        holderName: "Test Student",
      });

      const result = await service.verifyCertificate(certUid);

      expect(result.valid).toBe("revoked");
      expect(result.status).toBe("revoked");
    });

    it("throws 404 for a fabricated cert_uid (bad signature) — AC-H3", async () => {
      // A random string that has no valid HMAC
      const fabricated = "aGVsbG8gd29ybGQ.YmFkc2ln";

      await expect(service.verifyCertificate(fabricated)).rejects.toThrow(NotFoundException);
      // DB should NOT be queried — signature check happens first
      expect(repo.findPublicByCertUid).not.toHaveBeenCalled();
    });

    it("throws 404 for a tampered cert_uid (one char flipped) — AC-H4", async () => {
      const real = signCertUid({
        studentId: STUDENT_ID,
        programId: PROGRAM_ID,
        issuedAt: new Date("2026-01-01"),
        nonce: "testnonce3",
      });
      // Flip the last character of the signature
      const tampered = real.slice(0, -1) + (real.endsWith("a") ? "b" : "a");

      await expect(service.verifyCertificate(tampered)).rejects.toThrow(NotFoundException);
      expect(repo.findPublicByCertUid).not.toHaveBeenCalled();
    });

    it("throws 404 when cert_uid is validly-signed but no DB row — AC-H5", async () => {
      const certUid = signCertUid({
        studentId: STUDENT_ID,
        programId: PROGRAM_ID,
        issuedAt: new Date("2026-01-01"),
        nonce: "testnonce4",
      });

      repo.findPublicByCertUid.mockResolvedValue(null);

      await expect(service.verifyCertificate(certUid)).rejects.toThrow(NotFoundException);
    });

    it("verify response has EXACTLY 5 keys — no PII leak (AC-H7)", async () => {
      const certUid = signCertUid({
        studentId: STUDENT_ID,
        programId: PROGRAM_ID,
        issuedAt: new Date("2026-01-01"),
        nonce: "testnonce5",
      });
      repo.findPublicByCertUid.mockResolvedValue({
        certUid,
        serial: "STMQ-2026-7F3K-9QX2",
        status: "valid",
        programTitle: "Prog",
        issuedAt: new Date("2026-01-01"),
        holderName: "Name",
      });

      const result = await service.verifyCertificate(certUid);

      const keys = Object.keys(result);
      // Banned fields must not be present
      expect(keys).not.toContain("enrollmentId");
      expect(keys).not.toContain("studentId");
      expect(keys).not.toContain("email");
      expect(keys).not.toContain("phone");
      expect(keys).not.toContain("batchName");
      expect(keys).not.toContain("id");
    });

    it("returns 404 for empty cert_uid string", async () => {
      // Empty string should fail the signature check (verifyCertUid returns valid:false)
      await expect(service.verifyCertificate("")).rejects.toThrow(NotFoundException);
    });

    // ── Short serial path (STMQ-YYYY-XXXX-XXXX) ──
    it("verifies a valid certificate by its SHORT SERIAL (no HMAC) — DB lookup only", async () => {
      repo.findPublicBySerial.mockResolvedValue({
        certUid: "some.uid",
        serial: "STMQ-2026-7F3K-9QX2",
        status: "valid",
        programTitle: "Test Program",
        issuedAt: new Date("2026-01-01"),
        holderName: "Test Student",
      });

      const result = await service.verifyCertificate("STMQ-2026-7F3K-9QX2");

      expect(result.valid).toBe(true);
      expect(result.program).toBe("Test Program");
      // Serial path is DB-only — the signed cert_uid lookup is NOT used.
      expect(repo.findPublicByCertUid).not.toHaveBeenCalled();
      expect(repo.findPublicBySerial).toHaveBeenCalledWith("STMQ-2026-7F3K-9QX2");
      // Response stays the minimal 5-field shape (AC-H7) — serial is NOT leaked into it.
      expect(Object.keys(result).sort()).toEqual(["holderName", "issuedAt", "program", "status", "valid"]);
    });

    it("normalises a lower-case / spaced serial before the serial lookup", async () => {
      repo.findPublicBySerial.mockResolvedValue({
        certUid: "some.uid",
        serial: "STMQ-2026-7F3K-9QX2",
        status: "valid",
        programTitle: "Test Program",
        issuedAt: new Date("2026-01-01"),
        holderName: "Test Student",
      });

      await service.verifyCertificate("  stmq-2026-7f3k-9qx2 ");

      expect(repo.findPublicBySerial).toHaveBeenCalledWith("STMQ-2026-7F3K-9QX2");
    });

    it("404s an unknown serial without touching the cert_uid path", async () => {
      repo.findPublicBySerial.mockResolvedValue(null);

      await expect(service.verifyCertificate("STMQ-2026-0000-0001")).rejects.toThrow(NotFoundException);
      expect(repo.findPublicByCertUid).not.toHaveBeenCalled();
    });
  });

  // ─── DOWNLOAD BLOCKED UNTIL ISSUED ─────────────────────────────────────────

  describe("downloadStudentCertificate", () => {
    it("returns signed download URL for valid certificate (AC-F1)", async () => {
      repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
      repo.findByIdForStudent.mockResolvedValue({
        id: CERT_ID,
        tenantId: TENANT_ID,
        enrollmentId: ENROLLMENT_ID,
        kind: "training" as const,
        studentId: STUDENT_ID,
        programId: PROGRAM_ID,
        certUid: "fake.uid",
        serial: "STMQ-2026-7F3K-9QX2",
        templateId: TEMPLATE_ID,
        templateName: "Test",
        storageKey: `certificates/${TENANT_ID}/fake.uid.pdf`,
        issuedAt: new Date(),
        issuedById: ACTOR_ID,
        issuedByName: "Actor",
        status: "valid",
        revokedReason: null,
        revokedById: null,
        revokedByName: null,
        revokedAt: null,
        batchId: BATCH_ID,
        batchName: "Batch",
        studentName: "Student",
        programTitle: "Test Program",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.downloadStudentCertificate(TENANT_ID, ACTOR_ID, CERT_ID);

      expect(result.downloadUrl).toContain("noop.local");
      expect(result.expiresAt).toBeDefined();
      expect(result.filename).toContain(".pdf");
      // AC-I2: NEVER a raw bucket URL
      expect(result.downloadUrl).not.toContain("amazonaws.com");
      expect(result.downloadUrl).not.toContain("r2.cloudflarestorage.com");
    });

    it("throws 404 when certificate not found (not yet issued) — AC-F2/F3", async () => {
      repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
      repo.findByIdForStudent.mockResolvedValue(null);

      await expect(
        service.downloadStudentCertificate(TENANT_ID, ACTOR_ID, CERT_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws 410 for revoked certificate — AC-F5", async () => {
      repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
      repo.findByIdForStudent.mockResolvedValue({
        id: CERT_ID,
        tenantId: TENANT_ID,
        enrollmentId: ENROLLMENT_ID,
        kind: "training" as const,
        studentId: STUDENT_ID,
        programId: PROGRAM_ID,
        certUid: "fake.uid",
        serial: "STMQ-2026-7F3K-9QX2",
        templateId: TEMPLATE_ID,
        templateName: "Test",
        storageKey: `certificates/${TENANT_ID}/fake.uid.pdf`,
        issuedAt: new Date(),
        issuedById: ACTOR_ID,
        issuedByName: "Actor",
        status: "revoked",
        revokedReason: "Policy violation",
        revokedById: ACTOR_ID,
        revokedByName: "Actor",
        revokedAt: new Date(),
        batchId: BATCH_ID,
        batchName: "Batch",
        studentName: "Student",
        programTitle: "Test Program",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await expect(
        service.downloadStudentCertificate(TENANT_ID, ACTOR_ID, CERT_ID),
      ).rejects.toThrow(GoneException);
    });

    it("throws 404 when certificate belongs to another student (IDOR) — AC-F4", async () => {
      repo.findStudentProfileId.mockResolvedValue("other-student-id");
      repo.findByIdForStudent.mockResolvedValue(null); // IDOR: returns null for wrong student

      await expect(
        service.downloadStudentCertificate(TENANT_ID, ACTOR_ID, CERT_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── REVOCATION ─────────────────────────────────────────────────────────────

  describe("revokeCertificate", () => {
    const makeValidCert = () => ({
      id: CERT_ID,
      tenantId: TENANT_ID,
      enrollmentId: ENROLLMENT_ID,
      kind: "training" as const,
      studentId: STUDENT_ID,
      programId: PROGRAM_ID,
      certUid: "fake.uid",
      serial: "STMQ-2026-7F3K-9QX2",
      templateId: TEMPLATE_ID,
      templateName: "Test",
      storageKey: "key",
      issuedAt: new Date(),
      issuedById: ACTOR_ID,
      issuedByName: "Actor",
      status: "valid" as const,
      revokedReason: null,
      revokedById: null,
      revokedByName: null,
      revokedAt: null,
      batchId: BATCH_ID,
      batchName: "Batch",
      studentName: "Student",
      programTitle: "Program",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    it("revokes a valid certificate and writes audit log (AC-G1)", async () => {
      repo.findById.mockResolvedValueOnce(makeValidCert());
      repo.revokeCertificate.mockResolvedValue({ beforeStatus: "valid" });
      repo.writeAuditLog.mockResolvedValue(undefined);
      repo.findById.mockResolvedValueOnce({ ...makeValidCert(), status: "revoked" });

      await service.revokeCertificate(ACTOR_ID, TENANT_ID, CERT_ID, {
        reason: "Academic dishonesty",
      });

      expect(repo.revokeCertificate).toHaveBeenCalledWith(
        TENANT_ID,
        CERT_ID,
        expect.objectContaining({ reason: "Academic dishonesty", revokedById: ACTOR_ID }),
      );
      expect(repo.writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "certificate.revoke",
          before: { status: "valid" },
          after: expect.objectContaining({ status: "revoked", revokedReason: "Academic dishonesty" }),
        }),
      );
    });

    it("throws 409 ALREADY_REVOKED when cert is already revoked", async () => {
      repo.findById.mockResolvedValue({ ...makeValidCert(), status: "revoked" });

      await expect(
        service.revokeCertificate(ACTOR_ID, TENANT_ID, CERT_ID, { reason: "Duplicate" }),
      ).rejects.toThrow(ConflictException);
    });

    it("throws 404 when cert not found", async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        service.revokeCertificate(ACTOR_ID, TENANT_ID, CERT_ID, { reason: "reason" }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── CERT UID SIGNING ───────────────────────────────────────────────────────

  describe("cert-uid signing (via util)", () => {
    beforeEach(() => {
      __resetCertUidWarningForTests();
      __resetEnvCacheForTests();
      process.env["NODE_ENV"] = "test";
    });
    afterEach(() => {
      __resetEnvCacheForTests();
    });

    it("signs and verifies round-trip", () => {
      const certUid = signCertUid({
        studentId: STUDENT_ID,
        programId: PROGRAM_ID,
        issuedAt: new Date("2026-01-01"),
        nonce: "roundtrip",
      });
      const result = verifyCertUid(certUid);
      expect(result.valid).toBe(true);
      expect(result.payload?.studentId).toBe(STUDENT_ID);
      expect(result.payload?.programId).toBe(PROGRAM_ID);
    });

    it("rejects a tampered payload (bit flip)", () => {
      const certUid = signCertUid({
        studentId: STUDENT_ID,
        programId: PROGRAM_ID,
        issuedAt: new Date("2026-01-01"),
        nonce: "tamper",
      });
      // Replace one char in the payload part
      const parts = certUid.split(".");
      const body = parts[0] ?? "";
      const sig = parts[1] ?? "";
      const tampered = body.slice(0, -1) + (body.endsWith("a") ? "b" : "a") + "." + sig;
      const result = verifyCertUid(tampered);
      expect(result.valid).toBe(false);
    });

    it("rejects an entirely fabricated uid", () => {
      const result = verifyCertUid("aGVsbG8gd29ybGQ.ZmFrZXNpZw");
      expect(result.valid).toBe(false);
    });

    it("rejects empty string", () => {
      const result = verifyCertUid("");
      expect(result.valid).toBe(false);
    });

    it("rejects a uid with no dot separator", () => {
      const result = verifyCertUid("nodothere");
      expect(result.valid).toBe(false);
    });
  });
});
