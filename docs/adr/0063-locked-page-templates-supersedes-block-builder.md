# ADR 0063: Locked, fixed-layout page templates — supersedes the Phase-10 free block builder authoring UX

## Status
Accepted. Supersedes ADR-0062's authoring model (ADR-0062 itself is retained for its
still-valid storage/versioning/RBAC decisions — see Consequences).

## Context
`docs/specs/phase-10-page-builder.md` and ADR-0062 shipped a free, block-based composer
for the 6 core marketing pages (`/`, `/about`, `/scholarship`, `/for-colleges`, `/gallery`,
`/careers`): a super_admin could add, remove, and reorder any of 11 block types from a
closed registry, save-is-live, with version history/revert and server-side preview.

In practice this gave the marketing team (a non-engineering audience) too much rope:
add/remove/reorder/block-picker let a page's *shape* be broken (wrong section order,
missing sections, duplicate/omitted blocks) with no server-side notion of "what this page
is supposed to look like" — only "is each individual block's `data` valid." The product
owner's direction (`docs/plans/phase-11-locked-templates.md`, set 2026-07-22): pages must
become **fixed layouts with editable text/image/list-row fields only**. Separately, the
homepage's `partner-colleges` section had a known, called-out parity gap (ADR-0062/spec
Edge case #11: `Partner` had no `focus`/`established`/`city` on the admin DTOs), and there
was no per-page social share image (only a sitewide OG-image fallback via `SiteSetting`).

## Decision

**a. Lock every core-template page to a fixed, ordered, pinned set of sections; delete
the authoring capability that could change page shape.** A new registry,
`packages/types/src/content/page-templates.schemas.ts`, maps each of the 6 slugs to an
ordered list of section descriptors (`{ key, blockType, label, editableFields }`) reusing
the existing per-block `data` schemas from `page-builder-blocks.schemas.ts` verbatim — no
new block types, no discriminated-union authoring. Staff open a page and get a fixed form
of sections to edit field values; there is no add/remove/reorder/block-picker UI anymore.
`page-builder-editor.tsx` (free-builder editor), `BlockPicker`, and the free-builder create
drawer are deleted from the CRM; a new template-form editor
(`apps/crm/src/lib/page-template-sections.ts` + its form components) replaces them.

**b. Reuse the entire P10 engine as an internal storage/rendering detail — this is an
authoring-UX change, not a data-model change.** `ContentPage.body` stays the exact same
`{ type, data }[]` JSON array; the `web` block renderer, `ContentPageVersion`
snapshot/revert history, save-before-apply optimistic concurrency, server-side preview,
`live_collection_ref` resolution, and the hardcoded down-safe fallbacks are all UNCHANGED.
"Blocks" become an implementation detail the CRM UI no longer exposes as such — a page's
`body` is still, structurally, a block array; it is just no longer *composed* freely.

**c. Server-side enforcement, not just a UI restriction:**
`validatePageBodyAgainstTemplate(slug, body)` (`page-templates.schemas.ts`) is a second,
additional validation layer that every core-template-slug save/preview request must pass
in `ContentPagesBuilderService.enforceTemplateLock` — it checks the array is the RIGHT
sections, in the RIGHT order, of the RIGHT `blockType`, with `data` satisfying that
section's own schema, and rejects the WHOLE request (422, structured per-section errors)
on any violation. This runs in addition to, not instead of, the existing per-block
`PageBuilderBlockSchema` union check the controller's `ZodValidationPipe` already performs.
Non-core slugs (`isCoreTemplateSlug` false — i.e. no ad-hoc pages remain, see decision e)
pass through this check unchanged; in practice every slug in the running system is now a
core-template slug.

**d. Colleges become a dedicated CRM-managed list, unified with the existing
mentors/courses live-collection pattern**, rather than page-builder-authored content. A
new `CollegesRepository`/`CollegesService`/`colleges.controller.ts` CRUD surface manages
`Partner` rows scoped to `category: "college_partner"` (`COLLEGE_PARTNER_CATEGORY`) — a
dedicated repository (not a reuse of `PartnersRepository`) keeps that category filter a
single, undividable rule rather than re-derived at call sites, mirroring the existing
Mentor (`mentors` table) and course (`programs` table) precedent: "add more colleges" is
now "add a row" in a CRM list screen, exactly like adding a mentor or a course, resolved
live on the site via the existing `live_collection_ref(partners)` block — not a page-builder
edit. `focus`/`established`/`city` (added to the `Partner` model in Phase 10 but never
wired into the admin create/update DTOs) are wired into `CollegesService` — the first
caller that actually needs them — while `PublicPartnerSchema` (the public read contract) is
deliberately left untouched (see Consequences).

**e. Remove the ad-hoc-page authoring path entirely.** With no free block-composition,
there is no mechanism left to create a genuinely new, non-migrated page — the `/pages/[slug]`
catch-all route that existed to serve such pages is removed from `apps/web`. Every page in
the running system is one of the 6 fixed core templates.

**f. Add a per-page OG/social image.** `ContentPage.seoImagePath` /
`ContentPageVersion.seoImagePath` (nullable `String`, `@map("seo_image_path")`) store a
`StorageProvider` object key — never a raw URL, same "stored key, CDN URL minted at serve
time" contract as every other `*ImageKey`/`*Key` field in this schema. The Prisma field
name matches the DTO name (`seoImagePath`) 1:1 rather than following the sitewide
`*ImageKey` naming convention (`Program.ogImageKey`, `BlogPost.coverImageKey`) — a
deliberate, documented exception made because the DTO layer (Phase-11 P1) had already
named the field to match `SiteSetting`'s existing `defaultOgImagePath` JSON-field
precedent for the sitewide fallback; keeping the Prisma column name identical avoids a
silent rename/translation at every repository/service call site. `web`'s `buildMetadata`
now prefers a page's own `seoImagePath` over the sitewide `SiteSetting` OG-image fallback
when present.

## Consequences
- ADR-0062's storage (`ContentPage`/`ContentPageVersion`), RBAC (`content.builder`/
  `site_settings.*` super_admin-only), save-is-live semantics, and optimistic-concurrency
  conflict handling are all still in force and unchanged by this ADR — only the authoring
  surface (free composition vs. fixed template) changes. ADR-0062 is marked
  `superseded` in `docs/adr/README.md` for its authoring-model portion; its storage/RBAC
  decisions remain the reference.
- No ad-hoc/new marketing pages can be created anymore — every page is one of the 6
  locked templates. A super_admin who wants a genuinely new structural page needs a new
  template added to the registry (a code change), not a self-service composition.
- **Known, accepted limitation:** the stored wire shape (`{ type, data }[]`) still carries
  no per-section `key`. `validatePageBodyAgainstTemplate` can only detect a
  reorder/mismatch by the `type` found at a given array index — for the handful of
  templates that pin the same `blockType` at more than one position (e.g. scholarship's
  three `stat_group` sections, about's two `feature_grid`/`cta_band` sections), a same-type
  swap between two of a page's own pinned slots is indistinguishable from independently
  editing both slots' data, and is not flagged as an error. This is an accepted trade-off
  of keeping the wire format unchanged (decision b) rather than adding a `key` to every
  stored block, which would be a breaking storage-format change outside this work's
  additive scope. Documented in `page-templates.schemas.ts`'s file header and tracked in
  `docs/phase-11-followups.md`.
- A college `Partner` row can be recategorized away from `college_partner` via the generic
  `PATCH` (the update DTO allows changing `category`), after which it silently disappears
  from the Colleges list (`CollegesRepository.list` filters strictly on
  `category: "college_partner"`) while remaining addressable by id
  (`findById`/`update`/`softDelete` do not filter by category, by design — mirrors
  `partners.repository.ts`). Tracked in `docs/phase-11-followups.md`, not fixed this phase.
- `PublicPartnerSchema` (the public `GET /public/partners` contract) still does not expose
  `focus`/`established`/`city` — those three fields are readable only through the
  page-builder-internal `ResolvedPartnerItemSchema` used by the `live_collection_ref`
  server-side resolver, not the generic public partners endpoint. Deliberate, documented
  scope boundary; tracked in `docs/phase-11-followups.md`.
- The 422 template-violation response the server now returns on a locked-section
  violation surfaces in the CRM as a single generic "Couldn't save this page" toast, not a
  per-section inline highlight — a real UX gap for a validation error whose whole point is
  to be structural/per-section. Tracked in `docs/phase-11-followups.md`.
- `apps/crm/src/lib/public-urls.ts`'s `publicPagePath` still contains a `/pages/${slug}`
  fallback branch for any slug outside the 5 migrated-route slugs — now dead code, since
  no ad-hoc pages can exist and the route itself is removed from `web`. Left in place
  (harmless but misleading) and tracked as cleanup in `docs/phase-11-followups.md`.

## Alternatives considered
- **Keep the free block builder and add stricter client-side guardrails (e.g. warn
  before removing a section) instead of removing add/remove/reorder outright.** Rejected —
  the product owner's direction was explicit that the marketing team should not be able to
  break page shape at all; a warning is not a guarantee, and the spec's own goal (§Why:
  self-serve minutes, not deploy-days, *without* an engineering bottleneck to fix a broken
  page) is undermined if a broken page can still be saved.
- **Add a `key` to every stored block now, to fully close the same-blockType-position
  limitation.** Rejected for this pass — it is a breaking storage-format change (every
  existing `ContentPage.body`/`ContentPageVersion.body` row would need a migration/backfill
  to add keys), while the plan's explicit constraint was to keep storage unchanged and reuse
  the P10 engine internally. Deferred as a documented, accepted limitation instead
  (`docs/phase-11-followups.md`).
- **Extend `PublicPartnerSchema` to include `focus`/`established`/`city` now that
  Colleges CRUD needs them.** Rejected — those fields exist specifically to feed the
  page-builder-internal `live_collection_ref(partners)` resolution path
  (`ResolvedPartnerItemSchema`), and widening the generic public partners contract was
  explicitly out of scope for this pass; left as a documented current-state gap rather than
  silently expanding a public API surface as a side effect of an unrelated CRUD screen.
- **Reuse `PartnersRepository`/`PartnersService` for Colleges, adding a
  `category=college_partner` filter at the call site.** Rejected — a dedicated
  `CollegesRepository` keeps the college-scoping rule a single, undividable fact owned by
  one file (matching this codebase's existing module-boundary convention), rather than a
  filter that could be forgotten or duplicated inconsistently at each future call site.

## Related
Supersedes the authoring-model portion of ADR-0062 (CRM page builder over `ContentPage`),
which remains the reference for storage/versioning/RBAC. Reuses the `live_collection_ref`
server-side-resolution pattern established in ADR-0062/ADR-0034 (public marketing API
surface) for colleges, mentors, and courses alike. Plan: `docs/plans/phase-11-locked-templates.md`.
