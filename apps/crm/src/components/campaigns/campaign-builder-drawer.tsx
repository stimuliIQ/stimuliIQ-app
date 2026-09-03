// CampaignBuilder drawer — 4-step wizard to create a campaign.
// Step 1: Segment (audience filter + source type)
// Step 2: Template (channel select + pick from template list)
// Step 3: Schedule (schedule_at or send now)
// Step 4: Review + send
//
// Uses @repo/ui CampaignBuilder shell + AudienceSegmentFilter.
// LOCK-D4 / AC-78: template selection is filtered by channel; DLT validation
// happens server-side (API returns 422) and is surfaced as a toast.
// Consent gate: the API enforces marketing_opt_in exclusion (non-bypassable).
import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import {
  Alert,
  CampaignBuilder,
  AudienceSegmentFilter,
  type SegmentFilter,
  type SegmentFieldDef,
  Drawer,
  DrawerContent,
  DrawerBody,
  Select,
  SelectItem,
  Label,
  Input,
  DetailGrid,
  DetailRow,
  StatusChip,
  useToast,
  Skeleton,
} from "@repo/ui";
import type {
  CampaignChannel,
  CreateCampaignDto,
  SegmentDefDto,
} from "@repo/types";

import { useCampaignTemplatesList, useCreateCampaign } from "../../hooks/use-campaigns";
import { surfaceError } from "../../lib/surface-error";

// ── Segment field definitions ─────────────────────────────────────────────────

const SEGMENT_FIELDS: SegmentFieldDef[] = [
  {
    key: "stages",
    label: "Lead stage",
    operators: ["in", "not_in"],
    inputType: "multiselect",
    options: [
      { value: "new", label: "New" },
      { value: "contacted", label: "Contacted" },
      { value: "qualified", label: "Qualified" },
      { value: "counselling", label: "Counselling" },
      { value: "negotiation", label: "Negotiation" },
      { value: "won", label: "Won" },
      { value: "lost", label: "Lost" },
    ],
  },
  {
    key: "statuses",
    label: "Enrollment status",
    operators: ["in"],
    inputType: "multiselect",
    options: [
      { value: "active", label: "Active" },
      { value: "completed", label: "Completed" },
      { value: "suspended", label: "Suspended" },
    ],
  },
  {
    key: "sources",
    label: "Lead source",
    operators: ["in"],
    inputType: "multiselect",
    options: [
      { value: "website", label: "Website" },
      { value: "newsletter", label: "Newsletter" },
      { value: "referral", label: "Referral" },
      { value: "campaign", label: "Campaign" },
      { value: "event", label: "Event" },
    ],
  },
];

const SOURCE_OPTIONS: { value: "leads" | "students" | "both"; label: string }[] = [
  { value: "leads", label: "Leads only" },
  { value: "students", label: "Students only" },
  { value: "both", label: "Leads + Students" },
];

const CHANNEL_OPTIONS: { value: CampaignChannel; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "sms", label: "SMS" },
];

/**
 * Convert a `datetime-local` input value ("2026-07-23T11:45", local, no offset) into a full
 * ISO-8601 datetime with a UTC offset ("2026-07-23T06:15:00.000Z"), which the API's
 * `IsoDateTimeSchema` (z.string().datetime({ offset: true })) requires. Returns null for an
 * empty or unparseable value.
 */
function localToIso(local: string | null | undefined): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ── Internal form state ───────────────────────────────────────────────────────

interface CampaignDraft {
  name: string;
  channel: CampaignChannel;
  source: "leads" | "students" | "both";
  segmentFilters: SegmentFilter[];
  templateId: string;
  scheduleAt: string;
  sendNow: boolean;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface CampaignBuilderDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CampaignBuilderDrawer({
  open,
  onOpenChange,
}: CampaignBuilderDrawerProps): React.JSX.Element {
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = React.useState(0);
  const [stepErrors, setStepErrors] = React.useState<Record<number, string>>({});

  const {
    register,
    control,
    watch,
    getValues,
    setValue,
    reset,
    formState: { errors },
  } = useForm<CampaignDraft>({
    defaultValues: {
      name: "",
      channel: "email",
      source: "both",
      segmentFilters: [],
      templateId: "",
      scheduleAt: "",
      sendNow: true,
    },
  });

  const channel = watch("channel");
  const templateId = watch("templateId");
  const sendNow = watch("sendNow");
  const segmentFilters = watch("segmentFilters");
  const source = watch("source");
  const name = watch("name");
  const scheduleAt = watch("scheduleAt");

  // Load templates filtered by selected channel
  const { data: templatesData, isLoading: templatesLoading } = useCampaignTemplatesList({ channel });

  const createCampaign = useCreateCampaign();

  function validateStep(step: number): string | null {
    if (step === 0) {
      if (!name.trim()) return "Campaign name is required.";
      if (!channel) return "Channel is required.";
      return null;
    }
    if (step === 1) {
      if (!templateId) return "Please select a template.";
      return null;
    }
    if (step === 2) {
      if (!sendNow && !scheduleAt) return "Please select a send date/time or choose 'Send now'.";
      return null;
    }
    return null;
  }

  function handleNext() {
    const err = validateStep(currentStep);
    if (err) {
      setStepErrors((prev) => ({ ...prev, [currentStep]: err }));
      return;
    }
    setStepErrors((prev) => ({ ...prev, [currentStep]: "" }));
    setCurrentStep((s) => Math.min(s + 1, 3));
  }

  function handleBack() {
    setCurrentStep((s) => Math.max(s - 1, 0));
  }

  function handleSubmit() {
    const values = getValues();

    // Build segment def — consent gate (marketing_opt_in) is always enforced by the API (AC-42)
    const segment: SegmentDefDto = {
      source: values.source,
      consentRequired: true,
    };

    // Map segment filters to SegmentDefDto fields
    for (const filter of values.segmentFilters) {
      if (filter.field === "stages") {
        segment.stages = Array.isArray(filter.value) ? filter.value : [filter.value];
      } else if (filter.field === "statuses") {
        segment.statuses = Array.isArray(filter.value) ? filter.value : [filter.value];
      } else if (filter.field === "sources") {
        segment.sources = Array.isArray(filter.value) ? filter.value : [filter.value];
      }
    }

    const dto: CreateCampaignDto = {
      name: values.name,
      channel: values.channel,
      templateId: values.templateId,
      segment,
      // A <input type="datetime-local"> yields a zone-less string like "2026-07-23T11:45"
      // (no seconds, no offset). The API requires a full ISO-8601 datetime WITH offset
      // (z.string().datetime({ offset: true })) — sending the raw local string is the 400
      // "One or more fields failed validation". Interpret it as local time and serialise to
      // UTC (…Z), which the schema accepts.
      scheduleAt: values.sendNow ? null : localToIso(values.scheduleAt),
    };

    createCampaign.mutate(dto, {
      onSuccess: () => {
        toast({ title: "Campaign created", variant: "success" });
        onOpenChange(false);
        reset();
        setCurrentStep(0);
      },
      onError: (err) => {
        surfaceError(toast, err, "Failed to create campaign");
      },
    });
  }

  const selectedTemplate = templatesData?.items.find((t) => t.id === templateId);
  const overallError =
    createCampaign.error ? (createCampaign.error as Error).message : undefined;

  // ── Step content ──────────────────────────────────────────────────────────

  const segmentStepContent = (
    <div className="flex flex-col gap-4" data-testid="campaign-step-segment">
      <Input
        label="Campaign name"
        id="campaign-name"
        {...register("name")}
        error={errors.name?.message ?? (stepErrors[0] === "Campaign name is required." ? stepErrors[0] : undefined)}
        placeholder="e.g. July batch intake follow-up"
        data-testid="campaign-name"
        required
      />

      <Controller
        control={control}
        name="channel"
        render={({ field }) => (
          <Select
            label="Channel"
            required
            id="campaign-channel"
            value={field.value}
            onValueChange={field.onChange}
            placeholder="Select channel"
            data-testid="campaign-channel"
          >
            {CHANNEL_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </Select>
        )}
      />

      <Controller
        control={control}
        name="source"
        render={({ field }) => (
          <Select
            label="Audience source"
            required
            id="campaign-source"
            value={field.value}
            onValueChange={field.onChange}
            placeholder="Select audience source"
            data-testid="campaign-source"
          >
            {SOURCE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </Select>
        )}
      />

      <Controller
        control={control}
        name="segmentFilters"
        render={({ field }) => (
          <AudienceSegmentFilter
            fields={SEGMENT_FIELDS}
            filters={field.value}
            onFilterChange={field.onChange}
            data-testid="campaign-segment-filter"
          />
        )}
      />

      {stepErrors[0] ? (
        <p className="text-sm text-danger" role="alert">{stepErrors[0]}</p>
      ) : null}

      <p className="text-xs text-fg-muted">
        Recipients without marketing consent are always excluded regardless of filters.
      </p>
    </div>
  );

  const templateStepContent = (
    <div className="flex flex-col gap-4" data-testid="campaign-step-template">
      {templatesLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} shape="line" className="h-12" />
          ))}
        </div>
      ) : !templatesData?.items.length ? (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-fg-muted">
          No {channel} templates yet. Create one in the Templates tab first.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <Label>Select template <span aria-hidden="true" className="text-danger">*</span></Label>
          {stepErrors[1] ? (
            <p className="text-sm text-danger" role="alert">{stepErrors[1]}</p>
          ) : null}
          <Controller
            control={control}
            name="templateId"
            render={({ field }) => (
              <div role="radiogroup" aria-label="Campaign templates" className="flex flex-col gap-2">
                {templatesData.items.map((tpl) => {
                  const isSelected = field.value === tpl.id;
                  const hasDlt =
                    tpl.channel !== "email" &&
                    Boolean((tpl as { dltTemplateId?: string }).dltTemplateId);
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => field.onChange(tpl.id)}
                      className={`rounded-md border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        isSelected
                          ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
                          : "border-border bg-card hover:border-brand-300"
                      }`}
                      data-testid={`template-option-${tpl.id}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-fg">{tpl.name}</span>
                        {(tpl.channel === "whatsapp" || tpl.channel === "sms") && !hasDlt ? (
                          <StatusChip tone="danger" label="No DLT ID" />
                        ) : null}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{tpl.body}</p>
                    </button>
                  );
                })}
              </div>
            )}
          />
        </div>
      )}

      {/* Warn if selected SMS/WA template lacks DLT id */}
      {selectedTemplate &&
        (selectedTemplate.channel === "whatsapp" || selectedTemplate.channel === "sms") &&
        !(selectedTemplate as { dltTemplateId?: string }).dltTemplateId ? (
        <Alert tone="danger" role="alert">
          This template is missing a DLT Template ID. The send will be rejected by the API.
          Edit the template to add the required DLT ID before sending.
        </Alert>
      ) : null}
    </div>
  );

  const scheduleStepContent = (
    <div className="flex flex-col gap-4" data-testid="campaign-step-schedule">
      <Controller
        control={control}
        name="sendNow"
        render={({ field }) => (
          <div className="flex flex-col gap-3" role="radiogroup" aria-label="Send timing">
            <button
              type="button"
              role="radio"
              aria-checked={field.value}
              onClick={() => { field.onChange(true); setValue("scheduleAt", ""); }}
              className={`rounded-md border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                field.value
                  ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
                  : "border-border bg-card hover:border-brand-300"
              }`}
              data-testid="send-now-option"
            >
              <p className="text-sm font-medium text-fg">Send immediately</p>
              <p className="text-xs text-fg-muted">Campaign starts sending as soon as you confirm.</p>
            </button>

            <button
              type="button"
              role="radio"
              aria-checked={!field.value}
              onClick={() => field.onChange(false)}
              className={`rounded-md border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                !field.value
                  ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
                  : "border-border bg-card hover:border-brand-300"
              }`}
              data-testid="send-scheduled-option"
            >
              <p className="text-sm font-medium text-fg">Schedule for later</p>
              <p className="text-xs text-fg-muted">Set a future date and time to send.</p>
            </button>
          </div>
        )}
      />

      {!sendNow ? (
        <Input
          label="Send at"
          required
          id="campaign-schedule-at"
          type="datetime-local"
          {...register("scheduleAt")}
          error={stepErrors[2] || undefined}
          data-testid="campaign-schedule-at"
          min={new Date().toISOString().slice(0, 16)}
        />
      ) : null}
    </div>
  );

  const reviewStepContent = (
    <div className="flex flex-col gap-4" data-testid="campaign-step-review">
      <div className="rounded-md border border-border bg-surface p-4">
        <DetailGrid>
          <DetailRow label="Name" value={name || "-"} />
          <DetailRow
            label="Channel"
            value={
              <StatusChip
                tone={channel === "email" ? "info" : channel === "whatsapp" ? "success" : "warning"}
                label={channel.charAt(0).toUpperCase() + channel.slice(1)}
              />
            }
          />
          <DetailRow
            label="Audience"
            value={
              (source === "both"
                ? "Leads + Students"
                : source === "leads"
                  ? "Leads only"
                  : "Students only") +
              (segmentFilters.length > 0
                ? ` (${segmentFilters.length} filter${segmentFilters.length > 1 ? "s" : ""})`
                : " (no filters, all)")
            }
          />
          <DetailRow label="Template" value={selectedTemplate?.name ?? "-"} />
          <DetailRow
            label="Schedule"
            value={
              sendNow
                ? "Send immediately"
                : scheduleAt
                  ? new Date(scheduleAt).toLocaleString("en-IN")
                  : "Not set"
            }
          />
        </DetailGrid>
      </div>

      <p className="text-xs text-fg-muted">
        Recipients without marketing consent and those on the suppression list will be automatically
        excluded. The campaign will send exactly once per recipient.
      </p>
    </div>
  );

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title="New campaign"
        description="Build and send a bulk marketing campaign to your audience."
        data-testid="campaign-builder-drawer"
      >
        <DrawerBody className="overflow-y-auto">
          <CampaignBuilder
            currentStep={currentStep}
            onNext={handleNext}
            onBack={handleBack}
            onSubmit={handleSubmit}
            isSubmitting={createCampaign.isPending}
            formError={overallError}
            segmentStep={segmentStepContent}
            templateStep={templateStepContent}
            scheduleStep={scheduleStepContent}
            reviewStep={reviewStepContent}
            submitLabel="Create campaign"
            data-testid="campaign-builder"
          />
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
