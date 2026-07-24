# CRM UI Consistency Spec

> Status: **active** (execution in progress on branch `ui/crm-consistency-pass`).
> Scope: **visual consistency + hierarchy only** — no nav/IA/URL/behaviour changes.
> Source: 5-agent read-only audit of `apps/crm/src` (2026-07-23). This file is the
> rulebook every batch conforms to and future screens must not regress from.

## 0. Diagnosis (why this spec exists)

The CRM is **internally consistent but systematically diverged from its own design
system** (`@repo/ui`). This is a *conform-to-the-system* pass, not a redesign. Three
areas are already correct and must **not** be re-touched:

- List loading / empty / error states (every list uses `DataTable` `loading`+`emptyState`
  and a full-page `EmptyState` retry on `isError`).
- Numeric column right-alignment (`align:"right"` applied broadly).
- Chart primitives (`ChartFrame`/`BarChart`/`KpiCard` centralise color/legend/axis).

## 1. Page shell contract (every top-level screen)

```tsx
<div className="space-y-6 md:space-y-8">        {/* the ONE page-root rhythm */}
  <PageHeader title="…" description="…" actions={…} />
  …content…
</div>
```

- **Title**: always `@repo/ui` `PageHeader` (`font-display text-2xl font-bold md:text-3xl`).
  No hand-rolled `<h1 className="text-xl font-semibold">`. This is the single largest fix.
- **Vertical rhythm**: page root is `space-y-6 md:space-y-8`. Retire the `gap-4` / `gap-6`
  fork. `flex flex-col gap-N` page roots are replaced by the `space-y` root above.
- **Shared shells** (`ReportPageShell`, `LandingPagesPage`) render `PageHeader` internally —
  do not re-implement the title block.
- **Casing**: page titles are **sentence case** ("Knowledge base", not "Knowledge Base").
- **Header cross-axis**: `PageHeader` already uses `items-start` + `flex-wrap`; the `actions`
  slot wraps below the title on narrow widths. Don't reintroduce `items-center justify-between`.

## 2. Semantic status-tone map (canonical)

`StatusChip` has exactly five tones. Domain enums map to a tone **at the call site**; the
map below is the single source of truth. Where the same human-facing state maps to two
tones today (audit findings), the canonical column wins.

| Tone | Meaning | Canonical states |
|------|---------|------------------|
| `success` | terminal-good / active-good | active, completed, sent, succeeded, paid, published, graduated, certified, passed, resolved, won |
| `info` | in-progress / awaiting, no error | pending, requested, scheduled, running, sending, in-progress, authorized, approved (pending-processing), new |
| `warning` | needs attention / paused / aging | paused, on-hold, expired, archived, overdue, refunded, at-risk |
| `danger` | error / hard-negative | failed, rejected, void, revoked, blocked, lost |
| `neutral` | inert / not-started / user-cancelled | draft, inactive, cancelled, closed, not-started, n/a, unknown |

Resolved conflicts (from the audit):
- **Completed / Graduated / Sent** = `success` everywhere (was `neutral` on batch/student).
- **Cancelled** = `neutral` everywhere — a deliberate, non-error stop. `danger` is reserved
  for true failures (was `danger` on booking, `neutral` on campaign → unify to `neutral`).
- **Paused** = `warning` everywhere (was `neutral` on report-schedule).
- **Requested / In-progress / Running / Sending / Authorized** = `info` (reserve `warning`
  for attention-needed; was split `warning`↔`info`).
- **Approved (pending processing)** = `info`, not `warning`.
- Lifecycle vs student/lead chips reconciled: a graduated student is the **same** tone on
  every surface (`LifecycleChip` is the reference; align `StudentStatusChip`).

> These tone choices are defaults chosen to reserve red for real errors and amber for
> "needs a human". Adjust a specific row here first, then in code — never in one chip only.

## 3. Chip primitive rules

- One visual language: `StatusChip` (flat soft badge, `rounded`, `font-bold`, `bg-<tone>/15`).
- `SlaChip` and any icon-bearing pill **compose** `StatusChip` (pass `icon`) — no second
  radius/border/weight recipe.
- No hand-rolled status pills. Delete inline `rounded-full border bg-<tone>/10` spans
  (curriculum-builder "Free preview", content-pages-manager badge, template-section-card).
- The 17 near-identical `Record<Enum, tone>` + `Record<Enum, label>` chip files may collapse
  onto a shared `makeStatusChip(toneMap, labelMap, testId)` factory (optional, drift-proofing).

## 4. Form & control primitives

- **Textarea**: add a shared `@repo/ui` `Textarea` mirroring `Input` (label / error /
  helperText, one bg + focus-ring token set, `resize-y`). Replace all ~8 raw `<textarea>`.
  (One current raw textarea has **no focus ring** — this is also a WCAG 2.4.7 fix.)
- **Checkbox**: always `@repo/ui` `Checkbox`; no raw `<input type="checkbox">`.
- **Labels**: use the control's `label` / `required` props. Where a bare control is
  unavoidable, use `<Label>`. No raw `<label>` + hand-rendered `*`.
- **Select**: always `@repo/ui` `Select`/`SelectItem`; no native `<select>` (video-library).

## 5. Drawer / dialog conventions

- **Header**: already consistent (shared `DrawerContent` title/description/close). Don't change.
- **Footer action order**: `[destructive] … [secondary] [PRIMARY]` — destructive far-left,
  exactly **one** primary far-right. Fixes: student-detail double-primary (demote Edit to
  secondary), program-detail inversion, refund-vs-campaign flip.
- **Detail key/value**: shared `dl.grid-cols-2 gap-4 text-sm` (`dt` muted, `dd` fg), or a
  `DetailGrid`/`DetailRow` primitive. Migrate the campaign module onto it.
- **Section headings**: one token — `h2 text-sm font-semibold text-fg`. No `h3`/`font-medium` mix.
- **Body rhythm**: `DrawerBody` field spacing `gap-4` unless a drawer has a deliberate reason.
- **Widths**: simple entity detail = `lg`; rich/tabbed detail = `xl`. Apply by content class.
- **Error state**: detail drawers show `EmptyState` **with** a retry action (fix campaign-detail).

## 6. Filter bars

- Use `@repo/ui` `DataFilterBar` for search + filters (only 2 of ~18 screens do today).
- Search field: `label="Search"`, width `w-64`, inside the filter bar (not a bare `Input`).
- One row layout: filters left (`items-end`), primary action right.

## 7. Dashboards / reports

- Every report screen wraps in `ReportPageShell` (→ `PageHeader` per §1).
- The 4 "extended" reports (branch-comparison, cohort, faculty-performance, refund) must
  render `ReportErrorState` on `isError` and a `ReportFreshnessBadge` (or explicit "computed
  live" note) like the 8 WS-A dashboards.
- KPI grid columns track tile count (no single tile marooned at 1/3 width).
- No one-off dashed-border `CardContent` callouts; charts stay on the shared chart primitives.

## 8. Shell polish (visual only — no nav-tree change)

- One focus-visible recipe on all shell interactives: `ring-2 ring-ring ring-offset-2
  ring-offset-bg` (nav items, collapse toggle, account menu currently disagree).
- Collapsed sidebar: `title`/tooltip on collapsed items; highlight a **parent** section when
  a child route is active (both collapsed and expanded).
- Extract one `ComingSoonBadge`; replace the `text-[10px]` literal with a scale token.
- Add an `Alert`/`Callout` primitive for the ~15 hand-rolled alert boxes (unify `/30` vs `/40`).
- (Stretch) sidebar becomes off-canvas below a breakpoint so the shell matches its `md:` screens.

## 9. Execution batches

| Batch | Owner | Content |
|-------|-------|---------|
| A | design-system | Textarea, Alert/Callout, `STATUS_SEMANTICS` map (+ optional chip factory), SlaChip→StatusChip, DetailGrid/DetailRow |
| B | frontend | PageHeader + `space-y` sweep across CRM (§1) — one pass |
| C | frontend | Chip semantics (§2/§3) — apply tone map, reconcile lifecycle/student, delete hand-rolled pills |
| D | frontend | Drawers/forms (§4/§5) |
| E | frontend | Filter bars (§6) |
| F | frontend | Dashboards + shell polish (§7/§8) |

Each batch: `tsc` + eslint green (rebuild `@repo/ui` after any new export) before the next.
