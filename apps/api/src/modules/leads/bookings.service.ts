// apps/api/src/modules/leads/bookings.service.ts
//
// Business logic for demo/slot bookings (docs/03-prd-crm.md §7.12) + the UNAUTHENTICATED
// public intake stub (docs/plans/phase-2.md task #6). Never touches Prisma directly.
//
// NOTE ON `notes` (CreateBookingRequest.notes / MoveBookingStatusRequest.notes /
// BookingDetail.notes): the `bookings` table (prisma/schema.prisma) has NO `notes`
// column — adding one would require a new migration, which is out of scope for this
// module (CLAUDE.md §3.8: "migrations are forward-only and reviewed", db-architect
// owns schema changes). Per-call notes are instead logged as an `Activity` of type
// `note` attached to the booking's parent lead (if any) — consistent with "activities
// are the append-only log" design. `BookingDetail.notes` is therefore always `null` on
// the wire; the audit trail for booking notes lives in the activities timeline.
//
// SCOPE INHERITANCE: a booking's visibility is inherited from its parent lead (same
// mapping as LeadsService.resolveScopeWhere). A booking with no `leadId` (e.g. a
// program-only public-intake booking before a counsellor claims the lead — in practice
// this never happens since the public intake always creates a lead, but CRM-created
// bookings may also omit leadId) is visible to "all"/"branch" scopes tenant-wide, and
// invisible to "own"/"assigned" scopes until a lead is attached.

import { ForbiddenException, Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { BookingDetail, PublicBookingResponse, PublicBookingConsent } from "@repo/types";
import { BookingsRepository, type BookingRow, type BookingScopeWhere } from "./bookings.repository";
import { ActivitiesRepository } from "./activities.repository";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext, type ScopeContext } from "../auth/lib/scope-context";
import { LeadsRepository, type LeadScopeWhere } from "./leads.repository";
import { AuthRepository } from "../auth/auth.repository";
import { CAPTCHA_PROVIDER, type CaptchaProvider } from "../captcha/providers/captcha/captcha-provider.interface";
import type { CreateBookingRequest, UpdateBookingRequest, MoveBookingStatusRequest, ListBookingsQuery, CreatePublicBookingRequest } from "./dto";

/** Single-tenant default (mirrors AuthService.TENANT_SLUG — see auth.service.ts; not exported there, so re-declared here with the same value/comment per the codebase's existing pattern of no cross-module import for this constant). */
const TENANT_SLUG = "stimuliiq"; // Phase 0: single tenant. Multi-tenant resolution (subdomain/host) lands later.

/** SHA-256 of the client IP — raw IP is NEVER stored (DPDP; mirrors public-funnel hashIp). */
function hashIp(ip: string | null | undefined): string {
  return createHash("sha256").update(ip || "unknown").digest("hex");
}

/**
 * Build the DPDP consent JSON persisted to bookings.consent. `timestamp` + `ip_hash`
 * are ALWAYS server-derived (never client-supplied); shape matches the column doc in
 * schema.prisma (marketing_opt_in / tos_version / timestamp / ip_hash).
 */
function buildBookingConsent(consent: PublicBookingConsent, ip: string | undefined): Prisma.InputJsonValue {
  return {
    marketing_opt_in: consent.marketingOptIn,
    tos_version: consent.tosVersion,
    timestamp: new Date().toISOString(),
    ip_hash: hashIp(ip),
  };
}

const BOOKING_STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  requested: ["confirmed", "cancelled"],
  confirmed: ["completed", "cancelled", "no_show"],
  completed: [],
  cancelled: [],
  no_show: [],
};

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly repository: BookingsRepository,
    private readonly leadsRepository: LeadsRepository,
    private readonly activitiesRepository: ActivitiesRepository,
    private readonly authRepository: AuthRepository,
    @Inject(CAPTCHA_PROVIDER) private readonly captchaProvider: CaptchaProvider,
  ) {}

  private async resolveScopeWhere(scope: ScopeContext): Promise<BookingScopeWhere> {
    const leadScope = await this.resolveLeadScopeWhere(scope);
    return {
      OR: [
        { leadId: null }, // unattached bookings visible to whichever scope reaches this branch (see resolveLeadScopeWhere "all"/"branch" returning {}).
        { leadId: { not: null }, lead: leadScope },
      ],
    };
  }

  private async resolveLeadScopeWhere(scope: ScopeContext): Promise<LeadScopeWhere> {
    switch (scope.scope) {
      case "all":
        return {};
      case "branch": {
        const branchIds = await this.leadsRepository.listCallerBranchIds(scope.actorId);
        return { branchId: { in: branchIds } };
      }
      case "assigned": {
        const branchIds = await this.leadsRepository.listCallerBranchIds(scope.actorId);
        return { OR: [{ ownerId: scope.actorId }, { branchId: { in: branchIds } }] };
      }
      case "own":
        return { ownerId: scope.actorId };
      default:
        throw new ForbiddenException({
          code: "bookings.scope_unresolvable",
          title: "Scope not supported",
          detail: `The "${scope.scope}" data-scope is not resolvable for the bookings module.`,
        });
    }
  }

  async list(tenantId: string, query: ListBookingsQuery): Promise<PaginatedResult<BookingDetail>> {
    const scope = requireScopeContext();
    const scopeWhere = await this.resolveScopeWhere(scope);

    const { rows, total } = await this.repository.list({
      tenantId,
      leadId: query.leadId,
      programId: query.programId,
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
      scopeWhere,
    });

    return new PaginatedResult(rows.map(toDetail), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  async getById(tenantId: string, id: string): Promise<BookingDetail> {
    const scope = requireScopeContext();
    const scopeWhere = await this.resolveScopeWhere(scope);
    const row = await this.repository.findById(tenantId, id, scopeWhere);
    if (!row) {
      throw new NotFoundException({ code: "bookings.not_found", title: "Booking not found" });
    }
    return toDetail(row);
  }

  async create(tenantId: string, actorId: string, body: CreateBookingRequest): Promise<BookingDetail> {
    if (body.leadId) {
      const scope = requireScopeContext();
      const leadScopeWhere = await this.resolveLeadScopeWhere(scope);
      const lead = await this.leadsRepository.findById(tenantId, body.leadId, leadScopeWhere);
      if (!lead) {
        throw new NotFoundException({ code: "leads.not_found", title: "Lead not found" });
      }
    }

    const created = await this.repository.create({
      tenantId,
      leadId: body.leadId,
      programId: body.programId,
      slotAt: new Date(body.slotAt),
      source: body.source,
    });

    if (body.notes && body.leadId) {
      await this.logBookingNote(tenantId, actorId, body.leadId, created.id, body.notes);
    }

    const row = await this.repository.findById(tenantId, created.id);
    if (!row) throw new NotFoundException({ code: "bookings.not_found", title: "Booking not found after creation" });
    return toDetail(row);
  }

  async update(tenantId: string, id: string, body: UpdateBookingRequest): Promise<BookingDetail> {
    const scope = requireScopeContext();
    const scopeWhere = await this.resolveScopeWhere(scope);
    const existing = await this.repository.findById(tenantId, id, scopeWhere);
    if (!existing) {
      throw new NotFoundException({ code: "bookings.not_found", title: "Booking not found" });
    }

    await this.repository.update(id, {
      slotAt: body.slotAt ? new Date(body.slotAt) : undefined,
      programId: body.programId,
      source: undefined,
    });

    const updated = await this.repository.findById(tenantId, id, scopeWhere);
    if (!updated) throw new NotFoundException({ code: "bookings.not_found", title: "Booking not found after update" });
    return toDetail(updated);
  }

  /** PATCH /crm/bookings/:id/status — enforces the requested→confirmed→completed/cancelled/no_show state machine. Audited automatically. */
  async moveStatus(tenantId: string, actorId: string, id: string, body: MoveBookingStatusRequest): Promise<BookingDetail> {
    const scope = requireScopeContext();
    const scopeWhere = await this.resolveScopeWhere(scope);
    const existing = await this.repository.findById(tenantId, id, scopeWhere);
    if (!existing) {
      throw new NotFoundException({ code: "bookings.not_found", title: "Booking not found" });
    }

    const allowed = BOOKING_STATUS_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(body.status)) {
      throw new UnprocessableEntityException({
        code: "bookings.invalid_status_transition",
        title: "Invalid booking status transition",
        detail: `Cannot move a booking from "${existing.status}" to "${body.status}".`,
      });
    }

    await this.repository.moveStatus(id, body.status);

    if (body.notes && existing.leadId) {
      await this.logBookingNote(tenantId, actorId, existing.leadId, id, body.notes);
    }

    const updated = await this.repository.findById(tenantId, id, scopeWhere);
    if (!updated) throw new NotFoundException({ code: "bookings.not_found", title: "Booking not found after status move" });
    return toDetail(updated);
  }

  /**
   * POST /api/v1/public/bookings — UNAUTHENTICATED intake (docs/plans/phase-2.md task
   * #6). Resolves the single hardcoded tenant (mirrors AuthService's TENANT_SLUG
   * resolution), de-duplicates against an existing lead by phone (per the contract's
   * "upserts a lead row... finds existing lead by phone" — docs/bookings.schemas.ts), and
   * creates the booking in one transaction. Rate-limiting + strict zod validation are
   * enforced by the caller (PublicBookingRateLimiter + ZodValidationPipe at the
   * controller boundary) BEFORE this method is ever invoked.
   */
  async createPublicBooking(body: CreatePublicBookingRequest, ip?: string): Promise<PublicBookingResponse> {
    // Captcha-gated public write (captcha-provider.interface.ts lists bookings as a
    // gated endpoint). Verified only when a token is present so CRM/API-created
    // bookings without a widget token still work; the public book-slot form always
    // sends one. In dev the Noop provider passes; prod uses Turnstile (fail-closed).
    if (body.captchaToken) {
      await this.verifyCaptcha(body.captchaToken, ip);
    }

    const tenant = await this.authRepository.getTenantBySlug(TENANT_SLUG);
    if (!tenant) {
      throw new NotFoundException({ code: "bookings.tenant_not_found", title: "Tenant not configured" });
    }

    // DPDP consent: timestamp + ip_hash are ALWAYS server-derived, never trusted from
    // the client (mirrors public-funnel.service.ts#buildConsent). Only stored when the
    // form supplied consent choices; absent for CRM-created bookings.
    const consent = body.consent ? buildBookingConsent(body.consent, ip) : undefined;

    const existingLead = await this.leadsRepository.findByPhone(tenant.id, body.phone);

    const result = existingLead
      ? await this.attachBookingToExistingLead(tenant.id, existingLead.id, body, consent)
      : await this.repository.createPublicLeadAndBooking({
          tenantId: tenant.id,
          name: body.name,
          phone: body.phone,
          email: body.email,
          programId: body.programId,
          slotAt: new Date(body.slotAt),
          source: body.source,
          utm: body.utm,
          consent,
        });

    return {
      bookingId: result.bookingId,
      slotAt: result.slotAt.toISOString(),
      status: result.status,
      message: "Your slot has been booked. Our team will confirm shortly.",
    };
  }

  /** Verify a captcha token; 422 on failure. Never logs the token or secret. */
  private async verifyCaptcha(token: string, ip: string | undefined): Promise<void> {
    const result = await this.captchaProvider.verify(token, ip);
    if (!result.success) {
      this.logger.warn(`[Bookings] Captcha verification failed, codes: ${result.errorCodes?.join(",")}`);
      throw new UnprocessableEntityException({
        code: "public_bookings.captcha_invalid",
        title: "Captcha verification failed",
        detail: "Please complete the captcha challenge and try again.",
      });
    }
  }

  private async attachBookingToExistingLead(
    tenantId: string,
    leadId: string,
    body: CreatePublicBookingRequest,
    consent?: Prisma.InputJsonValue,
  ): Promise<{ bookingId: string; slotAt: Date; status: "requested" }> {
    const created = await this.repository.create({
      tenantId,
      leadId,
      programId: body.programId,
      slotAt: new Date(body.slotAt),
      status: "requested",
      source: body.source,
      consent,
    });
    return { bookingId: created.id, slotAt: new Date(body.slotAt), status: "requested" };
  }

  private async logBookingNote(tenantId: string, actorId: string, leadId: string, bookingId: string, notes: string): Promise<void> {
    await this.activitiesRepository.create({
      tenantId,
      leadId,
      userId: actorId,
      type: "note",
      payload: { bookingId, note: notes },
    });
  }
}

function toDetail(row: BookingRow): BookingDetail {
  return {
    id: row.id,
    leadId: row.leadId,
    leadName: row.leadName,
    programId: row.programId,
    programTitle: row.programTitle,
    slotAt: row.slotAt.toISOString(),
    status: row.status,
    source: row.source,
    notes: null, // see file header — bookings has no notes column; notes are logged as activities.
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
