// Optional `heading` sub-shape shared by `stat_group`, `feature_grid`, `numbered_steps`
// (with-eyebrow variant), `faq`, `live_collection_ref` (simple variant), `media_gallery`,
// `job_openings` (minimal variant) — docs/specs/phase-10-page-builder.md "Shared conventions".
// `heading` itself is OPTIONAL on the block (spec: "omitted on inline bands"); this renders
// an add/remove toggle around the field set rather than always requiring it.
import * as React from "react";
import type { Control, FieldErrors, FieldValues, Path, UseFormRegister, UseFormSetValue, UseFormWatch } from "react-hook-form";
import { Button, Input } from "@repo/ui";

export type HeadingFieldsVariant = "with-eyebrow" | "simple" | "minimal";

export function OptionalHeadingFields<TForm extends FieldValues>({
  control: _control,
  register,
  errors,
  watch,
  setValue,
  variant,
  testIdPrefix,
}: {
  control: Control<TForm>;
  register: UseFormRegister<TForm>;
  errors: FieldErrors<TForm>;
  watch: UseFormWatch<TForm>;
  setValue: UseFormSetValue<TForm>;
  variant: HeadingFieldsVariant;
  testIdPrefix: string;
}): React.JSX.Element {
  const heading = watch("heading" as Path<TForm>) as Record<string, unknown> | undefined;
  const headingErrors = (errors as Record<string, unknown>).heading as
    | { eyebrow?: { message?: string }; title?: { message?: string }; titleHighlight?: { message?: string }; subtitle?: { message?: string } }
    | undefined;

  if (!heading) {
    return (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() =>
          setValue(
            "heading" as Path<TForm>,
            { title: "", ...(variant === "with-eyebrow" ? { eyebrow: "" } : {}) } as never,
            { shouldValidate: true },
          )
        }
        data-testid={`${testIdPrefix}-add-heading`}
      >
        + Add heading
      </Button>
    );
  }

  return (
    <fieldset className="flex flex-col gap-2 rounded-md border border-dashed border-border p-3">
      <div className="flex items-center justify-between">
        <legend className="px-1 text-xs font-medium text-fg-muted">Heading</legend>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setValue("heading" as Path<TForm>, undefined as never, { shouldValidate: true })}
          data-testid={`${testIdPrefix}-remove-heading`}
        >
          Remove heading
        </Button>
      </div>
      {variant === "with-eyebrow" ? (
        <Input
          label="Small label above the title (optional)"
          {...register("heading.eyebrow" as Path<TForm>)}
          error={headingErrors?.eyebrow?.message}
          data-testid={`${testIdPrefix}-heading-eyebrow`}
        />
      ) : null}
      <Input
        label="Title"
        required
        {...register("heading.title" as Path<TForm>)}
        error={headingErrors?.title?.message}
        data-testid={`${testIdPrefix}-heading-title`}
      />
      {variant !== "minimal" ? (
        <Input
          label="Words to highlight in green (optional)"
          helperText="Copy the exact words from the title above you want colored."
          {...register("heading.titleHighlight" as Path<TForm>)}
          error={headingErrors?.titleHighlight?.message}
          data-testid={`${testIdPrefix}-heading-highlight`}
        />
      ) : null}
      <Input
        label="Subtitle"
        {...register("heading.subtitle" as Path<TForm>)}
        error={headingErrors?.subtitle?.message}
        data-testid={`${testIdPrefix}-heading-subtitle`}
      />
    </fieldset>
  );
}
