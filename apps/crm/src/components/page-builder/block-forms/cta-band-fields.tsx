// `cta_band` block fields (docs/specs/phase-10-page-builder.md block #7).
import * as React from "react";
import type { Control, FieldErrors, UseFormRegister, UseFormSetValue, UseFormWatch } from "react-hook-form";
import { Controller } from "react-hook-form";
import { Button, Checkbox, Input, Select, SelectItem } from "@repo/ui";
import { CtaBandBlockDataSchema, type CtaBandBlockData, type CtaBandLeadFormField } from "@repo/types";
import type { z } from "zod";

import { CtaListField } from "./shared-fields";

export type CtaBandFormValues = z.input<typeof CtaBandBlockDataSchema>;

export interface BlockFieldsProps {
  control: Control<CtaBandFormValues>;
  register: UseFormRegister<CtaBandFormValues>;
  errors: FieldErrors<CtaBandFormValues>;
  watch: UseFormWatch<CtaBandFormValues>;
  setValue: UseFormSetValue<CtaBandFormValues>;
}

const LEAD_FORM_FIELD_OPTIONS: { value: CtaBandLeadFormField; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
];

export function CtaBandFields({ control, register, errors, watch, setValue }: BlockFieldsProps): React.JSX.Element {
  const leadForm = watch("leadForm");
  const leadFormFields = leadForm?.fields ?? [];

  function toggleLeadFormField(field: CtaBandLeadFormField, checked: boolean) {
    const next = checked ? [...leadFormFields, field] : leadFormFields.filter((f) => f !== field);
    setValue("leadForm.fields", next, { shouldValidate: true });
  }

  return (
    <div className="flex flex-col gap-3">
      <Input label="Heading" required {...register("heading")} error={errors.heading?.message} data-testid="cta-band-heading" />
      <Input
        label="Words to highlight in green (optional)"
        helperText="Copy the exact words from the heading you want colored."
        {...register("headingHighlight")}
        error={errors.headingHighlight?.message}
        data-testid="cta-band-heading-highlight"
      />
      <Input label="Subheading" {...register("subheading")} error={errors.subheading?.message} data-testid="cta-band-subheading" />
      <Controller
        control={control}
        name="background"
        render={({ field }) => (
          <Select label="Background" value={field.value ?? "default"} onValueChange={field.onChange} data-testid="cta-band-background">
            <SelectItem value="default">Default</SelectItem>
            <SelectItem value="surface">Surface</SelectItem>
            <SelectItem value="brand">Brand</SelectItem>
          </Select>
        )}
      />

      <CtaListField control={control} register={register} errors={errors} name="buttons" max={3} addLabel="Add button" />

      <fieldset className="flex flex-col gap-2 rounded-md border border-dashed border-border p-3">
        <div className="flex items-center justify-between">
          <legend className="px-1 text-xs font-medium text-fg-muted">Inline lead form (optional)</legend>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              setValue(
                "leadForm",
                leadForm ? undefined : { source: "cta_band", heading: "", subheading: "", fields: ["name", "phone"], submitLabel: "Submit" },
                { shouldValidate: true },
              )
            }
            data-testid="cta-band-lead-form-toggle"
          >
            {leadForm ? "Remove" : "+ Add lead form"}
          </Button>
        </div>
        {leadForm ? (
          <div className="flex flex-col gap-2">
            <Input label="Source tag" helperText={'Internal attribution tag, e.g. "homepage_cta".'} {...register("leadForm.source")} error={errors.leadForm?.source?.message} data-testid="cta-band-lead-form-source" />
            <Input label="Form heading" {...register("leadForm.heading")} error={errors.leadForm?.heading?.message} data-testid="cta-band-lead-form-heading" />
            <Input label="Form subheading" {...register("leadForm.subheading")} error={errors.leadForm?.subheading?.message} data-testid="cta-band-lead-form-subheading" />
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-medium text-fg">Fields collected</p>
              <div className="flex gap-4">
                {LEAD_FORM_FIELD_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-1.5 text-sm text-fg">
                    <Checkbox
                      checked={leadFormFields.includes(opt.value)}
                      onCheckedChange={(checked) => toggleLeadFormField(opt.value, checked === true)}
                      data-testid={`cta-band-lead-form-field-${opt.value}`}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
              {errors.leadForm?.fields?.message ? (
                <p role="alert" className="text-sm text-danger">
                  {errors.leadForm.fields.message}
                </p>
              ) : null}
            </div>
            <Input label="Submit button label" {...register("leadForm.submitLabel")} error={errors.leadForm?.submitLabel?.message} data-testid="cta-band-lead-form-submit-label" />
          </div>
        ) : null}
      </fieldset>
    </div>
  );
}

export type { CtaBandBlockData };
