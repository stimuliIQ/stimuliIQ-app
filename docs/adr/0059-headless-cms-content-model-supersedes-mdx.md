# ADR 0059: Headless CMS content model — supersedes the P5 MDX/Git-as-CMS decision (ADR-0035)

## Status
Accepted — supersedes ADR-0035

## Context
ADR-0035 deliberately deferred blog articles, testimonials, partners, faculty bios, FAQ,
and career listings to MDX files co-located in `apps/web` for Phase 5, explicitly
documenting that "the headless CMS + CRM content-authoring roles are explicitly deferred
to a later CMS phase" (`CONFLICT-P5-1`). `docs/plans/phase-9-completion.md` T8/T22/T32 is
that later phase: `docs/go-live-checklist.md` Tier 2 called out that non-technical
marketing/content roles could not self-serve without it, and `docs/01-prd-website.md §9`
always specified CRM-managed content via a headless content API as the target state.

## Decision
Nine new CRM-managed, tenant-scoped Prisma models replace the MDX source of truth for
these content types: `BlogCategory`, `BlogPost`, `Testimonial`, `Partner`, `FacultyBio`,
`ContentPage` (generic block-based pages), `NewsletterSubscription`,
`ContactSubmission`, `CareerApplication`. Shared conventions:

- **`ContentStatus` enum** (`draft|published|archived`) is shared across every
  content-authoring model (plus `LandingPage`, T12) — one lifecycle vocabulary for
  "is this visible to the public yet," not a bespoke enum per model.
- **Two controllers per resource type** (`apps/api/src/modules/content/`): a CRM
  controller (full CRUD, `content.*` permissions, sees all statuses) and a `Public*`
  controller (read-only, hard-filters `status = 'published'`, no auth). The public
  read-mostly surface follows the same pattern ADR-0034 established for programs.
- **`ContentPage.body` is a JSON array of typed content blocks**
  (`[{type:"hero", data:{...}}, {type:"richtext", data:{html:"..."}}]`), not a single
  HTML/MDX blob — a block-based model lets the future CRM page-builder UI compose pages
  from primitives without a schema migration per new block type. `BlogPost.body`/
  `Testimonial.quote`/`FacultyBio.bio` remain single rich-text strings (blog posts and
  bios are linear documents, not block-composed pages).
- **Rich-text/HTML fields are sanitized (DOMPurify) at the render sink, never
  server-side** — the server stores raw authored content (write access is CRM-only) —
  identical posture to `forum_posts.body` (ADR-0045). `@repo/ui` gains a shared
  DOMPurify-backed rich-text/MDX render-sink component (T19) so every consumer (web
  blog/pages, LMS, CRM previews) sanitizes through one choke point.
- **Image/file fields store StorageProvider keys, never raw URLs**
  (`cover_image_key`, `logo_key`, `photo_key`, `resume_storage_key`) — a signed/CDN URL
  is minted at serve time, matching the existing `Program.ogImageKey` convention (§7 of
  `docs/05`).
- **`Testimonial.studentName` and `FacultyBio.name` are intentionally left unmasked** in
  audit snapshots (no `PII_FIELD_REGISTRY` entry, ADR-0049) — a testimonial/bio is
  explicitly consented public-facing marketing content, unlike `Lead.name` or
  `Mentor.fullName`, which are internal records about people who have not necessarily
  consented to public display.
- `NewsletterSubscription`/`ContactSubmission`/`CareerApplication` are the **public
  write** side of the same module (footer newsletter opt-in, contact form, careers apply)
  — public POST endpoints are Turnstile-captcha-gated and rate-limited via
  `PublicBookingRateLimiter`, reusing the ADR-0019/ADR-0036 pattern rather than inventing
  a new one.

Existing DB-backed catalog content (programs, pricing, coupons) is **unaffected** —
ADR-0035 already kept those live from the DB in P5; this ADR only migrates what ADR-0035
had deferred to MDX.

## Consequences
- Marketing/content roles can now author and publish blog posts, testimonials, partners,
  faculty bios, and generic pages from the CRM with no repo/PR access required — closing
  the exact gap ADR-0035 flagged as deferred.
- `apps/web` stops hardcoding/reading MDX for these content types (T32) and instead reads
  from the new public content endpoints; this is a **one-time content migration**
  decision point (import existing MDX as seed rows, or re-author in CRM) flagged as a
  risk in `docs/plans/phase-9-completion.md` and tracked in `docs/phase-9-followups.md`
  if not fully completed this pass.
- The MDX toolchain (`@next/mdx`, `@mdx-js/*`, `remark-frontmatter`) installed under
  ADR-0035 is **not removed** by this ADR — `apps/web` may still use MDX for content
  ADR-0035 never covered (e.g. static legal pages) or as a fallback; a full toolchain
  removal is a separate, later cleanup decision, not implied by this one.
- Nine new tables add nine new `content.*`-family permission keys to the catalog
  (`content.blog.*`, `content.testimonials.*`, etc.) — permission-catalog discipline
  (every `@RequirePermission` seeded AND granted) applies identically to this module.
- Slug/email uniqueness for `blog_categories`/`blog_posts`/`content_pages`/
  `newsletter_subscriptions` is enforced via raw-SQL partial-unique indexes (not
  expressible in `schema.prisma`), same recurring caveat as every other per-tenant-slug
  table in this codebase (`docs/05 §4`).

## Alternatives considered
- **Sanity / Strapi / Directus (external headless CMS).** Rejected, same reasoning
  ADR-0035 already gave for deferring this option: a hosted external CMS adds a second
  auth surface, a second admin UI outside the CRM's existing RBAC model, and a data
  residency/vendor question for India-first PII — building the content model as ordinary
  tenant-scoped Prisma tables inside the existing CRM keeps one RBAC system, one audit
  trail, one deploy.
- **A single generic `content_blocks` polymorphic table for every content type (blog,
  testimonials, partners, bios, pages) instead of nine distinct models.** Rejected — blog
  posts, testimonials, and partners have materially different, well-defined field shapes
  (SEO fields, ratings, categories) that a single polymorphic JSON blob would either lose
  type-safety on or force into an ever-growing optional-field union; distinct models with
  a shared `ContentStatus` enum gets the "one lifecycle vocabulary" benefit without the
  schema-less downside.
- **Keep MDX and add only a CRM authoring UI that writes MDX files via a Git API (e.g.
  GitHub commits).** Rejected — this was considered and rejected implicitly by choosing
  the DB-backed model: committing to Git from a running API process on every content save
  is slow, requires a GitHub token with repo-write scope living in the API's runtime
  environment, and re-triggers a full Next.js rebuild/deploy for every typo fix — the
  opposite of what a "publish now" CRM workflow needs.

## Related
Supersedes ADR-0035 (MDX/Git-as-CMS). Reuses the public read-mostly pattern from
ADR-0034 (public marketing API surface), the DOMPurify render-sink control from ADR-0045
(forum), the unmasked-consented-PII posture from ADR-0049 (DPDP erasure/masking), and the
public-write rate-limit pattern from ADR-0019 (public booking intake).
