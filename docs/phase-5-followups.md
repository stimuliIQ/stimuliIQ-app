# Phase-5 follow-ups (carried into P6+)

Recorded at Phase-5 closeout (Marketing Website + registration/payment funnel, Waves 1–7
+ security remediation) so nothing found during the security review, QA remediation, or
left stubbed during the build gets lost going into Phase 6. None of these blocked the
Phase-5 GO decision; they are tracked here for prioritization, not as open incidents.

Test counts at Phase-5 closeout (after Wave 7 security remediation):
**734 api unit tests** / 43 suites; P5 funnel integration spec **34/34** + public module
**71** tests; **web 175** ; workspace `turbo typecheck + lint + build` **23/23** green.
Full critical funnel journey (browse → enroll → register → pay → verify → exactly-one-
enrollment → LMS handoff) proven at the API-integration level.

---

## Security follow-ups (Wave 7 review)

The Wave 7 security review returned **NO-GO → GO** after C-1 and H-1 fixes were applied
within the same wave. No Critical or High findings were left open.

| ID | Title | Status |
|----|-------|--------|
| C-1 | **Account-takeover via `POST /public/register` existing-email session-mint** | **FIXED this wave** — for a pre-existing email, the service returns an enumeration-resistant 201-shaped body built entirely from caller-supplied input with **no tokens and no cookies**. OTP verification of a phone number does not confer ownership of an email account. `public.integration.spec.ts` + `public-funnel.service.spec.ts` updated to assert no `Set-Cookie` header, no access token, and no refresh token for the existing-email path. See ADR-0038. |
| H-1 | **Public coupon `programScope` compared as scalar vs. the JSON array — every program-scoped coupon mis-evaluated** | **FIXED this wave** — `validatePublicCoupon` in `public-funnel.service.ts` now uses `Array.isArray(scope) && scope.includes(programId)` semantics, mirroring `CommerceService.validateCoupon`'s `scope.includes()` logic. Previously `!== programId` on a JSON array was always `true`, silently rejecting every program-scoped coupon. Integration tests updated. |
| M-1 | **Honeypot returns 400 via `.strict()` instead of 422** | **TRACKED** — bots are blocked before any DB write (the control is effective). Recommended: add `_hp_email` as an `optional()` field to the public DTOs so the controller guard can return a generic 422 via `UnprocessableEntityException` instead of a 400 from the strict Zod parse. Low urgency; the current behaviour still blocks the bot. |
| M-2 | **Invalid-signature returns 422 vs. the spec/comment 400 in the shared `commerce.service.ts`** | **TRACKED** — no enrollment is created on an invalid signature; the security control is sound. The status-code divergence is in the shared P2 `CommerceService` and has a non-trivial blast radius for P2 callers. Changing it is deferred to avoid regressing P2 tests. Carry forward. |
| M-3 | **Regex HTML-strip is a weak sanitizer; real control is output-encoding at the CRM lead-render/CSV-export sink** | **TRACKED** — the `sanitize()` function in `public-funnel.service.ts` strips `<[^>]*>` before storing. This is adequate for preventing raw HTML in stored strings (resolves P2 M-4 for the new public-write volume). The definitive fix is output-encoding at every render/export sink in the CRM; extending the carried P2 M-4 item. Assign to `frontend-builder` (CRM) + `backend-builder` (CSV export) in a later phase. |
| L-1 | **Raw phone in lead-create audit `after`** | **TRACKED** — the `after` snapshot in the audit log for `lead.create` contains `phone`. PII minimization recommendation: replace with `phone: "[REDACTED]"` or a hash in the audit `after` field for the public-intake path. Low severity; the audit log is access-controlled. |
| L-2 | **LMS handoff relies on shared-cookie domain; confirm SameSite/domain or add a signed handoff token** | **TRACKED** — the `lmsRedirectUrl` returned by `POST /public/enroll/verify` assumes the student's session cookie is accessible on the LMS domain. If `apps/lms` runs on a different subdomain from `apps/web`, `SameSite=Lax` + `COOKIE_DOMAIN` must cover both. Alternatively, add a short-lived signed handoff token (HMAC or JWT, 30 s TTL) to the verify response that `apps/lms` can exchange for a full session. Assign to `devops` + `backend-builder` before go-live. |

**Confirmed-GOOD controls (Wave 7 evidence):**

- Captcha fail-closed in prod (`FailClosedCaptchaProvider` bound when `NODE_ENV=production`
  and provider is `noop` or `CAPTCHA_SECRET_KEY` absent — AC-44).
- Rate-limit fail-closed + trust-proxy correct (resolves carried P2 H-1): `PublicBookingRateLimiter`
  returns `true` (block) on Redis error; `X-Forwarded-For` trust is set correctly via
  `app.set("trust proxy", 1)` so the IP extracted is not spoofable.
- Payment-reuse integrity: funnel calls `CommerceService.verifyPayment` unchanged —
  signature verify + idempotency + order→enrollment atomicity (ADR-0014) inherited.
- Funnel IDOR→404: `order.studentId === req.user.id` check in `PublicFunnelService` before
  any order read/write; cross-student access returns 404 (AC-22).
- Public-projection allowlist: integration test scans raw response JSON for forbidden
  fields (`status`, `is_public`, `og_image_key`, `storage_key`, `answer_key`, `cost`,
  `margin`, `notes`, `tenant_id`) — zero occurrences.
- Secret-leak-free: `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, and `CAPTCHA_SECRET_KEY`
  absent from all API response bodies and client bundles (CI build artifact scan).
- JSON-LD `</script>` escaping: resolves P4 L-1 globally. `json-ld.test.ts` asserts
  that `escapeJsonLd` replaces all `</script>` occurrences before embedding. The shared
  helper in `apps/web/src/lib/seo/json-ld.ts` is the single choke-point (ADR-0037).
- CSP/HSTS: set in both `next.config.mjs` `headers()` and `apps/web/vercel.json` global
  headers. HSTS is omitted in dev (would lock localhost to HTTPS).
- DPDP consent: `ip_hash` is SHA-256 of the client IP; raw IP is never stored or logged.
  `consent.timestamp` is server-recorded (never client-supplied).
- Double-click reference guards: `useRef`-based re-entry guards in `use-book-slot`,
  `use-lead-capture`, and `use-enroll-funnel` hooks prevent double-submission from rapid
  client clicks. Backend idempotency (`idempotency_key` unique constraint + `provider_payment_id`
  unique constraint) provides the server-side safety net regardless of client behaviour.

---

## Engineering notes

- **Three funnel double-submit bugs found and fixed**: rapid double-click on the "Submit"
  / "Pay" button in the `use-book-slot`, `use-lead-capture`, and `use-enroll-funnel`
  hooks previously allowed a second request to start before the first completed. Fixed by
  replacing React `useState` loading flags (stale-closure-prone) with synchronous
  `useRef` re-entry guards (`if (inflightRef.current) return`). Backend idempotency
  ensures no harm even if two requests race through, but the client guard provides a
  cleaner UX.

- **Integration-suite test-isolation quirk on a persistent dev compose DB**: when all
  `*.integration-spec.ts` files run together against a shared ambient DB (the local
  `docker compose` Postgres from `infra/docker-compose.yml`), data accumulated from
  earlier test runs causes unique-constraint failures and count-assertion mismatches in
  later specs (e.g. "expected 1 enrollment, got 3"). Each spec passes when run alone.
  CI is unaffected because it uses testcontainers (fresh ephemeral DB per run).
  **Recommendation**: add a `beforeAll` that truncates relevant tables, or run integration
  tests locally with `pnpm turbo run test:integration` (which invokes testcontainers) rather
  than directly with Jest against the ambient DB.

- **`apps/web` gains `zod` as a direct dependency**: MDX frontmatter schemas (blog post,
  FAQ, team member, etc.) are validated at build time with `zod`. Previously `zod` was
  only a transitive dependency of `@repo/types`. Added to `apps/web/package.json` directly.

---

## Deferred / wired-but-gated

| Item | Deferred to | Notes |
|------|-------------|-------|
| Headless CMS + CRM content-authoring roles | CMS phase (P6+) | Marketing copy, blog, faculty bios, testimonials, partners, FAQ, gallery, and career roles ship as MDX. Programs/coupons remain CRM-managed. CMS + content-API is the next logical phase. See ADR-0035 and `CONFLICT-P5-1` in `docs/specs/phase-5-website.md`. |
| A/B testing framework, i18n/multi-language, personalization, chatbot lead-qualifier | P8 | Landing pages are A/B-ready in structure (single CTA, isolated layout); no experiment runtime. Content layer is structured for i18n but no locale routing. See `docs/specs/phase-5-website.md` out-of-scope table. |
| Email / WhatsApp / SMS confirmation sending | P6 | Confirmations (lead, booking, registration) only enqueue the domain event. Actual fanout via `MailProvider` / `WhatsAppProvider` / `SmsProvider` is P6. The site WhatsApp button is a click-to-chat deep link, not the Cloud API. See `CONFLICT-P5-2`. |
| LMS credentials email on enrollment | P6 | `POST /public/enroll/verify` returns a `lmsRedirectUrl` for immediate LMS handoff. A welcome email with LMS credentials is P6 (`CONFLICT-P5-5`). |
| Programmatic per-city SEO pages | P7 | `docs/01 §7.9` "programmatic SEO pages per program × city." Not built; requires city data model + URL strategy (`CONFLICT-P5-3`). |
| Global search across programs + blog | P7 | Requires `tsvector` / Meilisearch (`docs/05 §4`). Search trigger wired in the header; full-text implementation deferred (`CONFLICT-P5-4`). |
| True bundle-order product (one order covering multiple programs) | Later | Bundles/tracks display on pricing but resolve to existing per-program orders. A true bundle-order product requires commerce engine extension. |
| Playwright funnel e2e | Wired-but-skipped (carry from P1) | The `pnpm turbo run e2e` stub remains a no-op. The critical funnel journey is proven at the API-integration level (34/34 tests). API-integration is the authoritative CI gate. Playwright browser infra is a tracked fast-follow — land alongside P6 if feasible. |
| Lighthouse SEO ≥95 + axe CI gates as hard-fail | Flip when stable | Both `web-lighthouse` and `web-axe` CI jobs run with `continue-on-error: true`. Flip to `false` in `.github/workflows/ci.yml` and set `"error"` assertions in `lighthouserc.json` once the site reliably hits the budgets. |
| Razorpay go-LIVE | Pending explicit user decision | All Razorpay keys remain in TEST mode (`rzp_test_*`). Going live requires explicit user confirmation after full funnel validation in staging. Do not flip to live keys unprompted. |
| LMS handoff signed token (L-2 above) | Before go-live | If `apps/lms` runs on a different subdomain, add a short-lived HMAC handoff token. Assign to `devops` + `backend-builder`. |

---

## Carried-forward still-open items (from `docs/phase-4-followups.md`)

Brief status only; full detail remains in the originating followups files.

| Item | Original tracking | Status |
|------|-------------------|--------|
| Real video provider keys blocked; two `cfat_` tokens to rotate | `docs/phase-3-followups.md` | Still blocked. `VIDEO_PROVIDER=noop`. |
| `hls.js` approval for Chrome/Firefox | ADR-0026 | Still deferred. Safari/iOS native HLS works. |
| BullMQ transcode webhook worker | ADR-0020 | Still deferred (sync adapter). |
| Live-class attendance (`source=live`) | P3 followups | Still deferred. `live_classes` table not created. |
| Hardcoded `TENANT_SLUG = "stimuliiq"` / single-tenant | P1 followups | Carried forward. Every new public read resolves tenant server-side via `TENANT_SLUG` constant. Full multi-tenant harness still deferred. |
| Cross-tenant IDOR harness (S1-3) | P1 followups S1-3 | Partially paid down by P4 new surface tests; public-module integration tests add `tenantId` scoping tests. Full multi-tenant harness deferred. |
| PII read-audit (§17) | P1 followups S1-2 | Carried forward. |
| Certificate reissue partial-unique migration (M-2) | `docs/phase-4-followups.md` M-2 | Carried forward. Soft-delete semantics for reissued certs require `UNIQUE(enrollment_id) WHERE deleted_at IS NULL`. |
| P4 L-1 JSON-LD `</script>` escaping | `docs/phase-4-followups.md` L-1 | **RESOLVED IN P5** — `escapeJsonLd` shared helper in `apps/web/src/lib/seo/json-ld.ts` covers all pages including the existing verify page. ADR-0037. |
| argon2id cost parameters not pinned | P0 followups | Carried forward. `POST /public/register` uses `argon2id` (same as auth); cost parameter pinning applies here too. |
| JWT `aud` claim absent | P0 followups M-4 | Carried forward. |
| Inactive-account enumeration | P0 followups M-5 | Carried forward. |
| IP-dimension rate limiting | P0 followups M-6 | Carried forward. The `PublicBookingRateLimiter` is per-IP; the existing auth rate limiting is addressed separately. |
| Preview-deploy CI guard (`if: false`) for `apps/web` | P0 followups | **RESOLVED IN P5** — `deploy-preview-web` job is now active, gated on `vars.VERCEL_TOKEN_PRESENT == 'true'`. `lms`, `crm`, `api` remain `if: false`. |
| OpenAPI list-query-param registration gap | P2 followups | Carried forward — cosmetic only. |
| `auth.openapi.json` rename artifact | P1 followups | Carried forward. |
| DataTable row virtualization seam | ADR-0012 | Carried forward — wire in P7. |
| Skipped integration test — public-intake over-post body | P2 followups | Carried forward. |
| P2 M-3 `getOrderById` BranchManager false-404 | P2 followups M-3 | Carried forward. |
| P2 M-4 UTM/name stored unsanitized | P2 followups M-4 | **Partially resolved in P5** — new public-write paths sanitize input via `sanitize()` in `public-funnel.service.ts`. P2 CRM-write paths (leads created via CRM UI) are still unsanitized at the service layer; carry forward for CRM-side fix. |
| P2 M-5 `assignOwner`/`create` no target-owner tenant validation | P2 followups M-5 | Carried forward. |
| P2 L-1 Invoice advisory lock `hashtext` collision | P2 followups L-1 | Carried forward. |
| P2 L-2 Coupon `used` incremented before order row created | P2 followups L-2 | Carried forward. |
| P2 L-4 Forged `razorpay_order_id` nuisance DoS | P2 followups L-4 | Carried forward. |
| System roles' permission matrix editable by any `all`-scope admin (S1-1) | P1 followups S1-1 | Carried forward. |
| P3 L-3 CSRF exclude path prefix mismatch | P3 followups L-3 | Carried forward. |
| P4 L-2 Verify rate-limiter logs client IP on Redis error | `docs/phase-4-followups.md` L-2 | Carried forward. |
| AV / malware scanning on submission uploads | P4 deferred | Carried forward. |
| BullMQ `certificate-gen` worker | ADR-0029 | Carried forward. Sync adapter still in use. |
| `@react-pdf/renderer` v3 pin | ADR-0029 | Carried forward. Do not upgrade to v4 without resolving ESM interop. |
| CRM has no automated test infra | P4 engineering notes | Carried forward. `apps/crm` tests are typecheck/lint/build-verified only. |

---

## PRD conflict log (P5)

| Conflict ID | PRD section | PRD says | P5 gate decision | Resolution |
|-------------|-------------|----------|-----------------|------------|
| CONFLICT-P5-1 | `docs/01 §9` | Content managed from CRM by `marketing`/`content` roles via headless content API | MDX/typed-content for marketing/blog/trust copy; programs/pricing/coupons live from DB | MDX for launch; headless content API + CRM content roles deferred to CMS phase. ADR-0035. |
| CONFLICT-P5-2 | `docs/01 §7.7`, `docs/01 §22` | "triggers a WhatsApp/email confirmation" on lead/booking | P5 only enqueues the event; send is P6 | AC-1 and AC-6 in `docs/specs/phase-5-website.md` replace the §22 wording with "enqueued (not sent)". P6 owns fanout. |
| CONFLICT-P5-3 | `docs/01 §7.9` | "programmatic SEO pages per program × city" | Not built in P5 | Deferred to P7 (city data model + URL strategy). |
| CONFLICT-P5-4 | `docs/01 §7.1` | "Global search (programs + blog) with filters" | Not built in P5 | Deferred to P7 (tsvector / Meilisearch, `docs/05 §4`). |
| CONFLICT-P5-5 | `docs/01 §7.8` | "Welcome + LMS credentials → redirect to LMS" | Redirect/handoff CTA in scope; credentials email is P6 | Split: `lmsRedirectUrl` in verify response = P5; welcome email = P6. |

---

## Where decisions (vs. TODOs) live

Notable architectural decisions made during Phase 5 are recorded as ADRs 0034–0038 in
`docs/adr/` (indexed in `docs/adr/README.md`), not in this file. This file is for
known gaps and planned work, not decisions.
