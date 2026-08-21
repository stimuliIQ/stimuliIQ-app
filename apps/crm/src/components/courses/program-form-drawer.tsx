// Create/Edit program drawer — RHF + zod resolver against
// CreateProgramRequestSchema/UpdateProgramRequestSchema (@repo/types).
// Money handling (CLAUDE.md §3.6): `pricePaise` is the wire/zod field
// (integer paise); the form collects/display a rupee value and converts at
// the boundary via lib/money.ts — the RHF state itself stays in rupees for a
// natural numeric input, converted to paise only in the submit handler.
import * as React from "react";
import { useForm } from "react-hook-form";
import {
  BADGE_COLOR_PRESETS,
  Button,
  Checkbox,
  Drawer,
  DrawerContent,
  DrawerBody,
  DrawerFooter,
  FileUpload,
  Input,
  Select,
  SelectItem,
  Switch,
  Textarea,
  badgeContrastRatio,
  isValidBadgeColor,
  readableTextOn,
  useToast,
  type SignedUploadResult,
} from "@repo/ui";
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
// one per line) and the upload keys (`ogImageKey`, `brochureKey`) live outside RHF.
type ProgramFormValues = Omit<
  CreateProgramRequest,
  | "pricePaise"
  | "compareAtPricePaise"
  | "emi"
  | "status"
  | "outcomes"
  | "ogImageKey"
  | "brochureKey"
  | "scholarshipAvailable"
> & {
  priceRupees: number;
  /** Blank / 0 = no strike-through price. Converted to `compareAtPricePaise` at submit. */
  compareAtRupees?: number;
};

/** Max brochure size — mirrors ProgramBrochureUploadUrlRequestSchema's server ceiling. */
const BROCHURE_MAX_BYTES = 20 * 1024 * 1024;

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
  // Brochure PDF: same three-state convention as the image key —
  // undefined = leave as-is, a string = newly uploaded, null = remove on save.
  const [brochureKey, setBrochureKey] = React.useState<string | null | undefined>(undefined);
  const [scholarshipAvailable, setScholarshipAvailable] = React.useState(false);
  // Marketing badge. Both the text and the colour are staff-authored — the swatches below
  // are shortcuts that fill these in, not a stored choice. Empty colour = never configured.
  const [badgeColor, setBadgeColor] = React.useState("");
  const [badgeLabel, setBadgeLabel] = React.useState("");
  const [badgeEnabled, setBadgeEnabled] = React.useState(false);

  /**
   * Step 1 of the brochure ingest: mint the signed PUT for the picked file.
   * The type check is a client-side courtesy — the signed URL pins `application/pdf`
   * server-side, so a tampered client still can't upload something else.
   */
  async function requestBrochureUploadUrl(file: File): Promise<SignedUploadResult> {
    if (file.type !== "application/pdf") {
      throw new Error("Brochures must be PDF files.");
    }
    const signed = await apiClient.crm.courses.brochureUploadUrl({
      contentType: "application/pdf",
      fileName: file.name,
      sizeBytes: file.size,
    });
    // additionalHeaders are signed into the presigned PUT — forward them or S3/R2 403s.
    return { url: signed.uploadUrl, storageKey: signed.storageKey, headers: signed.additionalHeaders };
  }

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
      setBrochureKey(undefined); // undefined = keep the existing brochure unless changed
      setScholarshipAvailable(program.scholarshipAvailable);
      setBadgeColor(program.badgeColor ?? "");
      setBadgeLabel(program.badgeLabel ?? "");
      setBadgeEnabled(program.badgeEnabled);
    } else {
      reset({ priceRupees: 0 });
      setOutcomesText("");
      setOgImageKey(undefined);
      setBrochureKey(undefined);
      setScholarshipAvailable(false);
      setBadgeColor("");
      setBadgeLabel("");
      setBadgeEnabled(false);
    }
    // Intentionally reset only on open/identity change, not on every render.
  }, [open, isEdit, program]);

  const isPending = createProgram.isPending || updateProgram.isPending;

  // A badge that cannot render: no colour to draw, or no text to show. Mirrors the
  // server's assertBadgeConfigured so the toggle is unavailable rather than 422-ing.
  const badgeIncomplete = !isValidBadgeColor(badgeColor) || !badgeLabel.trim();

  // Clearing the text while the badge is live would otherwise leave a blank chip
  // staged for save; drop the toggle at the same moment the badge stops being renderable.
  React.useEffect(() => {
    if (badgeIncomplete && badgeEnabled) setBadgeEnabled(false);
  }, [badgeIncomplete, badgeEnabled]);

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
    // A half-typed hex is sent as null rather than as-is: the column would reject it, and
    // clearing matches what the staff member sees (the preview stops rendering).
    const marketing = {
      cardSummary: rest.cardSummary?.trim() ? rest.cardSummary.trim() : undefined,
      outcomes: textToOutcomes(outcomesText),
      scholarshipAvailable,
      badgeColor: isValidBadgeColor(badgeColor) ? badgeColor.toUpperCase() : null,
      badgeLabel: badgeLabel.trim() || null,
      badgeEnabled,
    };

    try {
      if (isEdit && program) {
        const parsed = UpdateProgramRequestSchema.safeParse({
          ...rest,
          ...marketing,
          pricePaise,
          compareAtPricePaise,
          ...(ogImageKey !== undefined ? { ogImageKey } : {}),
          ...(brochureKey !== undefined ? { brochureKey } : {}),
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
          // Create's ogImageKey/brochureKey are optional-not-nullable: null (removed) → absent.
          ...(ogImageKey ? { ogImageKey } : {}),
          ...(brochureKey ? { brochureKey } : {}),
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
              helperText="Stored as integer paise on the wire. Entered here in rupees. This is what the student is charged."
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
            {/* Course brochure (PDF) — surfaces as the "Download brochure" button on the
                public course page. Three states, mirroring the image upload: keep (no
                change), replace (a fresh upload), or remove (explicit null on save). */}
            <div className="flex flex-col gap-2" data-testid="program-form-brochure">
              <span className="text-sm font-medium text-fg">Course brochure (PDF)</span>
              <p className="text-xs text-fg-muted">
                Shown as a &quot;Download brochure&quot; button on the website course page so
                students can read the full details offline. PDF only · up to 20 MB.
              </p>

              {/* Existing brochure — only meaningful while nothing new has been picked. */}
              {isEdit && program?.brochureUrl && brochureKey === undefined ? (
                <div className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2">
                  <a
                    href={program.brochureUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 flex-1 truncate text-sm font-medium text-brand-500 hover:underline"
                    data-testid="program-form-brochure-current"
                  >
                    View current brochure
                  </a>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setBrochureKey(null)}
                    data-testid="program-form-brochure-remove"
                  >
                    Remove
                  </Button>
                </div>
              ) : null}

              {brochureKey === null ? (
                <p className="text-xs text-warning" data-testid="program-form-brochure-pending-removal">
                  The brochure will be removed when you save. Upload a new file below to keep one.
                </p>
              ) : null}

              <FileUpload
                requestUploadUrl={requestBrochureUploadUrl}
                onUploaded={(storageKey) => setBrochureKey(storageKey)}
                acceptedTypes={["application/pdf"]}
                maxBytes={BROCHURE_MAX_BYTES}
                label={isEdit && program?.brochureUrl ? "Replace brochure PDF" : "Upload brochure PDF"}
                data-testid="program-form-brochure-upload"
              />
            </div>

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

            <div className="flex flex-col gap-3 rounded-md border border-border p-3">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-fg">Badge</span>
                <span className="text-xs text-fg-muted">
                  Highlights this course on the website. Takes priority over the scholarship badge.
                </span>
              </div>

              <Input
                label="Badge text"
                id="program-form-badge-label"
                value={badgeLabel}
                onChange={(e) => setBadgeLabel(e.target.value)}
                maxLength={24}
                placeholder="e.g. Limited seats"
                data-testid="program-form-badge-label"
              />

              {/* Swatches are shortcuts, not a stored choice — each one fills in the colour
                  (and the text, while it is still blank) and is then indistinguishable from
                  a hand-picked colour. */}
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium text-fg">Badge colour</span>
                <div className="flex flex-wrap items-center gap-2">
                  {BADGE_COLOR_PRESETS.map((preset) => {
                    const selected = badgeColor.toUpperCase() === preset.color;
                    return (
                      <button
                        key={preset.color}
                        type="button"
                        onClick={() => {
                          setBadgeColor(preset.color);
                          // Only fill the text when the staff member has not written their
                          // own — a swatch must never overwrite typed copy.
                          if (!badgeLabel.trim()) setBadgeLabel(preset.label);
                        }}
                        // The ring (not just the fill) carries selection, so the state is
                        // visible on a colour close to the surrounding surface.
                        className={`h-8 rounded-full px-3 text-xs font-semibold ring-offset-2 ring-offset-surface transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          selected ? "ring-2 ring-fg" : "ring-1 ring-border"
                        }`}
                        style={{ backgroundColor: preset.color, color: readableTextOn(preset.color) }}
                        aria-pressed={selected}
                        data-testid={`program-form-badge-swatch-${preset.label.toLowerCase()}`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2">
                  {/* Native colour input: no new dependency, and it brings the OS picker
                      (eyedropper, recent colours) for free. It cannot express "unset",
                      so the text field beside it stays the source of truth. */}
                  <input
                    type="color"
                    value={isValidBadgeColor(badgeColor) ? badgeColor : "#DC2626"}
                    onChange={(e) => setBadgeColor(e.target.value.toUpperCase())}
                    className="h-9 w-12 cursor-pointer rounded border border-border bg-surface p-1"
                    aria-label="Pick a custom badge colour"
                    data-testid="program-form-badge-color-picker"
                  />
                  <Input
                    id="program-form-badge-color-hex"
                    aria-label="Badge colour hex code"
                    value={badgeColor}
                    onChange={(e) => {
                      // Accept a pasted value with or without the leading #, so copying a
                      // hex out of a brand doc just works.
                      const raw = e.target.value.trim().replace(/^#?/, "");
                      setBadgeColor(raw ? `#${raw.toUpperCase()}` : "");
                    }}
                    maxLength={7}
                    placeholder="#DC2626"
                    className="font-mono"
                    data-testid="program-form-badge-color-hex"
                  />
                  {badgeColor && !isValidBadgeColor(badgeColor) ? (
                    <span className="text-xs text-danger" data-testid="program-form-badge-color-error">
                      Needs 6 hex digits
                    </span>
                  ) : null}
                </div>
              </div>

              {/* Live preview — the same chip the site renders, including the derived text
                  colour, so staff see the real result rather than approving a hex code. */}
              {isValidBadgeColor(badgeColor) && badgeLabel.trim() ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-fg-muted">Preview</span>
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px] font-semibold shadow-sm"
                    style={{ backgroundColor: badgeColor, color: readableTextOn(badgeColor) }}
                    data-testid="program-form-badge-preview"
                  >
                    {badgeLabel.trim()}
                  </span>
                  {/* AA needs 4.5:1 for normal text. Advisory, not blocking: the chip is
                      small and bold, and staff may have a brand colour they must use. */}
                  {badgeContrastRatio(badgeColor) < 4.5 ? (
                    <span className="text-xs text-warning" data-testid="program-form-badge-contrast-warning">
                      Low contrast ({badgeContrastRatio(badgeColor).toFixed(1)}:1), harder to read.
                    </span>
                  ) : null}
                </div>
              ) : null}

              <label className="flex cursor-pointer items-center justify-between gap-3">
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-fg">Show badge on website</span>
                  <span className="text-xs text-fg-muted">
                    Turn off to hide the badge without losing what you set up here.
                  </span>
                </span>
                <Switch
                  checked={badgeEnabled}
                  onCheckedChange={setBadgeEnabled}
                  // Mirrors the server's badge invariant, so the states it rejects (enabled
                  // without a colour or without text) simply cannot be reached from the
                  // form — the user is stopped by a disabled control, not a save error.
                  disabled={badgeIncomplete}
                  aria-label="Show badge on website"
                  data-testid="program-form-badge-enabled"
                />
              </label>
            </div>
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
