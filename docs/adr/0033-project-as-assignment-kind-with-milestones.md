# ADR 0033: Project modeled as `assignment.kind=project` with `assignment_milestones` child rows (not a separate top-level table)

## Status
Accepted

## Context
`docs/02 §7.6` describes multi-milestone project submissions as a distinct capability
from single-submission assignments. Two modeling approaches were considered:

1. **Separate `projects` table** — a top-level resource with its own FK to lessons and
   its own milestone rows. Projects and assignments are sibling concepts.
2. **`assignments.kind` discriminator** — projects are assignments with
   `kind = 'project'`; milestones are rows in a child table keyed by `assignment_id`.

The plan (§7 Q7, LOCK-7) chose option 2. The reasoning is documented here.

## Decision

The `assignments` table carries a `kind` enum column (`AssignmentKind: assignment | project`).
All rows with `kind = 'project'` may have child rows in `assignment_milestones`.

```prisma
model Assignment {
  kind          AssignmentKind @default(assignment)
  isFinal       Boolean        @default(false) @map("is_final")
  // ...
  milestones    AssignmentMilestone[]
  submissions   Submission[]
}

model AssignmentMilestone {
  assignmentId  String    @map("assignment_id")
  title         String
  order         Int
  dueAt         DateTime?
  // ...
}
```

A `Submission` row carries a nullable `milestoneId`: when null, it is a plain
assignment submission; when set, it is a submission against a specific project
milestone. The same `Submission` model, the same grading endpoint
(`PATCH /submissions/:id/grade`), and the same audit logic handle both cases.

The `isFinal` flag on `Assignment` marks the project whose milestone completion gates
certificate eligibility. This is a boolean rather than a separate "final project" table
because at most one such assignment should exist per program — it is a property of the
assignment row, not a relationship. The eligibility engine queries
`assignments WHERE kind='project' AND is_final=true` within the enrollment's program.

**Eligibility logic for projects:**

`finalProjectApproved(enrollment) =`
- If no `Assignment` with `kind='project' AND is_final=true` exists in the program →
  `true` (vacuously satisfied).
- Otherwise: all `AssignmentMilestone` rows for the final project must have a
  corresponding `Submission` from this enrollment with `status='graded'`.
- For a project with zero milestones: the single `Submission` (no `milestoneId`) must
  have `status='graded'`.

**API surface:**

- `POST /assignments/:id/submit` — plain assignment submission (no `milestoneId`).
- `POST /assignments/:id/milestones/:milestoneId/submit` — milestone submission.
- `PATCH /submissions/:id/grade` — same grading endpoint for both.
- `GET /assignments/:id` — returns `kind`, `milestones[]` (if `kind='project'`), and
  the student's submissions per milestone (own-scope).

No separate `/projects` routes exist. The distinction between a plain assignment and a
project is exposed through the `kind` field on the `Assignment` DTO; the frontend
renders the appropriate UI based on this discriminator.

## Consequences
- The schema is simpler — one migration block for both assignments and projects rather
  than two separate tables with duplicated columns.
- The `Submission` model unifies all submission types; grading, audit, and
  resubmission logic is written once.
- Adding a new project-specific column in the future requires a migration that adds it
  to `assignments` with a constraint `WHERE kind='project'` or a check constraint. This
  is more complex than adding a column to a dedicated `projects` table but acceptable
  given the projected feature set.
- The `kind` discriminator must be checked at the service layer before accessing
  `milestones[]` — a plain `assignment` row will have an empty `milestones[]` array,
  which is correct but must not be confused with "a project with no milestones defined."
  The service validates this distinction.

## Alternatives considered
- **Separate `projects` top-level table**: cleaner column separation (projects can
  have project-specific columns without polluting `assignments`). Rejected — the
  submission, grading, audit, and resubmission logic would need to be duplicated or
  extracted into a shared service layer. The `kind` discriminator achieves the same
  semantic distinction with less duplication.
- **Inline milestones as JSON on `assignments`**: eliminates the child table. Rejected —
  milestone submissions need a `milestoneId` FK on `Submission` for referential
  integrity; inline JSON cannot be FK-referenced.
- **Polymorphic "task" parent** with assignment and project as subtypes: over-engineered
  for two variants; rejected.
