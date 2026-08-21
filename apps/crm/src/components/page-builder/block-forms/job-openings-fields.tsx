// `job_openings` block fields — the Open Roles section of the careers page.
//
// THERE IS NO ROLE EDITOR HERE ANY MORE, and its absence is the point. This form used to
// carry an add/remove/reorder list of roles typed straight into the page. Openings are now
// CRM rows (Careers ▸ Openings, ADR-0066) resolved live at render time, so those fields
// would have been controls that look like they publish a job and in fact do nothing — the
// exact "save does nothing" trap that got `stats.headline` deleted in P10-2. Removing them
// is what keeps the legacy `items` field in @repo/types honest: it is tolerated in stored
// data so old page versions still parse, and no human can write to it.
//
// What remains is what genuinely belongs to the PAGE rather than to the roles: the section
// heading, and the line shown when nothing is open.
import * as React from "react";
import { Link } from "@tanstack/react-router";
import type { Control, FieldErrors, UseFormRegister, UseFormSetValue, UseFormWatch } from "react-hook-form";
import { Callout, Input } from "@repo/ui";

import { JobOpeningsBlockDataSchema, type JobOpeningsBlockData } from "@repo/types";
import type { z } from "zod";

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
  return (
    <div className="flex flex-col gap-3">
      <OptionalHeadingFields
        control={control}
        register={register}
        errors={errors}
        watch={watch}
        setValue={setValue}
        variant="minimal"
        testIdPrefix="job-openings"
      />

      <Callout tone="info" data-testid="job-openings-managed-elsewhere">
        The roles themselves live in{" "}
        <Link to="/careers/openings" className="font-medium underline underline-offset-2">
          Careers ▸ Openings
        </Link>
        . Publishing an opening there puts it on this page straight away, there is nothing to
        save here for it.
      </Callout>

      <Input
        label="Shown when no roles are open"
        required
        {...register("emptyStateMessage")}
        error={errors.emptyStateMessage?.message}
        helperText="Visitors see this line whenever every opening is closed or lapsed."
        data-testid="job-openings-empty-message"
      />
    </div>
  );
}

export type { JobOpeningsBlockData };
