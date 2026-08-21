// Shared field building blocks reused across the 11 page-builder block forms (and, for
// link lists, the Site Settings nav/footer editors) — avoids re-implementing the same
// "heading with eyebrow", "list of CTAs", "list of links" shape 6+ times (spec "Shared
// conventions"). Every field here is wired to react-hook-form via `control`/`register`
// passed down from the owning block card's `useForm` instance (block-card.tsx) — never a
// second, disconnected `useForm`.
import * as React from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import type { Control, FieldErrors, FieldValues, Path, UseFormRegister } from "react-hook-form";
import { useFieldArray, Controller } from "react-hook-form";
import { Button, Input, Select, SelectItem } from "@repo/ui";

import { ICON_KEY_OPTIONS } from "../../../lib/page-builder-block-meta";

const NONE_VALUE = "__none__";

/** Optional `iconKey` select — closed enum, "None" maps to `undefined` (spec: no freeform icon input). */
export function IconKeySelect<TForm extends FieldValues>({
  control,
  name,
  label = "Icon",
  testId,
}: {
  control: Control<TForm>;
  name: Path<TForm>;
  label?: string;
  testId: string;
}): React.JSX.Element {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Select
          label={label}
          placeholder="No icon"
          value={(field.value as string | undefined) ?? NONE_VALUE}
          onValueChange={(v) => field.onChange(v === NONE_VALUE ? undefined : v)}
          data-testid={testId}
        >
          <SelectItem value={NONE_VALUE}>No icon</SelectItem>
          {ICON_KEY_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </Select>
      )}
    />
  );
}

/** Reorder + remove control row shared by every array-field item (a11y: keyboard-operable up/down). */
export function ArrayItemControls({
  index,
  count,
  onMoveUp,
  onMoveDown,
  onRemove,
  itemLabel,
  testIdPrefix,
}: {
  index: number;
  count: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  itemLabel: string;
  testIdPrefix: string;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Move ${itemLabel} up`}
        disabled={index === 0}
        onClick={onMoveUp}
        data-testid={`${testIdPrefix}-move-up-${index}`}
      >
        <ChevronUp className="size-4" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Move ${itemLabel} down`}
        disabled={index === count - 1}
        onClick={onMoveDown}
        data-testid={`${testIdPrefix}-move-down-${index}`}
      >
        <ChevronDown className="size-4" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Remove ${itemLabel}`}
        onClick={onRemove}
        data-testid={`${testIdPrefix}-remove-${index}`}
      >
        <Trash2 className="size-4 text-danger" aria-hidden="true" />
      </Button>
    </div>
  );
}

/** `{label, href, style}[]` — `hero.ctas` / `cta_band.buttons` (max enforced by the caller). */
export function CtaListField<TForm extends FieldValues>({
  control,
  register,
  errors,
  name,
  max,
  addLabel = "Add button",
}: {
  control: Control<TForm>;
  register: UseFormRegister<TForm>;
  errors: FieldErrors<TForm>;
  name: Path<TForm>;
  max: number;
  addLabel?: string;
}): React.JSX.Element {
  const { fields, append, remove, move } = useFieldArray({ control, name: name as never });
  const fieldErrors = (errors as Record<string, unknown>)[name as string] as
    | Array<{ label?: { message?: string }; href?: { message?: string } }>
    | undefined;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-fg-muted">Buttons, up to {max}</p>
        {fields.length < max ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => append({ label: "", href: "", style: fields.length === 0 ? "primary" : "secondary" } as never)}
            data-testid={`${name}-add`}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            {addLabel}
          </Button>
        ) : null}
      </div>
      {fields.map((field, index) => (
        <div key={field.id} className="flex items-end gap-2 rounded-md border border-border p-2">
          <Input
            label="Label"
            required
            {...register(`${name}.${index}.label` as Path<TForm>)}
            error={fieldErrors?.[index]?.label?.message}
            wrapperClassName="flex-1"
            data-testid={`${name}-${index}-label`}
          />
          <Input
            label="Link"
            required
            placeholder="/programs or https://…"
            {...register(`${name}.${index}.href` as Path<TForm>)}
            error={fieldErrors?.[index]?.href?.message}
            wrapperClassName="flex-1"
            data-testid={`${name}-${index}-href`}
          />
          <Controller
            control={control}
            name={`${name}.${index}.style` as Path<TForm>}
            render={({ field: styleField }) => (
              <Select
                label="Style"
                value={(styleField.value as string) ?? "secondary"}
                onValueChange={styleField.onChange}
                wrapperClassName="w-32"
                data-testid={`${name}-${index}-style`}
              >
                <SelectItem value="primary">Primary</SelectItem>
                <SelectItem value="secondary">Secondary</SelectItem>
              </Select>
            )}
          />
          <ArrayItemControls
            index={index}
            count={fields.length}
            onMoveUp={() => move(index, index - 1)}
            onMoveDown={() => move(index, index + 1)}
            onRemove={() => remove(index)}
            itemLabel={`button ${index + 1}`}
            testIdPrefix={`${name}-item`}
          />
        </div>
      ))}
    </div>
  );
}

/** `{label, href}[]` — nav/footer link lists (Site Settings) and `faq`/`live_collection_ref`
 *  single-href fields reuse plain `Input` directly, this is only for arrays of links. */
export function LinkListField<TForm extends FieldValues>({
  control,
  register,
  errors,
  name,
  max,
  min = 0,
  addLabel = "Add link",
}: {
  control: Control<TForm>;
  register: UseFormRegister<TForm>;
  errors: FieldErrors<TForm>;
  name: Path<TForm>;
  max: number;
  min?: number;
  addLabel?: string;
}): React.JSX.Element {
  const { fields, append, remove, move } = useFieldArray({ control, name: name as never });
  const fieldErrors = (errors as Record<string, unknown>)[name as string] as
    | Array<{ label?: { message?: string }; href?: { message?: string } }>
    | undefined;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-fg-muted">
          Links ({fields.length}/{max}
          {min > 0 ? `, min ${min}` : ""})
        </p>
        {fields.length < max ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => append({ label: "", href: "" } as never)} data-testid={`${name}-add`}>
            <Plus className="size-3.5" aria-hidden="true" />
            {addLabel}
          </Button>
        ) : null}
      </div>
      {fields.map((field, index) => (
        <div key={field.id} className="flex items-end gap-2 rounded-md border border-border p-2">
          <Input
            label="Label"
            required
            {...register(`${name}.${index}.label` as Path<TForm>)}
            error={fieldErrors?.[index]?.label?.message}
            wrapperClassName="flex-1"
            data-testid={`${name}-${index}-label`}
          />
          <Input
            label="Link"
            required
            placeholder="/about or https://…"
            {...register(`${name}.${index}.href` as Path<TForm>)}
            error={fieldErrors?.[index]?.href?.message}
            wrapperClassName="flex-1"
            data-testid={`${name}-${index}-href`}
          />
          <ArrayItemControls
            index={index}
            count={fields.length}
            onMoveUp={() => move(index, index - 1)}
            onMoveDown={() => move(index, index + 1)}
            onRemove={() => remove(index)}
            itemLabel={`link ${index + 1}`}
            testIdPrefix={`${name}-item`}
          />
        </div>
      ))}
    </div>
  );
}
