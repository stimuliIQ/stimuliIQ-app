# Phase-1 follow-ups (carried into P2+)

Recorded at Phase-1 closeout (CRM core, Waves 1–6) so nothing found during the
security review, QA remediation, or left stubbed during the build gets lost going into
Phase 2. None of these blocked the Phase-1 GO decision; they are tracked here for
prioritization, not as open incidents.

## Security follow-ups (from the Wave 6 security review)

The review reached a **GO** verdict; no Critical or High findings were left open.
The items below were accepted as P2+ work:

| ID | Finding | Notes |
|---|---|---|
| S1-1 | System roles' permission matrix is editable by any `all`-scope admin | `roles.is_system = true` rows (super_admin, etc.) have no guard preventing an `all`-scope admin from replacing their grants via `PUT /admin/roles/:id/permissions`. Recommend a guard that rejects matrix edits on system roles entirely, or restricts them to a `super_admin` role only. See ADR-0010 for the privilege-escalation guard that covers scope elevation. |
| S1-2 | PII read access-logging not implemented | `docs/03-prd-crm.md §17` specifies that reads of PII fields (name, phone, email, college) should be logged. The current audit extension logs mutations only. Add a read-audit opt-in (e.g. an `@AuditRead()` decorator or an explicit service-layer call) before the CRM is used with real student data. |
| S1-3 | Cross-tenant IDOR not exercised in tests | All integration tests run against a single tenant (`stimuliiq`). The tenant-scope guards are implemented and visually inspected but not covered by a test that creates two tenants and verifies cross-tenant isolation. Cover in P2 or a dedicated security test pass. |
| S1-4 | ZodValidationPipe method-level + @Query coexistence assumption | There is currently no handler that combines a method-level `ZodValidationPipe` with a `@Query()` argument. If one is added, the author must supply a Zod schema for the query argument or accept unvalidated query params. See ADR-0011. Keep this assumption as a code-review checklist item. |

## Phase-1 deferred / stubbed items

| Item | What's deferred | Tracking |
|---|---|---|
| courses `assigned` scope fail-closed | Faculty with `assigned` scope on the `courses` module receive 403 in P1. Resolving it requires either a `programs.created_by` column (simple — faculty author of record) or an explicit program-faculty mapping table, plus wiring the `derive-via-batches` helper already stubbed in `courses.service.ts`. Prioritize in P3 (LMS course authoring). | ADR-0009 |
| DataTable row virtualization | `@repo/ui DataTable` uses server-side pagination only. A seam for adding `@tanstack/react-virtual` is documented in the component source. Wire when list views need to render 500+ rows without pagination (likely P7 analytics). | ADR-0012 |
| `apps/api/openapi/auth.openapi.json` naming artifact | The generated OpenAPI spec file is named `auth.openapi.json` but now contains the full auth + CRM API surface. Rename to `api.openapi.json` (or `openapi.json`) and update all references (`openapi.module.ts`, `@repo/api-client` generation, CI). Low risk — internal artifact only. | Wave 2 api-designer report |
| Playwright e2e + axe a11y audits for the CRM SPA | `apps/crm` has a no-op e2e stub. The CRM SPA now has real CRUD UI across 8 routes. Playwright critical-path journeys (create student, enroll, roles matrix edit) and axe a11y scans are needed. Pick up at P2 closeout or as a dedicated QA sprint. | Phase-0 followup (carried forward) |
| Multi-tenant resolution (hardcoded TENANT_SLUG) | `TENANT_SLUG = "stimuliiq"` is hardcoded in `auth.service.ts` (noted in `docs/phase-0-followups.md`). The same hardcoding exists in `prisma/seed.ts`. This remains a single-tenant simplification. Multi-tenant resolution (subdomain, header, or JWT claim) is required before a second tenant can use the platform. | Phase-0 followup (carried forward) |
| PII access logging | See S1-2 above. Expand the audit extension or add a read-audit mechanism before production use with real student PII. | docs/03 §17 |
| Soft-delete-bypass lint rule | QA remediation (Wave 5) found and fixed 6 call sites where raw `.delete()` / `.deleteMany()` calls bypassed the soft-delete extension. Recommend an ESLint rule or a Prisma extension-level assertion that flags direct `prisma.modelName.delete()` calls outside of the designated hard-delete purge paths. Until then, this is a code-review checklist item. | Wave 5 qa-engineer report |
| argon2id cost parameters not pinned | Carried forward from Phase 0 — see `docs/phase-0-followups.md`. |  |
| JWT `aud` claim absent | Carried forward from Phase 0 — see `docs/phase-0-followups.md` (M-4). |  |
| Inactive-account enumeration (M-5) | Carried forward from Phase 0. |  |
| IP-dimension rate limiting (M-6) | Carried forward from Phase 0. |  |
| Real provider keys (MSG91, Razorpay, SES/Resend, etc.) | Carried forward from Phase 0. Wire real adapters as each feature lands (P2 payments, P3 video, P6 email/WhatsApp). |  |
| Preview deploys | CI deploy jobs exist with `if: false` guards. Flip when hosting projects + secrets are provisioned. | Phase-0 followup (carried forward) |

## Test counts at Phase-1 closeout

| Suite | Count | Runner |
|---|---|---|
| Unit tests (Jest, all packages/apps) | 118 | `pnpm turbo run test` |
| Integration tests (testcontainers, `apps/api`) | 75 | `pnpm turbo run test:integration` |
| UI component tests (`@repo/ui`) | 39 | included in unit count above |
| e2e (Playwright) | 0 (no-op stub) | `pnpm turbo run e2e` |

## Where decisions (vs. TODOs) live

Notable architectural decisions made during Phase 1 are recorded as ADRs 0007–0012 in
`docs/adr/` (indexed in `docs/adr/README.md`), not in this file. This file is for
known gaps and planned work, not decisions.
