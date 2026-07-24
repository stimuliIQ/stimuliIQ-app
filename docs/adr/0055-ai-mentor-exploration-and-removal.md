# ADR 0055: AI-mentor chatbot — explored, then fully removed; mentors are human hires

## Status
Accepted

## Context
Early in Phase 8, before the human-mentor spec (`docs/specs/phase-8-mentor.md`) existed,
`CLAUDE.md §6`'s P8 line item read "AI mentor, placement/recruiter/college/parent portals,
multi-tenant SaaS" — naming an LLM-based, student-facing doubt-solving chatbot as a P8
deliverable. A separate exploratory track, tentatively specified as
`docs/specs/phase-8-ai-mentor.md`, began building this direction: a retrieval-augmented
chat feature backed by an LLM provider (`@anthropic-ai/sdk`) and a pgvector-based
semantic-retrieval data model (an `AiContentChunk` table with a `vector(1024)` column and
an HNSW cosine-distance index, sized for a 1024-dimension embedding output). Supporting
infrastructure was partially built: the local Postgres image in
`infra/docker-compose.yml` was swapped from `postgres:16-alpine` to
`pgvector/pgvector:pg16` to make the `vector` extension available, and uncommitted
migrations toward the `ai_content_chunks` table/HNSW index were drafted.

The user directed that this track be stopped and reversed. A "mentor" in this platform is
a real, named, **externally-hired subject-matter expert** who leads a batch of students
through the internship program to completion — per `docs/00-product-strategy.md §2`'s
"structured, mentor-led, project-based internships with a verifiable certificate"
positioning, the company's stated competitive wedge against Internshala/Coursera/Udemy.
Continuing to build an AI chat feature under the "mentor" name would have been a direct
mismatch with that product positioning and a source of ongoing confusion between two
entirely different meanings of "mentor" in the same codebase.

## Decision
The AI-mentor exploration was **fully removed**, not deferred or renamed:

- The `@anthropic-ai/sdk` dependency was uninstalled from `apps/api` — confirmed absent
  from `apps/api/package.json`.
- The `AiContentChunk` model and any other AI/LLM-specific schema objects were dropped from
  `prisma/schema.prisma` — confirmed absent; `MentorEngagementStatus`, `Mentor`, and
  `BatchMentor` are the only Phase-8 additions in the live schema.
- The (at most two) uncommitted migrations toward the AI data model were discarded rather
  than shipped — no `ai_content_chunks`/`vector` migration exists in
  `prisma/migrations/`.
- `docs/specs/phase-8-ai-mentor.md` itself was deleted.
- The codebase was rewound to its pre-AI-exploration baseline before
  `docs/specs/phase-8-mentor.md` (the human-mentor spec) was written and built.

One incidental, unrelated real bug fix discovered during that same work was deliberately
**kept**, not reverted along with everything else: `packages/api-client/src/engagement/
notifications.api.ts`'s `list()` method was double-prefixing its query string
(`toQueryString()` already returns a leading `?`, but the call site wrapped it again as
`` `?${qs}` ``, producing `??unread=true` and silently dropping the `unread` filter — the
P6 SSE-polling-fallback's unread filter never actually filtered). This fix is unrelated to
AI/mentor work and correct regardless of the reversal, so it was not rolled back.

`CLAUDE.md §6`'s P8 line item has been corrected to describe the human-mentor track
directly (external-hire mentors → batches → internship completion + mentor dashboard) with
an explicit parenthetical noting the AI-mentor chatbot "was explored and removed — mentors
are human hires, not AI." `docs/specs/phase-8-mentor.md`'s own references to the
now-deleted `docs/specs/phase-8-ai-mentor.md` (its header, LOCK-6, the Part 5 scope-boundary
table, the Part 6 conflict log, and the Part 8 dependencies table) are reworded in this same
docs-writer pass to describe the AI-mentor track as "explored and then removed," pointing at
this ADR instead of a deleted file.

If a student-facing AI doubt-solving feature is ever pursued again, it must be named and
specced independently of "mentor" (which now unambiguously means the human, externally-hired
batch lead in this codebase) and would need its own ADR for the LLM-provider and
retrieval-data-model decisions — none of the exploratory design from this reversed track is
binding or reusable precedent.

## Consequences
- "Mentor" is now an unambiguous term across the codebase and docs: a real, human,
  externally-hired subject-matter expert (`mentors` table, `mentor` role,
  `docs/specs/phase-8-mentor.md`). No chatbot, LLM provider, or vector-search code exists
  anywhere in the repository.
- Future readers of git history or old branches may still encounter the exploratory
  AI-mentor commits; this ADR is the canonical explanation for why that direction was
  abandoned, preventing re-litigation or accidental re-introduction without a fresh
  decision.
- **`infra/docker-compose.yml` still runs `pgvector/pgvector:pg16` locally**, with a header
  comment still attributing the swap to "Phase 8 Wave 1 (AI Mentor pgvector retrieval)."
  This has no functional impact — `pgvector/pgvector:pg16` is Postgres 16 with the `vector`
  extension available but unused, and no code in the current schema references `vector`
  columns or `CREATE EXTENSION vector` — but the comment is now stale, and the image itself
  could be reverted to `postgres:16-alpine`. This was **not** fixed by this ADR (docs-writer
  does not edit infra config) — flagged and tracked in `docs/phase-8-followups.md` for
  devops.
- No provider interface (`CLAUDE.md §1`'s `PaymentProvider`/`MailProvider`/etc. pattern) was
  ever added for an LLM/AI provider, so there is no dangling seam or dead interface to
  remove — the reversal is clean at the application-code level.

## Alternatives considered
- **Keep the AI-mentor exploration as a documented-but-unbuilt future spec (defer, don't
  delete).** Rejected per explicit user direction — the request was a full removal/rewind,
  not a deferral, specifically so "mentor" could be freed up to mean the human role
  unambiguously for the rest of Phase 8.
- **Rename the AI feature (e.g. "AI tutor" or "doubt-solving assistant") instead of removing
  it, to avoid the naming collision.** Not pursued — the user's direction was removal of the
  feature at this time, not a rename; a differently-named AI assistant remains a possible
  independent future decision (see Decision above), not something carried forward from this
  exploration.
- **Partial rewind (keep the `pgvector` Postgres image and schema scaffolding "for later
  reuse").** Rejected as an intentional choice for the schema/dependency layer (fully
  removed, per Decision) — the `docker-compose.yml` image is the one place this happened
  unintentionally, called out as a followup rather than treated as an accepted alternative.

## Related
Supersedes the exploratory (never-merged-to-a-named-ADR) AI-mentor design direction implied
by the original `CLAUDE.md §6` P8 wording. See ADR-0053 (Mentor role) and ADR-0054
(completion rollup + mark-complete) for the human-mentor track this decision cleared the
way for.
