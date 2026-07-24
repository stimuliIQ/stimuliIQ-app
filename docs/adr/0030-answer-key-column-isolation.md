# ADR 0030: Answer-key column isolation via child table and student DTO structural omission

## Status
Accepted

## Context
MCQ auto-grading requires the correct answers to be stored server-side so the backend
can score a submitted attempt without any client involvement. The naive design stores
questions inline in `assessments.questions` (JSON column) with each question having an
`is_correct` flag on each option or an `answer_key` field.

The problem with inline JSON: any query that returns the `assessments` row to a student
automatically exposes the answer key unless the backend manually strips the relevant
fields from the JSON blob before serialisation. This manual stripping is fragile —
a future developer adding a new DTO or a new query path might accidentally include the
raw `assessments.questions` JSON and expose the answer key. The risk is particularly
high at the ORM layer: a `prisma.assessment.findUnique({ include: { ... } })` call that
includes the raw column leaks the key.

`docs/05 §3` listed `assessments` with `questions(json/ref)`, acknowledging both the
inline-JSON and the child-table ("ref") forms. The Phase 4 plan explicitly chose the
"ref" form (child table) for security reasons (plan §6 Risk #3).

## Decision

Questions are stored in a separate `assessment_questions` table. The `answer_key` column
lives on that table and is a physically separate column from `options`:

```prisma
model AssessmentQuestion {
  // ...
  options   Json?       // MCQ choices: [{ id, text }] — NO is_correct field
  answerKey Json?       // SERVER-ONLY: correct option id(s) or rubric descriptor
  // ...
}
```

**The `options` array deliberately omits any `is_correct` or `correct` field.** A
choice object is `{ id: string, text: string }` and nothing more. The correct answer
is stored only in `answerKey`.

**Student-facing DTO (`AssessmentQuestionPublic` in `@repo/types`):**

```typescript
type AssessmentQuestionPublic = {
  id: string;
  type: 'mcq' | 'descriptive';
  prompt: string;
  options?: Array<{ id: string; text: string }>;   // no is_correct / answer_key
  points: number;
  order: number;
  // answerKey is structurally absent — not optional, not null, not present
};
```

The `AssessmentQuestionPublic` type is a compile-time assertion: the field does not
exist in the type. A developer cannot accidentally include it because the type system
prevents assigning an object with `answerKey` to `AssessmentQuestionPublic[]` without
an explicit cast.

**Repository-level enforcement:** The student-facing repository method that fetches
questions uses a Prisma `select` clause that explicitly excludes `answerKey`:

```typescript
await prisma.assessmentQuestion.findMany({
  where: { assessmentId, deletedAt: null },
  select: {
    id: true, type: true, prompt: true,
    options: true, points: true, order: true,
    // answerKey: intentionally omitted
  },
  orderBy: { order: 'asc' },
});
```

The grading-path repository method (used only by the backend service during
auto-grade at submit time, never by a student-facing endpoint) selects `answerKey`
explicitly. This method is in the assessment repository's internal/private API surface
and is not exposed through the module's public exports.

**Integration test assertion:** The QA suite includes a test that makes an
`/assessments/:id/attempts` request as an authenticated student, captures the raw
HTTP response JSON, and asserts that none of the keys `answerKey`, `answer_key`,
`isCorrect`, `is_correct`, `correctOption`, `correct_option` appear anywhere in the
serialised response body (recursive key scan). This test runs in CI and gates merges.

## Consequences
- A new query that accidentally includes `answerKey` via an ORM `include: { questions: true }` call will expose the key — but it will also fail the integration test, catching the regression before merge.
- The child-table design adds a join on every assessment fetch. This is acceptable —
  `assessment_questions` rows are small (dozens per assessment) and the join is indexed
  on `assessment_id`.
- The `docs/05 §3` `assessments` table entry previously read `questions(json/ref)`.
  The P4 implementation uses the `ref` (child table) form exclusively. The
  `docs/05-database-design.md` §3 table has been updated to reflect this.
- Future question types (e.g. `code` execution, when a sandbox is available) add rows
  to `assessment_questions` with `type='code'` — no schema migration needed, only a new
  handler in the auto-grading service.

## Alternatives considered
- **Inline JSON with server-side strip**: store `questions` as JSON on the `assessments`
  row; remove `answerKey` fields in the service before serialisation. Rejected — the
  stripping logic is fragile, not type-checked, and invisible to future developers who
  add new query paths.
- **Separate `answer_keys` table (1:1 with questions)**: even more physically isolated
  but adds a second join and more migration complexity for what is effectively a single
  column concern. Rejected — the child-table design already achieves the isolation goal
  with one join.
- **Encrypted `answer_key` column**: encrypt at the application layer so the column is
  unreadable without the decryption key. Adds complexity and does not eliminate the
  serialisation risk (the ciphertext would still appear in a careless response). Rejected
  — the DTO structural omission + repository select is a simpler and more auditable
  control.
