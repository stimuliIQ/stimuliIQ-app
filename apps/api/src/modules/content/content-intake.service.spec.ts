// apps/api/src/modules/content/content-intake.service.spec.ts
//
// Unit tests for ContentIntakeService (docs/plans/phase-9-completion.md T22/T32). Covers:
// captcha gate, rate-limit gate, server-computed consent (raw IP never stored — only its
// hash), free-text sanitization (defense-in-depth on anonymous UGC), the newsletter
// unsubscribe HMAC token (tamper -> rejected, idempotent on unknown/already-deleted id),
// and the career-application signed resume download URL (never a raw storage key).

import { ForbiddenException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { ContentIntakeService } from "./content-intake.service";
import { ContentIntakeRepository, type CareerApplicationRow } from "./content-intake.repository";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";
import type { CaptchaProvider } from "../captcha/providers/captcha/captcha-provider.interface";
import type { StorageProvider } from "../storage/providers/storage/storage-provider.interface";
import type { PublicBookingRateLimiter } from "../leads/lib/public-booking-rate-limiter";

process.env.NOTIFICATION_SIGNING_SECRET = "test-signing-secret-content-intake-0000000000000000000000";
// These required-by-schema vars (see config/env.ts) are unconditionally required
// regardless of NODE_ENV — set them explicitly so validateEnv() succeeds
// deterministically (signUnsubscribeToken/getCareerResumeUploadUrl both call it),
// matching the pattern in certificate-pdf.queue-driver-gate.spec.ts's BASE_ENV,
// instead of relying on cross-file process.env pollution from whichever spec Jest
// happens to run first in the same worker.
process.env["DATABASE_URL"] ??= "postgresql://postgres:postgres@localhost:5432/stimuliiq";
process.env["REDIS_URL"] ??= "redis://localhost:6379";
process.env["JWT_PRIVATE_KEY_PATH"] ??= "./keys/jwt-private.pem";
process.env["JWT_PUBLIC_KEY_PATH"] ??= "./keys/jwt-public.pem";
process.env["COOKIE_SECRET"] ??= "a".repeat(32);
process.env["CSRF_SECRET"] ??= "b".repeat(32);

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<ContentIntakeRepository> {
  return {
    subscribeNewsletter: jest.fn().mockResolvedValue({ id: "sub-1" }),
    upsertNewsletterLead: jest.fn().mockResolvedValue(undefined),
    findNewsletterSubscriptionById: jest.fn(),
    unsubscribeNewsletter: jest.fn(),
    listNewsletterSubscriptions: jest.fn(),
    createContactSubmission: jest.fn().mockResolvedValue({ id: "contact-1" }),
    listContactSubmissions: jest.fn(),
    findContactSubmissionById: jest.fn(),
    updateContactSubmissionStatus: jest.fn(),
    createCareerApplication: jest.fn().mockResolvedValue({ id: "career-1" }),
    listCareerApplications: jest.fn(),
    findCareerApplicationById: jest.fn(),
    updateCareerApplicationStatus: jest.fn(),
    getTenantIdBySlug: jest.fn().mockResolvedValue("tenant-1"),
  } as unknown as Mocked<ContentIntakeRepository>;
}

function mockCaptcha(success: boolean): Mocked<CaptchaProvider> {
  return { verify: jest.fn().mockResolvedValue({ success, errorCodes: success ? [] : ["invalid-token"] }) } as unknown as Mocked<CaptchaProvider>;
}

function mockStorage(): Mocked<StorageProvider> {
  return {
    getSignedUploadUrl: jest.fn().mockResolvedValue({
      url: "https://signed.example/upload/careers/tenant-1/uuid-resume.pdf",
      storageKey: "careers/tenant-1/uuid-resume.pdf",
      expiresAt: new Date("2026-01-01T00:15:00Z"),
      requiredHeaders: { "Content-Type": "application/pdf" },
    }),
    getSignedDownloadUrl: jest.fn().mockResolvedValue({ url: "https://signed.example/resume.pdf", expiresAt: new Date() }),
    putObject: jest.fn(),
    delete: jest.fn(),
    head: jest.fn(),
  } as unknown as Mocked<StorageProvider>;
}

function mockRateLimiter(limited: boolean): Mocked<PublicBookingRateLimiter> {
  return { hit: jest.fn().mockResolvedValue(limited) } as unknown as Mocked<PublicBookingRateLimiter>;
}

function runWithScope<T>(scope: ScopeContext["scope"], fn: () => T): T {
  const ctx: ScopeContext = { permissionKey: "content.view", scope, actorId: "actor-1", tenantId: "tenant-1" };
  return scopeContextStorage.run(ctx, fn);
}

const CAREER_ROW: CareerApplicationRow = {
  id: "career-1",
  name: "Jane Applicant",
  email: "jane@test.com",
  phone: null,
  role: "Backend Engineer",
  resumeStorageKey: "careers/tenant-1/jane/resume.pdf",
  coverLetter: "Excited to apply!",
  status: "new",
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

describe("ContentIntakeService", () => {
  let repo: Mocked<ContentIntakeRepository>;
  let captcha: Mocked<CaptchaProvider>;
  let storage: Mocked<StorageProvider>;

  function makeService(rateLimited = false): ContentIntakeService {
    repo = mockRepository();
    captcha = mockCaptcha(true);
    storage = mockStorage();
    const rateLimiter = mockRateLimiter(rateLimited);
    return new ContentIntakeService(
      repo as unknown as ContentIntakeRepository,
      captcha as unknown as CaptchaProvider,
      storage as unknown as StorageProvider,
      rateLimiter as unknown as PublicBookingRateLimiter,
    );
  }

  describe("captcha + rate-limit gates", () => {
    it("verifyCaptcha throws 422 when the provider reports failure", async () => {
      const service = makeService();
      captcha.verify.mockResolvedValue({ success: false, errorCodes: ["timeout-or-duplicate"] });
      await expect(service.verifyCaptcha("bad-token", "1.2.3.4")).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it("checkRateLimit throws 422 when the limiter reports limited", async () => {
      const service = makeService(true);
      await expect(service.checkRateLimit("1.2.3.4", "content.newsletter.rate_limited")).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  describe("consent + sanitization (anonymous UGC)", () => {
    it("submitContact builds consent server-side and NEVER stores the raw IP (only its hash)", async () => {
      const service = makeService();
      await service.submitContact(
        { name: "John", email: "j@test.com", message: "Hello there", consent: { marketingOptIn: true, tosVersion: "v1.0" }, captchaToken: "tok" },
        "203.0.113.5",
      );
      const call = repo.createContactSubmission.mock.calls[0][1];
      expect(call.consent.ip_hash).not.toBe("203.0.113.5");
      expect(call.consent.ip_hash).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
      expect(call.consent.marketing_opt_in).toBe(true);
    });

    it("submitContact strips HTML TAGS from free-text fields (defense-in-depth write-time strip — the tag content, not just the tag, may remain; DOMPurify-at-render-sink per ADR-0045 is the real XSS control for the eventual render surface)", async () => {
      const service = makeService();
      await service.submitContact(
        { name: "John", email: "j@test.com", message: "<script>alert(1)</script>Hello", consent: { marketingOptIn: false, tosVersion: "v1.0" }, captchaToken: "tok" },
        "1.2.3.4",
      );
      const call = repo.createContactSubmission.mock.calls[0][1];
      expect(call.message).not.toContain("<script>");
      expect(call.message).not.toContain("</script>");
      expect(call.message).toBe("alert(1)Hello");
    });

    it("submitCareerApplication sanitizes coverLetter and role, and never touches consent (no consent field on this DTO)", async () => {
      const service = makeService();
      await service.submitCareerApplication({
        name: "Jane",
        email: "jane@test.com",
        role: "<b>Backend</b> Engineer",
        resumeStorageKey: "careers/tenant-1/jane/resume.pdf",
        coverLetter: "<i>Excited</i> to apply",
        captchaToken: "tok",
      });
      const call = repo.createCareerApplication.mock.calls[0][1];
      expect(call.role).toBe("Backend Engineer");
      expect(call.coverLetter).toBe("Excited to apply");
    });
  });

  describe("newsletter unsubscribe HMAC token", () => {
    it("a tampered token is rejected (422 content.invalid_token)", async () => {
      const service = makeService();
      await expect(service.unsubscribeNewsletter("not-a-real-token")).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(repo.unsubscribeNewsletter).not.toHaveBeenCalled();
    });

    it("a valid token for an existing subscription unsubscribes it", async () => {
      const service = makeService();
      const token = service.buildUnsubscribeToken("sub-1");
      repo.findNewsletterSubscriptionById.mockResolvedValue({ id: "sub-1", email: "x@test.com", status: "active", unsubscribedAt: null, createdAt: new Date(), deletedAt: null });

      const result = await service.unsubscribeNewsletter(token);
      expect(result.message).toContain("unsubscribed");
      expect(repo.unsubscribeNewsletter).toHaveBeenCalledWith("sub-1");
    });

    it("a well-formed but forged subscriptionId (different id, same HMAC scheme attempted) is rejected", async () => {
      const service = makeService();
      const validToken = service.buildUnsubscribeToken("sub-1");
      // Tamper: decode, swap the id, re-encode WITHOUT recomputing the HMAC (forgery attempt).
      const decoded = Buffer.from(validToken, "base64url").toString("utf8");
      const [version, , hmac] = decoded.split(":");
      const forged = Buffer.from(`${version}:sub-DIFFERENT:${hmac}`).toString("base64url");
      await expect(service.unsubscribeNewsletter(forged)).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it("an unknown (but validly-signed) subscription id is idempotent-success (no existence leak)", async () => {
      const service = makeService();
      const token = service.buildUnsubscribeToken("sub-unknown");
      repo.findNewsletterSubscriptionById.mockResolvedValue(null);
      const result = await service.unsubscribeNewsletter(token);
      expect(result.message).toContain("unsubscribed");
      expect(repo.unsubscribeNewsletter).not.toHaveBeenCalled();
    });
  });

  describe("career application admin surface", () => {
    it("getCareerApplicationById mints a SIGNED download URL — never the raw storage key", async () => {
      const service = makeService();
      repo.findCareerApplicationById.mockResolvedValue(CAREER_ROW);
      const result = await runWithScope("all", () => service.getCareerApplicationById("tenant-1", "career-1"));
      expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith({ key: CAREER_ROW.resumeStorageKey });
      expect(result.resumeDownloadUrl).toBe("https://signed.example/resume.pdf");
      expect(result).not.toHaveProperty("resumeStorageKey");
    });

    it("non-all scope fails closed (403)", async () => {
      const service = makeService();
      await expect(runWithScope("own", () => service.listCareerApplications("tenant-1", { page: 1, pageSize: 20 }))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it("updateCareerApplicationStatus on a missing application -> 404", async () => {
      const service = makeService();
      repo.findCareerApplicationById.mockResolvedValue(null);
      await expect(
        runWithScope("all", () => service.updateCareerApplicationStatus("tenant-1", "missing", { status: "shortlisted" })),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("getCareerResumeUploadUrl (Phase-9-completion gap #3 — anonymous resume upload seam)", () => {
    it("mints a signed upload URL scoped under careers/, with no auth/scope context required", async () => {
      const service = makeService();
      const result = await service.getCareerResumeUploadUrl({
        contentType: "application/pdf",
        fileName: "my-resume.pdf",
        sizeBytes: 500_000,
        captchaToken: "noop",
      });

      expect(storage.getSignedUploadUrl).toHaveBeenCalledTimes(1);
      const callArgs = storage.getSignedUploadUrl.mock.calls[0][0];
      expect(callArgs.key).toMatch(/^careers\/tenant-1\//);
      expect(result.storageKey).toBe("careers/tenant-1/uuid-resume.pdf");
      expect(result.uploadUrl).toBeTruthy();
      expect(result.maxSizeBytes).toBe(500_000);
      expect(result).not.toHaveProperty("filename");
    });
  });
});
