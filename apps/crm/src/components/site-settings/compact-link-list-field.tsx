// Compact, spreadsheet-style `{label, href}[]` row editor for Site Settings' nav/footer
// link lists — replaces the page-builder's `LinkListField` bordered-box-per-row layout
// (~100px/row) for these three call sites (nav primary links, footer legal links, footer
// column links), per docs/specs/phase-10-ui-polish-visual-audit.md §2.4. This is a
// site-settings-local component (not a change to
// `../page-builder/block-forms/shared-fields.tsx`, which is owned by another workstream)
// — it reuses that file's `ArrayItemControls` (unchanged, read-only import) for the
// keyboard-accessible reorder/remove buttons, so behavior stays identical.
//
// a11y (docs/specs/phase-10-ui-polish-visual-audit.md §4): column headers are printed
// once above the list for sighted users; each row's inputs drop the per-row `<Label>` in
// favor of a UNIQUE `aria-label` per input (never a generic "Label"/"Link" repeated
// identically across rows) so screen-reader users still get a correct accessible name.
import * as React from "react";
import { Plus } from "lucide-react";
import type { Control, FieldErrors, FieldValues, Path, UseFormRegister } from "react-hook-form";
import { useFieldArray } from "react-hook-form";
import { Button, Input } from "@repo/ui";

import { ArrayItemControls } from "../page-builder/block-forms/shared-fields";
import { KNOWN_SITE_DESTINATIONS } from "../../lib/known-site-destinations";
import { humanizeItemCount } from "../../lib/humanize-count";

export function CompactLinkListField<TForm extends FieldValues>({
  control,
  register,
  errors,
  name,
  max,
  min = 0,
  addLabel = "Add link",
  ariaPrefix = "Link",
  className,
}: {
  control: Control<TForm>;
  register: UseFormRegister<TForm>;
  errors: FieldErrors<TForm>;
  name: Path<TForm>;
  max: number;
  min?: number;
  addLabel?: string;
  /** Unique-per-instance prefix for each row's `aria-label`s, e.g. "Nav link" or
   *  "Company column link" — must distinguish rows across the whole page, not just
   *  within one list, since footer columns nest multiple link lists on one screen. */
  ariaPrefix?: string;
  className?: string;
}): React.JSX.Element {
  const { fields, append, remove, move } = useFieldArray({ control, name: name as never });
  const fieldErrors = (errors as Record<string, unknown>)[name as string] as
    | Array<{ label?: { message?: string }; href?: { message?: string } }>
    | undefined;
  const datalistId = React.useId();

  return (
    <div className={className ?? "flex flex-col gap-1.5"}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-fg-muted">{humanizeItemCount("Links", fields.length, max, min)}</p>
        {fields.length < max ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => append({ label: "", href: "" } as never)} data-testid={`${name}-add`}>
            <Plus className="size-3.5" aria-hidden="true" />
            {addLabel}
          </Button>
        ) : null}
      </div>

      {fields.length > 0 ? (
        <div className="rounded-md border border-border">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2 border-b border-border bg-surface px-2 py-1 text-xs font-medium text-fg-muted">
            <span>Label</span>
            <span>Link</span>
            <span className="sr-only">Actions</span>
          </div>
          <div className="divide-y divide-border">
            {fields.map((field, index) => (
              <div key={field.id} className="grid grid-cols-[1fr_1fr_auto] items-start gap-2 px-2 py-1.5">
                <Input
                  size="sm"
                  aria-label={`${ariaPrefix} ${index + 1} label`}
                  {...register(`${name}.${index}.label` as Path<TForm>)}
                  error={fieldErrors?.[index]?.label?.message}
                  data-testid={`${name}-${index}-label`}
                />
                <Input
                  size="sm"
                  list={datalistId}
                  aria-label={`${ariaPrefix} ${index + 1} URL`}
                  placeholder="/about or https://…"
                  {...register(`${name}.${index}.href` as Path<TForm>)}
                  error={fieldErrors?.[index]?.href?.message}
                  data-testid={`${name}-${index}-href`}
                />
                <ArrayItemControls
                  index={index}
                  count={fields.length}
                  onMoveUp={() => move(index, index - 1)}
                  onMoveDown={() => move(index, index + 1)}
                  onRemove={() => remove(index)}
                  itemLabel={`${ariaPrefix.toLowerCase()} ${index + 1}`}
                  testIdPrefix={`${name}-item`}
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <p className="text-xs text-fg-muted">Pick one of your pages, or paste a full link.</p>
      <datalist id={datalistId}>
        {KNOWN_SITE_DESTINATIONS.map((d) => (
          <option key={d.path} value={d.path}>
            {d.label} page
          </option>
        ))}
      </datalist>
    </div>
  );
}
