# Course types — CRM-managed, not an enum

**Status:** built · 2026-08-27
**ADR:** [ADR-0068](../adr/0068-course-types-crm-managed-data.md)
**Migration:** `20260827120000_course_types_crm_managed`
**Live-DB seed:** `pnpm db:seed:course-types`

---

## 1. What this replaces

The "Course type" dropdown on the add-student dialog offered six fixed values: B.Tech,
Degree, Diploma, MCA, MBA, Other. They came from the Postgres enum `StudentCourseType`,
mirrored in a zod `z.enum` and in four hand-copied arrays in the CRM. Changing the list meant
a migration, a contract change, five UI edits and a deploy — so it never changed, even after
the business repositioned to the healthcare field and the question stopped matching reality.

Staff now maintain the list themselves at **Admin ▸ Course types**.

## 2. The model

`course_types` (tenant-scoped, soft-deleted, audited):

| Column | Meaning |
|---|---|
| `key` | The slug written onto `student_profiles.course_type`. **Immutable.** Derived from the label on create. |
| `label` | What every screen shows. The only mutable half. |
| `sort_order` | Order in every picker. New options land at the bottom. |
| `active` | `false` hides it from pickers; existing students keep it. |

`student_profiles.course_type` is `TEXT NULL`, holding the `key`.

**Why a key and not a foreign key:** the key keeps history self-describing (the same call the
P12 onboarding answers made), and keeps every filter, saved view, export and report working on
a readable value rather than a uuid. **Why immutable:** every student row stores it, so an
editable key would re-point people's records invisibly.

**Why nullable:** website self-registration and onboarding activation never ask the question.
They used to write a hardcoded `"btech"` / `"other"` to satisfy `NOT NULL` — a fabricated
qualification on a real person's record. They now write nothing.

## 3. The rules

| Situation | Behaviour |
|---|---|
| Create/update a student, or convert a lead, with an ACTIVE key | Allowed |
| …with a HIDDEN key | **422 `course_types.unknown`.** Hiding means "stop offering this". |
| …with a key that does not exist | 422 `course_types.unknown` |
| Reading a student whose option was hidden | Renders normally, with the option's label |
| Reading a student whose option was deleted | Renders the raw key — never a blank |
| Rename an option | Every screen, export and report updates at once. No student row is touched. |
| Delete an option nobody holds | Allowed (soft delete) |
| Delete an option students hold | **409 `course_types.in_use`**, naming the count and pointing at hiding |
| Create an option whose name already exists | 409 `course_types.duplicate`; if the clash is hidden, the message says so |
| A tenant with no options yet | Every picker is disabled with "No course types yet. Add them under Admin → Course types." |

## 4. Permissions

| Action | Key | Held by |
|---|---|---|
| Read the list | `students.view` | Every role that can open the student directory |
| Create / rename / reorder / hide / delete | `course_types.manage` | super_admin + admin (in the permission catalog) |

There is deliberately **no `course_types.view`**: a second key would have to be granted to
every counsellor role just to make a dropdown render, and that grant is exactly the thing that
gets forgotten. `course_types.manage` deliberately stays **inside** the catalog, unlike
`leave.approve` (P13) and `marketing_targets.manage` (P15) — maintaining a list of
qualifications is configuration, not authority over a member of staff.

Pinned by `apps/api/src/modules/course-types/course-types.permission-catalog.spec.ts`.

## 5. Surface

**API** — `/api/v1/crm/course-types`

| Method | Path | Permission |
|---|---|---|
| `GET` | `/crm/course-types?activeOnly=` | `students.view` |
| `POST` | `/crm/course-types` | `course_types.manage` |
| `PATCH` | `/crm/course-types/:id` | `course_types.manage` |
| `DELETE` | `/crm/course-types/:id` | `course_types.manage` |

`POST` takes a `label` only — the key is derived server-side. `PATCH` accepts
`label` / `sortOrder` / `active`, never `key`.

**Shared** — `packages/types/src/crm/course-types.schemas.ts`, including
`slugifyCourseTypeKey` (run identically by the API, which generates the key, and by the CRM
form, which previews it) and `courseTypeLabel` (key → label with a raw-key fallback). Same
one-definition discipline as `computeLeaveDuration` (P13) and `buildOnboardingAnswerIssues`
(P12).

**CRM** — `Admin ▸ Course types` (`/admin/course-types`), plus one shared
`CourseTypeSelect` used by the add-student drawer, the registration step, lead conversion, the
directory filter and the export/report filters. The four hand-copied arrays are gone.

**Student DTOs** gained `courseTypeLabel` (resolved server-side, null when unset). The CSV
export carries the label, not the key.

**Excel import** matches the sheet's free text against the tenant's own options by label or
key, ignoring case and punctuation. An unmatched cell is a **row error** naming what to do —
it used to silently become "Other", which is how six hundred "MBBS" rows become six hundred
students recorded as something else.

## 6. Deploying to an existing database

```
prisma migrate deploy      # 20260827120000_course_types_crm_managed
pnpm db:seed:course-types  # the permission + its grants
```

Do **not** run the full `pnpm db:seed` against a live database — it upserts demo students,
programs and campaigns.

The migration is additive to existing data: it creates the table, inserts a row for **every
value already in use, per tenant** (with the labels the CRM has always displayed), then
converts the column and drops the enum. No student changes meaning, and no dropdown loses an
option.

`seed-course-types.ts` **invents no options** — the same judgement `seed-careers.ts` makes
about job openings and `seed-leave.ts` makes about holidays. Which qualifications a company
recruits for is a live business fact, and a wrong one is picked silently by whoever is in a
hurry. Author the real list in the CRM.

## 7. Known limitations

- No merge/re-key operation. Retiring "Degree" in favour of "B.Sc" means hiding it and
  re-recording the affected students by hand. A bulk re-key action is the obvious follow-up.
- The list is per tenant, with no shared/global catalogue.
- Reordering is one number per option edited on its own form, not drag-and-drop.
