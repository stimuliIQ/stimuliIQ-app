# ADR 0004: OpenAPI derived from zod (not the reverse); hand-typed `@repo/api-client`

## Status
Accepted

## Context
`CLAUDE.md §3.2` requires validation at every boundary with zod, with DTOs living
in `@repo/types` and reused by both frontend and backend. `docs/04-trd-architecture.md
§2.14` specifies a `{ data, meta, error }` response envelope and RFC-7807 error
shape. Phase-0 task #7 (`docs/plans/phase-0.md`) needed a concrete generation
strategy: either hand-write OpenAPI and derive zod from it, hand-write zod and derive
OpenAPI from it, or generate the API client from a separately maintained OpenAPI spec.

## Decision
**Zod schemas in `@repo/types` are the single source of truth.** OpenAPI 3.1 is
*derived* from those schemas via `@asteasolutions/zod-to-openapi`, written to
`apps/api/openapi/auth.openapi.json` and served by the API. `@repo/api-client` is
**hand-typed** (a small fetch wrapper: `packages/api-client/src/http/client.ts`,
`packages/api-client/src/auth/auth.api.ts`) rather than generated from the OpenAPI
document, importing types directly from `@repo/types`.

Covers: `login`, `refresh`, `logout`, `otp/request`, `otp/verify`, `MeResponse`, the
`{ data, meta, error }` envelope, and RFC-7807 problem-details for errors.

## Consequences
- Adding or changing a field happens once, in a zod schema in `@repo/types`; both
  the NestJS DTOs and the OpenAPI doc update automatically, and the FE types update
  the moment `@repo/types` is rebuilt — no schema drift between client and server is
  possible by construction.
- The OpenAPI document becomes documentation/interop output (useful for Postman,
  external integrators, or codegen for other consumers) rather than a hand-maintained
  contract — it cannot itself drift from the runtime validation since it's generated
  from the same schemas the API actually enforces.
- Hand-typing `@repo/api-client` (rather than running an OpenAPI codegen step) trades
  a small amount of manual SDK-writing for each new endpoint against simplicity: no
  codegen toolchain/build step, full control over cross-cutting concerns (cookie/CSRF
  handling, the `onUnauthorized` refresh seam, retry/error mapping) that generated
  clients usually fight against. This does mean the SDK's surface area must be kept
  in sync with new endpoints by hand as the API grows — worth revisiting (switch to
  codegen against the now-accurate OpenAPI doc) if the number of endpoints grows large
  enough that hand-typing becomes a bottleneck.
- This pattern needs to be repeated for every future module's contracts (commerce,
  LMS, CRM CRUD) — establishing it cleanly in Phase 0 is intentional so api-designer
  has a proven template going into P1+.

## Alternatives considered
- **Hand-write OpenAPI, generate zod + TS types from it**: keeps OpenAPI as the
  "contract of record," which some teams prefer for cross-team API governance.
  Rejected because it adds an extra generation step on the *runtime validation* path
  (zod) where correctness matters most, and NestJS + zod already integrate cleanly
  without OpenAPI in the loop.
- **Fully generated API client from OpenAPI** (e.g. `openapi-typescript-codegen`,
  `orval`): removes hand-typing but produces a client API shape dictated by the
  generator, which would need additional wrapper code anyway to handle the
  cookie/CSRF/refresh seam. Rejected for Phase 0; may be reconsidered later if the
  surface area grows (see Consequences).
