// NewTicketForm — raise a support ticket. Phase 9 Completion, T36
// (docs/plans/phase-9-completion.md, docs/02 §7.16 "support/help desk (raise
// ticket -> CRM, status tracking)"). RHF + zod resolver against
// CreateTicketRequestSchema (@repo/types) — the same schema the API validates.
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Select, SelectItem } from "@repo/ui";
import { ApiError } from "@repo/api-client";
import { CreateTicketRequestSchema, type CreateTicketRequest, type TicketPriority } from "@repo/types";

const PRIORITY_OPTIONS: ReadonlyArray<{ value: TicketPriority; label: string }> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

// `CreateTicketRequestSchema.priority` carries a zod `.default("medium")`, which makes
// the resolver's *input* type (priority optional) diverge from the *output* type
// (priority required) — a well-known zodResolver/RHF generics friction point. Priority
// is driven by the Select below instead, so the RHF-validated subset is just
// subject+body, built back into a full CreateTicketRequest on submit.
const TicketFormFieldsSchema = CreateTicketRequestSchema.pick({ subject: true, body: true });
type TicketFormFields = { subject: string; body: string };

export interface NewTicketFormProps {
  onSubmit: (body: CreateTicketRequest) => Promise<unknown>;
  isSubmitting: boolean;
  submitError: ApiError | null;
  onSuccess: () => void;
}

export function NewTicketForm({ onSubmit, isSubmitting, submitError, onSuccess }: NewTicketFormProps): React.JSX.Element {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<TicketFormFields>({
    resolver: zodResolver(TicketFormFieldsSchema),
    defaultValues: { subject: "", body: "" },
  });

  const [priority, setPriority] = React.useState<TicketPriority>("medium");

  const submit = handleSubmit(async (values) => {
    await onSubmit({ ...values, priority });
    reset({ subject: "", body: "" });
    setPriority("medium");
    onSuccess();
  });

  return (
    <Card data-testid="new-ticket-card">
      <CardHeader>
        <CardTitle>Raise a ticket</CardTitle>
        <CardDescription>Our support team typically replies within one business day.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4" data-testid="new-ticket-form">
          <div className="space-y-1.5">
            <label htmlFor="ticket-subject" className="text-sm font-medium text-fg">
              Subject
            </label>
            <input
              id="ticket-subject"
              type="text"
              {...register("subject")}
              aria-invalid={errors.subject ? true : undefined}
              aria-describedby={errors.subject ? "ticket-subject-error" : undefined}
              className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="ticket-subject-input"
            />
            {errors.subject ? (
              <p id="ticket-subject-error" role="alert" className="text-sm text-danger">
                {errors.subject.message}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="ticket-body" className="text-sm font-medium text-fg">
              Describe the issue
            </label>
            <textarea
              id="ticket-body"
              rows={4}
              {...register("body")}
              aria-invalid={errors.body ? true : undefined}
              aria-describedby={errors.body ? "ticket-body-error" : undefined}
              className="w-full resize-y rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="ticket-body-input"
            />
            {errors.body ? (
              <p id="ticket-body-error" role="alert" className="text-sm text-danger">
                {errors.body.message}
              </p>
            ) : null}
          </div>

          <Select
            label="Priority"
            value={priority}
            onValueChange={(v) => setPriority(v as TicketPriority)}
            wrapperClassName="max-w-xs"
            data-testid="ticket-priority-select"
          >
            {PRIORITY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </Select>

          {submitError ? (
            <p role="alert" className="text-sm text-danger" data-testid="new-ticket-error">
              {/* DEFECT FIX (QA): a RAW network failure (e.g. CORS-preflight rejection) yields
                  an error whose `problem` (the RFC-7807 body) is undefined — reading
                  `.problem.detail` unguarded threw and white-screened the page. Optional-chain
                  through it and fall back to a friendly message. */}
              {submitError.problem?.detail ?? "Couldn't submit your ticket. Please try again."}
            </p>
          ) : null}

          <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting || undefined} data-testid="new-ticket-submit">
            {isSubmitting ? "Submitting…" : "Submit ticket"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
