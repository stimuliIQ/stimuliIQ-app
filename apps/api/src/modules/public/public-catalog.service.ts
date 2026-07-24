// apps/api/src/modules/public/public-catalog.service.ts
//
// Business logic for the PUBLIC read-only program catalog (P-1, P-2).
// Endpoints: GET /public/programs, GET /public/programs/:slug
//
// SECURITY:
//   - ONLY queries programs where isPublic=true AND status='published' AND deletedAt IS NULL.
//     A draft or non-public slug → 404 (no existence leak, AC-25).
//   - Public projection: ONLY the allowlist columns from docs/specs/phase-5-website.md
//     are selected (enforced at the repository layer). Forbidden fields (status, isPublic,
//     ogImageKey raw, tenantId, cost, margin, notes, etc.) NEVER reach the response.
//   - ogImageKey is converted to a public CDN URL here (never the raw S3/R2 key).
//   - Curriculum outline: module titles + lesson stubs (isPreview only, no content/video).
//   - Mentor bios: public display fields only (no userId/email/phone/branchId/rating).
//   - Reviews: first name + college only (no email/phone/student_id) — P6 reviews table.
//   - No scope context required — public reads bypass the RBAC scope machinery.
//
// TENANT: resolved server-side via TENANT_SLUG constant (single-tenant P5).

import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type {
  PublicProgramSummary,
  PublicProgramDetail,
  ListPublicProgramsQuery,
  ListPublicMentorsQuery,
  PublicMentorCard,
  PublicModuleOutline,
  PublicMentorBio,
  PublicReviewsSummary,
  MentorSocialLinks,
  PublicLessonPreviewUrlResponse,
} from "@repo/types";
import { PublicRepository, type PublicProgramListRow, type PublicProgramDetailRow } from "./public.repository";
import { VIDEO_PROVIDER, type VideoProvider } from "../lms/providers/video/video-provider.interface";
import { validateEnv } from "../../config/env";

const TENANT_SLUG = "stimuliiq"; // Single-tenant P5 (multi-tenant subdomain resolution = future phase)

/**
 * TTL for anonymous marketing-site preview URLs. Deliberately short — the URL is a
 * bearer credential handed to an unauthenticated visitor, so it should outlive a
 * single "watch this clip" session and no more.
 */
const PUBLIC_PREVIEW_TTL_SECONDS = 300;

/**
 * Coerce a raw `socialLinks` JSON column to the typed, allow-listed shape.
 * Mirrors mentors.repository.ts's `toSocialLinks` (kept local to avoid coupling
 * the public module to the CRM repository). Unknown keys are dropped.
 */
function toSocialLinks(value: unknown): MentorSocialLinks | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const links: MentorSocialLinks = {};
  for (const k of ["linkedin", "twitter", "github", "website"] as const) {
    if (typeof obj[k] === "string" && obj[k]) links[k] = obj[k] as string;
  }
  return Object.keys(links).length > 0 ? links : null;
}

/** Convert raw S3/R2 key to a public asset URL. Returns null if key absent. Base is
 *  `PUBLIC_ASSET_BASE_URL` (default the prod CDN; `.../api/v1/assets` in local dev). */
function mintCdnUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  const base = (validateEnv().PUBLIC_ASSET_BASE_URL ?? "https://cdn.stimuliiq.com").replace(/\/+$/, "");
  return `${base}/${key}`;
}

/** Derive a human-readable EMI display string from the emi JSON field. */
function deriveEmiDisplay(emi: unknown): string | null {
  if (!emi || typeof emi !== "object") return null;
  const e = emi as Record<string, unknown>;
  if (!e.monthly || !e.months) return null;
  const monthly = Number(e.monthly);
  const months = Number(e.months);
  if (!monthly || !months) return null;
  const rupees = Math.floor(monthly / 100).toLocaleString("en-IN");
  return `₹${rupees}/month × ${months}`;
}

@Injectable()
export class PublicCatalogService {
  private readonly logger = new Logger(PublicCatalogService.name);

  constructor(
    private readonly repository: PublicRepository,
    @Inject(VIDEO_PROVIDER) private readonly videoProvider: VideoProvider,
  ) {}

  private async resolveTenantId(): Promise<string> {
    const tenantId = await this.repository.getTenantIdBySlug(TENANT_SLUG);
    if (!tenantId) {
      this.logger.warn("[PublicCatalog] Tenant not found — TENANT_SLUG may not match seed data");
      throw new NotFoundException({ code: "public.tenant_not_found", title: "Service unavailable" });
    }
    return tenantId;
  }

  async listPrograms(
    query: ListPublicProgramsQuery,
  ): Promise<{ items: PublicProgramSummary[]; nextCursor: string | null }> {
    const tenantId = await this.resolveTenantId();

    const { rows, nextCursor } = await this.repository.listPublicPrograms({
      tenantId,
      domain: query.domain,
      level: query.level,
      durationWeeks: query.durationWeeks,
      mode: query.mode,
      minPricePaise: query.minPricePaise,
      maxPricePaise: query.maxPricePaise,
      sort: query.sort ?? "popularity",
      cursor: query.cursor,
      limit: query.limit ?? 12,
    });

    const items: PublicProgramSummary[] = rows.map((row) => this.toSummary(row));
    return { items, nextCursor };
  }

  /**
   * Public mentors directory (web /mentors page) — CRM `mentors` table,
   * engagementStatus=active only. Public-safe projection: fullName +
   * externalInstitute + expertise tags (PublicMentorCardSchema allowlist);
   * email/phone/notes/status never leave the repository select.
   */
  async listMentors(
    query: ListPublicMentorsQuery,
  ): Promise<{ items: PublicMentorCard[]; nextCursor: string | null }> {
    const tenantId = await this.resolveTenantId();

    const { rows, nextCursor } = await this.repository.listPublicMentors({
      tenantId,
      cursor: query.cursor,
      limit: query.limit ?? 12,
    });

    const items: PublicMentorCard[] = rows.map((row) => this.toMentorCard(row));
    return { items, nextCursor };
  }

  /**
   * GET /public/mentors/:id — single active mentor's public card. 404 (no
   * existence leak) for a prospective/inactive/deleted/unknown id. Uses the
   * SAME forbidden-field-safe projection every /public/mentors response uses.
   */
  async getMentorById(id: string): Promise<PublicMentorCard> {
    const tenantId = await this.resolveTenantId();
    const row = await this.repository.findPublicMentorById(tenantId, id);
    if (!row) {
      throw new NotFoundException({ code: "public.mentor_not_found", title: "Mentor not found" });
    }
    return this.toMentorCard(row);
  }

  /** Shared row→public-card projection (photoKey → CDN URL; forbidden fields never present). */
  private toMentorCard(row: {
    id: string;
    fullName: string;
    externalInstitute: string;
    expertise: unknown;
    photoKey: string | null;
    title: string | null;
    bio: string | null;
    yearsExperience: number | null;
    socialLinks: unknown;
  }): PublicMentorCard {
    return {
      id: row.id,
      fullName: row.fullName,
      externalInstitute: row.externalInstitute,
      expertise: Array.isArray(row.expertise)
        ? row.expertise.filter((v): v is string => typeof v === "string")
        : [],
      // photoKey → CDN URL server-side; the raw key never leaves the server. All
      // nullable — a card renders fine without them.
      photoUrl: mintCdnUrl(row.photoKey),
      title: row.title,
      bio: row.bio,
      yearsExperience: row.yearsExperience,
      socialLinks: toSocialLinks(row.socialLinks),
    };
  }

  /**
   * Resolves the (single-tenant P5) tenant id. Exposed for GrowthModule (Phase-9
   * Completion T30 — per-city SEO + bundles/tracks pricing) so it can build its own
   * aggregation queries against the SAME tenant without re-deriving TENANT_SLUG.
   */
  async getPublicTenantId(): Promise<string> {
    return this.resolveTenantId();
  }

  /**
   * ALL public program summaries (bounded — not the public 12/50-per-page cursor
   * pagination `ListPublicProgramsQuerySchema` enforces at the controller boundary).
   * Internal-reuse-only: GrowthModule's bundles/tracks pricing view groups these by
   * `domain` — see growth.service.ts. Reuses the SAME forbidden-field-safe
   * `toSummary()` projection every /public/programs response uses, so no second,
   * divergent public-projection implementation exists.
   */
  async listAllPublicProgramSummaries(maxItems = 500): Promise<PublicProgramSummary[]> {
    const tenantId = await this.resolveTenantId();
    const { rows } = await this.repository.listPublicPrograms({
      tenantId,
      sort: "newest",
      limit: maxItems,
    });
    return rows.map((row) => this.toSummary(row));
  }

  async getProgramBySlug(slug: string): Promise<PublicProgramDetail> {
    const tenantId = await this.resolveTenantId();

    const row = await this.repository.findPublicProgramBySlug(tenantId, slug);
    if (!row) {
      // Draft/non-public slug → 404 with no existence leak (AC-25)
      throw new NotFoundException({ code: "public.program_not_found", title: "Program not found" });
    }

    return this.toDetail(tenantId, row);
  }

  /**
   * GET /public/programs/:slug/lessons/:lessonId/preview-url — anonymous
   * "watch before you enrol" playback for the marketing site.
   *
   * Authorisation is entirely in `findPreviewableLesson`'s WHERE clause (public +
   * published program, `is_preview` lesson, `ready` video). A miss is a 404 with no
   * existence disclosure, so probing lesson ids reveals nothing about paid content.
   *
   * Media contract matches the enrolled path: short-TTL SIGNED url, and the
   * `providerAssetId` used to mint it never leaves the server. Fails closed — an
   * unconfigured provider throws, surfacing as 503, never a raw fallback URL.
   */
  async getLessonPreviewUrl(slug: string, lessonId: string): Promise<PublicLessonPreviewUrlResponse> {
    const tenantId = await this.resolveTenantId();

    const lesson = await this.repository.findPreviewableLesson(tenantId, slug, lessonId);
    if (!lesson) {
      throw new NotFoundException({
        code: "public.preview_not_available",
        title: "Preview not available",
        detail: "This lesson is not available as a free preview.",
      });
    }

    const minted = await this.videoProvider.mintSignedHlsUrl({
      assetId: lesson.providerAssetId,
      // Anonymous viewer — there is no user id to scope the token to. The watermark
      // and per-user CDN scoping only apply to the enrolled student path.
      userId: "public-preview",
      lessonId: lesson.lessonId,
      ttlSeconds: PUBLIC_PREVIEW_TTL_SECONDS,
    });

    return {
      lessonId: lesson.lessonId,
      lessonTitle: lesson.title,
      url: minted.url,
      expiresAt: minted.expiresAt.toISOString(),
    };
  }

  // ─── Private projection builders ────────────────────────────────────────────

  private toSummary(row: PublicProgramListRow): PublicProgramSummary {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      domain: row.domain,
      level: row.level,
      mode: row.mode as PublicProgramSummary["mode"],
      durationWeeks: row.durationWeeks,
      cardSummary: row.cardSummary,
      pricePaise: row.pricePaise,
      emiDisplay: deriveEmiDisplay(row.emi),
      ratingAvg: row.ratingAvg,
      ratingCount: row.ratingCount,
      // Raw ogImageKey NEVER in the response — mint CDN URL server-side
      ogImageUrl: mintCdnUrl(row.ogImageKey),
      scholarshipAvailable: row.scholarshipAvailable,
    };
  }

  private async toDetail(tenantId: string, row: PublicProgramDetailRow): Promise<PublicProgramDetail> {
    const [curriculumModules, mentorRows, relatedRows] = await Promise.all([
      this.repository.getPublicCurriculumOutline(row.id),
      this.repository.getPublicMentorBios(row.id),
      this.repository.getRelatedPrograms(tenantId, row.id, row.domain),
    ]);

    // Curriculum outline — module titles + lesson stubs ONLY (no content/video/resources)
    const curriculumOutline: PublicModuleOutline[] = curriculumModules.map((mod) => ({
      id: mod.id,
      title: mod.title,
      order: mod.order,
      lessons: mod.lessons.map((l) => ({
        id: l.id,
        title: l.title,
        type: l.type as "video" | "reading" | "assignment" | "quiz",
        order: l.order,
        isPreview: l.isPreview,
      })),
    }));

    // Mentor bios — public display fields only (avatarKey → CDN URL server-side)
    const mentorBios: PublicMentorBio[] = mentorRows.map((m) => ({
      id: m.id,
      name: m.name,
      // avatarKey raw → CDN URL; the raw key NEVER leaves the server
      avatarUrl: mintCdnUrl(m.avatarKey),
      expertise: Array.isArray(m.expertise) ? (m.expertise as string[]) : [],
      company: m.company,
      title: m.title,
    }));

    // Reviews summary — uses denormalized ratingAvg/ratingCount columns
    // Individual review excerpts (first name + college only) come in P6 (reviews table)
    const reviewsSummary: PublicReviewsSummary = {
      count: row.ratingCount ?? 0,
      avgTimes10: row.ratingAvg ?? 0,
      excerpts: [],
    };

    const outcomes: string[] = Array.isArray(row.outcomes) ? (row.outcomes as string[]) : [];

    const relatedPrograms = relatedRows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      cardSummary: r.cardSummary,
      pricePaise: r.pricePaise,
    }));

    return {
      ...this.toSummary(row),
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      outcomes,
      curriculumOutline,
      mentorBios,
      reviewsSummary,
      relatedPrograms,
    };
  }
}
