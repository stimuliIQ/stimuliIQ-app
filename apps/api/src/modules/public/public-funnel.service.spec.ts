// apps/api/src/modules/public/public-funnel.service.spec.ts
//
// Unit tests for PublicFunnelService.
// Verifies:
//   - Lead consent is SERVER-COMPUTED (timestamp + ip_hash from server, never client).
//   - Coupon-validate no-leak (no id, maxUses, used, programScope in response).
//   - Register enumeration-resistant (existing email → same generic response shape, AC-13).
//   - Funnel own-scope guard: cross-student order access → NotFoundException (AC-22).
//   - Honeypot is checked by controller before service (tested in controller tests).
//   - Captcha failure → UnprocessableEntityException.
//   - TOS version mismatch → UnprocessableEntityException.

import { Test, TestingModule } from "@nestjs/testing";
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { PublicFunnelService } from "./public-funnel.service";
import { PublicRepository } from "./public.repository";
import { LeadsRepository } from "../leads/leads.repository";
import { AuthRepository } from "../auth/auth.repository";
import { TokenService } from "../auth/lib/token.service";
import { OtpStore } from "../auth/lib/otp-store";
import { CommerceService } from "../commerce/commerce.service";
import { CAPTCHA_PROVIDER } from "../captcha/providers/captcha/captcha-provider.interface";
import { PublicBookingRateLimiter } from "../leads/lib/public-booking-rate-limiter";
import { NotificationsService } from "../notifications/notifications.service";

// ─── Env mocking ────────────────────────────────────────────────────────────

jest.mock("../../config/env", () => ({
  validateEnv: jest.fn(() => ({
    TOS_VERSION: "v1.0",
    LMS_APP_URL: "https://lms.stimuliiq.com",
  })),
}));

// ─── generateCsrfToken mock ─────────────────────────────────────────────────

jest.mock("../auth/lib/cookies", () => ({
  generateCsrfToken: jest.fn(() => "csrf-token-mock"),
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

const TENANT_ID = "tenant-1";
const STUDENT_USER_ID = "user-student-1";
const STUDENT_PROFILE_ID = "profile-1";
const OTHER_STUDENT_USER_ID = "user-student-2";
const OTHER_STUDENT_PROFILE_ID = "profile-2";
const PROGRAM_ID = "prog-1";
const ORDER_ID = "order-1";
const RAZORPAY_ORDER_ID = "rp-order-1";

const MOCK_PROFILE = { id: STUDENT_PROFILE_ID, userId: STUDENT_USER_ID };
const MOCK_OTHER_PROFILE = { id: OTHER_STUDENT_PROFILE_ID, userId: OTHER_STUDENT_USER_ID };
const MOCK_ORDER = { id: ORDER_ID, studentId: STUDENT_PROFILE_ID };
const MOCK_BATCH = { id: "batch-1" };
const MOCK_PAYMENT = { id: "pay-1", orderId: ORDER_ID, providerOrderId: RAZORPAY_ORDER_ID };
const MOCK_ENROLLMENT = { id: "enroll-1", orderId: ORDER_ID };

function buildMocks() {
  return {
    publicRepository: {
      getTenantIdBySlug: jest.fn().mockResolvedValue(TENANT_ID),
      createLead: jest.fn().mockResolvedValue("lead-1"),
      writeAuditLog: jest.fn().mockResolvedValue(undefined),
      findCouponByCode: jest.fn().mockResolvedValue({
        id: "coupon-1",
        code: "SAVE10",
        type: "pct",
        value: 10,
        status: "active",
        maxUses: null,
        used: 0,
        validFrom: null,
        validTo: null,
        programScope: null,
      }),
      // enrollmentEnabled: createEnrollOrder refuses to build an order for a program
      // whose public checkout is closed, so the happy-path fixture must be open.
      findPublicProgramById: jest
        .fn()
        .mockResolvedValue({ id: PROGRAM_ID, pricePaise: 100000, enrollmentEnabled: true }),
      createUserWithStudentProfile: jest.fn().mockResolvedValue({ userId: "user-new", profileId: "profile-new" }),
      findStudentProfileByUserId: jest.fn().mockResolvedValue(MOCK_PROFILE),
      findAvailableBatchForProgram: jest.fn().mockResolvedValue(MOCK_BATCH),
      findOrderForStudent: jest.fn().mockResolvedValue(MOCK_ORDER),
      findPaymentByProviderOrderId: jest.fn().mockResolvedValue(MOCK_PAYMENT),
      findEnrollmentByOrderId: jest.fn().mockResolvedValue(MOCK_ENROLLMENT),
    } as unknown as jest.Mocked<PublicRepository>,
    leadsRepository: {
      pickRoundRobinOwner: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<LeadsRepository>,
    authRepository: {
      findUserByEmail: jest.fn().mockResolvedValue(null),
      getRbacProfile: jest.fn().mockResolvedValue({ roleKeys: ["student"] }),
      createSession: jest.fn().mockResolvedValue({ id: "session-1" }),
      rotateSessionRefreshHash: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuthRepository>,
    tokenService: {
      signAccessToken: jest.fn().mockResolvedValue("access-token"),
      signRefreshToken: jest.fn().mockResolvedValue("refresh-token"),
      hashRefreshToken: jest.fn().mockReturnValue("refresh-hash"),
    } as unknown as jest.Mocked<TokenService>,
    otpStore: {
      verify: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<OtpStore>,
    commerceService: {
      createOrder: jest.fn().mockResolvedValue({
        id: ORDER_ID,
        amountPaise: 100000,
        currency: "INR",
        discountPaise: 0,
        status: "pending",
      }),
      initiateRazorpayCheckout: jest.fn().mockResolvedValue({
        razorpayOrderId: RAZORPAY_ORDER_ID,
        keyId: "rzp_test_public_key_id",
        amountPaise: 100000,
        currency: "INR",
        orderId: ORDER_ID,
      }),
      verifyPayment: jest.fn().mockResolvedValue({
        id: "pay-1",
        status: "captured",
      }),
    } as unknown as jest.Mocked<CommerceService>,
    captchaProvider: {
      verify: jest.fn().mockResolvedValue({ success: true }),
    },
    rateLimiter: {
      hit: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<PublicBookingRateLimiter>,
    // Staff-facing: tells the round-robin-assigned rep an inbound lead just landed.
    // Non-fatal by design, the public visitor's response must not depend on it.
    notifications: {
      notifyLeadAssigned: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<NotificationsService>,
  };
}

describe("PublicFunnelService", () => {
  let service: PublicFunnelService;
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(async () => {
    mocks = buildMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublicFunnelService,
        { provide: PublicRepository, useValue: mocks.publicRepository },
        { provide: LeadsRepository, useValue: mocks.leadsRepository },
        { provide: AuthRepository, useValue: mocks.authRepository },
        { provide: TokenService, useValue: mocks.tokenService },
        { provide: OtpStore, useValue: mocks.otpStore },
        { provide: CommerceService, useValue: mocks.commerceService },
        { provide: CAPTCHA_PROVIDER, useValue: mocks.captchaProvider },
        { provide: PublicBookingRateLimiter, useValue: mocks.rateLimiter },
        { provide: NotificationsService, useValue: mocks.notifications },
      ],
    }).compile();

    service = module.get<PublicFunnelService>(PublicFunnelService);
  });

  // ─── Captcha ──────────────────────────────────────────────────────────────

  describe("verifyCaptcha", () => {
    it("throws UnprocessableEntityException when captcha fails", async () => {
      mocks.captchaProvider.verify.mockResolvedValue({ success: false, errorCodes: ["invalid-input-response"] });
      await expect(service.verifyCaptcha("bad-token", "1.2.3.4")).rejects.toThrow(UnprocessableEntityException);
    });

    it("does not throw when captcha passes", async () => {
      mocks.captchaProvider.verify.mockResolvedValue({ success: true });
      await expect(service.verifyCaptcha("good-token", "1.2.3.4")).resolves.not.toThrow();
    });
  });

  // ─── Rate limit ───────────────────────────────────────────────────────────

  describe("checkRateLimit", () => {
    it("throws UnprocessableEntityException when rate limit trips", async () => {
      mocks.rateLimiter.hit.mockResolvedValue(true);
      await expect(service.checkRateLimit("1.2.3.4", "public.rate_limited")).rejects.toThrow(UnprocessableEntityException);
    });
  });

  // ─── P-3: Lead capture ───────────────────────────────────────────────────

  describe("createLead", () => {
    const VALID_LEAD_DTO = {
      name: "Alice",
      phone: "9876543210",
      email: "alice@example.com",
      source: "website",
      programInterestId: PROGRAM_ID,
      utm: { source: "google", medium: "cpc" },
      consent: { marketingOptIn: true, tosVersion: "v1.0" },
      captchaToken: "test-token",
    };

    it("creates a lead and returns leadId + message", async () => {
      const result = await service.createLead(VALID_LEAD_DTO, "1.2.3.4");
      expect(result.leadId).toBe("lead-1");
      expect(result.message).toContain("counsellor");
    });

    it("persists marketing-popup fields (courseInterest / college / language / message)", async () => {
      await service.createLead(
        {
          ...VALID_LEAD_DTO,
          source: "web-timed-popup",
          courseInterest: "Full Stack Web Development",
          college: "IIT Bombay",
          language: "Hindi",
          message: "Do you have weekend batches?",
        },
        "1.2.3.4",
      );
      const callArg = (mocks.publicRepository.createLead as jest.Mock).mock.calls[0][0];
      expect(callArg).toMatchObject({
        source: "web-timed-popup",
        courseInterest: "Full Stack Web Development",
        college: "IIT Bombay",
        language: "Hindi",
        message: "Do you have weekend batches?",
      });
    });

    it("consent: timestamp is SERVER-COMPUTED (not from DTO)", async () => {
      const before = Date.now();
      await service.createLead(VALID_LEAD_DTO, "1.2.3.4");
      const after = Date.now();

      const callArg = (mocks.publicRepository.createLead as jest.Mock).mock.calls[0][0];
      const consentTimestamp = new Date(callArg.consent.timestamp as string).getTime();
      // Timestamp must be between test start and now (server-generated, not from DTO)
      expect(consentTimestamp).toBeGreaterThanOrEqual(before - 1000);
      expect(consentTimestamp).toBeLessThanOrEqual(after + 1000);
    });

    it("consent: ip_hash is SHA-256 of IP (never raw IP stored)", async () => {
      await service.createLead(VALID_LEAD_DTO, "1.2.3.4");

      const callArg = (mocks.publicRepository.createLead as jest.Mock).mock.calls[0][0];
      const { ip_hash } = callArg.consent as { ip_hash: string };

      // ip_hash must be a 64-char hex string (SHA-256)
      expect(ip_hash).toMatch(/^[0-9a-f]{64}$/);
      // The raw IP must NOT be anywhere in the consent record
      const consentStr = JSON.stringify(callArg.consent);
      expect(consentStr).not.toContain("1.2.3.4");
    });

    it("consent: raw IP never appears in the stored consent object", async () => {
      await service.createLead(VALID_LEAD_DTO, "192.168.100.200");
      const callArg = (mocks.publicRepository.createLead as jest.Mock).mock.calls[0][0];
      const consentStr = JSON.stringify(callArg.consent);
      expect(consentStr).not.toContain("192.168.100.200");
    });

    it("TOS version mismatch → UnprocessableEntityException", async () => {
      const badDto = { ...VALID_LEAD_DTO, consent: { ...VALID_LEAD_DTO.consent, tosVersion: "v99.0" } };
      await expect(service.createLead(badDto, "1.2.3.4")).rejects.toThrow(UnprocessableEntityException);
    });

    it("writes an audit log entry for the lead", async () => {
      await service.createLead(VALID_LEAD_DTO, "1.2.3.4");
      expect(mocks.publicRepository.writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ entity: "lead", action: "create" }),
      );
    });

    it("audit log ip field is null (raw IP never in audit, AC-37)", async () => {
      await service.createLead(VALID_LEAD_DTO, "9.9.9.9");
      const auditCall = (mocks.publicRepository.writeAuditLog as jest.Mock).mock.calls[0][0];
      expect(auditCall.ip).toBeNull();
      // Raw IP must not appear anywhere in audit call args
      const auditStr = JSON.stringify(auditCall);
      expect(auditStr).not.toContain("9.9.9.9");
    });
  });

  // ─── P-5: Coupon validate ─────────────────────────────────────────────────

  describe("validateCoupon", () => {
    const VALID_COUPON_DTO = { code: "SAVE10", programId: PROGRAM_ID, captchaToken: "test-token" };

    it("returns discount fields (no internals)", async () => {
      const result = await service.validateCoupon(VALID_COUPON_DTO, "1.2.3.4");

      // Allowed fields
      expect(result.originalPaise).toBe(100000);
      expect(result.discountPaise).toBe(10000); // 10% of 100000
      expect(result.finalPaise).toBe(90000);
      expect(result.type).toBe("pct");
      expect(result.displayCode).toBe("SAVE10");

      // Forbidden fields, coupon internals NEVER in response (AC-9)
      expect(result).not.toHaveProperty("id");
      expect(result).not.toHaveProperty("maxUses");
      expect(result).not.toHaveProperty("used");
      expect(result).not.toHaveProperty("validFrom");
      expect(result).not.toHaveProperty("validTo");
      expect(result).not.toHaveProperty("programScope");
      expect(result).not.toHaveProperty("status");
      expect(result).not.toHaveProperty("tenantId");
    });

    it("flat coupon math is correct (integer paise, no floats)", async () => {
      mocks.publicRepository.findCouponByCode.mockResolvedValue({
        id: "coupon-2",
        code: "FLAT5K",
        type: "flat",
        value: 5000,
        status: "active",
        maxUses: null,
        used: 0,
        validFrom: null,
        validTo: null,
        programScope: null,
      });
      const result = await service.validateCoupon({ code: "FLAT5K", programId: PROGRAM_ID, captchaToken: "test-token" }, "1.2.3.4");
      expect(result.discountPaise).toBe(5000);
      expect(result.finalPaise).toBe(95000);
      expect(Number.isInteger(result.discountPaise)).toBe(true);
      expect(Number.isInteger(result.finalPaise)).toBe(true);
    });

    it("throws UnprocessableEntityException for unknown coupon (no existence leak)", async () => {
      mocks.publicRepository.findCouponByCode.mockResolvedValue(null);
      await expect(service.validateCoupon(VALID_COUPON_DTO, "1.2.3.4")).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it("throws UnprocessableEntityException for expired coupon (same error, no detail leak)", async () => {
      mocks.publicRepository.findCouponByCode.mockResolvedValue({
        id: "coupon-3",
        code: "EXPIRED",
        type: "pct",
        value: 20,
        status: "active",
        maxUses: null,
        used: 0,
        validFrom: null,
        validTo: new Date("2020-01-01"), // Expired
        programScope: null,
      });
      await expect(service.validateCoupon({ code: "EXPIRED", programId: PROGRAM_ID, captchaToken: "test-token" }, "1.2.3.4")).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it("error message for missing vs inactive coupon is identical (AC-10, no existence leak)", async () => {
      // Missing coupon
      mocks.publicRepository.findCouponByCode.mockResolvedValue(null);
      let errorMissing: UnprocessableEntityException | undefined;
      try {
        await service.validateCoupon(VALID_COUPON_DTO, "1.2.3.4");
      } catch (e) {
        errorMissing = e as UnprocessableEntityException;
      }

      // Inactive coupon
      mocks.publicRepository.findCouponByCode.mockResolvedValue({
        id: "coupon-4",
        code: "SAVE10",
        type: "pct",
        value: 10,
        status: "inactive",
        maxUses: null,
        used: 0,
        validFrom: null,
        validTo: null,
        programScope: null,
      });
      let errorInactive: UnprocessableEntityException | undefined;
      try {
        await service.validateCoupon(VALID_COUPON_DTO, "1.2.3.4");
      } catch (e) {
        errorInactive = e as UnprocessableEntityException;
      }

      // Both errors should have the same error code and message (no info leak)
      expect(errorMissing?.getResponse()).toEqual(errorInactive?.getResponse());
    });
  });

  // ─── P-6: Registration ───────────────────────────────────────────────────

  describe("register", () => {
    const VALID_REGISTER_DTO = {
      name: "Bob Student",
      email: "bob@example.com",
      phone: "9999999999",
      password: "SecurePassword123!",
      otpCode: "123456",
      consent: { marketingOptIn: true, tosVersion: "v1.0" },
      captchaToken: "test-token",
    };

    it("creates a new student and returns session", async () => {
      const result = await service.register(VALID_REGISTER_DTO, "1.2.3.4");
      expect(result.session.user.email).toBe("bob@example.com");
      expect(result.tokens).toBeDefined();
      expect(result.tokens!.accessToken).toBe("access-token");
      expect(result.session.csrfToken).toBe("csrf-token-mock");
    });

    it("enumeration-resistant: existing email returns same response shape (AC-13)", async () => {
      // Simulate existing user
      mocks.authRepository.findUserByEmail.mockResolvedValue({
        id: "existing-user",
        name: "Bob Existing",
        email: "bob@example.com",
        phone: "9999999999",
        avatar: null,
        status: "active" as const,
      } as never);

      const result = await service.register(VALID_REGISTER_DTO, "1.2.3.4");

      // C-1 (account-takeover guard): existing email must NOT mint a session/tokens.
      // The 201-shaped body echoes only caller input (VALID_REGISTER_DTO.email), never
      // the existing account's real id/session.
      expect(result.tokens).toBeUndefined();
      expect(result.session.user.id).toBe("");
      expect(result.session.user.email).toBe(VALID_REGISTER_DTO.email);
      // createUserWithStudentProfile must NOT have been called (no duplicate user creation)
      expect(mocks.publicRepository.createUserWithStudentProfile).not.toHaveBeenCalled();
      // No tokens minted (result.tokens undefined) is the proof no session was issued.
    });

    it("enumeration-resistant: no exception thrown for existing email", async () => {
      mocks.authRepository.findUserByEmail.mockResolvedValue({
        id: "existing-user",
        name: "Bob",
        email: "bob@example.com",
        phone: null,
        avatar: null,
        status: "active" as const,
      } as never);
      // Should NOT throw, returns a 201-equivalent response
      await expect(service.register(VALID_REGISTER_DTO, "1.2.3.4")).resolves.not.toThrow();
    });

    it("invalid OTP → UnprocessableEntityException", async () => {
      mocks.otpStore.verify.mockResolvedValue(false);
      await expect(service.register(VALID_REGISTER_DTO, "1.2.3.4")).rejects.toThrow(UnprocessableEntityException);
    });

    it("TOS version mismatch → UnprocessableEntityException", async () => {
      const badDto = { ...VALID_REGISTER_DTO, consent: { ...VALID_REGISTER_DTO.consent, tosVersion: "v0.1" } };
      await expect(service.register(badDto, "1.2.3.4")).rejects.toThrow(UnprocessableEntityException);
    });

    it("response user object never contains roles field (type safety, AC-26)", async () => {
      const result = await service.register(VALID_REGISTER_DTO, "1.2.3.4");
      expect(result.session.user).not.toHaveProperty("roles");
      expect(result.session.user).not.toHaveProperty("permissions");
      expect(result.session.user).not.toHaveProperty("passwordHash");
    });

    it("audit log is written for new registration", async () => {
      await service.register(VALID_REGISTER_DTO, "1.2.3.4");
      expect(mocks.publicRepository.writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ entity: "user", action: "create" }),
      );
    });
  });

  // ─── P-7: Order creation ─────────────────────────────────────────────────

  describe("createEnrollOrder", () => {
    it("returns order summary with server-derived amounts", async () => {
      const result = await service.createEnrollOrder(
        { programId: PROGRAM_ID, couponCode: undefined, emiPlan: undefined },
        STUDENT_USER_ID,
        TENANT_ID,
        "idem-key-1",
      );
      expect(result.orderId).toBe(ORDER_ID);
      expect(result.amountPaise).toBe(100000);
      expect(result.currency).toBe("INR");
    });

    it("refuses to create an order when enrollment is closed for the program", async () => {
      // The website hides every "Enroll Now" CTA for such a program, but /enroll/:slug is
      // a guessable URL and this endpoint is directly callable, the server must refuse
      // rather than rely on the hidden button (CLAUDE.md §3.5).
      // Partial row: the guard under test reads only these three fields, and the cast
      // follows this file's existing convention for narrow repository mocks (see the
      // `as unknown as jest.Mocked<...>` stubs at the top).
      mocks.publicRepository.findPublicProgramById.mockResolvedValue({
        id: PROGRAM_ID,
        pricePaise: 100000,
        enrollmentEnabled: false,
      } as unknown as Awaited<ReturnType<PublicRepository["findPublicProgramById"]>>);

      await expect(
        service.createEnrollOrder(
          { programId: PROGRAM_ID, couponCode: undefined, emiPlan: undefined },
          STUDENT_USER_ID,
          TENANT_ID,
          "idem-key-closed",
        ),
      ).rejects.toMatchObject({ response: { code: "public.enrollment_closed" } });

      // and it must bail out BEFORE any order is created
      expect(mocks.commerceService.createOrder).not.toHaveBeenCalled();
    });

    it("throws NotFoundException when student profile not found", async () => {
      mocks.publicRepository.findStudentProfileByUserId.mockResolvedValue(null);
      await expect(
        service.createEnrollOrder({ programId: PROGRAM_ID }, STUDENT_USER_ID, TENANT_ID, "idem-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws ConflictException when no batch available", async () => {
      mocks.publicRepository.findAvailableBatchForProgram.mockResolvedValue(null);
      await expect(
        service.createEnrollOrder({ programId: PROGRAM_ID }, STUDENT_USER_ID, TENANT_ID, "idem-1"),
      ).rejects.toThrow(ConflictException);
    });

    it("delegates to CommerceService.createOrder (money math not reinvented)", async () => {
      await service.createEnrollOrder({ programId: PROGRAM_ID }, STUDENT_USER_ID, TENANT_ID, "idem-1");
      expect(mocks.commerceService.createOrder).toHaveBeenCalledWith(
        TENANT_ID,
        STUDENT_PROFILE_ID,
        "idem-1",
        expect.objectContaining({ studentId: STUDENT_PROFILE_ID, programId: PROGRAM_ID }),
      );
    });
  });

  // ─── P-8: Checkout initiation ─────────────────────────────────────────────

  describe("initiateCheckout", () => {
    it("returns Razorpay public keyId (never KEY_SECRET)", async () => {
      const result = await service.initiateCheckout(
        { orderId: ORDER_ID },
        STUDENT_USER_ID,
        TENANT_ID,
      );
      expect(result.keyId).toBe("rzp_test_public_key_id");
      expect(result).not.toHaveProperty("keySecret");
      expect(result).not.toHaveProperty("secret");
    });

    it("IDOR: cross-student order → NotFoundException (not 403)", async () => {
      // Other student's profile returned (userId doesn't match ORDER_ID's owner)
      mocks.publicRepository.findStudentProfileByUserId.mockResolvedValue(MOCK_OTHER_PROFILE);
      // findOrderForStudent returns null (the order belongs to student-1, not student-2)
      mocks.publicRepository.findOrderForStudent.mockResolvedValue(null);

      await expect(
        service.initiateCheckout({ orderId: ORDER_ID }, OTHER_STUDENT_USER_ID, TENANT_ID),
      ).rejects.toThrow(NotFoundException); // Not ForbiddenException
    });

    it("IDOR error is 404 (not 403), no existence leak", async () => {
      mocks.publicRepository.findStudentProfileByUserId.mockResolvedValue(MOCK_OTHER_PROFILE);
      mocks.publicRepository.findOrderForStudent.mockResolvedValue(null);

      let error: NotFoundException | undefined;
      try {
        await service.initiateCheckout({ orderId: ORDER_ID }, OTHER_STUDENT_USER_ID, TENANT_ID);
      } catch (e) {
        error = e as NotFoundException;
      }
      expect(error?.getStatus()).toBe(404);
    });

    it("delegates to CommerceService.initiateRazorpayCheckout", async () => {
      await service.initiateCheckout({ orderId: ORDER_ID }, STUDENT_USER_ID, TENANT_ID);
      expect(mocks.commerceService.initiateRazorpayCheckout).toHaveBeenCalledWith(
        TENANT_ID,
        STUDENT_PROFILE_ID,
        ORDER_ID,
      );
    });
  });

  // ─── P-9: Payment verification ───────────────────────────────────────────

  describe("verifyPayment", () => {
    const VALID_VERIFY_DTO = {
      razorpay_order_id: RAZORPAY_ORDER_ID,
      razorpay_payment_id: "rp-pay-1",
      razorpay_signature: "valid-sig",
    };

    it("returns enrollment and LMS redirect URL on success", async () => {
      const result = await service.verifyPayment(VALID_VERIFY_DTO, STUDENT_USER_ID, TENANT_ID);
      expect(result.enrollmentId).toBe("enroll-1");
      // B10b: the LMS student dashboard is the LMS ROOT route (no /dashboard route exists),
      // so the handoff URL is the configured LMS base URL, not a /dashboard path.
      expect(result.lmsRedirectUrl).toBe("https://lms.stimuliiq.com/");
      expect(result.message).toContain("Payment successful");
    });

    it("IDOR: cross-student payment → NotFoundException", async () => {
      mocks.publicRepository.findStudentProfileByUserId.mockResolvedValue(MOCK_OTHER_PROFILE);
      mocks.publicRepository.findOrderForStudent.mockResolvedValue(null); // order not owned by other student

      await expect(
        service.verifyPayment(VALID_VERIFY_DTO, OTHER_STUDENT_USER_ID, TENANT_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it("IDOR: cross-student verify is 404 (not 403)", async () => {
      mocks.publicRepository.findStudentProfileByUserId.mockResolvedValue(MOCK_OTHER_PROFILE);
      mocks.publicRepository.findOrderForStudent.mockResolvedValue(null);

      let error: NotFoundException | undefined;
      try {
        await service.verifyPayment(VALID_VERIFY_DTO, OTHER_STUDENT_USER_ID, TENANT_ID);
      } catch (e) {
        error = e as NotFoundException;
      }
      expect(error?.getStatus()).toBe(404);
    });

    it("response never contains payment signature or provider_secret", async () => {
      const result = await service.verifyPayment(VALID_VERIFY_DTO, STUDENT_USER_ID, TENANT_ID);
      const responseStr = JSON.stringify(result);
      expect(responseStr).not.toContain("signature");
      expect(responseStr).not.toContain("secret");
    });

    it("delegates to CommerceService.verifyPayment (no reinvention of atomic enrollment)", async () => {
      await service.verifyPayment(VALID_VERIFY_DTO, STUDENT_USER_ID, TENANT_ID);
      expect(mocks.commerceService.verifyPayment).toHaveBeenCalledWith(
        TENANT_ID,
        STUDENT_PROFILE_ID,
        expect.objectContaining({ razorpay_order_id: RAZORPAY_ORDER_ID }),
      );
    });

    it("writes audit log for payment verify", async () => {
      await service.verifyPayment(VALID_VERIFY_DTO, STUDENT_USER_ID, TENANT_ID);
      expect(mocks.publicRepository.writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ entity: "payment", action: "update" }),
      );
    });

    it("throws NotFoundException when razorpay_order_id has no matching payment", async () => {
      mocks.publicRepository.findPaymentByProviderOrderId.mockResolvedValue(null);
      await expect(
        service.verifyPayment(VALID_VERIFY_DTO, STUDENT_USER_ID, TENANT_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
