// `content_split` block fields (docs/specs/phase-10-page-builder.md block #2).
import * as React from "react";
import type { Control, FieldErrors, UseFormRegister, UseFormSetValue, UseFormWatch } from "react-hook-form";
import { Controller } from "react-hook-form";
import { Button, Input, Select, SelectItem, Textarea } from "@repo/ui";
import { ContentSplitBlockDataSchema, type ContentSplitBlockData } from "@repo/types";
import type { z } from "zod";

import { IconKeySelect } from "./shared-fields";
import { ImageKeyField } from "./image-key-field";

export type ContentSplitFormValues = z.input<typeof ContentSplitBlockDataSchema>;

export interface BlockFieldsProps {
  control: Control<ContentSplitFormValues>;
  register: UseFormRegister<ContentSplitFormValues>;
  errors: FieldErrors<ContentSplitFormValues>;
  watch: UseFormWatch<ContentSplitFormValues>;
  setValue: UseFormSetValue<ContentSplitFormValues>;
}

export function ContentSplitFields({ control, register, errors, watch, setValue }: BlockFieldsProps): React.JSX.Element {
  const body = watch("body") ?? [];
  const badge = watch("badge");

  function setParagraph(index: number, value: string) {
    const next = [...body];
    next[index] = value;
    setValue("body", next, { shouldValidate: true });
  }
  function addParagraph() {
    setValue("body", [...body, ""], { shouldValidate: true });
  }
  function removeParagraph(index: number) {
    setValue(
      "body",
      body.filter((_, i) => i !== index),
      { shouldValidate: true },
    );
  }
  function moveParagraph(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= body.length) return;
    const next = [...body];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved as string);
    setValue("body", next, { shouldValidate: true });
  }

  return (
    <div className="flex flex-col gap-3">
      <Input
        label="Small label above the heading (optional)"
        {...register("eyebrow")}
        error={errors.eyebrow?.message}
        data-testid="content-split-eyebrow"
      />
      <Input label="Heading" required {...register("heading")} error={errors.heading?.message} data-testid="content-split-heading" />
      <Input
        label="Words to highlight in green (optional)"
        helperText="Copy the exact words from the heading you want colored."
        {...register("headingHighlight")}
        error={errors.headingHighlight?.message}
        data-testid="content-split-heading-highlight"
      />

      <div className="flex flex-col gap-2 rounded-md border border-dashed border-border p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-fg-muted">Body paragraphs ({body.length}/6)</p>
          {body.length < 6 ? (
            <Button type="button" variant="secondary" size="sm" onClick={addParagraph} data-testid="content-split-body-add">
              + Add paragraph
            </Button>
          ) : null}
        </div>
        {body.map((paragraph, index) => (
          <div key={index} className="flex items-start gap-2">
            <Textarea
              rows={2}
              value={paragraph}
              onChange={(e) => setParagraph(index, e.target.value)}
              placeholder="Paragraph text…"
              aria-label={`Body paragraph ${index + 1}`}
              wrapperClassName="w-full flex-1"
              data-testid={`content-split-body-${index}`}
            />
            <div className="flex flex-col gap-1">
              <Button type="button" variant="ghost" size="icon" aria-label={`Move paragraph ${index + 1} up`} disabled={index === 0} onClick={() => moveParagraph(index, -1)}>
                ↑
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label={`Move paragraph ${index + 1} down`} disabled={index === body.length - 1} onClick={() => moveParagraph(index, 1)}>
                ↓
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove paragraph ${index + 1}`} onClick={() => removeParagraph(index)} data-testid={`content-split-body-remove-${index}`}>
                ✕
              </Button>
            </div>
          </div>
        ))}
        {errors.body?.message ? (
          <p role="alert" className="text-sm text-danger">
            {errors.body.message}
          </p>
        ) : null}
      </div>

      <ImageKeyField
        label="Image"
        required
        watchedValue={watch("mediaImageKey")}
        registered={register("mediaImageKey")}
        error={errors.mediaImageKey?.message}
        testId="content-split-media-image-key"
        onUploadedKey={(key) => setValue("mediaImageKey", key, { shouldDirty: true, shouldValidate: true })}
      />
      <Textarea
        label="Image description for screen readers (optional)"
        rows={3}
        helperText="Leave blank for a plain photo, it's decorative and the text beside it already says everything. Fill this in ONLY if the image has words in it (a poster or graphic): type out those words, so blind visitors get them too. Filling it in also stops the image being cropped, showing it in full."
        {...register("mediaAlt")}
        error={errors.mediaAlt?.message}
        data-testid="content-split-media-alt"
      />
      <Controller
        control={control}
        name="mediaPosition"
        render={({ field }) => (
          <Select label="Media position" value={field.value ?? "right"} onValueChange={field.onChange} data-testid="content-split-media-position">
            <SelectItem value="left">Left</SelectItem>
            <SelectItem value="right">Right</SelectItem>
          </Select>
        )}
      />

      <fieldset className="flex flex-col gap-2 rounded-md border border-dashed border-border p-3">
        <div className="flex items-center justify-between">
          <legend className="px-1 text-xs font-medium text-fg-muted">Badge (optional)</legend>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setValue("badge", badge ? undefined : { iconKey: "check", title: "", subtitle: "" }, { shouldValidate: true })}
            data-testid="content-split-badge-toggle"
          >
            {badge ? "Remove" : "+ Add"}
          </Button>
        </div>
        {badge ? (
          <div className="grid grid-cols-3 gap-2">
            <IconKeySelect control={control} name="badge.iconKey" testId="content-split-badge-icon" />
            <Input label="Title" required {...register("badge.title")} error={errors.badge?.title?.message} data-testid="content-split-badge-title" />
            <Input label="Subtitle" required {...register("badge.subtitle")} error={errors.badge?.subtitle?.message} data-testid="content-split-badge-subtitle" />
          </div>
        ) : null}
      </fieldset>
    </div>
  );
}

export type { ContentSplitBlockData };
