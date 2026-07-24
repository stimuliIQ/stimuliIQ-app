# ADR 0012: DataTable row virtualization deferred behind a documented seam

## Status
Accepted

## Context
`@repo/ui`'s `DataTable` component (added in Phase-1 Wave 2, design-system) is used
across all CRM list views: students, faculty, courses, batches, branches, roles, and
audit logs. At typical P1 data volumes (hundreds to low thousands of rows per page)
server-side pagination keeps the rendered row count well below any performance
threshold. However, the component's API must not foreclose adding virtualization later
without a breaking change.

## Decision
`DataTable` ships in P1 **without** row virtualization. Server-side pagination (page
number + page size props, total count, loading state, empty state) is the primary
mechanism for keeping rendered row count manageable. The component's internal structure
uses a standard `<table>` element with no fixed-height scroll container — the correct
host layout for adding a virtualized scroller in the future without altering the public
prop API.

The seam for future virtualization is documented in `packages/ui/src/components/
data-table.tsx` via a comment:

```
// VIRTUALIZATION SEAM: wrap the tbody here with @tanstack/react-virtual's
// useVirtualizer when row counts exceed ~500 in a single page. The outer
// container must receive a fixed height and overflow-y: auto at that point.
```

No external virtualization library is added as a dependency in P1.

## Consequences
- No additional bundle weight (no `@tanstack/react-virtual` or `react-window` in P1).
- Server-side pagination + the 50-row default page size mean P1 views never render
  enough rows for virtualization to matter.
- When P7 analytics or bulk-export views need to render 1,000+ rows without pagination
  (e.g. an audit-log dump), the seam allows adding `useVirtualizer` in one place.
- The DataTable public API (columns, data, pagination props) is stable; adding
  virtualization will require a `containerHeight` prop and a `virtual?: boolean`
  toggle, both additive changes.

## Alternatives considered
- **Virtualize from day one**: avoids a future refactor. Rejected — premature at P1
  data volumes and adds implementation + test complexity for no current user benefit.
- **Infinite scroll instead of pagination**: more natural for some list UIs. Deferred —
  the CRM's primary use case is "find a specific student by name/filter," for which
  page-based navigation with row counts is more predictable than infinite scroll.
  Revisit in P3 (LMS views) or P7 (analytics).
