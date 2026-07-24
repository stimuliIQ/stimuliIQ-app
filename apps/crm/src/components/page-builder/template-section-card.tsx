// One locked-template section's card in the page-builder editor (Phase-11 locked
// templates, docs/plans/phase-11-locked-templates.md P4 — replaces the removed
// `block-card.tsx`). Reuses the SAME per-block-type field renderers the free block-builder
// used (`BlockDataFields`, block-forms/index.tsx) — only the CHROME differs: no drag
// handle, no move/remove buttons, no "Unsupported block" branch (every section's
// `blockType` is a known, registry-pinned value by construction — `page-templates.
// schemas.ts` can never emit an unrecognized type). Each section owns its own
// react-hook-form instance, resolved against `section.dataSchema` — the EXACT schema
// instance the template registry pins to this section, never re-derived — and reports its
// live values/validity up to the parent editor via `registerFormApi`/`onValidityChange`/
// `onDirtyChange`, mirroring the removed block-card.tsx's approach so the parent editor's
// Save/Preview/dirty-guard logic barely had to change shape.
import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle } from "lucide-react";
import { CollapsibleSection, StatusChip } from "@repo/ui";
import type { PageTemplateSectionDescriptor } from "@repo/types";

import { BLOCK_CATEGORY_ACCENT_TONE, BLOCK_TYPE_META, blockContentExcerpt } from "../../lib/page-builder-block-meta";
import { cleanEmptyStrings } from "../../lib/clean-empty-strings";
import { BlockDataFields } from "./block-forms";

export interface TemplateSectionFormApi {
  getValues: () => Record<string, unknown>;
  trigger: () => Promise<boolean>;
}

export interface TemplateSectionCardProps {
  section: PageTemplateSectionDescriptor;
  /** This section's current (already schema-merged, see lib/page-template-sections.ts)
   *  `data` — used only as the form's initial `defaultValues`; every subsequent read goes
   *  through the registered `getValues()`. */
  data: unknown;
  index: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  registerFormApi: (key: string, api: TemplateSectionFormApi | null) => void;
  onValidityChange: (key: string, valid: boolean) => void;
  onDirtyChange?: (key: string, dirty: boolean) => void;
}

export function TemplateSectionCard({
  section,
  data,
  index,
  open,
  onOpenChange,
  registerFormApi,
  onValidityChange,
  onDirtyChange,
}: TemplateSectionCardProps): React.JSX.Element {
  const meta = BLOCK_TYPE_META[section.blockType];
  const Icon = meta.icon;
  const key = section.key;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- zodResolver's generic can't vary per rendered instance from a registry-selected schema (mirrors the removed block-card.tsx's identical seam).
  const baseResolver = React.useMemo(() => zodResolver(section.dataSchema as any), [section.dataSchema]);

  const form = useForm<Record<string, unknown>>({
    // See block-forms/index.tsx header — the schema is the single concrete instance this
    // template section is pinned to.
    //
    // Wrapped (not passed straight through) to normalize `""` -> `undefined` (untouched
    // optional TEXT field) and `NaN` -> `undefined` (untouched optional NUMBER field)
    // before validating — see lib/clean-empty-strings.ts header for the full rationale
    // (identical to the removed block-card.tsx's reasoning).
    resolver: (values, context, options) => baseResolver(cleanEmptyStrings(values), context, options),
    defaultValues: data as Record<string, unknown>,
    mode: "onChange",
  });

  const {
    control,
    register,
    watch,
    setValue,
    getValues,
    trigger,
    formState: { errors, isValid, isDirty },
  } = form;

  React.useEffect(() => {
    registerFormApi(key, { getValues: () => cleanEmptyStrings(getValues()), trigger });
    return () => registerFormApi(key, null);
    // getValues/trigger are stable per form instance; intentionally re-running per `key` change only.
  }, [key]);

  React.useEffect(() => {
    onValidityChange(key, isValid);
  }, [key, isValid, onValidityChange]);

  React.useEffect(() => {
    onDirtyChange?.(key, isDirty);
  }, [key, isDirty, onDirtyChange]);

  // Subscribes to every field on this section's own (isolated) form instance — re-renders
  // only THIS card, and is what makes the collapsed-row excerpt live-update as the author
  // types (mirrors the removed block-card.tsx's identical behavior).
  const liveValues = watch();
  const excerpt = blockContentExcerpt(section.blockType, liveValues as Record<string, unknown>);

  return (
    <div data-testid={`page-builder-section-card-${index}`}>
      <CollapsibleSection
        open={open}
        onOpenChange={onOpenChange}
        icon={<Icon aria-hidden="true" />}
        accentTone={BLOCK_CATEGORY_ACCENT_TONE[meta.category]}
        data-testid={`page-builder-section-collapsible-${index}`}
        header={
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="shrink-0 text-sm font-medium text-fg" data-testid={`page-builder-section-title-${index}`}>
              {index + 1}. {section.label}
            </span>
            <span
              className={`truncate text-sm ${excerpt.placeholder ? "italic text-fg-subtle" : "text-fg-muted"}`}
              data-testid={`page-builder-section-excerpt-${index}`}
            >
              {excerpt.text}
            </span>
          </span>
        }
        headerActions={
          !isValid ? (
            <StatusChip
              tone="danger"
              label="Needs attention"
              icon={<AlertTriangle className="size-3" aria-hidden="true" />}
              data-testid={`page-builder-section-invalid-${index}`}
            />
          ) : null
        }
      >
        <BlockDataFields type={section.blockType} form={{ control, register, errors, watch, setValue }} liveCollection={section.liveCollection} />
      </CollapsibleSection>
    </div>
  );
}
