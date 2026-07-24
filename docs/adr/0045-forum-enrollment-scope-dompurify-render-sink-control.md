# ADR 0045: Forum enrollment-scoped access (IDOR→404) with DOMPurify-at-render-sink as the XSS control

## Status
Accepted

## Context
P6's forum (WS-4) is the **widest user-generated-content (UGC) surface built so far** —
student-authored thread titles, post bodies, and nested replies render in both `apps/lms`
(student view) and `apps/crm` (moderation view). This extends a carried item: P3 L-2 and P5
M-3 both flagged that a **regex-based HTML-strip at the write path is a weak sanitizer**, and
that the real control belongs at the render/output-encoding sink, not at input storage.

Separately, forum access is scoped: students may read/post only in threads belonging to
batches they are enrolled in; faculty/admin moderate only batches assigned to them (or all
batches, for admin). The established IDOR pattern in this codebase
(ADR-0009/0018/0022/0031) is **fail-closed 404, not 403** — a non-enrolled/non-assigned
resource does not reveal its existence.

## Decision
**Access control:** every forum read/write is scoped by enrollment (student) or batch
assignment (faculty) at the repository query level, before any content is returned. A student
requesting threads/posts for a batch they are not enrolled in gets **404**, not 403 or an
empty-but-200 response revealing the batch exists (AC-55, AC-56 — AC-56 is the forum headline
AC). Faculty attempting to moderate a batch they are not assigned to likewise gets 404
(AC-64). Admin bypasses the assignment check (all-scope, AC-67). This mirrors the
`ScopeInterceptor` + fail-closed-guard pattern already proven for leads (ADR-0018),
enrollment (ADR-0022), and grading (ADR-0031) — no new scope-resolution mechanism was
invented for forum.

**XSS control:** **DOMPurify, applied at every render sink** (LMS student view, CRM
moderation view), is the actual security control against stored forum content containing
script/markup (AC-70). This resolves the carried P3 L-2 / P5 M-3 item **for the forum and
notification render surfaces** — DOMPurify-at-sink is now the documented pattern for
rendering any UGC in this codebase, not a per-feature ad hoc choice.

The **server-side regex HTML-strip remains in the write path** (`forum.service.ts` stores raw
content but strips obvious `<...>` markup before persisting) — this is retained explicitly as
**defense-in-depth only**, not the control. It is downgraded in scope to a length/shape
validator (max body length, AC-71's `BODY_TOO_LONG` 422) rather than being relied upon for XSS
prevention. If a payload somehow slips past the regex strip at write time, the DOMPurify
render-sink pass still neutralizes it — this is the point of defense-in-depth: **the render
sink is where the guarantee lives**, regardless of what happens at the write path.

## Consequences
- A forum post containing `<script>alert(document.cookie)</script>` cannot execute in any
  client that renders it — asserted by a render-level test (not merely a write-path test) that
  checks the sanitized output does not contain `<script`, `onerror`, or `javascript:` after
  DOMPurify runs (AC-70).
- Any **future** render sink for forum (or any other UGC) content that does **not** go through
  DOMPurify is **not covered** by this decision and must add its own render-sink control — this
  is explicitly called out as an open item (`docs/phase-6-followups.md` M-4) rather than
  assumed to be automatically safe.
- Enrollment/assignment changes take effect immediately at request time — an unenrolled
  student's next request to a previously-accessible batch's forum returns 404 (edge case,
  `docs/plans/phase-6.md` §Part 4), consistent with how enrollment-scope checks work
  elsewhere in the codebase (no cached authorization state).
- The regex write-path strip remains useful for defense-in-depth and for keeping obviously
  malformed markup out of the stored data, but engineers must not treat it as "the" XSS
  control when reasoning about this surface — DOMPurify-at-sink is.

## Alternatives considered
- **Rely solely on the write-path regex strip (no render-sink sanitization).** Rejected — this
  is precisely the P3 L-2 / P5 M-3 finding: a regex-based tag-strip is trivially bypassable
  (encoded payloads, attribute-based vectors like `onerror=`, `javascript:` URIs) and is not a
  substitute for sink-level sanitization. Forum, being the widest UGC surface yet, is where
  this gap becomes load-bearing rather than theoretical.
- **Store sanitized (not raw) content, sanitizing once at write time.** Rejected — sanitizing
  once at write time means any future change to the sanitization ruleset cannot be
  retroactively applied without a data migration, and it conflates "what we store" with "what
  is safe to render," which have historically diverged (e.g. markdown-ish source vs. rendered
  HTML). Storing raw + sanitizing at every render sink keeps the safety guarantee decoupled
  from storage and re-appliable if the sanitizer improves.
- **403 instead of 404 for non-enrolled/non-assigned forum access.** Rejected — consistent with
  every other IDOR surface in this codebase (leads, enrollment, grading), a 403 would confirm
  the resource's existence to an unauthorized caller; 404 is the standing fail-closed policy.

## Related
Extends the IDOR pattern of ADR-0009/0018/0022/0031 to the forum domain; resolves the P3
L-2 / P5 M-3 carried sanitization gap for the forum + notification render surfaces (see
`docs/phase-6-followups.md` M-4 for the remaining non-DOMPurify-sink follow-up).
