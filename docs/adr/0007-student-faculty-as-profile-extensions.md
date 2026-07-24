# ADR 0007: Student and faculty modeled as 1:1 profile extensions of users

## Status
Accepted

## Context
`docs/05-database-design.md §3` specifies `student_profiles` and `faculty_profiles`
as tables that extend `users`. The design left open *how* creation should work —
whether a student/faculty record can exist without a corresponding `users` row, or
whether the `users` row is always created first (or in the same operation).

Phase-1 (`docs/03-prd-crm.md §7.2/7.3`) requires the CRM to manage students and
faculty without a separate identity-management flow. Admin staff must be able to add
a student or faculty member from a single form in the CRM; the underlying user account
(for future LMS login) must be created automatically in the same operation.

## Decision
`student_profiles.user_id` and `faculty_profiles.user_id` are `@unique` foreign keys
to `users`, enforcing exactly a 1:1 relationship at the DB level. No profile row can
exist without a corresponding user row.

Creating a student or faculty member is a **single atomic transaction** that:
1. Creates (or upserts) a `users` row (with a random temporary password).
2. Assigns the appropriate role (`student` / `faculty`) via `user_roles`.
3. Creates the profile row (`student_profiles` / `faculty_profiles`) with the new
   `user_id` as the FK.

This transaction runs inside NestJS services (`students.service.ts`,
`faculty.service.ts`) using a Prisma interactive transaction (`$transaction`), so all
three rows land atomically or none do.

Soft-deleting a student/faculty profile does **not** automatically soft-delete the
underlying `users` row — the user record remains (a student may later be re-activated
or become alumni); the profile's `deleted_at` is the authoritative lifecycle signal
within CRM scope checks.

## Consequences
- Staff create students and faculty through one CRM flow without needing to manage
  user accounts separately; the LMS account is implicitly ready when created.
- The 1:1 FK uniqueness is enforced at the DB layer — there can never be two profiles
  for one user, nor a profile with no user, catching bugs at the constraint level
  rather than application logic.
- Deleting a profile does not cascade to the user, which is the right behavior (user
  history, sessions, and audit logs must be preserved).
- Future P2+ work (e.g. lead-to-student conversion, self-registration) will need to
  join the existing `users` row rather than create a new one; the 1:1 unique
  constraint will enforce that no duplicate profile is created.
- The "temporary password" created for new students/faculty is opaque to CRM staff
  (not returned in any API response). A password-reset / "set your password" email
  flow is required before P3 LMS launch so students can actually log in.

## Alternatives considered
- **Profile-first, user on-demand**: create a profile row referencing a nullable
  user_id, then create the user lazily when the student/faculty needs to log in.
  Rejected — a nullable FK is harder to reason about, breaks the 1:1 guarantee,
  and defers the complexity without reducing it.
- **Separate staff-facing identity management before profile creation**: require
  admins to create a user record first, then link it to a profile. Rejected —
  two-step flows for a single logical action are a UX anti-pattern and were
  explicitly out of scope for P1 CRM efficiency goals.
