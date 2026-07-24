# Plan: Phase-11 — Locked page templates (supersedes the P10 block builder UX)

> **Status: DONE.** P1–P6 all shipped. ADR-0063 records the decision (supersedes
> ADR-0062's authoring model); `docs/specs/phase-10-page-builder.md` carries a superseded
> notice; deferred items are tracked in `docs/phase-11-followups.md`.

> Direction set by product owner (2026-07-22): the Phase-10 free block builder is
> too heavy. Marketing pages must be **fixed layouts with editable text/image
> fields only** — no add / remove / reorder / block-picker. Colleges become a
> dedicated CRM-managed list (like mentors and courses). SEO stays per-page and
> gains a per-page social/OG image.

## Decision summary

- **Remove the block-authoring capability entirely.** Every core marketing page is
  a **fixed template**: an ordered, pinned set of sections. Staff edit field values
  (headings, paragraphs, images, list items) — they cannot change the page's shape.
- **Reuse the P10 engine internally.** Storage (`ContentPage.body` JSON), the web
  block renderer, versioning/undo, server-side preview, live-collection resolution,
  and the hardcoded down-safe fallbacks are all kept. "Blocks" become an internal
  storage detail, invisible to staff. We are deleting the *authoring UX*, not the
  data model.
- **Colleges = dedicated CRM list**, backed by the existing `Partner` model, shown
  live on the site via the existing partners live-collection — identical model to
  mentors (`Mentor`) and courses (`programs`). "Add more colleges" = add a row.
- **SEO:** per-page `seoTitle`/`seoDescription` retained; add a new **per-page OG
  image** (current gap — OG image is sitewide-only today).

## What staff see afterward

Open a page → a fixed form of sections → edit text, swap images, edit list items →
Save (live) → Preview / Version history / revert. Colleges, mentors, and courses
fill themselves in from their own CRM lists. The layout cannot be broken.

## Phases & ownership

### P1 — Contracts & template registry  (api-designer) — DONE
- New `packages/types/src/content/page-templates.schemas.ts`: a registry mapping each
  slug (`home`, `about`, `scholarship`, `for-colleges`, `gallery`, `careers`) → an
  **ordered, fixed list of section descriptors**, each reusing the existing per-block
  data schema from `page-builder-blocks.schemas.ts`. Sections are pinned by
  `{ key, blockType, label, editableFields }`; no discriminated-union authoring.
- Add `seoImagePath?` to the ContentPage + ContentPageVersion DTOs and the public
  page schema (`pages.schemas.ts`).
- Colleges CRM CRUD DTOs (list/create/update/delete) over `Partner` (college
  category) + confirm `PublicPartnerSchema` carries `focus`/`established`/`city`.
- Regenerate `@repo/api-client`.

### P2 — Schema, migration, seed  (db-architect) — DONE
- Add `seoImage` column to `ContentPage` and `ContentPageVersion` (forward-only
  migration).
- Seed: normalize the 6 core pages to their fixed template body + `status=published`
  + `isBuilderManaged=true`; map any existing stored blocks into template slots,
  fill missing slots from section defaults. Seed sample colleges as `Partner` rows.
- Keep `Partner` fields as-is (already has focus/established/city).

### P3 — API  (backend-builder) — DONE
- Content-page save validates `body` against the page's fixed template (reject
  extra / missing / reordered sections — the server, not just the UI, enforces the
  lock). Persist + return `seoImage`. Keep preview + versioning + optimistic
  concurrency.
- Colleges CRUD endpoints (RBAC: reuse `content.builder` / a `partners` permission),
  scoped + soft-delete + audit-log per house rules.

### P4 — CRM  (frontend-builder) — DONE
- Replace `page-builder-editor.tsx` with a **template form editor**: render the
  page's fixed sections as field groups (text / rich-text / image picker / repeatable
  list rows where a section is a list). Delete `BlockPicker`, add-block, remove-block,
  reorder, drag-and-drop, and the free-builder create drawer.
- Keep Save (live), Preview, Version history + revert, unsaved-changes guard, and the
  SEO disclosure; add per-page **OG image** upload to the SEO disclosure.
- New **Colleges** admin screen (list + add / edit / remove), mirroring existing CRM
  list pages (ConfirmDialog delete pattern).

### P5 — Web  (frontend-builder) — DONE
- Promote the code-owned spliced sections (`ExploreCourses`, `MentorsTeaser`) and
  colleges to proper fixed template sections fed live; drop the hardcoded
  `PartnerColleges` from the primary path (retain as fallback only).
- Wire per-page OG image into `buildMetadata`.
- Remove the `/pages/[...slug]` catch-all + `RESERVED_SLUGS` machinery (no ad-hoc
  pages any more). Keep all hardcoded fallbacks for down-safety.

### P6 — QA & docs  (qa-engineer, docs-writer) — DONE
- Replace builder tests: server rejects add/reorder/extra-section; template
  validation; colleges CRUD; per-page OG image in metadata; renderer parity.
- ADR superseding ADR-0062; update `docs/specs/phase-10-page-builder.md`, the P10
  note in `CLAUDE.md`, `docs/05-database-design.md`.

## Checkpoint

P1–P2 are additive/safe and start immediately. **Pause for confirmation before P4/P5
delete the builder UI and routes** (the destructive step). — Confirmed; P4/P5 executed
and closed out. All phases (P1–P6) are DONE.
