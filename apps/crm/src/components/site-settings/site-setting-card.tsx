// Shared load/save chrome for one Site Settings key-editor card — loading/empty/error
// states + the Save button, per CLAUDE.md §4 DoD. Each key's own field layout is supplied
// by the caller via `renderFields` (the concrete per-key form components in this folder).
import * as React from "react";
import type { UseFormReturn, FieldValues } from "react-hook-form";
import { Button, EmptyState, Skeleton, StatusChip } from "@repo/ui";
import type { z } from "zod";
import type { SiteSettingKey } from "@repo/types";

import { useSiteSettingForm } from "../../hooks/use-site-setting-form";

export function SiteSettingCard<TValueSchema extends z.ZodTypeAny>({
  title,
  description,
  settingKey,
  valueSchema,
  canEdit,
  renderFields,
  testId,
}: {
  title: string;
  description?: string;
  settingKey: SiteSettingKey;
  valueSchema: TValueSchema;
  canEdit: boolean;
  renderFields: (form: UseFormReturn<{ value: z.input<TValueSchema> } & FieldValues>) => React.ReactNode;
  testId: string;
}): React.JSX.Element {
  const { form, isLoading, isError, refetch, onSubmit, isSaving } = useSiteSettingForm(settingKey, valueSchema);
  // Reading `form.formState.isDirty` here (in the component that owns the `useForm()`
  // instance, via `useSiteSettingForm`) subscribes this render to react-hook-form's
  // dirty-state changes — no separate `useFormState` call needed. Cleared automatically
  // when `onSubmit` succeeds: the mutation invalidates the query, the new server value
  // flows back through `data`, and `useSiteSettingForm`'s effect calls `form.reset(...)`.
  const isDirty = !isLoading && !isError && form.formState.isDirty;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4" data-testid={testId}>
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          {isDirty ? <StatusChip tone="warning" size="sm" label="Unsaved changes" data-testid={`${testId}-dirty`} /> : null}
        </div>
        {description ? <p className="text-xs text-fg-muted">{description}</p> : null}
      </div>
      {isLoading ? (
        <Skeleton shape="block" className="h-24" data-testid={`${testId}-loading`} />
      ) : isError ? (
        <EmptyState
          title={`Couldn't load "${title}"`}
          data-testid={`${testId}-error`}
          action={
            <Button variant="secondary" onClick={() => refetch()}>
              Try again
            </Button>
          }
        />
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          {/* `form` is generic over TValueSchema per-card; the cast keeps every concrete field
              component's own strongly-typed `UseFormReturn<...>` prop signature (see e.g.
              nav-primary-links-card.tsx) rather than widening every caller to `FieldValues`. */}
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {renderFields(form as any)}
          <div className="flex flex-col gap-1">
            <Button type="submit" disabled={!canEdit} loading={isSaving} data-testid={`${testId}-save`}>
              Save
            </Button>
            <p className="text-xs text-fg-muted">Saved changes appear on your website within about 5 minutes.</p>
          </div>
        </form>
      )}
    </div>
  );
}
