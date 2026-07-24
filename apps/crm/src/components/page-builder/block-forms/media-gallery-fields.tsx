// `media_gallery` block fields (docs/specs/phase-10-page-builder.md block #8).
import * as React from "react";
import type { Control, FieldErrors, UseFormRegister, UseFormSetValue, UseFormWatch } from "react-hook-form";
import { useFieldArray, Controller } from "react-hook-form";
import { Button, Input, Select, SelectItem } from "@repo/ui";
import { MediaGalleryBlockDataSchema, type MediaGalleryBlockData } from "@repo/types";
import type { z } from "zod";

import { ArrayItemControls } from "./shared-fields";
import { OptionalHeadingFields } from "./heading-fields";
import { ImageKeyField } from "./image-key-field";

export type MediaGalleryFormValues = z.input<typeof MediaGalleryBlockDataSchema>;

export interface BlockFieldsProps {
  control: Control<MediaGalleryFormValues>;
  register: UseFormRegister<MediaGalleryFormValues>;
  errors: FieldErrors<MediaGalleryFormValues>;
  watch: UseFormWatch<MediaGalleryFormValues>;
  setValue: UseFormSetValue<MediaGalleryFormValues>;
}

export function MediaGalleryFields({ control, register, errors, watch, setValue }: BlockFieldsProps): React.JSX.Element {
  const { fields, append, remove, move } = useFieldArray({ control, name: "items" });

  return (
    <div className="flex flex-col gap-3">
      <OptionalHeadingFields control={control} register={register} errors={errors} watch={watch} setValue={setValue} variant="minimal" testIdPrefix="media-gallery" />
      <Controller
        control={control}
        name="columns"
        render={({ field }) => (
          <Select label="Columns" value={field.value ?? "3"} onValueChange={field.onChange} data-testid="media-gallery-columns">
            <SelectItem value="2">2</SelectItem>
            <SelectItem value="3">3</SelectItem>
          </Select>
        )}
      />

      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-fg-muted">Photos ({fields.length}/60, min 1)</p>
        {fields.length < 60 ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => append({ imageKey: "", alt: "" })} data-testid="media-gallery-item-add">
            + Add photo
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
            <ImageKeyField
              required
              watchedValue={watch(`items.${index}.imageKey`)}
              registered={register(`items.${index}.imageKey`)}
              error={errors.items?.[index]?.imageKey?.message}
              testId={`media-gallery-item-${index}-image-key`}
              onUploadedKey={(key) =>
                setValue(`items.${index}.imageKey`, key, { shouldDirty: true, shouldValidate: true })
              }
            />
            <Input
              label="Alt text (required — accessibility)"
              helperText="A short description for screen readers, e.g. 'Students in the campus lab'."
              required
              {...register(`items.${index}.alt`)}
              error={errors.items?.[index]?.alt?.message}
              data-testid={`media-gallery-item-${index}-alt`}
            />
          </div>
          <Input label="Caption (optional)" {...register(`items.${index}.caption`)} error={errors.items?.[index]?.caption?.message} data-testid={`media-gallery-item-${index}-caption`} />
          <ArrayItemControls
            index={index}
            count={fields.length}
            onMoveUp={() => move(index, index - 1)}
            onMoveDown={() => move(index, index + 1)}
            onRemove={() => remove(index)}
            itemLabel={`photo ${index + 1}`}
            testIdPrefix="media-gallery-item"
          />
        </div>
      ))}
    </div>
  );
}

export type { MediaGalleryBlockData };
