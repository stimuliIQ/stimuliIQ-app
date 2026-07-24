// apps/api/src/modules/referrals/referrals.service.ts
//
// Business logic for the referrals/affiliate program (T11/T14/T25,
// docs/plans/phase-9-completion.md). No Prisma here (CLAUDE.md §3.3) — all persistence
// goes through ReferralsRepository.
//
// STATUS MACHINE (schema `ReferralStatus`: pending|converted|rewarded|expired|rejected —
// "converted" is this schema's name for the plan brief's "qualified" step):
//   pending   -> converted | rejected | expired
//   converted -> rewarded  | rejected | expired
//   rewarded, rejected, expired: terminal (no further transitions).
//   Setting the SAME status again is a no-op (replay-safe), any other transition not
//   listed above is a 422 REFERRAL_INVALID_STATUS_TRANSITION.
//
// ANTI-SELF-REFERRAL (redeem is UNAUTHENTICATED — called right after public lead
// capture, before the referred person has any account): the check compares the
// newly-captured Lead's contact details against the REFERRER's own User contact
// details (case-insensitive email match, or exact phone match) — a user cannot use
// their own referral code to "refer" a lead that is themselves.
//
// ATTRIBUTION SCOPE (documented, not a silent gap): "attribution on lead ... creation"
// is fully implemented (redeem() below, called by the FE right after POST
// /public/leads). "attribution on enrollment creation" (auto pending->converted) is
// NOT wired automatically in this pass — the shipped schema has no `leads.id` FK on
// `orders`/`enrollments` to trace a paid enrollment back to its originating lead, and
// adding one is a schema change out of this task's scope (apps/api-only). Staff
// transition a referral pending->converted manually via `updateStatus()` once
// conversion is confirmed (e.g. from the CRM lead/enrollment view) — tracked as a
// follow-up for a future wave (needs `orders.lead_id` or an event-bus hook).

import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Referral as ReferralRow, ReferralStatus } from "@prisma/client";
import type {
  Referral,
  CreateReferralRequest,
  ListReferralsQuery,
  RedeemReferralRequest,
  RedeemReferralResponse,
  UpdateReferralStatusRequest,
} from "@repo/types";
import { ReferralsRepository } from "./referrals.repository";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext } from "../auth/lib/scope-context";
import { CAPTCHA_PROVIDER, type CaptchaProvider } from "../captcha/providers/captcha/captcha-provider.interface";
import { PublicReferralRateLimiter } from "./lib/public-referral-rate-limiter";

const TENANT_SLUG = "stimuliiq"; // Phase 0: single tenant (matches auth.service.ts / content.util.ts precedent).

/** Legal forward transitions. Same-status is always allowed (idempotent no-op, checked separately). */
const ALLOWED_TRANSITIONS: Record<ReferralStatus, ReferralStatus[]> = {
  pending: ["converted", "rejected", "expired"],
  converted: ["rewarded", "rejected", "expired"],
  rewarded: [],
  rejected: [],
  expired: [],
};

function toDto(row: ReferralRow & { referrer: { name: string } }): Referral {
  return {
    id: row.id,
    referrerUserId: row.referrerUserId,
    referrerName: row.referrer.name,
    referredLeadId: row.referredLeadId,
    code: row.code,
    reward: (row.reward as Referral["reward"]) ?? null,
    status: row.status,
    rewardedAt: row.rewardedAt ? row.rewardedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class ReferralsService {
  constructor(
    private readonly repository: ReferralsRepository,
    @Inject(CAPTCHA_PROVIDER) private readonly captcha: CaptchaProvider,
    private readonly rateLimiter: PublicReferralRateLimiter,
  ) {}

  /**
   * CRM staff oversight (listAll / updateStatus) is all-scope ONLY.
   *
   * SECURITY (H1): students & counsellors hold `referrals.view` at scope="own" for
   * GET /me/referrals. Because @RequirePermission only checks the permission KEY, an
   * own-scope holder also satisfies the guard on GET /crm/referrals. The previous
   * assertOwnOrAllScope() then let "own" through and passed query.referrerUserId
   * straight to the repository unfiltered — leaking EVERY user's referral rows. CRM
   * oversight is a staff (scope="all") capability; own-scope callers must use
   * /me/referrals. Fail closed on anything that isn't "all".
   */
  private assertAllScope(): void {
    const scope = requireScopeContext();
    if (scope.scope !== "all") {
      throw new ForbiddenException({
        code: "referrals.scope_forbidden",
        title: "Insufficient scope",
        detail: `CRM referral oversight requires the "all" data-scope; "${scope.scope}" is not permitted.`,
      });
    }
  }

  // ── Own (authenticated) ──────────────────────────────────────────────────

  async createOwn(tenantId: string, actorId: string, _body: CreateReferralRequest): Promise<Referral> {
    const scope = requireScopeContext();
    if (scope.scope !== "own") {
      throw new ForbiddenException({ code: "referrals.scope_unresolvable", title: "Scope not supported" });
    }
    const row = await this.repository.createForUser(tenantId, actorId);
    const withReferrer = await this.repository.findById(tenantId, row.id);
    return toDto(withReferrer!);
  }

  async listOwn(tenantId: string, actorId: string, query: ListReferralsQuery): Promise<PaginatedResult<Referral>> {
    const scope = requireScopeContext();
    if (scope.scope !== "own") {
      throw new ForbiddenException({ code: "referrals.scope_unresolvable", title: "Scope not supported" });
    }
    const { rows, total } = await this.repository.list({
      tenantId,
      referrerUserId: actorId, // forced to caller — query.referrerUserId is CRM-only and ignored here (DTO doc).
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
    });
    return new PaginatedResult(rows.map(toDto), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  // ── CRM (staff oversight) ────────────────────────────────────────────────

  async listAll(tenantId: string, query: ListReferralsQuery): Promise<PaginatedResult<Referral>> {
    this.assertAllScope();
    const { rows, total } = await this.repository.list({
      tenantId,
      referrerUserId: query.referrerUserId,
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
    });
    return new PaginatedResult(rows.map(toDto), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  async updateStatus(tenantId: string, id: string, body: UpdateReferralStatusRequest): Promise<Referral> {
    this.assertAllScope();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "referrals.not_found", title: "Referral not found" });

    if (existing.status === body.status) {
      return toDto(existing); // idempotent no-op replay.
    }
    if (!ALLOWED_TRANSITIONS[existing.status].includes(body.status)) {
      throw new UnprocessableEntityException({
        code: "REFERRAL_INVALID_STATUS_TRANSITION",
        title: "Invalid referral status transition",
        detail: `Cannot transition a referral from "${existing.status}" to "${body.status}".`,
      });
    }

    const rewardedAt = body.status === "rewarded" ? new Date() : existing.rewardedAt;
    const updated = await this.repository.updateStatus(id, body.status, rewardedAt);
    const withReferrer = await this.repository.findById(tenantId, updated.id);
    return toDto(withReferrer!);
  }

  // ── Public (unauthenticated) ─────────────────────────────────────────────

  /**
   * POST /api/v1/public/referrals/redeem — attaches a referral code to a freshly
   * captured lead. UNAUTHENTICATED (no scope context available — this method never
   * calls requireScopeContext()).
   *
   * SECURITY (Wave 6 M2): per-IP rate limit (anti-enumeration, primary control) THEN
   * captcha verification (defence-in-depth, fail-closed in prod) BEFORE any DB read of
   * the referral code — an attacker must clear both before we confirm a code exists.
   */
  async redeem(body: RedeemReferralRequest, ip: string): Promise<RedeemReferralResponse> {
    const limited = await this.rateLimiter.hit(ip);
    if (limited) {
      throw new HttpException(
        {
          code: "referrals.rate_limited",
          title: "Too many requests",
          detail: "Please try again in a minute.",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const captchaResult = await this.captcha.verify(body.captchaToken, ip);
    if (!captchaResult.success) {
      throw new UnprocessableEntityException({
        code: "referrals.captcha_failed",
        title: "Captcha verification failed",
        detail: "Please complete the captcha challenge and try again.",
      });
    }

    const tenantId = await this.repository.getTenantIdBySlug(TENANT_SLUG);
    if (!tenantId) {
      throw new NotFoundException({ code: "referrals.tenant_not_found", title: "Tenant not found" });
    }

    const referral = await this.repository.findByCode(tenantId, body.code);
    if (!referral) {
      throw new UnprocessableEntityException({
        code: "REFERRAL_CODE_INVALID",
        title: "Invalid referral code",
        detail: "This referral code does not exist or is no longer active.",
      });
    }

    const lead = await this.repository.findLeadContact(tenantId, body.leadId);
    if (!lead) {
      throw new NotFoundException({ code: "referrals.lead_not_found", title: "Lead not found" });
    }

    // Idempotent replay: already attached to THIS lead -> return current state.
    if (referral.referredLeadId === lead.id) {
      return { referralId: referral.id, status: referral.status };
    }
    if (referral.referredLeadId && referral.referredLeadId !== lead.id) {
      throw new UnprocessableEntityException({
        code: "REFERRAL_ALREADY_REDEEMED",
        title: "Referral code already redeemed",
        detail: "This referral code has already been attributed to a different lead.",
      });
    }

    const referrer = await this.repository.findReferrerContact(referral.referrerUserId);
    if (referrer) {
      const emailMatches = !!lead.email && lead.email.trim().toLowerCase() === referrer.email.trim().toLowerCase();
      const phoneMatches = !!referrer.phone && lead.phone === referrer.phone;
      if (emailMatches || phoneMatches) {
        throw new UnprocessableEntityException({
          code: "SELF_REFERRAL_NOT_ALLOWED",
          title: "Self-referral not allowed",
          detail: "You cannot redeem your own referral code.",
        });
      }
    }

    const updated = await this.repository.attachLead(referral.id, lead.id);
    return { referralId: updated.id, status: updated.status };
  }
}
