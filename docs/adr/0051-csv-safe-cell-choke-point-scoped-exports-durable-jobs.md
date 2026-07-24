# ADR 0051: CSV-injection-safe exports — single `csvSafeCell()` choke-point, scope-pinned queries, durable `export_jobs`/`report_schedules`

## Status
Accepted

## Context
**LOCK-D4** of the phase-7 spec mandates a single shared `csvSafeCell()` choke-point for
CSV-injection neutralization (AC-28, AC-29), carried since P2 M-4 / P5 M-3 / P6 M-4. Exports
must also never leak data outside the requester's scope (AC-30, AC-31, AC-32, Rule H-2), must
handle large exports without an out-of-memory condition or timeout (AC-33), and must deliver
files via signed short-lived links consistent with the existing `StorageProvider` signed-URL
pattern (ADR-0027).

## Decision
- Every CSV export writer routes every cell value through **one shared `csvSafeCell()` helper**
  before serialization: any value beginning with `=`, `+`, `-`, `@`, or a tab/CR character is
  prefixed with a neutralizing character (a leading single quote). No export path implements its
  own escaping; a static/lint-level test scans every CSV-writing call site to enforce this
  (AC-29).
- Export request parameters are **structurally pinned to the same scope-filtered query used by
  the on-screen equivalent view** — there is no separate "export query" code path. The export
  service reuses the exact repository method/query builder the dashboard/report endpoint already
  calls with the caller's resolved scope (branch/assigned/own/all), so an export can never
  return more rows or columns than the caller's on-screen view (Rule H-2, AC-30, AC-31, AC-32).
- Two new durable tables, following the standard `id`/`tenant_id`/`created_at`/`updated_at`/
  `deleted_at` conventions (`CLAUDE.md §3.4`):
  - **`export_jobs`** — tracks on-demand and background export jobs (report type, filters,
    format, status, row count, storage key) and doubles as the audit trail for AC-36.
  - **`report_schedules`** — tracks scheduled recurring reports (report type, filters, cadence,
    recipient, next/last run) consumed by ADR-0048's cron dispatch.
- Large exports (AC-33) stream/paginate in bounded batches rather than loading all rows into
  memory; exports crossing a row-count threshold run as a background `export_jobs` row, with the
  client polling for completion and receiving a signed download link once ready.
- Files are written via **`StorageProvider.putObject`** (the existing signed-URL-capable
  interface, ADR-0027) and delivered to the client only as a **signed, short-lived download
  URL** — never a raw, permanently-guessable object URL (AC-35).
- Export requires a distinct **`reports.export`** permission, separate from the corresponding
  `reports.<domain>.view` permission (AC-34) — viewing a dashboard on-screen never implies the
  right to export its data.

## Consequences
- A single choke-point means any future export type automatically inherits CSV-injection safety
  by construction — a developer would have to deliberately bypass `csvSafeCell()` to reintroduce
  the vulnerability, and the lint-level scan catches that.
- Reusing the exact on-screen scoped query for exports eliminates the historically-risky pattern
  of a parallel, easier-to-get-wrong "export query" that silently omits a scope filter present in
  the on-screen path.
- `export_jobs`/`report_schedules` give exports and scheduled reports the same auditability and
  soft-delete semantics as every other business table.
- PDF exports reuse the same scope/permission rules as CSV (AC-40) — there is no separate,
  less-guarded PDF code path.
- One reviewer-confirmed residual: `reports.export`'s per-role grants (Part 8 of the spec)
  collapse some role-specific parentheticals (e.g. Counsellor "funnel only") into a single
  `reports.export AND <domain>.view` check rather than a full per-role-per-export-type
  allowlist — confirmed a strict subset of on-screen visibility, tracked as an open,
  non-blocking product decision in `docs/phase-7-followups.md` (M-1).

## Alternatives considered
- **Per-export ad hoc CSV escaping (status quo carried risk).** Rejected — this is precisely the
  pattern P2 M-4/P5 M-3/P6 M-4 flagged; every new export author would need to remember and
  correctly reimplement the escaping rule.
- **A separate, purpose-built "export query" per report**, optimized independently of the
  on-screen query. Rejected — doubles the surface area that must independently enforce
  RBAC/scope correctly, and is the exact bug class (a broader export query than its on-screen
  counterpart) Rule H-2/AC-30 exists to prevent.
- **`csv-stringify`** (an npm dependency) instead of a hand-rolled writer. Rejected per the
  plan's Decision 8 — a hand-rolled RFC-4180 writer with the injection guard built in avoids a
  new dependency for a well-understood, small amount of code.
- **Always-synchronous (non-background) export regardless of row count.** Rejected — a
  50,000+ row export risks a request timeout or out-of-memory condition (AC-33); the
  background-job-plus-signed-link pattern (already proven for certificates/invoices) handles
  both small and large exports uniformly.

## Related
Extends the `StorageProvider` signed-URL pattern (ADR-0027) to exports/reports. `report_schedules`
is consumed by ADR-0048's cron dispatch.
