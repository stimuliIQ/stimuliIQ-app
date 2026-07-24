# ADR 0032: Assessment integrity — server-authoritative time-box, attempts enforcement, idempotent submit, and basics-only anti-cheat scope

## Status
Accepted

## Context
`docs/02 §7.9` specifies assessment anti-cheat requirements: shuffle, time-box, and a
tab-switch flag. It also mentions webcam proctoring, plagiarism detection, and a
lockdown browser as potential future capabilities. The P4 plan (§1 LOCK-1) explicitly
gates Phase 4 to "basics only": question shuffle, server-enforced time-box, and a
tab-switch flag that does not auto-submit.

Several integrity properties must be enforced server-side regardless of client state:

1. **Time-box**: a student cannot manipulate their local clock or delay a submission
   past the allotted window to get extra time.
2. **Attempts limit**: a student cannot start more attempts than `attempts_allowed` by
   replaying the start endpoint.
3. **Answer key**: the server must not release the correct answers until after grading
   (covered by ADR-0030).
4. **Idempotent submit**: a replay of the `PUT /attempts/:id` endpoint (network retry,
   double-click, caching) must not re-grade or double-count a score.
5. **Shuffle**: the server must determine question order, not the client.

## Decision

**Time-box:**

When an attempt is started (`POST /assessments/:id/attempts`):
- The server records `startedAt = NOW()` and computes
  `timeExpiresAt = startedAt + assessment.timeLimitS` (if `timeLimitS` is not null).
- Both values are stored on the `attempts` row and returned to the client.
- On submit (`PUT /attempts/:id`), the backend checks `NOW() <= timeExpiresAt`
  using the **server's clock**, ignoring any client-supplied timestamp.
- If `NOW() > timeExpiresAt`: return 422 with error code `ATTEMPT_EXPIRED`.
- `timeExpiresAt = null` for untimed assessments (no expiry enforced).

The client-side countdown timer (`CountdownTimer` UI component) is **advisory only** —
it helps the student track remaining time but the server does not trust it.

**Attempts limit:**

On `POST /assessments/:id/attempts`:
1. Count existing non-soft-deleted attempts for `(assessmentId, enrollmentId)`.
2. If `count >= assessment.attemptsAllowed`: return 422 with error code `ATTEMPTS_EXHAUSTED`.
3. If there is an in-progress attempt (a row with `submittedAt IS NULL` and
   `(timeExpiresAt IS NULL OR timeExpiresAt > NOW())`): return 422 with error code
   `ATTEMPT_IN_PROGRESS`.
4. Otherwise create the new attempt row with `attemptNo = count + 1`.

**Idempotent submit:**

On `PUT /attempts/:id` (submit answers):
1. Fetch the attempt. If `submittedAt IS NOT NULL`: the attempt was already submitted.
   Return 200 with the existing `score`, `passed`, and `submittedAt` (no re-grade).
2. If `submittedAt IS NULL` and the attempt is in the `timeExpiresAt` window: grade
   and update in a single transaction (MCQ auto-grade; descriptive → `passed = null`).

This makes the submit endpoint safe to replay on network error. A client that retries
after a timeout will receive the same 200 response as the original caller.

**Shuffle:**

When `assessment.shuffle = true`, the server randomises question order for each attempt
using a per-attempt seed derived from `attemptId` (deterministic — the same shuffle is
returned on `GET /attempts/:id` as on the initial `POST`). The order is not trusted from
the client. Question IDs in `answers` are matched by ID, not positional index.

**Anti-cheat basics:**

| Feature | P4 behaviour |
|---------|-------------|
| Question shuffle | Server-side per-attempt seed (see above) |
| Server time-box | Server sets `timeExpiresAt`; rejects post-expiry submits |
| Tab-switch flag | Client sends `PATCH /attempts/:id/flag { event: 'tab_switch' }` → increments `flags.tabSwitchCount` on the attempt row. **Does NOT auto-submit or terminate the attempt.** Faculty can view the flag count on the attempt detail page. |
| Webcam / screen proctoring | **OUT of P4 scope** |
| Lockdown browser | **OUT of P4 scope** |
| Plagiarism / ML detection | **OUT of P4 scope** |
| Code execution | **OUT of P4 scope** (no sandbox; QuestionType is `mcq | descriptive` only) |

**Manual grade for descriptive questions:**

When an attempt contains descriptive questions, `passed` remains `null` after auto-submit
(MCQ questions are scored; descriptive answer texts are stored as-is). The attempt is
visible to faculty through `GET /attempts?assessmentId=:id` (assigned-scope, ADR-0031).
Faculty use `PATCH /attempts/:id/grade` to set `{ score, passed: boolean }` after
reviewing descriptive answers. An audit log entry is written for this mutation.

MCQ-only attempts may not be manually graded (`422 MANUAL_GRADE_NOT_APPLICABLE` if a
faculty member attempts it on an already-auto-graded attempt).

## Consequences
- Clients cannot extend time or gain extra attempts by manipulating requests.
- Network retries on submit are safe — idempotent behaviour prevents double-grading.
- Tab-switch count is informational, not punitive, in P4. Faculty may use it as a
  signal for review but it does not affect the score or attempt validity.
- The scope gate for proctoring is documented here. A future phase that adds webcam/
  screen proctoring will need: a browser MediaDevices API surface in the LMS, a
  WebRTC or recording backend, a proctoring provider integration (e.g. ProctorU,
  ExamWatch), and a new ADR.
- Code-execution questions are similarly gated: the `QuestionType` enum is extensible
  (`mcq | descriptive` today), but a `code` type requires a sandboxed runner (e.g.
  AWS Lambda micro-VMs, Firecracker) and a separate ADR.

## Alternatives considered
- **Client-side time enforcement only**: simpler to implement but trivially bypassed
  by a student who intercepts the submit request and replays it after the countdown
  expires. Rejected — server enforcement is a hard requirement.
- **Hard-expire the attempt in the DB on timer expiry** (background job or TTL): would
  require a scheduled job or a Redis TTL to flip `submittedAt` to the expiry time. The
  current approach (check at submit time) is simpler and has the same security property.
  Deferred — a background auto-submit at expiry is a nice-to-have for student UX but
  is not required for integrity.
- **Auto-submit on tab-switch** (terminate attempt): more aggressive anti-cheat but
  penalises students for legitimate actions (switching to a reference tab, an OS alert,
  etc.). Rejected — LOCK-1 explicitly designates tab-switch as a flag, not a block.
