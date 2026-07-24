# ADR 0049: DPDP erasure — write-time PII masking in the audit extension + privileged historical-row anonymization job

## Status
Accepted

## Context
The phase-7 plan's Decision 7 named the tradeoff explicitly: PII-minimization vs. audit
immutability (`docs/05 §6`, `CLAUDE.md §3.4`). P5 L-1 and P6 L-2 both flagged that raw
phone/email values sit inside `audit_logs.before`/`after` JSON snapshots with no erasure path.
AC-64 (headline), AC-65, and AC-66 require: erasure redacts PII inside `audit_logs` without
deleting the rows themselves; erasure is permission-gated and cannot be triggered against
another user by a non-privileged caller; and the erasure job's table/column coverage is
exhaustive and fails loud (not silently incomplete) when a new PII-bearing column is added.

## Decision
Two-part policy, combining both options the plan raised rather than choosing one exclusively:

1. **Write-time masking, going forward.** The soft-delete/audit Prisma client extension
   (ADR-0005) now consults a **`PII_FIELD_REGISTRY`** — an explicit, centrally-maintained map of
   `{ table: [piiColumnNames] }` — and hashes/masks any registered PII field's value inside the
   `before`/`after` JSON snapshot **at the moment the audit row is written**, for every
   mutation, not only ones related to an active erasure request. New audit rows never contain
   raw PII from this point forward, so the erasure surface stops growing.
2. **A privileged, admin-only anonymization job for historical rows.** `POST /dpdp/erasure`
   (permission `dpdp.erasure.execute`, all-scope Admin/Owner only, AC-65) walks every
   `audit_logs` row referencing the target user's registered PII values and replaces those
   specific field values with a redaction marker or stable one-way hash. **The `audit_logs` row
   itself is never deleted** (AC-64) — only the PII values inside its JSON snapshot are removed.
   The erasure action writes its own new `audit_logs` row recording that the erasure ran (actor,
   target user, count of rows redacted). The job is idempotent — running it twice against an
   already-redacted user is a no-op, not an error (matching the plan's concurrent-erasure edge
   case).
3. **`PII_FIELD_REGISTRY` coverage is enforced in CI** by a schema-vs-registry diff (or an
   explicit allowlist test) that fails loudly if a new PII-bearing column is added to the schema
   without a corresponding registry entry (AC-66) — closing the "erasure silently misses a new
   table" failure mode.

Business-record rows (enrollments, orders, certificates) are never deleted or PII-redacted as a
side effect of erasure — only direct-identifier fields inside audit snapshots (and any other
explicitly registered PII columns) are targeted. The business record itself remains a legitimate
financial/academic record.

## Consequences
- Audit-log append-only integrity is preserved (rows are never deleted) while satisfying the
  DPDP right-to-erasure obligation for the PII values themselves.
- Write-time masking means the erasure surface shrinks over time automatically — the historical
  anonymization job only ever has to handle the pre-P7 backlog of unmasked rows plus any future
  registry gaps, not an ever-growing raw-PII corpus.
- A CI-enforced registry means a future engineer adding, e.g., a `whatsapp_number` column to a
  new table cannot silently create a new unmasked-PII surface without the build failing.
- The historical-row job is necessarily a scan over `audit_logs` matching a user's registered
  PII values (there is no forward index from "user X's PII" to "audit rows containing it" other
  than a JSON-value search) — acceptable at current single-tenant scale; flagged as a future
  optimization if the table grows large enough to make the scan slow, not gated by any P7 AC.

## Alternatives considered
- **An erasure job only, with no write-time masking.** Rejected — leaves every future audit-log
  write raw-PII by default, meaning every subsequent erasure request would need to re-scan an
  ever-growing table indefinitely instead of the gap shrinking over time.
- **Hard-delete the `audit_logs` rows referencing the erased user.** Rejected — violates
  audit append-only integrity (`CLAUDE.md §3.4`) and destroys the record of a legitimate
  historical action (e.g. "who created this order") for reasons unrelated to the PII value
  itself.
- **Crypto-shredding** (encrypt PII fields per-subject, delete the key on erasure). Considered,
  rejected for P7 — adds key-management infrastructure (per-subject keys, a secure key store)
  disproportionate to the current single-tenant scale; in-place redaction is simpler and equally
  effective for the DPDP obligation. Revisit if multi-tenant scale demands it.

## Related
Extends the soft-delete + audit Prisma client extension (ADR-0005). Resolves P5 L-1 and P6 L-2.
