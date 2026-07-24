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
} from "@repo/ui";
import type {
  CampaignChannel,
  CreateCampaignTemplateDto,
} from "@repo/types";

import {
  useCreateCampaignTemplate,
  useUpdateCampaignTemplate,
  useCampaignTemplate,
} from "../../hooks/use-campaigns";

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
    const variables = values.variables
      ? values.variables.split(",").map((v) => v.trim()).filter(Boolean)
      : [];

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
            toast({
              title: "Failed to update template",
              description: (err as Error).message,
              variant: "destructive",
            });
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
          toast({
            title: "Failed to create template",
            description: (err as Error).message,
            variant: "destructive",
          });
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
                  placeholder="e.g. Welcome message — batch B01"
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
                  {...register("body", { required: "Body is required" })}
                  rows={6}
                  placeholder={
                    channel === "sms"
                      ? "Hi {{firstName}}, your session starts on {{date}}."
                      : "Hi {{firstName}},\n\nYour enrollment in {{programTitle}} is confirmed."
                  }
                  data-testid="tpl-body"
                  error={errors.body?.message}
                  helperText="Use {{variable_name}} for placeholders, e.g. {{firstName}}"
                />

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

                <Input
                  label="Variables"
                  id="tpl-variables"
                  {...register("variables")}
                  helperText="Comma-separated list of placeholder names used in the body (e.g. firstName, programTitle)"
                  placeholder="firstName, programTitle, date"
                  data-testid="tpl-variables"
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
