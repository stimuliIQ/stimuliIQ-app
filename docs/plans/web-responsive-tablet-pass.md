# Marketing site — tablet responsive pass

**Status:** implemented
**Scope:** `apps/web` only (public marketing site). No API, schema, or copy changes.

---

## 1. The problem

The site is responsive in the sense that nothing overflows — an automated sweep of all 21
public routes at 390 / 640 / 768 / 834 / 1024 / 1280 px found **zero horizontal overflow**
and no broken pages.

What it is not is *space-efficient at tablet widths*. Almost every multi-column layout is
declared as `grid-cols-1 … lg:grid-cols-N`, with **no `sm`/`md` step**. Tailwind's `lg`
breakpoint is 1024px, so every viewport from 640px to 1023px — the entire tablet range,
portrait iPad (768/834) included — renders **one full-width card per row**. Cards designed
to be ~340px wide are stretched to 720–786px, so each one carries a single line of text
across a huge slab of whitespace and the section becomes two to three times taller than it
needs to be.

Measured blowups (section height at 834px vs the same section at 1280px):

| Page | Section | @834 | @1280 | |
|---|---|---|---|---|
| `/` | `why-us` | 2024px | 1073px | ×1.89 |
| `/mentors` | `students-say` | 1906px | 979px | ×1.95 |
| `/mentors/[id]` | profile split | 2071px | 1182px | ×1.75 |
| `/contact` | channels + form | 1693px | 975px | ×1.74 |
| `/programs` | listing + filter rail | 1089px | 618px | ×1.76 |
| `/about`, `/verify` | `certificate-preview` | 1220px | 782px | ×1.56 |

## 2. The rule

One policy, applied everywhere, rather than per-page tweaks:

1. **Never jump `1 → lg`.** Every multi-column layout gets a `sm:` and/or `md:` step.
2. **Column count is chosen by card *content density*, not by the desktop count:**
   - compact cards (icon + title + one line) → `sm:2 md:3`
   - rich cards (poster/photo + title + meta + CTA) → `sm:2` and hold 2 through `md`;
     3+ only from `lg`. Squeezing a course poster into a 240px column at tablet is the
     opposite of the goal.
   - media tiles (gallery, logos) → `sm:2 md:3`
3. **Media + copy splits** (`content_split`, hero, certificate, mentor profile) become
   2-up at `md` — or, where the media wants full width, the media spans both columns and
   the *text side* subdivides.
4. **Nothing gets hidden** to make a breakpoint fit, and nothing changes above `lg` —
   the desktop rendering of every page is byte-identical to before.

## 3. Per-page plan

### `/` (home)
- `why-us` — 2 cards | poster | 2 cards. At `md`: poster spans both columns and moves to
  the top (`md:order-first md:col-span-2`), the two card stacks sit side by side. 2024 → ~1150px.
- `partner-colleges` / Institutional Network — already reworked into the two-row marquee
  (fixed 280px cards); no change needed.
- `explore-courses` (`sm:2 lg:3`), `stats-bento` (`sm:3`), `mentors-teaser` (flex-wrap,
  fixed 160–192px chips), `how-it-works`, `testimonial-spotlight` (single-card carousel),
  `faq` — already fine at tablet. No change.

### `/about`
- `content_split` ("Why We Exist") + its hardcoded fallback → `md:grid-cols-2`, media
  order flips at `md` instead of `lg`, portrait media height steps 420 → 460 → 520px.
- `feature_grid` `cards`/`strip` variants → `md:3` / `md:3 lg:4` via the shared column map.

### `/programs`
- The filter rail is stacked and full-width below `lg`. Its internals become a 3-column
  row at `md` (search | specialisation | sort) instead of a 3-block vertical stack, then
  return to a vertical rail at `lg`. ~470 → ~180px.
- Course grid stays `sm:2` at tablet (rich cards), `xl:3` unchanged.

### `/programs/[slug]`
- "You May Also Like" `sm:2 lg:4` → `sm:2 md:3 lg:4`. Main content/buy-card split is
  deliberately left stacked at tablet: a full-width purchase card reads better there.

### `/mentors`
- `students-say` — same treatment as `why-us`. 1906 → ~1050px.
- Mentor grid `sm:2 lg:4` → `sm:2 md:3 lg:4` (portrait cards survive a 240px column).

### `/mentors/[id]`
- Photo/bio split → `md:grid-cols-[minmax(0,16rem)_1fr]` (16rem photo at tablet, 20rem at `lg`).

### `/contact`
- Page keeps its `lg` two-pane split; the **channel-card column** becomes a 2-up grid at
  `md` and returns to a single column at `lg` when it is the narrow pane. 1693 → ~1000px.

### `/verify`, `/about` — `certificate-preview`
- At `md` the certificate keeps full width (it is a wide document — shrinking it to a
  350px pane makes the specimen unreadable) and the three callouts below become a
  3-column row. 1220 → ~900px.

### `/scholarship`
- Hero (`hero` block + fallback): centre poster spans both columns at `md`, the two
  supporting cards sit side by side under it.
- "₹1 Crore impact" split → `md:grid-cols-2`.
- Numbered steps `sm:2 lg:5` → `sm:2 md:3 lg:5`.

### `/gallery`
- Gallery tiles `sm:2 lg:3` → `sm:2 md:3` (block + fallback).

### `/for-colleges`, `/careers`, `/faq`, `/blog`, `/blog/[slug]`, `/testimonials`,
### `/pricing`, `/book-free-slot`, `/privacy`, `/terms`, `/refund-policy`
- Audited, no tablet blowups. `/blog` and `/testimonials` at 2 columns × ~370px are the
  visual reference this pass is aiming at everywhere else. Left unchanged.

## 4. Deliberately not changed

- **Header nav** switches to the hamburger below `lg`. Six nav items plus the mega-menu
  trigger and two CTAs do not fit at 768px without shrinking hit targets below 44px.
- **`newsletter-band`** is a band, not a card grid; stacked at tablet it already reads well
  (226px tall) and a 2-up split would halve the email input.
- **Pricing comparison table** stays a horizontally-scrollable table — the correct pattern
  for a wide matrix.
- **`/programs/[slug]` buy card** stays full-width at tablet (see above).

## 5. Verification

Re-ran the same sweep over all 21 routes at 390/640/768/834/1024/1280:

- **No horizontal overflow** at any route or width (unchanged — it was clean before too).
- **Section height at 834px**, before → after:

| Section | before | after |
|---|---|---|
| `why-us` | 2024px | 1474px |
| `students-say` | 1906px | 1475px |
| `/mentors/[id]` split | 2071px | ~1180px (now under threshold) |
| `/contact` channels+form | 1693px | 1424px |
| `/programs` filter rail | 470px | 215px |
| `certificate-preview` | 1220px | 1060px |

- **Desktop is untouched**: `why-us` measures 1073px at 1280px both before and after, and
  the 1280px sweep reports no new findings on any route.
- `tsc --noEmit` clean, `eslint src` clean, `web` vitest 14 files / 178 tests green.

The `newsletter-band` entries still reported at 640–834 are the deliberate exception from §4.
