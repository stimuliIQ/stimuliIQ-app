// Top-level Page Builder screen — RBAC gate + list/editor state (docs/specs/
// phase-10-page-builder.md AC 8/9: super_admin-only via `content.builder`; a non-holder
// sees a forbidden state and NO page/block data is ever fetched — the gate below renders
// `PageBuilderList`/`PageBuilderEditor` (and therefore mounts their data-fetching hooks)
// ONLY when `canView` is true, matching `report-page-shell.tsx`'s established pattern.
// This is presentation-only (CLAUDE.md §3.5) — the API still enforces `content.builder`
// server-side on every mutation.
import * as React from "react";
import { EmptyState, PageHeader } from "@repo/ui";
import { ShieldAlert } from "lucide-react";
import type { MeResponse } from "@repo/types";

import { hasPermission } from "../../lib/permissions";
import { PageBuilderList } from "./page-builder-list";
import { PageBuilderEditor } from "./page-builder-editor";

export function PageBuilderPage({ me }: { me: MeResponse | undefined }): React.JSX.Element {
  const canView = hasPermission(me?.permissions, "content.builder");
  const [selectedPageId, setSelectedPageId] = React.useState<string | null>(null);

  if (!canView) {
    return (
      <div className="space-y-4 md:space-y-5" data-testid="page-builder-page">
        <PageHeader title="Page builder" />
        <EmptyState
          icon={<ShieldAlert />}
          title="You don't have access to the page builder"
          description="This surface is restricted to super_admin. Ask an Owner to grant content.builder if you believe this is wrong."
          data-testid="page-builder-page-access-denied"
        />
      </div>
    );
  }

  return (
    <div data-testid="page-builder-page">
      {selectedPageId ? (
        <PageBuilderEditor pageId={selectedPageId} onBack={() => setSelectedPageId(null)} />
      ) : (
        <PageBuilderList onOpenPage={setSelectedPageId} />
      )}
    </div>
  );
}
