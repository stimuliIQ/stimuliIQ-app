// Dispatches to the correct per-block-type field-form component (Phase-11 locked
// templates, docs/plans/phase-11-locked-templates.md P4 — the single per-block-type field
// renderer the template editor reuses; `template-section-card.tsx` owns exactly ONE
// `react-hook-form` instance per section whose resolver is picked from `section.dataSchema`
// — a single, registry-pinned schema, never a union — so by the time control reaches here
// there is exactly one concrete schema in play. RHF's generics can't express "the schema
// varies per rendered instance of this component" at compile time from a discriminated
// union member selected at runtime, so this file is the one controlled `any`-adjacent seam
// (CLAUDE.md §3.1: cast, not "no validation" — every field is still fully validated by the
// CONCRETE schema `template-section-card.tsx` gave `useForm`; this file only relaxes the TS
// view of that already-validated form back down to each per-type component's own
// strongly-typed props).
import * as React from "react";
import type { Control, FieldErrors, UseFormRegister, UseFormSetValue, UseFormWatch } from "react-hook-form";
import type { LiveCollectionRefBlockData, PageBuilderBlockType } from "@repo/types";

import { HeroFields } from "./hero-fields";
import { ContentSplitFields } from "./content-split-fields";
import { StatGroupFields } from "./stat-group-fields";
import { FeatureGridFields } from "./feature-grid-fields";
import { NumberedStepsFields } from "./numbered-steps-fields";
import { FaqFields } from "./faq-fields";
import { CtaBandFields } from "./cta-band-fields";
import { MediaGalleryFields } from "./media-gallery-fields";
import { JobOpeningsFields } from "./job-openings-fields";
import { LiveCollectionSectionFields } from "./live-collection-ref-fields";
import { BrainShowcaseFields } from "./brain-showcase-fields";

export interface GenericBlockFormApi {
  control: Control<Record<string, unknown>>;
  register: UseFormRegister<Record<string, unknown>>;
  errors: FieldErrors<Record<string, unknown>>;
  watch: UseFormWatch<Record<string, unknown>>;
  setValue: UseFormSetValue<Record<string, unknown>>;
}

export function BlockDataFields({
  type,
  form,
  liveCollection,
}: {
  type: PageBuilderBlockType;
  form: GenericBlockFormApi;
  /** Required (and only meaningful) when `type === "live_collection_ref"` — the fixed
   *  collection the owning template section is pinned to (page-templates.schemas.ts). */
  liveCollection?: LiveCollectionRefBlockData["collection"];
}): React.JSX.Element {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see file header.
  const typedForm = form as any;
  switch (type) {
    case "hero":
      return <HeroFields {...typedForm} />;
    case "content_split":
      return <ContentSplitFields {...typedForm} />;
    case "stat_group":
      return <StatGroupFields {...typedForm} />;
    case "feature_grid":
      return <FeatureGridFields {...typedForm} />;
    case "numbered_steps":
      return <NumberedStepsFields {...typedForm} />;
    case "faq":
      return <FaqFields {...typedForm} />;
    case "cta_band":
      return <CtaBandFields {...typedForm} />;
    case "media_gallery":
      return <MediaGalleryFields {...typedForm} />;
    case "job_openings":
      return <JobOpeningsFields {...typedForm} />;
    case "live_collection_ref":
      if (!liveCollection) {
        return (
          <p role="alert" className="text-sm text-danger">
            This section is missing its fixed collection, check page-templates.schemas.ts.
          </p>
        );
      }
      return <LiveCollectionSectionFields liveCollection={liveCollection} {...typedForm} />;
    case "brain_showcase":
      return <BrainShowcaseFields />;
    default:
      return (
        <p role="alert" className="text-sm text-danger">
          Unsupported block type &quot;{type}&quot;.
        </p>
      );
  }
}
