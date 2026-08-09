# 07 — Design System (`@repo/ui`)

*One clean, minimal, attractive system across `web`, `lms`, `crm`. shadcn/ui + Tailwind,
themed by CSS variables. Aesthetic: calm, modern, confident, content-first.*

---

## 1. Design principles
1. **Clarity over decoration** — every element earns its place.
2. **One accent, used with intent** — brand color drives CTAs/primary actions only.
3. **Generous whitespace, tight alignment** — an 8px rhythm, strong grid.
4. **Consistent states** — loading, empty, error, success on every async surface.
5. **Accessible by default** — AA contrast, visible focus, keyboard-first.
6. **Same primitives, three personalities** — marketing (warm, spacious), LMS (focused,
   motivating), CRM (dense, efficient) — via tokens, not forks.

---

## 2. Color system (CSS variables — light/dark)
```css
:root {
  /* brand */
  --brand-50:#eef4ff; --brand-100:#dbe7ff; --brand-500:#2f6bff; --brand-600:#1f55e0;
  --brand-700:#1842b3;
  /* neutrals */
  --bg:#ffffff; --surface:#f7f8fa; --card:#ffffff; --border:#e6e8ec;
  --fg:#0f1216; --fg-muted:#5b6472; --fg-subtle:#8b94a3;
  /* semantic */
  --success:#16a34a; --warning:#d97706; --danger:#dc2626; --info:#0ea5e9;
  /* focus */
  --ring:#2f6bff;
}
.dark {
  --bg:#0b0e14; --surface:#11151d; --card:#141925; --border:#222a38;
  --fg:#e8ecf2; --fg-muted:#9aa6b8; --fg-subtle:#6b7689;
  --brand-500:#5a8bff; --brand-600:#3f72f0;
}
```
Rules: text on background ≥ 4.5:1; never convey status by color alone (chip + label/icon).

**Chart palette** (added Phase 7 — flagged for docs-writer to formally record/expand): a
6-color categorical, colorblind-safe palette (Okabe & Ito 2008 derived) themed light/dark via
`--chart-1`..`--chart-6` in `packages/ui/src/styles.css`, mirrored as Tailwind `chart-1..6`
utilities in `@repo/config/tailwind/preset`. `chart-1` reuses the brand blue; the rest are
distinguishable under deuteranopia/protanopia/tritanopia. Charts must still pair each color
with a visible label (legend / axis / data-table) — never color alone, same rule as above.

## 3. Typography
- **Font:** Inter (UI) + optional Plus Jakarta Sans for marketing headings. Mono: JetBrains
  Mono (code, IDs).
- **Scale (rem):** xs .75 / sm .875 / base 1 / lg 1.125 / xl 1.25 / 2xl 1.5 / 3xl 1.875 /
  4xl 2.25 / 5xl 3. Line-height 1.5 body, 1.2 headings. Weights 400/500/600/700.
- Marketing uses the larger end; CRM stays at sm–base for density.

## 4. Spacing & grid
- **8px base scale:** 0,1(4),2(8),3(12),4(16),6(24),8(32),12(48),16(64),24(96).
- **Radius:** sm 6 / md 10 / lg 14 / full. **Shadows:** subtle, 2 levels max.
- **Grid:** 12-col, max-width 1200 (marketing) / fluid (app). Gutters 24.
- **Breakpoints:** sm 640 / md 768 / lg 1024 / xl 1280 / 2xl 1536. Mobile-first.

## 5. Core components (in `@repo/ui`)
| Component | Notes / variants |
|-----------|------------------|
| **Button** | primary / secondary / ghost / destructive / link; sizes sm-lg; loading + icon |
| **Input / Textarea / Select / Combobox** | label, hint, error, prefix/suffix; zod-bound |
| **FormField** | wraps label+control+error; react-hook-form ready |
| **Card** | header/body/footer; used for programs, KPIs, lessons |
| **Table** | server pagination, sort, sticky header, row select, virtualization, empty state |
| **Dialog / Drawer** | modal vs side panel (CRM detail); focus-trapped |
| **Tabs / Accordion** | curriculum, FAQ, record tabs |
| **StatusChip** | semantic color + label (never color-only) |
| **Toast** | success/error/info; queueable |
| **Skeleton / Spinner / EmptyState / ErrorState** | required for async views |
| **ProgressRing / ProgressBar** | course completion, dashboards |
| **Chart** | recharts wrappers: `KpiCard`, `LineChart`/`AreaChart`, `BarChart`, `FunnelChart`, `DonutChart`/`PieChart`, themed via `--chart-1..6` tokens (§2); accessible name (role="img") + sr-only data-table fallback + visible legend on every chart — see `packages/ui/src/components/chart-frame.tsx` |
| **Avatar / Badge / Tooltip / Breadcrumb / Pagination** | standard |
| **CommandPalette** | ⌘K (CRM power nav) |
| **VideoPlayer** | HLS + watermark + chapters + notes (LMS) |
| **DataFilters** | filter bar for lists (programs, leads, students) |

Every component: keyboard operable, AA contrast, `data-testid`, dark-mode aware, no hardcoded
colors (tokens only).

## 6. Patterns
- **List + detail-drawer** (CRM): keep list context, edit in side panel.
- **Sticky buy card / bottom bar** (web program page).
- **Continue-learning rail + progress ring** (LMS dashboard).
- **KPI row → charts → operational lists** (dashboards).
- **Confirm + undo** on destructive actions; optimistic UI with rollback.

## 7. Motion
Durations 150–250ms, ease-out. Use for: hover lift (cards), accordion, drawer slide,
toast, count-up stats, skeleton shimmer. **Always respect `prefers-reduced-motion`.**

## 8. Iconography
One set (lucide-react). 1.5px stroke, 20/24px. Icon buttons always have aria-labels.

## 9. Dark mode
Token-driven via `.dark` class; persisted preference; default = system. LMS + CRM ship dark;
marketing dark optional (blog/reading).

## 10. Responsive rules
Mobile: bottom tab nav (LMS), collapsed nav + card-ified tables (CRM), stacked sections +
sticky CTA (web). Tap targets ≥44px. Test on low-end Android + slow 4G.

## 11. Accessibility checklist (per component & page)
Semantic HTML/landmarks · labelled controls · focus order + visible ring · ESC/return focus
on dialogs · contrast AA · reduced-motion · no color-only meaning · captions on media ·
form errors announced.

## 12. Theming for three apps
Same `@repo/ui`, three Tailwind presets layering tokens: `web` (spacious, larger type,
optional brand gradients), `lms` (focused, calm, motivating accents), `crm` (compact density
mode: smaller spacing scale, denser tables). One source of truth, three moods.

### 12.1 Density
Density is an **attribute, not a component prop**: `data-density="comfortable" | "compact"`
on an ancestor. `:root` carries the comfortable values; `[data-density="compact"]`
re-declares them. Both live in `packages/ui/src/styles.css`. The CRM sets `compact` in two
places — the app shell root (`apps/crm/src/components/layout/app-shell.tsx`) and the
signed-out auth layout — so every CRM surface is dense and `web`/`lms` inherit comfortable
and render unchanged.

| Token | Comfortable | Compact | Consumed by |
|---|---|---|---|
| `--density-control-height` | 2.5rem (40px) | 2rem (32px) | `Button` (`md`, `icon`), `Input` (`md`), `Select` trigger |
| `--density-control-px` | 1rem | 0.75rem | `Button` (`md`) |
| `--density-toolbar-height` | 2.25rem (36px) | 2rem (32px) | `DataFilterBar` search + save-view inputs |
| `--density-card-padding` | 1.5rem | 1rem | `CardHeader` / `CardContent` / `CardFooter` |
| `--density-row-height` | 2.5rem | 2rem | `DataTable` rows |
| `--density-padding-x` / `-y` | 1rem / 0.75rem | 0.75rem / 0.5rem | `DataTable` cells |
| `--density-gap` | 1rem | 0.5rem | list/stack gaps |
| `--text-xs` … `--text-5xl` | marketing ramp | one step tighter | every `text-*` utility |

Because the Tailwind preset maps `fontSize` onto the `--text-*` variables, re-declaring the
ramp under `[data-density="compact"]` re-scales **all** type inside the CRM — `PageHeader`'s
`text-2xl md:text-3xl` h1 renders at 18/20px there and 24/30px on the marketing site, from
one class.

Two rules keep this honest:

1. **Comfortable values must equal whatever the component hardcoded before.** That is what
   makes a density change provably a no-op for `web`/`lms`.
2. **Don't add a "compact" prop or a forked component.** If a control looks wrong in the
   CRM, it is missing a density token, not a variant. Hand-rolled `h-9`/`h-10` controls in
   app code should reference the tokens too.

`Button`'s `sm` (`h-8`) and `lg` (`h-12`) stay fixed — they are explicit author intent, not
density. Under compact, `md` and `sm` converge at 32px by design.
