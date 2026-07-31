// apps/api/src/modules/public/public.repository.ts
//
// Prisma data access ONLY for the public catalog + funnel (docs/04-trd-architecture.md §2.1).
// PublicCatalogService and PublicFunnelService are the only callers.
//
// SECURITY CONTRACT — projection safety:
//   Every SELECT in this repository EXPLICITLY lists allowed columns (never `select: *`).
//   Forbidden fields (status, isPublic, ogImageKey, tenantId, deletedAt, cost, margin, notes,
//   lesson.content, video.provider_asset_id, resources.storage_key, mentor PII)
//   are NEVER included. The public projection contract from
//   docs/specs/phase-5-website.md §"Public-Projection Allowlist" is enforced here.
//
// TENANT RESOLUTION: tenantId is always resolved server-side (TENANT_SLUG constant —
//   single-tenant P5; multi-tenant resolution via subdomain is a future phase).
//   It is NEVER accepted from client request bodies.
//
// COUPON VALIDATE: never touches the `used` counter — that stays in CommerceService.
//   The public validate path is read-only (preview only, per the spec).

import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { resolveTenantIdCached } from "../../common/tenant/tenant-id-cache";

// ─── Public program row shapes ────────────────────────────────────────────────
// Only the allowed columns from the public-projection allowlist.

export interface PublicProgramListRow {
  id: string;
  slug: string;
  title: string;
  domain: string;
  level: string | null;
  mode: string;
  durationWeeks: number | null;
  cardSummary: string | null;
  pricePaise: number;
  compareAtPricePaise: number | null;
  emi: unknown;
  ratingAvg: number | null;
  ratingCount: number | null;
  ogImageKey: string | null; // raw key — converted to CDN URL in the service
  scholarshipAvailable: boolean;
  enrollmentEnabled: boolean;
  // badgeEnabled is selected but NEVER returned — the service uses it to decide whether to
  // surface badgeColor/badgeLabel at all (see PublicCatalogService.toSummary).
  badgeColor: string | null;
  badgeLabel: string | null;
  badgeEnabled: boolean;
}

export interface PublicProgramDetailRow extends PublicProgramListRow {
  seoTitle: string | null;
  seoDescription: string | null;
  outcomes: unknown;
  brochureKey: string | null; // raw key — converted to a public asset URL in the service
}

export interface PublicModuleRow {
  id: string;
  title: string;
  order: number;
  lessons: PublicLessonRow[];
}

export interface PublicLessonRow {
  id: string;
  title: string;
  type: string;
  order: number;
  isPreview: boolean;
  // content / video / resources are intentionally ABSENT — never fetched
}

export interface PublicMentorRow {
  id: string;
  name: string;         // from user.name
  avatarKey: string | null; // from user.avatar (raw key → CDN URL in service)
  expertise: unknown;   // from faculty_profiles.expertise
  company: string | null; // not in schema yet — null for P5
  title: string | null;   // not in schema yet — null for P5
}

export interface PublicMentorDirectoryRow {
  id: string;
  fullName: string;
  externalInstitute: string;
  expertise: unknown; // Json string[] — coerced in the service
  // Public marketing-profile fields (photoKey → CDN URL in the service; raw key never leaves).
  photoKey: string | null;
  title: string | null;
  bio: string | null;
  yearsExperience: number | null;
  socialLinks: unknown; // Json { linkedin?, twitter?, github?, website? } — coerced in the service
  // FORBIDDEN (never selected): email, phone, notes, engagementStatus, userId, joinedAt
}

export interface PublicCouponRow {
  id: string;
  code: string;
  type: string;
  value: number;
  programScope: string | null;
  maxUses: number | null;
  used: number;
  validFrom: Date | null;
  validTo: Date | null;
  status: string;
}

// Explicit Prisma select for public program list — NEVER selects forbidden columns.
const PUBLIC_PROGRAM_LIST_SELECT = {
  id: true,
  slug: true,
  title: true,
  domain: true,
  level: true,
  mode: true,
  durationWeeks: true,
  cardSummary: true,
  pricePaise: true,
  compareAtPricePaise: true,
  emi: true,
  ratingAvg: true,
  ratingCount: true,
  ogImageKey: true,
  scholarshipAvailable: true,
  // Badge: colour/label are public (the rendered outcome); badgeEnabled is selected ONLY so
  // the service can null the other two out when the toggle is off. It never reaches a
  // response — `ForbiddenProgramField` in @repo/types asserts that at compile time.
  badgeColor: true,
  badgeLabel: true,
  badgeEnabled: true,
  // enrollmentEnabled is safe to expose: it only tells the site which CTA to render.
  // Unlike `isPublic` it reveals nothing about unpublished inventory — every row reaching
  // this select already passed the isPublic + status=published gate.
  enrollmentEnabled: true,
  // FORBIDDEN (never selected): status, isPublic, tenantId, deletedAt, updatedAt, createdAt,
  // seoTitle, seoDescription, cost, margin, notes, summary, seo, outcomes
} satisfies Prisma.ProgramSelect;

// Explicit Prisma select for public program detail — adds seo fields + outcomes.
const PUBLIC_PROGRAM_DETAIL_SELECT = {
  ...PUBLIC_PROGRAM_LIST_SELECT,
  seoTitle: true,
  seoDescription: true,
  outcomes: true,
  // Raw brochure key — the service converts it to a public asset URL; like ogImageKey the
  // key itself never reaches the response. Detail-only: the listing cards offer no download.
  brochureKey: true,
  // FORBIDDEN (still excluded): status, isPublic, tenantId, deletedAt, cost, margin, notes
} satisfies Prisma.ProgramSelect;

// Explicit select for mentor bios — public fields ONLY, no PII.
// name + avatar come from the related User row (FacultyProfile has no name/avatar columns).
// company/title are not in the P5 schema yet (future db-architect addition).
const PUBLIC_MENTOR_SELECT = {
  id: true,
  expertise: true,
  // Join user for name + avatar (no email/phone from User)
  user: {
    select: {
      name: true,
      avatar: true,
      // FORBIDDEN: email, phone (PII — never in public response)
    },
  },
  // FORBIDDEN: userId, branchId, rating, bio (internal)
} satisfies Prisma.FacultyProfileSelect;

export interface ListPublicProgramsFilters {
  tenantId: string;
  domain?: string;
  level?: string;
  durationWeeks?: number;
  mode?: string;
  minPricePaise?: number;
  maxPricePaise?: number;
  sort: "order" | "popularity" | "price_asc" | "price_desc" | "newest";
  cursor?: string;
  limit: number;
}

@Injectable()
export class PublicRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Program catalog ────────────────────────────────────────────────────────

  async listPublicPrograms(
    filters: ListPublicProgramsFilters,
  ): Promise<{ rows: PublicProgramListRow[]; nextCursor: string | null }> {
    const where: Prisma.ProgramWhereInput = {
      tenantId: filters.tenantId,
      isPublic: true,
      status: "published",
      deletedAt: null,
      ...(filters.domain ? { domain: filters.domain } : {}),
      ...(filters.level ? { level: filters.level } : {}),
      ...(filters.durationWeeks ? { durationWeeks: filters.durationWeeks } : {}),
      ...(filters.mode ? { mode: filters.mode as Prisma.ProgramWhereInput["mode"] } : {}),
      ...(filters.minPricePaise !== undefined || filters.maxPricePaise !== undefined
        ? {
            pricePaise: {
              ...(filters.minPricePaise !== undefined ? { gte: filters.minPricePaise } : {}),
              ...(filters.maxPricePaise !== undefined ? { lte: filters.maxPricePaise } : {}),
            },
          }
        : {}),
      // Cursor pagination: only take records after the cursor id
      ...(filters.cursor ? { id: { gt: filters.cursor } } : {}),
    };

    // Sort order.
    //
    // `order` (the staff-curated sequence) is the default. Its `id` tiebreak matters: the
    // cursor below pages on `id`, so without it two programs sharing an `order` value could
    // straddle a page boundary inconsistently. The other sorts page on a column unrelated to
    // the cursor and are correspondingly unstable across pages — a pre-existing limitation
    // left untouched here, since the default path is what the nav and every landing grid use.
    let orderBy: Prisma.ProgramOrderByWithRelationInput | Prisma.ProgramOrderByWithRelationInput[];
    switch (filters.sort) {
      case "order":
        orderBy = [{ order: "asc" }, { id: "asc" }];
        break;
      case "popularity":
        orderBy = { ratingCount: "desc" };
        break;
      case "price_asc":
        orderBy = { pricePaise: "asc" };
        break;
      case "price_desc":
        orderBy = { pricePaise: "desc" };
        break;
      case "newest":
        orderBy = { createdAt: "desc" };
        break;
      default:
        orderBy = [{ order: "asc" }, { id: "asc" }];
    }

    // Fetch limit+1 to determine if there's a next page
    const rows = await this.prisma.client.program.findMany({
      where,
      select: PUBLIC_PROGRAM_LIST_SELECT,
      orderBy,
      take: filters.limit + 1,
    });

    const hasMore = rows.length > filters.limit;
    const items = hasMore ? rows.slice(0, filters.limit) : rows;
    const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;

    return { rows: items as PublicProgramListRow[], nextCursor };
  }

  // ─── Public mentors directory (web /mentors page) ───────────────────────────
  //
  // Source: the Phase-8 CRM `mentors` table (human external-hire mentors).
  // Visibility rule: engagementStatus=active AND deletedAt IS NULL — prospective
  // and inactive mentors NEVER appear publicly. Explicit select allowlist: no
  // email/phone/notes/status/userId.
  // Ordered by id (matches the id-based cursor, so pages never skip/repeat).

  async listPublicMentors(filters: {
    tenantId: string;
    cursor?: string;
    limit: number;
  }): Promise<{ rows: PublicMentorDirectoryRow[]; nextCursor: string | null }> {
    const rows = await this.prisma.client.mentor.findMany({
      where: {
        tenantId: filters.tenantId,
        engagementStatus: "active",
        deletedAt: null,
        ...(filters.cursor ? { id: { gt: filters.cursor } } : {}),
      },
      select: {
        id: true,
        fullName: true,
        externalInstitute: true,
        expertise: true,
        photoKey: true,
        title: true,
        bio: true,
        yearsExperience: true,
        socialLinks: true,
        // FORBIDDEN (never selected): email, phone, notes, engagementStatus,
        // userId, joinedAt, tenantId
      },
      orderBy: { id: "asc" },
      take: filters.limit + 1,
    });

    const hasMore = rows.length > filters.limit;
    const items = hasMore ? rows.slice(0, filters.limit) : rows;
    const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;

    return { rows: items, nextCursor };
  }

  /**
   * Single public mentor by id — SAME visibility rule and select allowlist as
   * `listPublicMentors` (active + not-deleted only; a prospective/inactive/
   * deleted/unknown id resolves to null so the service can 404 without leaking
   * existence). No email/phone/notes/status/userId ever selected.
   */
  async findPublicMentorById(tenantId: string, id: string): Promise<PublicMentorDirectoryRow | null> {
    const row = await this.prisma.client.mentor.findFirst({
      where: {
        id,
        tenantId,
        engagementStatus: "active",
        deletedAt: null,
      },
      select: {
        id: true,
        fullName: true,
        externalInstitute: true,
        expertise: true,
        photoKey: true,
        title: true,
        bio: true,
        yearsExperience: true,
        socialLinks: true,
        // FORBIDDEN (never selected): email, phone, notes, engagementStatus, userId, joinedAt, tenantId
      },
    });
    return row as PublicMentorDirectoryRow | null;
  }

  async findPublicProgramBySlug(tenantId: string, slug: string): Promise<PublicProgramDetailRow | null> {
    const row = await this.prisma.client.program.findFirst({
      where: {
        tenantId,
        slug,
        isPublic: true,
        status: "published",
        deletedAt: null,
      },
      select: PUBLIC_PROGRAM_DETAIL_SELECT,
    });
    return row as PublicProgramDetailRow | null;
  }

  async findPublicProgramById(tenantId: string, id: string): Promise<PublicProgramDetailRow | null> {
    const row = await this.prisma.client.program.findFirst({
      where: {
        id,
        tenantId,
        isPublic: true,
        status: "published",
        deletedAt: null,
      },
      select: PUBLIC_PROGRAM_DETAIL_SELECT,
    });
    return row as PublicProgramDetailRow | null;
  }

  async getPublicCurriculumOutline(programId: string): Promise<PublicModuleRow[]> {
    const modules = await this.prisma.client.module.findMany({
      where: { programId, deletedAt: null },
      orderBy: { order: "asc" },
      select: {
        id: true,
        title: true,
        order: true,
        lessons: {
          where: { deletedAt: null },
          orderBy: { order: "asc" },
          select: {
            id: true,
            title: true,
            type: true,
            order: true,
            isPreview: true,
            // FORBIDDEN: content, video, resources — never selected
          },
        },
      },
    });
    return modules as PublicModuleRow[];
  }

  async getPublicMentorBios(programId: string): Promise<PublicMentorRow[]> {
    // Faculty bios for programs are linked via batches.facultyId. We fetch all
    // faculty profiles for faculty who teach a batch of this program.
    const batchFaculty = await this.prisma.client.batch.findMany({
      where: { programId, deletedAt: null },
      select: {
        faculty: {
          select: PUBLIC_MENTOR_SELECT,
        },
      },
    });

    // Deduplicate by id; name + avatar come from the User join
    const seen = new Set<string>();
    const mentors: PublicMentorRow[] = [];
    for (const batch of batchFaculty) {
      const f = batch.faculty as { id: string; expertise: unknown; user: { name: string; avatar: string | null } } | null;
      if (f && !seen.has(f.id)) {
        seen.add(f.id);
        mentors.push({
          id: f.id,
          name: f.user.name,
          avatarKey: f.user.avatar ?? null, // raw avatar key → CDN URL in service
          expertise: f.expertise,
          company: null, // not in schema yet (P5 db-architect follow-up)
          title: null,   // not in schema yet
        });
      }
    }
    return mentors;
  }

  async getRelatedPrograms(
    tenantId: string,
    currentProgramId: string,
    domain: string,
    limit = 4,
  ): Promise<
    Array<{
      id: string;
      slug: string;
      title: string;
      cardSummary: string | null;
      pricePaise: number;
      compareAtPricePaise: number | null;
      badgeColor: string | null;
      badgeLabel: string | null;
      badgeEnabled: boolean;
    }>
  > {
    const rows = await this.prisma.client.program.findMany({
      where: {
        tenantId,
        isPublic: true,
        status: "published",
        deletedAt: null,
        domain,
        id: { not: currentProgramId },
      },
      select: {
        id: true,
        slug: true,
        title: true,
        cardSummary: true,
        pricePaise: true,
        compareAtPricePaise: true,
        // badgeEnabled is resolved away in the service — see the list select above.
        badgeColor: true,
        badgeLabel: true,
        badgeEnabled: true,
        // FORBIDDEN: no status, isPublic, tenantId, etc.
      },
      take: limit,
    });
    return rows;
  }

  // ─── Coupon validation (read-only, never increments used counter) ────────────

  async findCouponByCode(tenantId: string, code: string): Promise<PublicCouponRow | null> {
    const row = await this.prisma.client.coupon.findFirst({
      where: { tenantId, code: code.toUpperCase(), deletedAt: null },
      select: {
        id: true,
        code: true,
        type: true,
        value: true,
        programScope: true,
        maxUses: true,
        used: true,
        validFrom: true,
        validTo: true,
        status: true,
        // FORBIDDEN in the response: id, maxUses, used, validFrom, validTo, programScope,
        // status, tenantId — these are used internally ONLY to validate; never returned to client.
      },
    });
    return row as PublicCouponRow | null;
  }

  // ─── Find existing student profile by user id (used in funnel order) ────────

  async findStudentProfileByUserId(
    tenantId: string,
    userId: string,
  ): Promise<{ id: string; userId: string } | null> {
    return this.prisma.client.studentProfile.findFirst({
      where: { userId, user: { tenantId }, deletedAt: null },
      select: { id: true, userId: true },
    });
  }

  // ─── Find order by id with student ownership check (IDOR protection) ─────────

  async findOrderForStudent(
    tenantId: string,
    orderId: string,
    studentId: string,
  ): Promise<{ id: string; studentId: string; amountPaise: number; currency: string; discountPaise: number; status: string } | null> {
    return this.prisma.client.order.findFirst({
      where: {
        id: orderId,
        tenantId,
        studentId,
        deletedAt: null,
      },
      select: {
        id: true,
        studentId: true,
        amountPaise: true,
        currency: true,
        discountPaise: true,
        status: true,
      },
    });
  }

  /**
   * Order lookup for the PAY-LINK flow — by (tenantId, orderId) only, no student
   * binding: the signed token IS the own-scope proof (pay-link.util.ts contract).
   * Returns the display fields the public /pay page renders plus the studentId the
   * checkout/verify steps act as.
   */
  async findOrderForPayLink(
    tenantId: string,
    orderId: string,
  ): Promise<{
    id: string;
    studentId: string;
    studentName: string;
    programTitle: string;
    batchName: string | null;
    amountPaise: number;
    currency: string;
    status: string;
    notes: unknown;
  } | null> {
    const row = await this.prisma.client.order.findFirst({
      where: { id: orderId, tenantId, deletedAt: null },
      select: {
        id: true,
        studentId: true,
        amountPaise: true,
        currency: true,
        status: true,
        notes: true,
        student: { select: { user: { select: { name: true } } } },
        program: { select: { title: true } },
      },
    });
    if (!row) return null;
    // The batch is only in notes JSON until payment creates the enrollment
    // (same seam as CommerceService.hydrateOpenOrderBatchNames).
    const notesBatchId =
      typeof (row.notes as Record<string, unknown> | null)?.["batchId"] === "string"
        ? ((row.notes as Record<string, unknown>)["batchId"] as string)
        : null;
    let batchName: string | null = null;
    if (notesBatchId) {
      const batch = await this.prisma.client.batch.findFirst({
        where: { id: notesBatchId, tenantId, deletedAt: undefined },
        select: { name: true },
      });
      batchName = batch?.name ?? null;
    }
    return {
      id: row.id,
      studentId: row.studentId,
      studentName: row.student.user.name,
      programTitle: row.program.title,
      batchName,
      amountPaise: row.amountPaise,
      currency: row.currency,
      status: row.status,
      notes: row.notes,
    };
  }

  // ─── Find auto-select batch for a program (public funnel) ──────────────────

  async findAvailableBatchForProgram(tenantId: string, programId: string): Promise<{ id: string } | null> {
    // Pick the first active or planned batch with remaining capacity
    const batches = await this.prisma.client.batch.findMany({
      where: {
        tenantId,
        programId,
        status: { in: ["planned", "active"] },
        deletedAt: null,
      },
      select: {
        id: true,
        capacity: true,
        _count: { select: { enrollments: { where: { deletedAt: null } } } },
      },
      orderBy: { startDate: "asc" },
      take: 10,
    });

    for (const batch of batches) {
      if (batch._count.enrollments < batch.capacity) {
        return { id: batch.id };
      }
    }
    return null;
  }

  // ─── P-3: Create lead with P5 attribution fields ────────────────────────────

  async createLead(data: {
    tenantId: string;
    name: string;
    phone: string;
    email?: string;
    programInterestId?: string;
    courseInterest?: string;
    college?: string;
    language?: string;
    message?: string;
    source: string;
    utm?: unknown;
    landingUrl?: string;
    referrer?: string;
    gclid?: string;
    fbclid?: string;
    consent: unknown;
    ownerId?: string | null;
  }): Promise<string> {
    const row = await this.prisma.client.lead.create({
      data: {
        tenantId: data.tenantId,
        name: data.name,
        phone: data.phone,
        email: data.email,
        programInterestId: data.programInterestId,
        courseInterest: data.courseInterest,
        college: data.college,
        language: data.language,
        message: data.message,
        source: data.source,
        utm: (data.utm ?? {}) as Prisma.InputJsonValue,
        landingUrl: data.landingUrl,
        referrer: data.referrer,
        gclid: data.gclid,
        fbclid: data.fbclid,
        consent: data.consent as Prisma.InputJsonValue,
        ownerId: data.ownerId ?? null,
        stage: "new",
      },
    });
    return row.id;
  }

  // ─── P-6: Create user + student_profile atomically for public registration ──

  async createUserWithStudentProfile(data: {
    tenantId: string;
    name: string;
    email: string;
    phone: string;
    passwordHash: string;
    consent: unknown;
  }): Promise<{ userId: string; profileId: string }> {
    return this.prisma.client.$transaction(async (tx) => {
      // Create user with active status (self-registered with verified OTP)
      // NOTE: consent is stored in the audit log (writeAuditLog after this tx)
      // since neither users nor student_profiles has a consent column in P5 schema.
      // The db-architect can add a consent Json? column in a follow-up migration.
      const user = await tx.user.create({
        data: {
          tenantId: data.tenantId,
          name: data.name,
          email: data.email,
          phone: data.phone,
          passwordHash: data.passwordHash,
          status: "active", // self-registered + OTP-verified → immediately active
        },
      });

      // Assign 'student' role
      const role = await tx.role.findUnique({
        where: { tenantId_key: { tenantId: data.tenantId, key: "student" } },
        select: { id: true },
      });
      if (role) {
        await tx.userRole.create({ data: { userId: user.id, roleId: role.id, branchId: null } });
      }

      // Create student profile
      const profile = await tx.studentProfile.create({
        data: {
          tenantId: data.tenantId,
          userId: user.id,
          status: "active",
          courseType: "btech", // default; can be updated via profile completion
          source: "web-register",
        },
      });

      return { userId: user.id, profileId: profile.id };
    });
  }

  // ─── P-9: Find payment by provider order id (for IDOR check in verify) ──────

  async findPaymentByProviderOrderId(providerOrderId: string): Promise<{ id: string; orderId: string } | null> {
    return this.prisma.client.payment.findFirst({
      where: { providerOrderId, deletedAt: null },
      select: { id: true, orderId: true },
    });
  }

  // ─── P-9: Find enrollment created by a successful payment ───────────────────

  async findEnrollmentByOrderId(tenantId: string, orderId: string): Promise<{ id: string } | null> {
    return this.prisma.client.enrollment.findFirst({
      where: { tenantId, orderId, deletedAt: null },
      select: { id: true },
    });
  }

  // ─── Tenant resolution ─────────────────────────────────────────────────────

  async getTenantIdBySlug(slug: string): Promise<string | null> {
    // Memoised per process — the slug is a compile-time constant and this is a
    // cross-region round trip. See common/tenant/tenant-id-cache.ts.
    return resolveTenantIdCached(slug, async () => {
      const row = await this.prisma.client.tenant.findUnique({
        where: { slug },
        select: { id: true },
      });
      return row?.id ?? null;
    });
  }

  /**
   * Resolves a lesson that an ANONYMOUS visitor is allowed to watch on the marketing
   * site, together with its ready video asset.
   *
   * Every gate is expressed in this WHERE clause so there is no way to reach a
   * paid lesson through this path:
   *   - the lesson belongs to the given program slug, in this tenant
   *   - `isPreview: true`            — the CRM "Free preview" toggle
   *   - program `isPublic` + `published` — same visibility gate as the catalog
   *   - a `ready` video exists
   * Anything else resolves to null → 404 (no existence disclosure).
   *
   * Returns `providerAssetId` for the caller to mint a signed URL from; that raw id
   * is NEVER returned to the client.
   */
  async findPreviewableLesson(
    tenantId: string,
    programSlug: string,
    lessonId: string,
  ): Promise<{ lessonId: string; title: string; providerAssetId: string } | null> {
    const row = await this.prisma.client.lesson.findFirst({
      where: {
        id: lessonId,
        deletedAt: null,
        isPreview: true,
        module: {
          deletedAt: null,
          program: { tenantId, slug: programSlug, isPublic: true, status: "published", deletedAt: null },
        },
        video: { status: "ready", deletedAt: null },
      },
      select: {
        id: true,
        title: true,
        video: { select: { providerAssetId: true } },
      },
    });

    if (!row?.video?.providerAssetId) return null;
    return { lessonId: row.id, title: row.title, providerAssetId: row.video.providerAssetId };
  }

  // ─── Phase-9 Completion T30: per-city SEO support ────────────────────────────
  // "Program offered in city X" = a public/published program with at least one
  // planned/active batch (BatchStatus has no "cancelled" value; completed/archived
  // batches don't count as "currently offered") at an active branch whose city
  // matches. Only PUBLIC-safe fields are ever selected (city/branch name only — no
  // branch address/tenant-internal fields), consistent with this file's
  // projection-safety contract (see file header).

  /** Distinct active-branch cities, each with the count of DISTINCT public programs offered there. */
  async listCitiesWithPublicPrograms(tenantId: string): Promise<Array<{ city: string; programCount: number }>> {
    const branches = await this.prisma.client.branch.findMany({
      where: { tenantId, status: "active", deletedAt: null, city: { not: null } },
      select: {
        city: true,
        batches: {
          where: {
            status: { in: ["planned", "active"] },
            program: { tenantId, isPublic: true, status: "published", deletedAt: null },
          },
          select: { programId: true },
          distinct: ["programId"],
        },
      },
    });

    const byCity = new Map<string, Set<string>>();
    for (const branch of branches) {
      if (!branch.city) continue;
      const set = byCity.get(branch.city) ?? new Set<string>();
      for (const batch of branch.batches) set.add(batch.programId);
      byCity.set(branch.city, set);
    }

    return [...byCity.entries()]
      .map(([city, programIds]) => ({ city, programCount: programIds.size }))
      .filter((row) => row.programCount > 0)
      .sort((a, b) => a.city.localeCompare(b.city));
  }

  /** Distinct public program ids offered by at least one active branch in `city`. */
  async findPublicProgramIdsForCity(tenantId: string, city: string): Promise<string[]> {
    const rows = await this.prisma.client.batch.findMany({
      where: {
        status: { in: ["planned", "active"] },
        branch: { tenantId, city, status: "active", deletedAt: null },
        program: { tenantId, isPublic: true, status: "published", deletedAt: null },
      },
      select: { programId: true },
      distinct: ["programId"],
    });
    return rows.map((r) => r.programId);
  }

  // ─── Audit log write for public mutations ───────────────────────────────────

  /** Resolve a student PROFILE id to its USER id (audit_logs.actor_id FK target). */
  async findStudentUserIdByProfileId(tenantId: string, profileId: string): Promise<string | null> {
    const profile = await this.prisma.client.studentProfile.findFirst({
      where: { id: profileId, tenantId },
      select: { userId: true },
    });
    return profile?.userId ?? null;
  }

  async writeAuditLog(data: {
    tenantId: string;
    actorId: string | null;
    entity: string;
    entityId: string;
    action: "create" | "update";
    after?: unknown;
    ip?: string | null;
  }): Promise<void> {
    await this.prisma.client.auditLog.create({
      data: {
        tenantId: data.tenantId,
        actorId: data.actorId,
        entity: data.entity,
        entityId: data.entityId,
        action: data.action,
        before: Prisma.JsonNull,
        after: (data.after as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        ip: data.ip ?? null,
      },
    });
  }
}
