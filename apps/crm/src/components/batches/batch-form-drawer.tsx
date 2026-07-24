// Create/Edit batch drawer — RHF + zod resolver against
// CreateBatchRequestSchema/UpdateBatchRequestSchema (@repo/types), same
// pattern as student-form-drawer.tsx/program-form-drawer.tsx. Program,
// branch and faculty pickers are <Select>s populated from
// use-courses/use-branches/use-faculty (no business logic here — those
// hooks own the data fetching, this component is pure form/presentation).
// `schedule` is kept minimal for P1 (docs/03 §7.5): a single weekly block
// (day + start/end time) rather than a full multi-block builder — still
// validated against the shared BatchScheduleSchema array shape.
import * as React from "react";
import { useForm } from "react-hook-form";
import { Button, Drawer, DrawerContent, DrawerBody, DrawerFooter, Input, Select, SelectItem, useToast } from "@repo/ui";
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

// RHF state shape — same fields as the wire schema, but `schedule` is
// flattened to a single optional day/startTime/endTime block for the P1
// "minimal structured fields" requirement; reassembled into the
// BatchScheduleSchema array shape at submit time.
type BatchFormValues = Omit<CreateBatchRequest, "schedule" | "endDate"> & {
  endDate?: string;
  scheduleDay?: ScheduleBlock["day"];
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
        scheduleDay: firstBlock?.day,
        scheduleStart: firstBlock?.startTime,
        scheduleEnd: firstBlock?.endTime,
      });
    } else {
      reset({ status: "planned" });
    }
    // Intentionally reset only on open/identity change, not on every render.
  }, [open, isEdit, batch]);

  const isPending = createBatch.isPending || updateBatch.isPending;

  const buildSchedule = (values: BatchFormValues): ScheduleBlock[] => {
    if (!values.scheduleDay || !values.scheduleStart || !values.scheduleEnd) return [];
    return [{ day: values.scheduleDay, startTime: values.scheduleStart, endTime: values.scheduleEnd }];
  };

  const onSubmit = handleSubmit(async (values) => {
    const { scheduleDay: _scheduleDay, scheduleStart: _scheduleStart, scheduleEnd: _scheduleEnd, endDate, ...rest } = values;
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
          status: rest.status ?? "planned",
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
              <Select
                label="Day"
                placeholder="No fixed day"
                value={watch("scheduleDay")}
                onValueChange={(value) => setValue("scheduleDay", value as ScheduleBlock["day"])}
                data-testid="batch-form-schedule-day"
              >
                {DAYS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </Select>
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
