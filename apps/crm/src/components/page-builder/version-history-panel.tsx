// Version history drawer (docs/specs/phase-10-page-builder.md AC 6-7). Newest-first list
// (who/when), "View" shows the snapshot's block count/title inline, "Revert to this
// version" applies it live immediately and itself creates a new version (history is
// append-only — never rewound/deleted). Same ConfirmDialog pattern as the rest of CRM
// (memory: CRM delete coverage).
//
// QA D2 fix: there is NO "this row == the live page" version. Saves are SAVE-BEFORE-APPLY
// (pages.schemas.ts): on every save, the row's state PRIOR TO that mutation is what gets
// written as the new version — so a version snapshot is always "what the page looked like
// right before some save," never "what the page looks like right now." The newest row
// (`data.items[0]`, since the list is newest-first) is therefore "before my last save" —
// exactly the row a user most wants to revert to when undoing their last edit — not a
// disabled "current state" marker. Every version's revert button is always enabled.
import * as React from "react";
import { Button, ConfirmDialog, Drawer, DrawerContent, DrawerBody, EmptyState, Skeleton, formatRelativeDate, useToast } from "@repo/ui";
import { ApiError } from "@repo/api-client";
import type { ContentPageVersionSummary } from "@repo/types";

import {
  useContentPageVersion,
  useContentPageVersionsList,
  useRevertContentPageVersion,
} from "../../hooks/use-page-builder";
import { surfaceError } from "../../lib/surface-error";

function VersionDetailPreview({ pageId, version }: { pageId: string; version: number }): React.JSX.Element {
  const { data, isLoading, isError } = useContentPageVersion(pageId, version);

  if (isLoading) return <Skeleton shape="block" className="h-16" />;
  if (isError || !data) return <p className="text-sm text-danger">Couldn&apos;t load this version&apos;s snapshot.</p>;

  return (
    <div className="rounded-md bg-surface p-2 text-xs text-fg-muted" data-testid={`page-builder-version-detail-${version}`}>
      <p>
        Title at this version: <span className="font-medium text-fg">{data.title}</span>
      </p>
      <p>{data.body.length} block(s) in this snapshot.</p>
    </div>
  );
}

export function VersionHistoryPanel({
  open,
  onOpenChange,
  pageId,
  currentVersion,
  onReverted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageId: string;
  currentVersion: number;
  /** Called with the fresh detail after a successful revert, so the editor can reload its state. */
  onReverted: () => void;
}): React.JSX.Element {
  const { toast } = useToast();
  const { data, isLoading, isError, refetch } = useContentPageVersionsList(pageId, { page: 1, pageSize: 50 });
  const revert = useRevertContentPageVersion();
  const [expandedVersion, setExpandedVersion] = React.useState<number | null>(null);
  const [revertTarget, setRevertTarget] = React.useState<ContentPageVersionSummary | null>(null);
  const [conflict, setConflict] = React.useState(false);

  async function handleConfirmRevert() {
    if (!revertTarget) return;
    try {
      await revert.mutateAsync({ id: pageId, version: revertTarget.version, body: { expectedVersion: currentVersion } });
      toast({ title: `Reverted to version ${revertTarget.version}`, description: "This is now live on the public site.", variant: "success" });
      setRevertTarget(null);
      onReverted();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setConflict(true);
        setRevertTarget(null);
        return;
      }
      surfaceError(toast, error, "Couldn't revert to this version");
      setRevertTarget(null);
    }
  }

  return (
    <>
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent
          title="Restore an earlier version"
          description="Every save (including restores) is captured here, newest first. Restoring never deletes anything — the page's current content is kept as its own version too."
          size="lg"
          data-testid="page-builder-version-history-panel"
        >
          <DrawerBody className="flex flex-col gap-3">
            {isLoading ? (
              <div className="flex flex-col gap-2">
                <Skeleton shape="block" className="h-16" />
                <Skeleton shape="block" className="h-16" />
              </div>
            ) : isError ? (
              <EmptyState
                title="Couldn't load version history"
                action={
                  <Button variant="secondary" onClick={() => refetch()}>
                    Try again
                  </Button>
                }
              />
            ) : (data?.items.length ?? 0) === 0 ? (
              <EmptyState title="No versions yet" description="Save this page once to create its first version." data-testid="page-builder-version-history-empty" />
            ) : (
              <ul className="flex flex-col gap-2">
                {(data?.items ?? []).map((version, index) => (
                  <li key={version.version} className="flex flex-col gap-2 rounded-md border border-border p-3" data-testid={`page-builder-version-row-${version.version}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-fg">
                          Saved {formatRelativeDate(new Date(version.createdAt))} by {version.createdBy.name}
                          {/* Newest-first list (`index === 0`) — NOT a comparison against
                              `currentVersion`. Save-before-apply means no version row ever
                              equals the live page; the newest row is "what it looked like
                              right before the last save," so it's labelled by LIST POSITION,
                              never treated as "the current/live state." */}
                          {index === 0 ? (
                            <span className="ml-2 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-500/20 dark:text-brand-300">
                              Before last save
                            </span>
                          ) : null}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setExpandedVersion(expandedVersion === version.version ? null : version.version)}
                          data-testid={`page-builder-version-view-${version.version}`}
                        >
                          {expandedVersion === version.version ? "Hide" : "View"}
                        </Button>
                        {/* Every version is revertible — there is no "current/live" row to
                            exempt (QA D2: reverting to the newest row is exactly "undo my
                            last edit," the single most common revert). Secondary-styled per
                            docs/specs/phase-10-ui-polish-visual-audit.md §2.6.3 ("Restore"
                            reads less alarming than a primary-filled "Revert" button while
                            staying fully visible/keyboard-reachable — the ConfirmDialog that
                            follows is the actual guard rail). */}
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setRevertTarget(version)}
                          data-testid={`page-builder-version-revert-${version.version}`}
                        >
                          Restore
                        </Button>
                      </div>
                    </div>
                    {expandedVersion === version.version ? <VersionDetailPreview pageId={pageId} version={version.version} /> : null}
                  </li>
                ))}
              </ul>
            )}
          </DrawerBody>
        </DrawerContent>
      </Drawer>

      <ConfirmDialog
        open={Boolean(revertTarget)}
        onOpenChange={(o) => !o && setRevertTarget(null)}
        title="Restore this earlier version?"
        description="Your website will immediately show this earlier version — visitors will see it on their next request. Nothing is deleted; the current content is kept as its own version too, so you can always come back to it."
        confirmLabel="Restore"
        tone="danger"
        onConfirm={handleConfirmRevert}
        loading={revert.isPending}
        data-testid="confirm-revert-page-version"
      />

      <ConfirmDialog
        open={conflict}
        onOpenChange={setConflict}
        title="This page was changed by someone else"
        description="Someone else saved a change to this page since you opened it. Reload the page before restoring, so you don't overwrite their edit."
        confirmLabel="Reload"
        onConfirm={() => {
          setConflict(false);
          onReverted();
        }}
        data-testid="confirm-page-version-revert-conflict"
      />
    </>
  );
}
