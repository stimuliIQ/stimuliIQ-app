// `hero` block fields (docs/specs/phase-10-page-builder.md block #1).
import * as React from "react";
import type { Control, FieldErrors, UseFormRegister, UseFormSetValue, UseFormWatch } from "react-hook-form";
import { useFieldArray, Controller } from "react-hook-form";
import { Button, Input, Select, SelectItem } from "@repo/ui";
import { HeroBlockDataSchema, type HeroBlockData } from "@repo/types";
import type { z } from "zod";

import { ArrayItemControls, CtaListField, IconKeySelect } from "./shared-fields";
import { ImageKeyField } from "./image-key-field";

export type HeroFormValues = z.input<typeof HeroBlockDataSchema>;

export interface BlockFieldsProps {
  control: Control<HeroFormValues>;
  register: UseFormRegister<HeroFormValues>;
  errors: FieldErrors<HeroFormValues>;
  watch: UseFormWatch<HeroFormValues>;
  setValue: UseFormSetValue<HeroFormValues>;
}

export function HeroFields({ control, register, errors, watch, setValue }: BlockFieldsProps): React.JSX.Element {
  const variant = watch("variant");
  const trustBadge = watch("trustBadge");
  const flankingPhotos = useFieldArray({ control, name: "flankingPhotos" });
  const infoCards = useFieldArray({ control, name: "infoCards" });

  return (
    <div className="flex flex-col gap-3">
      <Controller
        control={control}
        name="variant"
        render={({ field }) => (
          <Select label="Layout" value={field.value} onValueChange={field.onChange} data-testid="hero-variant">
            <SelectItem value="centered">Centered</SelectItem>
            <SelectItem value="centered-with-flanking-photos">Centered with flanking photos</SelectItem>
            <SelectItem value="split-with-cards">Split with cards</SelectItem>
          </Select>
        )}
      />
      <Input
        label="Small label above the headline (optional)"
        {...register("eyebrow")}
        error={errors.eyebrow?.message}
        data-testid="hero-eyebrow"
      />
      <Input label="Headline" required {...register("headline")} error={errors.headline?.message} data-testid="hero-headline" />
      <Input
        label="Words to highlight in green (optional)"
        helperText="Copy the exact words from the headline you want colored."
        {...register("headlineHighlight")}
        error={errors.headlineHighlight?.message}
        data-testid="hero-headline-highlight"
      />
      <Input
        label="Subheadline"
        {...register("subheadline")}
        error={errors.subheadline?.message}
        data-testid="hero-subheadline"
      />
      <ImageKeyField
        watchedValue={watch("backgroundImageKey")}
        registered={register("backgroundImageKey")}
        error={errors.backgroundImageKey?.message}
        testId="hero-background-image-key"
        onUploadedKey={(key) => setValue("backgroundImageKey", key, { shouldDirty: true, shouldValidate: true })}
      />

      <fieldset className="flex flex-col gap-2 rounded-md border border-dashed border-border p-3">
        <div className="flex items-center justify-between">
          <legend className="px-1 text-xs font-medium text-fg-muted">Trust badge (optional)</legend>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              setValue("trustBadge", trustBadge ? undefined : { ratingStars: 5, caption: "" }, { shouldValidate: true })
            }
            data-testid="hero-trust-badge-toggle"
          >
            {trustBadge ? "Remove" : "+ Add"}
          </Button>
        </div>
        {trustBadge ? (
          <div className="grid grid-cols-2 gap-2">
            <Input
              label="Rating stars (1-5)"
              type="number"
              min={1}
              max={5}
              {...register("trustBadge.ratingStars", { valueAsNumber: true })}
              error={errors.trustBadge?.ratingStars?.message}
              data-testid="hero-trust-badge-stars"
            />
            <Input
              label="Caption"
              {...register("trustBadge.caption")}
              error={errors.trustBadge?.caption?.message}
              data-testid="hero-trust-badge-caption"
            />
          </div>
        ) : null}
      </fieldset>

      {variant === "centered-with-flanking-photos" ? (
        <fieldset className="flex flex-col gap-2 rounded-md border border-dashed border-border p-3">
          <div className="flex items-center justify-between">
            <legend className="px-1 text-xs font-medium text-fg-muted">Flanking photos ({flankingPhotos.fields.length}/2)</legend>
            {flankingPhotos.fields.length < 2 ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => flankingPhotos.append({ imageKey: "", statValue: "", statLabel: "", statIconKey: "check" })}
                data-testid="hero-flanking-photo-add"
              >
                + Add photo
              </Button>
            ) : null}
          </div>
          {flankingPhotos.fields.map((field, index) => (
            <div key={field.id} className="flex flex-col gap-2 rounded border border-border p-2">
              <div className="grid grid-cols-2 gap-2">
                <ImageKeyField
                  watchedValue={watch(`flankingPhotos.${index}.imageKey`)}
                  registered={register(`flankingPhotos.${index}.imageKey`)}
                  error={errors.flankingPhotos?.[index]?.imageKey?.message}
                  testId={`hero-flanking-photo-${index}-image-key`}
                  onUploadedKey={(key) =>
                    setValue(`flankingPhotos.${index}.imageKey`, key, { shouldDirty: true, shouldValidate: true })
                  }
                />
                <IconKeySelect control={control} name={`flankingPhotos.${index}.statIconKey`} label="Stat icon" testId={`hero-flanking-photo-${index}-icon`} />
                <Input
                  label="Stat value"
                  {...register(`flankingPhotos.${index}.statValue`)}
                  error={errors.flankingPhotos?.[index]?.statValue?.message}
                  data-testid={`hero-flanking-photo-${index}-stat-value`}
                />
                <Input
                  label="Stat label"
                  {...register(`flankingPhotos.${index}.statLabel`)}
                  error={errors.flankingPhotos?.[index]?.statLabel?.message}
                  data-testid={`hero-flanking-photo-${index}-stat-label`}
                />
              </div>
              <ArrayItemControls
                index={index}
                count={flankingPhotos.fields.length}
                onMoveUp={() => flankingPhotos.move(index, index - 1)}
                onMoveDown={() => flankingPhotos.move(index, index + 1)}
                onRemove={() => flankingPhotos.remove(index)}
                itemLabel={`flanking photo ${index + 1}`}
                testIdPrefix="hero-flanking-photo"
              />
            </div>
          ))}
        </fieldset>
      ) : null}

      {variant === "split-with-cards" ? (
        <fieldset className="flex flex-col gap-2 rounded-md border border-dashed border-border p-3">
          <legend className="px-1 text-xs font-medium text-fg-muted">Split-with-cards options</legend>
          <ImageKeyField
            label="Center image"
            required
            watchedValue={watch("centerImageKey")}
            registered={register("centerImageKey")}
            error={errors.centerImageKey?.message}
            testId="hero-center-image-key"
            onUploadedKey={(key) => setValue("centerImageKey", key, { shouldDirty: true, shouldValidate: true })}
          />
          <Input label="Watermark text" {...register("watermarkText")} error={errors.watermarkText?.message} data-testid="hero-watermark-text" />
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-fg-muted">Info cards ({infoCards.fields.length}/2)</p>
            {infoCards.fields.length < 2 ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => infoCards.append({ bodyText: "", emphasis: false })}
                data-testid="hero-info-card-add"
              >
                + Add card
              </Button>
            ) : null}
          </div>
          {infoCards.fields.map((field, index) => (
            <div key={field.id} className="flex items-end gap-2 rounded border border-border p-2">
              <Input
                label="Body text"
                {...register(`infoCards.${index}.bodyText`)}
                error={errors.infoCards?.[index]?.bodyText?.message}
                wrapperClassName="flex-1"
                data-testid={`hero-info-card-${index}-body`}
              />
              <label className="flex items-center gap-1.5 pb-2 text-sm text-fg">
                <input type="checkbox" {...register(`infoCards.${index}.emphasis`)} data-testid={`hero-info-card-${index}-emphasis`} />
                Emphasis
              </label>
              <ArrayItemControls
                index={index}
                count={infoCards.fields.length}
                onMoveUp={() => infoCards.move(index, index - 1)}
                onMoveDown={() => infoCards.move(index, index + 1)}
                onRemove={() => infoCards.remove(index)}
                itemLabel={`info card ${index + 1}`}
                testIdPrefix="hero-info-card"
              />
            </div>
          ))}
        </fieldset>
      ) : null}

      <CtaListField control={control} register={register} errors={errors} name="ctas" max={2} />
    </div>
  );
}

export type { HeroBlockData };
