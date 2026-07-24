# Spec: Phase-10 Page Builder (`web` marketing pages, editable from CRM)

> **Superseded (Phase 11):** the free block-composition authoring model described in this
> spec (add/remove/reorder blocks from the registry, via `content.builder`) was replaced
> by **locked, fixed-layout templates** — staff now edit only the field values (text,
> images, list rows) of a pinned, ordered set of sections per page; the CRM builder no
> longer exposes add/remove/reorder/block-picker at all. The 11-block registry, storage
> (`ContentPage.body`), `web` renderer, `ContentPageVersion` history/revert, server-side
> preview, and `live_collection_ref` resolution described below are all still accurate —
> they were reused internally, not replaced. What changed is the *authoring UX* and the
> addition of a second, template-shape validation layer
> (`validatePageBodyAgainstTemplate`) enforcing the lock server-side. Colleges (the
> `live_collection_ref(partners)` reference in block #10) are now a dedicated CRM-managed
> list rather than page-builder content. See `docs/plans/phase-11-locked-templates.md`
> and **ADR-0063** (supersedes ADR-0062's authoring model) for the current state.

## Why (purpose + which metric it moves)

Today, the highest-traffic `web` marketing pages are hardcoded Next.js route files
(`apps/web/src/app/page.tsx`, `about/page.tsx`, `scholarship/page.tsx`,
`for-colleges/page.tsx`, `gallery/page.tsx`, `careers/page.tsx`, plus supporting
components `why-us.tsx`, `stats-bento.tsx`, `partner-colleges.tsx`,
`hero-centered.tsx`). Changing a single stat, testimonial, headline, or FAQ answer
requires an engineer + a deploy. This directly contradicts `00-product-strategy.md`
§1's framing of `web` as the app with the fastest change cadence ("daily,
marketing") and `01-prd-website.md` §9, which already promises that page/testimonial/
partner content is "managed from the CRM" — a promise only partly kept today (blog,
testimonials, partners, faculty bios, and landing pages have CMS surfaces; these 6
structural pages do not).

**Metric moved:** reduces content-iteration cycle time from "deploy-days" to
"self-serve-minutes" for the marketing team, which is an enabler for
`01-prd-website.md` §6 targets — **Lead conversion (visit→lead) ≥ 6%** and
**Organic traffic growth +20% QoQ** — by letting the team run copy/proof-section
changes without an engineering bottleneck. It ladders indirectly to the North Star
(**Certified Outcomes per Month**, `00-product-strategy.md` §6) via the
acquisition → activation chain.

## Users & roles affected

- **super_admin** (CRM) — the *only* role permitted to use the page builder this
  phase (compose pages: add/remove/reorder blocks; save; preview; view/revert
  version history). This is a deliberate narrowing versus the existing
  `content.edit`/`content.publish` grants already held by `Admin`/`Marketing`/
  `Content Editor` roles for the rest of the CMS (blog, testimonials, partners,
  faculty bios, landing pages) — those roles get **no** access to the builder
  itself unless separately granted the new permissions below.
- **Anonymous website visitors** (`web`) — never see an authoring surface; must see
  the latest saved state immediately (save-is-live) and must see **zero visual/DOM
  difference** on the 6 migrated pages versus today's hardcoded output.
- Out of scope this phase: `Marketing`, `Admin`, `Content Editor` roles gaining
  builder access (see Out of scope).

## User stories

1. As a **super_admin**, I want to add, remove, and reorder sections on a marketing
   page so I can restructure the page without an engineering deploy.
2. As a **super_admin**, I want every save to go live immediately (no draft →
   publish gate) so visitors always see my latest edit as soon as I hit Save.
3. As a **super_admin**, I want to preview a page with my unsaved edits applied,
   rendered the same way the public site renders it, so I can catch mistakes
   *before* they go live.
4. As a **super_admin**, I want to see a version history of a page and revert to a
   prior version with one click, so I can quickly undo a bad edit that already went
   live.
5. As a **super_admin**, I want a testimonials/partners section to pull live from
   the existing Testimonial/Partner CMS records (by tag/category/featured/limit)
   instead of re-typing content that's already managed elsewhere, so the two stay
   in sync automatically.
6. As any CRM staff member who is **not** super_admin, I should be blocked — in the
   UI and at the API — from opening or mutating the page builder, even if I already
   have general content-editing permissions.

## Block registry (core deliverable)

**Design principle:** minimal, composable, shared shapes over one-block-per-page.
Auditing the listed files shows the same handful of visual/data shapes repeated
with different content: a "stat grid" (in 3 different visual treatments), an
"icon + title + body card grid" (in 3 treatments), a "numbered steps" list (in 3
treatments), and a "heading + CTA(s) + optional lead form" band (in 4 places). The
registry below collapses those into **11 block types**, each with a `variant`
field where the underlying shape repeats but the layout differs.

Every block is stored as `ContentBlock = { type: string, data: Record<string, unknown> }`
— the shape `ContentPage.body` already uses (`packages/types/src/content/pages.schemas.ts`).
This spec defines the closed field-schema `data` must satisfy for each `type`; the
zod schemas themselves are `db-architect`/`backend-builder`'s to write.

Shared conventions used throughout:
- `*ImageKey` / `*PhotoKey` fields hold an S3/R2 **object key**, never a raw URL —
  same convention as `Program.ogImageKey` / `BlogPost.coverImageKey`.
- `iconKey` fields are a **closed enum**, not freeform SVG/HTML input. Seed set
  (drawn from icons already in the audited components): `mentor`, `pricing`,
  `trophy`, `star`, `graduation-cap`, `stack`, `map-pin`, `lms`, `project`,
  `certificate`, `placement`, `check`, `user`, `video`, `pin`. `design-system`
  owns the final enum + adding new keys; **no block ever accepts raw markup for an
  icon** — this is a deliberate XSS-surface control (see Out of scope: no generic
  rich-text block).
- `headline`/`heading`-type fields optionally carry a `*Highlight` sibling field
  (a literal substring of the heading) that the renderer wraps in the brand accent
  span (`<span className="text-chart-3">`) — this reproduces every audited page's
  "colored word inside an otherwise plain heading" pattern without allowing
  embedded HTML.
- `href` fields are validated as either a same-origin relative path (`/programs`,
  `#apply`) or an `https://` absolute URL (`mailto:` allowed explicitly where
  audited, e.g. the For-Colleges CTA).

| # | Type key | Renders via (existing component) | Category |
|---|----------|-----------------------------------|----------|
| 1 | `hero` | `hero-centered.tsx` + Scholarship hero markup (to be generalized into one parametrized component) | Content |
| 2 | `content_split` | About page "Story" section (new component, adapted) | Content |
| 3 | `stat_group` | `stats-bento.tsx`, `StatBand` (`@repo/ui`), Scholarship's fund-distribution bar list (new) | Content |
| 4 | `feature_grid` | `why-us.tsx`, About "Pillars"/"Commitments", Scholarship "Benefits", For-Colleges card grid (consolidate near-duplicate JSX) | Content |
| 5 | `numbered_steps` | Homepage "How it works" + `StepArrow`, About "Journey", Scholarship "Process" (consolidate) | Content |
| 6 | `faq` | `FaqAccordion` (`@repo/ui`, already generic) | Content |
| 7 | `cta_band` | Homepage CTA band, About verify-certificate callout + final CTA, Scholarship application section, For-Colleges CTA (consolidate) | Content |
| 8 | `media_gallery` | Gallery page grid (new, swaps placeholder div for `next/image` per its existing code comment) | List |
| 9 | `job_openings` | `CareersRoleList` (already exists, already handles empty state) | List |
| 10 | `live_collection_ref` | `TestimonialCard` grid, new partner logo-wall, `ExploreCourses`, `MentorsTeaser` | **Reference** |
| 11 | `brain_showcase` | `brain-showcase.tsx` (unmodified) | Decorative/structural |

### 1. `hero`

| Field | Type | Req | Validation | Default |
|---|---|---|---|---|
| `variant` | enum `centered` \| `centered-with-flanking-photos` \| `split-with-cards` | yes | — | `centered` |
| `eyebrow` | string | no | max 80 | null |
| `headline` | string | yes | max 160 | — |
| `headlineHighlight` | string | no | must be substring of `headline` | null |
| `subheadline` | string | no | max 400 | null |
| `backgroundImageKey` | string | no | valid object key | null |
| `trustBadge` | `{ ratingStars: int 1-5, caption: string(≤100) }` | no | — | null |
| `flankingPhotos` | array, max 2 (only used when `variant=centered-with-flanking-photos`) of `{ imageKey, statValue: string(≤20), statLabel: string(≤40), statIconKey }` | no | — | `[]` |
| `watermarkText` | string | no (only used when `variant=split-with-cards`) | max 40 | null |
| `centerImageKey` | string | no (required when `variant=split-with-cards`) | valid object key | null |
| `infoCards` | array, max 2 (only used when `variant=split-with-cards`) of `{ bodyText: string(≤400), emphasis: boolean }` | no | — | `[]` |
| `ctas` | array, 0–2, of `{ label: string(≤40), href, style: enum primary\|secondary }` | no | — | `[]` |

Note: the Scholarship hero's overlapping stat band is **not** a hero field — it is
a separate `stat_group` block (`variant=band`) placed immediately after the hero
block, keeping the hero's field surface small and reusing block #3.

### 2. `content_split`

`{ eyebrow?: string(≤80), heading: string(≤120) [req], headingHighlight?: substring, body: string[] (1–6 items, each ≤600 chars, plain text — no HTML), mediaImageKey: string [req], mediaPosition: enum left|right = "right", badge?: { iconKey, title: string(≤40), subtitle: string(≤60) } }`

### 3. `stat_group`

| Field | Type | Req | Notes |
|---|---|---|---|
| `variant` | enum `bento` \| `band` \| `bars` | yes | `bento` = `StatsBento`'s 3-card asymmetric grid; `band` = flat `StatBand` row/`<dl>`; `bars` = labeled progress-bar list |
| `heading` | `{ eyebrow?, title: string(≤120), titleHighlight?, subtitle?: string(≤200) }` | no | omitted on inline bands (About stats, Scholarship overlap band) |
| `items` | array of `{ label: string(≤60) [req], value: string(≤24) [req], description?: string(≤160), iconKey? }` | yes | **exactly 3** items when `variant=bento`; 2–6 when `variant=band`; 2–8 when `variant=bars` |

`value` is stored as a **string**, not a number — audited data includes
non-numeric formats (`"Up to ₹1 Crore"`, `"90%+"`, `"15,000+"`), matching the
existing `Testimonial.rating`-style "no floats, but here also no forced numeric
type" precedent. `description`/`iconKey` are only rendered in `bento` variant.

### 4. `feature_grid`

| Field | Type | Req | Notes |
|---|---|---|---|
| `variant` | enum `cards` \| `split-media` \| `strip` | yes | `split-media` = `why-us.tsx`'s 2-cards \| photo \| 2-cards layout; `cards` = Pillars/Benefits/For-Colleges grid; `strip` = Commitments' compact row |
| `heading` | `{ eyebrow?, title, titleHighlight?, subtitle? }` | no | — |
| `columns` | enum `2`\|`3`\|`4` | no | default: 2 for `split-media`, 3 for `cards`, 4 for `strip` |
| `centerImageKey` | string | required only when `variant=split-media` | — |
| `items` | array of `{ iconKey?, title: string(≤80) [req], description: string(≤220) [req] }` | yes | min 1, max 12; **exactly 4** required when `variant=split-media` |

### 5. `numbered_steps`

`{ heading?: {eyebrow?, title, titleHighlight?, subtitle?}, variant: enum arrows|timeline|compact [req], items: {title: string(≤100), description: string(≤260)}[] (min 2, max 8) }`

`arrows` = Homepage "How it works" (4-col with `StepArrow` connector, desktop
only); `timeline` = About "Journey" (vertical connected list); `compact` =
Scholarship "Process" (numbered grid, no connectors).

### 6. `faq`

`{ heading?: {title, titleHighlight?, subtitle?}, items: {question: string(≤200), answer: string(≤1000)}[] (min 1, max 20), viewAllHref?: string }`

`answer` is plain text (matches today's `FAQ_ITEMS` where `answer`/`answerText`
are identical plain strings) — not HTML.

### 7. `cta_band`

`{ heading: string(≤160) [req], headingHighlight?, subheading?: string(≤300), background: enum brand|surface|default = "default", buttons: {label: string(≤40), href, style: enum primary|secondary}[] (0-3), leadForm?: { source: string, heading: string(≤100), subheading: string(≤200), fields: enum(name|phone|email)[] (min 1), submitLabel: string(≤40) } }`

Consolidates the homepage CTA band, About's verify-certificate callout + final
CTA, Scholarship's application-form section, and For-Colleges' CTA — all
near-duplicate JSX today.

### 8. `media_gallery`

`{ heading?: {title, subtitle?}, columns: enum 2|3 = 3, items: {imageKey: string [req], alt: string(≤200) [req, non-empty — a11y], caption?: string(≤160)}[] (min 1, max 60) }`

### 9. `job_openings`

`{ heading?: {title, subtitle?}, items: {title: string(≤100), employmentType: string(≤30), location: string(≤100), description: string(≤500)}[] (min 0, max 30), emptyStateMessage: string = "No open roles right now" }`

Reuses `CareersRoleList` as-is (it already handles the populated + empty states).

### 10. `live_collection_ref` — the reference block (requirement #3)

**Never copies data into the page.** Resolved server-side at render time from the
live table, honoring that table's own `status='published'` filter — the same
guarantee the existing public content controllers already enforce, and it cannot
be bypassed by page-builder selection options.

`{ collection: enum testimonials|partners|programs|mentors [req], heading?: {title, titleHighlight?, subtitle?}, viewAllHref?: string, layout: enum grid-3|grid-4|logo-wall, selection: <shape below, discriminated by collection> }`

| `collection` | `selection` fields | Backing source |
|---|---|---|
| `testimonials` | `mode: manual\|filter`; `ids?: string[]` (max 12, when `manual`); `programId?: string`; `minRating?: int 0-50`; `limit: int 1-12 = 3`; `sort: enum order\|newest = "order"` | `Testimonial` model, `status='published'` only |
| `partners` | `category?: string`; `limit: int 1-24 = 12`; `sort: enum order\|newest = "order"` | `Partner` model, `status='published'` only |
| `programs` | `categorySlug?: string`; `limit: int 1-12 = 8`; `sort: enum popularity\|newest = "popularity"` | existing `GET /public/programs` (same source `ExploreCourses` already calls) |
| `mentors` | `limit: int 1-8 = 8` | existing `GET /public/mentors` (same source `MentorsTeaser` already calls) |

**Known limitation (see Edge cases #11):** the homepage's current
`partner-colleges.tsx` displays `focus`, `established` (year), and `city` per
partner, none of which exist on the `Partner` model. This block **cannot**
reproduce that card content as-is; see caveat on Acceptance Criterion 10.

### 11. `brain_showcase`

No fields. A zero-config positional placeholder for the fixed 3D/shader brand
moment between the hero and stats on the homepage — deliberately not made
editable this phase (it's a decorative brand asset, not marketing copy). It can
still be added/removed/reordered like any block; its rendered content never
changes. Renders via `brain-showcase.tsx`, unmodified.

## Acceptance criteria (Given / When / Then)

1. **Compose a page.** Given a super_admin viewing the builder for a page, When
   they add a block from the registry with valid field values and click Save, Then
   the block is persisted into the page's `body` at the position added, and a
   request to the public page reflects the new block on the very next request (no
   separate publish step).
2. **Reorder blocks.** Given a page with ≥2 blocks, When the super_admin moves
   block B before block A and saves, Then the persisted `body` order matches, and
   the public page renders blocks in the new order on the next request.
3. **Delete a block.** Given a page with a block, When the super_admin removes it
   and saves, Then the block is absent from `body` and from the public page, and a
   version snapshot of the pre-delete state remains available in version history.
4. **Preview before save.** Given unsaved edits in the builder (any add/edit/
   reorder/delete), When the super_admin opens Preview, Then they see the page
   rendered with those unsaved changes applied, using the same block-rendering
   components the public site uses, and the changes are **not** persisted or
   visible to anonymous visitors until Save is explicitly clicked.
5. **Save is live.** Given the super_admin clicks Save, Then the change is
   persisted immediately with no draft/approval/publish gate, and is visible to
   anonymous visitors on their next request.
6. **Version created on every save.** Given any successful Save (including a
   revert — see AC 7), Then a new version record is created capturing the full
   block-list snapshot, the acting user, and a timestamp, retrievable in a
   newest-first version-history list.
7. **One-click revert.** Given a super_admin viewing version history for a page,
   When they select a prior version and confirm Revert, Then the page's current
   `body` is replaced with that version's snapshot, the change goes live
   immediately (per AC 5), and the revert itself creates a new version entry
   (history is append-only, never rewound/deleted).
8. **Non-super_admin denied — UI.** Given a CRM user with any role other than
   super_admin (including a role holding `content.edit`/`content.publish`), When
   they navigate to the page-builder route, Then they see a forbidden state and no
   page/block data is fetched.
9. **Non-super_admin denied — API.** Given a non-super_admin's valid JWT, When
   they call any page-builder mutation endpoint directly, Then the API returns 403
   with a permission-denied error code, the mutation is not applied, and the
   attempt is written to the audit log.
10. **Existing pages render identically after migration.** Given the 6 audited
    pages (home, about, scholarship, for-colleges, gallery, careers) have been
    migrated to page-builder-managed `ContentPage` rows composed from this
    registry, When an anonymous visitor requests each URL, Then the rendered text
    content, section order, image sources, CTA `href`s, and existing
    `data-testid` attributes are equivalent to the pre-migration hardcoded
    version, and all pre-existing Playwright e2e specs targeting these pages pass
    unmodified. **Caveat:** the homepage's partner-colleges section is an
    explicit, called-out exception — see Edge case #11; it is not expected to
    reach pixel/content parity via `live_collection_ref(partners)` without a
    `Partner` model change, which is out of this spec's authority to decide.
11. **Reference block resolves live, not stale.** Given a `live_collection_ref`
    block with `collection=testimonials`, When a CRM user edits or unpublishes the
    underlying `Testimonial` row (via the existing Testimonials CMS) without
    touching the page builder at all, Then the public page reflects that change on
    its next request.
12. **Required-field validation blocks save.** Given a block missing a required
    field (e.g. `hero` with no `headline`), When the super_admin attempts to Save,
    Then the save is rejected both client-side and server-side with a field-level
    error naming the block and field, and no partial/invalid state is persisted.
13. **Empty page is valid.** Given a page with zero blocks, When the super_admin
    saves, Then the save succeeds, and the public route renders header/footer
    chrome with an empty content area (not a 500).

## Edge cases & error states

1. **Empty block list** — see AC 13. The builder itself must show an explicit
   "no sections yet — add a block" empty state, distinct from a loading/error
   state.
2. **Reference block whose referenced record was deleted/unpublished** — e.g. a
   `manual`-mode testimonial selection where one `Testimonial.id` was later
   soft-deleted or unpublished. The resolver silently drops the missing id (no
   error, no broken card rendered). If this drops the resolved count to 0, the
   entire block (including its `heading`) is hidden — same precedent as
   `MentorsTeaser`'s existing "hidden when empty" behavior — rather than rendering
   a heading over an empty grid. Flagged for `design-system` to confirm.
3. **Filter-mode reference resolves to fewer items than `limit`** — not an error;
   no minimum is enforced (e.g. 1 testimonial instead of 3 is valid) unless it
   hits 0 (edge case 2).
4. **Missing required field due to downstream data loss** (not a bad save) — e.g.
   a `hero(variant=split-with-cards)`'s `centerImageKey` object is deleted
   out-of-band by an unrelated storage cleanup after the page was saved validly.
   The renderer must fail soft for that one block (render without the image, or
   skip the block) — a single malformed/broken block must never 500 the whole
   page. Requires a block-level render error boundary in `web`.
5. **Concurrent edits by two super_admins** — save-is-live has no draft lock, so
   two admins editing the same page can race (Admin A loads stale state, Admin B
   saves, Admin A saves and silently clobbers B). The update endpoint must accept
   an `expectedVersion`/`updatedAt` the builder loaded and return **409 Conflict**
   (not silently overwrite) if the page changed since; the builder surfaces "this
   page was changed by someone else — reload before saving." No auto-merge this
   phase; the version history (AC 6) lets a losing admin recover their intended
   change by diffing against the version that now exists.
6. **SEO metadata per page** — `ContentPage.seoTitle`/`seoDescription` already
   exist but are **page-level**, not a block; the builder must expose them
   alongside the block editor, not as a block type. Migrating `/about`
   specifically must also retire its current dependency on the legacy
   git-committed `content/pages/about.mdx` frontmatter (read via
   `apps/web/src/lib/content/loader.ts#getContentPageMeta`, a **different**
   system from the `ContentPage` Prisma model despite the similar name) — this is
   a required migration step, not just a data copy, and must not be missed.
7. **Page slug that `web` has a hardcoded route for** — the 6 audited slugs (`/`,
   `/about`, `/scholarship`, `/for-colleges`, `/gallery`, `/careers`) keep their
   Next.js route files. Migration converts each file into a thin server component
   that (a) fetches its `ContentPage` by a fixed, code-owned slug, (b) renders the
   resolved blocks through a shared block-registry renderer, and (c) keeps
   page-specific non-block logic (JSON-LD builders, ISR `revalidate` window,
   programs/mentors data fetch for the homepage) in code. Consequence: for these 6
   slugs, the builder can edit block content but **cannot** change the URL or
   delete the page itself (only its blocks). For a genuinely **new** slug a
   super_admin creates in the builder, `web` currently has **no generic catch-all
   route** capable of serving an arbitrary `ContentPage` by slug (only
   `/lp/[slug]` exists, and that's the separate `LandingPage` model) — building
   that renderer is real code, called out under Dependencies, not assumed to
   already exist.
8. **New page slug colliding with an unrelated existing `web` route** (e.g. a
   super_admin creates a page at slug `programs`, `blog`, or `verify`) — the
   existing slug-uniqueness check (`content.slug_taken`) only guards against
   colliding with another `ContentPage` row, not a `web` route file. Recommend a
   reserved-slug denylist at create time (exact list owned by
   `frontend-builder`/`db-architect`) — flagged as an open question.
9. **Unknown block `type`** — e.g. a version reverted-to references a block type
   later removed from `web`. Render nothing for that block (skip, never 500) and
   surface a "1 block on this page uses an unsupported type" warning in the CRM
   builder only (never on the public site).
10. **Very large pages** — no explicit block-count cap is set beyond the
    field-level array maximums specified per block above (e.g. `media_gallery`
    max 60 items). A total page-payload byte-size ceiling is recommended;
    exact number deferred to `backend-builder`/`db-architect`.
11. **Partner reference field mismatch** — `partner-colleges.tsx` currently
    renders `focus`, `established` (year), and `city` per partner; none exist on
    the `Partner` model (`name`, `logoKey`, `url`, `category` only). The
    `live_collection_ref(partners)` block as specified **cannot** reproduce this
    exact card content. Migrating this specific section either (a) accepts a
    visual reduction to a logo-wall (name + logo + category) for the
    reference-driven version — breaking strict parity for this one section only
    — or (b) requires extending the `Partner` model, which is a `db-architect`
    decision outside this spec's authority. This is the one known, called-out
    exception to Acceptance Criterion 10.

## Out of scope (explicit)

- Editing/creating individual `BlogPost`, `Testimonial`, `Partner`, `FacultyBio`,
  or `LandingPage` records — those keep their existing CMS surfaces
  (`content-cms-page.tsx` and siblings) and existing draft/publish workflow. This
  spec only adds a page-composition layer that can **reference** (never author)
  those records via `live_collection_ref`.
- Global site chrome — header/mega-menu nav, footer, cookie/consent banner,
  WhatsApp float button. Remain code-owned, not page blocks, this phase.
- Granting `Marketing`/`Admin`/`Content Editor` roles any page-builder access —
  explicit product decision this phase; broadening access is a future phase.
- A generic freeform rich-text/HTML block type. Deliberately excluded to avoid
  reopening the XSS surface the existing generic `richtext` `ContentBlock` type +
  DOMPurify sink already exists to contain — every block here has a closed field
  schema instead. If freeform HTML is genuinely needed later on these pages, it
  should go through the existing `richtext` block type, not a new capability
  introduced here.
- Multi-step approval/review workflow, scheduled/future-dated publishing, or
  A/B variant rendering for page-builder pages (`LandingPage` already has A/B
  variants; not extended to `ContentPage` here).
- Building the `web` catch-all route needed to serve genuinely new (non-migrated)
  page-builder pages — real gap, flagged in Edge case #7, but its implementation
  is a `frontend-builder`/`api-designer` task, not decided here.
- Real-time collaborative editing / operational-transform merge of concurrent
  edits — concurrency is handled via optimistic-concurrency conflict rejection
  (Edge case #5), not merging.
- In-builder undo/redo within an unsaved editing session (Ctrl+Z) — only
  cross-save version revert is required this phase.
- Localization / multi-language block content.
- Any change to `brain_showcase`'s actual visual/shader content — fixed asset,
  block-wrapper only.
- Migrating pages beyond the 6 explicitly audited here (`/pricing`, the
  `/programs` listing, program-detail pages, the `/blog` index, etc.) — unaudited,
  not committed to this build.

## Data/permissions impact (entities, RBAC actions)

**Entities**
- Reuses `ContentPage` (existing) for page-builder-managed pages — its
  `body: ContentBlock[]` already matches the `{type, data}` envelope this
  registry targets; no schema change to the table itself is required to store
  composed blocks.
- **New entity needed:** a version-history table (name TBD, e.g.
  `ContentPageVersion`) capturing `{ pageId, body snapshot, actorUserId,
  createdAt }` per save, backing AC 6–7. Exact schema (full-row snapshot vs.
  diff, retention/pruning policy, whether it becomes a reusable "versioned
  content" pattern shared with `LandingPage` later) is deferred to
  `db-architect`.
- **Open schema question for `db-architect`:** page-builder saves are always-live
  ("save is live"), which conflicts with `ContentPage`'s existing
  draft → publish `ContentStatus` gate used by the generic CMS UI
  (`content-cms-page.tsx`). Needs a decision between (a) a flag distinguishing
  "builder-managed" rows that always force `status='published'` on save while
  non-builder rows keep today's gate, or (b) a dedicated new model. This spec
  recommends (a) for reuse but does not decide it.
- `live_collection_ref` resolves against existing `Testimonial`, `Partner`, and
  the public Program/Mentor read models — no new entities for those; resolution
  always re-applies each source's existing `status='published'` filter, never
  bypassing it (AC 11).

**RBAC actions (new)**
- `content.builder` — required to view/use the page-builder UI, and to
  add/remove/reorder/save/preview/revert page-builder-composed pages. Recommend
  this single permission governs revert too, rather than adding a separate
  `content.builder_revert`.
- `site_settings.view` / `site_settings.edit` — govern per-page SEO metadata
  (`seoTitle`/`seoDescription`, edited page-level, not per-block) and any
  page-builder-specific settings (e.g. a reserved-slug denylist, if made
  admin-configurable). Exact view/edit split TBD with `backend-builder`.
- **Data scope:** `all` only — matches the existing content module's
  `assertAllScope()` pattern; page-builder pages are not branch-scoped.
- **Seed/role assignment:** only `super_admin`/Owner is granted `content.builder`
  and `site_settings.*` at seed time — explicitly **not** granted to
  `Marketing`/`Admin`/`Content Editor` by default, narrower than their existing
  `content.edit` grant.
- **Audit:** every block-list save, reorder, delete, and revert is a mutation on
  a sensitive, public-facing entity and must write an audit-log row (actor,
  before/after diff or version-id pair), per `CLAUDE.md` §3 rule 4 / §4 DoD.

## Dependencies (which agents/modules)

- **db-architect** — version-history entity design; the `ContentPage`
  "builder-managed"/status-bypass decision; reserved-slug denylist storage (if
  data-driven); the `Partner` model question raised in Edge case #11.
- **api-designer / backend-builder** — page-builder endpoints (block-list
  save with optimistic-concurrency conflict handling per Edge case #5;
  version-history list/get/revert endpoints); `live_collection_ref` server-side
  resolution (batched per collection, not N+1, to hold the existing p95 read
  budget from `04-trd-architecture.md`); permission-catalog entries for
  `content.builder` / `site_settings.*`.
- **frontend-builder** — CRM builder UI (drag-reorder, per-block field forms,
  preview pane, version-history panel) built on `content-cms-page.tsx`'s existing
  patterns; the `web`-side generic block-registry renderer (`block.type` →
  component); the 11 block components (several generalize existing components —
  `StatsBento`, `WhyUsSection`, `FaqAccordion` — others are net-new —
  `MediaGalleryBlock`, a partner logo-wall, `StatBarsBlock`, `CtaBandBlock`,
  `FeatureGridBlock`, `NumberedStepsBlock`, `ContentSplitBlock`, a generalized
  `HeroBlock`); migrating the 6 audited pages' route files into thin
  `ContentPage`-driven wrappers; retiring `/about`'s legacy MDX-frontmatter SEO
  dependency (Edge case #6); the new `web` catch-all route for non-migrated pages
  (Edge case #7, Out of scope).
- **design-system** — finalize the `iconKey` enum; hero/feature-grid/
  numbered-steps variant visual specs; the "reference block resolves to 0 items"
  hidden-vs-empty-state question (Edge case #2).
- **security-reviewer** — confirm the closed, field-constrained block schemas
  (no freeform HTML/SVG fields) adequately contain the XSS surface; review the
  optimistic-concurrency conflict handling; review the reserved-slug denylist for
  route-hijack risk (Edge case #8).
- **qa-engineer** — AC 10's DOM/e2e-parity verification across the 6 migrated
  pages against existing Playwright specs; a block-registry field-validation test
  matrix; the concurrency-conflict test (Edge case #5); reference-block
  resolution tests (Edge cases #2–3, #11).
