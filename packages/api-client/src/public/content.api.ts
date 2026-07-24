// Typed headless-CMS public-read SDK — Phase 9 Completion, T14/T22/T32
// (docs/plans/phase-9-completion.md). Published-only projections; admin CRUD lives on
// `client.crm.content.*`. Exposed on the SDK as `client.public.content.*` (nested).

import type {
  ListPublicBlogPostsQuery,
  PublicBlogPostSummary,
  PublicBlogPostDetail,
  ListPublicTestimonialsQuery,
  PublicTestimonial,
  PublicPartner,
  PublicFacultyBio,
  PublicContentPage,
  ListPublicKbArticlesQuery,
  PublicKbArticleSummary,
  PublicKbArticleDetail,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class PublicBlogApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/public/blog/posts — cursor-paginated. */
  async list(query?: Partial<ListPublicBlogPostsQuery>) {
    return this.client.requestCursorPaginated<PublicBlogPostSummary>(
      "GET",
      `/api/v1/public/blog/posts${toQueryString(query ?? {})}`,
    );
  }

  /** GET /api/v1/public/blog/posts/:slug */
  async getBySlug(slug: string): Promise<PublicBlogPostDetail> {
    return this.client.request<PublicBlogPostDetail>("GET", `/api/v1/public/blog/posts/${encodeURIComponent(slug)}`);
  }
}

export class PublicTestimonialsApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/public/testimonials — small non-paginated list. */
  async list(query?: ListPublicTestimonialsQuery): Promise<PublicTestimonial[]> {
    return this.client.request<PublicTestimonial[]>("GET", `/api/v1/public/testimonials${toQueryString(query ?? {})}`);
  }
}

export class PublicPartnersApi {
  constructor(private readonly client: ApiClient) {}

  /**
   * GET /api/v1/public/partners — small non-paginated list. `category` is how colleges
   * surface publicly (Phase-11 locked templates, docs/plans/phase-11-locked-templates.md):
   * pass `{ category: "college_partner" }` to fetch ONLY college rows — there is no
   * separate `/public/colleges` endpoint, admin CRUD for those lives on
   * `client.crm.colleges`/`client.crm.content.colleges`.
   */
  async list(query?: { category?: string }): Promise<PublicPartner[]> {
    return this.client.request<PublicPartner[]>("GET", `/api/v1/public/partners${toQueryString(query ?? {})}`);
  }
}

export class PublicFacultyBiosApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/public/faculty-bios — small non-paginated list. */
  async list(): Promise<PublicFacultyBio[]> {
    return this.client.request<PublicFacultyBio[]>("GET", "/api/v1/public/faculty-bios");
  }
}

export class PublicPagesApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/public/pages/:slug */
  async getBySlug(slug: string): Promise<PublicContentPage> {
    return this.client.request<PublicContentPage>("GET", `/api/v1/public/pages/${encodeURIComponent(slug)}`);
  }
}

export class PublicKbArticlesApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/public/kb-articles — cursor-paginated help-center article list. */
  async list(query?: Partial<ListPublicKbArticlesQuery>) {
    return this.client.requestCursorPaginated<PublicKbArticleSummary>(
      "GET",
      `/api/v1/public/kb-articles${toQueryString(query ?? {})}`,
    );
  }

  /** GET /api/v1/public/kb-articles/:slug */
  async getBySlug(slug: string): Promise<PublicKbArticleDetail> {
    return this.client.request<PublicKbArticleDetail>("GET", `/api/v1/public/kb-articles/${encodeURIComponent(slug)}`);
  }
}

/** Nested namespace → `client.public.content.blog` / `.testimonials` / `.partners` / etc. */
export class PublicContentApi {
  readonly blog: PublicBlogApi;
  readonly testimonials: PublicTestimonialsApi;
  readonly partners: PublicPartnersApi;
  readonly facultyBios: PublicFacultyBiosApi;
  readonly pages: PublicPagesApi;
  readonly kbArticles: PublicKbArticlesApi;

  constructor(client: ApiClient) {
    this.blog = new PublicBlogApi(client);
    this.testimonials = new PublicTestimonialsApi(client);
    this.partners = new PublicPartnersApi(client);
    this.facultyBios = new PublicFacultyBiosApi(client);
    this.pages = new PublicPagesApi(client);
    this.kbArticles = new PublicKbArticlesApi(client);
  }
}
