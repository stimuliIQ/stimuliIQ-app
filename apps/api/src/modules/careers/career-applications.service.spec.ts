// apps/api/src/modules/careers/career-applications.service.spec.ts
//
// Unit tests for CareerApplicationsService (docs/specs/careers-hiring.md, ADR-0066).
//
// These target the promises that are invisible when they break — a candidate who is never
// emailed, an offer with no letter, an internal note that leaks, a second reviewer silently
// re-sending a rejection. The happy path is the least interesting thing here.

import { ForbiddenException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { CareerApplicationsService } from "./career-applications.service";
import { CareerApplicationsRepository, type CareerApplicationRow } from "./career-applications.repository";
import { JobOpeningsService } from "./job-openings.service";
import { CareersNotificationService } from "./careers-notification.service";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";
import type { CaptchaProvider } from "../captcha/providers/captcha/captcha-provider.interface";
import type { PublicBookingRateLimiter } from "../leads/lib/public-booking-rate-limiter";
import type { StorageProvider } from "../storage/providers/storage/storage-provider.interface";

process.env["DATABASE_URL"] ??= "postgresql://postgres:postgres@localhost:5432/stimuliiq";
process.env["REDIS_URL"] ??= "redis://localhost:6379";
process.env["JWT_PRIVATE_KEY_PATH"] ??= "./keys/jwt-private.pem";
process.env["JWT_PUBLIC_KEY_PATH"] ??= "./keys/jwt-public.pem";
process.env["COOKIE_SECRET"] ??= "a".repeat(32);
process.env["CSRF_SECRET"] ??= "b".repeat(32);

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

const TENANT = "tenant-1";
const RESUME_KEY = `careers/${TENANT}/uuid-resume.pdf`;
const OFFER_KEY = `offer-letters/${TENANT}/uuid-offer.pdf`;

function makeRow(overrides: Partial<CareerApplicationRow> = {}): CareerApplicationRow {
  return {
    id: "app-1",
    tenantId: TENANT,
    jobOpeningId: "opening-1",
    name: "Priya Sharma",
    email: "priya@example.com",
    phone: "+919876543210",
    role: "Senior Counsellor",
    resumeStorageKey: RESUME_KEY,
    coverLetter: "I would love to join.",
    status: "new",
    internalNotes: null,
    nextRoundName: null,
    nextRoundDetails: null,
    offerLetterStorageKey: null,
    offerLetterFileName: null,
    acknowledgedAt: new Date("2026-01-01T00:00:00Z"),
    decidedAt: null,
    decidedByUserId: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    jobOpening: null,
    decidedBy: null,
    ...overrides,
  };
}

function runWithScope<T>(scope: ScopeContext["scope"], fn: () => T): T {
  const ctx: ScopeContext = { permissionKey: "careers.view", scope, actorId: "actor-1", tenantId: TENANT };
  return scopeContextStorage.run(ctx, fn);
}

describe("CareerApplicationsService", () => {
  let repo: Mocked<CareerApplicationsRepository>;
  let openings: Mocked<JobOpeningsService>;
  let notifications: Mocked<CareersNotificationService>;
  let storage: Mocked<StorageProvider>;
  let captcha: Mocked<CaptchaProvider>;
  let rateLimiter: Mocked<PublicBookingRateLimiter>;
  let service: CareerApplicationsService;

  beforeEach(() => {
    repo = {
      list: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
      findById: jest.fn().mockResolvedValue(makeRow()),
      create: jest.fn().mockResolvedValue({ id: "app-1" }),
      applyDecision: jest.fn().mockResolvedValue(1),
      markAcknowledged: jest.fn().mockResolvedValue(undefined),
      softDelete: jest.fn().mockResolvedValue(undefined),
      getTenantIdBySlug: jest.fn().mockResolvedValue(TENANT),
    } as unknown as Mocked<CareerApplicationsRepository>;

    openings = {
      findLiveOpeningForApply: jest.fn().mockResolvedValue(null),
    } as unknown as Mocked<JobOpeningsService>;

    notifications = {
      sendAcknowledgement: jest.fn().mockResolvedValue(true),
      sendNextRound: jest.fn().mockResolvedValue(true),
      sendOffer: jest.fn().mockResolvedValue(true),
      sendRejection: jest.fn().mockResolvedValue(true),
    } as unknown as Mocked<CareersNotificationService>;

    storage = {
      getSignedUploadUrl: jest.fn().mockResolvedValue({
        url: "https://signed.example/put",
        storageKey: RESUME_KEY,
        expiresAt: new Date("2026-01-01T00:15:00Z"),
        requiredHeaders: { "Content-Type": "application/pdf" },
      }),
      getSignedDownloadUrl: jest.fn().mockResolvedValue({ url: "https://signed.example/get", expiresAt: new Date() }),
      putObject: jest.fn(),
      delete: jest.fn(),
      head: jest.fn(),
      getObject: jest.fn().mockResolvedValue({ body: Buffer.from("%PDF-1.7"), contentType: "application/pdf", size: 8 }),
    } as unknown as Mocked<StorageProvider>;

    captcha = { verify: jest.fn().mockResolvedValue({ success: true }) } as unknown as Mocked<CaptchaProvider>;
    rateLimiter = { hit: jest.fn().mockResolvedValue(false) } as unknown as Mocked<PublicBookingRateLimiter>;

    service = new CareerApplicationsService(
      repo as unknown as CareerApplicationsRepository,
      openings as unknown as JobOpeningsService,
      notifications as unknown as CareersNotificationService,
      storage as unknown as StorageProvider,
      captcha as unknown as CaptchaProvider,
      rateLimiter as unknown as PublicBookingRateLimiter,
    );
  });

  const baseApply = {
    name: "Priya Sharma",
    email: "priya@example.com",
    role: "Senior Counsellor",
    resumeStorageKey: RESUME_KEY,
    captchaToken: "tok",
  };

  // ── Public apply ──────────────────────────────────────────────────────────

  describe("apply", () => {
    it("sends the acknowledgement and records that it went out", async () => {
      await service.submit(baseApply);
      expect(notifications.sendAcknowledgement).toHaveBeenCalledTimes(1);
      expect(repo.markAcknowledged).toHaveBeenCalledWith("app-1", expect.any(Date));
    });

    it("still succeeds when the acknowledgement email FAILS, and leaves acknowledgedAt unset as the record of that", async () => {
      notifications.sendAcknowledgement.mockResolvedValue(false);
      const result = await service.submit(baseApply);
      expect(result.id).toBe("app-1");
      expect(repo.markAcknowledged).not.toHaveBeenCalled();
    });

    it("rejects a resume key outside this tenant's namespace (Wave 6 M3 — the key is later signed for download)", async () => {
      await expect(
        service.submit({ ...baseApply, resumeStorageKey: "careers/other-tenant/uuid-resume.pdf" }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("links a LIVE opening and trusts the SERVER's title over the client's — a tampered role must not reach our outgoing mail", async () => {
      openings.findLiveOpeningForApply.mockResolvedValue({ id: "opening-1", title: "Senior Counsellor" } as never);
      await service.submit({ ...baseApply, jobOpeningId: "opening-1", role: "CEO <script>alert(1)</script>" });
      const written = repo.create.mock.calls[0][1];
      expect(written.jobOpeningId).toBe("opening-1");
      expect(written.role).toBe("Senior Counsellor");
    });

    it("records the application UNLINKED rather than turning the candidate away when the opening has since closed", async () => {
      openings.findLiveOpeningForApply.mockResolvedValue(null);
      const result = await service.submit({ ...baseApply, jobOpeningId: "opening-gone" });
      expect(result.id).toBe("app-1");
      expect(repo.create.mock.calls[0][1].jobOpeningId).toBeNull();
      // The role snapshot still records what they thought they were applying for.
      expect(repo.create.mock.calls[0][1].role).toBe("Senior Counsellor");
    });

    it("strips HTML tags from the cover letter and the role (anonymous UGC, write-time defence)", async () => {
      await service.submit({
        ...baseApply,
        role: "<b>Backend</b> Engineer",
        coverLetter: "<i>Excited</i> to apply",
      });
      const written = repo.create.mock.calls[0][1];
      expect(written.role).toBe("Backend Engineer");
      expect(written.coverLetter).toBe("Excited to apply");
    });
  });

  describe("anonymous-write gates", () => {
    it("422s on a failed captcha", async () => {
      captcha.verify.mockResolvedValue({ success: false, errorCodes: ["invalid-input-response"] });
      await expect(service.verifyCaptcha("bad", "1.2.3.4")).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it("422s when the per-IP limiter reports limited", async () => {
      rateLimiter.hit.mockResolvedValue(true);
      await expect(service.checkRateLimit("1.2.3.4")).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  // ── The four review verbs ─────────────────────────────────────────────────

  describe("hold", () => {
    it("is the ONLY verb that sends no email", async () => {
      await runWithScope("all", () => service.hold(TENANT, "app-1", "user-1", {}));
      expect(notifications.sendAcknowledgement).not.toHaveBeenCalled();
      expect(notifications.sendNextRound).not.toHaveBeenCalled();
      expect(notifications.sendOffer).not.toHaveBeenCalled();
      expect(notifications.sendRejection).not.toHaveBeenCalled();
      expect(repo.applyDecision.mock.calls[0][2].status).toBe("on_hold");
    });
  });

  describe("shortlist", () => {
    it("emails the candidate the reviewer's round name and details verbatim", async () => {
      await runWithScope("all", () =>
        service.shortlist(TENANT, "app-1", "user-1", {
          roundName: "Technical interview",
          details: "A 45-minute call with our academics lead.",
        }),
      );
      expect(notifications.sendNextRound).toHaveBeenCalledWith(
        expect.objectContaining({ email: "priya@example.com" }),
        "Technical interview",
        "A 45-minute call with our academics lead.",
      );
      expect(repo.applyDecision.mock.calls[0][2].status).toBe("shortlisted");
    });

    it("stores what the candidate was told, so a reviewer opening the record later reads the actual message", async () => {
      await runWithScope("all", () =>
        service.shortlist(TENANT, "app-1", "user-1", { roundName: "Teaching demo", details: "Bring a 10-minute topic." }),
      );
      const written = repo.applyDecision.mock.calls[0][2];
      expect(written.nextRoundName).toBe("Teaching demo");
      expect(written.nextRoundDetails).toBe("Bring a 10-minute topic.");
    });
  });

  describe("offer", () => {
    const body = { offerLetterStorageKey: OFFER_KEY, offerLetterFileName: "offer.pdf" };

    it("reads the letter and attaches its BYTES to the email", async () => {
      await runWithScope("all", () => service.offer(TENANT, "app-1", "user-1", body));
      expect(storage.getObject).toHaveBeenCalledWith({ key: OFFER_KEY, maxBytes: 10_485_760 });
      const attachment = notifications.sendOffer.mock.calls[0][1];
      expect(attachment.content).toEqual(Buffer.from("%PDF-1.7"));
      expect(attachment.contentType).toBe("application/pdf");
    });

    it("names the attachment for the CANDIDATE, never from the uploader's filename", async () => {
      await runWithScope("all", () =>
        service.offer(TENANT, "app-1", "user-1", { ...body, offerLetterFileName: "../../etc/passwd" }),
      );
      const attachment = notifications.sendOffer.mock.calls[0][1];
      expect(attachment.filename).toBe("Offer-Letter-Priya-Sharma-Senior-Counsellor.pdf");
      expect(attachment.filename).not.toContain("..");
      expect(attachment.filename).not.toContain("/");
    });

    it("FAILS THE WHOLE ACTION when the letter cannot be read — a candidate must never be marked offered with nothing sent", async () => {
      storage.getObject.mockRejectedValue(new Error("not found"));
      await expect(runWithScope("all", () => service.offer(TENANT, "app-1", "user-1", body))).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(repo.applyDecision).not.toHaveBeenCalled();
      expect(notifications.sendOffer).not.toHaveBeenCalled();
    });

    it("rejects an offer-letter key outside this tenant's namespace", async () => {
      await expect(
        runWithScope("all", () =>
          service.offer(TENANT, "app-1", "user-1", {
            ...body,
            offerLetterStorageKey: "offer-letters/other-tenant/uuid.pdf",
          }),
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(storage.getObject).not.toHaveBeenCalled();
    });

    it("sets status=selected and persists the letter reference", async () => {
      await runWithScope("all", () => service.offer(TENANT, "app-1", "user-1", body));
      const written = repo.applyDecision.mock.calls[0][2];
      expect(written.status).toBe("selected");
      expect(written.offerLetterStorageKey).toBe(OFFER_KEY);
    });
  });

  describe("reject", () => {
    it("emails the candidate", async () => {
      await runWithScope("all", () => service.reject(TENANT, "app-1", "user-1", {}));
      expect(notifications.sendRejection).toHaveBeenCalledTimes(1);
      expect(repo.applyDecision.mock.calls[0][2].status).toBe("rejected");
    });

    it("NEVER passes internalNotes to the notification layer — the reason stays internal", async () => {
      await runWithScope("all", () =>
        service.reject(TENANT, "app-1", "user-1", { internalNotes: "weak on the practical, duplicate of #88" }),
      );
      expect(repo.applyDecision.mock.calls[0][2].internalNotes).toContain("weak on the practical");
      expect(JSON.stringify(notifications.sendRejection.mock.calls[0])).not.toContain("weak on the practical");
    });

    it("records the decision even when the email fails — a bounced mailbox must not roll back a reviewer's call", async () => {
      notifications.sendRejection.mockResolvedValue(false);
      await expect(runWithScope("all", () => service.reject(TENANT, "app-1", "user-1", {}))).resolves.toBeDefined();
      expect(repo.applyDecision).toHaveBeenCalledTimes(1);
    });
  });

  describe("concurrent review", () => {
    it("checks the acceptable statuses INSIDE the update, so two reviewers cannot both decide one application", async () => {
      await runWithScope("all", () => service.reject(TENANT, "app-1", "user-1", {}));
      expect(repo.applyDecision.mock.calls[0][1]).toEqual(["new", "on_hold", "shortlisted"]);
    });

    it("422s the second reviewer instead of silently re-emailing the candidate", async () => {
      repo.applyDecision.mockResolvedValue(0);
      repo.findById.mockResolvedValue(makeRow({ status: "rejected" }));
      await expect(runWithScope("all", () => service.reject(TENANT, "app-1", "user-2", {}))).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(notifications.sendRejection).not.toHaveBeenCalled();
    });

    it.each(["hold", "shortlist", "offer"] as const)("the same guard applies to %s", async (verb) => {
      repo.applyDecision.mockResolvedValue(0);
      repo.findById.mockResolvedValue(makeRow({ status: "selected" }));
      const call =
        verb === "hold"
          ? () => service.hold(TENANT, "app-1", "user-2", {})
          : verb === "shortlist"
            ? () => service.shortlist(TENANT, "app-1", "user-2", { roundName: "R", details: "D" })
            : () =>
                service.offer(TENANT, "app-1", "user-2", {
                  offerLetterStorageKey: OFFER_KEY,
                  offerLetterFileName: "o.pdf",
                });
      await expect(runWithScope("all", call)).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  // ── Reads ─────────────────────────────────────────────────────────────────

  describe("detail", () => {
    it("mints signed download URLs and never returns a raw storage key", async () => {
      repo.findById.mockResolvedValue(makeRow({ offerLetterStorageKey: OFFER_KEY, offerLetterFileName: "o.pdf" }));
      const detail = await runWithScope("all", () => service.getById(TENANT, "app-1"));
      expect(detail.resumeDownloadUrl).toBe("https://signed.example/get");
      expect(detail.offerLetterDownloadUrl).toBe("https://signed.example/get");
      expect(JSON.stringify(detail)).not.toContain(RESUME_KEY);
      expect(JSON.stringify(detail)).not.toContain(OFFER_KEY);
    });

    it("still returns the application when a download URL cannot be minted (non-fatal)", async () => {
      storage.getSignedDownloadUrl.mockRejectedValue(new Error("no credentials"));
      const detail = await runWithScope("all", () => service.getById(TENANT, "app-1"));
      expect(detail.resumeDownloadUrl).toBeNull();
      expect(detail.name).toBe("Priya Sharma");
    });

    it("treats a SOFT-DELETED opening as absent — nested includes are not soft-delete filtered", async () => {
      repo.findById.mockResolvedValue(
        makeRow({
          jobOpening: { id: "opening-1", title: "Senior Counsellor", deletedAt: new Date() } as never,
        }),
      );
      const detail = await runWithScope("all", () => service.getById(TENANT, "app-1"));
      expect(detail.jobOpening).toBeNull();
      expect(detail.jobOpeningId).toBeNull();
      // The role snapshot still tells the reviewer what this person applied for.
      expect(detail.role).toBe("Senior Counsellor");
    });
  });

  describe("resendAcknowledgement", () => {
    it("refuses when one has already gone out — a second click must not re-mail the candidate", async () => {
      repo.findById.mockResolvedValue(makeRow({ acknowledgedAt: new Date("2026-01-01T00:00:00Z") }));
      const result = await runWithScope("all", () => service.resendAcknowledgement(TENANT, "app-1"));
      expect(result.sent).toBe(false);
      expect(notifications.sendAcknowledgement).not.toHaveBeenCalled();
    });

    it("sends and stamps when the original never went out", async () => {
      repo.findById.mockResolvedValue(makeRow({ acknowledgedAt: null }));
      const result = await runWithScope("all", () => service.resendAcknowledgement(TENANT, "app-1"));
      expect(result.sent).toBe(true);
      expect(repo.markAcknowledged).toHaveBeenCalled();
    });
  });

  describe("guards", () => {
    it.each(["own", "branch", "assigned"] as const)("refuses the %s data-scope fail-closed", async (scope) => {
      await expect(
        runWithScope(scope, () => service.list(TENANT, { page: 1, pageSize: 20 })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("404s on an unknown application", async () => {
      repo.findById.mockResolvedValue(null);
      await expect(runWithScope("all", () => service.getById(TENANT, "nope"))).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
