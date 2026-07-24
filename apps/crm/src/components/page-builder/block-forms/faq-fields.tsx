// `faq` block fields (docs/specs/phase-10-page-builder.md block #6).
import * as React from "react";
import type { Control, FieldErrors, UseFormRegister, UseFormSetValue, UseFormWatch } from "react-hook-form";
import { useFieldArray } from "react-hook-form";
import { Button, Input, Textarea } from "@repo/ui";
import { FaqBlockDataSchema, type FaqBlockData } from "@repo/types";
import type { z } from "zod";

import { ArrayItemControls } from "./shared-fields";
import { OptionalHeadingFields } from "./heading-fields";

export type FaqFormValues = z.input<typeof FaqBlockDataSchema>;

export interface BlockFieldsProps {
  control: Control<FaqFormValues>;
  register: UseFormRegister<FaqFormValues>;
  errors: FieldErrors<FaqFormValues>;
  watch: UseFormWatch<FaqFormValues>;
  setValue: UseFormSetValue<FaqFormValues>;
}

export function FaqFields({ control, register, errors, watch, setValue }: BlockFieldsProps): React.JSX.Element {
  const { fields, append, remove, move } = useFieldArray({ control, name: "items" });

  return (
    <div className="flex flex-col gap-3">
      <OptionalHeadingFields control={control} register={register} errors={errors} watch={watch} setValue={setValue} variant="simple" testIdPrefix="faq" />

      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-fg-muted">Questions ({fields.length}/20, min 1)</p>
        {fields.length < 20 ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => append({ question: "", answer: "" })} data-testid="faq-item-add">
            + Add question
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
          <Input label="Question" required {...register(`items.${index}.question`)} error={errors.items?.[index]?.question?.message} data-testid={`faq-item-${index}-question`} />
          <Textarea
            id={`faq-item-${index}-answer`}
            label="Answer"
            required
            rows={2}
            {...register(`items.${index}.answer`)}
            error={errors.items?.[index]?.answer?.message}
            data-testid={`faq-item-${index}-answer`}
          />
          <ArrayItemControls
            index={index}
            count={fields.length}
            onMoveUp={() => move(index, index - 1)}
            onMoveDown={() => move(index, index + 1)}
            onRemove={() => remove(index)}
            itemLabel={`question ${index + 1}`}
            testIdPrefix="faq-item"
          />
        </div>
      ))}

      <Input label={'"View all" link (optional)'} placeholder="/faq" {...register("viewAllHref")} error={errors.viewAllHref?.message} data-testid="faq-view-all-href" />
    </div>
  );
}

export type { FaqBlockData };
