# Phase-4 follow-ups (carried into P5+)

Recorded at Phase-4 closeout (Learning Depth, Waves 1–7 + security remediation) so
nothing found during the security review, QA remediation, or left stubbed during the
build gets lost going into Phase 5. None of these blocked the Phase-4 GO decision; they
are tracked here for prioritization, not as open incidents.

Test counts at Phase-4 closeout (after Wave 7 security remediation):
**609 unit tests** · **193 integration tests** (1 skipped) · 12 suites · LMS 18 ·
web 24 · ui 312. `turbo typecheck + lint + build` 23/23 green. Full critical-journey
integration test green: **login → submit assignment → take assessment → ops issues cert
→ download signed PDF → public verify resolves valid → revoke flips to revoked instantly**.

---

## Security follow-ups (Wave 7 review)

The Wave 7 security review returned **Conditional GO** — remediated to **GO** after
H-1 and M-1 fixes were applied within the same wave. No Critical or High findings were
left open.

| ID | Title | Status |
|----|-------|--------|
| H-1 | **Storage-key IDOR on submission file keys** | **FIXED this wave** — `POST /assignments/:id/submit` now validates that every entry in `files[]` is prefixed `submissions/{tenantId}/{enrollmentId}/`. Any key that fails this prefix check is rejected with 422 before the `Submission` row is created. Regression test added to the integration suite. |
| M-1 | **Public verify 429 missing `Retry-After` header (AC-H6)** | **FIXED this wave** — `ThrottlerGuard` on `GET /verify/:certUid` now sets the `Retry-After` header when returning 429. The threshold remains env-configurable (not hard-coded). |
| M-2 | **Certificate reissue hard-`@unique` on `certificates.enrollment_id`** | **CLOSED in P7** — a partial-unique constraint `UNIQUE(enrollment_id) WHERE deleted_at IS NULL` shipped in P7 Wave 1 (db-architect). Reissue now soft-deletes the old certificate row and inserts a new one, preserving the revoked row in audit history instead of a hard delete. See `docs/05-database-design.md §10` and `docs/phase-7-followups.md`. |
| L-1 | **JSON-LD `</script>` breakout not escaped on the web verify page** | Tracked. The OG/JSON-LD block on `apps/web/app/verify/[certId]/page.tsx` embeds `program` and `holderName` values from the verify response into a `<script type="application/ld+json">` block. If either field contains `</script>`, it would break out of the script tag. Sanitise both fields with a simple `replace(/<\/script>/gi, '<\\/script>')` before embedding. Low severity (the verify response is controlled by our own API, not arbitrary user input), but tracked as a correctness fix. |
| L-2 | **Verify rate-limiter logs client IP on Redis error** | Tracked/optional. When the Redis backing store for `ThrottlerGuard` is unavailable, the guard falls through with a warn log that includes the raw `X-Forwarded-For` value. If the IP value contains injection characters, this could affect log parsers. Sanitise the IP log value or switch to a fixed-format log entry. Low severity. |
| INFO-1 | **Cert-issue audit `after` redacts `cert_uid`** | Confirmed correct, no action. The audit log `after` snapshot for `certificates.issue` replaces `certUid` with `[REDACTED]` to prevent the signing token from appearing in the audit log (log-sink leakage of signing material). The reviewer confirmed this is the correct behaviour. |

**Confirmed correctly handled (evidence from the Wave 7 review):**
Certificate forgery verify (HMAC recomputed before any DB query — fabricated row or
guessed `cert_uid` fails at signature check with no information disclosure);
answer-key isolation (ADR-0030 — raw response JSON scan in integration suite finds zero
occurrences of `answerKey`/`answer_key`/`isCorrect`/`is_correct`/`correctOption`);
IDOR→404 on submissions/attempts/certificates (cross-student + cross-tenant);
grade-tamper audit (before/after on all grade mutations); DOMPurify on student-submitted
content in LMS + CRM grading views (P3 L-2 trust boundary resolved); cross-tenant
isolation integration tests added for submissions, attempts, and certificates (S1-3 debt
partially paid down — three new cross-tenant surfaces now tested).

---

## Phase-4 deferred / stubbed items

| Item | What's deferred | Tracking |
|------|-----------------|----------|
| BullMQ `certificate-gen` worker | `CertificatePdfPort` is bound to `ReactPdfCertificateAdapter` (sync, inline). The BullMQ `certificate-gen` queue and worker are the deferred path for bulk/auto issuance at scale. Seam present (ADR-0029). | ADR-0029, ADR-0020 |
| Bulk / auto certificate issuance | Single + small-batch sync issuance ships. Queue-driven bulk auto-issuance at scale deferred to a later phase (requires the BullMQ worker above). The PRD conflict (`docs/03 §7.7` "bulk + auto") is documented in `docs/specs/phase-4-learning-depth.md` CONFLICT-3. | `docs/phase-4-followups.md` |
| Certificate template designer UI | A seeded set of `certificate_templates` rows is present. The WYSIWYG drag-drop designer (`docs/03 §7.7`) is deferred to P7. PRD conflict documented as CONFLICT-2. | P7 |
| Code-execution assessment questions + sandbox | `QuestionType` enum is `mcq\|descriptive`. The `code` type requires a sandboxed runner (e.g. AWS Lambda, Firecracker). Deferred. PRD conflict (`docs/02 §7.9`) documented as CONFLICT-1. | Later phase |
| Proctoring beyond basics | P4 ships shuffle + server time-box + tab-switch flag only. Webcam/screen proctoring, lockdown browser, plagiarism detection, ML cheat detection deferred to a later hardening phase. | LOCK-1 |
| AV / malware scanning on submission uploads | Flagged by security review. The StorageProvider enforces content-type on signed upload URLs; cloud storage may also enforce it on PUT. However, a malicious file disguised as an allowed MIME type bypasses this check. AV scanning (e.g. ClamAV lambda trigger, AWS Malware Scanning) is a tracked follow-up — not in P4 scope. | Security follow-up |
| LinkedIn deep integration | Certificate sharing = a shareable URL + OG-image link on `apps/web/verify/[certId]`. LinkedIn "add to profile" deep API integration is out of P4 scope. | P7 or later |
| Grade / certificate-ready notifications | Domain events and audit rows are written on grade/issuance. Email, WhatsApp, in-app notification fan-out deferred to P6. PRD conflict (`docs/02 §7.15`) documented as CONFLICT-4. | P6 |
| Real StorageProvider S3/R2 keys | `STORAGE_PROVIDER` defaults to `noop`; the `NoopStorageProvider` returns deterministic fake presigned URLs for dev/CI. Wire when `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` (and optionally `STORAGE_ENDPOINT` for R2) are provisioned. See ADR-0027. | ADR-0027 |
| Certificate reissue partial-unique migration (M-2) | **CLOSED in P7** — see security follow-up M-2 above. | db-architect, shipped P7 Wave 1 |

---

## Notable engineering notes

- **`@react-pdf/renderer` v3 + React 18 pin in `apps/api`**: the PDF library is pinned
  to v3 (CommonJS) because v4 is ESM-only and breaks the NestJS/ts-jest CJS build.
  React 18 is installed in `apps/api` as a peer dependency of `@react-pdf/renderer`.
  `@types/react@19` resolves the dual-types conflict with `@repo/ui`. This installation
  is isolated to `apps/api` and must not be hoisted to the workspace root. Do not
  upgrade to v4 without resolving ESM interop first. See ADR-0029.

- **CRM has no automated test infra yet**: `apps/crm`'s `test` script is a no-op echo.
  CRM P4 screens (Academics ▸ Assignments / Projects / Assessments, Content ▸
  Certificates) are typecheck-verified, lint-verified, and build-verified but have no
  unit tests. This is a carried follow-up from P3's CRM surface — tracked for a future
  phase when the CRM test infrastructure is established.

- **Playwright browser e2e is still a no-op stub**: the full P4 critical journey
  (login → submit → take → issue → download → verify → revoke) is proven at the
  API-integration level (193 tests, 12 suites) and the integration test suite is the
  authoritative CI gate. Playwright browser e2e (`pnpm turbo run e2e`) remains a no-op
  stub. Carried forward from P1/P2/P3.

- **Cross-tenant isolation tests added (partial S1-3 debt paydown)**: three new IDOR
  surfaces (submissions, attempts, certificates) now have cross-tenant isolation tests
  in the integration suite. The single-tenant harness limitation from S1-3 is
  partially addressed; a full multi-tenant harness remains a future follow-up.

---

## Carried-forward still-open items (from `docs/phase-3-followups.md`)

The following items from earlier phases remain open and are not resolved by P4 work.
Full detail remains in the originating followups files; brief status only is given here.

| Item | Original tracking | Status |
|------|-------------------|--------|
| Real video provider keys blocked | `docs/phase-3-followups.md` | Still blocked. Two exposed `cfat_` Cloudflare tokens still need rotating. The `.env` still needs `CLOUDFLARE_ACCOUNT_ID` (not `CLOUDFLARE_STREAM_ACCOUNT_ID`) and `VIDEO_PROVIDER` set. See P3 followups for full detail. |
| `hls.js` approval for Chrome/Firefox | ADR-0026 | Still deferred. `pnpm add hls.js` requires explicit user approval. Safari/iOS native HLS works; Chrome/Firefox show "browser not supported." |
| BullMQ transcode webhook worker | ADR-0020 | Still deferred behind sync adapter. |
| Live-class attendance (`source=live`) | P3 followups | Still deferred. `live_classes` table not created. |
| Playwright browser e2e | P1/P2/P3 followups | Still a no-op stub (see note above). |
| Cross-tenant IDOR harness (S1-3) | P1 followups S1-3 | Partially paid down by P4 new surface tests; full multi-tenant harness still deferred. |
| Hardcoded `TENANT_SLUG = "stimuliiq"` | P1 followups | Carried forward. |
| PII read-audit (§17) | P1 followups S1-2 | Carried forward. |
| argon2id cost parameters not pinned | P0 followups | Carried forward. |
| JWT `aud` claim absent | P0 followups M-4 | Carried forward. |
| Inactive-account enumeration (M-5) | P0 followups | Carried forward. |
| IP-dimension rate limiting (M-6) | P0 followups | Carried forward. |
| Preview-deploy CI guards (`if: false`) | P0 followups | Carried forward. |
| OpenAPI list-query-param registration gap | P2 followups | Carried forward — cosmetic only. |
| `auth.openapi.json` rename artifact | P1 followups | Carried forward. |
| DataTable row virtualization seam | ADR-0012 | Carried forward — wire in P7. |
| Skipped integration test — public-intake over-post body | P2 followups | Carried forward. |
| P2 M-3 `getOrderById` BranchManager false-404 | P2 followups M-3 | Carried forward. |
| P2 M-4 UTM/name stored unsanitized | P2 followups M-4 | Carried forward. |
| P2 M-5 `assignOwner`/`create` no target-owner tenant validation | P2 followups M-5 | Carried forward. |
| P2 L-1 Invoice advisory lock `hashtext` collision | P2 followups L-1 | Carried forward. |
| P2 L-2 Coupon `used` incremented before order row created | P2 followups L-2 | Carried forward. |
| P2 L-4 Forged `razorpay_order_id` nuisance DoS | P2 followups L-4 | Carried forward. |
| System roles' permission matrix editable by any `all`-scope admin (S1-1) | P1 followups S1-1 | Carried forward. |
| P3 L-3 CSRF exclude path prefix mismatch | P3 followups L-3 | Carried forward. |

---

## PRD conflict log (P4)

| Conflict ID | PRD section | PRD says | P4 gate decision | Resolution |
|-------------|-------------|----------|-----------------|------------|
| CONFLICT-1 | `docs/02 §7.9` | "MCQ, code, descriptive" question types | Code questions OUT of P4 | Requires execution sandbox. `QuestionType` enum extensible. Tracked above. |
| CONFLICT-2 | `docs/03 §7.7` | "Certificate templates (designer)" | Seeded templates only; no designer UI | Designer is P7 scope. Seeded templates unblock issuance. Tracked above. |
| CONFLICT-3 | `docs/03 §7.7` | "bulk + auto issuance" | Sync single/small-batch only | BullMQ worker seam present; bulk is a configuration change. Tracked above. |
| CONFLICT-4 | `docs/02 §7.15` | Grade + certificate-ready notifications | Notifications fan-out deferred to P6 | Domain events + audit rows written; fan-out is P6. Tracked above. |

---

## Where decisions (vs. TODOs) live

Notable architectural decisions made during Phase 4 are recorded as ADRs 0027–0033 in
`docs/adr/` (indexed in `docs/adr/README.md`), not in this file. This file is for
known gaps and planned work, not decisions.
