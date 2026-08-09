// apps/api/src/modules/content/testimonials.service.ts
//
// Business logic for the headless CMS testimonials surface (docs/plans/phase-9-
// completion.md T22). No Prisma here (CLAUDE.md §3.3). Same scope=all-only + publish-gate
// conventions as blog.service.ts (see that file's header for the rationale). Testimonial
// content (studentName/quote) is CRM-authored, trusted input — no backend sanitization
// (ADR-0045, DOMPurify-at-render-sink).

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateTestimonialRequest, ListTestimonialsQuery, PublicTestimonial, Testimonial, UpdateTestimonialRequest } from "@repo/types";
import { TestimonialsRepository, type TestimonialRow, type PublishedTestimonialRow } from "./testimonials.repository";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext } from "../auth/lib/scope-context";
import { TENANT_SLUG, mintCdnUrl } from "./content.util";

@Injectable()
export class TestimonialsService {
  constructor(private readonly repository: TestimonialsRepository) {}

  private assertAllScope(): void {
    const scope = requireScopeContext();
    if (scope.scope !== "all") {
      throw new ForbiddenException({ code: "content.scope_unresolvable", title: "Scope not supported", detail: `The "${scope.scope}" data-scope is not resolvable for headless content.` });
    }
  }

  async list(tenantId: string, query: ListTestimonialsQuery): Promise<PaginatedResult<Testimonial>> {
    this.assertAllScope();
    const { rows, total } = await this.repository.list({ tenantId, programId: query.programId, status: query.status, page: query.page, pageSize: query.pageSize });
    return new PaginatedResult(rows.map(toDto), { page: query.page, pageSize: query.pageSize, total, hasMore: query.page * query.pageSize < total });
  }

  async create(tenantId: string, body: CreateTestimonialRequest): Promise<Testimonial> {
    this.assertAllScope();
    // publish gate: create() never directly publishes — see blog.service.ts file header.
    const status = body.status === "published" ? "draft" : body.status;
    const created = await this.repository.create(tenantId, {
      programId: body.programId ?? null,
      studentName: body.studentName,
      studentPhotoKey: body.studentPhotoKey ?? null,
      quote: body.quote,
      rating: body.rating ?? null,
      status,
      order: body.order,
    });
    const row = await this.repository.findById(tenantId, created.id);
    if (!row) throw new NotFoundException({ code: "content.not_found", title: "Testimonial not found after creation" });
    return toDto(row);
  }

  async update(tenantId: string, id: string, body: UpdateTestimonialRequest): Promise<Testimonial> {
    this.assertAllScope();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "content.not_found", title: "Testimonial not found" });
    // Publishing is POST :id/publish, never a PATCH — see the publish-gate note in
    // blog.service.ts's header. This USED to be a silent no-op (the `status` key was just
    // dropped from the patch), which meant the CRM could send status:"published", get a
    // 200 and a "Testimonial updated" toast, and leave the row a draft that never reached
    // the site. Failing loudly is the fix: a caller that means to publish must say so.
    if (body.status === "published") {
      throw new BadRequestException({
        code: "content.publish_requires_publish_endpoint",
        title: "Use the publish endpoint",
        detail: 'A testimonial cannot be published via PATCH. Call POST /crm/testimonials/{id}/publish instead.',
      });
    }
    await this.repository.update(id, {
      ...(body.programId !== undefined ? { programId: body.programId } : {}),
      ...(body.studentName !== undefined ? { studentName: body.studentName } : {}),
      ...(body.studentPhotoKey !== undefined ? { studentPhotoKey: body.studentPhotoKey } : {}),
      ...(body.quote !== undefined ? { quote: body.quote } : {}),
      ...(body.rating !== undefined ? { rating: body.rating } : {}),
      ...(body.order !== undefined ? { order: body.order } : {}),
      // "published" is already rejected above, so this only ever carries draft/archived —
      // i.e. UNPUBLISHING (hiding a live testimonial) is a normal patch, publishing is not.
      ...(body.status !== undefined ? { status: body.status } : {}),
    });
    const updated = await this.repository.findById(tenantId, id);
    if (!updated) throw new NotFoundException({ code: "content.not_found", title: "Testimonial not found after update" });
    return toDto(updated);
  }

  async publish(tenantId: string, id: string): Promise<Testimonial> {
    this.assertAllScope();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "content.not_found", title: "Testimonial not found" });
    await this.repository.update(id, { status: "published" });
    const updated = await this.repository.findById(tenantId, id);
    if (!updated) throw new NotFoundException({ code: "content.not_found", title: "Testimonial not found after publish" });
    return toDto(updated);
  }

  async softDelete(tenantId: string, id: string): Promise<void> {
    this.assertAllScope();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "content.not_found", title: "Testimonial not found" });
    await this.repository.softDelete(id);
  }

  async listPublic(programId?: string): Promise<PublicTestimonial[]> {
    const tenantId = await this.repository.getTenantIdBySlug(TENANT_SLUG);
    if (!tenantId) throw new NotFoundException({ code: "content.tenant_not_found", title: "Tenant not found" });
    const rows = await this.repository.listPublished(tenantId, programId);
    return rows.map(toPublicDto);
  }
}

function toDto(row: TestimonialRow): Testimonial {
  return {
    id: row.id,
    programId: row.programId,
    studentName: row.studentName,
    studentPhotoUrl: mintCdnUrl(row.studentPhotoKey),
    quote: row.quote,
    rating: row.rating,
    status: row.status,
    order: row.order,
    createdAt: row.createdAt.toISOString(),
  };
}

function toPublicDto(row: PublishedTestimonialRow): PublicTestimonial {
  return {
    id: row.id,
    studentName: row.studentName,
    studentPhotoUrl: mintCdnUrl(row.studentPhotoKey),
    quote: row.quote,
    rating: row.rating,
    programTitle: row.programTitle,
  };
}
