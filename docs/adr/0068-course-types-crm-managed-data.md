# ADR-0068 — Course types become CRM-managed data, not a Postgres enum

**Status:** accepted · 2026-08-27
**Supersedes:** nothing (replaces the `StudentCourseType` enum introduced in `20260627073131_crm_core`)
**Related:** ADR-0064 (onboarding: CRM-authored questions), ADR-0063 (locked page templates — the opposite call, deliberately), `docs/specs/course-types.md`
**Migration:** `20260827120000_course_types_crm_managed`
**Seed step (live DB):** `pnpm db:seed:course-types`

---

## Context

Adding a student asked for a **course type**, and the dropdown offered exactly six things:
B.Tech, Degree, Diploma, MCA, MBA, Other.

Those six were not placeholder data. They were the Postgres enum `StudentCourseType`,
mirrored by a zod `z.enum` in `@repo/types` and by four hand-copied `{ value, label }` arrays
in the CRM (the add-student drawer, the registration step, lead conversion, and the directory
filter — plus a fifth free-text mapper in the Excel importer). Changing the list meant a
forward-only migration, a contract change, five UI edits and a deploy.

Two consequences, both of which had already happened:

1. **The list never changed.** It was written for the original B.Tech / MCA / MBA audience.
   The company has since repositioned to the healthcare field, where "B.Tech" is not a
   question you ask a nursing student — and it was a *required* field on every student
   record. Staff answered it by picking "Other", which is how a required field becomes noise.
2. **Two code paths invented an answer.** Website self-registration wrote a hardcoded
   `"btech"` and onboarding activation wrote `"other"`, because the column was `NOT NULL` and
   neither form asks the question. A fabricated qualification on a real person's record.

## Decision

### 1. The option list is a table staff maintain, with no deploy

`model CourseType` (`course_types`): `key`, `label`, `sort_order`, `active`, soft-deleted,
tenant-scoped. Managed at **Admin ▸ Course types**.

This is the same call ADR-0064 made for the onboarding form's questions, and the deliberate
opposite of ADR-0063's locked marketing templates. The distinction is what a non-engineer can
break: a marketing page has a *layout* that free composition ruins, so its shape is locked and
only field values are editable. **A list of options has no shape.** Adding "B.Sc Nursing" to a
dropdown cannot produce a broken page, so there is no reason it should require an engineer.

### 2. The student column stores the option's `key`, not a foreign key

`student_profiles.course_type` becomes `TEXT` holding `course_types.key`.

The key is generated from the label on create (`slugifyCourseTypeKey`, shared by the API and
the CRM so the form can preview exactly what will be stored) and is **immutable**. The label
is the only mutable half. That is the whole trick:

> Renaming "B.Tech" to "MBBS" is a rename of the OPTION. It is never a silent rewrite of what
> every existing student is recorded as.

An editable key would re-point every student row that stores it, invisibly. A foreign key
would have worked too, but a stored key keeps history self-describing — the same reasoning as
ADR-0064's answer snapshots — and keeps every existing filter, saved view, export and report
working on a readable value rather than a uuid.

Reads resolve `key → label` at request time (`courseTypeLabel` on the student DTOs), so a
rename shows up on every screen at once without touching a single student row.

### 3. Write-time membership, read-time tolerance

- **Writes** (`POST /crm/students`, `PATCH /crm/students/:id`, lead conversion) reject a key
  that is not one of the tenant's **active** options: 422 `course_types.unknown`. Hiding an
  option means "stop offering this", and an option new records could still be given is not
  hidden.
- **Reads** accept anything. A student recorded years ago against an option since hidden or
  deleted still renders — falling back to the raw key rather than a blank. History is shown as
  it was recorded.

### 4. The column is now NULLABLE, and the two invented defaults are gone

Website self-registration and onboarding activation write nothing. "We never asked" is a real
state, and it is more honest than `btech`. The CRM's own create form still requires a choice,
because the person filling it in knows the answer.

### 5. Delete is refused while the option is in use; hiding is the primary action

`DELETE` returns 409 `course_types.in_use` with the count, pointing at hiding instead. A
delete that orphans rows turns a student's qualification into a slug nobody can explain.

### 6. Read is gated on `students.view`; write on `course_types.manage`, which IS in the catalog

Deliberately asymmetric, and deliberately *not* the super-admin narrowing used for
`leave.approve` (ADR-0065) and `marketing_targets.manage` (ADR-0067):

- **Read → `students.view`.** Every role that can open the student directory needs the option
  list for its dropdown to render. A dedicated `course_types.view` key would have to be
  granted to every counsellor role separately — the kind of grant that gets forgotten and
  surfaces later as an empty dropdown with nothing on screen to explain it.
- **Write → `course_types.manage`, inside the permission catalog**, so the admin+super_admin
  catch-all grants it to both. Maintaining the list of qualifications the company offers is
  operational configuration, not authority over a person. `leave.approve` and
  `marketing_targets.manage` are narrowed precisely because they decide something *about* a
  member of staff; this does not.

A permission-catalog spec pins all of that, including the absence of a `course_types.view`.

## Consequences

- Staff can change the qualification list themselves. The healthcare repositioning no longer
  needs an engineer.
- The migration carries forward **exactly the values already in use, per tenant** — nothing is
  invented, and no student changes meaning. `seed-course-types.ts` seeds the permission and
  recovers any key a restored dump left behind, but **creates no new options**: a course type
  is a live business fact, and a plausible seeded list is chosen silently by whoever is in a
  hurry.
- The Excel importer no longer funnels unrecognised text into "Other". An unmatched cell is a
  row error naming the tenant's actual options, visible before anything is written.
- Exports now carry the label ("B.Sc Nursing") rather than the key.
- **Known limitation:** two tenants cannot share an option list, and there is no merge
  operation — retiring "Degree" in favour of "B.Sc" means hiding one and re-recording the
  affected students by hand. A bulk re-key action is the obvious follow-up if that turns out
  to be common.
