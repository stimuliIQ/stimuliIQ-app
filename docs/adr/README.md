# Architecture Decision Records

Each ADR documents a notable, hard-to-reverse decision made while building
stimuliiq, with context, the decision, consequences, and alternatives considered.
Once written, an ADR is not edited to reflect later reversals — a decision that gets
superseded gets a *new* ADR that references the old one and changes the old one's
status to `superseded`.

| ADR | Title | Status |
|---|---|---|
| [0001](./0001-uuid-v4-primary-keys.md) | UUID v4 primary keys on every table | Accepted |
| [0002](./0002-cookie-csrf-auth-transport.md) | httpOnly cookies + CSRF double-submit for auth transport | Accepted |
| [0003](./0003-jwt-rs256-rotating-refresh.md) | RS256 JWTs with rotating, single-use refresh tokens and family reuse-detection | Accepted |
| [0004](./0004-openapi-from-zod-handtyped-client.md) | OpenAPI derived from zod; hand-typed `@repo/api-client` | Accepted |
| [0005](./0005-soft-delete-audit-prisma-extensions.md) | Soft-delete and audit as composed Prisma client extensions with an ALS request-context seam | Accepted |
| [0006](./0006-provider-interface-pattern-sms.md) | `SmsProvider` interface with a stub MSG91 adapter in Phase 0 | Accepted |
| [0007](./0007-student-faculty-as-profile-extensions.md) | Student and faculty modeled as 1:1 profile extensions of users | Accepted |
| [0008](./0008-enrollment-roster-only-hard-restore.md) | Enrollment as a roster-only join with hard-restore on re-enroll | Accepted |
| [0009](./0009-data-scope-resolution-strategy.md) | Data-scope resolution via ScopeInterceptor, fail-closed guards, and EnrollmentScopeRepository — faculty grading predicate deferral resolved in ADR-0031 | Accepted |
| [0010](./0010-permission-matrix-full-replace-put.md) | Permission-matrix full-replace PUT, privilege-escalation guard, and raw-SQL hard-delete in replaceGrants | Accepted |
| [0011](./0011-zodvalidationpipe-metadata-type-discriminator.md) | ZodValidationPipe metadata-type discriminator to skip custom/param arguments | Accepted |
| [0012](./0012-datatable-virtualization-deferred.md) | DataTable row virtualization deferred behind a documented seam | Accepted |
| [0013](./0013-payment-provider-interface-razorpay.md) | PaymentProvider behind DI interface — Razorpay via built-in fetch + node:crypto, lazy key validation | Accepted |
| [0014](./0014-payment-idempotency-and-enrollment-atomicity.md) | Payment idempotency and order-to-enrollment atomicity | Accepted |
| [0015](./0015-ledger-as-source-of-truth-reconciliation-semantics.md) | Payments ledger as source of truth; reconciliation semantics (gross captured minus processed refunds) | Accepted |
| [0016](./0016-invoice-sequential-numbering-advisory-lock.md) | Invoice sequential numbering via per-tenant pg_advisory_xact_lock | Accepted |
| [0017](./0017-enrollment-commerce-linkage.md) | Enrollment commerce-linkage (order_id + source; money single-sourced on orders/payments) | Accepted |
| [0018](./0018-leads-scope-owner-id-fail-closed.md) | Lead own/assigned scope via owner_id — fail-closed, IDOR returns 404 | Accepted |
| [0019](./0019-public-booking-intake-endpoint.md) | Public unauthenticated booking-intake endpoint | Accepted |
| [0020](./0020-invoice-gen-webhook-sync-with-seam.md) | Invoice generation and webhook processing via SYNC-with-seam (BullMQ deferred behind ports) | Accepted |
| [0021](./0021-signed-short-ttl-per-user-hls-delivery.md) | Signed short-TTL per-user HLS delivery | Accepted |
| [0022](./0022-enrollment-scope-gate-idor-404-preview-bypass.md) | Enrollment-scope gate, IDOR→404, and preview-bypass | Accepted |
| [0023](./0023-video-provider-di-use-factory.md) | VideoProvider DI via `useFactory` (not `useClass`) | Accepted |
| [0024](./0024-progress-write-path-non-audited-pings-vs-audited-completion.md) | Progress write path — non-audited `baseClient` for high-frequency pings vs audited `client` for completion | Accepted |
| [0025](./0025-hand-written-pwa-no-next-pwa-workbox.md) | Hand-written PWA (no next-pwa / Workbox) | Accepted |
| [0026](./0026-video-player-engine-seam-native-hls-only-p3.md) | VideoPlayer engine seam — native HLS only in P3 | Accepted |
| [0027](./0027-storage-provider-interface-noop-fail-closed.md) | StorageProvider interface, Noop, fail-closed, and `useFactory` binding (S3/R2 behind one adapter) | Accepted |
| [0028](./0028-cert-uid-hmac-signed-public-verify.md) | Certificate `cert_uid` as HMAC-SHA256 signed token; public verify recomputes signature | Accepted |
| [0029](./0029-certificate-pdf-port-react-pdf-renderer-v3-pin.md) | CertificatePdfPort seam (sync adapter now, BullMQ cert worker deferred) and `@react-pdf/renderer` v3 pin | Accepted |
| [0030](./0030-answer-key-column-isolation.md) | Answer-key column isolation via child table and student DTO structural omission | Accepted |
| [0031](./0031-faculty-assigned-scope-grading-resolution.md) | Faculty `assigned`-scope grading resolved via enrollment→batch→faculty_id (supersedes ADR-0009 deferral) | Accepted |
| [0032](./0032-assessment-integrity-server-timebox-basics-anticheat.md) | Assessment integrity — server-authoritative time-box, attempts enforcement, idempotent submit, basics-only anti-cheat | Accepted |
| [0033](./0033-project-as-assignment-kind-with-milestones.md) | Project modeled as `assignment.kind=project` with `assignment_milestones` child rows | Accepted |
| [0034](./0034-public-marketing-api-surface.md) | Public marketing API surface — read-mostly endpoints reusing P1/P2 service engines | Accepted |
| [0035](./0035-mdx-git-as-cms-content-decision.md) | MDX / Git-as-CMS for marketing and blog content | Superseded by 0059 |
| [0036](./0036-captcha-analytics-provider-interfaces.md) | CaptchaProvider (Cloudflare Turnstile) and consent-gated AnalyticsProvider seams | Accepted |
| [0037](./0037-seo-system-json-ld-vercel-lighthouse-ci.md) | SEO system — single `escapeJsonLd` choke-point, dynamic sitemap/robots, structured data, Vercel deploy + Lighthouse/axe CI gates | Accepted |
| [0038](./0038-public-self-service-registration-c1-fix.md) | Public self-service registration (`POST /public/register`) and C-1 account-takeover fix | Accepted |
| [0039](./0039-p6-sync-seam-notification-campaign-dispatch.md) | P6 notification/campaign dispatch via sync-seam (extends ADR-0020) — BullMQ deferred | Accepted |
| [0040](./0040-mail-whatsapp-provider-interfaces.md) | MailProvider (Resend) and WhatsAppProvider (WhatsApp Cloud API) interfaces — Noop-by-default, fail-closed in prod | Accepted |
| [0041](./0041-dlt-consent-gating-sms-whatsapp-campaigns.md) | India DLT/consent gating for SMS/WhatsApp campaigns — enforced at three layers | Accepted |
| [0042](./0042-unsubscribe-token-hmac-signing.md) | Unsubscribe token as HMAC-SHA256 with constant-time verify, fail-closed signing secret | Accepted |
| [0043](./0043-sse-polling-fallback-realtime-notifications.md) | SSE + polling fallback for real-time notification delivery | Accepted |
| [0044](./0044-gamification-append-only-ledger-idempotent-awards.md) | Gamification append-only points ledger with partial-unique dedupe for idempotent awards | Accepted |
| [0045](./0045-forum-enrollment-scope-dompurify-render-sink-control.md) | Forum enrollment-scoped access (IDOR→404) with DOMPurify-at-render-sink as the XSS control | Accepted |
| [0046](./0046-analytics-read-model-materialized-views-cache-aside.md) | Analytics read model — materialized views + Redis cache-aside; read replica deferred | Accepted |
| [0047](./0047-observability-sentry-otel-pino-activation.md) | Observability activation — Sentry SaaS + hosted OTel collector + pino, no-op-safe by default | Accepted |
| [0048](./0048-nestjs-schedule-cron-mv-refresh-report-dispatch.md) | Scheduling via `@nestjs/schedule` cron (no BullMQ) for MV refresh + report dispatch | Accepted |
| [0049](./0049-dpdp-erasure-write-time-masking-and-anonymization-job.md) | DPDP erasure — write-time PII masking in the audit extension + privileged historical-row anonymization job | Accepted |
| [0050](./0050-security-hardening-rate-limiting-jwt-aud-enumeration-argon2.md) | Security hardening batch — IP rate limiting, webhook freshness/monotonicity, JWT `aud`, enumeration resistance, pinned argon2id | Accepted |
| [0051](./0051-csv-safe-cell-choke-point-scoped-exports-durable-jobs.md) | CSV-injection-safe exports — single `csvSafeCell()` choke-point, scope-pinned queries, durable `export_jobs`/`report_schedules` | Accepted |
| [0052](./0052-eslint-soft-delete-bypass-rule.md) | ESLint rule against raw-Prisma soft-delete bypass | Accepted |
| [0053](./0053-mentor-new-role-batch-mentors-tenant-level.md) | Mentor as a new role — nullable-login profile, `batch_mentors` M:N assigned-scope, tenant-level records | Accepted |
| [0054](./0054-internship-completion-reuse-race-safe-markcomplete.md) | Internship completion reuses the P4 eligibility engine; `active→completed` is a race-safe compare-and-set | Accepted |
| [0055](./0055-ai-mentor-exploration-and-removal.md) | AI-mentor chatbot — explored, then fully removed; mentors are human hires | Accepted |
| [0056](./0056-bullmq-async-workers.md) | BullMQ async workers — supersedes the sync-seam decision (ADR-0020/0039) | Accepted |
| [0057](./0057-liveclassprovider-zoom-google-meet-fail-closed.md) | LiveClassProvider interface — Zoom + Google Meet adapters, fail-closed in prod | Accepted |
| [0058](./0058-durable-postgres-2fa-not-redis.md) | TOTP 2FA credentials stored durably in Postgres, not Redis | Accepted |
| [0059](./0059-headless-cms-content-model-supersedes-mdx.md) | Headless CMS content model — supersedes the P5 MDX/Git-as-CMS decision (ADR-0035) | Accepted |
| [0060](./0060-tsvector-generated-columns-lms-search.md) | Postgres `tsvector` generated columns for LMS global search | Accepted |
| [0061](./0061-certificate-short-serial.md) | Short human-typeable certificate serial (`STMQ-YYYY-XXXX-XXXX`) alongside the signed `cert_uid` | Accepted |
| [0062](./0062-crm-page-builder-save-is-live-versions-site-settings.md) | CRM page builder over `ContentPage` — save-is-live with version snapshots; dedicated `SiteSetting` model | Superseded by 0063 (authoring model only — storage/RBAC/versioning still in force) |
| [0063](./0063-locked-page-templates-supersedes-block-builder.md) | Locked, fixed-layout page templates — supersedes the Phase-10 free block builder authoring UX | Accepted |

ADRs 0001–0006 were decided/implemented during Phase 0 (`docs/plans/phase-0.md`, Waves 1–6).
ADRs 0007–0012 were decided/implemented during Phase 1 (CRM core, Waves 1–6).
ADRs 0013–0020 were decided/implemented during Phase 2 (Commerce + Leads, Waves 1–6).
ADRs 0021–0026 were decided/implemented during Phase 3 (LMS core, Waves 1–7).
ADRs 0027–0033 were decided/implemented during Phase 4 (Learning Depth, Waves 1–7).
ADRs 0034–0038 were decided/implemented during Phase 5 (Marketing Website, Waves 1–7).
ADRs 0039–0045 were decided/implemented during Phase 6 (Engagement, Waves 1–8).
ADRs 0046–0052 were decided/implemented during Phase 7 (Analytics + Hardening, Waves 1–5).
ADRs 0053–0055 were decided/implemented during Phase 8's human-Mentor track
(`docs/specs/phase-8-mentor.md`). An earlier, separate P8 exploration (a student-facing AI
doubt-solving chatbot informally called "AI mentor") was fully removed before the human
mentor feature was built — see ADR-0055.
ADRs 0056–0060 were decided/implemented during Phase 9 (Completion,
`docs/plans/phase-9-completion.md`, Waves 0–7): 0056 installs BullMQ and supersedes the
ADR-0020/0039 sync-seam decision (T18/R1); 0057 is the LiveClassProvider Zoom/Google Meet
interface (T15/T20); 0058 is the durable-Postgres (not Redis) 2FA credential store (T28);
0059 is the headless CMS content model, superseding ADR-0035 (T8/T22); 0060 is the
`tsvector`-generated-column LMS search implementation (T29).
Known divergences from the original spec docs (`docs/04`, `docs/05`) as a result of
these decisions are called out inline in the relevant ADR rather than by editing the
spec docs themselves (the cuid-vs-uuid resolution lives in ADR-0001).

ADR 0062 was decided/implemented during Phase 10 (Page Builder,
`docs/specs/phase-10-page-builder.md`): the CRM block-based page builder over
`ContentPage` (`isBuilderManaged` flag, save-is-live), `ContentPageVersion` append-only
history with save-before-apply optimistic concurrency, and a dedicated `SiteSetting`
model kept out of the existing `Setting`/`settings.*` RBAC surface. Its free-composition
authoring model (add/remove/reorder blocks) was superseded in Phase 11 by ADR-0063; the
storage/versioning/RBAC decisions in ADR-0062 remain accurate and in force.

ADR 0063 was decided/implemented during Phase 11 (Locked Templates,
`docs/plans/phase-11-locked-templates.md`): the 6 core marketing pages moved from a free
block builder to locked, fixed-layout templates (server-enforced via
`validatePageBodyAgainstTemplate`), colleges became a dedicated CRM-managed list
(`Partner` rows, `category=college_partner`) unified with the mentors/courses
live-collection pattern, the ad-hoc `/pages/[slug]` route was removed, and a per-page OG
image (`ContentPage.seoImagePath`/`ContentPageVersion.seoImagePath`) was added.

ADR 0064 was decided/implemented for the student onboarding form
(`docs/specs/onboarding-form.md`), replacing the Google Form students filled after paying:
the question set is CRM-authored DATA (`onboarding_fields`) rather than a schema in code —
the deliberate opposite of ADR-0063's locked page templates, and for the opposite reason
(a form has no shape to break); answers are stored as self-describing snapshots so later
field edits cannot rewrite history; validation is a shared function
(`buildOnboardingAnswerIssues`) run identically on both sides, because a data-defined form
admits no fixed DTO. It ships as ONE route on the existing marketing site
(`/onboarding` in `apps/web`) — an `onboarding.stimuliiq.com` subdomain was built and then
dropped, since it needed DNS + a Vercel domain attachment and ran edge middleware on every
request to the whole site to serve one page.

ADR 0066 was decided/implemented for careers/hiring (`docs/specs/careers-hiring.md`),
closing a loop that had been half-built: job openings were free text typed into the careers
page, applications landed in a table with NO CRM screen at all, and not one email was ever
sent — a candidate uploaded a resume into silence. Openings become a CRM-managed table
surfaced live on the site (the P11 colleges pattern), so an application can reference a real
opening; the `job_openings` page-builder block becomes a second reference block beside
`live_collection_ref` and loses its role editor entirely, so no control remains that looks
like it publishes a job and does not. Review is FOUR VERBS — hold / shortlist / offer /
reject — rather than a status picker, following ADR-0064's and P4's precedent for a stronger
reason: three of the four email a person outside the company and one attaches a signed offer
letter, so an irreversible message must not ride on a dropdown. The offer letter is ATTACHED
rather than linked (the owner's call), which is why `MailProvider` gained `attachments` and
`StorageProvider` gained a size-capped `getObject` — the only server-side byte read in the
codebase. Careers also gets its own permission domain (`careers.view/review/openings.manage`)
rather than reusing `content.*` like the colleges screen next door: an application carries a
stranger's resume, and whoever may rewrite the homepage should not thereby read CVs.

ADR 0068 was decided/implemented for course types (`docs/specs/course-types.md`): the
`StudentCourseType` enum (btech/degree/diploma/mca/mba/other) becomes a CRM-managed table
staff maintain from Admin ▸ Course types with no deploy. The enum was written for the
original engineering audience and cost a migration plus a deploy to change, so it never
changed and the real answer went into "Other" — while the healthcare repositioning left a
required field asking nursing students whether they were doing B.Tech. This is ADR-0064's
call (CRM-authored onboarding questions) applied for the same reason and the deliberate
opposite of ADR-0063's locked page templates: a marketing page has a layout free composition
ruins, a list of options has no shape a non-engineer can break. `student_profiles.
course_type` stores the option's immutable `key` rather than a foreign key, so renaming
"B.Tech" to "MBBS" renames the OPTION and never silently rewrites what existing students are
recorded as; labels resolve on read so a rename shows everywhere at once. Writes reject
anything but an ACTIVE option (422), reads tolerate hidden and deleted ones (history renders
as recorded), and delete is refused while students hold the key (409) in favour of hiding.
The column also becomes NULLABLE, deleting the two paths that invented a qualification
("btech" on website self-registration, "other" on onboarding activation) to satisfy NOT NULL.
Read is gated on `students.view` (every picker needs it) and write on
`course_types.manage`, which — unlike `leave.approve` and `marketing_targets.manage` —
stays INSIDE the permission catalog so admin holds it too: maintaining a list of
qualifications is configuration, not authority over a person.

Security follow-ups and deferred work from each phase's security review and build are
tracked separately in the relevant followups file (`docs/phase-0-followups.md`,
`docs/phase-1-followups.md`, `docs/phase-2-followups.md`, `docs/phase-3-followups.md`,
`docs/phase-4-followups.md`, `docs/phase-5-followups.md`, `docs/phase-6-followups.md`,
`docs/phase-7-followups.md`, `docs/phase-8-followups.md`, `docs/phase-9-followups.md`,
`docs/phase-10-followups.md`, `docs/phase-11-followups.md`), not as ADRs (they are TODOs,
not decisions).
