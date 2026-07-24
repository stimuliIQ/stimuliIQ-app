# ADR 0029: CertificatePdfPort seam (sync adapter now, BullMQ cert worker deferred) and `@react-pdf/renderer` v3 pin

## Status
Accepted

## Context
`docs/04 §2.11` requires HTML→PDF rendering for certificate generation. No PDF library
was installed at the start of Phase 4 — the plan explicitly required user approval before
installing any PDF library (listed as `ASK-USER-BEFORE-INSTALL`).

The seam-first approach from ADR-0020 (BullMQ deferred behind sync adapters) was applied
here as well: a `CertificatePdfPort` interface isolates the library choice, a
`NoopCertificatePdfAdapter` produces deterministic stub bytes so the full eligibility →
uid → store → verify flow can be tested without any real PDF library, and the BullMQ
`certificate-gen` worker is deferred behind the seam. The sync `SyncCertificateGenAdapter`
handles inline generation for the P4 single/small-batch issuance flow.

**User approved `@react-pdf/renderer` v3** after the following options were presented:

| Library | Weight | CSS fidelity | CJS / TS | Verdict |
|---------|--------|-------------|----------|---------|
| `puppeteer` | Heavy (~200 MB Chromium) | Excellent (full browser) | CommonJS | Overkill for a certificate template |
| `playwright` (already a test dep) | Heavy (browser binary) | Excellent | CommonJS / ESM | Would pollute prod deps with a test tool |
| `pdfkit` | Light | Low (imperative API) | CommonJS | Poor DX for template rendering |
| `@react-pdf/renderer` v3 | Moderate | Good (React component DSL) | **CommonJS** | Approved |
| `@react-pdf/renderer` v4 | Moderate | Good | **ESM-only** | Rejected — breaks CJS/ts-jest backend |

**The critical version constraint:** `@react-pdf/renderer` v4 is ESM-only and cannot be
required by the CommonJS NestJS backend (which runs under ts-jest in CJS mode). Importing
v4 in `apps/api` causes ts-jest to throw `SyntaxError: Cannot use import statement in a
CommonJS module`. v3 ships a CommonJS build and integrates cleanly.

`@react-pdf/renderer` also requires a React installation in the environment where it
renders. `apps/api` installs React 18 (`react@18`) and `@types/react@19` (to avoid a
dual-types conflict with the P4 design-system package which exports React 19 types). This
React 18 installation in `apps/api` is **isolated to the certificate rendering context**
and does not affect the React 19 frontends (`apps/web`, `apps/lms`) or the Vite CRM
(`apps/crm`). The NestJS backend never renders interactive components; `react` is used
solely as a peer dependency for `@react-pdf/renderer`.

## Decision

**`CertificatePdfPort` interface:**

```typescript
interface CertificatePdfPort {
  render(template: {
    design: Record<string, unknown>;
    fields: Record<string, unknown>;
  }, data: {
    holderName: string;
    programTitle: string;
    issuedAt: Date;
    certUid: string;
  }): Promise<Buffer>;
}
```

**Adapters:**

1. **`ReactPdfCertificateAdapter`** — implements `CertificatePdfPort` using
   `@react-pdf/renderer@^3`. Renders a React PDF component from the template's
   `design` JSON and dynamic `data`. Returns PDF bytes as a `Buffer`.
2. **`NoopCertificatePdfAdapter`** — returns a fixed deterministic stub buffer
   (`Buffer.from('NOOP_CERT_PDF')`) for all inputs. Used in test environments and
   when the real PDF adapter is not wired. The entire issuance flow (eligibility →
   cert_uid → StorageProvider → DB row → verify) is exercisable with this adapter.

**Installed in `apps/api` only:**

```jsonc
// apps/api/package.json
{
  "dependencies": {
    "@react-pdf/renderer": "^3.x.x",
    "react": "^18.x.x"           // peer dep for @react-pdf/renderer v3
  },
  "devDependencies": {
    "@types/react": "^19.x.x"   // v19 types to match the shared ui package; avoids dual-types
  }
}
```

This installation is **explicitly scoped to `apps/api`**. It must not be hoisted to the
workspace root. Do not upgrade `@react-pdf/renderer` to v4 without first resolving the
ESM/CJS interop in the NestJS + ts-jest build (or migrating `apps/api` to ESM mode, which
is a significant build change requiring its own ADR).

**BullMQ `certificate-gen` worker (deferred — ADR-0020 pattern):**

The `CertificatePdfPort` is currently bound to `ReactPdfCertificateAdapter` (or the
Noop adapter for tests) and called inline (synchronously within the HTTP request cycle).
A BullMQ `certificate-gen` queue and worker are the deferred path for bulk/auto issuance
at scale. The seam is in place — swapping to a queue-driven adapter requires only a DI
binding change; no feature-module changes are needed.

## Consequences
- The `@react-pdf/renderer@^3` pin is a hard constraint on `apps/api` until ESM interop
  is resolved. CI will catch a version bump to v4 because the ts-jest run will fail
  immediately with a `SyntaxError`.
- React 18 is installed in `apps/api`. This is documented here and must not be confused
  with the React 19 installed in the frontend apps. The dual installation is intentional
  and contained.
- The `@types/react@19` devDependency in `apps/api` resolves the dual-types conflict
  that would otherwise cause TypeScript to see two conflicting React type definitions when
  `@repo/ui` (which uses React 19 types) is consumed by `apps/api`.
- The `NoopCertificatePdfAdapter` means all P4 tests, CI, and local dev run without any
  PDF rendering and without the React dependency being loaded at test time.
- Bulk certificate issuance at scale (the deferred BullMQ worker) will produce real PDFs
  asynchronously without blocking HTTP responses.

## Alternatives considered
- **`puppeteer` / `playwright`**: highest fidelity CSS rendering but introduces a
  headless Chromium binary (100–200 MB) into the production Docker image. Rejected for
  P4 scope — the certificate template is simple enough that a React-DSL approach is
  sufficient.
- **`pdfkit`** (imperative drawing API): no React component model; requires building
  a custom layout engine for the certificate template. Rejected — `@react-pdf/renderer`'s
  declarative component model is a better fit for JSON-driven templates.
- **`@react-pdf/renderer` v4**: ESM-only, incompatible with the NestJS/ts-jest CJS
  build without additional Babel/esbuild transform configuration. Rejected for P4;
  tracked as a future upgrade path.
- **Server-side HTML + Chromium (running in a Lambda/sidecar)**: correct architectural
  separation but adds infrastructure complexity. Appropriate if certificate volume demands
  it. Deferred to the BullMQ worker phase.
