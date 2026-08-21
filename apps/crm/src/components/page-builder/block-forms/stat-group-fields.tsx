// `stat_group` block fields (docs/specs/phase-10-page-builder.md block #3).
import * as React from "react";
import type { Control, FieldErrors, UseFormRegister, UseFormSetValue, UseFormWatch } from "react-hook-form";
import { useFieldArray, Controller } from "react-hook-form";
import { Button, Input, Select, SelectItem } from "@repo/ui";
import { StatGroupBlockDataSchema, type StatGroupBlockData } from "@repo/types";
import type { z } from "zod";

import { ArrayItemControls, IconKeySelect } from "./shared-fields";
import { OptionalHeadingFields } from "./heading-fields";

export type StatGroupFormValues = z.input<typeof StatGroupBlockDataSchema>;

export interface BlockFieldsProps {
  control: Control<StatGroupFormValues>;
  register: UseFormRegister<StatGroupFormValues>;
  errors: FieldErrors<StatGroupFormValues>;
  watch: UseFormWatch<StatGroupFormValues>;
  setValue: UseFormSetValue<StatGroupFormValues>;
}

const VARIANT_COUNT_HINT: Record<string, string> = {
  bento: "exactly 3 items",
  band: "2-6 items",
  bars: "2-8 items",
};

export function StatGroupFields({ control, register, errors, watch, setValue }: BlockFieldsProps): React.JSX.Element {
  const variant = watch("variant");
  const { fields, append, remove, move } = useFieldArray({ control, name: "items" });

  return (
    <div className="flex flex-col gap-3">
      <Controller
        control={control}
        name="variant"
        render={({ field }) => (
          <Select label="Layout" value={field.value} onValueChange={field.onChange} data-testid="stat-group-variant">
            <SelectItem value="bento">Bento (3-card asymmetric grid)</SelectItem>
            <SelectItem value="band">Band (flat row)</SelectItem>
            <SelectItem value="bars">Bars (labeled progress bars)</SelectItem>
          </Select>
        )}
      />
      <OptionalHeadingFields control={control} register={register} errors={errors} watch={watch} setValue={setValue} variant="with-eyebrow" testIdPrefix="stat-group" />

      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-fg-muted">
          Stats ({fields.length}), {VARIANT_COUNT_HINT[variant] ?? "2-8 items"} required for this layout
        </p>
        {fields.length < 8 ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => append({ label: "", value: "" })} data-testid="stat-group-item-add">
            + Add stat
          </Button>
        ) : null}
      </div>
      {errors.items?.message ? (
        <p role="alert" className="text-sm text-danger">
          {errors.items.message}
        </p>
      ) : null}
      {fields.map((field, index) => (
        <div key={field.id} className="flex flex-col gap-2 rounded-md border border-border p-2">
          <div className="grid grid-cols-2 gap-2">
            <Input label="Label" required {...register(`items.${index}.label`)} error={errors.items?.[index]?.label?.message} data-testid={`stat-group-item-${index}-label`} />
            <Input label="Value" required {...register(`items.${index}.value`)} error={errors.items?.[index]?.value?.message} data-testid={`stat-group-item-${index}-value`} />
          </div>
          {variant === "bento" ? (
            <div className="grid grid-cols-2 gap-2">
              <Input label="Description" {...register(`items.${index}.description`)} error={errors.items?.[index]?.description?.message} data-testid={`stat-group-item-${index}-description`} />
              <IconKeySelect control={control} name={`items.${index}.iconKey`} testId={`stat-group-item-${index}-icon`} />
            </div>
          ) : null}
          <ArrayItemControls
            index={index}
            count={fields.length}
            onMoveUp={() => move(index, index - 1)}
            onMoveDown={() => move(index, index + 1)}
            onRemove={() => remove(index)}
            itemLabel={`stat ${index + 1}`}
            testIdPrefix="stat-group-item"
          />
        </div>
      ))}
    </div>
  );
}

export type { StatGroupBlockData };
