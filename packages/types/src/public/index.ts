// Public surface DTOs — Phase 5, Wave 2 (docs/plans/phase-5.md task #2).
//
// These schemas define the contracts for ALL new public (unauthenticated or
// self-service-authenticated) endpoints introduced in P5. They are consumed by:
//   - Backend (NestJS validation pipe): ZodValidationPipe uses these as input guards.
//   - Frontend (forms + api-client): react-hook-form resolvers + @repo/api-client
//     public namespace methods are typed against these.
//
// Namespace layout:
//   public/programs.schemas.ts  → PublicProgramSummary, PublicProgramDetail,
//                                  ListPublicProgramsQuery, sub-DTOs
//   public/leads.schemas.ts     → PublicLeadCaptureDto, PublicConsentSchema
//   public/coupons.schemas.ts   → PublicValidateCouponDto, PublicCouponDiscountResponse
//   public/auth.schemas.ts      → PublicRegisterDto
//   public/enroll.schemas.ts    → PublicCreateOrderDto, PublicCheckoutDto,
//                                  PublicCheckoutResponse, PublicVerifyPaymentDto,
//                                  PublicVerifyPaymentResponse, PublicOrderResponse
//
// REUSED existing DTOs (not redefined here):
//   CreatePublicBookingRequestSchema  (crm/bookings.schemas.ts — P2, reused as-is)
//   PublicBookingResponseSchema       (crm/bookings.schemas.ts — P2, reused as-is)
//   VerifyPaymentRequestSchema        (commerce/payments.schemas.ts — reused as
//                                      PublicVerifyPaymentDtoSchema type alias)
//
// Projection safety:
//   Compile-time type assertions in programs.schemas.ts and enroll.schemas.ts
//   prove that forbidden fields (tenantId, status, isPublic, ogImageKey, storageKey,
//   providerAssetId, answerKey, cost, margin, keySecret, etc.) CANNOT appear in
//   any public-facing response DTO.

export * from "./programs.schemas.js";
export * from "./mentors.schemas.js";
export * from "./leads.schemas.js";
export * from "./coupons.schemas.js";
export * from "./auth.schemas.js";
export * from "./enroll.schemas.js";
export * from "./analytics.schemas.js";
// Composed public global-search DTO (Phase 9 Completion T30 follow-up) — no dedicated
// backend route; @repo/api-client composes it from GET /public/programs + GET
// /public/blog/posts. See search.schemas.ts file header.
export * from "./search.schemas.js";
