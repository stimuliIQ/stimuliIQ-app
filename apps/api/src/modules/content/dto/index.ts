// apps/api/src/modules/content/dto/index.ts
//
// Re-exports the Phase-9 headless-CMS zod schemas from @repo/types (docs/04-trd-
// architecture.md §2.2 module template). Never redeclare a shape here — single source of
// truth stays in packages/types/src/content/*.schemas.ts.

export { ContentStatusSchema, type ContentStatus } from "@repo/types";

export {
  CreateBlogCategoryRequestSchema,
  type CreateBlogCategoryRequest,
  UpdateBlogCategoryRequestSchema,
  type UpdateBlogCategoryRequest,
  BlogCategorySchema,
  type BlogCategory,
  CreateBlogPostRequestSchema,
  type CreateBlogPostRequest,
  UpdateBlogPostRequestSchema,
  type UpdateBlogPostRequest,
  ListBlogPostsQuerySchema,
  type ListBlogPostsQuery,
  BlogPostSummarySchema,
  type BlogPostSummary,
  BlogPostDetailSchema,
  type BlogPostDetail,
  ListPublicBlogPostsQuerySchema,
  type ListPublicBlogPostsQuery,
  PublicBlogPostSummarySchema,
  type PublicBlogPostSummary,
  PublicBlogPostDetailSchema,
  type PublicBlogPostDetail,
} from "@repo/types";

export {
  CreateTestimonialRequestSchema,
  type CreateTestimonialRequest,
  UpdateTestimonialRequestSchema,
  type UpdateTestimonialRequest,
  ListTestimonialsQuerySchema,
  type ListTestimonialsQuery,
  TestimonialSchema,
  type Testimonial,
  ListPublicTestimonialsQuerySchema,
  type ListPublicTestimonialsQuery,
  PublicTestimonialSchema,
  type PublicTestimonial,
} from "@repo/types";

export {
  CreatePartnerRequestSchema,
  type CreatePartnerRequest,
  UpdatePartnerRequestSchema,
  type UpdatePartnerRequest,
  ListPartnersQuerySchema,
  type ListPartnersQuery,
  PartnerSchema,
  type Partner,
  PublicPartnerSchema,
  type PublicPartner,
} from "@repo/types";

// Colleges — Phase-11 locked templates (docs/plans/phase-11-locked-templates.md). A
// dedicated CRM screen over the SAME `Partner` model/table (category="college_partner"),
// distinct from the generic hiring/tech partner CRUD above.
export {
  CreateCollegeRequestSchema,
  type CreateCollegeRequest,
  UpdateCollegeRequestSchema,
  type UpdateCollegeRequest,
  ListCollegesQuerySchema,
  type ListCollegesQuery,
  CollegeSchema,
  type College,
  DeleteCollegeResponseSchema,
  type DeleteCollegeResponse,
  CollegeLogoUploadUrlRequestSchema,
  type CollegeLogoUploadUrlRequest,
} from "@repo/types";

export {
  FacultyBioSocialLinksSchema,
  type FacultyBioSocialLinks,
  CreateFacultyBioRequestSchema,
  type CreateFacultyBioRequest,
  UpdateFacultyBioRequestSchema,
  type UpdateFacultyBioRequest,
  ListFacultyBiosQuerySchema,
  type ListFacultyBiosQuery,
  FacultyBioSchema,
  type FacultyBio,
  PublicFacultyBioSchema,
  type PublicFacultyBio,
} from "@repo/types";

export {
  ContentBlockSchema,
  type ContentBlock,
  CreateContentPageRequestSchema,
  type CreateContentPageRequest,
  UpdateContentPageRequestSchema,
  type UpdateContentPageRequest,
  ListContentPagesQuerySchema,
  type ListContentPagesQuery,
  ContentPageSummarySchema,
  type ContentPageSummary,
  ContentPageDetailSchema,
  type ContentPageDetail,
  PublicContentPageSchema,
  type PublicContentPage,
} from "@repo/types";

// Phase-10 page builder (docs/specs/phase-10-page-builder.md) — block registry + builder
// CRUD/version-history/preview contracts.
export {
  PageBuilderBlockTypeSchema,
  type PageBuilderBlockType,
  PageBuilderBlockSchema,
  type PageBuilderBlock,
  ResolvedPageBuilderBlockSchema,
  type ResolvedPageBuilderBlock,
  IconKeySchema,
  type IconKey,
} from "@repo/types";

export {
  ContentPageBuilderDetailSchema,
  type ContentPageBuilderDetail,
  CreateBuilderPageRequestSchema,
  type CreateBuilderPageRequest,
  SaveBuilderPageRequestSchema,
  type SaveBuilderPageRequest,
  PreviewBuilderPageRequestSchema,
  type PreviewBuilderPageRequest,
  PreviewBuilderPageResponseSchema,
  type PreviewBuilderPageResponse,
  ListContentPageVersionsQuerySchema,
  type ListContentPageVersionsQuery,
  ContentPageVersionSummarySchema,
  type ContentPageVersionSummary,
  ContentPageVersionDetailSchema,
  type ContentPageVersionDetail,
  RevertContentPageVersionRequestSchema,
  type RevertContentPageVersionRequest,
} from "@repo/types";

// Marketing image uploads for page-builder blocks (mirrors CoursesModule/MentorsModule's
// image/photo-upload-url contracts) — signed-URL response type re-exported from
// learning/storage.schemas.ts.
export {
  ContentPageMediaUploadUrlRequestSchema,
  type ContentPageMediaUploadUrlRequest,
  type SignedUploadResponse,
} from "@repo/types";

// Phase-10 page builder — SiteSetting (nav/footer/SEO/contact/stats primitives).
export {
  SiteSettingKeySchema,
  type SiteSettingKey,
  SiteSettingGroupSchema,
  type SiteSettingGroup,
  SiteSettingValueSchemaByKey,
  ListSiteSettingsQuerySchema,
  type ListSiteSettingsQuery,
  SiteSettingSchema,
  type SiteSetting,
  UpsertSiteSettingRequestSchema,
  type UpsertSiteSettingRequest,
  PublicSiteSettingsResponseSchema,
  type PublicSiteSettingsResponse,
} from "@repo/types";

export {
  SubscribeNewsletterRequestSchema,
  type SubscribeNewsletterRequest,
  SubscribeNewsletterResponseSchema,
  type SubscribeNewsletterResponse,
  UnsubscribeNewsletterQuerySchema,
  type UnsubscribeNewsletterQuery,
  ListNewsletterSubscriptionsQuerySchema,
  type ListNewsletterSubscriptionsQuery,
  NewsletterSubscriptionSchema,
  type NewsletterSubscription,
} from "@repo/types";

export {
  ContactSubmissionStatusSchema,
  type ContactSubmissionStatus,
  SubmitContactRequestSchema,
  type SubmitContactRequest,
  SubmitContactResponseSchema,
  type SubmitContactResponse,
  UpdateContactSubmissionStatusRequestSchema,
  type UpdateContactSubmissionStatusRequest,
  ListContactSubmissionsQuerySchema,
  type ListContactSubmissionsQuery,
  ContactSubmissionSchema,
  type ContactSubmission,
} from "@repo/types";

export {
  CareerApplicationStatusSchema,
  type CareerApplicationStatus,
  SubmitCareerApplicationRequestSchema,
  type SubmitCareerApplicationRequest,
  SubmitCareerApplicationResponseSchema,
  type SubmitCareerApplicationResponse,
  UpdateCareerApplicationStatusRequestSchema,
  type UpdateCareerApplicationStatusRequest,
  ListCareerApplicationsQuerySchema,
  type ListCareerApplicationsQuery,
  CareerApplicationSummarySchema,
  type CareerApplicationSummary,
  CareerApplicationDetailSchema,
  type CareerApplicationDetail,
  PublicCareerResumeUploadUrlRequestSchema,
  type PublicCareerResumeUploadUrlRequest,
  PublicCareerResumeUploadUrlResponseSchema,
  type PublicCareerResumeUploadUrlResponse,
} from "@repo/types";
