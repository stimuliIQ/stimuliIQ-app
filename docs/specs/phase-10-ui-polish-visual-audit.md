# Phase-10 UI Polish — Visual Design Audit: CRM "Website" Section

> Scope: `Page Builder`, `Site Settings`, `Blog CMS`, `Landing Pages` — the 4 screens a
> **non-technical client** uses to edit the public marketing site. Owner complaint:
> "visually confusing / overwhelming."
>
> This is an **audit + implementable spec only**. No application code was changed while
> producing this document. Constraints honored: zero functionality loss, no new
> dependencies (shadcn/ui + Radix + Tailwind + `lucide-react` only, already installed at
> `^0.469.0`), no backend changes.
>
> Evidence base: `docs/07-design-system.md`, all 15 screenshots in
> `apps/crm/ux-shots/*.png`, and the implementing code in
> `apps/crm/src/components/page-builder/*`, `apps/crm/src/components/site-settings/*`,
> `apps/crm/src/lib/page-builder-block-meta.ts`, `packages/ui/src/components/*`.

---

## 1. Diagnosis — what's actually causing "overwhelming"

Cross-referencing the screenshots against the code, the root causes are structural, not
decorative. Ranked by impact:

1. **Every block is permanently fully expanded — there is no collapsed/summary state.**
   `apps/crm/src/components/page-builder/block-card.tsx` (`KnownBlockCard`) always renders
   the full `<BlockDataFields>` form. Screenshots `02-page-builder-editor.png` and
   `04-page-builder-block-form.png` show a single "Hero" block already consuming the
   entire viewport height before you even reach block 2. On a real page with 6-10 blocks
   this becomes hundreds of stacked inputs — the #1 source of "wall of inputs." The task
   brief's premise ("collapsed blocks show only a title") describes the *intended* state;
   the *actual* code has no collapse at all, which is worse.

2. **The "Page details" card and every block card use identical visual weight.**
   Both are `rounded-lg border border-border p-4` boxes (`page-builder-editor.tsx` lines
   230-237 vs. `block-card.tsx` line 156) with the same `text-sm font-medium` header
   style. Nothing tells the eye "this one card configures the page, these N cards are
   repeatable content sections." In `02-page-builder-editor.png` "PAGE DETAILS" and
   "1. Hero" read as two items in the same flat list.

3. **No visual identity per block type.** `block-card.tsx` header (line 178) renders only
   `{index + 1}. {meta.label}` as plain text — no icon, no color. The "Add a block" picker
   (`block-picker.tsx` lines 34-48) is the same: plain text buttons, no icon. In a page
   with a Hero, two Content-splits, and a Stat group, all four list items look
   identical except for their text label — the client has to *read* every row to
   orient, every time.

4. **Oversized, repetitive row editors for every link list** (`08-site-settings-nav.png`,
   `08-site-settings-footer.png`). `shared-fields.tsx` (`LinkListField`, `CtaListField`)
   and `footer-columns-card.tsx` render each row as a bordered box with two **stacked**
   `label + full-height input` pairs (`Input` defaults to `h-10` with its own `<Label>`
   above, per `packages/ui/src/components/input.tsx`). Result: a 2-field row costs
   ~110px of vertical space, and the word "Label"/"Link" repeats 7+ times down the
   screen for the nav links alone, then again inside every footer column (a **nested**
   repeater — `footer-columns-card.tsx` lines 29-45 — doubling the repetition:
   column-heading row + its own link rows, each link row re-stating "Label"/"Link"
   again).

5. **No visual summary anywhere.** Nothing in the block list, the page list, or the row
   editors shows *content* — only structural labels ("1. Hero", "Links (7/12, min 1)").
   A client scanning the page list (`01-page-builder-list.png`) or the block list has to
   open/scroll into every item to know what it says.

6. **Density/whitespace is uniform "spacious" everywhere**, even though
   `docs/07-design-system.md` §12 explicitly calls for CRM to run in **compact density**
   (`data-density="compact"`, defined in `packages/ui/src/styles.css` lines 116-153) —
   but `Input`, `Card`, and the block-card/row-editor markup use fixed Tailwind classes
   (`h-10`, `p-6`, `p-4`, `gap-2`) instead of the `--density-*` CSS variables that already
   exist for exactly this purpose. The density system is *defined* but not *wired into*
   these screens, so the CRM's own compact mode isn't doing its job here.

7. **Color/typography carry no meaning beyond the semantic status chip.** `StatusChip`
   ("published") is used correctly. Everything else — section headers, card borders, tab
   bar — is neutral gray/black regardless of what it represents (page-level settings vs.
   a content block vs. a destructive zone vs. a currently-open tab). The one place color
   *is* used with intent (the green "Save"/primary buttons) is undercut by "Version
   history" and "Preview" sitting at the same size right next to it
   (`page-builder-editor.tsx` lines 209-227), so Save doesn't visually win.

8. **Site Settings' inline "New category" mini-form** (`09-blog-cms-default.png`) floats
   directly above the posts table with no visual boundary — it reads as part of the table
   header rather than a separate, rare admin action, competing with the primary "New
   post" task for attention.

9. **Minor IA overlap, flagged not fixed here:** `Blog CMS → Pages` tab
   (`10-blog-cms-pages.png`) lists the same `ContentPage` records as the dedicated
   `Page Builder` nav item (`01-page-builder-list.png`), with one extra row
   ("About Stimuliiq" / `about-us`) present in one screenshot but not the other. This is
   an information-architecture question (why does a generic pages list exist inside
   "Blog CMS" *and* as its own top-level "Page Builder" surface?) — out of scope for this
   visual audit; flagging for the orchestrator/PM to confirm intent before anyone
   "fixes" it visually.

None of the above requires new components, new dependencies, or backend changes — they
are collapse states, color/icon tokens already in the palette, spacing-token wiring, and
layout reshuffling of existing `@repo/ui` primitives (`Card`, `Button`, `StatusChip`,
`Input`, `Tabs`, `EmptyState`).

---

## 2. Global visual patterns to establish

These four patterns, once specified, resolve items 1-8 above consistently across all four
screens. Implementer note: none require a new npm package; #2.1 needs one small new
primitive in `@repo/ui` (a generic disclosure wrapper) since the same collapse behavior is
needed in three unrelated places (block cards, footer columns, nav/CTA link rows) — per
CLAUDE.md's "one source of truth, never fork primitives into apps," this belongs in
`packages/ui`, not copy-pasted into `apps/crm`.

### 2.1 New primitive: `CollapsibleSection` (add to `@repo/ui`)

A generic disclosure header + body, built on the same primitives already in the repo
(no new Radix package needed — `@radix-ui/react-tabs` is already a dependency pattern;
use a plain controlled `<button aria-expanded>` + CSS, exactly like `Tabs`/`Drawer` do it,
or wrap `@radix-ui/react-accordion` if the team wants full Radix a11y semantics for
free — either is zero-new-dependency since Radix primitives are already vendored via
shadcn/ui conventions).

```ts
// packages/ui/src/components/collapsible-section.tsx
export interface CollapsibleSectionProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Icon + accent shown at the start of the header row. */
  icon?: React.ReactNode;
  accentTone?: "chart-1" | "chart-2" | "chart-3" | "chart-6" | "neutral"; // see §3
  /** Always-visible header content (title + summary), rendered whether open or closed. */
  header: React.ReactNode;
  /** Trailing header content (badges, action icon-buttons) — stays clickable, not
      inside the disclosure toggle's hit area. */
  headerActions?: React.ReactNode;
  children: React.ReactNode; // the body, only visible when open
  "data-testid"?: string;
}
```

**Critical implementation constraint (zero functionality loss):** the body must be
collapsed via CSS (`hidden` / `max-h-0 overflow-hidden`) or `Radix Accordion`'s own
data-state, **never** a conditional `{open && <Body/>}` unmount. `BlockCard`'s
`KnownBlockCard` owns a live `useForm()` instance per block and reports
`getValues()`/`trigger()` up via `registerFormApi` (`block-card.tsx` lines 141-152) —
unmounting the form on collapse would drop `formApisRef` entries and silently corrupt
Save/Preview's `gatherBlocks()`. Collapse is a **pure visual state**; the form instance
and its `onValidityChange` effect keep running underneath.

Motion: expand/collapse transitions use `duration-fast`/`ease-out` tokens already defined
in `packages/ui/src/styles.css`; respect `prefers-reduced-motion` (already handled
globally at lines 155-165 of that file — no extra work needed if the transition uses
standard `transition-*` utilities).

### 2.2 Block-type icon + accent color (identity system)

Reuse the **existing** `BLOCK_TYPE_META.category` field already in
`apps/crm/src/lib/page-builder-block-meta.ts` (`Content | List | Reference |
Decorative`) as the color grouping, and add one unique `lucide-react` icon per concrete
type for full differentiation. Never color alone (docs/07 §2 rule) — every block card,
every block-picker entry, and the collapsed summary always show the icon **and** the
type's text label together with the color.

Colors reuse the **existing categorical chart palette** (`--chart-1..6`, docs/07 §2) —
these are already the repo's colorblind-safe, non-semantic categorical tokens, so this is
"the intended use of an existing token," not a new one:

| Category | Token | Rationale |
|---|---|---|
| Content | `chart-1` (brand blue) | Largest, "default" family — using the palette's blue (which already mirrors brand-500) reads as the baseline, not an alarm color |
| List | `chart-2` (amber) | Repeating/collection content |
| Reference | `chart-3` (teal) | Pulled live from elsewhere — visually distinct from static content |
| Decorative | `chart-6` (neutral gray) | No editable fields — recedes rather than competes |

Render as a small tinted icon chip (identical visual language to the existing
`StatusChip`/`BadgeChip` "tinted bg at low opacity + strong fg" pattern already used
elsewhere in `@repo/ui` — see `badge-chip.tsx` lines 130-138 and `status-chip.tsx` lines
32-38): `bg-chart-N/15 text-chart-N`, `size-4` icon, `rounded-md`, `p-1.5`.

**Per-type assignment** (all 11 icon names verified present in the installed
`lucide-react@0.469.0`):

| `type` | Category | Color token | lucide icon | Why |
|---|---|---|---|---|
| `hero` | Content | `chart-1` | `PanelTop` | Top-of-page banner |
| `content_split` | Content | `chart-1` | `Columns2` | Text beside image, two-column |
| `stat_group` | Content | `chart-1` | `Hash` | Numbers/stats |
| `feature_grid` | Content | `chart-1` | `LayoutGrid` | Card grid |
| `numbered_steps` | Content | `chart-1` | `ListOrdered` | Numbered sequence |
| `faq` | Content | `chart-1` | `CircleHelp` | Q&A |
| `cta_band` | Content | `chart-1` | `MousePointerClick` | Call-to-action |
| `media_gallery` | List | `chart-2` | `Images` | Photo grid |
| `job_openings` | List | `chart-2` | `Briefcase` | Job listings |
| `live_collection_ref` | Reference | `chart-3` | `Rss` | Live/synced feed from another CMS collection |
| `brain_showcase` | Decorative | `chart-6` | `Sparkles` | Fixed decorative brand moment, no fields |

Implementation: add `icon: LucideIcon` and inherit `category`→color via a small lookup to
`BLOCK_TYPE_META` in `page-builder-block-meta.ts` (this file already centralizes exactly
this kind of per-type metadata — no new file needed). Consume in three places:
`block-card.tsx` header, `block-picker.tsx` grid buttons, and the new collapsed-summary
row (§2.3).

### 2.3 Collapsed-block summary layout

Default state for every existing block on entering the editor = **collapsed**. Newly
added blocks (via "Add a block") open **expanded** (the client just chose it, they're
about to fill it in). A block auto-expands if it fails validation at Save/Preview time
(the existing "Needs attention" chip — `block-card.tsx` lines 181-189 — stays visible
whether collapsed or expanded; clicking it, or a failed Save/Preview, expands + scrolls
that card into view).

Collapsed row layout (single line, ~44-48px tall to match `--density-row-height`):

```
[chevron▸] [icon chip] 1. Hero            "We bridge the gap between college and career."     [Needs attention?]  [⠿ drag] [↑][↓][🗑]
```

- **Chevron** (`ChevronRight` closed / `ChevronDown` open, rotate via CSS not a icon swap,
  respecting reduced-motion) — leftmost, dedicated disclosure control, separate from the
  existing move-up/move-down `Chevron` icon-buttons (those are reorder actions, this is a
  reveal toggle; don't reuse the same icon for two different affordances in one row).
- **Icon chip** — from §2.2.
- **Title** — unchanged `{index+1}. {meta.label}`.
- **Content excerpt** — one line, `text-sm text-fg-muted truncate`, computed per type from
  data already in memory (no new API calls):

| Type | Excerpt source |
|---|---|
| `hero` | `data.headline` |
| `content_split` | `data.heading` |
| `stat_group` | first item as `"${value} ${label}"`, then `"+ N more"` if `items.length > 1` |
| `feature_grid` | `"${items.length} features"` |
| `numbered_steps` | `"${items.length} steps"` |
| `faq` | `"${items.length} questions"` |
| `cta_band` | `data.heading` |
| `media_gallery` | `"${items.length} photos"` |
| `job_openings` | `items.length > 0 ? "${items.length} open roles" : data.emptyStateMessage` |
| `live_collection_ref` | `"Live: ${data.collection} · ${data.layout}"` (e.g. "Live: testimonials · grid-3") |
| `brain_showcase` | static `"Decorative — no fields"` |

Empty/untouched required fields (e.g. a freshly-added block whose `headline` is still
`""`) show the excerpt as italic `"Not filled in yet"` in `text-fg-subtle` rather than an
empty string, so the collapsed row is never blank.

- Trailing: existing "Needs attention" chip (unchanged), then existing move-up/move-down/
  remove icon-buttons (unchanged — already correctly de-emphasized as icon-only ghost
  buttons per docs/07 §8).

This single change (collapse-by-default + summary line) removes the majority of the "wall
of inputs" — a 6-block page becomes a 6-line scannable list instead of a multi-thousand-
pixel scroll, with zero loss of editing capability (expand any row to get the exact same
form that exists today).

### 2.4 Compact row-editor pattern (link lists, footer columns, CTA buttons)

Applies to `shared-fields.tsx` (`LinkListField`, `CtaListField`) and
`footer-columns-card.tsx`'s nested link editor — three call sites, one fix.

**Current** (per row): stacked `Label` `<Input label="Label">` + stacked
`Label` `<Input label="Link">`, each `h-10`, inside its own bordered box → ~90-110px/row,
with the words "Label"/"Link" printed once per row.

**Spec — spreadsheet-style compact rows:**
1. Print the column headers **once**, above the list, as a small `text-xs font-medium
   text-fg-muted` row (reuse the existing "Links (7/12, min 1)" summary line's slot — put
   the column headers directly under it): `Label` | `Link` | *(blank, for controls)*.
2. Each row becomes a single flex row, no per-row border box, no per-row `<Label>`:
   `Input` rendered **without** the `label` prop (already supported —
   `packages/ui/src/components/input.tsx` only renders `<Label>` when `label` is passed)
   and with `aria-label="Link label"` / `aria-label="Link URL"` instead, so screen-reader
   users still get an accessible name (WCAG requirement preserved — this is not a
   regression, `aria-label` is an equally valid accessible name source).
3. Reduce row height: add a `size="sm"` variant to `Input` (`h-8` instead of `h-10`,
   `text-sm`, tighter `px-2.5`) — mirrors the `Button` component's existing `sm/md/lg`
   size scale (`button.tsx` lines 30-35) exactly, for consistency. Use `size="sm"` in
   every compact row.
4. Zebra-free, low-chrome row separators: replace the per-row `rounded-md border
   border-border p-2` box with a plain `border-b border-border` divider between rows
   (only the *list* gets one outer `rounded-md border border-border`, not each row) —
   this is the same "container owns the border, rows own dividers" pattern `DataTable`
   already uses elsewhere in `@repo/ui`.
5. Result per row: ~40px (matches `--density-row-height: 2rem` in compact density) instead
   of ~100px — a 12-link nav list goes from ~1200px of vertical scroll to ~480px, with the
   exact same fields, validation, and reorder/remove behavior untouched.
6. Footer columns (`footer-columns-card.tsx`) additionally: give each column a subtle
   `bg-surface` tint on its `LinkListField` sub-list so the two nesting levels are
   visually distinguishable at a glance (column boundary = bordered card at normal
   surface color per §2.6; its links = the compact list on a faint `bg-surface` inset).

### 2.5 Tab styling

`Tabs`/`TabsList`/`TabsTrigger` (`packages/ui/src/components/tabs.tsx`) are already
correctly implemented (Radix roving tabindex, `data-[state=active]` treatment) — no
component change needed. The *visual confusion* is at the call-site level:

- `Site Settings` and `Blog CMS` both put the tab bar directly under two lines of page
  description prose with no visual gap (`07-site-settings-nav.png`,
  `09-blog-cms-default.png`) — add `mt-2` before the `Tabs` root so the tab bar reads as
  its own zone, not a continuation of the paragraph.
- Add a **compact item-count badge** to each tab trigger where the underlying list is
  non-trivial (`Blog Testimonials Partners Faculty Bios Pages`) — e.g.
  `Partners <BadgeChip›-style count pill>` — reusing the existing `StatusChip`
  `tone="neutral"` `size="sm"` chip (already token-driven, already in `@repo/ui`) inline
  after the tab label. This gives the client a content-aware map of the section ("Partners
  has 11 rows, Testimonials has 1") without opening every tab — directly addresses "missing
  visual summaries" at the navigation level, not just inside the editor.

### 2.6 Card hierarchy (page details vs. blocks vs. danger zones)

Three distinct visual tiers, all still built from the existing `Card`
(`packages/ui/src/components/card.tsx`) — no new component:

1. **Page-level meta card** ("Page details" / a `SiteSettingCard`'s own key description) —
   `bg-surface` (not `bg-card`) body, a `border-l-4 border-brand-500` left accent bar
   (the *only* non-block use of brand color outside CTAs — justified because this is the
   page's own primary settings, i.e. functionally page-level, not content). Collapse the
   two SEO fields (`SEO title`, `SEO description`) under the new `CollapsibleSection`
   (§2.1), closed by default, labelled "SEO & metadata (optional)" — they're real fields
   but not what a client opens the page to edit; only `Title` (required) stays always
   visible. This alone removes 2 of the 4 always-visible page-detail fields from the
   initial view in `02-page-builder-editor.png`.
2. **Block cards** — standard `Card` (`bg-card`, `border-border`), header carries the
   icon-chip accent from §2.2 (colored icon chip, not a colored border — keeps the *card*
   itself neutral so 11 different block types don't turn the page into a rainbow; only the
   small icon chip carries color, per "never color alone" but also "don't overuse color").
3. **Danger / destructive zones** (block remove, link/column remove, "Delete" actions in
   Blog CMS tables) — already correctly minimal (icon-only ghost buttons with
   `text-danger`, e.g. `block-card.tsx` line 223, `blog-cms` table trash icons in
   `09`/`10-*.png`). No visual escalation needed; the existing `ConfirmDialog` with
   `tone="danger"` (already used at `page-builder-editor.tsx` lines 280-289) is the correct
   guard rail. Keep as-is — flagging only to confirm this tier should stay the *least*
   visually prominent of the three, which it already is.

### 2.7 Button hierarchy (Save vs. Preview vs. Version history)

Current: `Back` (ghost) — `Version history` (secondary, `sm`) — `Preview` (secondary,
`sm`) — `Save` (primary, `sm`) — all the same height, differentiated only by fill color
(`page-builder-editor.tsx` lines 209-227). Spec:

- **Save**: bump to `size="md"` (the one `lg`-adjacent action on the page — it's the
  single most consequential button in the entire surface, since saves publish
  immediately). Keep `variant="primary"`.
- **Preview**: stays `variant="secondary"` `size="sm"` — frequent, low-risk, keep visible
  and easy to reach.
- **Version history**: demote to `variant="ghost"` `size="sm"` — it's an occasional
  recovery action, not a primary editing tool; ghost treatment visually recedes it behind
  Preview/Save without hiding it (still `data-testid`'d, still keyboard-reachable, no
  functionality change).
- Group Preview + Version history together with a small gap, then a visual
  separator (`w-px h-6 bg-border`) before Save, so the eye reads "two secondary tools |
  one primary action" rather than "four buttons of similar weight."

### 2.8 Status / feedback: the "publishes immediately" live indicator

Today, "Every save publishes immediately — there is no draft/approval step" is one line
of body prose under the page title (`page-builder-page.tsx`/`page-builder-editor.tsx`,
also repeated in Site Settings — `site-settings-page.tsx` line 50) and in the Save
confirm dialog copy. It's easy to miss on first read and then forgotten while scrolling a
long block list.

Spec: add a small persistent `StatusChip`-style pill — `tone="warning"` (this is the
correct existing tone for "no undo safety net," not `info`), icon `Rss`-style pulse or a
plain `●` dot, label **"Live — saves publish instantly"** — pinned in the same toolbar row
as Save/Preview/Version history (§2.7), always visible regardless of scroll position (the
toolbar row in `page-builder-editor.tsx` lines 209-228 is already sticky-adjacent to the
top; making it `sticky top-0 bg-bg z-10` — CRM has no competing sticky header at that
scroll position per the screenshots — keeps this indicator and the Save button in view
while scrolling a long block list, which also solves "have to scroll back to top to
Save" as a side benefit).

The existing post-save toast (`toast({ title: "Saved", description: "This change is now
live on the public site.", variant: "success" })` — `page-builder-editor.tsx` line 165)
is correctly implemented already; no change needed there beyond confirming `ToastProvider`
queues it above the sticky toolbar (z-index check only, not a redesign).

---

## 3. Per-screen application

### 3.1 Page Builder — List (`01-page-builder-list.png`)

Largely fine already: clean table, correct `StatusChip` usage, clear primary "New page"
button. Two small additions, no structural change:
- Add the block-count is not applicable here (this table is pages, not blocks) — instead
  add a lightweight "last edited by / relative time" secondary line under each title using
  the existing `DateChip` (`packages/ui/src/components/date-chip.tsx`, `format="relative"`)
  next to "Last published" — gives the client a freshness cue without a new column.
- No change to search/table density needed; already compact-appropriate.

### 3.2 Page Builder — Editor (`02`, `04`, `05`, `06`)

Apply §2.1 (collapse), §2.2 (icon/color), §2.3 (summary), §2.6.1 (SEO disclosure + accent
bar on Page Details), §2.7 (button hierarchy), §2.8 (live indicator). `Preview` drawer
(`05-page-builder-preview.png`) is already well-designed (clear "approximate, not pixel
match" disclaimer banner) — no change. `Version history` panel (`06`) is already good
(clear "Before last save" badge pattern, consistent View/Revert button pairing) — reuse
its badge pattern verbatim as the model for other "status pill" needs in this spec.

`block-picker.tsx`: add the icon chip (§2.2) to each button, left of the label, and group
by the same category color so the four category headers ("Content", "List", "Reference",
"Decorative") visually connect to their members without re-reading each description.

### 3.3 Site Settings (`07`, `08×3`)

- Apply §2.4 (compact rows) to `nav-primary-links-card.tsx`, `footer-columns-card.tsx`
  (both levels), and any other `LinkListField`/`CtaListField` consumer.
- Apply §2.5 (tab item-count badges) — e.g. "Navigation `7`", "Footer `3`".
- `Contact` tab (`08-site-settings-contact.png`) already uses two separate `Card`s
  correctly (Contact details / WhatsApp contact) with per-card Save — good pattern, keep.
  Minor: each card's own `Save` button should stay `size="sm"` `variant="primary"` (already
  correct) since these are page-local saves, not the page-builder's "publish the whole
  page" action — don't apply the §2.7 `md` bump here, that's reserved for the one
  highest-stakes Save per screen.
- `SEO` tab (`08-site-settings-seo.png`) is already the cleanest tab (single card, 3
  fields) — no change.

### 3.4 Blog CMS (`09`, `10×4`)

- Wrap the "New category name / Slug / Add category" inline mini-form
  (`09-blog-cms-default.png`) in its own `bg-surface rounded-md border border-border p-3`
  panel, visually separated from the posts table by the standard `gap-4` stack spacing,
  OR move it behind a `variant="ghost"` "Manage categories" trigger next to "New post"
  that opens a small `Drawer` — preferred if category management is rare (recommend
  confirming actual usage frequency with the PM/orchestrator before choosing between
  "always-visible panel" vs. "behind a trigger"; both are zero-functionality-loss, this is
  a frequency judgment call outside a pure visual audit's authority).
- Apply §2.5 tab badges across `Blog / Testimonials / Partners / Faculty Bios / Pages`.
- Tables (`10-blog-cms-partners.png` etc.) are already dense and correct — `Order` column
  with numeric values is good; no visual change needed beyond the tab badges.

### 3.5 Landing Pages (`11-landing-pages.png`)

Already the cleanest screen in the section: clear hierarchy (page title → sub-tab →
section heading → search → table), single `StatusChip`, single primary action. No changes
recommended — hold this screen up as the "reference" layout the other three should read
like once §2's patterns are applied.

---

## 4. Accessibility notes (all additions)

- `CollapsibleSection` (§2.1): implement via a real `<button aria-expanded={open}
  aria-controls={bodyId}>` header (or Radix Accordion's built-in equivalents, which give
  this for free) — keyboard `Enter`/`Space` toggles, screen readers announce
  expanded/collapsed state. The disclosure chevron icon is `aria-hidden` (state is
  conveyed by `aria-expanded`, not the icon's shape).
- Auto-expand-on-invalid (§2.3) must also move focus to the block's first invalid field
  (or at minimum scroll it into view + focus the card header) — a silent scroll with no
  focus change fails keyboard/screen-reader users.
- Compact `Input size="sm"` rows (§2.4) using `aria-label` instead of visible `<Label>`:
  confirm every such input still has a **unique, descriptive** `aria-label` per row (e.g.
  `aria-label={`Link ${index + 1} label`}`, not a generic `"Label"` repeated identically
  11 times — that would regress screen-reader usability even though it looks fine
  visually). This is the one place where "less visual repetition" and "accessible name"
  must be handled with different strings.
- Icon chips (§2.2) are decorative reinforcement of an already-present text label — icons
  stay `aria-hidden="true"`, exactly like every other icon usage already in this codebase
  (`block-card.tsx` consistently does this correctly today; keep the pattern).
- Live-indicator chip (§2.8): plain text label carries the meaning ("Live — saves publish
  instantly"), not the dot/tone alone — satisfies docs/07 §2's color rule.
- Sticky toolbar (§2.8): verify it doesn't cover focused elements when tabbing through a
  long block list (a sticky header can visually obscure a focused input below it even
  though focus is technically "on screen") — add `scroll-margin-top` matching the
  toolbar's height to block cards' anchor points, or accept the toolbar unstickies past a
  breakpoint if this proves problematic in testing.
- All new/changed components keep `data-testid` per docs/07 §5 footer rule; existing
  `data-testid`s in `block-card.tsx`/`shared-fields.tsx` referenced by
  `page-builder-page.test.tsx` etc. must be preserved verbatim where this spec doesn't
  explicitly rename an element (the collapse/summary work adds new elements around
  existing ones — it does not require renaming the existing `page-builder-block-card-{i}`,
  `page-builder-block-title-{i}` etc. test hooks).

---

## 5. Implementation priority

**P0 (highest impact, contained blast radius):**
1. Block collapse + summary (§2.1, §2.3) — the single biggest fix for "overwhelming."
2. Block-type icon + color (§2.2) — cheap, reused across editor + picker + summary.
3. Compact link-list rows (§2.4) — mechanical refactor of 3 existing call sites, no new
   component beyond an `Input` `size="sm"` variant.

**P1:**
4. Page-details card hierarchy + SEO disclosure (§2.6.1).
5. Button hierarchy + sticky live indicator (§2.7, §2.8).
6. Tab item-count badges (§2.5).

**P2 (polish / needs a product judgment call):**
7. Blog CMS "New category" panel restructuring (§3.4) — confirm frequency-of-use with
   product before choosing panel-vs-drawer.
8. Wire `--density-*` tokens into `Input`/`Card`/row spacing generally (item 6 in §1) —
   broader than this section, likely a `@repo/ui`-wide follow-up rather than scoped to
   Website screens.
9. IA question in §1 item 9 (Blog CMS "Pages" tab vs. Page Builder list) — route to
   orchestrator/PM, not a visual fix.

---

## 6. Flags for `docs-writer`

`docs/07-design-system.md` currently documents the chart palette (`--chart-1..6`) as
scoped to charts (§2: "Chart palette... themed light/dark via `--chart-1`..`--chart-6`").
This audit establishes and recommends a second, non-chart use: **categorical accent
color for block-type/content-type identity chips** (§2.2 above), reusing the same tokens.
Recommend `docs-writer` add a short note under §2 or §6 (Patterns) formalizing "reuse
`--chart-1..6` for any small, non-chart categorical badge/icon-chip needing >2 distinguish
-able-but-non-semantic colors — do not introduce new hardcoded colors for this purpose."

Also recommend `docs-writer` record the new `Input` `size` prop (`sm | md`, mirroring
`Button`'s existing scale) and the new `CollapsibleSection` primitive in §5's component
table once built, so future engineers reach for them instead of re-implementing
ad hoc collapse/compact-row logic a third time.

---

## 7. Files referenced (for the implementing engineer)

- `apps/crm/src/components/page-builder/block-card.tsx`
- `apps/crm/src/components/page-builder/page-builder-editor.tsx`
- `apps/crm/src/components/page-builder/block-picker.tsx`
- `apps/crm/src/components/page-builder/block-forms/shared-fields.tsx`
- `apps/crm/src/lib/page-builder-block-meta.ts`
- `apps/crm/src/components/site-settings/site-settings-page.tsx`
- `apps/crm/src/components/site-settings/nav-primary-links-card.tsx`
- `apps/crm/src/components/site-settings/footer-columns-card.tsx`
- `apps/crm/src/components/site-settings/site-setting-card.tsx`
- `packages/ui/src/components/card.tsx`
- `packages/ui/src/components/input.tsx`
- `packages/ui/src/components/button.tsx`
- `packages/ui/src/components/status-chip.tsx`
- `packages/ui/src/components/badge-chip.tsx`
- `packages/ui/src/components/tabs.tsx`
- `packages/ui/src/styles.css` (density tokens, motion tokens)
- `packages/ui/src/index.ts` (export surface — add `CollapsibleSection` here when built)
