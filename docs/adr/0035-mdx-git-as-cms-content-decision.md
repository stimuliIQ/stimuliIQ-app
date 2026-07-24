# ADR 0035: MDX / Git-as-CMS for marketing and blog content

## Status

Superseded by ADR-0059 (Phase 9 — headless CMS content model). The MDX toolchain
installed under this decision is not necessarily removed (see ADR-0059's Consequences),
but blog posts, testimonials, partners, faculty bios, FAQ/generic pages, and career
listings are no longer sourced from MDX as of Phase 9 — they are CRM-managed DB rows.

Accepted (historical — see superseding note above)

## Context

`docs/01-prd-website.md §9` implies content (blog articles, testimonials, partners, FAQ,
faculty bios, gallery, career roles, landing pages) would be "managed from the CRM by
`marketing`/`content` roles via a headless content API." Building that system in Phase 5
would require:

- New DB tables (`posts`, `testimonials`, `partners`, `faq_entries`, `pages`, etc.)
- A CRM content-authoring UI with new role-scoped routes
- A headless content API with its own auth surface
- Editorial workflow tooling (draft, review, publish)

This is a substantial scope expansion that conflicts with the P5 phase boundary.

Programs, pricing, and coupons are already live in the DB (CRM-managed in P1/P2) and
continue to be served from the DB in P5. The question is only about marketing *copy*,
blog articles, and trust-page content.

## Decision

Marketing copy, testimonials, partners, faculty bios, FAQ entries, gallery captions,
career role listings, and **blog articles** ship as **MDX files co-located in `apps/web`**
(Git-as-CMS approach):

- Content authors commit MDX files with typed YAML frontmatter.
- Next.js 15 App Router renders them as SSG/ISR pages.
- `@next/mdx` (installed as part of P5) compiles MDX at build time.
  MDX toolchain: `@next/mdx`, `@mdx-js/loader`, `@mdx-js/react`,
  `remark-frontmatter`, `remark-mdx-frontmatter`, `rehype-slug`.
  `next.config.mjs` uses `createMdx` wrapper with `pageExtensions: ["ts","tsx","mdx"]`.
- Blog articles include `author`, `categories`, `publishedAt`, and related posts in
  frontmatter, enabling `Article`/`BlogPosting` JSON-LD at render time.
- **No blog authoring UI, no editorial workflow, no comments** in P5.

Programs, pricing, and coupons remain **live from the DB** (already CRM-managed via P1/P2
surfaces). The public API (ADR-0034) reads from the DB at request time.

The headless CMS + CRM content-authoring roles are explicitly deferred to a later CMS
phase (documented as `CONFLICT-P5-1` in `docs/specs/phase-5-website.md`).

## Consequences

- Zero new infrastructure, zero new DB tables for content in P5.
- Content is Git-auditable, review-gated via PRs, and SSG-perfect (no runtime DB query
  for blog/trust pages).
- The approach is investor-grade for launch; the content volume at launch is manageable
  via Git.
- Content authors must have repo access or use GitHub's web UI; non-technical authors
  cannot self-serve without the deferred CMS phase.
- The MDX → CMS migration path is clean: MDX files become seed data or are imported
  once the headless content API is built.
- `apps/web` gains `zod` as a direct dependency for frontmatter schema validation at
  build time (verifies required fields in each MDX file's YAML block).

## Alternatives considered

- **Contentlayer**: considered, rejected — Contentlayer is in maintenance mode as of 2025;
  `@next/mdx` with typed frontmatter validation achieves the same result without the
  ecosystem risk.
- **Sanity / Strapi / Directus headless CMS**: deferred to the CMS phase — large additional
  infra, new auth surface, CRM UI extension all required; out of P5 scope.
- **DB-backed blog posts table**: would require a new CRM authoring UI and content API;
  deferred to the CMS phase for the same reasons.
