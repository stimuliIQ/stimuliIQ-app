# Phase-3 follow-ups (carried into P4+)

Recorded at Phase-3 closeout (LMS core, Waves 1–7 + security remediation) so nothing
found during the security review, QA remediation, or left stubbed during the build gets
lost going into Phase 4. None of these blocked the Phase-3 GO decision; they are
tracked here for prioritization, not as open incidents.

Test counts at Phase-3 closeout (after Wave 7 security remediation): **391 unit tests** ·
**158 integration tests** (1 skipped) · 11 suites · 0 e2e (no-op stub). CI runs
`install → typecheck → lint → unit → integration → build → e2e`.

---

## Security follow-ups (Wave 7 review)

The Wave 7 security review returned **Conditional GO** — remediated to **GO** after
the M-1 fix was applied within the same wave. No Critical or High findings were left
open.

| ID | Title | Status |
|----|-------|--------|
| M-1 | **Preview-lesson gate not tenant-scoped** | **FIXED this wave** — `findLessonById(tenantId, lessonId)` now filters `where: { id: lessonId, module: { program: { tenantId } } }`. Both the enrolled path and the preview path are now tenant-scoped. This was a latent cross-tenant information-disclosure risk on the `is_preview=true` path (the enrolled path already carried tenantId through the enrollment join). Gate and lesson-detail service updated. |
| L-1 | `updateVideoTranscodeStatus` uses `where: { id }` only | Acceptable — the `videoId` is resolved from a globally-unique `providerAssetId` via the HMAC-verified transcode webhook (no client can supply an arbitrary `videoId`). Add `tenantId` to the update predicate when multi-tenant migration lands. Tracked. |
| L-2 | `lesson-detail-content.tsx` renders reading content via `dangerouslySetInnerHTML` | Acceptable stored-XSS boundary for P3: lesson reading content is authored exclusively by faculty / CRM operators (RBAC-gated, trusted source). Sanitize with DOMPurify before authoring widens to less-trusted roles (e.g. student-submitted content). Tracked (frontend, P4). |
| L-3 | CSRF `exclude()` path `"lms/videos/webhook"` omits the `api/v1` prefix | Benign — same pattern as P2 L-3 (`"commerce/webhook"`). CSRF enforcement only applies when a session cookie is present; the transcode webhook is called by the video provider (no session cookie). The intent-vs-reality mismatch is a clarity gap, not a security gap. Add a comment; consider adding a test that confirms the exclusion resolves correctly. Tracked. |
| L-4 | Stream-url mint audit logs `userId/lessonId/provider/expiresAt` but NOT the URL | Informational — correct behaviour. Logging the signed URL would create a log-sink leak of short-lived tokens. No action required. |

**Confirmed correctly handled (evidence from the Wave 7 review):**
Enrollment IDOR→404 (unenrolled students receive 404 identical to not-found; no
existence disclosure); signed-media no-leak (raw `providerAssetId` and manifest URL
never sent to client — ADR-0021); preview-only bypass (enrollment=null reachable only
when `is_preview=true` — ADR-0022); per-user watermark derived server-side, never
client-supplied (ADR-0021); fail-closed webhook (HMAC-signed transcode webhook —
unverified payloads are dropped; Noop/Cloudflare/Mux adapters all fail-closed without
credentials); progress and attendance idempotency (upsert + partial-unique index on
`(enrollment_id, lesson_id)` — ADR-0024); integer progress rollup (pct as integer,
no float arithmetic — ADR-0024); RBAC own-scope (userId/tenantId always from JWT, never
from client — ADR-0022); soft-delete respected on all P3 tables; audit coverage on
completion and attendance mutation events.

---

## DEFECT-1: VideoProvider DI crash (found + fixed, Wave 6)

`NoopVideoProvider` was initially bound with `useClass`. Nest's DI container detected
the `options = {}` default-value constructor parameter and attempted to inject `Object`,
which is not a registered provider — causing `AppModule` to fail to boot.

**Root cause:** The LMS module was not integration-smoke-tested inside a full NestJS
`AppModule` context until Wave 6. Isolated module tests passed; the full-app boot
failure was invisible to them.

**Fix:** Switched to `useFactory` (ADR-0023). All three adapters (Cloudflare, Mux, Noop)
are now constructed inside the factory function, bypassing DI metadata inspection.

**Process note:** Full `AppModule` integration smoke tests should run as early as
Wave 2 or 3 for any new feature module, not only at phase closeout. A simple boot test
(`await NestFactory.create(AppModule)`) would have caught this immediately.

---

## Phase-3 deferred / stubbed items

| Item | What's deferred | Tracking |
|------|-----------------|----------|
| Real video provider keys | `VIDEO_PROVIDER` defaults to `noop`; stream-url mint returns a deterministic fake `.m3u8` until `VIDEO_PROVIDER=cloudflare_stream` (or `mux`) plus signing keys are set. `.env.example` already includes the commented-out vars — Cloudflare: `CLOUDFLARE_STREAM_API_TOKEN`, `CLOUDFLARE_STREAM_SIGNING_KEY_ID`, `CLOUDFLARE_STREAM_SIGNING_KEY_PEM`, `CLOUDFLARE_STREAM_WEBHOOK_SECRET`; Mux: `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `MUX_SIGNING_KEY_ID`, `MUX_SIGNING_KEY_PRIVATE`, `MUX_WEBHOOK_SECRET`. Wire when keys are provisioned. **Activation attempted post-P3 (deferred):** user supplied Cloudflare account `<CLOUDFLARE_ACCOUNT_ID redacted — see .env>` + Mux keys, but both Cloudflare API tokens provided carried a `cfat_` prefix and failed `/user/tokens/verify` (code 1000 — a valid Stream token has no prefix). Minting only needs `CLOUDFLARE_ACCOUNT_ID` + a signing key (ID+PEM); a signing key is created via `POST /accounts/{id}/stream/keys`, which itself needs one valid Stream:Edit token. **Blocked pending a valid token / pasted signing key.** Also rotate the two exposed `cfat_` tokens (shared in chat). Note: `.env` still uses the wrong name `CLOUDFLARE_STREAM_ACCOUNT_ID` (should be `CLOUDFLARE_ACCOUNT_ID`) and `VIDEO_PROVIDER` is not yet present. | ADR-0021, ADR-0023 |
| `hls.js` engine — Chrome/Firefox playback | `VideoPlayer.createHlsEngine` prop is a documented seam left unwired. Safari/iOS native HLS works with real provider keys. Chrome/Firefox users see a "browser not supported" fallback. Wire `hls.js` after explicit dependency approval from the project owner. **Do not `pnpm add hls.js` without approval.** | ADR-0026 |
| BullMQ transcode webhook worker | `VideoWebhookProcessorPort` is bound to `SyncVideoWebhookProcessorAdapter` — transcode-status updates are processed inline in the HTTP request cycle. Swap to a BullMQ adapter when worker infra is wired (consistent with ADR-0020 pattern). | ADR-0020, ADR-0023 |
| Resource download URLs | `resources` table is migrated; lesson-detail DTO returns resource metadata (title, type, size). Signed download URLs from `StorageProvider` are not yet minted — the UI shows a "Download — Coming Soon" stub. Wire `StorageProvider` in P4 alongside the certificate/invoice PDF pipeline. | `docs/05-database-design.md §7` |
| Live-class attendance (`source=live`) | P3 attendance is `source=recorded` only. `attendance.live_class_id` FK is nullable. The `live_classes` table is not created in P3 (gate decision in `docs/plans/phase-3.md`). Live scheduling + `LiveClassProvider` land in P3.5 or P6-adjacent. | `docs/plans/phase-3.md` |
| PWA — offline video download | Not supported by design. Signed short-TTL per-user HLS URLs must never be persisted; the service worker skips all cross-origin and non-static requests. If an "offline mode" for downloaded content is ever required, it will need a different delivery mechanism (e.g. encrypted DRM download) and a new ADR. | ADR-0021, ADR-0025 |
| Captions / subtitles | `videos.captions` column (json) is migrated. The stream-url DTO does not surface explicit VTT track URLs. Captions are HLS-embedded (provider-side). Explicit caption track selection in the player UI is deferred to P4. | `docs/05-database-design.md §3` |
| Playwright e2e for LMS journeys | Critical-path journeys (enroll → watch → progress ping → mark-complete → attendance → progress_pct rollup) are not covered by Playwright. The e2e stub remains a no-op. Carried forward from P1/P2. | `docs/phase-2-followups.md` |

---

## Carried-forward still-open items (from `docs/phase-2-followups.md`)

The following items from earlier phases remain open and are not resolved by P3 work.
Full detail remains in the originating followups files; brief status only is given here.

| Item | Original tracking | Status |
|------|-------------------|--------|
| Cross-tenant IDOR integration test (single-tenant harness) | `docs/phase-1-followups.md` S1-3 | Still deferred — all tests run against a single tenant. |
| Hardcoded `TENANT_SLUG = "stimuliiq"` | `docs/phase-1-followups.md` | Carried forward — multi-tenant subdomain resolution required before a second tenant. |
| PII read-audit (§17) | `docs/phase-1-followups.md` S1-2 | Carried forward. |
| courses `assigned` scope fail-closed | ADR-0009 | Still deferred — P3 is student-side consumption, not authoring; no `programs.created_by` added. |
| argon2id cost parameters not pinned | `docs/phase-0-followups.md` | Carried forward. |
| JWT `aud` claim absent | `docs/phase-0-followups.md` M-4 | Carried forward. |
| Inactive-account enumeration (M-5) | `docs/phase-0-followups.md` | Carried forward. |
| IP-dimension rate limiting (M-6) | `docs/phase-0-followups.md` | Carried forward. |
| Preview-deploy CI guards (`if: false`) | `docs/phase-0-followups.md` | Carried forward — flip when hosting projects + secrets are provisioned. |
| OpenAPI list-query-param registration gap | `docs/phase-2-followups.md` | Carried forward — cosmetic only; client and backend validation are correct. |
| `auth.openapi.json` rename artifact | `docs/phase-1-followups.md` | Carried forward. |
| DataTable row virtualization (seam in place) | ADR-0012 | Carried forward — wire in P7 analytics. |
| Skipped integration test — public-intake over-post body | `docs/phase-2-followups.md` | Carried forward — one `.skip`'d test in `leads-intake-convert` spec. |
| P2 M-3 `getOrderById` BranchManager false-404 | `docs/phase-2-followups.md` M-3 | Carried forward. |
| P2 M-4 UTM/name stored unsanitized (CSV/PDF export path) | `docs/phase-2-followups.md` M-4 | Carried forward. |
| P2 M-5 `assignOwner`/`create` no target-owner tenant validation | `docs/phase-2-followups.md` M-5 | Carried forward. |
| P2 L-1 Invoice advisory lock `hashtext(tenantId)` collision | `docs/phase-2-followups.md` L-1 | Carried forward. |
| P2 L-2 Coupon `used` incremented before order row created | `docs/phase-2-followups.md` L-2 | Carried forward. |
| P2 L-4 Forged `razorpay_order_id` nuisance DoS on `verifyPayment` | `docs/phase-2-followups.md` L-4 | Carried forward. |
| System roles' permission matrix editable by any `all`-scope admin (S1-1) | `docs/phase-1-followups.md` S1-1 | Carried forward. |

---

## Where decisions (vs. TODOs) live

Notable architectural decisions made during Phase 3 are recorded as ADRs 0021–0026 in
`docs/adr/` (indexed in `docs/adr/README.md`), not in this file. This file is for
known gaps and planned work, not decisions.
