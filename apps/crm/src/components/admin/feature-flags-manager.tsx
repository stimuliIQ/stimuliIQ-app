// Feature flags — toggle UI over FeatureFlagRow, per Phase 9 Completion
// T23/T39. Permission keys are `flags.view`/`flags.edit`
// (apps/api/src/modules/platform/feature-flags.controller.ts).
import * as React from "react";
import { Button, EmptyState, FeatureFlagRow, Input, PageHeader, Skeleton, useToast } from "@repo/ui";
import type { MeResponse } from "@repo/types";

import { useFeatureFlagsList, useSetFeatureFlag } from "../../hooks/use-feature-flags";
import { hasPermission } from "../../lib/permissions";
import { surfaceError } from "../../lib/surface-error";

function NewFlagForm({ canEdit }: { canEdit: boolean }): React.JSX.Element | null {
  const { toast } = useToast();
  const setFlag = useSetFeatureFlag();
  const [key, setKey] = React.useState("");

  if (!canEdit) return null;

  async function handleCreate() {
    try {
      await setFlag.mutateAsync({ key, body: { enabled: false } });
      toast({ title: "Flag created (disabled)", variant: "success" });
      setKey("");
    } catch (error) {
      surfaceError(toast, error, "Couldn't create this flag");
    }
  }

  return (
    <div className="flex items-end gap-2 rounded-md border border-dashed border-border p-3">
      <Input label="New flag key" placeholder="flags.new_dashboard" value={key} onChange={(e) => setKey(e.target.value)} wrapperClassName="flex-1" data-testid="new-flag-key-input" />
      <Button variant="secondary" onClick={handleCreate} disabled={!key.trim()} loading={setFlag.isPending} data-testid="new-flag-create">
        Create
      </Button>
    </div>
  );
}

export function FeatureFlagsManager({ me }: { me: MeResponse | undefined }): React.JSX.Element {
  const canEdit = hasPermission(me?.permissions, "flags.edit");
  const { data, isLoading, isError, refetch } = useFeatureFlagsList({ page: 1, pageSize: 100 });
  const setFlag = useSetFeatureFlag();
  const { toast } = useToast();

  async function handleToggle(key: string, enabled: boolean) {
    try {
      await setFlag.mutateAsync({ key, body: { enabled } });
    } catch (error) {
      surfaceError(toast, error, "Couldn't update this flag");
    }
  }

  return (
    <div className="space-y-6 md:space-y-8" data-testid="feature-flags-manager">
      <PageHeader
        title="Feature flags"
        description="Roll out new surfaces gradually. Never a substitute for server-side permission checks."
      />

      {isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton shape="block" className="h-14" />
          <Skeleton shape="block" className="h-14" />
        </div>
      ) : isError ? (
        <EmptyState
          title="Couldn't load feature flags"
          action={
            <Button variant="secondary" onClick={() => refetch()}>
              Try again
            </Button>
          }
        />
      ) : (data?.items.length ?? 0) === 0 ? (
        <EmptyState title="No feature flags yet" description="Create the first one below." />
      ) : (
        <div className="flex flex-col gap-2">
          {(data?.items ?? []).map((flag) => (
            <FeatureFlagRow
              key={flag.id}
              name={flag.key}
              label={flag.key}
              description={flag.description ?? undefined}
              enabled={flag.enabled}
              onEnabledChange={(enabled) => handleToggle(flag.key, enabled)}
              disabled={!canEdit}
              data-testid={`feature-flag-${flag.key}`}
            />
          ))}
        </div>
      )}

      <NewFlagForm canEdit={canEdit} />
    </div>
  );
}
