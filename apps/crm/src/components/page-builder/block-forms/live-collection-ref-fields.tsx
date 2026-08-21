// Simplified `live_collection_ref` fields for LOCKED TEMPLATE sections (Phase-11 locked
// templates, docs/plans/phase-11-locked-templates.md P4 — supersedes the free block-
// builder's generic reference-block editor, which let staff repoint a block at any
// collection and hand-tune its filter/selection criteria). A locked-template
// `live_collection_ref` SECTION is pinned to exactly one collection (`liveCollection`,
// fixed by the template registry, page-templates.schemas.ts) — staff can never repoint it,
// and the underlying ITEMS are never hand-entered here: they come from that collection's
// own CRM list (Colleges/Mentors/Courses/Testimonials). This component only renders the
// section's own display fields (heading/subtitle, "view all" link, layout) plus a
// read-only pointer to where the items actually live. `collection` and `selection`
// (per-collection filter/sort criteria) are left OUT of this form entirely — they stay in
// the section's react-hook-form `defaultValues` untouched and round-trip on save exactly
// as loaded (see page-builder-editor.tsx's merge step, lib/page-template-sections.ts).
import * as React from "react";
import { Link } from "@tanstack/react-router";
import type { Control, FieldErrors, UseFormRegister, UseFormSetValue, UseFormWatch } from "react-hook-form";
import { Controller } from "react-hook-form";
import { Input, Select, SelectItem } from "@repo/ui";
import { LiveCollectionRefBlockDataSchema, type LiveCollectionRefBlockData } from "@repo/types";
import type { z } from "zod";

import { OptionalHeadingFields } from "./heading-fields";

export type LiveCollectionRefFormValues = z.input<typeof LiveCollectionRefBlockDataSchema>;

export interface LiveCollectionSectionFieldsProps {
  /** The collection this section is permanently pinned to (page-templates.schemas.ts). */
  liveCollection: LiveCollectionRefBlockData["collection"];
  control: Control<LiveCollectionRefFormValues>;
  register: UseFormRegister<LiveCollectionRefFormValues>;
  errors: FieldErrors<LiveCollectionRefFormValues>;
  watch: UseFormWatch<LiveCollectionRefFormValues>;
  setValue: UseFormSetValue<LiveCollectionRefFormValues>;
}

/** Where staff actually manage this collection's items — every `partners`-collection
 *  section in the locked-template registry is one of the "Partner Colleges" sections
 *  (home/`for-colleges`), never the generic hiring/tech Partners screen, so this maps to
 *  the dedicated Colleges screen (docs/plans/phase-11-locked-templates.md). */
const MANAGE_LINK: Record<LiveCollectionRefBlockData["collection"], { label: string; to: string }> = {
  // "Reviews" is the CRM's name for these; the underlying collection/model is still
  // `testimonials` (see reviews screen header). The link was left pointing at the Blog CMS
  // tab strip after they were promoted to their own screen, so it sent staff somewhere the
  // items are no longer editable.
  testimonials: { label: "Reviews", to: "/marketing/testimonials" },
  partners: { label: "Colleges", to: "/marketing/colleges" },
  programs: { label: "Courses", to: "/courses" },
  mentors: { label: "Mentors", to: "/mentors" },
};

export function LiveCollectionSectionFields({
  liveCollection,
  control,
  register,
  errors,
  watch,
  setValue,
}: LiveCollectionSectionFieldsProps): React.JSX.Element {
  const manage = MANAGE_LINK[liveCollection];

  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-md bg-surface px-3 py-2 text-sm text-fg-muted" data-testid="live-collection-section-note">
        This section fills in automatically from{" "}
        <Link to={manage.to} className="font-medium text-brand-500 hover:underline">
          {manage.label}
        </Link>
        . Add, edit, or remove the items there. You can only edit the heading and layout below.
      </p>
      <OptionalHeadingFields
        control={control}
        register={register}
        errors={errors}
        watch={watch}
        setValue={setValue}
        variant="simple"
        testIdPrefix="live-collection-section"
      />
      <Input
        label={'"View all" link (optional)'}
        {...register("viewAllHref")}
        error={errors.viewAllHref?.message}
        data-testid="live-collection-section-view-all-href"
      />
      <Controller
        control={control}
        name="layout"
        render={({ field }) => (
          <Select label="Layout" value={field.value} onValueChange={field.onChange} data-testid="live-collection-section-layout">
            <SelectItem value="grid-3">Grid (3 columns)</SelectItem>
            <SelectItem value="grid-4">Grid (4 columns)</SelectItem>
            <SelectItem value="logo-wall">Logo wall</SelectItem>
          </Select>
        )}
      />
    </div>
  );
}

export type { LiveCollectionRefBlockData };
