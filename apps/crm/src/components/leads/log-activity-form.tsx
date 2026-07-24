// Log-activity inline form — used inside the lead detail drawer's Activity
// tab. Copy is explicit that this LOGS a record, it does NOT send anything
// (docs/03 §7.11 scope boundary, phase-2.md: "Activities are logged as
// records, not sent. Actual WhatsApp/email/SMS delivery is P6.").
import * as React from "react";
import { useForm } from "react-hook-form";
import { Button, Input, Select, SelectItem, useToast } from "@repo/ui";
import { CreateActivityRequestSchema, type ActivityType, type CreateActivityRequest } from "@repo/types";

import { useCreateActivity } from "../../hooks/use-activities";
import { surfaceError } from "../../lib/surface-error";

const TYPE_OPTIONS: { value: ActivityType; label: string }[] = [
  { value: "call", label: "Call" },
  { value: "note", label: "Note" },
  { value: "whatsapp", label: "WhatsApp (logged only)" },
  { value: "email", label: "Email (logged only)" },
  { value: "task", label: "Task / follow-up" },
];

interface LogActivityFormProps {
  leadId: string;
}

interface LogActivityFormValues {
  type: ActivityType;
  body: string;
  dueAt?: string;
}

export function LogActivityForm({ leadId }: LogActivityFormProps): React.JSX.Element {
  const { toast } = useToast();
  const createActivity = useCreateActivity();
  const { register, handleSubmit, reset, watch, setValue, formState } = useForm<LogActivityFormValues>({
    defaultValues: { type: "note" },
  });
  const errors = formState.errors;
  const type = watch("type");

  const onSubmit = handleSubmit(async (values) => {
    const payload =
      type === "task"
        ? { description: values.body }
        : type === "whatsapp" || type === "email"
          ? { body: values.body }
          : type === "call"
            ? { notes: values.body }
            : { body: values.body };

    try {
      const body: CreateActivityRequest = CreateActivityRequestSchema.parse({
        type,
        payload,
        leadId,
        dueAt: type === "task" && values.dueAt ? new Date(values.dueAt).toISOString() : undefined,
      });
      await createActivity.mutateAsync(body);
      toast({ title: "Activity logged", variant: "success" });
      reset({ type: "note" });
    } catch (error) {
      surfaceError(toast, error, "Couldn't log this activity");
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-md border border-border p-3" data-testid="log-activity-form">
      <p className="text-xs text-fg-muted">
        This logs a record on the timeline only — WhatsApp/email entries are NOT delivered in this phase.
      </p>
      <Select
        label="Type"
        placeholder="Select type"
        value={type}
        onValueChange={(value) => setValue("type", value as ActivityType)}
        data-testid="log-activity-type"
      >
        {TYPE_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </Select>
      {/*
        @repo/ui has no Textarea primitive yet (P2 scope: design-system shipped
        Kanban/MoneyInput/DateChip/SlaChip/ActivityTimeline only — see
        phase-2.md task #3). Using Input (single-line) for the activity body,
        same pattern as the refund-reject reason field in
        components/commerce/refund-detail-drawer.tsx. A multi-line Textarea
        is a tracked follow-up for design-system, not introduced here.
      */}
      <Input
        label={type === "task" ? "Task description" : "Details"}
        placeholder={type === "task" ? "e.g. Call back to confirm the enrollment fee" : "What happened in this interaction?"}
        required
        {...register("body", { required: true })}
        error={errors.body ? "Required" : undefined}
        data-testid="log-activity-body"
      />
      {type === "task" ? (
        <Input
          label="Due at"
          type="datetime-local"
          helperText="Sets the SLA follow-up deadline for this task."
          {...register("dueAt")}
          data-testid="log-activity-due-at"
        />
      ) : null}
      <Button type="submit" loading={createActivity.isPending} data-testid="log-activity-submit" className="self-end">
        Log activity
      </Button>
    </form>
  );
}
