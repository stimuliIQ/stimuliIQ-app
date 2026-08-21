// `feature_grid` block fields (docs/specs/phase-10-page-builder.md block #4).
import * as React from "react";
import type { Control, FieldErrors, UseFormRegister, UseFormSetValue, UseFormWatch } from "react-hook-form";
import { useFieldArray, Controller } from "react-hook-form";
import { Button, Input, Select, SelectItem } from "@repo/ui";
import { FeatureGridBlockDataSchema, type FeatureGridBlockData } from "@repo/types";
import type { z } from "zod";

import { ArrayItemControls, IconKeySelect } from "./shared-fields";
import { OptionalHeadingFields } from "./heading-fields";
import { ImageKeyField } from "./image-key-field";

export type FeatureGridFormValues = z.input<typeof FeatureGridBlockDataSchema>;

export interface BlockFieldsProps {
  control: Control<FeatureGridFormValues>;
  register: UseFormRegister<FeatureGridFormValues>;
  errors: FieldErrors<FeatureGridFormValues>;
  watch: UseFormWatch<FeatureGridFormValues>;
  setValue: UseFormSetValue<FeatureGridFormValues>;
}

export function FeatureGridFields({ control, register, errors, watch, setValue }: BlockFieldsProps): React.JSX.Element {
  const variant = watch("variant");
  const { fields, append, remove, move } = useFieldArray({ control, name: "items" });

  return (
    <div className="flex flex-col gap-3">
      <Controller
        control={control}
        name="variant"
        render={({ field }) => (
          <Select label="Layout" value={field.value} onValueChange={field.onChange} data-testid="feature-grid-variant">
            <SelectItem value="cards">Cards</SelectItem>
            <SelectItem value="split-media">Split media (2 cards | photo | 2 cards, exactly 4 items)</SelectItem>
            <SelectItem value="strip">Strip (compact row)</SelectItem>
          </Select>
        )}
      />
      <OptionalHeadingFields control={control} register={register} errors={errors} watch={watch} setValue={setValue} variant="with-eyebrow" testIdPrefix="feature-grid" />
      <Controller
        control={control}
        name="columns"
        render={({ field }) => (
          <Select label="Columns (optional, variant-appropriate default if unset)" value={field.value ?? "__auto__"} onValueChange={(v) => field.onChange(v === "__auto__" ? undefined : v)} data-testid="feature-grid-columns">
            <SelectItem value="__auto__">Auto</SelectItem>
            <SelectItem value="2">2</SelectItem>
            <SelectItem value="3">3</SelectItem>
            <SelectItem value="4">4</SelectItem>
          </Select>
        )}
      />
      {variant === "split-media" ? (
        <ImageKeyField
          label="Center image"
          required
          watchedValue={watch("centerImageKey")}
          registered={register("centerImageKey")}
          error={errors.centerImageKey?.message}
          testId="feature-grid-center-image-key"
          onUploadedKey={(key) => setValue("centerImageKey", key, { shouldDirty: true, shouldValidate: true })}
        />
      ) : null}

      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-fg-muted">
          Items ({fields.length}/12){variant === "split-media" ? ". Exactly 4 required for split-media" : ""}
        </p>
        {fields.length < 12 ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => append({ title: "", description: "" })} data-testid="feature-grid-item-add">
            + Add item
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
            <IconKeySelect control={control} name={`items.${index}.iconKey`} testId={`feature-grid-item-${index}-icon`} />
            <Input label="Title" required {...register(`items.${index}.title`)} error={errors.items?.[index]?.title?.message} data-testid={`feature-grid-item-${index}-title`} />
          </div>
          <Input label="Description" required {...register(`items.${index}.description`)} error={errors.items?.[index]?.description?.message} data-testid={`feature-grid-item-${index}-description`} />
          <ArrayItemControls
            index={index}
            count={fields.length}
            onMoveUp={() => move(index, index - 1)}
            onMoveDown={() => move(index, index + 1)}
            onRemove={() => remove(index)}
            itemLabel={`item ${index + 1}`}
            testIdPrefix="feature-grid-item"
          />
        </div>
      ))}
    </div>
  );
}

export type { FeatureGridBlockData };
