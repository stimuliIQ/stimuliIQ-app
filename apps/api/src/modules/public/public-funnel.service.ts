// apps/api/src/modules/public/public-funnel.service.ts
//
// Business logic for the PUBLIC write funnel endpoints (P-3, P-5, P-6, P-7, P-8, P-9).
//   P-3: POST /public/leads         — lead capture with UTM + consent (AC-1..AC-5)
//   P-5: POST /public/coupons/validate — public coupon preview (AC-9..AC-11)
//   P-6: POST /public/register      — self-service account creation (AC-12..AC-15)
//   P-7: POST /public/enroll/orders — self-service order creation (AC-16..AC-23)
//   P-8: POST /public/enroll/checkout — Razorpay checkout initiation (AC-16..AC-23)
//   P-9: POST /public/enroll/verify — payment verification + enrollment (AC-16..AC-23)
//
// SECURITY CONTRACT:
//   - Every public write is captcha-gated (CaptchaProvider).
//   - Consent is SERVER-COMPUTED (timestamp + ip_hash); never trusted from client.
//   - Raw IP is NEVER stored — only SHA-256(ip) (ip_hash) per DPDP spec (AC-37).
//   - Honeypot: controller checks _hp_email before calling service.
//   - Enumeration-resistant registration (AC-13): existing email → same generic response.
//   - IDOR→404 on enroll funnel: student can only access THEIR OWN order (AC-22).
//   - Coupon validate: read-only, never increments `used` counter; no internals leaked.
//   - All mutations write audit_logs entries.
//   - No money math reinvented: CommerceService.createOrder / initiateRazorpayCheckout
//     / verifyPayment are REUSED as-is (ADR-0014 — idempotency, signature-verify,
//     atomic order→enrollment, ledger). This service is a thin orchestration layer.
//   - Amount is always server-derived; client-supplied amounts are rejected by .strict().
//   - Funnel IDOR: every P-7/P-8/P-9 call checks `order.studentId === req.user.id`.
//
// TENANT: resolved server-side via TENANT_SLUG constant.

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import * as argon2 from "argon2";
import { createHash } from "node:crypto";
import type {
  PublicLeadCaptureDto,
  PublicLeadCaptureResponse,
  PublicValidateCouponDto,
  PublicCouponDiscountResponse,
  PublicRegisterDto,
  PublicCreateOrderDto,
  PublicOrderResponse,
  PublicCheckoutDto,
  PublicCheckoutResponse,
  PublicVerifyPaymentDto,
  PublicVerifyPaymentResponse,
  PublicPayLinkOrder,
  AuthSessionData,
} from "@repo/types";
import { verifyPayLinkToken } from "../commerce/pay-link.util";
import { PublicRepository } from "./public.repository";
import { LeadsRepository } from "../leads/leads.repository";
import { AuthRepository } from "../auth/auth.repository";
import { TokenService } from "../auth/lib/token.service";
import { OtpStore } from "../auth/lib/otp-store";
import { generateCsrfToken } from "../auth/lib/cookies";
import { CommerceService } from "../commerce/commerce.service";
import { CAPTCHA_PROVIDER, type CaptchaProvider } from "../captcha/providers/captcha/captcha-provider.interface";
import { PublicBookingRateLimiter } from "../leads/lib/public-booking-rate-limiter";
import { ARGON2_HASH_OPTIONS } from "../auth/lib/argon2-params";
import { validateEnv } from "../../config/env";
import type { CreateOrderRequest, VerifyPaymentRequest } from "../commerce/dto";
import { scopeContextStorage } from "../auth/lib/scope-context";

const TENANT_SLUG = "stimuliiq"; // Single-tenant P5

/** SHA-256 hash of a client IP — NEVER store the raw IP (DPDP compliance, AC-37). */
function hashIp(ip: string | null | undefined): string {
  if (!ip) return createHash("sha256").update("unknown").digest("hex");
  return createHash("sha256").update(ip).digest("hex");
}

/** Sanitize a user-supplied string: strip HTML tags, trim, truncate. */
function sanitize(s: string | undefined, maxLen = 500): string | undefined {
  if (!s) return undefined;
  // Strip HTML tags (resolves P2 M-4 — no raw HTML in stored strings)
  return s.replace(/<[^>]*>/g, "").trim().slice(0, maxLen);
}

/** Build a DPDP consent object — timestamp + ip_hash always SERVER-derived (AC-37). */
function buildConsent(
  marketingOptIn: boolean,
  tosVersion: string,
  ip: string | null | undefined,
): Record<string, unknown> {
  return {
    marketing_opt_in: marketingOptIn,
    tos_version: tosVersion,
    timestamp: new Date().toISOString(), // SERVER-recorded, never client-supplied
    ip_hash: hashIp(ip), // SHA-256 of client IP, NEVER the raw IP
  };
}

/** Compute coupon discount in INTEGER PAISE — mirrors CommerceService's logic (no reinvention). */
function computeDiscountPaise(type: string, value: number, pricePaise: number): number {
  if (type === "pct") return Math.floor((pricePaise * value) / 100);
  if (type === "flat") return Math.min(value, pricePaise);
  return 0;
}

/**
 * Validate a coupon for public display (read-only, never increments used counter).
 * Returns null if the coupon is invalid (caller maps to 422).
 */
function validatePublicCoupon(
  coupon: {
    status: string;
    maxUses: number | null;
    used: number;
    validFrom: Date | null;
    validTo: Date | null;
    // `programScope` is a JSON ARRAY of program uuids (Prisma Json column), or null =
    // tenant-wide. Typed `unknown` here and narrowed below — comparing it as a scalar
    // (the previous `!== programId`) was H-1: it silently rejected EVERY program-scoped
    // coupon because `["<uuid>"] !== "<uuid>"` is always true.
    programScope: unknown;
  },
  programId: string,
): { valid: boolean } {
  if (coupon.status !== "active") return { valid: false };
  const now = new Date();
  if (coupon.validFrom && coupon.validFrom > now) return { valid: false };
  if (coupon.validTo && coupon.validTo < now) return { valid: false };
  if (coupon.maxUses !== null && coupon.used >= coupon.maxUses) return { valid: false };
  // Program scope — a non-empty array must INCLUDE the program; null/empty = tenant-wide.
  // Mirrors CommerceService.validateCoupon's `scope.includes(programId)` semantics (H-1).
  const scope = coupon.programScope;
  if (Array.isArray(scope) && scope.length > 0 && !scope.includes(programId)) {
    return { valid: false };
  }
  return { valid: true };
}

@Injectable()
export class PublicFunnelService {
  private readonly logger = new Logger(PublicFunnelService.name);

  constructor(
    private readonly publicRepository: PublicRepository,
    private readonly leadsRepository: LeadsRepository,
    private readonly authRepository: AuthRepository,
    private readonly tokenService: TokenService,
    private readonly otpStore: OtpStore,
    private readonly commerceService: CommerceService,
    @Inject(CAPTCHA_PROVIDER) private readonly captchaProvider: CaptchaProvider,
    private readonly rateLimiter: PublicBookingRateLimiter,
  ) {}

  private async resolveTenantId(): Promise<string> {
    const tenantId = await this.publicRepository.getTenantIdBySlug(TENANT_SLUG);
    if (!tenantId) {
      throw new NotFoundException({ code: "public.tenant_not_found", title: "Service unavailable" });
    }
    return tenantId;
  }

  // ─── Rate limiting (shared per IP) ──────────────────────────────────────────

  async checkRateLimit(ip: string, errorCode: string): Promise<void> {
    const limited = await this.rateLimiter.hit(ip);
    if (limited) {
      throw new UnprocessableEntityException({
        code: errorCode,
        title: "Too many requests",
        detail: "Please try again in a minute.",
      });
    }
  }

  // ─── Captcha verification ────────────────────────────────────────────────────

  async verifyCaptcha(token: string, ip: string | undefined): Promise<void> {
    const result = await this.captchaProvider.verify(token, ip);
    if (!result.success) {
      this.logger.warn(`[PublicFunnel] Captcha verification failed — codes: ${result.errorCodes?.join(",")}`, {
        // Never log the captcha secret or the token itself
      });
      throw new UnprocessableEntityException({
        code: "public.captcha_invalid",
        title: "Captcha verification failed",
        detail: "Please complete the captcha challenge and try again.",
      });
    }
  }

  // ─── P-3: Lead capture ───────────────────────────────────────────────────────

  async createLead(
    dto: PublicLeadCaptureDto,
    ip: string | undefined,
  ): Promise<PublicLeadCaptureResponse> {
    const tenantId = await this.resolveTenantId();

    // Validate TOS version
    const env = validateEnv();
    const tosVersion = env.TOS_VERSION ?? "v1.0";
    if (dto.consent.tosVersion !== tosVersion) {
      throw new UnprocessableEntityException({
        code: "public.tos_version_mismatch",
        title: "Invalid TOS version",
        detail: `Expected TOS version '${tosVersion}'.`,
      });
    }

    // Build consent object SERVER-SIDE (timestamp + ip_hash server-computed, AC-37)
    const consentRecord = buildConsent(dto.consent.marketingOptIn, tosVersion, ip);

    // Round-robin owner assignment (same as CRM leads)
    const ownerId = await this.leadsRepository.pickRoundRobinOwner(tenantId);

    // Create the lead row with P5 attribution fields
    // We call Prisma directly via the public repository for the P5-specific fields
    // since the existing LeadsRepository.create signature does not have them yet
    const leadId = await this.publicRepository.createLead({
      tenantId,
      name: sanitize(dto.name, 200) ?? dto.name,
      phone: dto.phone,
      email: dto.email,
      programInterestId: dto.programInterestId,
      courseInterest: dto.courseInterest ? sanitize(dto.courseInterest, 200) : undefined,
      college: dto.college ? sanitize(dto.college, 200) : undefined,
      language: dto.language ? sanitize(dto.language, 100) : undefined,
      message: dto.message ? sanitize(dto.message, 1000) : undefined,
      source: sanitize(dto.source, 120) ?? dto.source,
      utm: dto.utm ?? {},
      landingUrl: dto.landingUrl ? sanitize(dto.landingUrl, 2048) : undefined,
      referrer: dto.referrer ? sanitize(dto.referrer, 2048) : undefined,
      gclid: dto.gclid ? sanitize(dto.gclid, 200) : undefined,
      fbclid: dto.fbclid ? sanitize(dto.fbclid, 200) : undefined,
      consent: consentRecord,
      ownerId: ownerId ?? null,
    });

    // Audit the creation (actorId=null for anonymous public)
    await this.publicRepository.writeAuditLog({
      tenantId,
      actorId: null,
      entity: "lead",
      entityId: leadId,
      action: "create",
      after: { source: dto.source, phone: dto.phone },
      ip: null, // raw IP never in audit (ip_hash is in consent)
    });

    // Enqueue confirmation event (P6 owns the actual sending)
    // For P5: this is a stub — BullMQ integration lands in P6
    this.logger.log(`[PublicFunnel] Lead ${leadId} created — confirmation event enqueued (stub, P6)`);

    return {
      leadId,
      message: "Thanks! A counsellor will reach out soon.",
    };
  }

  // ─── P-5: Public coupon validate ─────────────────────────────────────────────

  async validateCoupon(
    dto: PublicValidateCouponDto,
    ip: string | undefined,
  ): Promise<PublicCouponDiscountResponse> {
    const tenantId = await this.resolveTenantId();

    // Fetch the coupon (read-only — never increments used counter)
    const coupon = await this.publicRepository.findCouponByCode(tenantId, dto.code);
    if (!coupon) {
      // Generic error — never reveal whether the code exists but is inactive vs never existed (AC-10)
      throw new UnprocessableEntityException({
        code: "public.coupon_invalid",
        title: "Invalid or expired coupon",
        detail: "The coupon code is not valid for this program.",
      });
    }

    // Validate applicability (read-only path — no used counter change)
    const validation = validatePublicCoupon(coupon, dto.programId);
    if (!validation.valid) {
      throw new UnprocessableEntityException({
        code: "public.coupon_invalid",
        title: "Invalid or expired coupon",
        detail: "The coupon code is not valid for this program.",
      });
    }

    // Fetch the program price
    const program = await this.publicRepository.findPublicProgramById(tenantId, dto.programId);
    if (!program) {
      throw new UnprocessableEntityException({
        code: "public.coupon_invalid",
        title: "Invalid or expired coupon",
        detail: "The coupon code is not valid for this program.",
      });
    }

    const originalPaise = program.pricePaise;
    const discountPaise = computeDiscountPaise(coupon.type, coupon.value, originalPaise);
    const finalPaise = Math.max(0, originalPaise - discountPaise);

    // ALLOWED response fields only — no id, maxUses, used, validFrom/To, programScope, status, tenantId (AC-9)
    return {
      originalPaise,
      discountPaise,
      finalPaise,
      type: coupon.type as "pct" | "flat",
      displayCode: coupon.code.toUpperCase(),
    };
  }

  // ─── P-6: Public self-service registration ────────────────────────────────────

  async register(
    dto: PublicRegisterDto,
    ip: string | undefined,
  ): Promise<{ session: AuthSessionData; tokens?: { accessToken: string; refreshToken: string; csrfToken: string } }> {
    const tenantId = await this.resolveTenantId();

    // Validate TOS version
    const env = validateEnv();
    const tosVersion = env.TOS_VERSION ?? "v1.0";
    if (dto.consent.tosVersion !== tosVersion) {
      throw new UnprocessableEntityException({
        code: "public.tos_version_mismatch",
        title: "Invalid TOS version",
        detail: `Expected TOS version '${tosVersion}'.`,
      });
    }

    // Verify OTP (proves phone ownership — reuses OtpStore, same as /auth/otp/verify)
    const otpValid = await this.otpStore.verify(dto.phone, dto.otpCode);
    if (!otpValid) {
      throw new UnprocessableEntityException({
        code: "public.otp_invalid",
        title: "Invalid or expired OTP",
        detail: "The OTP you entered is invalid or has expired. Please request a new one.",
      });
    }

    // Enumeration-resistant (AC-13): check if email exists but DO NOT reveal it
    const existingUser = await this.authRepository.findUserByEmail(TENANT_SLUG, dto.email);

    if (existingUser) {
      // SECURITY (C-1, account-takeover fix): NEVER mint a session for a pre-existing
      // account here. The verified OTP only proves ownership of `dto.phone` (which is
      // attacker-controlled), NOT ownership of the existing account (keyed by `dto.email`).
      // Issuing a session for `existingUser.id` would log an attacker in as the victim.
      // Instead return an enumeration-resistant 201-shaped body built ONLY from the
      // caller-supplied input (no victim DB data, no real id) and NO tokens — the
      // controller therefore sets NO auth cookies, so no session is granted. A legitimate
      // returning user is routed to log in by the client (tracked as a UX follow-up).
      this.logger.warn(
        `[PublicFunnel] Registration attempt for an existing email — no session issued (C-1 guard).`,
      );
      return {
        session: {
          user: {
            id: "",
            name: sanitize(dto.name, 200) ?? dto.name,
            email: dto.email,
            phone: dto.phone ?? null,
            avatar: null,
            status: "active",
            // Public self-registration sets a real password inline — no forced change.
            mustChangePassword: false,
          },
          csrfToken: "",
        },
        // tokens intentionally omitted → controller sets no cookies → no session granted.
      };
    }

    // Hash password with argon2id, PINNED cost params (CLAUDE.md §3, ADR-0002; Phase-7
    // Wave 2 security hardening batch A, item 5 — see argon2-params.ts for rationale).
    const passwordHash = await argon2.hash(dto.password, ARGON2_HASH_OPTIONS);

    // Build consent record server-side
    const consentRecord = buildConsent(dto.consent.marketingOptIn, tosVersion, ip);

    // Create user + student_profile atomically
    const { userId, profileId } = await this.publicRepository.createUserWithStudentProfile({
      tenantId,
      name: sanitize(dto.name, 200) ?? dto.name,
      email: dto.email,
      phone: dto.phone,
      passwordHash,
      consent: consentRecord,
    });

    // Audit the registration (actorId=null for anonymous public)
    await this.publicRepository.writeAuditLog({
      tenantId,
      actorId: null,
      entity: "user",
      entityId: userId,
      action: "create",
      after: { source: "public-register" },
      ip: null,
    });

    this.logger.log(`[PublicFunnel] New student registered — profileId=${profileId}`);

    // Issue session (cookie/CSRF/refresh machinery — reuses auth infrastructure)
    const tokens = await this.issueSession(userId, tenantId, ip);

    return {
      session: {
        user: {
          id: userId,
          name: dto.name,
          email: dto.email,
          phone: dto.phone,
          avatar: null,
          status: "active" as const,
          // Public self-registration sets a real password inline — no forced change.
          mustChangePassword: false,
        },
        csrfToken: tokens.csrfToken,
      },
      tokens,
    };
  }

  // ─── P-7: Self-service order create ──────────────────────────────────────────

  async createEnrollOrder(
    dto: PublicCreateOrderDto,
    studentUserId: string,
    tenantId: string,
    idempotencyKey: string,
  ): Promise<PublicOrderResponse> {
    // Find student profile by user id (needed for studentId in CommerceService)
    const profile = await this.publicRepository.findStudentProfileByUserId(tenantId, studentUserId);
    if (!profile) {
      throw new NotFoundException({
        code: "public.student_not_found",
        title: "Student profile not found",
        detail: "Please complete your registration before enrolling.",
      });
    }

    // Auto-select an available batch for this program (no batchId in public funnel)
    const batch = await this.publicRepository.findAvailableBatchForProgram(tenantId, dto.programId);
    if (!batch) {
      throw new ConflictException({
        code: "public.no_batch_available",
        title: "No available batches",
        detail: "No open batches are currently available for this program. Please try again soon.",
      });
    }

    // Build the CreateOrderRequest — studentId and amount are SERVER-DERIVED
    // No client-supplied amount, no notes (staff annotation stripped per spec)
    const createOrderBody: CreateOrderRequest = {
      studentId: profile.id,
      programId: dto.programId,
      batchId: batch.id,
      couponCode: dto.couponCode,
      emiPlan: dto.emiPlan,
    };

    // Run CommerceService within a scope context ('own' — student acts on their own order).
    // scopeContextStorage.run() sets up the ALS that CommerceService.createOrder requires.
    const order = await scopeContextStorage.run(
      { scope: "own", actorId: profile.id, permissionKey: "orders.create", tenantId },
      () => this.commerceService.createOrder(tenantId, profile.id, idempotencyKey, createOrderBody),
    );

    // Audit the order creation for the public funnel
    await this.publicRepository.writeAuditLog({
      tenantId,
      actorId: studentUserId,
      entity: "order",
      entityId: order.id,
      action: "create",
      after: { source: "public-enroll-funnel", programId: dto.programId },
      ip: null,
    });

    return {
      orderId: order.id,
      amountPaise: order.amountPaise,
      currency: order.currency,
      discountPaise: order.discountPaise,
      status: order.status as PublicOrderResponse["status"],
    };
  }

  // ─── P-8: Self-service checkout initiation ────────────────────────────────────

  async initiateCheckout(
    dto: PublicCheckoutDto,
    studentUserId: string,
    tenantId: string,
  ): Promise<PublicCheckoutResponse> {
    // IDOR check: verify the order belongs to the authenticated student (AC-22)
    const profile = await this.publicRepository.findStudentProfileByUserId(tenantId, studentUserId);
    if (!profile) {
      throw new NotFoundException({ code: "public.order_not_found", title: "Order not found" });
    }

    const order = await this.publicRepository.findOrderForStudent(tenantId, dto.orderId, profile.id);
    if (!order) {
      // IDOR → 404 (no 403, no existence leak, AC-22)
      throw new NotFoundException({ code: "public.order_not_found", title: "Order not found" });
    }

    // REUSE CommerceService.initiateRazorpayCheckout (same PaymentProvider + idempotency)
    // Run within own-scope ALS context (student can only checkout their own order)
    const result = await scopeContextStorage.run(
      { scope: "own", actorId: profile.id, permissionKey: "payments.create", tenantId },
      () => this.commerceService.initiateRazorpayCheckout(tenantId, profile.id, dto.orderId),
    );

    // Return only PUBLIC keyId — NEVER the KEY_SECRET (AC-41, type-assertion in enroll.schemas.ts)
    return {
      razorpayOrderId: result.razorpayOrderId,
      keyId: result.keyId, // PUBLIC key only (RAZORPAY_KEY_ID, not KEY_SECRET)
      amountPaise: result.amountPaise,
      currency: result.currency,
      orderId: result.orderId,
    };
  }

  // ─── P-9: Self-service payment verify ─────────────────────────────────────────

  async verifyPayment(
    dto: PublicVerifyPaymentDto,
    studentUserId: string,
    tenantId: string,
  ): Promise<PublicVerifyPaymentResponse> {
    // IDOR check: verify the Razorpay order_id resolves to an order owned by this student
    const profile = await this.publicRepository.findStudentProfileByUserId(tenantId, studentUserId);
    if (!profile) {
      throw new NotFoundException({ code: "public.order_not_found", title: "Order not found" });
    }

    // Look up payment by providerOrderId to get internal orderId
    const payment = await this.publicRepository.findPaymentByProviderOrderId(dto.razorpay_order_id);
    if (!payment) {
      throw new NotFoundException({ code: "public.order_not_found", title: "Order not found" });
    }

    // Confirm the order belongs to this student (IDOR → 404, AC-22)
    const order = await this.publicRepository.findOrderForStudent(tenantId, payment.orderId, profile.id);
    if (!order) {
      throw new NotFoundException({ code: "public.order_not_found", title: "Order not found" });
    }

    const verifyBody: VerifyPaymentRequest = {
      razorpay_order_id: dto.razorpay_order_id,
      razorpay_payment_id: dto.razorpay_payment_id,
      razorpay_signature: dto.razorpay_signature,
    };

    // REUSE CommerceService.verifyPayment (signature verify + atomic order→enrollment)
    // Run within own-scope ALS context
    const paymentDetail = await scopeContextStorage.run(
      { scope: "own", actorId: profile.id, permissionKey: "payments.create", tenantId },
      () => this.commerceService.verifyPayment(tenantId, profile.id, verifyBody),
    );

    // Audit the enrollment
    await this.publicRepository.writeAuditLog({
      tenantId,
      actorId: studentUserId,
      entity: "payment",
      entityId: paymentDetail.id,
      action: "update",
      after: { source: "public-enroll-verify", status: paymentDetail.status },
      ip: null,
    });

    // Find the enrollment that was created by verifyPayment
    const enrollment = await this.publicRepository.findEnrollmentByOrderId(tenantId, payment.orderId);
    if (!enrollment) {
      throw new NotFoundException({ code: "public.enrollment_not_found", title: "Enrollment not found after payment" });
    }

    const env = validateEnv();
    const lmsBaseUrl = env.LMS_APP_URL;

    return {
      enrollmentId: enrollment.id,
      orderId: payment.orderId,
      lmsRedirectUrl: `${lmsBaseUrl}/`, // AC-23: LMS handoff URL — the student dashboard IS the LMS root route (there is no /dashboard route; B10b fix)
      message: "Payment successful! Welcome to the program.",
    };
  }

  // ─── Pay-link flow (lifecycle-redesign): token-authorized checkout ──────────
  //
  // The three methods below mirror initiateCheckout/verifyPayment above, with ONE
  // substitution: the signed pay-link token (see ../commerce/pay-link.util.ts)
  // replaces the authenticated session as the own-scope proof. The token embeds
  // (tenantId, orderId, expiry) under HMAC; the order's OWN studentId is then used
  // as the acting profile for the commerce engine — the recipient can only ever
  // pay the exact order the staff minted the link for.

  /** Resolve + validate a pay-link token → the order it authorizes. Throws mapped 404/410-style errors. */
  private async resolvePayLinkOrder(token: string) {
    const result = verifyPayLinkToken(token);
    if (!result.valid) {
      throw new NotFoundException({
        code: result.expired ? "public.pay_link_expired" : "public.pay_link_invalid",
        title: result.expired ? "This payment link has expired" : "Invalid payment link",
        detail: result.expired
          ? "Ask your counsellor to send a fresh payment link."
          : "This link is malformed or was not issued by us.",
      });
    }
    const { tenantId, orderId, expiresAt } = result.payload!;
    const order = await this.publicRepository.findOrderForPayLink(tenantId, orderId);
    if (!order) {
      throw new NotFoundException({ code: "public.order_not_found", title: "Order not found" });
    }
    return { tenantId, order, expiresAt };
  }

  /** GET /public/pay/:token — the order summary the pay page renders. */
  async getPayLinkOrder(token: string): Promise<PublicPayLinkOrder> {
    const { order, expiresAt } = await this.resolvePayLinkOrder(token);
    return {
      orderId: order.id,
      studentName: order.studentName,
      programTitle: order.programTitle,
      batchName: order.batchName ?? "",
      amountPaise: order.amountPaise,
      currency: order.currency,
      status: order.status as PublicPayLinkOrder["status"],
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    };
  }

  /** POST /public/pay/:token/checkout — Razorpay checkout bootstrap for the token's order. */
  async initiateCheckoutByPayLink(token: string): Promise<PublicCheckoutResponse> {
    const { tenantId, order } = await this.resolvePayLinkOrder(token);
    if (order.status !== "created") {
      throw new UnprocessableEntityException({
        code: "public.order_not_payable",
        title: "This order can no longer be paid",
        detail: `The order is already "${order.status}".`,
      });
    }
    const result = await scopeContextStorage.run(
      { scope: "own", actorId: order.studentId, permissionKey: "payments.create", tenantId },
      () => this.commerceService.initiateRazorpayCheckout(tenantId, order.studentId, order.id),
    );
    return {
      razorpayOrderId: result.razorpayOrderId,
      keyId: result.keyId, // PUBLIC key only — NEVER the secret (same assertion as initiateCheckout)
      amountPaise: result.amountPaise,
      currency: result.currency,
      orderId: result.orderId,
    };
  }

  /** POST /public/pay/:token/verify — signature verify + atomic enrollment for the token's order. */
  async verifyPaymentByPayLink(token: string, dto: PublicVerifyPaymentDto): Promise<PublicVerifyPaymentResponse> {
    const { tenantId, order } = await this.resolvePayLinkOrder(token);

    // The Razorpay order in the callback must resolve to THIS token's order —
    // a valid token for order A must not verify a payment against order B.
    const payment = await this.publicRepository.findPaymentByProviderOrderId(dto.razorpay_order_id);
    if (!payment || payment.orderId !== order.id) {
      throw new NotFoundException({ code: "public.order_not_found", title: "Order not found" });
    }

    const verifyBody: VerifyPaymentRequest = {
      razorpay_order_id: dto.razorpay_order_id,
      razorpay_payment_id: dto.razorpay_payment_id,
      razorpay_signature: dto.razorpay_signature,
    };
    // Same engine as the funnel verify: capture + order paid + enrollment + invoice
    // (+ LMS account provisioning + receipt email) — all downstream of this call.
    await scopeContextStorage.run(
      { scope: "own", actorId: order.studentId, permissionKey: "payments.create", tenantId },
      () => this.commerceService.verifyPayment(tenantId, order.studentId, verifyBody),
    );

    // Best-effort bookkeeping — the payment/order/enrollment writes above are already
    // audited by the Prisma audit extension; this explicit row only adds the
    // "came via pay link" source marker. It must NEVER fail the response: the money
    // has moved, and a post-payment 500 shows the payer a false "verification failed".
    // (2026-07-26 incident: this write used order.studentId — a student PROFILE id —
    // as actor_id, violating the audit_logs→users FK and 500ing every pay-link verify
    // AFTER a fully successful capture+enrollment.)
    try {
      const actorUserId = await this.publicRepository.findStudentUserIdByProfileId(tenantId, order.studentId);
      await this.publicRepository.writeAuditLog({
        tenantId,
        actorId: actorUserId,
        entity: "payment",
        entityId: payment.id,
        action: "update",
        after: { source: "public-pay-link-verify" },
        ip: null,
      });
    } catch (err) {
      this.logger.warn(`[PayLink] post-verify audit write failed (non-fatal): ${String(err)}`);
    }

    const enrollment = await this.publicRepository.findEnrollmentByOrderId(tenantId, order.id);
    if (!enrollment) {
      throw new NotFoundException({ code: "public.enrollment_not_found", title: "Enrollment not found after payment" });
    }

    const env = validateEnv();
    return {
      enrollmentId: enrollment.id,
      orderId: order.id,
      lmsRedirectUrl: `${env.LMS_APP_URL}/`,
      message: "Payment successful! Check your email for the invoice and your LMS login details.",
    };
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private async issueSession(
    userId: string,
    tenantId: string,
    ip: string | undefined,
  ): Promise<{ accessToken: string; refreshToken: string; csrfToken: string }> {
    const { roleKeys } = await this.authRepository.getRbacProfile(userId);

    const session = await this.authRepository.createSession({
      tenantId,
      userId,
      refreshHash: "unset",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      ip,
    });

    const accessToken = await this.tokenService.signAccessToken({ userId, tenantId, roles: roleKeys });
    const refreshToken = await this.tokenService.signRefreshToken({ userId, sessionId: session.id });
    const refreshHash = this.tokenService.hashRefreshToken(refreshToken);
    const csrfToken = generateCsrfToken();

    await this.authRepository.rotateSessionRefreshHash(session.id, refreshHash, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

    return { accessToken, refreshToken, csrfToken };
  }
}
