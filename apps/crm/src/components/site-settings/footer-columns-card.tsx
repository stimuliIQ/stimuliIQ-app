// `footer.columns` — footer link columns (heading + links), a two-level array (columns,
// each with its own links array) — docs/specs/phase-10-page-builder.md "Site Settings".
//
// Visual-audit §2.4.6: each column collapses into a `CollapsibleSection` (icon-free —
// there's no per-column identity concept here, unlike page-builder blocks) whose header
// shows the column's own heading (read live via `useWatch`, updates as you type) plus its
// link count, so the tab reads as "Company (4 links) / Programs (5 links) / Legal
// (3 links)" at a glance instead of ~20 always-open link rows. Reorder/remove controls
// stay in the header (keyboard-accessible even while collapsed, per the audit's "keep
// keyboard-accessible reorder buttons" constraint).
import * as React from "react";
import { useFieldArray, useWatch, type Control, type FieldErrors, type UseFormRegister } from "react-hook-form";
import { Button, CollapsibleSection, Input } from "@repo/ui";
import { FooterColumnsValueSchema, type FooterColumnsValue } from "@repo/types";

import { ArrayItemControls } from "../page-builder/block-forms/shared-fields";
import { CompactLinkListField } from "./compact-link-list-field";
import { humanizeItemCount } from "../../lib/humanize-count";
import { SiteSettingCard } from "./site-setting-card";

interface WrappedValues {
  value: { heading: string; links: { label: string; href: string }[] }[];
}

function FooterColumnItem({
  index,
  count,
  control,
  register,
  errors,
  columnErrors,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  index: number;
  count: number;
  control: Control<WrappedValues>;
  register: UseFormRegister<WrappedValues>;
  errors: FieldErrors<WrappedValues>;
  columnErrors: Array<{ heading?: { message?: string } }>;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}): React.JSX.Element {
  const heading = useWatch({ control, name: `value.${index}.heading` });
  const links = useWatch({ control, name: `value.${index}.links` }) as
    | { label?: string; href?: string }[]
    | undefined;
  const linkCount = links?.length ?? 0;

  return (
    <CollapsibleSection
      defaultOpen={false}
      header={
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate font-medium text-fg">{heading?.trim() || `Column ${index + 1}`}</span>
          <span className="shrink-0 text-xs text-fg-muted">
            {linkCount} {linkCount === 1 ? "link" : "links"}
          </span>
        </span>
      }
      headerActions={
        <ArrayItemControls
          index={index}
          count={count}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          onRemove={onRemove}
          itemLabel={`column ${index + 1}`}
          testIdPrefix="footer-columns-item"
        />
      }
      data-testid={`footer-columns-section-${index}`}
    >
      <div className="flex flex-col gap-3">
        <Input
          label="Column heading"
          required
          {...register(`value.${index}.heading`)}
          error={columnErrors[index]?.heading?.message}
          data-testid={`footer-columns-${index}-heading`}
        />
        <CompactLinkListField
          control={control as never}
          register={register as never}
          errors={errors as never}
          name={`value.${index}.links` as never}
          max={20}
          min={1}
          addLabel="Add link"
          ariaPrefix={`${heading?.trim() || `Column ${index + 1}`} link`}
          className="flex flex-col gap-1.5 rounded-md bg-surface p-2"
        />
      </div>
    </CollapsibleSection>
  );
}

function ColumnsEditor({
  control,
  register,
  errors,
}: {
  control: Control<WrappedValues>;
  register: UseFormRegister<WrappedValues>;
  errors: FieldErrors<WrappedValues>;
}): React.JSX.Element {
  const { fields, append, remove, move } = useFieldArray({ control, name: "value" });
  const columnErrors = (errors.value ?? []) as Array<{ heading?: { message?: string } }>;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-fg-muted">{humanizeItemCount("Columns", fields.length, 6, 1)}</p>
        {fields.length < 6 ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => append({ heading: "", links: [{ label: "", href: "" }] })}
            data-testid="footer-columns-add"
          >
            + Add column
          </Button>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        {fields.map((field, index) => (
          <FooterColumnItem
            key={field.id}
            index={index}
            count={fields.length}
            control={control}
            register={register}
            errors={errors}
            columnErrors={columnErrors}
            onMoveUp={() => move(index, index - 1)}
            onMoveDown={() => move(index, index + 1)}
            onRemove={() => remove(index)}
          />
        ))}
      </div>
    </div>
  );
}

export function FooterColumnsCard({ canEdit }: { canEdit: boolean }): React.JSX.Element {
  return (
    <SiteSettingCard
      title="Footer columns"
      description="Footer link columns, each with a heading and its own links, 1 to 6 columns."
      settingKey="footer.columns"
      valueSchema={FooterColumnsValueSchema}
      canEdit={canEdit}
      testId="site-setting-footer-columns"
      renderFields={(form) => <ColumnsEditor control={form.control as never} register={form.register as never} errors={form.formState.errors as never} />}
    />
  );
}

export type { FooterColumnsValue };
