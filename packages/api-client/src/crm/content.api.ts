// Typed headless-CMS admin SDK (CRM/staff surface) — Phase 9 Completion, T14/T22
// (docs/plans/phase-9-completion.md). Draft/publish CRUD for blog, testimonials,
// partners, faculty bios, content pages, plus newsletter/contact/career admin lists.
// Public read counterparts live on `client.public.content.*`.
// Exposed on the SDK as `client.crm.content.*` (nested, mirrors `client.crm.admin.*`).

import type {
  CreateBlogCategoryRequest,
  UpdateBlogCategoryRequest,
  BlogCategory,
  CreateBlogPostRequest,
  UpdateBlogPostRequest,
  ListBlogPostsQuery,
  BlogPostSummary,
  BlogPostDetail,
  CreateTestimonialRequest,
  UpdateTestimonialRequest,
  ListTestimonialsQuery,
  Testimonial,
  CreatePartnerRequest,
  UpdatePartnerRequest,
  ListPartnersQuery,
  Partner,
  // Colleges (Phase-11 locked templates, docs/plans/phase-11-locked-templates.md) — a
  // dedicated CRM screen over the SAME Partner model/table (category="college_partner").
  CreateCollegeRequest,
  UpdateCollegeRequest,
  ListCollegesQuery,
  College,
  DeleteCollegeResponse,
  CollegeLogoUploadUrlRequest,
  CreateFacultyBioRequest,
  UpdateFacultyBioRequest,
  ListFacultyBiosQuery,
  FacultyBio,
  CreateContentPageRequest,
  UpdateContentPageRequest,
  ListContentPagesQuery,
  ContentPageSummary,
  ContentPageDetail,
  // Phase-10 page builder (docs/specs/phase-10-page-builder.md)
  ContentPageBuilderDetail,
  CreateBuilderPageRequest,
  SaveBuilderPageRequest,
  PreviewBuilderPageRequest,
  PreviewBuilderPageResponse,
  ListContentPageVersionsQuery,
  ContentPageVersionSummary,
  ContentPageVersionDetail,
  RevertContentPageVersionRequest,
  ContentPageMediaUploadUrlRequest,
  SignedUploadResponse,
  ListNewsletterSubscriptionsQuery,
  NewsletterSubscription,
  UpdateContactSubmissionStatusRequest,
  ListContactSubmissionsQuery,
  ContactSubmission,
  UpdateCareerApplicationStatusRequest,
  ListCareerApplicationsQuery,
  CareerApplicationSummary,
  CareerApplicationDetail,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class BlogApi {
  constructor(private readonly client: ApiClient) {}

  async listCategories(): Promise<BlogCategory[]> {
    return this.client.request<BlogCategory[]>("GET", "/api/v1/crm/blog/categories");
  }
  async createCategory(body: CreateBlogCategoryRequest, idempotencyKey: string = crypto.randomUUID()): Promise<BlogCategory> {
    return this.client.request<BlogCategory>("POST", "/api/v1/crm/blog/categories", { body, idempotencyKey });
  }
  async updateCategory(id: string, body: UpdateBlogCategoryRequest, idempotencyKey: string = crypto.randomUUID()): Promise<BlogCategory> {
    return this.client.request<BlogCategory>("PATCH", `/api/v1/crm/blog/categories/${id}`, { body, idempotencyKey });
  }

  async listPosts(query: ListBlogPostsQuery) {
    return this.client.requestPaginated<BlogPostSummary>("GET", `/api/v1/crm/blog/posts${toQueryString(query)}`);
  }
  async getPost(id: string): Promise<BlogPostDetail> {
    return this.client.request<BlogPostDetail>("GET", `/api/v1/crm/blog/posts/${id}`);
  }
  async createPost(body: CreateBlogPostRequest, idempotencyKey: string = crypto.randomUUID()): Promise<BlogPostDetail> {
    return this.client.request<BlogPostDetail>("POST", "/api/v1/crm/blog/posts", { body, idempotencyKey });
  }
  async updatePost(id: string, body: UpdateBlogPostRequest, idempotencyKey: string = crypto.randomUUID()): Promise<BlogPostDetail> {
    return this.client.request<BlogPostDetail>("PATCH", `/api/v1/crm/blog/posts/${id}`, { body, idempotencyKey });
  }
  async removePost(id: string, idempotencyKey: string = crypto.randomUUID()): Promise<{ deleted: true }> {
    return this.client.request<{ deleted: true }>("DELETE", `/api/v1/crm/blog/posts/${id}`, { idempotencyKey });
  }
}

export class TestimonialsApi {
  constructor(private readonly client: ApiClient) {}

  async list(query: ListTestimonialsQuery) {
    return this.client.requestPaginated<Testimonial>("GET", `/api/v1/crm/testimonials${toQueryString(query)}`);
  }
  async create(body: CreateTestimonialRequest, idempotencyKey: string = crypto.randomUUID()): Promise<Testimonial> {
    return this.client.request<Testimonial>("POST", "/api/v1/crm/testimonials", { body, idempotencyKey });
  }
  async update(id: string, body: UpdateTestimonialRequest, idempotencyKey: string = crypto.randomUUID()): Promise<Testimonial> {
    return this.client.request<Testimonial>("PATCH", `/api/v1/crm/testimonials/${id}`, { body, idempotencyKey });
  }
  async remove(id: string, idempotencyKey: string = crypto.randomUUID()): Promise<{ deleted: true }> {
    return this.client.request<{ deleted: true }>("DELETE", `/api/v1/crm/testimonials/${id}`, { idempotencyKey });
  }
}

export class PartnersApi {
  constructor(private readonly client: ApiClient) {}

  async list(query: ListPartnersQuery) {
    return this.client.requestPaginated<Partner>("GET", `/api/v1/crm/partners${toQueryString(query)}`);
  }
  async create(body: CreatePartnerRequest, idempotencyKey: string = crypto.randomUUID()): Promise<Partner> {
    return this.client.request<Partner>("POST", "/api/v1/crm/partners", { body, idempotencyKey });
  }
  async update(id: string, body: UpdatePartnerRequest, idempotencyKey: string = crypto.randomUUID()): Promise<Partner> {
    return this.client.request<Partner>("PATCH", `/api/v1/crm/partners/${id}`, { body, idempotencyKey });
  }
  async remove(id: string, idempotencyKey: string = crypto.randomUUID()): Promise<{ deleted: true }> {
    return this.client.request<{ deleted: true }>("DELETE", `/api/v1/crm/partners/${id}`, { idempotencyKey });
  }
}

/**
 * Colleges (Phase-11 locked templates, docs/plans/phase-11-locked-templates.md). A
 * College is a `Partner` row (category="college_partner") on its OWN dedicated CRM
 * screen — mirrors the mentors/courses precedent of a purpose-built screen rather than
 * reusing `PartnersApi`'s generic hiring/tech-partner-logo CRUD, even though both talk to
 * the same underlying table. No public read method here: colleges surface on the site via
 * the EXISTING `client.public.content.partners.list({ category: "college_partner" })`
 * (see `PublicPartnersApi`/`content.api.ts`'s public section) through the page-builder's
 * `live_collection_ref` mechanism — there is no separate `/public/colleges` endpoint.
 */
export class CollegesApi {
  constructor(private readonly client: ApiClient) {}

  async list(query: ListCollegesQuery) {
    return this.client.requestPaginated<College>("GET", `/api/v1/crm/colleges${toQueryString(query)}`);
  }
  async create(body: CreateCollegeRequest, idempotencyKey: string = crypto.randomUUID()): Promise<College> {
    return this.client.request<College>("POST", "/api/v1/crm/colleges", { body, idempotencyKey });
  }
  async update(id: string, body: UpdateCollegeRequest, idempotencyKey: string = crypto.randomUUID()): Promise<College> {
    return this.client.request<College>("PATCH", `/api/v1/crm/colleges/${id}`, { body, idempotencyKey });
  }
  async remove(id: string, idempotencyKey: string = crypto.randomUUID()): Promise<DeleteCollegeResponse> {
    return this.client.request<DeleteCollegeResponse>("DELETE", `/api/v1/crm/colleges/${id}`, { idempotencyKey });
  }

  /**
   * POST /api/v1/crm/colleges/logo-upload-url — mint a short-lived signed PUT URL for a
   * college logo (raster only — no SVG, 5 MB cap). The caller PUTs the file directly to
   * `uploadUrl`, then embeds the returned `storageKey` as `logoKey` on create/update. Not
   * persistence — no idempotency key needed.
   */
  async logoUploadUrl(body: CollegeLogoUploadUrlRequest): Promise<SignedUploadResponse> {
    return this.client.request<SignedUploadResponse>("POST", "/api/v1/crm/colleges/logo-upload-url", { body });
  }
}

export class FacultyBiosApi {
  constructor(private readonly client: ApiClient) {}

  async list(query: ListFacultyBiosQuery) {
    return this.client.requestPaginated<FacultyBio>("GET", `/api/v1/crm/faculty-bios${toQueryString(query)}`);
  }
  async create(body: CreateFacultyBioRequest, idempotencyKey: string = crypto.randomUUID()): Promise<FacultyBio> {
    return this.client.request<FacultyBio>("POST", "/api/v1/crm/faculty-bios", { body, idempotencyKey });
  }
  async update(id: string, body: UpdateFacultyBioRequest, idempotencyKey: string = crypto.randomUUID()): Promise<FacultyBio> {
    return this.client.request<FacultyBio>("PATCH", `/api/v1/crm/faculty-bios/${id}`, { body, idempotencyKey });
  }
  async remove(id: string, idempotencyKey: string = crypto.randomUUID()): Promise<{ deleted: true }> {
    return this.client.request<{ deleted: true }>("DELETE", `/api/v1/crm/faculty-bios/${id}`, { idempotencyKey });
  }
}

export class ContentPagesApi {
  constructor(private readonly client: ApiClient) {}

  async list(query: ListContentPagesQuery) {
    return this.client.requestPaginated<ContentPageSummary>("GET", `/api/v1/crm/content-pages${toQueryString(query)}`);
  }
  /** GET /api/v1/crm/content-pages/:id — full row incl. body, for edit-form prefill. */
  async get(id: string): Promise<ContentPageDetail> {
    return this.client.request<ContentPageDetail>("GET", `/api/v1/crm/content-pages/${id}`);
  }
  async create(body: CreateContentPageRequest, idempotencyKey: string = crypto.randomUUID()): Promise<ContentPageDetail> {
    return this.client.request<ContentPageDetail>("POST", "/api/v1/crm/content-pages", { body, idempotencyKey });
  }
  async update(id: string, body: UpdateContentPageRequest, idempotencyKey: string = crypto.randomUUID()): Promise<ContentPageDetail> {
    return this.client.request<ContentPageDetail>("PATCH", `/api/v1/crm/content-pages/${id}`, { body, idempotencyKey });
  }
  async remove(id: string, idempotencyKey: string = crypto.randomUUID()): Promise<{ deleted: true }> {
    return this.client.request<{ deleted: true }>("DELETE", `/api/v1/crm/content-pages/${id}`, { idempotencyKey });
  }

  // ── Phase-10 page builder (docs/specs/phase-10-page-builder.md) ─────────────────────
  // super_admin-only (`content.builder`). Mutations on a builder-managed page ONLY go
  // through these methods, NEVER through create()/update()/remove() above — those stay on
  // the legacy generic-CMS surface (`content.create`/`.edit`/`.delete`).

  /** POST /api/v1/crm/content-pages/builder — create a new, empty (body=[]) builder page. */
  async createBuilderPage(body: CreateBuilderPageRequest, idempotencyKey: string = crypto.randomUUID()): Promise<ContentPageBuilderDetail> {
    return this.client.request<ContentPageBuilderDetail>("POST", "/api/v1/crm/content-pages/builder", { body, idempotencyKey });
  }

  /**
   * PUT /api/v1/crm/content-pages/:id/builder — save. `body.expectedVersion` MUST be the
   * `currentVersion` last loaded (0 if never saved); throws `ApiError` with `status: 409`
   * (`code: "content.builder.version_conflict"`) if someone else saved since — the caller
   * must reload and re-apply, never silently retry with a bumped version.
   */
  async saveBuilderPage(id: string, body: SaveBuilderPageRequest, idempotencyKey: string = crypto.randomUUID()): Promise<ContentPageBuilderDetail> {
    return this.client.request<ContentPageBuilderDetail>("PUT", `/api/v1/crm/content-pages/${id}/builder`, { body, idempotencyKey });
  }

  /** POST /api/v1/crm/content-pages/:id/preview — unsaved-edit preview, resolved server-side. Read-only (no idempotency key needed). */
  async previewBuilderPage(id: string, body: PreviewBuilderPageRequest): Promise<PreviewBuilderPageResponse> {
    return this.client.request<PreviewBuilderPageResponse>("POST", `/api/v1/crm/content-pages/${id}/preview`, { body });
  }

  /** GET /api/v1/crm/content-pages/:id/versions — newest-first, metadata only (no body). */
  async listVersions(id: string, query: ListContentPageVersionsQuery) {
    return this.client.requestPaginated<ContentPageVersionSummary>("GET", `/api/v1/crm/content-pages/${id}/versions${toQueryString(query)}`);
  }

  /** GET /api/v1/crm/content-pages/:id/versions/:version — full snapshot incl. body. */
  async getVersion(id: string, version: number): Promise<ContentPageVersionDetail> {
    return this.client.request<ContentPageVersionDetail>("GET", `/api/v1/crm/content-pages/${id}/versions/${version}`);
  }

  /**
   * POST /api/v1/crm/content-pages/:id/versions/:version/revert — reverts live content to
   * a prior version. Snapshots the CURRENT live state as a new version first (history is
   * append-only — AC 7). Same 409/`expectedVersion` contract as `saveBuilderPage()`.
   */
  async revertToVersion(
    id: string,
    version: number,
    body: RevertContentPageVersionRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<ContentPageBuilderDetail> {
    return this.client.request<ContentPageBuilderDetail>("POST", `/api/v1/crm/content-pages/${id}/versions/${version}/revert`, {
      body,
      idempotencyKey,
    });
  }

  /**
   * POST /api/v1/crm/content-pages/media-upload-url — mint a short-lived signed PUT URL
   * for a page-builder marketing image (raster only — no SVG, 5 MB cap). The caller PUTs
   * the file directly to `uploadUrl`, then embeds the returned `storageKey` in the
   * relevant block field before saving. Not persistence — no idempotency key needed.
   * Also reachable as `client.crm.contentPages.mediaUploadUrl(...)` (see crm/index.ts).
   */
  async mediaUploadUrl(body: ContentPageMediaUploadUrlRequest): Promise<SignedUploadResponse> {
    return this.client.request<SignedUploadResponse>("POST", "/api/v1/crm/content-pages/media-upload-url", { body });
  }
}

export class NewsletterAdminApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/newsletter-subscriptions */
  async list(query: ListNewsletterSubscriptionsQuery) {
    return this.client.requestPaginated<NewsletterSubscription>(
      "GET",
      `/api/v1/crm/newsletter-subscriptions${toQueryString(query)}`,
    );
  }
}

export class ContactAdminApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/contact-submissions */
  async list(query: ListContactSubmissionsQuery) {
    return this.client.requestPaginated<ContactSubmission>("GET", `/api/v1/crm/contact-submissions${toQueryString(query)}`);
  }

  /** PATCH /api/v1/crm/contact-submissions/:id */
  async updateStatus(
    id: string,
    body: UpdateContactSubmissionStatusRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<ContactSubmission> {
    return this.client.request<ContactSubmission>("PATCH", `/api/v1/crm/contact-submissions/${id}`, {
      body,
      idempotencyKey,
    });
  }
}

export class CareersAdminApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/career-applications */
  async list(query: ListCareerApplicationsQuery) {
    return this.client.requestPaginated<CareerApplicationSummary>(
      "GET",
      `/api/v1/crm/career-applications${toQueryString(query)}`,
    );
  }

  /** GET /api/v1/crm/career-applications/:id — includes a signed resume download URL. */
  async get(id: string): Promise<CareerApplicationDetail> {
    return this.client.request<CareerApplicationDetail>("GET", `/api/v1/crm/career-applications/${id}`);
  }

  /** PATCH /api/v1/crm/career-applications/:id */
  async updateStatus(
    id: string,
    body: UpdateCareerApplicationStatusRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<CareerApplicationDetail> {
    return this.client.request<CareerApplicationDetail>("PATCH", `/api/v1/crm/career-applications/${id}`, {
      body,
      idempotencyKey,
    });
  }
}

/** Nested namespace → `client.crm.content.blog` / `.testimonials` / `.partners` / etc. */
export class ContentApi {
  readonly blog: BlogApi;
  readonly testimonials: TestimonialsApi;
  readonly partners: PartnersApi;
  // Phase-11 locked templates — dedicated Colleges screen (Partner rows, category=
  // "college_partner"). Also aliased at `client.crm.colleges` (crm/index.ts), mirroring
  // the existing `client.crm.contentPages` alias for `content.pages`.
  readonly colleges: CollegesApi;
  readonly facultyBios: FacultyBiosApi;
  readonly pages: ContentPagesApi;
  readonly newsletter: NewsletterAdminApi;
  readonly contact: ContactAdminApi;
  readonly careers: CareersAdminApi;

  constructor(client: ApiClient) {
    this.blog = new BlogApi(client);
    this.testimonials = new TestimonialsApi(client);
    this.partners = new PartnersApi(client);
    this.colleges = new CollegesApi(client);
    this.facultyBios = new FacultyBiosApi(client);
    this.pages = new ContentPagesApi(client);
    this.newsletter = new NewsletterAdminApi(client);
    this.contact = new ContactAdminApi(client);
    this.careers = new CareersAdminApi(client);
  }
}
