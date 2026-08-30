// Apply for leave.
//
// THE DAY COUNT IS COMPUTED LIVE, IN THE BROWSER, BY THE SAME FUNCTION THE API USES.
// `computeLeaveDuration` comes from @repo/types and runs here against the working week and
// holiday list the API just handed us (`apply-context`), so the "3.5 working days" the
// applicant sees is the number the server will arrive at independently. The alternative —
// a client-side estimate — is a form that previews 4 days and then 422s, or worse, silently
// books something other than what it showed.
//
// The server still recomputes and is the authority. Nothing about the duration is sent.
//
// The balance warning is shown INLINE rather than blocking submit: the API is the thing that
// refuses, and a form that greys out its own button on a rule it only half-knows leaves the
// applicant with no error message to read.
import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import {
  Alert,
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  Input,
  Select,
  SelectItem,
  Textarea,
  useToast,
} from "@repo/ui";
import type { LeaveApplyContext } from "@repo/types";
import { CreateLeaveRequestRequestSchema, computeLeaveDuration, formatLeaveDays } from "@repo/types";

import { useCreateLeaveRequest } from "../../hooks/use-leave";
import { surfaceError } from "../../lib/surface-error";

// The schema's INPUT type, not the inferred output type: the output makes the `.default()`
// fields required and breaks the zodResolver's input/output contract (the gotcha documented
// in mentor-form-drawer.tsx).
type ApplyFormValues = z.input<typeof CreateLeaveRequestRequestSchema>;

interface LeaveApplyDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: LeaveApplyContext | undefined;
}

const TODAY = () => new Date().toISOString().slice(0, 10);

export function LeaveApplyDrawer({ open, onOpenChange, context }: LeaveApplyDrawerProps): React.JSX.Element {
  const { toast } = useToast();
  const create = useCreateLeaveRequest();

  const form = useForm<ApplyFormValues>({
    resolver: zodResolver(CreateLeaveRequestRequestSchema),
    defaultValues: { startDayPart: "full", endDayPart: "full", reason: "" },
  });

  React.useEffect(() => {
    if (!open) return;
    form.reset({
      leaveTypeId: context?.types[0]?.id ?? "",
      startDate: TODAY(),
      endDate: TODAY(),
      startDayPart: "full",
      endDayPart: "full",
      reason: "",
    });
  }, [open, context, form]);

  const values = form.watch();
  const selectedType = context?.types.find((t) => t.id === values.leaveTypeId);
  const balance = context?.balances.find((b) => b.leaveTypeId === values.leaveTypeId);
  const isSingleDay = Boolean(values.startDate) && values.startDate === values.endDate;

  // Recomputed on every keystroke. It is a pure function over data already in memory, so
  // there is nothing to debounce and nothing to fetch.
  const duration = React.useMemo(() => {
    if (!context || !values.startDate || !values.endDate) return null;
    return computeLeaveDuration({
      startDate: values.startDate,
      endDate: values.endDate,
      startDayPart: values.startDayPart ?? "full",
      endDayPart: values.endDayPart ?? "full",
      weeklyOffDays: context.weeklyOffDays,
      holidayDates: context.holidayDates,
      allowHalfDay: selectedType?.allowHalfDay,
    });
  }, [context, values.startDate, values.endDate, values.startDayPart, values.endDayPart, selectedType]);

  const exceedsBalance =
    duration !== null &&
    duration.issues.length === 0 &&
    balance?.remainingDays !== null &&
    balance?.remainingDays !== undefined &&
    duration.days > balance.remainingDays;

  const onSubmit = form.handleSubmit(async (raw) => {
    try {
      await create.mutateAsync(CreateLeaveRequestRequestSchema.parse(raw));
      toast({ title: "Leave requested", description: "Your admin has been notified.", variant: "success" });
      onOpenChange(false);
    } catch (err) {
      surfaceError(toast, err, "Couldn't request this leave");
    }
  });

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title="Apply for leave" description="Your admin is notified as soon as you send this.">
        <DrawerBody>
          <form id="leave-apply-form" onSubmit={onSubmit} className="space-y-4" data-testid="leave-apply-form">
            <Select
              label="Type of leave"
              value={values.leaveTypeId ?? ""}
              onValueChange={(value) => form.setValue("leaveTypeId", value, { shouldValidate: true })}
              placeholder="Choose a leave type"
              error={form.formState.errors.leaveTypeId?.message}
              data-testid="leave-apply-type"
            >
              {(context?.types ?? []).map((type) => (
                <SelectItem key={type.id} value={type.id}>
                  {type.name}
                </SelectItem>
              ))}
            </Select>

            {balance ? (
              <p className="text-sm text-fg-muted" data-testid="leave-apply-balance">
                {balance.remainingDays === null
                  ? `${balance.leaveTypeName} isn't counted against an allowance.`
                  : `${formatLeaveDays(balance.remainingDays)} left this year` +
                    (balance.pendingDays > 0
                      ? ` (${formatLeaveDays(balance.pendingDays)} already awaiting approval).`
                      : ".")}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-3">
              <Input
                label="From"
                type="date"
                max={values.endDate || undefined}
                error={form.formState.errors.startDate?.message}
                wrapperClassName="w-44"
                data-testid="leave-apply-start"
                {...form.register("startDate")}
              />
              <Input
                label="To"
                type="date"
                min={values.startDate || undefined}
                error={form.formState.errors.endDate?.message}
                wrapperClassName="w-44"
                data-testid="leave-apply-end"
                {...form.register("endDate")}
              />
            </div>

            {selectedType?.allowHalfDay ? (
              <div className="flex flex-wrap gap-3">
                <Select
                  label={isSingleDay ? "How much of the day" : "First day"}
                  value={values.startDayPart ?? "full"}
                  onValueChange={(value) =>
                    form.setValue("startDayPart", value as ApplyFormValues["startDayPart"], {
                      shouldValidate: true,
                    })
                  }
                  wrapperClassName="w-44"
                  data-testid="leave-apply-start-part"
                >
                  <SelectItem value="full">Full day</SelectItem>
                  <SelectItem value="first_half">First half</SelectItem>
                  <SelectItem value="second_half">Second half</SelectItem>
                </Select>

                {/* On a single-day request the second picker would be a control with no
                    effect — the API ignores endDayPart entirely there — so it is hidden
                    rather than shown-and-ignored. */}
                {!isSingleDay ? (
                  <Select
                    label="Last day"
                    value={values.endDayPart ?? "full"}
                    onValueChange={(value) =>
                      form.setValue("endDayPart", value as ApplyFormValues["endDayPart"], {
                        shouldValidate: true,
                      })
                    }
                    wrapperClassName="w-44"
                    data-testid="leave-apply-end-part"
                  >
                    <SelectItem value="full">Full day</SelectItem>
                    <SelectItem value="first_half">First half</SelectItem>
                  </Select>
                ) : null}
              </div>
            ) : null}

            {duration && duration.issues.length > 0 ? (
              <Alert tone="warning" data-testid="leave-apply-issue">
                {duration.issues[0]?.message}
              </Alert>
            ) : null}

            {duration && duration.issues.length === 0 ? (
              <p className="text-sm font-medium text-fg" data-testid="leave-apply-duration">
                That's {formatLeaveDays(duration.days)} of leave.
                <span className="ml-1 font-normal text-fg-muted">
                  Weekly offs and holidays in the range aren't counted.
                </span>
              </p>
            ) : null}

            {exceedsBalance ? (
              <Alert tone="warning" data-testid="leave-apply-over-balance">
                This is more than you have left. You can still send it, but it will probably be turned down.
                Have a word with your admin first.
              </Alert>
            ) : null}

            <Textarea
              label="Reason"
              rows={3}
              placeholder="A line is enough, your admin sees this."
              error={form.formState.errors.reason?.message}
              data-testid="leave-apply-reason"
              {...form.register("reason")}
            />
          </form>
        </DrawerBody>

        <DrawerFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="leave-apply-form"
            loading={create.isPending}
            disabled={Boolean(duration && duration.issues.length > 0)}
            data-testid="leave-apply-submit"
          >
            Send request
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
