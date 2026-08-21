// apps/api/src/modules/exports/exports.service.spec.ts
//
// Unit tests for ExportsService (docs/plans/phase-7.md task #8). Mocks every collaborator
// (repository, AnalyticsService, StudentsService, LeadsService, CommerceService,
// CampaignsService, StorageProvider, ReportPdfPort) and drives scope via the real
// `scopeContextStorage` ALS (matches analytics.service.spec.ts's established pattern).
//
// Coverage (per the backend-builder DoD):
//   - AC-34: missing the type-specific view permission -> 403 BEFORE any job is created
//     (repo.create never called).
//   - Job lifecycle: queued -> running -> succeeded, in order; failure paths (HttpException
//     re-thrown + job marked failed; unexpected error -> job marked failed with a
//     SANITIZED message, no stack/secret).
//   - AC-30 scope isolation: a caller cannot export another scope's rows, asserted by
//     confirming the service calls the SAME scoped service method (StudentsService.list
//     etc.) rather than any broader/parallel query path, and that entity-list generation
//     pages in bounded batches (PAGE_SIZE, not one unbounded call).
//   - AC-28: a malicious cell value survives through row-builders + csv.ts neutralized in
//     the final uploaded bytes.
//   - AC-35: the signed download URL never leaks the raw storage key/bucket.
//   - Paise integrity: a revenue export's amountPaise cell is the exact integer paise
//     value, never divided/rounded/float-formatted.
//   - GET /crm/exports list scope split: "all" sees every job; every other scope sees
//     only the caller's own requested jobs.

import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { ExportsService } from "./exports.service";
import type { ExportsRepository, ExportJobRow } from "./exports.repository";
import type { AnalyticsService } from "../analytics/analytics.service";
import type { StudentsService } from "../students/students.service";
import type { LeadsService } from "../leads/leads.service";
import type { CommerceService } from "../commerce/commerce.service";
import type { CampaignsService } from "../campaigns/campaigns.service";
import type { LeadsRepository } from "../leads/leads.repository";
import type { StudentsRepository } from "../students/students.repository";
import type { StorageProvider } from "../storage/providers/storage/storage-provider.interface";
import type { ReportPdfPort } from "./providers/pdf/report-pdf-port.interface";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";
import type { RequestUser } from "../auth/lib/request-user";
import type { CreateExportRequestDto } from "@repo/types";

const TENANT_ID = "tenant-1";

function runWithScope<T>(scope: ScopeContext["scope"], fn: () => T, actorId = "user-1"): T {
  const ctx: ScopeContext = { permissionKey: "reports.export", scope, actorId, tenantId: TENANT_ID };
  return scopeContextStorage.run(ctx, fn);
}

function makeUser(permissions: Array<{ key: string; scope: string }>, id = "user-1"): RequestUser {
  return {
    id,
    tenantId: TENANT_ID,
    roles: ["test"],
    permissions: permissions as RequestUser["permissions"],
    mustChangePassword: false,
  };
}

function baseJobRow(overrides: Partial<ExportJobRow> = {}): ExportJobRow {
  return {
    id: "job-1",
    tenantId: TENANT_ID,
    requestedById: "user-1",
    requestedByName: "Test User",
    type: "revenue",
    format: "csv",
    params: {},
    status: "queued",
    storageKey: null,
    error: null,
    rowCount: null,
    createdAt: new Date("2026-07-04T10:00:00.000Z"),
    updatedAt: new Date("2026-07-04T10:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

describe("ExportsService", () => {
  let repo: jest.Mocked<Pick<ExportsRepository, "create" | "findById" | "list" | "markRunning" | "markSucceeded" | "markFailed" | "writeAuditLog">>;
  let analytics: jest.Mocked<Pick<AnalyticsService, "getRevenue" | "getEnrollmentTrend" | "getFunnel" | "getEngagement" | "getCampaignPerformance" | "getGamificationParticipation" | "getForumHealth">>;
  let studentsService: jest.Mocked<Pick<StudentsService, "list">>;
  let leadsService: jest.Mocked<Pick<LeadsService, "list">>;
  let commerceService: jest.Mocked<Pick<CommerceService, "listPayments">>;
  let campaignsService: jest.Mocked<Pick<CampaignsService, "listRecipients">>;
  let leadsRepository: jest.Mocked<Pick<LeadsRepository, "findById">>;
  let studentsRepository: jest.Mocked<Pick<StudentsRepository, "findById">>;
  let storage: jest.Mocked<Pick<StorageProvider, "putObject" | "getSignedDownloadUrl">>;
  let reportPdf: jest.Mocked<Pick<ReportPdfPort, "render">>;
  let service: ExportsService;

  beforeEach(() => {
    repo = {
      create: jest.fn().mockResolvedValue(baseJobRow()),
      findById: jest.fn().mockResolvedValue(baseJobRow({ status: "succeeded", storageKey: "exports/tenant-1/job-1.csv", rowCount: 3 })),
      list: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
      markRunning: jest.fn().mockResolvedValue(undefined),
      markSucceeded: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
      writeAuditLog: jest.fn().mockResolvedValue(undefined),
    } as never;

    analytics = {
      getRevenue: jest.fn(),
      getEnrollmentTrend: jest.fn(),
      getFunnel: jest.fn(),
      getEngagement: jest.fn(),
      getCampaignPerformance: jest.fn(),
      getGamificationParticipation: jest.fn(),
      getForumHealth: jest.fn(),
    } as never;

    studentsService = { list: jest.fn() } as never;
    leadsService = { list: jest.fn() } as never;
    commerceService = { listPayments: jest.fn() } as never;
    campaignsService = { listRecipients: jest.fn() } as never;
    leadsRepository = { findById: jest.fn() } as never;
    studentsRepository = { findById: jest.fn() } as never;

    storage = {
      putObject: jest.fn().mockResolvedValue(undefined),
      getSignedDownloadUrl: jest.fn().mockResolvedValue({
        url: "https://signed.example.com/exports/tenant-1/job-1.csv?sig=abc",
        expiresAt: new Date("2026-07-04T10:05:00.000Z"),
      }),
    } as never;

    reportPdf = { render: jest.fn().mockResolvedValue({ bytes: Buffer.from("%PDF-stub"), contentType: "application/pdf" }) } as never;

    service = new ExportsService(
      repo as unknown as ExportsRepository,
      analytics as unknown as AnalyticsService,
      studentsService as unknown as StudentsService,
      leadsService as unknown as LeadsService,
      commerceService as unknown as CommerceService,
      campaignsService as unknown as CampaignsService,
      leadsRepository as unknown as LeadsRepository,
      studentsRepository as unknown as StudentsRepository,
      storage as unknown as StorageProvider,
      reportPdf as unknown as ReportPdfPort,
    );
  });

  // ─── AC-34: permission gating ────────────────────────────────────────────────

  describe("AC-34, export requires the type-specific view permission", () => {
    it("403s and NEVER creates a job when the caller lacks the matching view permission", async () => {
      const user = makeUser([{ key: "reports.export", scope: "all" }]); // no reports.revenue.view
      const dto: CreateExportRequestDto = { type: "revenue", format: "csv", params: { from: "2026-06-01", to: "2026-06-30" } };

      await runWithScope("all", async () => {
        await expect(service.create(TENANT_ID, user, dto)).rejects.toThrow(ForbiddenException);
      });

      expect(repo.create).not.toHaveBeenCalled();
      expect(analytics.getRevenue).not.toHaveBeenCalled();
    });

    it("succeeds when the caller holds both reports.export AND the matching view permission", async () => {
      const user = makeUser([
        { key: "reports.export", scope: "all" },
        { key: "reports.revenue.view", scope: "all" },
      ]);
      analytics.getRevenue.mockResolvedValue({
        asOf: "2026-07-04T09:00:00.000Z",
        stale: false,
        from: "2026-06-01",
        to: "2026-06-30",
        currency: "INR",
        totalPaise: 150000,
        series: [{ periodStart: "2026-06-01", amountPaise: 150000 }],
        byProgram: [],
      });

      const dto: CreateExportRequestDto = { type: "revenue", format: "csv", params: { from: "2026-06-01", to: "2026-06-30" } };
      await runWithScope("all", async () => {
        const result = await service.create(TENANT_ID, user, dto);
        expect(result.id).toBe("job-1");
      });

      expect(repo.create).toHaveBeenCalledTimes(1);
      expect(repo.markRunning).toHaveBeenCalledWith("job-1");
      expect(repo.markSucceeded).toHaveBeenCalledWith("job-1", expect.objectContaining({ rowCount: 1 }));
    });
  });

  // ─── Job lifecycle ───────────────────────────────────────────────────────────

  describe("job lifecycle", () => {
    const user = makeUser([
      { key: "reports.export", scope: "all" },
      { key: "reports.revenue.view", scope: "all" },
    ]);
    const dto: CreateExportRequestDto = { type: "revenue", format: "csv", params: { from: "2026-06-01", to: "2026-06-30" } };

    it("transitions queued -> running -> succeeded on the happy path, and writes the AC-36 audit row", async () => {
      analytics.getRevenue.mockResolvedValue({
        asOf: "2026-07-04T09:00:00.000Z",
        stale: false,
        from: "2026-06-01",
        to: "2026-06-30",
        currency: "INR",
        totalPaise: 0,
        series: [],
        byProgram: [],
      });

      await runWithScope("all", () => service.create(TENANT_ID, user, dto));

      const createOrder = repo.create.mock.invocationCallOrder[0]!;
      const runningOrder = repo.markRunning.mock.invocationCallOrder[0]!;
      const succeededOrder = repo.markSucceeded.mock.invocationCallOrder[0]!;
      expect(createOrder).toBeLessThan(runningOrder);
      expect(runningOrder).toBeLessThan(succeededOrder);

      expect(repo.writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT_ID, actorId: "user-1", entityId: "job-1", action: "export.create" }),
      );
    });

    it("re-throws an HttpException from the underlying scoped service AND marks the job failed", async () => {
      analytics.getRevenue.mockRejectedValue(new NotFoundException({ code: "reports.not_found", title: "Not found" }));

      await runWithScope("all", async () => {
        await expect(service.create(TENANT_ID, user, dto)).rejects.toThrow(NotFoundException);
      });

      expect(repo.markFailed).toHaveBeenCalledWith("job-1", expect.any(String));
    });

    it("swallows an unexpected (non-Http) error into a SANITIZED failed job, no stack/raw message leaked", async () => {
      analytics.getRevenue.mockRejectedValue(new Error("ECONNRESET: raw internal socket detail, DB_PASSWORD=hunter2"));

      const result = await runWithScope("all", () => service.create(TENANT_ID, user, dto));

      expect(result.id).toBe("job-1");
      const [, sanitizedMessage] = repo.markFailed.mock.calls[0]!;
      expect(sanitizedMessage).not.toContain("hunter2");
      expect(sanitizedMessage).not.toContain("ECONNRESET");
      expect(typeof sanitizedMessage).toBe("string");
    });
  });

  // ─── AC-30/32: scope isolation via reused scoped service methods ─────────────

  describe("AC-30/AC-32, entity-list exports reuse the SAME scoped service method as the on-screen view", () => {
    it("students export calls StudentsService.list with bounded pageSize and pages until hasMore=false", async () => {
      const user = makeUser([
        { key: "reports.export", scope: "branch" },
        { key: "students.view", scope: "branch" },
      ]);
      studentsService.list
        .mockResolvedValueOnce({
          items: [{ id: "s1", userId: "u1", name: "Ravi", email: "ravi@example.com", phone: null, college: null, courseType: "btech", year: 2, city: null, status: "active", lifecycleStage: "active_student", createdAt: "2026-06-01T00:00:00.000Z" }],
          meta: { page: 1, pageSize: 100, total: 101, hasMore: true },
        })
        .mockResolvedValueOnce({
          items: [{ id: "s2", userId: "u2", name: "Priya", email: "priya@example.com", phone: null, college: null, courseType: "btech", year: 2, city: null, status: "active", lifecycleStage: "active_student", createdAt: "2026-06-01T00:00:00.000Z" }],
          meta: { page: 2, pageSize: 100, total: 101, hasMore: false },
        });

      const dto: CreateExportRequestDto = { type: "students", format: "csv", params: { includeDeleted: false } };
      await runWithScope("branch", () => service.create(TENANT_ID, user, dto));

      expect(studentsService.list).toHaveBeenCalledTimes(2);
      expect(studentsService.list).toHaveBeenNthCalledWith(1, TENANT_ID, expect.objectContaining({ page: 1, pageSize: 100 }));
      expect(studentsService.list).toHaveBeenNthCalledWith(2, TENANT_ID, expect.objectContaining({ page: 2, pageSize: 100 }));
      expect(repo.markSucceeded).toHaveBeenCalledWith("job-1", expect.objectContaining({ rowCount: 2 }));
    });

    it("never calls a broader/parallel query path for leads, only LeadsService.list()", async () => {
      const user = makeUser([
        { key: "reports.export", scope: "own" },
        { key: "leads.view", scope: "own" },
      ]);
      leadsService.list.mockResolvedValue({
        items: [],
        meta: { page: 1, pageSize: 100, total: 0, hasMore: false },
      });

      const dto: CreateExportRequestDto = { type: "leads", format: "csv", params: {} };
      await runWithScope("own", () => service.create(TENANT_ID, user, dto));

      expect(leadsService.list).toHaveBeenCalledTimes(1);
      expect(repo.markSucceeded).toHaveBeenCalledWith("job-1", expect.objectContaining({ rowCount: 0 }));
    });
  });

  // ─── AC-28: CSV-injection neutralization survives end-to-end ─────────────────

  describe("AC-28, a malicious cell value is neutralized in the uploaded bytes", () => {
    it("neutralizes a lead name starting with '=' in the generated CSV", async () => {
      const user = makeUser([
        { key: "reports.export", scope: "own" },
        { key: "leads.view", scope: "own" },
      ]);
      leadsService.list.mockResolvedValue({
        items: [
          {
            id: "l1",
            name: "=cmd|' /C calc'!A0",
            phone: "9999999999",
            email: null,
            stage: "new",
            lifecycleStage: "new_lead",
            source: "web",
            programInterestId: null,
            programInterestTitle: null,
            branchId: null,
            branchName: null,
            ownerId: null,
            ownerName: null,
            createdById: null,
            createdByName: null,
            assignedById: null,
            assignedByName: null,
            assignedAt: null,
            firstContactedAt: null,
            lastActivityAt: null,
            score: null,
            slaDueAt: null,
            convertedStudentId: null,
            courseInterest: null,
            college: null,
            language: null,
            createdAt: "2026-06-01T00:00:00.000Z",
          },
        ],
        meta: { page: 1, pageSize: 100, total: 1, hasMore: false },
      });

      const dto: CreateExportRequestDto = { type: "leads", format: "csv", params: {} };
      await runWithScope("own", () => service.create(TENANT_ID, user, dto));

      const putCall = storage.putObject.mock.calls[0]![0];
      const csvText = putCall.body.toString("utf8");
      expect(csvText).toContain("'=cmd|' /C calc'!A0");
      expect(csvText).not.toMatch(/^=cmd/m); // never a raw, un-neutralized leading '='
    });
  });

  // ─── Paise integrity ──────────────────────────────────────────────────────────

  describe("paise integrity", () => {
    it("a revenue export's amountPaise cell is the exact integer, never divided/rounded", async () => {
      const user = makeUser([
        { key: "reports.export", scope: "all" },
        { key: "reports.revenue.view", scope: "all" },
      ]);
      analytics.getRevenue.mockResolvedValue({
        asOf: "2026-07-04T09:00:00.000Z",
        stale: false,
        from: "2026-06-01",
        to: "2026-06-01",
        currency: "INR",
        totalPaise: 123456789,
        series: [{ periodStart: "2026-06-01", amountPaise: 123456789 }],
        byProgram: [],
      });

      const dto: CreateExportRequestDto = { type: "revenue", format: "csv", params: { from: "2026-06-01", to: "2026-06-01" } };
      await runWithScope("all", () => service.create(TENANT_ID, user, dto));

      const csvText = storage.putObject.mock.calls[0]![0].body.toString("utf8");
      expect(csvText).toContain("123456789");
      expect(csvText).not.toContain("1234567.89");
      expect(csvText).not.toContain("1.23456789e");
    });
  });

  // ─── AC-35: signed URL never leaks the raw storage key ───────────────────────

  describe("AC-35, signed download URL never leaks a raw key/secret", () => {
    it("getById returns a signed URL, never the raw storageKey, only when status=succeeded", async () => {
      const user = makeUser([{ key: "reports.export", scope: "all" }]);
      repo.findById.mockResolvedValue(baseJobRow({ status: "succeeded", storageKey: "exports/tenant-1/job-1.csv", rowCount: 3 }));

      const dto = await runWithScope("all", () => service.getById(TENANT_ID, user, "job-1"));

      expect(dto.downloadUrl).toBe("https://signed.example.com/exports/tenant-1/job-1.csv?sig=abc");
      // The DTO exposes ONLY the signed URL, never a raw storageKey/bucket/credential field.
      expect(dto).not.toHaveProperty("storageKey");
      expect(JSON.stringify(dto)).not.toMatch(/STORAGE_ACCESS_KEY|STORAGE_SECRET|AKIA/);
    });

    it("does NOT mint a download URL when the job has not succeeded yet", async () => {
      const user = makeUser([{ key: "reports.export", scope: "all" }]);
      repo.findById.mockResolvedValue(baseJobRow({ status: "running", storageKey: null }));

      const dto = await runWithScope("all", () => service.getById(TENANT_ID, user, "job-1"));

      expect(dto.downloadUrl).toBeNull();
      expect(storage.getSignedDownloadUrl).not.toHaveBeenCalled();
    });

    it("404s (not 403) for a job requested by a different scoped user (IDOR-safe)", async () => {
      const user = makeUser([{ key: "reports.export", scope: "branch" }], "other-user");
      repo.findById.mockResolvedValue(baseJobRow({ requestedById: "user-1", status: "succeeded" }));

      await runWithScope("branch", async () => {
        await expect(service.getById(TENANT_ID, user, "job-1")).rejects.toThrow(NotFoundException);
      }, "other-user");
    });
  });

  // ─── GET /crm/exports list scope split ───────────────────────────────────────

  describe("list() scope split", () => {
    it("an 'all' scope caller sees every tenant job (no requestedById filter)", async () => {
      const user = makeUser([{ key: "reports.export", scope: "all" }]);
      await runWithScope("all", () =>
        service.list(TENANT_ID, user, { page: 1, pageSize: 20 }),
      );
      expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ requestedById: undefined }));
    });

    it("a non-'all' scope caller only sees jobs THEY requested", async () => {
      const user = makeUser([{ key: "reports.export", scope: "branch" }]);
      await runWithScope("branch", () =>
        service.list(TENANT_ID, user, { page: 1, pageSize: 20 }),
      );
      expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ requestedById: "user-1" }));
    });
  });
});
