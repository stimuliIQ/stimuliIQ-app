// Create/Edit program drawer — RHF + zod resolver against
// CreateProgramRequestSchema/UpdateProgramRequestSchema (@repo/types).
// Money handling (CLAUDE.md §3.6): `pricePaise` is the wire/zod field
// (integer paise); the form collects/display a rupee value and converts at
// the boundary via lib/money.ts — the RHF state itself stays in rupees for a
// natural numeric input, converted to paise only in the submit handler.
import * as React from "react";
import { useForm } from "react-hook-form";
import { Button, Checkbox, Drawer, DrawerContent, DrawerBody, DrawerFooter, Input, Select, SelectItem, Textarea, useToast } from "@repo/ui";
import {
  CreateProgramRequestSchema,
  UpdateProgramRequestSchema,
  type CreateProgramRequest,
  type ProgramDetail,
  type ProgramLevel,
  type ProgramMode,
} from "@repo/types";

import { useCreateProgram, useUpdateProgram } from "../../hooks/use-courses";
import { apiClient } from "../../lib/api-client";
import { paiseToRupeeInput, rupeeInputToPaise } from "../../lib/money";
import { surfaceError } from "../../lib/surface-error";
import { ImageCropUpload } from "../shared/image-crop-upload";

/** Editable form fields — a zod issue on any of these maps to an inline error. */
const FORM_FIELDS = new Set([
  "slug",
  "title",
  "domain",
  "level",
  "mode",
  "durationWeeks",
  "priceRupees",
  "compareAtRupees",
  "summary",
  "cardSummary",
]);

const LEVELS: { value: ProgramLevel; label: string }[] = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
];

const MODES: { value: ProgramMode; label: string }[] = [
  { value: "live", label: "Live" },
  { value: "recorded", label: "Recorded" },
  { value: "hybrid", label: "Hybrid" },
];

interface ProgramFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  program?: ProgramDetail;
}

// RHF state form shape — same fields, but `priceRupees` instead of
// `pricePaise` (converted at submit), so the zod resolver only applies to
// the wire shape, not this presentation-only form shape. `outcomes` (textarea,
// one per line) and `ogImageKey` (upload component) live outside RHF.
type ProgramFormValues = Omit<
  CreateProgramRequest,
  | "pricePaise"
  | "compareAtPricePaise"
  | "emi"
  | "status"
  | "outcomes"
  | "ogImageKey"
  | "scholarshipAvailable"
> & {
  priceRupees: number;
  /** Blank / 0 = no strike-through price. Converted to `compareAtPricePaise` at submit. */
  compareAtRupees?: number;
};

/** Textarea (one outcome per line) → wire array; empty → undefined. */
function textToOutcomes(text: string): string[] | undefined {
  const lines = text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : undefined;
}

export function ProgramFormDrawer({ open, onOpenChange, program }: ProgramFormDrawerProps): React.JSX.Element {
  const isEdit = Boolean(program);
  const { toast } = useToast();
  const createProgram = useCreateProgram();
  const updateProgram = useUpdateProgram();

  const { register, handleSubmit, reset, watch, setValue, setError, formState } = useForm<ProgramFormValues>();
  const errors = formState.errors;

  // Marketing fields kept outside RHF: outcomes as raw textarea text (one per
  // line), the uploaded image key (undefined = unchanged, null = clear), and
  // the scholarship badge flag.
  const [outcomesText, setOutcomesText] = React.useState("");
  const [ogImageKey, setOgImageKey] = React.useState<string | null | undefined>(undefined);
  const [scholarshipAvailable, setScholarshipAvailable] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    if (isEdit && program) {
      reset({
        slug: program.slug,
        title: program.title,
        domain: program.domain,
        level: program.level,
        mode: program.mode,
        durationWeeks: program.durationWeeks,
        priceRupees: paiseToRupeeInput(program.pricePaise) ?? 0,
        compareAtRupees: paiseToRupeeInput(program.compareAtPricePaise ?? 0) ?? undefined,
        summary: program.summary ?? undefined,
        cardSummary: program.cardSummary ?? undefined,
      });
      setOutcomesText((program.outcomes ?? []).join("\n"));
      setOgImageKey(undefined); // undefined = keep the existing image unless changed
      setScholarshipAvailable(program.scholarshipAvailable);
    } else {
      reset({ priceRupees: 0 });
      setOutcomesText("");
      setOgImageKey(undefined);
      setScholarshipAvailable(false);
    }
    // Intentionally reset only on open/identity change, not on every render.
  }, [open, isEdit, program]);

  const isPending = createProgram.isPending || updateProgram.isPending;

  const onSubmit = handleSubmit(async (values) => {
    const { priceRupees, compareAtRupees, ...rest } = values;
    const pricePaise = rupeeInputToPaise(priceRupees);
    // Blank or 0 means "no strike-through" — send null so the column is cleared, not 0
    // (0 would fail the API's must-be-above-price check and block the save).
    const compareAtPricePaise =
      compareAtRupees == null || Number.isNaN(compareAtRupees) || compareAtRupees <= 0
        ? null
        : rupeeInputToPaise(compareAtRupees);

    // Map zod validation issues to INLINE field errors (never a raw JSON toast).
    // `pricePaise` lives in the form as `priceRupees`; wire-only keys (emi/status)
    // have no field and are skipped.
    const applyIssues = (issues: { path: (string | number)[]; message: string }[]) => {
      for (const issue of issues) {
        const key = String(issue.path[0] ?? "");
        const field =
          key === "pricePaise" ? "priceRupees" : key === "compareAtPricePaise" ? "compareAtRupees" : key;
        if (FORM_FIELDS.has(field)) {
          setError(field as keyof ProgramFormValues, { message: issue.message });
        }
      }
      toast({
        title: isEdit ? "Couldn't update program" : "Couldn't create program",
        description: "Please fix the highlighted fields and try again.",
        variant: "destructive",
      });
    };

    // Shared marketing-field payload: blank cardSummary → undefined; outcomes
    // textarea → array; ogImageKey undefined = unchanged (edit) / absent (create).
    const marketing = {
      cardSummary: rest.cardSummary?.trim() ? rest.cardSummary.trim() : undefined,
      outcomes: textToOutcomes(outcomesText),
      scholarshipAvailable,
    };

    try {
      if (isEdit && program) {
        const parsed = UpdateProgramRequestSchema.safeParse({
          ...rest,
          ...marketing,
          pricePaise,
          compareAtPricePaise,
          ...(ogImageKey !== undefined ? { ogImageKey } : {}),
        });
        if (!parsed.success) return applyIssues(parsed.error.issues);
        await updateProgram.mutateAsync({ id: program.id, body: parsed.data });
        toast({ title: "Program updated", variant: "success" });
      } else {
        const parsed = CreateProgramRequestSchema.safeParse({
          ...rest,
          ...marketing,
          pricePaise,
          compareAtPricePaise,
          emi: [],
          status: "draft",
          // Create's ogImageKey is optional-not-nullable: null (removed) → absent.
          ...(ogImageKey ? { ogImageKey } : {}),
        });
        if (!parsed.success) return applyIssues(parsed.error.issues);
        await createProgram.mutateAsync(parsed.data);
        toast({ title: "Program created", variant: "success" });
      }
      onOpenChange(false);
    } catch (error) {
      // Server-side failure — surface a clean Problem Details message, never raw JSON.
      surfaceError(toast, error, isEdit ? "Couldn't update program" : "Couldn't create program");
    }
  });

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent position="center"
        title={isEdit ? "Edit program" : "Add program"}
        description={isEdit ? program?.title : "Pricing is editable here; coupons/EMI flows land in Phase 2."}
        data-testid={isEdit ? "program-edit-drawer" : "program-create-drawer"}
      >
        <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
          <DrawerBody className="flex flex-col gap-4">
            <Input
              label="Slug"
              required
              placeholder="e.g. full-stack-web-dev"
              helperText="Lowercase kebab-case, e.g. full-stack-web-dev"
              {...register("slug")}
              error={errors.slug?.message}
              data-testid="program-form-slug"
            />
            <Input label="Title" required placeholder="e.g. Full Stack Web Development" {...register("title")} error={errors.title?.message} data-testid="program-form-title" />
            <Input label="Domain" required placeholder="e.g. web-development" {...register("domain")} error={errors.domain?.message} data-testid="program-form-domain" />
            <Select
              label="Level"
              required
              placeholder="Select a level"
              value={watch("level")}
              onValueChange={(value) => setValue("level", value as ProgramLevel)}
              error={errors.level?.message}
              data-testid="program-form-level"
            >
              {LEVELS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </Select>
            <Select
              label="Mode"
              required
              placeholder="Select a mode"
              value={watch("mode")}
              onValueChange={(value) => setValue("mode", value as ProgramMode)}
              error={errors.mode?.message}
              data-testid="program-form-mode"
            >
              {MODES.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </Select>
            <Input
              label="Duration (weeks)"
              type="number"
              min={1}
              max={104}
              required
              placeholder="e.g. 12"
              {...register("durationWeeks", { valueAsNumber: true })}
              error={errors.durationWeeks?.message}
              data-testid="program-form-duration"
            />
            <Input
              label="Price (INR)"
              type="number"
              min={0}
              step="0.01"
              required
              placeholder="e.g. 49999"
              helperText="Stored as integer paise on the wire — entered here in rupees. This is what the student is charged."
              {...register("priceRupees", { valueAsNumber: true })}
              error={errors.priceRupees?.message}
              data-testid="program-form-price"
            />
            <Input
              label="Compare-at price (INR, optional)"
              type="number"
              min={0}
              step="0.01"
              placeholder="e.g. 14999"
              helperText="Shown struck through beside the price. Must be higher than the price. Leave blank for a single price."
              {...register("compareAtRupees", { valueAsNumber: true })}
              error={errors.compareAtRupees?.message}
              data-testid="program-form-compare-at-price"
            />
            <Input label="Summary" placeholder="Short summary shown on the program page…" {...register("summary")} data-testid="program-form-summary" />

            {/* ── Website marketing fields ── */}
            <ImageCropUpload
              label="Course image"
              helperText="16:9 card image shown on the website course cards, detail page, and link previews. JPG, PNG, or WebP · up to 5 MB."
              aspect={16 / 9}
              initialImageUrl={isEdit ? (program?.ogImageUrl ?? null) : null}
              getUploadUrl={(req) => apiClient.crm.courses.imageUploadUrl(req)}
              onChange={setOgImageKey}
              data-testid="program-form-image"
            />
            <Input
              label="Card summary"
              placeholder="One-line hook shown on the course card (max 200 chars)"
              {...register("cardSummary")}
              error={errors.cardSummary?.message}
              data-testid="program-form-card-summary"
            />
            <Textarea
              label="Learning outcomes"
              id="program-form-outcomes"
              rows={4}
              placeholder={"One outcome per line, e.g.\nBuild REST APIs with NestJS\nDeploy to AWS"}
              value={outcomesText}
              onChange={(e) => setOutcomesText(e.target.value)}
              data-testid="program-form-outcomes"
              helperText={"Shown as the \"What you'll learn\" bullets on the public course page."}
            />
            <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3">
              <Checkbox
                checked={scholarshipAvailable}
                onCheckedChange={(checked) => setScholarshipAvailable(checked === true)}
                data-testid="program-form-scholarship"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-fg">Scholarship available</span>
                <span className="text-xs text-fg-muted">
                  Shows a &quot;Scholarship available&quot; badge on the website course card and detail page.
                </span>
              </span>
            </label>
          </DrawerBody>
          <DrawerFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} data-testid="program-form-cancel">
              Cancel
            </Button>
            <Button type="submit" loading={isPending} data-testid="program-form-submit">
              {isEdit ? "Save changes" : "Create program"}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
