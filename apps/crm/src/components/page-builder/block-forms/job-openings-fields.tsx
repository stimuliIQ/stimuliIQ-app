// `job_openings` block fields (docs/specs/phase-10-page-builder.md block #9).
// Empty `items` is valid (`CareersRoleList` already handles the empty state) — no
// minimum-items nudge, unlike the other list blocks.
import * as React from "react";
import type { Control, FieldErrors, UseFormRegister, UseFormSetValue, UseFormWatch } from "react-hook-form";
import { useFieldArray } from "react-hook-form";
import { Button, Input } from "@repo/ui";

import { JobOpeningsBlockDataSchema, type JobOpeningsBlockData } from "@repo/types";
import type { z } from "zod";

import { ArrayItemControls } from "./shared-fields";
import { OptionalHeadingFields } from "./heading-fields";

export type JobOpeningsFormValues = z.input<typeof JobOpeningsBlockDataSchema>;

export interface BlockFieldsProps {
  control: Control<JobOpeningsFormValues>;
  register: UseFormRegister<JobOpeningsFormValues>;
  errors: FieldErrors<JobOpeningsFormValues>;
  watch: UseFormWatch<JobOpeningsFormValues>;
  setValue: UseFormSetValue<JobOpeningsFormValues>;
}

export function JobOpeningsFields({ control, register, errors, watch, setValue }: BlockFieldsProps): React.JSX.Element {
  const { fields, append, remove, move } = useFieldArray({ control, name: "items" });

  return (
    <div className="flex flex-col gap-3">
      <OptionalHeadingFields control={control} register={register} errors={errors} watch={watch} setValue={setValue} variant="minimal" testIdPrefix="job-openings" />

      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-fg-muted">Open roles ({fields.length}/30) — empty is valid</p>
        {fields.length < 30 ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => append({ title: "", employmentType: "", location: "", description: "" })}
            data-testid="job-openings-item-add"
          >
            + Add role
          </Button>
        ) : null}
      </div>
      {fields.map((field, index) => (
        <div key={field.id} className="flex flex-col gap-2 rounded-md border border-border p-2">
          <div className="grid grid-cols-3 gap-2">
            <Input label="Title" required {...register(`items.${index}.title`)} error={errors.items?.[index]?.title?.message} data-testid={`job-openings-item-${index}-title`} />
            <Input label="Employment type" required placeholder="Full-time" {...register(`items.${index}.employmentType`)} error={errors.items?.[index]?.employmentType?.message} data-testid={`job-openings-item-${index}-type`} />
            <Input label="Location" required {...register(`items.${index}.location`)} error={errors.items?.[index]?.location?.message} data-testid={`job-openings-item-${index}-location`} />
          </div>
          <Input label="Description" required {...register(`items.${index}.description`)} error={errors.items?.[index]?.description?.message} data-testid={`job-openings-item-${index}-description`} />
          <ArrayItemControls
            index={index}
            count={fields.length}
            onMoveUp={() => move(index, index - 1)}
            onMoveDown={() => move(index, index + 1)}
            onRemove={() => remove(index)}
            itemLabel={`role ${index + 1}`}
            testIdPrefix="job-openings-item"
          />
        </div>
      ))}

      <Input label="Empty-state message" required {...register("emptyStateMessage")} error={errors.emptyStateMessage?.message} data-testid="job-openings-empty-message" />
    </div>
  );
}

export type { JobOpeningsBlockData };
