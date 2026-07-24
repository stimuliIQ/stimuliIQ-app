// `numbered_steps` block fields (docs/specs/phase-10-page-builder.md block #5).
import * as React from "react";
import type { Control, FieldErrors, UseFormRegister, UseFormSetValue, UseFormWatch } from "react-hook-form";
import { useFieldArray, Controller } from "react-hook-form";
import { Button, Input, Select, SelectItem } from "@repo/ui";
import { NumberedStepsBlockDataSchema, type NumberedStepsBlockData } from "@repo/types";
import type { z } from "zod";

import { ArrayItemControls } from "./shared-fields";
import { OptionalHeadingFields } from "./heading-fields";

export type NumberedStepsFormValues = z.input<typeof NumberedStepsBlockDataSchema>;

export interface BlockFieldsProps {
  control: Control<NumberedStepsFormValues>;
  register: UseFormRegister<NumberedStepsFormValues>;
  errors: FieldErrors<NumberedStepsFormValues>;
  watch: UseFormWatch<NumberedStepsFormValues>;
  setValue: UseFormSetValue<NumberedStepsFormValues>;
}

export function NumberedStepsFields({ control, register, errors, watch, setValue }: BlockFieldsProps): React.JSX.Element {
  const { fields, append, remove, move } = useFieldArray({ control, name: "items" });

  return (
    <div className="flex flex-col gap-3">
      <OptionalHeadingFields control={control} register={register} errors={errors} watch={watch} setValue={setValue} variant="with-eyebrow" testIdPrefix="numbered-steps" />
      <Controller
        control={control}
        name="variant"
        render={({ field }) => (
          <Select label="Layout" value={field.value} onValueChange={field.onChange} data-testid="numbered-steps-variant">
            <SelectItem value="arrows">Arrows (desktop connector)</SelectItem>
            <SelectItem value="timeline">Timeline (vertical)</SelectItem>
            <SelectItem value="compact">Compact (numbered grid)</SelectItem>
          </Select>
        )}
      />

      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-fg-muted">Steps ({fields.length}/8, min 2)</p>
        {fields.length < 8 ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => append({ title: "", description: "" })} data-testid="numbered-steps-item-add">
            + Add step
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
          <Input label="Title" required {...register(`items.${index}.title`)} error={errors.items?.[index]?.title?.message} data-testid={`numbered-steps-item-${index}-title`} />
          <Input label="Description" required {...register(`items.${index}.description`)} error={errors.items?.[index]?.description?.message} data-testid={`numbered-steps-item-${index}-description`} />
          <ArrayItemControls
            index={index}
            count={fields.length}
            onMoveUp={() => move(index, index - 1)}
            onMoveDown={() => move(index, index + 1)}
            onRemove={() => remove(index)}
            itemLabel={`step ${index + 1}`}
            testIdPrefix="numbered-steps-item"
          />
        </div>
      ))}
    </div>
  );
}

export type { NumberedStepsBlockData };
