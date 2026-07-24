// Page list — the 6 fixed core-marketing-page templates (Phase-11 locked templates,
// docs/plans/phase-11-locked-templates.md; originally Phase-10, docs/specs/
// phase-10-page-builder.md). No more "New page" — every core page is seeded up front and
// its layout is fixed; there is no ad-hoc page creation any more.
import * as React from "react";
import { ExternalLink } from "lucide-react";
import { DataFilterBar, DataTable, type DataTableColumn, DateChip, EmptyState, Input, PageHeader, StatusChip, Button } from "@repo/ui";
import type { ContentPageSummary } from "@repo/types";

import { useBuilderPagesList } from "../../hooks/use-page-builder";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { publicPageDisplayUrl, publicPageUrl } from "../../lib/public-urls";

// C2 vocabulary table (docs/specs/phase-10-ui-polish-ux-audit.md): "published" → "Live".
const STATUS_LABEL: Record<string, string> = { published: "Live", draft: "Draft", archived: "Hidden" };

export function PageBuilderList({ onOpenPage }: { onOpenPage: (pageId: string) => void }): React.JSX.Element {
  const [search, setSearch] = React.useState("");
  const debouncedSearch = useDebouncedValue(search);
  const { data, isLoading, isError, refetch } = useBuilderPagesList(debouncedSearch || undefined);

  const columns: Array<DataTableColumn<ContentPageSummary>> = [
    {
      id: "title",
      header: "Page",
      cell: (row) => (
        <span className="flex items-center gap-2">
          {row.title}
          {row.slug === "home" ? <StatusChip tone="info" label="Homepage" size="sm" /> : null}
        </span>
      ),
    },
    {
      id: "slug",
      header: "Web address",
      // Full public URL per C2 ("render as the full URL: stimuliiq.com/about") — with a
      // "View live" external-link affordance (PB-7), stopping row-click from also firing.
      cell: (row) => (
        <a
          href={publicPageUrl(row.slug)}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-xs text-fg-muted underline-offset-2 hover:text-brand-500 hover:underline"
          data-testid={`page-builder-list-view-live-${row.id}`}
        >
          {publicPageDisplayUrl(row.slug)}
          <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
        </a>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => <StatusChip tone={row.status === "published" ? "success" : "neutral"} label={STATUS_LABEL[row.status] ?? row.status} size="sm" />,
    },
    {
      id: "publishedAt",
      header: "Last updated",
      cell: (row) => (row.publishedAt ? <DateChip date={new Date(row.publishedAt)} format="relative" /> : "Never saved"),
    },
  ];

  if (isError) {
    return (
      <EmptyState
        title="Couldn't load pages"
        data-testid="page-builder-list-error"
        action={
          <Button variant="secondary" onClick={() => refetch()}>
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6 md:space-y-8" data-testid="page-builder-list">
      <PageHeader
        title="Page builder"
        description="Your site's core marketing pages, each with a fixed layout — open one to edit its text, images, and list items. Every save publishes immediately — there is no draft/approval step."
      />

      <DataFilterBar data-testid="page-builder-list-filter-bar">
        <Input
          label="Search"
          placeholder="Search by title or slug…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          wrapperClassName="w-64"
          data-testid="page-builder-list-search"
        />
      </DataFilterBar>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading}
        onRowClick={(row) => onOpenPage(row.id)}
        emptyState={{ title: "No pages yet", description: "Core marketing pages are seeded automatically — check back after the next deploy." }}
        caption="Page-builder-managed pages"
        data-testid="page-builder-list-table"
      />
    </div>
  );
}
