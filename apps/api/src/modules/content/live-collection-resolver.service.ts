// apps/api/src/modules/content/live-collection-resolver.service.ts
//
// Server-side resolver for the page-builder's ONE reference block type,
// `live_collection_ref` (docs/specs/phase-10-page-builder.md block #10). Used by BOTH
// read paths that must resolve identically (AC 4 — preview must render "exactly what
// the public site would"):
//   - `ContentPagesService.getPublicBySlug` (GET /public/pages/:slug, isBuilderManaged rows)
//   - `ContentPagesBuilderService.preview` (POST /crm/content-pages/:id/preview)
//
// NEVER copies data into the page — every call re-queries the live, published-only
// source table/endpoint at request time (spec: "the same guarantee the existing public
// content controllers already enforce, and it cannot be bypassed by page-builder
// selection options"). A missing/unpublished/deleted referenced record is silently
// dropped, never a broken card and never a 500 (Edge cases #2/#3/#11) — every branch
// below is wrapped so a resolution failure degrades to an EMPTY `resolvedItems` array,
// letting the `web` renderer apply the "hide the whole block when 0 items" rule
// (a rendering concern, not a validation-layer one — see page-builder-blocks.schemas.ts).

import { Injectable, Logger } from "@nestjs/common";
import type {
  PageBuilderBlock,
  ResolvedPageBuilderBlock,
  PublicTestimonial,
  PublicProgramSummary,
  PublicMentorCard,
  LiveCollectionRefBlockData,
  ResolvedLiveCollectionRefBlockData,
  ResolvedPartnerItem,
} from "@repo/types";
import { PageBuilderBlockSchema } from "@repo/types";
import { TestimonialsRepository, type TestimonialRow } from "./testimonials.repository";
import { PartnersRepository, type PartnerRow } from "./partners.repository";
import { PublicCatalogService } from "../public/public-catalog.service";
import { mintCdnUrl } from "./content.util";

function toPublicTestimonial(row: TestimonialRow): PublicTestimonial {
  return { id: row.id, studentName: row.studentName, studentPhotoUrl: mintCdnUrl(row.studentPhotoKey), quote: row.quote, rating: row.rating };
}

function toResolvedPartner(row: PartnerRow): ResolvedPartnerItem {
  return {
    id: row.id,
    name: row.name,
    logoUrl: mintCdnUrl(row.logoKey),
    url: row.url,
    category: row.category,
    focus: row.focus,
    established: row.established,
    city: row.city,
  };
}

@Injectable()
export class LiveCollectionResolverService {
  private readonly logger = new Logger(LiveCollectionResolverService.name);

  constructor(
    private readonly testimonialsRepository: TestimonialsRepository,
    private readonly partnersRepository: PartnersRepository,
    private readonly publicCatalogService: PublicCatalogService,
  ) {}

  /**
   * Resolves a batch of ALREADY-VALIDATED blocks (save/preview/revert paths — every
   * caller here has already run the strict `PageBuilderBlockSchema` union). Resolved in
   * parallel — one query per `live_collection_ref` block (not per-item), holding the
   * "not N+1" budget the spec calls out.
   */
  async resolveKnownBlocks(tenantId: string, blocks: PageBuilderBlock[]): Promise<ResolvedPageBuilderBlock[]> {
    return Promise.all(blocks.map((block) => this.resolveOne(tenantId, block)));
  }

  /**
   * Resolves RAW (unknown-shape) stored JSON — the public read path. Each raw array
   * element is safe-parsed against the strict block union INDIVIDUALLY (never as a
   * whole-array parse) so one unknown/legacy block `type` (Edge case #9 — e.g. a page
   * reverted to a version predating a since-removed block type) is silently skipped
   * instead of failing the entire page.
   */
  async resolveRawBlocks(tenantId: string, raw: unknown): Promise<ResolvedPageBuilderBlock[]> {
    if (!Array.isArray(raw)) return [];
    const known: PageBuilderBlock[] = [];
    for (const item of raw) {
      const parsed = PageBuilderBlockSchema.safeParse(item);
      if (parsed.success) {
        known.push(parsed.data);
      } else {
        this.logger.warn(`[LiveCollectionResolver] Skipping unsupported/malformed stored block (Edge case #9): ${parsed.error.issues[0]?.message ?? "unknown error"}`);
      }
    }
    return this.resolveKnownBlocks(tenantId, known);
  }

  private async resolveOne(tenantId: string, block: PageBuilderBlock): Promise<ResolvedPageBuilderBlock> {
    if (block.type !== "live_collection_ref") {
      // Every non-reference block type has an IDENTICAL shape on the resolved union.
      return block;
    }
    const data: LiveCollectionRefBlockData = block.data;
    const resolvedItems = await this.resolveSelection(tenantId, data);
    return { type: "live_collection_ref", data: { ...data, resolvedItems } as ResolvedLiveCollectionRefBlockData };
  }

  private async resolveSelection(tenantId: string, data: LiveCollectionRefBlockData): Promise<unknown[]> {
    try {
      switch (data.collection) {
        case "testimonials":
          return await this.resolveTestimonials(tenantId, data.selection);
        case "partners":
          return await this.resolvePartners(tenantId, data.selection);
        case "programs":
          return await this.resolvePrograms(data.selection);
        case "mentors":
          return await this.resolveMentors(data.selection);
      }
    } catch (err) {
      // Resolution failures (deleted refs, a downstream service error) resolve to an
      // empty list — NEVER a 500 for the whole page (spec Edge cases #2/#3).
      this.logger.warn(`[LiveCollectionResolver] Resolution failed for collection="${data.collection}", resolving to empty list: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  private async resolveTestimonials(tenantId: string, selection: Extract<LiveCollectionRefBlockData, { collection: "testimonials" }>["selection"]): Promise<PublicTestimonial[]> {
    if (selection.mode === "manual") {
      const ids = selection.ids ?? [];
      if (ids.length === 0) return [];
      const rows = await this.testimonialsRepository.findManyPublishedByIds(tenantId, ids);
      const byId = new Map(rows.map((row) => [row.id, row]));
      // Missing/unpublished/deleted ids are silently dropped (Edge case #2) — preserve
      // the author's selected ORDER for the ids that DID resolve.
      const ordered = ids.map((id) => byId.get(id)).filter((row): row is TestimonialRow => row !== undefined);
      return ordered.slice(0, selection.limit).map(toPublicTestimonial);
    }
    const rows = await this.testimonialsRepository.listPublishedFiltered(tenantId, {
      programId: selection.programId,
      minRating: selection.minRating,
      limit: selection.limit,
      sort: selection.sort,
    });
    return rows.map(toPublicTestimonial);
  }

  private async resolvePartners(tenantId: string, selection: Extract<LiveCollectionRefBlockData, { collection: "partners" }>["selection"]) {
    const rows = await this.partnersRepository.listPublishedFiltered(tenantId, {
      category: selection.category,
      limit: selection.limit,
      sort: selection.sort,
    });
    return rows.map(toResolvedPartner);
  }

  private async resolvePrograms(selection: Extract<LiveCollectionRefBlockData, { collection: "programs" }>["selection"]): Promise<PublicProgramSummary[]> {
    // `categorySlug` maps to the public catalog's `domain` filter facet — the same
    // dimension `ExploreCourses` (web) already filters programs by.
    const { items } = await this.publicCatalogService.listPrograms({
      domain: selection.categorySlug,
      sort: selection.sort,
      limit: selection.limit,
    });
    return items;
  }

  private async resolveMentors(selection: Extract<LiveCollectionRefBlockData, { collection: "mentors" }>["selection"]): Promise<PublicMentorCard[]> {
    const { items } = await this.publicCatalogService.listMentors({ limit: selection.limit });
    return items;
  }
}
