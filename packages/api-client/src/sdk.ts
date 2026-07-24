// Top-level SDK factory. Apps construct one client instance at bootstrap
// (web/lms/crm each create their own with their own baseUrl + onUnauthorized
// wiring) and import resource APIs off it — never raw fetch.
//
// Phase 2 (docs/plans/phase-2.md task #2): `client.commerce.*` added alongside
// the existing `client.crm.*` (which now also includes leads/activities/bookings).
// Phase 3 (docs/plans/phase-3.md task #2): `client.lms.*` added for the LMS
// student surface (dashboard/enrollments/curriculum/lessons/stream-url/progress/attendance).
// Phase 4 (docs/plans/phase-4.md task #2): `client.learning.*` added for Learning Depth
// (assignments+projects+submissions, assessments+attempts, certificates+verify, storage).
// Phase 5 (docs/plans/phase-5.md task #2): `client.public.*` added for the marketing
// website public surface (programs catalog, lead capture, coupon validate, self-service
// registration, enrollment funnel, and book-slot intake). Anonymous + own-scoped endpoints.
// Phase 6 (docs/plans/phase-6.md task #2): `client.engagement.*` added for the Engagement
// workstreams (notifications, campaigns, gamification, forum).

import { ApiClient, type ApiClientConfig } from "./http/client.js";
import { AuthApi } from "./auth/auth.api.js";
import { CrmApi } from "./crm/index.js";
import { CommerceApi } from "./commerce/index.js";
import { LmsApi } from "./lms/index.js";
import { LearningApi } from "./learning/index.js";
import { PublicApi } from "./public/index.js";
import { EngagementApi } from "./engagement/index.js";
import { HealthApi } from "./health/health.api.js";

export class StimuliiqApiClient {
  readonly auth: AuthApi;
  readonly crm: CrmApi;
  readonly commerce: CommerceApi;
  /** LMS student surface — dashboard, enrollments, curriculum, lessons, stream-url, progress, attendance. */
  readonly lms: LmsApi;
  /**
   * Learning depth (Phase 4) — assignments+projects+submissions, assessments+attempts,
   * certificates (issue/revoke/reissue/verify), storage signed upload/download.
   *
   * Key contracts:
   *   - `client.learning.assessments.startAttempt()` returns questions WITHOUT answer keys.
   *   - `client.learning.certificates.verify(certUid)` is PUBLIC (no auth) + rate-limited +
   *     returns minimal VerifyResult (no PII beyond holderName).
   *   - `client.learning.certificates.getDownloadUrl(id)` returns a signed URL (never raw bucket URL).
   *   - `client.learning.assignments.gradeSubmission()` is audited with before/after.
   *   - `client.learning.certificates.issue()` runs eligibility engine server-side.
   */
  readonly learning: LearningApi;
  /**
   * Public marketing + enrollment funnel surface (Phase 5).
   *
   * Key contracts:
   *   - `client.public.programs.list()` returns ONLY is_public=true + published programs
   *     with the public projection (no status/isPublic/ogImageKey/tenantId/PII).
   *   - `client.public.programs.getBySlug(slug)` returns 404 for draft/non-public programs.
   *   - `client.public.leads.capture()` is captcha-gated + rate-limited (fail-closed in prod).
   *   - `client.public.coupons.validate()` returns display-safe paise amounts ONLY
   *     (no coupon internals — id/max_uses/used/program_scope never in response).
   *   - `client.public.auth.register()` is enumeration-resistant (AC-13).
   *   - `client.public.enroll.checkout()` returns PUBLIC keyId ONLY (never keySecret — AC-41).
   *   - `client.public.enroll.verify()` is idempotent (replay → no double-enrollment — AC-18).
   *   - All enroll.* methods are own-scoped (IDOR → 404 — AC-22).
   */
  readonly public: PublicApi;
  /**
   * Engagement surface (Phase 6) — notifications, campaigns, gamification, forum.
   *
   * Namespace layout:
   *   client.engagement.notifications.*  — in-app center, SSE stream, prefs/quiet-hours, unsubscribe.
   *   client.engagement.campaigns.*      — template CRUD, campaign CRUD, send/pause/cancel,
   *                                        recipient tracking, aggregate metrics.
   *   client.engagement.gamification.*  — own points/badges/streak summary, leaderboard (PII-minimal).
   *   client.engagement.forum.*          — threads/posts/nested-replies, upvote, resolve, moderate.
   *
   * Key cross-cutting contracts:
   *   - All own-scope endpoints derive userId from session; never from request body.
   *   - Forum + leaderboard endpoints are enrollment-scoped (IDOR → 404 for non-enrolled, AC-52, AC-55).
   *   - Faculty moderation is assigned-scope (IDOR → 404 for non-assigned batches, AC-64).
   *   - `client.engagement.notifications.openStream(baseUrl)` returns EventSource (browser-only).
   *     Polling fallback: `client.engagement.notifications.list({ unread: 'true' })` (LOCK-D3).
   *   - DLT compliance: `campaigns.createTemplate({ channel: 'sms', dlt_template_id: '...' })`
   *     — dlt_template_id is REQUIRED for sms/whatsapp (LOCK-D4, AC-78).
   *   - Leaderboard entries have NO email/phone/enrollmentId/userId (LOCK-D5; compile-time asserted).
   *   - No provider API keys/secrets in any response (compile-time asserted in @repo/types).
   *   - Consent gate for campaigns is non-bypassable (marketing_opt_in=true only, AC-42, Rule C-1).
   *   - Public unsubscribe uses skipAuthRefresh (signed HMAC token, no session, AC-22).
   */
  readonly engagement: EngagementApi;
  /**
   * Health/readiness (Phase 7) — PUBLIC, unauthenticated liveness/readiness
   * probes (AC-41/AC-42). `client.health.liveness()` / `client.health.readiness()`
   * use the raw (non-enveloped) fetch path — see health/health.api.ts.
   */
  readonly health: HealthApi;
  private readonly client: ApiClient;

  constructor(config: ApiClientConfig) {
    this.client = new ApiClient(config);
    this.auth = new AuthApi(this.client);
    this.crm = new CrmApi(this.client);
    this.commerce = new CommerceApi(this.client);
    this.lms = new LmsApi(this.client);
    this.learning = new LearningApi(this.client);
    this.public = new PublicApi(this.client);
    this.engagement = new EngagementApi(this.client);
    this.health = new HealthApi(this.client);
  }
}

export function createApiClient(config: ApiClientConfig): StimuliiqApiClient {
  return new StimuliiqApiClient(config);
}
