// Campaign template create/edit drawer — RHF + zod + discriminated union on channel.
// LOCK-D4 / AC-78: dlt_template_id is REQUIRED for WhatsApp and SMS templates.
// The form renders a required DLT Template ID field for those channels.
// For email: the field is optional and hidden by default.
import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import {
  Button,
  Drawer,
  DrawerContent,
  DrawerBody,
  DrawerFooter,
  Input,
  Select,
  SelectItem,
  Textarea,
  useToast,
  Skeleton,
  Alert,
} from "@repo/ui";
import type {
  CampaignChannel,
  CreateCampaignTemplateDto,
} from "@repo/types";
import { CAMPAIGN_TEMPLATE_VARIABLES, findUnknownTemplateVariables } from "@repo/types";

import {
  useCreateCampaignTemplate,
  useUpdateCampaignTemplate,
  useCampaignTemplate,
} from "../../hooks/use-campaigns";
import { surfaceError } from "../../lib/surface-error";

const CHANNEL_OPTIONS: { value: CampaignChannel; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "sms", label: "SMS" },
];

// Local form values type — unified (no discriminated union at form level)
interface TemplateFormValues {
  channel: CampaignChannel;
  name: string;
  subject: string;
  body: string;
  dltTemplateId: string;
  variables: string; // comma-separated
}

interface CampaignTemplateFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present for edit mode — fetches the template and pre-fills. */
  templateId?: string;
}

export function CampaignTemplateFormDrawer({
  open,
  onOpenChange,
  templateId,
}: CampaignTemplateFormDrawerProps): React.JSX.Element {
  const isEdit = Boolean(templateId);
  const { toast } = useToast();
  const { data: templateData, isLoading: templateLoading } = useCampaignTemplate(
    isEdit ? templateId : undefined,
  );

  const createMutation = useCreateCampaignTemplate();
  const updateMutation = useUpdateCampaignTemplate();

  const isPending = createMutation.isPending || updateMutation.isPending;

  const {
    control,
    register,
    handleSubmit,
    watch,
    reset,
    setValue,
    formState: { errors },
  } = useForm<TemplateFormValues>({
    defaultValues: {
      channel: "email",
      name: "",
      subject: "",
      body: "",
      dltTemplateId: "",
      variables: "",
    },
  });

  const channel = watch("channel");
  const requiresDlt = channel === "whatsapp" || channel === "sms";

  // ── Variable insertion + live "this won't resolve" check ────────────────
  //
  // `register` owns the textarea's ref, and the variable buttons need it too (to insert at
  // the caret rather than appending at the end), so the registration is split out here and
  // both refs are attached at the element.
  const { ref: registerBodyRef, ...bodyField } = register("body", { required: "Body is required" });
  const bodyElementRef = React.useRef<HTMLTextAreaElement | null>(null);

  const body = watch("body") ?? "";
  const subject = watch("subject") ?? "";
  const unknownVariables = React.useMemo(
    () => findUnknownTemplateVariables(`${subject} ${body}`),
    [subject, body],
  );

  /**
   * Insert `{{key}}` where the caret is, and put the caret after it.
   *
   * Appending at the end would be simpler and worse — staff write the sentence first and
   * then reach for the name, so the token belongs where they were typing.
   */
  function insertVariable(key: string): void {
    const token = `{{${key}}}`;
    const element = bodyElementRef.current;
    if (!element) {
      setValue("body", `${body}${token}`, { shouldDirty: true, shouldValidate: true });
      return;
    }
    const start = element.selectionStart ?? body.length;
    const end = element.selectionEnd ?? start;
    setValue("body", `${body.slice(0, start)}${token}${body.slice(end)}`, {
      shouldDirty: true,
      shouldValidate: true,
    });
    // After React has re-rendered with the new value, or the caret lands on stale text.
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + token.length, start + token.length);
    });
  }

  // Pre-fill form when editing
  React.useEffect(() => {
    if (templateData && isEdit) {
      let dltTemplateId = "";
      let subject = "";
      if (templateData.channel === "email") {
        subject = templateData.subject ?? "";
        dltTemplateId = templateData.dltTemplateId ?? "";
      } else {
        dltTemplateId = templateData.dltTemplateId ?? "";
      }
      reset({
        channel: templateData.channel,
        name: templateData.name,
        subject,
        body: templateData.body,
        dltTemplateId,
        variables: templateData.variables.join(", "),
      });
    }
  }, [templateData, isEdit, reset]);

  function onSubmit(values: TemplateFormValues) {
    // Derived from the message, not typed by hand. The old free-text field was metadata
    // nothing kept in step with the body — edit the text and the list silently lied. The
    // placeholders IN the message are the only honest answer to "what does this use?".
    const variables = [
      ...new Set(
        [...`${values.subject} ${values.body}`.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)].map(
          (match) => match[1]!,
        ),
      ),
    ];

    let dto: CreateCampaignTemplateDto;
    if (values.channel === "email") {
      dto = {
        channel: "email",
        name: values.name,
        subject: values.subject,
        body: values.body,
        variables,
        dltTemplateId: values.dltTemplateId || null,
      };
    } else if (values.channel === "whatsapp") {
      if (!values.dltTemplateId) {
        toast({
          title: "DLT Template ID required",
          description: "WhatsApp templates must include a DLT-approved template ID.",
          variant: "destructive",
        });
        return;
      }
      dto = {
        channel: "whatsapp",
        name: values.name,
        body: values.body,
        variables,
        dltTemplateId: values.dltTemplateId,
      };
    } else {
      if (!values.dltTemplateId) {
        toast({
          title: "DLT Template ID required",
          description: "SMS templates must include a DLT-approved template ID.",
          variant: "destructive",
        });
        return;
      }
      dto = {
        channel: "sms",
        name: values.name,
        body: values.body,
        variables,
        dltTemplateId: values.dltTemplateId,
      };
    }

    if (isEdit && templateId) {
      updateMutation.mutate(
        {
          id: templateId,
          body: {
            name: dto.name,
            body: dto.body,
            variables,
            ...(values.channel === "email" ? { subject: values.subject } : {}),
            dltTemplateId: values.dltTemplateId || null,
          },
        },
        {
          onSuccess: () => {
            toast({ title: "Template updated", variant: "success" });
            onOpenChange(false);
            reset();
          },
          onError: (err) => {
            surfaceError(toast, err, "Failed to update template");
          },
        },
      );
    } else {
      createMutation.mutate(dto, {
        onSuccess: () => {
          toast({ title: "Template created", variant: "success" });
          onOpenChange(false);
          reset();
        },
        onError: (err) => {
          surfaceError(toast, err, "Failed to create template");
        },
      });
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent position="center"
        title={isEdit ? "Edit template" : "New campaign template"}
        description="Create a reusable template for email, WhatsApp, or SMS campaigns."
        data-testid="campaign-template-drawer"
      >
        {isEdit && templateLoading ? (
          <DrawerBody>
            <div className="flex flex-col gap-4">
              <Skeleton shape="line" className="h-8" />
              <Skeleton shape="line" className="h-8" />
              <Skeleton shape="block" className="h-32" />
            </div>
          </DrawerBody>
        ) : (
          <>
            <DrawerBody>
              <form
                id="template-form"
                onSubmit={(e) => { void handleSubmit(onSubmit)(e); }}
                className="flex flex-col gap-4"
                noValidate
                aria-label={isEdit ? "Edit campaign template" : "Create campaign template"}
              >
                {/* Channel — immutable after creation */}
                <Controller
                  control={control}
                  name="channel"
                  render={({ field }) => (
                    <Select
                      label="Channel"
                      required
                      id="tpl-channel"
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={isEdit}
                      placeholder="Select channel"
                      data-testid="tpl-channel"
                    >
                      {CHANNEL_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </Select>
                  )}
                />

                <Input
                  label="Template name"
                  id="tpl-name"
                  {...register("name", { required: "Name is required" })}
                  error={errors.name?.message}
                  placeholder="e.g. Welcome message, batch B01"
                  data-testid="tpl-name"
                  required
                  aria-invalid={Boolean(errors.name)}
                />

                {/* Subject — email only */}
                {channel === "email" ? (
                  <Input
                    label="Subject line"
                    id="tpl-subject"
                    {...register("subject", {
                      required: channel === "email" ? "Subject is required for email" : false,
                    })}
                    error={errors.subject?.message}
                    placeholder="Your program enrollment confirmation"
                    data-testid="tpl-subject"
                    required
                    aria-invalid={Boolean(errors.subject)}
                  />
                ) : null}

                {/* Body */}
                <Textarea
                  label="Body"
                  required
                  id="tpl-body"
                  {...bodyField}
                  ref={(element) => {
                    // Two owners for one node: RHF needs it to read/validate the field, and
                    // the variable buttons below need it to insert at the caret.
                    registerBodyRef(element);
                    bodyElementRef.current = element;
                  }}
                  rows={6}
                  placeholder={
                    channel === "sms"
                      ? "Hi {{name}}, your {{program_title}} session starts soon."
                      : "Hi {{name}},\n\nYour enrollment in {{program_title}} is confirmed."
                  }
                  data-testid="tpl-body"
                  error={errors.body?.message}
                />

                {/* What can go in the message. Answers "which variables exist?" at the
                    moment it is asked, instead of leaving staff to guess a name that then
                    silently ships with its braces showing. */}
                <div className="rounded-md border border-border bg-surface p-3" data-testid="tpl-variables-help">
                  <p className="text-sm font-medium text-fg">Variables you can use</p>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    Click one to drop it in. Each is replaced per recipient when the campaign sends.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {CAMPAIGN_TEMPLATE_VARIABLES.map((variable) => (
                      <button
                        key={variable.key}
                        type="button"
                        onClick={() => insertVariable(variable.key)}
                        title={variable.description}
                        className="rounded border border-border bg-bg px-2 py-1 text-xs text-fg transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        data-testid={`tpl-variable-${variable.key}`}
                      >
                        <code>{`{{${variable.key}}}`}</code>
                        <span className="ml-1.5 text-fg-muted">{variable.description}</span>
                      </button>
                    ))}
                  </div>

                  {unknownVariables.length > 0 ? (
                    // The failure this whole panel exists to prevent: an invented
                    // placeholder is NOT an error anywhere downstream — the renderer leaves
                    // it alone by design — so the student receives "Hi {{firstName}},".
                    <Alert tone="warning" className="mt-3" data-testid="tpl-unknown-variables">
                      {unknownVariables.map((key) => `{{${key}}}`).join(", ")}{" "}
                      {unknownVariables.length === 1 ? "isn't" : "aren't"} replaced when sending, the message will go
                      out with the braces showing. Use one of the variables above, or write the value in directly.
                    </Alert>
                  ) : null}
                </div>

                {/* DLT Template ID — REQUIRED for WhatsApp/SMS (LOCK-D4, AC-78) */}
                <Input
                  label={requiresDlt ? "DLT Template ID (required)" : "DLT Template ID (optional)"}
                  id="tpl-dlt-id"
                  {...register("dltTemplateId", {
                    required: requiresDlt ? "DLT Template ID is required for WhatsApp/SMS" : false,
                    minLength: requiresDlt
                      ? { value: 1, message: "DLT Template ID cannot be empty" }
                      : undefined,
                  })}
                  error={errors.dltTemplateId?.message}
                  helperText={
                    requiresDlt
                      ? "India DLT-approved template ID (TRAI-registered). Required for WhatsApp and SMS sends."
                      : "DLT template ID is not required for email campaigns."
                  }
                  placeholder={requiresDlt ? "1007xxxxxxxxx" : "Optional"}
                  data-testid="tpl-dlt-id"
                  required={requiresDlt}
                  aria-invalid={Boolean(errors.dltTemplateId)}
                  aria-required={requiresDlt}
                />

              </form>
            </DrawerBody>

            <DrawerFooter>
              <Button
                variant="secondary"
                onClick={() => { onOpenChange(false); reset(); }}
                disabled={isPending}
                data-testid="tpl-cancel-btn"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                form="template-form"
                loading={isPending}
                data-testid="tpl-submit-btn"
              >
                {isEdit ? "Save changes" : "Create template"}
              </Button>
            </DrawerFooter>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}
