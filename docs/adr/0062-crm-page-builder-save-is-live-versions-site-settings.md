# ADR 0062: CRM page builder over `ContentPage` — save-is-live with version snapshots; dedicated `SiteSetting` model

## Status
Accepted

## Context
`docs/specs/phase-10-page-builder.md` requires a `super_admin`-only CRM surface that
composes the 6 highest-traffic `web` marketing pages (`/`, `/about`, `/scholarship`,
`/for-colleges`, `/gallery`, `/careers`) from a closed block registry, with every save
going live immediately (no draft/publish gate), full version history + one-click revert,
and reference blocks that pull live from existing `Testimonial`/`Partner`/program/mentor
data instead of copying it. It also needs a place to store sitewide marketing primitives
(nav links, footer columns, SEO defaults, contact/WhatsApp details, homepage stat
headlines) editable from the same super_admin-only surface.

`ContentPage` (ADR-0059) already existed as a generic block-based CMS page with a
`draft → published → archived` (`ContentStatus`) lifecycle gated by `content.edit`/
`content.publish`, held by `Admin`/`Marketing`/`Content Editor` in addition to
`super_admin`. The spec's "Data/permissions impact" section left two questions open for
this build: how to reconcile save-is-live with the existing draft/publish gate on the
same table, and how to store the version-history + sitewide-settings data.

## Decision

**a. `ContentPage.isBuilderManaged: Boolean @default(false)` — a queryable flag, not a
service-layer convention.** Pages authored through the block-based builder set this
`true` and are always forced to `status = 'published'` on every save
(`ContentPageVersionsRepository.applyWithVersionSnapshot`). Every other `ContentPage`
row keeps today's `draft → publish` workflow untouched. The flag is queryable
specifically because real decisions key off it at multiple layers: which permission
gates a write (`content.builder` vs. `content.edit`/`content.publish`), which CRM editor
UI a row opens in, and — the actual bug this closes —
`ContentPagesService.assertGenericMutationAllowed` blocks the generic
`PATCH`/`publish`/`delete` `crm/content-pages` endpoints on a builder-managed row unless
the caller *also* holds `content.builder`, so a `content_editor`/`marketing` role that
already holds `content.edit` cannot silently mutate a builder page through the side door.
The alternative — "the builder service simply always writes `status='published'`, no
schema change" — was rejected because it makes a page's authoring lineage unrecoverable
from the DB alone (a `published` row would be indistinguishable from an ordinary CMS page
that happened to reach `published` normally), which breaks both of those real guards
without an unreliable heuristic (e.g. sniffing `body`'s block shape).

**b. Safety net = `ContentPageVersion` append-only snapshots, "save-before-apply."**
Every builder save/revert runs inside one `$transaction` with a `SELECT ... FOR UPDATE`
row lock on the target `content_pages` row (`content-page-versions.repository.ts`,
same race-safe compare-and-set pattern as `BatchCompletionRepository.markComplete`,
ADR-0054): it snapshots the row's **pre-mutation** state as version `N+1` (title/body/
seoTitle/seoDescription, `createdById` required — a version only ever exists because an
authenticated actor saved), then applies the new content live. `currentVersion` (the
count of non-deleted version rows) doubles as an optimistic-concurrency token: a save/
revert request carries `expectedVersion` from what the builder last loaded, and the
transaction returns `version_conflict` (mapped to HTTP 409) if the live count no longer
matches — the loser is told to reload rather than silently clobbering a concurrent
editor's save (Edge case #5). Revert reuses the identical `applyWithVersionSnapshot` path
with the target version's content as `next`, so history is never rewound or deleted —
reverting itself creates a new version. `POST .../:id/preview` is read-only and calls
neither path (no version bump, no persistence) — it resolves `live_collection_ref` blocks
through the same `LiveCollectionResolverService` the public read path
(`GET /public/pages/:slug`) uses, so a preview never lies about how a reference block
will render live. `(content_page_id, version)` is a **hard** `@@unique` (not the usual
raw-SQL partial-unique-after-soft-delete pattern used elsewhere in this schema) because
version snapshots are append-only history with no "reissue after soft-delete" scenario;
the `version(sort: Desc)` modifier makes the same index directly serve the CRM
history-list query (`ORDER BY version DESC WHERE content_page_id = ?`) without a second
index.

**c. `SiteSetting` is a new, dedicated model — not a reuse of the existing `Setting`
model** — even though the two are structurally near-identical (tenant-scoped keyed JSON
value, same partial-unique-after-soft-delete pattern). Reusing `Setting` would put
sitewide nav/footer/SEO/contact/stats rows behind the *existing* `settings.view`/
`settings.edit` permissions, which are already granted more broadly than this feature
allows — `branch_manager` holds `settings.view` at `scope=branch` (`prisma/seed.ts`), and
the generic `GET /settings` CRM screen would then surface page-builder-adjacent sitewide
copy to a role this feature must keep out. A dedicated model + dedicated
`site_settings.view`/`site_settings.edit` permissions (super_admin-only) keeps the RBAC
boundary real at the schema/query level, instead of relying on a future service-layer
filter to hide rows the generic settings screen technically has permission to return.
(Rationale lifted verbatim in intent from the `SiteSetting` model's doc comment in
`prisma/schema.prisma`.) `SiteSetting.key` is a dotted namespace (`nav.primary_links`,
`footer.columns`, `seo.defaults`, `contact.details`, `contact.whatsapp`,
`stats.headline`, etc.); `group` mirrors the key's leading segment as an open-ended
string for CRM UI tab grouping only, same "open editor-driven set" precedent as
`Partner.category`/`Resource.type`. `GET /public/site-settings` is anonymous and returns
all 8 seeded keys with a hardcoded-default fallback (`site-settings.constants.ts`) so a
missing/corrupted row degrades gracefully instead of 500ing.

**d. `content.builder` + `site_settings.view`/`site_settings.edit` are seeded OUTSIDE
the super_admin/admin catch-all loop, so `admin` is excluded.** Every other permission in
`permissionCatalog` reaches both `super_admin` and `admin` via the shared "full catalog
at scope=all" loop in `prisma/seed.ts`. These three are the one deliberate exception —
upserted directly into `permission` in a dedicated block and granted to `super_admin`
alone, matching the spec's explicit narrowing ("this is a deliberate narrowing versus the
existing `content.edit`/`content.publish` grants already held by `Admin`/`Marketing`/
`Content Editor`"). `live_collection_ref` blocks (`ContentPagesService.getPublicBySlug`,
`ContentPagesBuilderService.preview`) always resolve server-side through
`LiveCollectionResolverService`, re-applying each source table's own `status='published'`
filter — the selection criteria stored on the block (manual id list, filter params) can
never bypass that filter — which is what lets the builder reference testimonials/
partners/programs/mentors instead of duplicating their data onto the homepage.

## Consequences
- A `content_pages` row's authoring lineage (generic CMS vs. page-builder) is now a
  first-class, indexed (`(tenant_id, is_builder_managed)`) column, not something the API
  has to infer.
- Concurrent-edit races on builder pages fail closed (409 + reload prompt) instead of
  silently overwriting; a losing editor can always recover their intended change by
  diffing against the version that now exists (no auto-merge, per spec Out-of-scope).
- Two structurally similar settings-style models now exist (`Setting`, `SiteSetting`)
  with genuinely different RBAC surfaces — future readers must not "simplify" this into
  one model without re-litigating the `branch_manager`-vs-`super_admin` boundary this ADR
  establishes.
- `content.builder`/`site_settings.*` being outside the catch-all loop means any future
  permission-catalog refactor that iterates "every permission" for admin backfill must
  explicitly re-exclude these three, or the narrowing silently regresses.
- No public list endpoint exists for builder-managed pages (only `GET /public/pages/:slug`
  by exact slug and the permission-gated `GET /crm/content-pages` list) — a real gap for
  sitemap generation, tracked in `docs/phase-10-followups.md`.

## Alternatives considered
- **Reuse `ContentPage.status` with no new flag, and have the builder service always
  write `published`.** Rejected — see decision (a); makes builder-managed rows
  indistinguishable from ordinary CMS pages that happen to be published, breaking both
  the builder's own "list only my pages" query and the cross-permission mutation guard.
- **Diff-based version storage (store only the delta between saves) instead of full-row
  snapshots.** Rejected — a page's `body` is small (bounded block arrays with per-field
  length caps per the block registry), so the storage cost of full snapshots is
  negligible, while diff storage would require a merge/replay step on every revert and
  every version-detail read, adding real complexity for no measurable benefit at this
  data size.
- **A DB sequence/trigger for `ContentPageVersion.version` instead of an app-assigned
  monotonic counter.** Rejected for consistency — this schema already has the identical
  "app-assigned monotonic counter per parent" pattern (`Submission.attemptNo`,
  `EmiInstallment.installmentNo`); a trigger would be a one-off mechanism for one table.
- **Reuse `Setting` for `SiteSetting`, filtering site-settings keys out of the generic
  `GET /settings` screen in the service layer.** Rejected — see decision (c); a
  service-layer filter is a convention that the next engineer touching `SettingsService`
  can silently break, whereas a dedicated model + dedicated permissions makes the RBAC
  boundary enforceable at the guard/query level, not just "remembered."
- **Grant `content.builder`/`site_settings.*` to `admin` via the normal catch-all loop,
  relying on product policy alone to keep `Marketing`/`Content Editor` out.** Rejected —
  the spec is explicit that this is a narrower grant than `admin`'s usual "full catalog"
  posture; seeding it inside the loop would silently regress on any future catalog-wide
  admin backfill.

## Related
Extends `ContentPage` from ADR-0059 (headless CMS content model). Reuses the
`SELECT ... FOR UPDATE` compare-and-set pattern from ADR-0054 (internship-completion
mark-complete). Reuses the public read-mostly / `status='published'`-filter pattern from
ADR-0034 (public marketing API surface).
