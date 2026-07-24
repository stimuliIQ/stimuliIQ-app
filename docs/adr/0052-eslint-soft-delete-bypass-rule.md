# ADR 0052: ESLint rule against raw-Prisma soft-delete bypass

## Status
Accepted

## Context
`CLAUDE.md §3.4` mandates every table carry `deleted_at` and standard soft-delete semantics,
enforced via the Prisma client extension (ADR-0005). That extension only protects call sites
that go through the extended client — a developer can still call a raw (non-extended) Prisma
Client method, or a raw `$queryRaw`/`$executeRaw`, that bypasses the soft-delete-filtering
extension, silently reintroducing "deleted" rows into a result set or performing a hard delete
where a soft delete was intended. P7's security hardening pass looks for exactly this class of
latent bug across the growing P0–P7 codebase, where raw SQL is legitimately used in several
places (partial-unique-index migrations, the DPDP erasure job's historical-row pass) but must
not be used carelessly elsewhere.

## Decision
A custom ESLint rule is added to `@repo/config`'s eslint preset (enforced repo-wide in
`apps/api`) that flags:
- any call site using the raw (non-extended) Prisma client method surface for
  `delete`/`deleteMany` on a model registered as soft-deletable, and
- any raw `$queryRaw`/`$executeRaw` call that references a soft-deletable table without an
  accompanying `deleted_at IS NULL` predicate in the same SQL string (a pattern-match
  heuristic, not a full SQL parser).

Violations are **lint errors** (CI-build-breaking), not warnings — consistent with
`CLAUDE.md §3`'s non-negotiable rules being enforced at the CI gate, not left to code-review
discipline alone. Legitimate raw-SQL uses that intentionally bypass the filter (the DPDP
erasure job's historical-row anonymization pass, ADR-0049; the partial-unique-index migrations
themselves) are allowlisted via an inline `eslint-disable-next-line` with a required
justification comment — mirroring the existing `no-any` inline-justification convention
(`CLAUDE.md §3.1`).

## Consequences
- A future accidental hard-delete or an unfiltered raw query against a soft-deletable table now
  fails CI at lint time rather than surfacing later as a data-integrity incident (a "deleted"
  row reappearing), potentially in production.
- The rule is a heuristic (pattern-based, not semantic), so it can have false negatives against
  sufficiently obfuscated raw SQL — it materially raises the bar without claiming to be a
  complete formal guarantee.
- Existing legitimate raw-SQL bypasses needed one-time allowlisting with justification comments
  during this wave (the erasure job, the partial-unique-index migration SQL).

## Alternatives considered
- **Rely on code review alone.** Rejected — exactly the gap this rule exists to close; the
  soft-delete extension (ADR-0005) was already the "make it automatic, don't rely on
  discipline" answer for the ORM-level path, and the same philosophy applies to the raw-SQL
  escape hatch.
- **A runtime guard** (wrap `$queryRaw` to inspect the SQL string at execution time and throw).
  Rejected — runtime detection means the bug ships to a real environment before being caught (at
  best, a test run); a lint-time check catches it before merge, strictly earlier and cheaper.
- **Full SQL-parsing static analysis** (a proper AST-level guarantee). Rejected as
  disproportionate for now — no existing tool in the stack does this out of the box, and the
  heuristic pattern-match rule catches the realistic mistake shape (a bare `deleteMany` or a raw
  query missing the predicate) without the cost of building/maintaining a SQL parser.

## Related
Extends ADR-0005 (soft-delete Prisma extension) to the raw-SQL escape hatch. The DPDP erasure
job (ADR-0049) is a documented legitimate exception under this rule.
