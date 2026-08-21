// Create/Edit batch drawer — RHF + zod resolver against
// CreateBatchRequestSchema/UpdateBatchRequestSchema (@repo/types), same
// pattern as student-form-drawer.tsx/program-form-drawer.tsx. Program,
// branch and faculty pickers are <Select>s populated from
// use-courses/use-branches/use-faculty (no business logic here — those
// hooks own the data fetching, this component is pure form/presentation).
// WEEKLY SCHEDULE: multiple days, one time range. `BatchScheduleSchema` has always been
// an ARRAY of {day,startTime,endTime} blocks (max 14) — the P1 UI just never exposed more
// than one, so "Mon/Wed/Fri 18:00–20:00" was three trips through the edit form. Picking N
// days now emits N blocks sharing the chosen times. No contract, API or DB change: the
// wire shape is what it always was.
//
// A per-day time range (Mon 18:00, Sat 10:00) is still not expressible here. That is the
// deliberate next step, not an oversight — the storage already allows it, and the form
// grows a repeater when someone actually needs it.
import * as React from "react";
import { useForm } from "react-hook-form";
import { Button, Checkbox, Drawer, DrawerContent, DrawerBody, DrawerFooter, Input, Select, SelectItem, useToast } from "@repo/ui";
import {
  CreateBatchRequestSchema,
  UpdateBatchRequestSchema,
  type BatchDetail,
  type BatchMode,
  type BatchStatus,
  type CreateBatchRequest,
  type ScheduleBlock,
  type UpdateBatchRequest,
} from "@repo/types";

import { useCreateBatch, useUpdateBatch } from "../../hooks/use-batches";
import { useProgramsList } from "../../hooks/use-courses";
import { useAllBranches } from "../../hooks/use-branches";
import { useFacultyList } from "../../hooks/use-faculty";

const MODES: { value: BatchMode; label: string }[] = [
  { value: "live", label: "Live" },
  { value: "recorded", label: "Recorded" },
  { value: "hybrid", label: "Hybrid" },
];

const STATUSES: { value: BatchStatus; label: string }[] = [
  { value: "planned", label: "Planned" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "archived", label: "Archived" },
];

const DAYS: { value: ScheduleBlock["day"]; label: string }[] = [
  { value: "mon", label: "Monday" },
  { value: "tue", label: "Tuesday" },
  { value: "wed", label: "Wednesday" },
  { value: "thu", label: "Thursday" },
  { value: "fri", label: "Friday" },
  { value: "sat", label: "Saturday" },
  { value: "sun", label: "Sunday" },
];

interface BatchFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batch?: BatchDetail;
}

/** New batches open in Active — see the create branch of the reset() below. */
const DEFAULT_NEW_BATCH_STATUS: BatchStatus = "active";

/** Seat count a new batch opens with. Always editable in the field below. */
const DEFAULT_NEW_BATCH_CAPACITY = 30;

// RHF state shape — same fields as the wire schema, but `schedule` is flattened to a set
// of days plus ONE shared time range; reassembled into the BatchScheduleSchema array at
// submit time.
type BatchFormValues = Omit<CreateBatchRequest, "schedule" | "endDate"> & {
  endDate?: string;
  scheduleDays?: ScheduleBlock["day"][];
  scheduleStart?: string;
  scheduleEnd?: string;
};

export function BatchFormDrawer({ open, onOpenChange, batch }: BatchFormDrawerProps): React.JSX.Element {
  const isEdit = Boolean(batch);
  const { toast } = useToast();
  const createBatch = useCreateBatch();
  const updateBatch = useUpdateBatch();

  const { data: programsData } = useProgramsList({ page: 1, pageSize: 200, includeDeleted: false });
  const { data: branchesData } = useAllBranches();
  const { data: facultyData } = useFacultyList({ page: 1, pageSize: 200, includeDeleted: false });

  const { register, handleSubmit, reset, watch, setValue, formState } = useForm<BatchFormValues>();
  const errors = formState.errors;

  React.useEffect(() => {
    if (!open) return;
    if (isEdit && batch) {
      // Times come from the first block. Blocks written by this form always share one
      // range, so that is lossless for anything it produced; a batch given per-day times
      // by some other means would be flattened to the first block's range on save, which
      // is why the times are shown as a single pair rather than silently dropped.
      const firstBlock = batch.schedule[0];
      reset({
        programId: batch.programId,
        branchId: batch.branchId,
        facultyId: batch.facultyId ?? undefined,
        name: batch.name,
        startDate: batch.startDate,
        endDate: batch.endDate ?? undefined,
        capacity: batch.capacity,
        mode: batch.mode,
        status: batch.status,
        scheduleDays: batch.schedule.map((block) => block.day),
        scheduleStart: firstBlock?.startTime,
        scheduleEnd: firstBlock?.endTime,
      });
    } else {
      // Active, not Planned: in practice a batch is created when it is ready to take
      // students, and "Planned" batches were being left un-flipped and quietly missing
      // from anything that filters on active. Still fully editable in the field below.
      // Capacity is seeded rather than left blank. It has no DB default and is the hard cap
      // on enrolments (`activeCount >= batch.capacity` → `enrollments.batch_full`), so a
      // batch created with 1 in this box silently accepts one student and rejects everyone
      // after — which reads as "a batch can only hold one member" rather than as a typo.
      reset({ status: DEFAULT_NEW_BATCH_STATUS, scheduleDays: [], capacity: DEFAULT_NEW_BATCH_CAPACITY });
    }
    // Intentionally reset only on open/identity change, not on every render.
  }, [open, isEdit, batch]);

  const isPending = createBatch.isPending || updateBatch.isPending;

  const selectedDays = watch("scheduleDays") ?? [];
  const toggleDay = (day: ScheduleBlock["day"], checked: boolean) => {
    const next = checked ? [...selectedDays, day] : selectedDays.filter((d) => d !== day);
    // `shouldDirty` so the drawer's unsaved-changes affordances treat a day toggle like
    // any other edit — setValue() alone leaves the form pristine.
    setValue("scheduleDays", next, { shouldDirty: true });
  };

  /**
   * One block per selected day, all sharing the chosen time range.
   *
   * Emitted in DAYS order rather than click order, so "Fri then Mon" and "Mon then Fri"
   * store identically and the schedule always reads Monday-first wherever it is displayed.
   */
  const buildSchedule = (values: BatchFormValues): ScheduleBlock[] => {
    const days = values.scheduleDays ?? [];
    if (days.length === 0 || !values.scheduleStart || !values.scheduleEnd) return [];
    return DAYS.filter((d) => days.includes(d.value)).map((d) => ({
      day: d.value,
      startTime: values.scheduleStart!,
      endTime: values.scheduleEnd!,
    }));
  };

  const onSubmit = handleSubmit(async (values) => {
    const { scheduleDays: _scheduleDays, scheduleStart: _scheduleStart, scheduleEnd: _scheduleEnd, endDate, ...rest } = values;
    const schedule = buildSchedule(values);

    try {
      if (isEdit && batch) {
        const body: UpdateBatchRequest = UpdateBatchRequestSchema.parse({
          ...rest,
          endDate: endDate || null,
          schedule,
        });
        await updateBatch.mutateAsync({ id: batch.id, body });
        toast({ title: "Batch updated", variant: "success" });
      } else {
        const body: CreateBatchRequest = CreateBatchRequestSchema.parse({
          ...rest,
          endDate: endDate || undefined,
          schedule,
          status: rest.status ?? DEFAULT_NEW_BATCH_STATUS,
        });
        await createBatch.mutateAsync(body);
        toast({ title: "Batch created", variant: "success" });
      }
      onOpenChange(false);
    } catch (error) {
      // Surface the API error envelope clearly (e.g. capacity/duplicate
      // validation) — ApiError carries `.problem.detail`/`.title` (RFC
      // 7807-style Problem Details, see @repo/api-client http/client.ts).
      const description =
        error && typeof error === "object" && "problem" in error
          ? ((error as { problem: { detail?: string; title?: string } }).problem.detail ??
            (error as { problem: { detail?: string; title?: string } }).problem.title)
          : error instanceof Error
            ? error.message
            : undefined;
      toast({
        title: isEdit ? "Couldn't update batch" : "Couldn't create batch",
        description,
        variant: "destructive",
      });
    }
  });

  const programs = programsData?.items ?? [];
  const branches = branchesData?.items ?? [];
  const faculty = facultyData?.items ?? [];

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent position="center"
        title={isEdit ? "Edit batch" : "Add batch"}
        description={isEdit ? batch?.name : "Create a new batch under a program and branch."}
        data-testid={isEdit ? "batch-edit-drawer" : "batch-create-drawer"}
      >
        <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
          <DrawerBody className="flex flex-col gap-4">
            <Input label="Batch name" required placeholder="e.g. FSWD-2026-Jan" {...register("name")} error={errors.name?.message} data-testid="batch-form-name" />
            <Select
              label="Program"
              required
              placeholder="Select a program"
              value={watch("programId")}
              onValueChange={(value) => setValue("programId", value)}
              error={errors.programId?.message}
              data-testid="batch-form-program"
            >
              {programs.map((program) => (
                <SelectItem key={program.id} value={program.id}>
                  {program.title}
                </SelectItem>
              ))}
            </Select>
            <Select
              label="Branch"
              required
              placeholder="Select a branch"
              value={watch("branchId")}
              onValueChange={(value) => setValue("branchId", value)}
              error={errors.branchId?.message}
              data-testid="batch-form-branch"
            >
              {branches.map((branch) => (
                <SelectItem key={branch.id} value={branch.id}>
                  {branch.name} ({branch.city})
                </SelectItem>
              ))}
            </Select>
            <Select
              label="Faculty"
              placeholder="Unassigned"
              value={watch("facultyId")}
              onValueChange={(value) => setValue("facultyId", value === "__none__" ? undefined : value)}
              helperText="Can also be assigned later from the batch detail view."
              data-testid="batch-form-faculty"
            >
              <SelectItem value="__none__">Unassigned</SelectItem>
              {faculty.map((member) => (
                <SelectItem key={member.id} value={member.id}>
                  {member.name}
                </SelectItem>
              ))}
            </Select>
            <Input
              label="Start date"
              type="date"
              required
              {...register("startDate")}
              error={errors.startDate?.message}
              data-testid="batch-form-start-date"
            />
            <Input
              label="End date"
              type="date"
              helperText="Leave blank for an open-ended/ongoing batch."
              {...register("endDate")}
              error={errors.endDate?.message}
              data-testid="batch-form-end-date"
            />
            <Input
              label="Capacity"
              type="number"
              min={1}
              max={10000}
              required
              placeholder="e.g. 30"
              {...register("capacity", { valueAsNumber: true })}
              error={errors.capacity?.message}
              data-testid="batch-form-capacity"
            />
            <Select
              label="Mode"
              required
              placeholder="Select mode"
              value={watch("mode")}
              onValueChange={(value) => setValue("mode", value as BatchMode)}
              error={errors.mode?.message}
              data-testid="batch-form-mode"
            >
              {MODES.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </Select>
            <Select
              label="Status"
              required
              placeholder="Select status"
              value={watch("status")}
              onValueChange={(value) => setValue("status", value as BatchStatus)}
              error={errors.status?.message}
              data-testid="batch-form-status"
            >
              {STATUSES.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </Select>

            <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
              <legend className="px-1 text-sm font-medium text-fg">Weekly schedule (optional)</legend>
              {/* A checkbox group, not a multi-select listbox: seven fixed options that
                  are all worth seeing at once, and toggling three of them should not cost
                  three open/close cycles. `role="group"` + the legend give the set one
                  accessible name. */}
              <div role="group" aria-labelledby="batch-form-schedule-days-label">
                <p id="batch-form-schedule-days-label" className="mb-2 text-sm font-medium text-fg">
                  Days
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-2" data-testid="batch-form-schedule-days">
                  {/* Wrapping <label> rather than a `label` prop — Checkbox is a bare
                      Radix root, and this is the pattern user-form-drawer's role
                      checklist already uses. */}
                  {DAYS.map((opt) => (
                    <label key={opt.value} className="flex cursor-pointer items-center gap-2 text-sm text-fg">
                      <Checkbox
                        checked={selectedDays.includes(opt.value)}
                        onCheckedChange={(checked) => toggleDay(opt.value, checked === true)}
                        data-testid={`batch-form-schedule-day-${opt.value}`}
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-sm text-fg-muted">
                  {selectedDays.length === 0
                    ? "No fixed day. Leave blank for an unscheduled batch."
                    : "The times below apply to every selected day."}
                </p>
              </div>
              <div className="flex gap-3">
                <Input
                  label="Start time"
                  type="time"
                  placeholder="e.g. 18:00"
                  wrapperClassName="flex-1"
                  {...register("scheduleStart")}
                  data-testid="batch-form-schedule-start"
                />
                <Input
                  label="End time"
                  type="time"
                  placeholder="e.g. 20:00"
                  wrapperClassName="flex-1"
                  {...register("scheduleEnd")}
                  data-testid="batch-form-schedule-end"
                />
              </div>
            </fieldset>
          </DrawerBody>
          <DrawerFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} data-testid="batch-form-cancel">
              Cancel
            </Button>
            <Button type="submit" loading={isPending} data-testid="batch-form-submit">
              {isEdit ? "Save changes" : "Create batch"}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
