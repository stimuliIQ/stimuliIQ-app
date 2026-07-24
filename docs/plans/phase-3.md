# Plan: Phase 3 — LMS Core ("P3")

> Scope boundary (`CLAUDE.md §6`): **"P3 LMS core: dashboard, courses, recorded video
> (signed HLS), progress, attendance."** This plan delivers exactly that, end-to-end
> (schema → contracts → provider (video) → backend → **apps/lms** frontend → tests →
> security → docs) and **does not** plan ahead into P4 (assignments / projects / assessments
> / certificates), P5 (marketing website + book-slot funnel), P6 (notifications / WhatsApp /
> email / campaigns / forum / gamification), or P7 (analytics dashboards).
>
> Three deliberate gate edges:
> - **Live classes are DEFERRED.** `docs/02 §7.4` (Zoom/Meet join + live attendance) and the
>   `LiveClassProvider` are heavier integrations; the P3 headline is **recorded HLS + progress
>   + attendance**. We add the `live_classes` table **only if** it costs nothing to keep the
>   `attendance.live_class_id` FK nullable — **recommendation: do NOT create `live_classes` in
>   P3**; make `attendance.live_class_id` nullable and only ever populate `source=recorded` in
>   P3. Live scheduling + `LiveClassProvider` land in a later phase (P3.5/P6-adjacent).
> - **The VideoProvider is STUBBED/Noop until keys arrive.** Like `NoopPaymentProvider` in P2,
>   a `NoopVideoProvider` mints deterministic fake signed URLs for tests and local dev; the
>   real Cloudflare Stream / Mux adapter is wired but **fail-closed** until the operator sets
>   the credentials (see "Secrets"). No live video calls in CI.
> - **Transcode webhooks reuse the P2 deferred-queue pattern.** BullMQ is still bound behind a
>   `Sync*Adapter` port (ADR-0020). The `video-webhook` transcode-status handler is processed
>   **inline** behind a `VideoWebhookProcessorPort`; the BullMQ adapter is deferred, consistent
>   with P2's `WebhookProcessorPort`/`InvoiceGenPort`.
>
> Each task DoD references `CLAUDE.md §4` + the relevant `docs/02 §7.x` / `docs/04 §2.12` /
> `docs/05 §3/§4/§7` + acceptance criteria from `docs/02 §21` (the "login → watch → resume"
> slice of the `docs/04 §6` `login→watch→submit→certify` journey — P3 owns the **watch**).

---

## P2 verification (done before planning — no rework)

**P2 (Commerce + Leads) is GREEN and gates open to P3.** Confirmed from
`docs/plans/phase-2.md` + `docs/phase-2-followups.md`: 235 unit + 129 integration tests pass
(1 skipped); `turbo run build lint test` + `test:integration` green; security review returned
**Conditional GO** with **no Critical** findings and all five must-fixes (H-1 rate-limiter
fail-closed, H-2 refund-match, M-1 refund txn, M-2 refund self-approval, M-6 manual-payment
reference) remediated. Built: commerce (orders/payments/Razorpay/webhook/refunds/coupons/
invoices/reconciliation) + leads (pipeline/activities/bookings/public-intake/conversion) + the
`enrollments.order_id`/`source` commerce-linkage + the CRM Commerce & Leads screens.

**P2 facts that shape P3 (carried, not redone):**
- **Enrollments now exist WITH commerce linkage and are the student's access anchor.** The
  P3 enrollment-scope authz keys off `enrollments (student_id → student_profile.user_id,
  program_id, batch_id, status=active)`. `source ∈ {manual, order, conversion}` — **all three
  grant access** in P3 (a manually-rostered student is as enrolled as a paid one).
- **Provider + Noop pattern is proven** (`PaymentProvider`/`PAYMENT_PROVIDER` token +
  `RazorpayPaymentProvider` + Noop; `SMS_PROVIDER` + Noop). **The `VideoProvider`/
  `VIDEO_PROVIDER` token + Cloudflare/Mux adapter + `NoopVideoProvider` copy this shape
  exactly** (`CLAUDE.md §1/rule 7`).
- **BullMQ still deferred behind ports** (ADR-0020: `Sync*Adapter`). P3's transcode-webhook
  processor follows the same port pattern; no worker infra required.
- **Single-tenant `TENANT_SLUG="stimuliiq"` hardcoded** (carried S from P0/P1). Every new P3
  repo MUST tenant-scope every query; no new hardcodes. Cross-tenant IDOR test debt carries.
- **Video storage was a stub in P2** (invoice `storage_key` null; real S3/R2 deferred). P3
  does **not** need object storage for HLS — the **video provider CDN** serves signed HLS; the
  only storage touchpoint (lesson **resources** download URLs) can reuse a stub
  `StorageProvider` or be deferred (see scope note on `resources`).
- **Carried P1 item now actionable:** courses `assigned` scope fail-closed (ADR-0009, no
  `programs.created_by`) was flagged "resolve in P3 LMS authoring." P3 is **student-side
  consumption**, not authoring, so this stays deferred — no `programs.created_by` added here;
  noted so docs-writer keeps it tracked.

---

## Goal & success criteria

**Goal:** Stand up **`apps/lms`** (the Next.js 15 App Router **PWA** student portal — today
just the P0 shell that calls `/me`) as a real learning surface where an **enrolled** student
logs in, sees their **dashboard** (my courses, continue-learning, progress summary, upcoming
recorded lessons), browses their enrolled program's **curriculum** (programs → modules →
lessons; preview vs enrollment-locked), and **watches protected recorded video** streamed via
**short-lived, per-user signed HLS** URLs minted only after a server-side **enrollment + RBAC
check** — with **progress tracked** (resume within ±2s, per-module/program completion %) and
**recorded-completion attendance** marked — all tenant-scoped, RBAC + **enrollment-scope**
enforced server-side, soft-deletable, audited on mutation, zod DTOs shared FE+BE, a11y AA,
PWA-installable.

**The two cruxes (call-outs):**
1. **Security crux — enrollment-scope authz (IDOR).** Every content read (curriculum, lesson
   detail, **stream-url mint**, progress write, attendance) MUST verify the requesting user
   owns an **active enrollment** in the program the resource belongs to. A student who is
   **not** enrolled in a program CANNOT get its curriculum, a lesson's stream URL, or write
   progress against it. Cross-student access (reading/writing *another* student's progress or
   minting *their* stream URL) is forbidden. This is the headline QA + security test.
2. **Technical crux — signed-HLS minting.** On play, the backend mints a **short-TTL** (e.g.
   ≤ 5 min), **per-(user, lesson)** signed HLS URL via the `VideoProvider`; **no raw object /
   manifest URL, no long-lived token, ever reaches the client**; a **per-user watermark**
   (name + student id, a simple overlay in P3) is applied; URLs expire and cannot be reused or
   shared (`docs/02 §21`).

**Success criteria:**
1. **Dashboard** (`docs/02 §7.1/§13`): an authenticated enrolled student sees my-courses/
   enrollments, a **continue-learning** rail (resume the last-watched recorded lesson at its
   timestamp), a **progress summary** (progress ring per enrolled program), and **upcoming
   recorded lessons** (next unwatched lessons). Live-class countdown is **omitted** (live
   deferred) with a graceful empty affordance. All from **the student's own enrollments only**.
2. **Courses / curriculum consumption** (`docs/02 §7.2`): a student opens an enrolled program
   and sees the **curriculum tree** (modules → lessons with type `video|reading`, completion
   checkmarks); navigates lessons; **preview** lessons (`lessons.is_preview=true`) are viewable
   pre/without enrollment, **non-preview** lessons are **enrollment-locked** server-side (locked
   UI mirrors the API `403`, never the reverse).
3. **Recorded video + signed HLS** (`docs/02 §7.3`, `docs/04 §2.12`, `docs/05 §7`): the
   `videos` table (lesson_id, provider, provider_asset_id, duration_s, status, captions) is
   migrated; `VideoProvider` interface (Cloudflare Stream / Mux behind the token) + adapter +
   `NoopVideoProvider`; **`GET /api/v1/lessons/:id/stream-url`** mints a short-TTL per-user
   signed HLS URL **only after** the enrollment + RBAC check; player consumes HLS with adaptive
   bitrate, speed/quality/captions, per-user **watermark** overlay, disabled right-click/save;
   **no raw URL** in any response or bundle.
4. **Progress tracking** (`docs/05 §3` `lesson_progress`, `docs/02 §7.10`): per-enrollment
   per-lesson `lesson_progress` (status, last_position_s, completed_at); the player **reports
   position** (throttled) → backend **upserts** `lesson_progress`; **resume-where-you-left-off**
   returns within **±2s** (`docs/02 §21`); marking complete + a completion **rollup** updates
   `enrollment.progress_pct` (module + program completion %).
5. **Attendance (recorded)** (`docs/05 §3` `attendance`, `docs/02 §7.7`): completing a recorded
   lesson marks an `attendance` row with `source=recorded` (live attendance deferred);
   attendance %/engagement derives from recorded completion per the P3 policy.
6. **PWA** (`docs/02 §8/§14/§16`): `apps/lms` is **installable** (manifest + icons), has a
   **service-worker app shell** (offline-capable shell + cached static/route assets; **offline
   *video download* is explicitly OUT of P3** — encrypted offline lesson cache is `docs/02 §7.8`
   depth, deferred), bottom-tab nav on mobile, data-saver-aware, AA.
7. **Cross-cutting** (`CLAUDE.md §3/§4`): every new table `tenant_id` + soft-delete + audit;
   **enrollment-scope + RBAC enforced server-side** on every content read/write; zod DTOs in
   `@repo/types` shared FE+BE; **signed media** short-TTL/per-user/never-raw; loading/empty/error
   on every async UI; a11y AA (captioned video, keyboard player, focus mgmt); money **n/a**;
   `turbo run build lint test` + `test:integration` green; security-reviewer sign-off (no
   high/crit).
8. **`docs/02 §21` (P3 slice):** a student can **only** stream content for programs they're
   enrolled in; **URLs expire and cannot be reused or shared**; **resuming returns within ±2s**;
   (certificate + attendance-on-live criteria are out of P3 scope — certificate is P4, live
   attendance deferred).

---

## Preconditions (what must already exist — verified)

- **P2 GREEN** (see verification above): 235 unit + 129 integration green; build/lint/typecheck
  green; security Conditional-GO, must-fixes remediated.
- **Schema present** (`prisma/schema.prisma`): identity/access + catalog
  (`programs`/`modules`/`lessons` — `Lesson.type ∈ {video,reading,assignment,quiz}`,
  `Lesson.is_preview`, `Lesson.content`), profiles (`student_profiles`/`faculty_profiles`),
  `batches`, **`enrollments`** (with P2 `order_id`/`source`), commerce + leads (P2), `audit_logs`.
  Soft-delete + audit Prisma extensions live and proven. **`videos`, `lesson_progress`,
  `attendance`, `resources`, `live_classes` are NOT migrated** (spec-only, `docs/05 §10`) — P3
  adds `videos` + `lesson_progress` + `attendance` (+ `resources` only if in scope; **not**
  `live_classes` — deferred).
- **Auth reusable in `apps/lms`:** the P0 auth (cookie + CSRF, rotating refresh) already works
  in `apps/lms` (`apps/lms/src/lib/api-client.ts` + `use-me.ts` call `/me` with the same
  `@repo/api-client`). **Students are `users` with `student_profiles` + `enrollments`** — P3
  reuses this login; no new auth. RBAC machinery reusable (guards/decorators/ScopeInterceptor/
  scope-context `all|branch|assigned|own`), proven across P1/P2 modules.
- **Provider + Noop pattern proven** (the model the `VideoProvider` copies exactly):
  `sms-provider.interface.ts` + `SMS_PROVIDER` token + Noop; `PaymentProvider`/`PAYMENT_PROVIDER`
  + `RazorpayPaymentProvider` + Noop.
- **Contracts/SDK pattern proven:** `@repo/types` (zod DTOs, `{data,meta,error}` envelope,
  `Paginated<T>`, RFC-7807); OpenAPI registry → generated `@repo/api-client`. (Opportunistic
  cleanups carried from P2: rename `auth.openapi.json`→`api.openapi.json`; attach the 8 P2
  `List*QuerySchema` query params to their routes — do in W2 if cheap.)
- **`@repo/ui` primitives present** (P0–P2): Button, Card, Input, Label, Toast, Skeleton,
  EmptyState, StatusChip, Tabs, Select, FormField, Drawer, ConfirmDialog, Checkbox, DataTable,
  MoneyInput, DateChip, SlaChip, ActivityTimeline, Kanban. **Missing for the LMS (P3 adds):**
  a **VideoPlayer** (HLS) wrapper, a **ProgressRing** + **ProgressBar**, a **CourseCard**, a
  **CurriculumAccordion / LessonList**, and a **ContinueLearning** card.
- **`apps/lms` today = P0 shell:** `app/page.tsx` (Dashboard shell calling `/me`),
  `components/dashboard-status.tsx`, `hooks/use-me.ts`, `lib/api-client.ts`, `providers.tsx`,
  `layout.tsx`. **No** dashboard data, course routes, lesson player, PWA manifest, or
  service worker yet — P3 is the first real build on `apps/lms`.

**Carried follow-ups that intersect P3 (fold in where a P3 task touches the code; else keep
tracked in `docs/phase-3-followups.md`):**
- Cross-tenant IDOR test debt (S1-3): P3 adds video + progress; security review SHOULD add the
  cross-tenant isolation test on `videos`/`lesson_progress`/stream-url now.
- PII read-access logging (S1-2): unchanged; not gating.
- Playwright e2e (carried P1/P2): P3 adds the critical **login → open course → watch (mint
  stream-url) → resume** journey; light happy-path e2e recommended, integration remains the gate.
- `courses.assigned` scope fail-closed (ADR-0009): stays deferred (P3 is consumption, not
  authoring); no `programs.created_by` added.

---

## New schema the db-architect adds in P3

All from `docs/05 §3` "Catalog"/"Batches & enrollment" (currently spec-only per `docs/05 §10`).
Every table: `id` uuid PK, `created_at`/`updated_at`/`deleted_at`, `tenant_id`, wired into the
soft-delete + audit Prisma extensions, with the `docs/05 §4` indexes. **Forward-only migration**
— never edit shipped P0/P1/P2 migrations. **Do NOT** add later-phase tables (assignments,
submissions, assessments, attempts, certificates, notifications, forum, badges — P4/P6).

### Tables to ADD

| Table | Columns (`docs/05 §3`) | Notes |
|-------|------------------------|-------|
| `videos` | `tenant_id`, `lesson_id` (FK lessons, **uniq** 1:1 — `LESSON ||--o| VIDEO`), `provider` (default `noop`; e.g. `cloudflare_stream`/`mux`), `provider_asset_id`, `duration_s` Int?, `status` enum `VideoStatus` (`processing\|ready\|errored`), `captions` Json? | Indexes: `(lesson_id)` uniq, `(tenant_id, status)`. **No raw URL stored** — only the provider asset ref; signed HLS is minted on demand. Transcode-status updated by the (inline-port) webhook. |
| `lesson_progress` | `tenant_id`, `enrollment_id` (FK enrollments), `lesson_id` (FK lessons), `status` enum `LessonProgressStatus` (`not_started\|in_progress\|completed`), `last_position_s` Int default 0, `completed_at` DateTime? | Indexes: **`(enrollment_id, lesson_id)` uniq** (`docs/05 §4` — resume, completion, upsert target), `(tenant_id, enrollment_id)`. Position reported (throttled) by the player; completion rolls up to `enrollment.progress_pct`. |
| `attendance` | `tenant_id`, `enrollment_id` (FK enrollments), `live_class_id` (FK live_classes, **nullable** — always null in P3), `status` enum `AttendanceStatus` (`present\|absent`), `source` enum `AttendanceSource` (`live\|recorded`), `marked_at` DateTime | Indexes: **`(enrollment_id, live_class_id)` uniq** (`docs/05 §4`; with nullable `live_class_id`, add a partial-unique for the recorded case keyed on `(enrollment_id, lesson_id, source)` **or** model recorded attendance as one row per lesson-completion — db-architect decides; the invariant is **no duplicate recorded-attendance per (enrollment, lesson)**). `source=recorded` only in P3. |
| `resources` *(IN SCOPE if cheap — else defer)* | `tenant_id`, `lesson_id` (FK lessons), `title`, `type`, `storage_key`, `size` Int? | Indexes: `(lesson_id)`. Lesson attachments (`docs/02 §7.8`). **Recommendation: include the table + read-only list (surfaced as metadata) but DEFER signed-download minting** (needs a real `StorageProvider`, out of the P3 HLS focus). Download-URL minting can piggyback the P4 storage work. If it bloats W1, defer the whole table to P4. |

> **`live_classes` — NOT created in P3.** `attendance.live_class_id` is nullable so the FK can
> land later without a migration edit. Rationale recorded as an ADR (live deferral).

### New enums
`VideoStatus` (`processing|ready|errored`), `LessonProgressStatus`
(`not_started|in_progress|completed`), `AttendanceStatus` (`present|absent`),
`AttendanceSource` (`live|recorded`).

### Relations to wire (reverse relations on existing models)
- `Lesson`: add `video Video?`, `progress LessonProgress[]`, `resources Resource[]`.
- `Enrollment`: add `lessonProgress LessonProgress[]`, `attendance Attendance[]`.

### Seed expansion (`prisma/seed.ts`)
- **Permission matrix** (`docs/02 §9` / `docs/03 §9`): student-surface LMS permissions —
  `lessons.view` / `courses.view` (enrollment-scoped `own`), `videos.stream` (own enrollment),
  `progress.write` (own), `attendance.view` (own). Student role gets these **`own`-scoped**;
  Faculty gets **`assigned`** read of their batches' content (student-facing side); Admin/Owner
  `all`. Forward-looking keys may remain seeded-unused (harmless).
- **Sample content so the LMS renders real data:** on the existing sample program, add **1–2
  modules of recorded lessons** each with a `videos` row pointing at a **Noop/fake provider
  asset** (`provider=noop`, a fake `provider_asset_id`, `status=ready`, `duration_s`), a couple
  of `is_preview=true` lessons, and (if `resources` kept) a sample attachment. Add
  `lesson_progress` for the seeded sample student (one `completed`, one `in_progress` with a
  `last_position_s`) so **continue-learning + progress ring + resume** render out of the box,
  and a matching **recorded `attendance`** row.

---

## Task graph

| # | Task | Owner agent | Depends on | Wave | DoD (refs `CLAUDE.md §4` + docs) |
|---|------|-------------|------------|------|------|
| 1 | **Schema + migration + seed.** Add `videos`, `lesson_progress`, `attendance` (+ `resources` if cheap; **NOT** `live_classes`) + the 4 new enums per the tables above; make `attendance.live_class_id` nullable; wire reverse relations on `Lesson`/`Enrollment`. uuid PK, `tenant_id`, soft-delete + audit wired, `docs/05 §4` indexes (**`lesson_progress (enrollment_id,lesson_id)` uniq**, **`videos (lesson_id)` uniq**, the recorded-attendance no-dup invariant, `(tenant_id,status)` on videos). Forward-only migration applies clean (never edit P0/P1/P2 migrations). Expand `seed.ts`: LMS student-surface permission matrix + sample recorded lessons/videos(Noop)/progress/attendance on the sample program. Integration test: soft-delete filter + audit-row-on-mutation for `videos` + `lesson_progress`; `lesson_progress` unique-upsert holds. | db-architect | — | **W1** | §4: every table tenant_id + soft-delete + audit; migration forward-only. `docs/05 §3/§4/§7/§10`, `docs/02 §9`. Migration + seed run clean; extension + unique-upsert tests green. |
| 2 | **Shared contracts + client.** In `@repo/types`: zod DTOs + types for the LMS student surface — **Dashboard** (`MeDashboard`: enrollments summary + continue-learning item + progress rollups + upcoming lessons), **MyEnrollments** (ListItem/Detail), **Curriculum** (program → modules → lessons tree with `type`, `is_preview`, per-lesson progress + lock flag), **LessonDetail** (video|reading content, video meta *without* raw URL), **StreamUrl** (`GET /lessons/:id/stream-url` → `{ url, expiresAt, watermark:{name,studentId} }` — **short-TTL, no raw asset id leaked beyond what's needed**), **ProgressUpdate** (`{ lessonId, lastPositionS, status? }` → updated progress + rollup), **Attendance** (recorded ListItem). Reuse `{data,meta,error}` + `Paginated<T>` + RFC-7807. Register in OpenAPI registry; regenerate `@repo/api-client`. (Opportunistic: fold in P2's carried OpenAPI cleanups — rename `auth.openapi.json`→`api.openapi.json`; attach the 8 P2 list-query params.) | api-designer | 1 | **W2** | §4: zod DTOs in `@repo/types` imported FE+BE; validation at every boundary; **stream-url DTO carries no raw/long-lived URL, only short-TTL signed + expiry**. `docs/04 §2.5/§2.12/§2.14`. Client compiles; SDK methods exist for dashboard/enrollments/curriculum/lesson/stream-url/progress/attendance. |
| 3 | **LMS design-system primitives.** Add to `@repo/ui` ONLY what the LMS needs and P0–P2 lacks, per `docs/02 §12/§15` + `docs/07`: **VideoPlayer** (HLS wrapper — `hls.js` where MSE required / native HLS on Safari; adaptive bitrate, keyboard controls, captions track, speed/quality selector, **per-user watermark overlay** slot, `onTimeUpdate`/`onEnded` callbacks for progress reporting, disabled context-menu/download, poster/loading/error states, reduced-motion), **ProgressRing** + **ProgressBar** (labelled %, not color-only), **CourseCard** (cover, progress ring, next-item, AA), **CurriculumAccordion / LessonList** (modules→lessons, completion checkmark, **locked** affordance, keyboard-navigable), **ContinueLearning** card (resume CTA + timestamp). All keyboard-first, focus-managed, AA, captioned; unit/a11y test each. | design-system | — | **W2** (‖ #2) | §4: a11y pass (keyboard player + SR labels + captions `docs/02 §15`); loading/empty/error patterns; no color-only status. `docs/07`, `docs/02 §12`. Each primitive has a unit/a11y test; VideoPlayer tested with a mock HLS source (no live network). |
| 4 | **`VideoProvider` adapter + Noop.** Following the payment/SMS provider pattern exactly (interface + DI `Symbol` token + Noop + real adapter, env zod-validated at boot): define `VideoProvider` interface + `VIDEO_PROVIDER` token with `mintSignedHlsUrl({ assetId, userId, lessonId, ttlSeconds, watermark })` (returns short-lived signed HLS URL + expiry; watermark payload), `getAsset(assetId)` (status/duration/captions), `verifyWebhookSignature(rawBody, header)` + `parseTranscodeEvent(payload)` (transcode-status), optional `createUpload()` (asset ref — authoring is CRM/later, keep minimal). Implement **`CloudflareStreamVideoProvider`** (or Mux — pick one default, other is the swap; signed-URL via provider signing key) **fail-closed** until keys set, and **`NoopVideoProvider`** (deterministic fake signed URL + fake asset for tests/local, like `NoopPaymentProvider`). Provider does NO business logic — only vendor calls + signing + signature math; the enrollment/RBAC gate lives in the service (#5). Unit tests: signed-URL shape + TTL, webhook signature pass/fail, Noop determinism (no live network). **Env keys (see Secrets) are user-provided; provider is Noop until then.** | integrations | 1, 2 | **W3** | §4 + `CLAUDE.md §1/rule 7`: vendor SDK only behind interface; env-validated; secrets via env; **no raw URL returned — only short-TTL signed**. `docs/04 §2.10/§2.12`, `docs/05 §7`. Adapter injected by token; Noop deterministic; signature/URL unit tests green; **fail-closed when unconfigured**. |
| 5 | **Backend A — LMS content + stream-url module (the security-critical one).** NestJS `lms` (or `learning`) module, controller→service→repository, depending on `VideoProvider` (token from #4). Endpoints: **`GET /me/dashboard`** (student's enrollments + continue-learning + progress rollups + upcoming lessons — **own enrollments only**), **`GET /me/enrollments`**, **`GET /me/enrollments/:id/curriculum`** (program → modules → lessons **enrollment-gated**: non-preview lessons require an active enrollment; preview lessons open), **`GET /lessons/:id`** (detail; video meta **without** raw URL), and the crux **`GET /lessons/:id/stream-url`** — resolve the lesson→program, **verify the requesting user has an active enrollment in that program** (or the lesson `is_preview`), RBAC `videos.stream` scope `own`, then mint a **short-TTL per-(user,lesson) signed HLS URL** via the provider with the **watermark** payload (name + student id); **return only the signed URL + expiry — never the raw asset/manifest URL**; audited (stream-url mint = auditable access event). Enrollment-scope + RBAC via `@RequirePermission` + `ScopeInterceptor`. Every access-gated read enforces enrollment-scope. **Fail-closed if provider unconfigured** (503/clear error, never a raw URL). | backend-builder | 1, 2, 4 | **W4** | §4: **server RBAC + enrollment-scope on every content read**; **signed-media short-TTL/per-user/no-raw-URL** (`docs/04 §2.12`, `docs/05 §7`); audit on stream-url mint. `docs/02 §7.2/§7.3/§9/§21`, `docs/04 §2.12`. **Non-enrolled student → 403/404 on curriculum + stream-url**; preview lessons open; no raw URL in any response. |
| 6 | **Backend B — Progress + attendance module.** NestJS progress/attendance surface (may live in the same `lms` module — split for sizing), controller→service→repository. Endpoints: **`PUT /me/lessons/:id/progress`** (upsert `lesson_progress` by `(enrollment_id, lesson_id)`; throttle-friendly; validate the lesson belongs to an **enrolled** program — **enrollment-scope**; write is scoped `own`, cannot write another student's progress), **mark-complete** (sets `status=completed`, `completed_at`; triggers **completion rollup** → `enrollment.progress_pct` = completed/total lessons; and marks **recorded `attendance`** `source=recorded` idempotently for that lesson-completion), **`GET /me/progress`** (per-program/module completion %), **`GET /me/attendance`** (recorded attendance list/%). Resume-position returned so the player restores within **±2s** (`docs/02 §21`). Idempotent: replayed progress/complete does NOT double-count attendance or corrupt the rollup. Every mutation audited; soft-delete respected. | backend-builder | 1, 2, (5 for shared module/enrollment-resolve) | **W4** (‖ #5, shared module) | §4: server RBAC + **enrollment-scope (`own`) on progress writes**; audit on mutation; idempotent rollup. `docs/02 §7.10/§7.7/§21`, `docs/05 §3`. **Cannot write progress for a non-enrolled program or another student**; resume ±2s; completion rollup + recorded-attendance idempotent. |
| 7 | **LMS frontend A — Dashboard + courses/curriculum.** Build in **`apps/lms`** (Next.js 15 App Router PWA; TanStack Query over `@repo/api-client`; RHF+zod from `@repo/types` where forms exist): the real **Dashboard** (`app/page.tsx` → greeting, ContinueLearning card, my-courses grid with CourseCard + ProgressRing, upcoming recorded lessons; live section omitted with graceful empty), **My Courses** list, **Course / curriculum** page (`app/courses/[enrollmentId]` or `[programId]`) using CurriculumAccordion — preview vs **locked** lessons mirror the API. RBAC-aware (student sees **only their enrollments**). Reuse the P0 auth (`api-client.ts` + `use-me.ts`); loading/empty/error on every async view; a11y; mobile bottom-tab nav (extend the P0 shell: Home/Courses/Progress). | frontend-builder | 5, 3 | **W5** | §4: loading/empty/error on every async UI; a11y; RBAC/enrollment-aware UI (only own enrollments); no business logic in components (hooks). `docs/02 §7.1/§7.2/§10/§13/§14`. Dashboard + curriculum render from the student's own enrollments; locked lessons match server gating. |
| 8 | **LMS frontend B — Lesson player + progress + PWA.** In **`apps/lms`**: the **lesson page** (`app/lessons/[id]`) — VideoPlayer consuming the **signed HLS** from `GET /lessons/:id/stream-url` (fetched on play, re-minted on expiry; **never a raw URL in the DOM/bundle**), **per-user watermark** overlay (name + id), **progress reporting** (throttled `onTimeUpdate` → `PUT progress`), **resume** from `last_position_s` (±2s), **mark-complete** + autoplay-next, reading-type lessons render `content`; a **My Progress** view (per-program rings + module breakdown). **PWA setup:** `manifest.webmanifest` + icons (installable), a **service worker** for the **app-shell** (offline shell + static/route caching via `next-pwa` or a hand-rolled SW; **video download offline is OUT of P3**), data-saver-aware, theme/dark-mode. loading/empty/error; a11y (keyboard player, captions, focus mgmt); optimistic mark-complete. | frontend-builder | 5, 6, 3 | **W5** (‖ #7) | §4: loading/empty/error; a11y (captioned keyboard player `docs/02 §15`); no raw URL client-side; PWA installable. `docs/02 §7.3/§7.10/§8/§14/§16/§21`, `docs/04 §2.12/§3.3`. Player streams signed HLS + watermark; resume ±2s; progress reported; app installs + shell works offline. |
| 9 | **Tests.** Unit (services: enrollment-scope resolver — enrolled/not-enrolled/preview; stream-url TTL + watermark payload; progress upsert + completion-rollup math; recorded-attendance idempotency; Noop provider determinism; scope-filter builders `own`). Integration (testcontainers, real PG/Redis + **Noop VideoProvider**): **enrollment-gated access — the headline authz test** — a student **CANNOT** get curriculum / stream-url / write progress for a program they're **NOT** enrolled in (403/404 + logged), **CAN** for one they are; **preview lesson** streamable without enrollment; **stream-url short-TTL + per-user scoping** (URL carries expiry; a second user's mint differs; expired/reused URL rejected at the boundary we control); **no raw URL** in any response; **cross-student** progress/stream write forbidden; **progress upsert + resume ±2s**; **completion rollup** correct; **recorded-attendance idempotent** (replay no double-count); **audit-row on every mutation** (progress/complete/stream-mint). PWA smoke (manifest served, SW registers, shell offline). Light Playwright happy-path e2e (login → open course → play → resume) — recommended, non-gating. Wire into CI. | qa-engineer | 5, 6, 7, 8 | **W6** | §4: unit + integration green; tests gate merge. `docs/02 §21`. **Enrollment-scope IDOR proven**; signed-url TTL/scoping; progress/rollup/attendance idempotency; no-raw-URL; each scope mode. |
| 10 | **Security review.** **Enrollment-scope IDOR (the crux):** can a non-enrolled or *different* student read curriculum / mint a stream-url / read-or-write progress / read attendance for a program/lesson/enrollment they don't own? (must be blocked **server-side** + logged). **Signed-media integrity:** stream-url is **short-TTL + per-user**, **no raw asset/manifest URL** ever in responses/logs/bundle, watermark applied, URL non-reusable/non-shareable (`docs/02 §21`), provider signing key never leaked. **Webhook:** transcode webhook signature-verified + idempotent + fail-closed (reuse the P2 webhook rigor). **Preview-bypass:** a non-preview lesson cannot be streamed by flipping client state; `is_preview` is server-authoritative. **Tenant isolation** on `videos`/`lesson_progress`/`attendance` repos (add the cross-tenant test debt from S1-3). **No secret leakage** (video signing key / provider token never in responses, logs, or client bundle). **Provider fail-closed** when unconfigured (never emits a raw/unsigned URL). Report high/crit as fix tasks; re-verify. | security-reviewer | 9 | **W7** | §4 + `docs/04 §7` gate: server RBAC + enrollment-scope; signed media; no secret leakage. `docs/02 §17/§21`, `docs/04 §2.12`. No high/crit open; enrollment-scope IDOR + signed-URL + preview-bypass + tenant + webhook verified. |
| 11 | **Docs sync.** Update `README.md` (LMS module + how to run `apps/lms`; how to seed/verify P3; **VideoProvider Noop-by-default + how to set Cloudflare Stream / Mux keys**; how to exercise the transcode webhook locally). ADRs for P3 decisions (VideoProvider interface + Noop-until-keys; short-TTL per-user signed-HLS strategy + watermark; enrollment-scope authz model for content; live-classes deferral + nullable `attendance.live_class_id`; completion-rollup + recorded-attendance idempotency; PWA app-shell-only scope / offline-download deferral; transcode-webhook inline-port reusing ADR-0020). Update `docs/05 §10` implementation status (`videos`/`lesson_progress`/`attendance`[+`resources`] → Implemented P3). Create/update `docs/phase-3-followups.md` (live classes + `LiveClassProvider`, offline video download / encrypted cache, `resources` signed-download minting, BullMQ transcode worker, DRM, carried S1-x + P1/P2 items). | docs-writer | 10 | **W7** | §4: short summary of what changed + how to verify. P3 closeout; `docs/05 §10` + ADRs + `docs/phase-3-followups.md` synced. |

---

## Execution order (waves)

- **Wave 1:** #1 (db-architect) — schema + migration + seed; everything depends on it.
- **Wave 2 (parallel):** #2 (api-designer — contracts/SDK, needs #1) ‖ #3 (design-system —
  VideoPlayer/ProgressRing/CourseCard/CurriculumAccordion/ContinueLearning, needs nothing).
- **Wave 3:** #4 (integrations — `VideoProvider` interface + Cloudflare/Mux adapter + Noop;
  needs #1 + #2 types). Hard dependency for the video backend.
- **Wave 4 (parallel, shared `lms` module):** #5 (backend-builder — content + stream-url;
  needs #1+#2+#4 — **the security-critical enrollment-gate + signed-HLS mint**) ‖ #6
  (backend-builder — progress + attendance; needs #1+#2, shares the module + enrollment-resolve
  with #5). If #6's rollup depends on #5's enrollment-resolve helper, land #5's resolver first,
  then #6 upserts/rolls-up on top — same wave, shared module.
- **Wave 5 (parallel):** #7 (frontend-builder — Dashboard + courses/curriculum; needs #5 + #3)
  ‖ #8 (frontend-builder — lesson player + progress + PWA; needs #5 + #6 + #3).
- **Wave 6:** #9 (qa-engineer) — needs all backend + frontend landed.
- **Wave 7:** #10 (security-reviewer) → #11 (docs-writer).

---

## Risks & open questions

1. **Enrollment-scope authz (highest risk — the security crux).** Every content read/write
   must resolve `lesson → module → program` and confirm the caller owns an **active
   enrollment** in that program (or the lesson `is_preview`), scoped `own`, tenant-scoped. The
   `stream-url` mint is the sharpest edge — a leak = piracy. **Decision:** a single
   `resolveEnrollmentForLesson(userId, lessonId)` service helper is the one gate all endpoints
   call; QA (#9) + security (#10) exercise enrolled / not-enrolled / different-student / preview
   / cross-tenant explicitly. Recorded as ADR.
2. **Signed-HLS URL minting (the technical crux).** Short-TTL (≤ ~5 min), per-(user, lesson),
   watermarked, **never a raw asset/manifest URL to the client**, non-reusable/non-shareable
   (`docs/02 §21`). **Decision:** the `VideoProvider.mintSignedHlsUrl` returns only the signed
   URL + expiry; the service adds the enrollment gate + audit. TTL is a config constant. The
   player re-mints on expiry (fetch-on-play, not on page-load). Recorded as ADR.
3. **Per-user watermark.** `docs/02 §7.3/§17` wants name+id watermark. **P3 = a simple client
   overlay** (name + student id, semi-transparent, moving/static) driven by the watermark
   payload the mint returns; **provider-side burned-in / forensic watermark is deferred**
   (heavier, provider-dependent). Flagged so the criterion is met in mechanism, hardened later.
4. **Live classes — DEFER (recommended).** `docs/02 §7.4` + `LiveClassProvider` (Zoom/Meet) is
   a heavier integration than recorded HLS; keeping P3 tight on recorded means **not** building
   live scheduling/join/live-attendance. **Decision:** defer live; do **not** create
   `live_classes` (keep `attendance.live_class_id` nullable so it lands later without editing a
   shipped migration); P3 attendance is `source=recorded` only. Recorded as ADR + a
   `phase-3-followups` item. (If the operator insists live is in-scope, it's a separate follow-on
   wave: `LiveClassProvider` + `live_classes` table + join/attendance — do NOT fold into P3.)
5. **PWA offline scope.** `docs/02 §8/§14` promises offline downloads / encrypted lesson cache
   (`§7.8`). That is **heavy** (encrypted local cache, download tokens, storage). **Decision:**
   P3 ships **PWA install + app-shell service worker** (offline shell + static/route caching)
   **only**; **offline *video* download is deferred** to a later phase with `resources`/storage.
   Flagged so the PWA criterion is met at the shell level, download depth later.
6. **VideoProvider fail-closed / Noop until keys.** Mirroring `NoopPaymentProvider` + the P2
   fail-closed webhook: with **no** Cloudflare/Mux keys, the real adapter **fails closed**
   (stream-url returns a clear 503, never a raw/unsigned URL) and `NoopVideoProvider` serves
   deterministic fake signed URLs for tests/local dev so the whole flow is exercisable offline.
   Operator sets keys → the real adapter activates. Recorded as ADR + `.env.example`.
7. **Transcode webhook + BullMQ still deferred.** Reuse P2's ADR-0020 pattern: a
   `VideoWebhookProcessorPort` bound to a `Sync*Adapter` processes transcode-status inline; the
   BullMQ `video-webhook` worker is deferred. `videos.status` flips `processing→ready` on the
   verified webhook. No worker infra required for P3.
8. **`resources` in or out.** The table + read-only metadata list is cheap; **signed-download
   minting needs a real `StorageProvider`** (out of the HLS focus). **Decision:** include the
   table + list if it doesn't bloat W1; **defer signed-download** to P4 storage. If it bloats
   W1, defer the whole `resources` table to P4. db-architect makes the call at build time.
9. **Backend split sizing.** The `lms` module is large (dashboard + curriculum + stream-url +
   progress + attendance). Split as **#5 content + stream-url** | **#6 progress + attendance**
   within one shared module (same wave). If #5 alone overruns, sub-split
   **5a dashboard/enrollments/curriculum** | **5b lesson-detail + stream-url mint**.
10. **Resume-across-devices ±2s (`docs/02 §21`).** `lesson_progress.last_position_s` is the
    single source of truth (per enrollment, not per device), so resume is device-agnostic by
    construction; the ±2s is a throttle/report-interval concern (report on pause/seek/interval),
    QA asserts it.
11. **Cross-tenant test debt (S1-3).** Single-tenant simplification persists; P3 adds
    video/progress. Security review (#10) SHOULD add the cross-tenant isolation test on the new
    tables now (content + progress is a fresh IDOR surface).

---

## Open questions / secrets the user must provide for P3

- **`VideoProvider` credentials — ONE of the following, user-provided (provider is `Noop` /
  fail-closed until set):**
  - **Cloudflare Stream (default):** `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_STREAM_API_TOKEN`,
    and the **signing key** (`CLOUDFLARE_STREAM_SIGNING_KEY_ID` + `CLOUDFLARE_STREAM_SIGNING_KEY_PEM/JWK`)
    used to mint short-lived signed HLS tokens; **or**
  - **Mux (swap):** `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, and the **signing key**
    (`MUX_SIGNING_KEY_ID` + `MUX_SIGNING_KEY_PRIVATE`) for signed playback URLs.
  - Plus the **transcode-webhook secret** for the chosen provider
    (`CLOUDFLARE_STREAM_WEBHOOK_SECRET` **or** `MUX_WEBHOOK_SECRET`) to HMAC-verify transcode-
    status webhooks. All added to `.env` + the zod env schema.
  - **Until provided:** `NoopVideoProvider` is active (deterministic fake signed URLs for
    tests/local); the real adapter is **fail-closed** (stream-url → 503, never a raw URL);
    transcode webhooks are inert. Exactly the P2 Razorpay-keys pattern.
- **NOT needed in P3 (no new provider surface):** no new payment / SMS / email / WhatsApp keys
  (`RAZORPAY_*`, MSG91, SES/Resend, WhatsApp — untouched; P2/P6). No `LiveClassProvider`
  (Zoom/Meet) — live deferred. **S3/R2 storage is NOT required for HLS** (the video CDN serves
  it); only lesson-`resources` signed download would need it, and that's deferred to P4 — so
  **no new storage secret in P3** unless `resources` download is pulled forward.
- **Product decisions (defaults chosen if no answer):**
  1. **Q1 (video provider default):** **Cloudflare Stream** as the default adapter, Mux as the
     documented swap. *Default:* Cloudflare Stream.
  2. **Q2 (signed-HLS TTL):** short — **≤ 5 minutes**, re-minted on play/expiry. *Default:* 5 min.
  3. **Q3 (watermark depth):** **client overlay** (name + student id) in P3; provider burned-in
     forensic watermark deferred. *Default:* client overlay.
  4. **Q4 (live classes):** **DEFERRED** — recorded HLS only in P3; no `live_classes` table.
     *Default:* defer.
  5. **Q5 (PWA offline depth):** **app-shell service worker + install** only; offline *video
     download* deferred. *Default:* shell-only.
  6. **Q6 (`resources` table):** include table + read-only list if cheap; **defer signed
     download** to P4. *Default:* table+list in, download deferred (db-architect may defer whole
     table if it bloats W1).
  7. **Q7 (recorded-completion → attendance policy):** completing a recorded lesson marks one
     `attendance` `source=recorded` row per (enrollment, lesson), idempotent. *Default:* that.

---

## Definition of Done for the whole phase (gate to P4)

- [ ] Migration adds `videos`, `lesson_progress`, `attendance` (+ `resources` if kept; **not**
      `live_classes`) + the 4 enums + reverse relations (uuid PK, tenant_id, soft-delete,
      indexes incl. `lesson_progress (enrollment_id,lesson_id)` uniq + `videos (lesson_id)`
      uniq + recorded-attendance no-dup), wired to soft-delete + audit; seed creates the LMS
      student-surface permission matrix (`docs/02 §9`) + sample recorded lessons/videos(Noop)/
      progress/attendance on the sample program.
- [ ] zod DTOs for dashboard/enrollments/curriculum/lesson/**stream-url**/progress/attendance in
      `@repo/types`, imported FE+BE; `@repo/api-client` regenerated with SDK methods for each;
      the **stream-url DTO carries only a short-TTL signed URL + expiry + watermark — never a
      raw asset/manifest URL**.
- [ ] `VideoProvider` lives behind the interface + DI token (payment-provider pattern);
      `NoopVideoProvider` for tests/local; the real Cloudflare Stream / Mux adapter is
      **fail-closed** until keys set; env zod-validated; signed-URL + webhook signature unit-
      tested with deterministic vectors; **no vendor SDK called from a feature module**.
- [ ] LMS backend: `GET /me/dashboard`, `/me/enrollments`, `/me/enrollments/:id/curriculum`
      (enrollment-gated, preview open), `GET /lessons/:id`, **`GET /lessons/:id/stream-url`**
      (enrollment + RBAC check → short-TTL per-user signed HLS + watermark, no raw URL, audited),
      `PUT /me/lessons/:id/progress` (enrollment-scoped upsert), mark-complete (+ completion
      rollup + idempotent recorded attendance), `GET /me/progress`, `GET /me/attendance` — all
      `@RequirePermission` + enrollment-scope, every mutation audited.
- [ ] `apps/lms` (Next.js PWA): Dashboard (continue-learning + course cards + progress rings +
      upcoming), My Courses, Course/curriculum (preview vs locked), Lesson player (signed HLS +
      watermark + progress reporting + resume ±2s + mark-complete + autoplay-next), My Progress
      — RBAC/enrollment-aware (only own enrollments), loading/empty/error everywhere, a11y AA
      (captioned keyboard player), **PWA installable + app-shell service worker** (offline video
      download deferred).
- [ ] **`docs/02 §21` (P3 slice) proven by integration test:** a student can **only** stream
      content for programs they're enrolled in; **stream URLs are short-TTL and cannot be reused
      or shared**; **resume returns within ±2s**; **no raw URL** reaches the client.
- [ ] **Enrollment-scope IDOR proven:** a non-enrolled / different student is blocked
      **server-side** (403/404 + logged) from curriculum, stream-url, progress read/write, and
      attendance; preview lessons are the only pre-enrollment-viewable content.
- [ ] **Idempotency proven:** replayed progress/mark-complete does NOT double-count attendance or
      corrupt the completion rollup; transcode webhook signature-verified + idempotent + fail-closed.
- [ ] Every create/update on `videos`(status)/`lesson_progress`/`attendance` + each stream-url
      mint writes an audit-log row with actor + timestamp.
- [ ] Unit + integration tests green (enrollment-scope + stream-url TTL/scoping + progress/rollup
      + attendance idempotency + no-raw-URL + each scope mode); `turbo run build lint test` +
      `test:integration` green; optional light e2e (login → open course → play → resume) if added.
- [ ] a11y AA pass on new `@repo/ui` primitives (VideoPlayer/ProgressRing/CourseCard/
      CurriculumAccordion/ContinueLearning) and the new LMS screens (keyboard player, captions,
      focus mgmt, SR labels; no color-only status).
- [ ] security-reviewer sign-off: no high/critical open on enrollment-scope IDOR / signed-media
      leakage / raw-URL / watermark / preview-bypass / tenant isolation / webhook / secret leakage.
- [ ] README + ADRs + `docs/phase-3-followups.md` synced; `docs/05 §10` reflects `videos`/
      `lesson_progress`/`attendance`(+`resources`) as Implemented (P3); live-classes + offline-
      download + `resources`-download + BullMQ-transcode-worker tracked as follow-ups.
