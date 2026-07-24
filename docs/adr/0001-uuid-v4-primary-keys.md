# ADR 0001: UUID v4 primary keys on every table

## Status
Accepted

## Context
`docs/05-database-design.md §1` left the PK type as "cuid/uuid" pending a decision.
The Phase-0 risk log (`docs/plans/phase-0.md`, open question #2) flagged this as
blocking for `db-architect` (Wave 2) since it affects every table and the generated
API client's id types. The user confirmed **uuid v4** over cuid2 before the schema
was written.

## Decision
Every table's primary key is `id String @id @default(uuid()) @db.Uuid` (Postgres
native `uuid` column, generated as v4). This applies uniformly across identity
(`tenants`, `branches`, `users`, `roles`, `permissions`, `role_permissions`,
`user_roles`, `sessions`) and catalog (`programs`, `modules`, `lessons`) tables, plus
`audit_logs`. Foreign keys are typed `@db.Uuid` to match.

Enum naming in `prisma/schema.prisma` uses lower\_snake-style values inside
PascalCase Prisma enum names (e.g. `enum UserStatus { active invited suspended
deactivated }`, `enum RolePermissionScope { all branch assigned own }`) — this was
an implementation detail not pinned in `docs/05`, recorded here rather than as a
separate ADR since it's a naming convention, not an architectural choice.

## Consequences
- Native Postgres `uuid` type — works with `gen_random_uuid()` if a row ever needs
  to be created outside Prisma, and is widely understood by every Postgres tool.
- IDs are non-sequential and reveal no creation-order information (a mild security
  plus over auto-increment integers).
- Slightly larger index/storage footprint than cuid2 or integers; not a concern at
  current/expected scale and `@db.Uuid` is more storage-efficient than storing
  cuid2 as text.
- `@repo/types` and `@repo/api-client` type all entity ids as `string` (UUID-shaped);
  no separate id-format validation was added beyond zod's `.uuid()` where used.
- `docs/05-database-design.md §1` should be read as superseded by this ADR on the
  cuid-vs-uuid question; the doc text itself was left as-is per the docs-writer rule
  of recording divergence in an ADR rather than rewriting settled spec prose for a
  decision that was always "TBD" in that doc.

## Alternatives considered
- **cuid2**: monotonically sortable-ish, shorter as text, popular in the Prisma
  ecosystem. Rejected because the user explicitly preferred native `uuid` for
  ecosystem-wide tooling compatibility (the Phase-0 risk log's recommended default
  was actually cuid2, but the user overrode it).
- **Auto-increment integers / bigserial**: simplest and smallest, but leaks
  row-count/creation-order and is awkward for any future cross-tenant/multi-region
  id generation. Rejected — conflicts with CLAUDE.md's multi-tenant-ready posture.
