# Phase-10 UI Polish — UX Audit: CRM "Website" Section

> Usability audit + UI-layer redesign recommendation for the four CRM screens a
> non-technical client admin uses to edit the public marketing site:
> **Page Builder** (`/marketing/page-builder`), **Site Settings** (`/marketing/site-settings`),
> **Blog CMS** (`/marketing/blog-cms`), **Landing Pages** (`/marketing/landing-pages`).
>
> Evidence: 15 rendered screenshots in `apps/crm/ux-shots/` + component source in
> `apps/crm/src/components/{page-builder,site-settings,content,landing-pages}`.
> Constraints honored throughout: **zero functionality loss, no backend/API changes,
> no drag-canvas WYSIWYG rebuild** — every recommendation is a relabel, regroup,
> collapse, cross-link, or client-side render change on the existing screens.

---

## 1. The persona and the core mismatch

**Persona:** the marketing-agency client's admin. She knows her website ("the About
page", "our logo wall", "the WhatsApp button"). She does **not** know: *slug, SEO title
vs title, eyebrow, image key, OG, E.164, live_collection_ref, variant, version,
draft/publish workflow*. Her mental model is task-shaped: **"I want to change the text
/ photo on my About page."**

**The UI's mental model is data-shaped:** it exposes the database (`ContentPage`,
`SiteSetting`, `Testimonial`, `LandingPage`) rather than the task. The same word
"page" means three different things across three nav items, field labels are schema
property names, and identity is expressed as slugs, enum values, and version integers.
Severity ratings below use the standard usability scale: **4 = critical (blocks the
task), 3 = major, 2 = minor, 1 = cosmetic.**

---

## 2. Cross-cutting problems (affect all four screens)

### C1. Three kinds of "pages", four doors, no map — **Severity 4**
*Evidence: nav sidebar in every screenshot; `01-page-builder-list.png`,
`10-blog-cms-pages.png`, `11-landing-pages.png`; `apps/crm/src/lib/nav-config.ts:173-176`.*

"Website" contains **Page Builder**, **Blog CMS → Pages**, and **Landing Pages** — all
of which show tables titled "pages", with overlapping rows. The persona asking "where
do I edit my About page?" has a 1-in-3 guess, and two of the three answers are wrong
(one of them fails with a server error — see B1). Nothing on any screen explains the
split.

**Recommendation (UI-only):**
- Rename the nav items to task language: **"Website Pages"** (Page Builder),
  **"Blog & Content"** (Blog CMS), **"Campaign Pages"** (Landing Pages),
  **"Menus, Footer & Contact"** (Site Settings). Routes stay `/marketing/*` (nav
  labels are already display-only in `nav-config.ts`).
- Give each of the four pages a one-line "what lives here / what doesn't" subtitle
  with inline links to the sibling screens, e.g. on Page Builder: *"Your main website
  pages (Home, About, Gallery…). Blog posts live in **Blog & Content**; ad-campaign
  pages live in **Campaign Pages**."* This replaces the current subtitles, which are
  developer release-notes (see per-page findings).

### C2. Technical vocabulary everywhere — **Severity 4**
*Evidence: every screenshot; labels come from `block-forms/*.tsx`,
`shared-fields.tsx`, `seo-defaults-card.tsx`, `contact-whatsapp-card.tsx`.*

The persona must currently translate ~15 terms of jargon to do anything. One
find-and-replace pass over labels/helper text (no data or validation change — zod
schemas and payloads untouched) fixes most of it:

| Current label / copy | Where | Plain replacement |
|---|---|---|
| Slug | PB list, create drawer, Blog CMS, Landing Pages | **Web address** — render as the full URL: `stimuliiq.com/about` (prefix is static text; input still edits only the path part) |
| SEO title / SEO description | PB editor, create drawer | **Title shown in Google (optional)** / **Description shown in Google (optional)**, grouped under "Search engine listing" |
| Eyebrow | Hero form | **Small label above the headline (optional)** |
| Highlighted word … "Must be an exact substring of the headline above." | Hero form | **Words to highlight in green** — "Copy the exact words from the headline you want colored." |
| Background image key · `e.g. marketing/hero/bg-1.jpg` | Hero, media gallery, content split | **Image file** + live thumbnail preview (see PB-4) |
| Live collection (reference) | Block picker, block card | **Automatic section** — "Shows your latest testimonials / partner logos / programs automatically. Edit the items themselves in Blog & Content." |
| Buttons (0/2) · Links (7/12, min 1) · Columns (3/6, min 1) | Hero/CTA forms, Site Settings | **Buttons — up to 2** · **Links — 7 of 12 (keep at least 1)** |
| CTA / Call-to-action band | Block picker | **Button banner** ("A colored strip with a heading and buttons") |
| Default OG image path | Site Settings → SEO | **Social sharing image** — "Shown when someone shares your site on WhatsApp/LinkedIn." |
| E.164-like format, no leading + required | Site Settings → Contact | **Country code + number, digits only — e.g. 919876543210** |
| Version 4 / Revert to this version | Version history | **Saved 19 Jul, 9:45 PM by …** / **Restore** (see PB-6) |
| published (lowercase chip) | All list tables | **Live** (green) / **Draft** / **Hidden** (archived) |
| Variant `a` | Landing Pages | **Version A** ("for A/B testing — visitors are split between versions") |
| college_partner / hiring_partner | Blog CMS → Partners | **College partner / Hiring partner** (display map over the enum) |
| Draft/publish workflow for every marketing-site content type | Blog CMS subtitle | *"Blog posts, testimonials, partner logos, and faculty profiles shown on your website."* |

### C3. Save-is-live has a warning but no exit — **Severity 3**
*Evidence: `01` subtitle "Every save publishes immediately — there is no draft/approval
step"; save dialog in `page-builder-editor.tsx:291-300`; revert flow in
`version-history-panel.tsx`.*

The confirm dialog before publish is good. But after saving, the user gets a toast and
nothing else: no way to *see* what they just changed, and undo requires discovering
"Version history" → decoding version numbers. Anxiety ("did I just break the site?")
with no reassurance.

**Recommendation (UI-only, uses existing endpoints):**
- Post-save toast gains two actions: **"View live page"** (external link to the
  public URL — derivable from the slug the editor already has) and **"Undo"** —
  which calls the existing revert-to-newest-version mutation with its existing
  confirm dialog. Save-then-undo is exactly the "newest row" case the code already
  documents (`version-history-panel.tsx` header, QA D2).
- Soften the list subtitle: *"Changes go live on your website as soon as you press
  Save & publish. You can restore any earlier version at any time."* Same fact,
  paired with the safety net instead of a bare threat.

---

## 3. Page Builder

### PB-1. Editor is a wall of every field of every block, always expanded — **Severity 4**
*Evidence: `02-page-builder-editor.png`, `04-page-builder-block-form.png` — one Hero
block's form fills two screens; a real page has 5–8 blocks. Code:
`page-builder-editor.tsx` renders every `BlockCard` open; `block-card.tsx` has no
collapsed state.*

The persona wanting to change one headline must scroll past Layout, Eyebrow,
Highlighted word, Background image key, Trust badge, Buttons (0/2)… for *every*
section. There is no way to see the page's shape (its list of sections) at a glance —
the outline is buried inside the forms.

**Recommendation:** collapse block cards by default; header row becomes the page
outline. `BlockCard` already owns its form and header — add an `expanded` state:
- Collapsed card = icon + friendly block name + **content excerpt** (first ~60 chars
  of the block's headline/heading/first item, read via the form's existing `watch`) +
  the existing move/delete controls + the existing "Needs attention" chip.
- Click header to expand one card; fields render exactly as today. Zero functionality
  loss — validation still runs on all blocks at Save (forms stay mounted; only the
  field area is visually collapsed).

### PB-2. Blocks have no recognizable identity — numbered clones — **Severity 3**
*Evidence: `02` shows "1. Hero"; a page with two Feature grids shows "3. Feature grid"
and "6. Feature grid". Code: `block-card.tsx:178-180` renders `{index + 1}. {meta.label}`.*

Numbers change when blocks move, and two blocks of the same type are
indistinguishable without opening both.

**Recommendation:** replace `1. Hero` with **icon + label + excerpt**
(`Hero — "We bridge the gap between college and career."`). Add a lucide icon per
block type to `BLOCK_TYPE_META` (`page-builder-block-meta.ts`) and reuse the same
icon+label+description in the block picker (`block-picker.tsx`), so what you picked is
what you later recognize. Drop the ordinal (position is already visual).

### PB-3. Metadata outranks content: "Page details"/SEO first — **Severity 3**
*Evidence: `02` — the first, most prominent card is Title/SEO title/SEO description
with `15/70`, `112/160` counters; the actual page content starts below the fold.*

The persona reads top-down and immediately meets the two hardest concepts (Title vs
SEO title) before any content.

**Recommendation:** keep the Title input, move **SEO title/description into a
collapsed "Search engine listing (optional)" disclosure** with one helper line:
*"What Google shows for this page. Leave blank to use the page title."* Same fields,
same state, same save payload. Apply the same collapse in the create drawer
(`create-builder-page-drawer.tsx`), where Slug also needs the URL treatment from C2
plus helper *"This becomes the page's address. It can't be changed after creation."*

### PB-4. Images are raw storage paths with no preview — **Severity 4**
*Evidence: `02`/`04` "Background image key — e.g. marketing/hero/bg-1.jpg"; same
pattern in `hero-fields.tsx` (flanking photos, center image), `media-gallery-fields.tsx`,
`content-split-fields.tsx`.*

"Image key" is the single most persona-hostile field in the product: she cannot know
what keys exist, cannot see what she typed resolves to, and a typo silently breaks the
live page (save-is-live!). This is the "change the photo on my About page" task — and
it is currently impossible without a developer.

**Recommendation (UI-layer, no new API):**
- Rename to **"Image"**; helper *"The image's file name in your media library."*
- Render a **live thumbnail preview** next to the input (the public asset base URL is
  known to the app; `onError` → friendly "Image not found — check the file name"
  warning instead of silent breakage). This alone converts a blind field into a
  verifiable one.
- Where a CRM media/asset listing endpoint already exists, back the input with a
  combobox/datalist of known keys. If none exists, do not invent one (constraint) —
  the preview + helper is the fix.

### PB-5. Dead-end and silent-loss moments — **Severity 3**
*Evidence: `page-builder-editor.tsx` — Save is `disabled` when any block is invalid
with no visible reason at the button; "Back to pages" (`onBack`) discards unsaved
edits with no prompt.*

- Disabled Save with the reason far away (a "Needs attention" chip possibly scrolled
  off-screen): add a caption under/next to the disabled button — *"2 sections need
  attention before you can publish"* — derived from the existing `validity` map, and
  make it a click-to-scroll link to the first invalid card.
- Add an unsaved-changes guard on Back (any form `isDirty` or blocks
  added/moved/removed): reuse the existing `ConfirmDialog` — *"Leave without
  publishing? Your edits will be lost."*
- Rename the **Save** button to **"Save & publish"** so the button matches both the
  confirm dialog and reality.

### PB-6. Version history speaks in integers — **Severity 3**
*Evidence: `06-page-builder-version-history.png` — four rows "Version 4/3/2/1", all
"19 Jul 2026" (no time), a jargon badge "Before last save", every row with an
identical **primary** "Revert to this version" button; "View" reveals only "Title at
this version / N block(s)".*

The persona's question is "put it back how it was yesterday". Version integers,
date-only timestamps that all collide on the same day, and a wall of equally-weighted
primary buttons answer none of that — and "Revert" sounds destructive.

**Recommendation:** relabel the drawer **"Restore an earlier version"**; row title
becomes **"Saved 19 Jul 2026, 9:45 PM — by Stimuliiq Admin"** (`formatAbsoluteDate`
with time; data already in `createdAt`); badge → **"Most recent backup"** with helper
*"Restoring this undoes your last save."*; button → secondary-styled **"Restore"**,
confirm copy *"Your website will immediately show this earlier version. Nothing is
deleted — the current content is kept as a backup too."* (the code already guarantees
this). "View" → **"Show contents"**, and enrich the existing snapshot detail with the
block-type labels list (data already returned: `body`), e.g. *"Hero · Why we exist ·
Stats · How it works"* — making versions recognizable by shape.

### PB-7. List columns are for developers — **Severity 2**
*Evidence: `01-page-builder-list.png` — monospace `slug` column, all-green `published`
chips (builder pages are always published, so the column carries no information),
"Last published 1/1/2026, 5:30:00 AM", homepage listed under its 60-char SEO title
"StimuliiQ — Internship & Career Training for Students in India", and no visible edit
affordance (row-click only).*

**Recommendation:** columns → **Page** (title, with a "Homepage" badge on `home`),
**Web address** (`stimuliiq.com/about` + external-link icon "View live"), **Last
updated** (date + short time, no seconds). Drop the Status column here (it is
constant; zero information loss). Add an explicit **"Edit"** button per row alongside
row-click.

---

## 4. Site Settings

### SS-1. Label/Link pairs demand hand-typed internal paths — **Severity 4**
*Evidence: `07-site-settings-nav.png`, `08-site-settings-footer.png` — every nav and
footer link is a free-text `/programs`-style input; the very first row is the trap in
action: Label "Courses" pointing at `/programs`. Code: `shared-fields.tsx
LinkListField` placeholder "/about or https://…".*

A wrong character in a nav link breaks the site header, live, sitewide. The persona
doesn't know the site's internal paths.

**Recommendation (UI-only):** turn the Link input into a **combobox/datalist
pre-filled with the site's known destinations** — the builder pages list (already
fetchable via the existing list hook) plus the fixed public routes (programs, blog,
contact, mentors…), shown as "About page — /about". Free text stays allowed (external
`https://` links, so zero functionality loss). Helper: *"Pick one of your pages, or
paste a full link."*

### SS-2. Scattered Save buttons and no dirty-state — **Severity 3**
*Evidence: `08-site-settings-contact.png` — two cards, two Saves; Footer tab has
three cards/three Saves (`site-settings-page.tsx:74-78`); on Navigation (`07`) the
single Save is below 7 link rows, off-screen. Code: `site-setting-card.tsx` puts one
Save per card.*

The persona edits the WhatsApp number, scrolls, sees another Save, and cannot tell
what is saved and what isn't. Partial saves are invisible.

**Recommendation:** keep per-card forms (they map 1:1 to setting keys — no payload
change), but (a) add an **"Unsaved changes" pill** to any dirty card header
(`formState.isDirty` is already available), (b) make each card's Save row **sticky at
the card bottom** on long cards (Navigation, Footer columns), and (c) on save success
show the same reassuring toast as the builder: *"Saved — live on your website"* with a
"View site" link.

### SS-3. Jargon tab and field names — **Severity 3**
*Evidence: `08-site-settings-seo.png` ("SEO defaults", "Default OG image path",
"Site-relative path (not a full URL) — combined with the site URL at render time"),
`08-site-settings-contact.png` ("E.164-like format, no leading + required"), page
subtitle "sitewide, marketing-owned" (`site-settings-page.tsx:50`).*

**Recommendation:** apply the C2 vocabulary table. Tabs: **Menu · Footer · Search &
sharing · Contact**. Page subtitle: *"Things that appear on every page of your
website: the top menu, the footer, contact details, and how the site appears on
Google and social media."* Keep the P10-2 stats pointer but make it plain **and a
link**: *"Looking for the homepage numbers (15,000+ students…)? Edit them on the
[Home page → Stats section]."* — deep-linking straight into the builder editor is
pure routing, no API change.

### SS-4. Nested repeaters with counter codes — **Severity 2**
*Evidence: `08-site-settings-footer.png` — "Columns (3/6, min 1)" each containing
"Links (7/20, min 1)"; two levels of up/down/delete icon triplets.*

**Recommendation:** humanize counters per C2; collapse each footer column card to its
heading by default (same collapse pattern as PB-1) so the tab reads as "Company /
Programs / Legal" instead of ~20 open link rows.

---

## 5. Blog CMS

### B1. The "Pages" tab is a trap that duplicates Page Builder — **Severity 4 (worst finding in the audit)**
*Evidence: `10-blog-cms-pages.png` — the same six builder pages from `01`
(Careers, Gallery, About Us, home…) listed again under Blog CMS with **red delete
icons** and edit-on-row-click opening a **raw HTML textarea** drawer
(`content-pages-manager.tsx`: no `isBuilderManaged` handling; the form is
Title/Slug/Body-HTML/Status). The API **unconditionally rejects** generic edit/
delete of builder-managed rows (`content-pages.service.ts:37-57`,
`content.builder_managed_forbidden`). The screenshot also shows the confusion this
has already caused: both "About Us / about" and a stray "About Stimuliiq / about-us"
exist.*

So the UI invites the persona to delete her homepage or type HTML over her About page
from a tab called "Blog CMS", and rewards the attempt with a 403 error. Every path
here is bad: she either fails confusingly or edits the wrong "About" page and wonders
why the site didn't change.

**Recommendation (UI-only, zero functionality loss):**
- The list query already supports `isBuilderManaged` (`content-pages.service.ts:61`).
  Either **filter builder pages out** of this tab (`isBuilderManaged: false`), or —
  gentler — keep them visible as **non-clickable rows badged "Edited in Website
  Pages →"** linking to the builder editor, with edit/delete hidden for them.
  Recommended: badge + link (preserves "where is my page?" discoverability).
- Rename the tab **"Simple pages"** with subtitle *"Plain pages like privacy policy
  and terms. Your main website pages are edited in **Website Pages**."*
- Label the body field **"Page content (HTML)"** honestly — it is a developer field;
  hiding it behind an "Advanced" disclosure is acceptable since the persona should
  rarely be here.

### B2. Section name and shape mislead — **Severity 3**
*Evidence: `09`–`10` — a page titled "Blog CMS" whose tabs are Blog · Testimonials ·
Partners · Faculty Bios · Pages.*

Four of five tabs are not blog. The persona looking for "add a student quote" or
"add a partner logo" will not open "Blog CMS".

**Recommendation:** rename to **"Blog & Content"** (title + nav, per C1); per-tab
one-liners already exist and are decent — keep them, de-jargon the page subtitle
(C2 table).

### B3. Raw enums, magic order numbers, logo lists without logos — **Severity 3**
*Evidence: `10-blog-cms-partners.png` — Category column shows `college_partner` /
`hiring_partner`; Order column shows `0, 0, 1, 2 …` (two zeros — the number is
per-category, which nothing explains); a partner-**logo** manager that displays no
logos. `10-blog-cms-testimonials.png` shows "4.8 ★" while the builder's testimonial
filter asks for "Minimum rating (0-50)" (`live-collection-ref-fields.tsx:135-142`) —
two scales for the same value.*

**Recommendation:** display-map enum values ("College partner"); render the stored
logo as a small thumbnail in the Name cell; replace the raw Order integer with
up/down reorder buttons that write the same numbers (or hide the column and keep
ordering in the edit drawer — either way stop printing bare integers). Relabel the
builder's min-rating field **"Minimum rating (e.g. 45 = 4.5 stars)"** — a copy fix
for a data-format wart that can't change.

### B4. Delete is the only visible action; category form is permanent clutter — **Severity 2**
*Evidence: `09-blog-cms-default.png` — each row's Actions column is a lone red trash
icon (edit is invisible row-click); the "New category name / Slug / Add category"
mini-form sits permanently between search and the posts table.*

**Recommendation:** add an explicit **Edit** button per row across all tabs (pattern
also fixes PB-7); tuck category creation behind a **"Manage categories"** button →
drawer, and auto-generate the category slug from the name (editable, per C2 "Web
address" treatment).

---

## 6. Landing Pages

### L1. Unexplained campaign machinery — **Severity 2**
*Evidence: `11-landing-pages.png` — columns Slug (`fullstack-monsoon-offer`),
Campaign (`monsoon-2026`), Variant (`a`); the heading "Landing Pages" appears twice
(page title + tab + section title); delete-only Actions again.*

This screen's persona-facing risk is lower (agency staff usually drive campaigns),
but "Variant: a" is pure insider code, and the double heading suggests broken UI.

**Recommendation:** drop the inner duplicate heading (the tab already says it);
Variant renders **"Version A"** with a header tooltip *"A/B test versions — visitors
are split between versions of the same campaign"*; Slug column gets the C2 URL
treatment with a "View live" link; add the standard Edit button; subtitle gains the
C1 wayfinding line *"Pages for ads and campaigns. Your permanent website pages live
in **Website Pages**."* Lead Forms tab keeps its pairing — it's the one
already-good relationship on these screens.

---

## 7. Golden path: "Change the About page headline" in the redesigned UI

1. Sidebar → **Website → Website Pages**. The subtitle reads: *"Your main website
   pages. Changes go live when you press Save & publish — you can always restore an
   earlier version."*
2. She sees a table of **Page / Web address / Last updated**. The row "About Us —
   stimuliiq.com/about" has **View live** and **Edit**. She clicks **Edit**.
3. The editor shows the page title, a collapsed *"Search engine listing (optional)"*
   line she ignores, and then the page as a **list of collapsed sections she
   recognizes**: `Hero — "We bridge the gap between college and career."`,
   `Story — "Why we exist"`, `Numbers — 15,000+ students`, `Automatic section —
   Testimonials`…
4. She clicks the Hero section. It expands to the familiar fields; **Main headline**
   is right there. She types the new headline. The excerpt in the section header
   updates as she types — confirmation she's in the right place.
5. She clicks **Preview** to see it rendered, closes the drawer, clicks
   **Save & publish**. The dialog says: *"This goes live on your website
   immediately. Your current version is kept as a backup you can restore."* She
   confirms.
6. Toast: **"Live now — View page · Undo."** She clicks *View page*, sees the new
   headline on the real site, and closes the tab. (Had it looked wrong, *Undo* would
   have offered to restore the backup in one click.) Total jargon encountered: zero.

---

## 8. Prioritized fix list (all UI-layer, no API changes)

| # | Fix | Findings | Effort |
|---|---|---|---|
| 1 | Blog CMS "Pages" tab: badge/redirect builder-managed rows, hide their edit/delete | B1 | S |
| 2 | Vocabulary pass (labels, helpers, subtitles, chips) per C2 table | C2, SS-3, B2, L1 | S |
| 3 | Collapsed block cards with icon + name + content excerpt | PB-1, PB-2 | M |
| 4 | Image inputs: rename + live thumbnail preview + not-found warning | PB-4 | M |
| 5 | Post-save toast with "View live page" + "Undo"; softened save-is-live copy | C3 | S |
| 6 | Version history → "Restore an earlier version" (timestamps with time, Restore, contents summary) | PB-6 | S |
| 7 | Nav/footer Link inputs → combobox of known pages (free text still allowed) | SS-1 | M |
| 8 | Dirty-state pills + sticky Save per settings card; unsaved-changes guard on editor Back; "Save & publish" button label; disabled-Save reason | SS-2, PB-5 | M |
| 9 | List-table pass: URL column + View live + explicit Edit buttons; humanized enums, logo thumbnails, no raw order integers | PB-7, B3, B4, L1 | M |
| 10 | Nav renames + per-page wayfinding subtitles; SEO fields behind disclosure | C1, PB-3 | S |

Items 1, 2, 5 and 6 alone would move this UI from "confusing even for a designer" to
navigable; items 3, 4 and 7 are what make the persona self-sufficient.
